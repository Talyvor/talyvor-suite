import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { queryClient } from '../../App'
import { AgentCryptoSend, feeText } from './AgentCryptoSend'
import type { Agent, CryptoSend } from './agentBankApi'
import { AppMoney } from './money'

// B48.36 — Send USDC from an agent's crypto wallet (Lens B48.9): the quote first, then Send under one Idempotency-Key
// that a retry keeps, the receipt with its explorer link, and the owner's Approve, Send a test amount first and Decline
// on a send waiting for them.

const AGENT = { id: 'agt_research', name: 'Researcher', balance_ulxc: 0, spent_ulxc: 0, keys: [], created_at: '2026-11-01T09:00:00Z' } as unknown as Agent
const TO = '0x1111111111111111111111111111111111111111'

const QUOTE = {
  network: 'base',
  token: 'USDC',
  token_address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  amount_minor: 2_500_000,
  to: TO,
  to_kind: 'agent',
  to_label: 'Verified agent of Northwind Ltd',
  new_address: true,
  max_fee_wei: '42000000000000',
  fee_paid_by: 'workspace_gas_budget',
  arrival_seconds: 12,
}

const send = (over: Partial<CryptoSend>): CryptoSend =>
  ({ ...QUOTE, id: 'cs_1', agent_id: AGENT.id, direction: 'out', status: 'landed', requested_by: 'user:u1', created_at: '2026-11-20T01:00:00Z', updated_at: '2026-11-20T01:00:00Z', ...over }) as CryptoSend

interface Call {
  method: string
  url: string
  key: string | null
  body: unknown
}

function fakeBff(answer: (c: Call) => Response | undefined, sends: CryptoSend[] = []) {
  const calls: Call[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const headers = new Headers(init?.headers)
    const c = { method: init?.method ?? 'GET', url, key: headers.get('Idempotency-Key'), body: init?.body ? JSON.parse(String(init.body)) : undefined }
    calls.push(c)
    const r = answer(c)
    if (r) return r
    if (url === `/api/agents/${AGENT.id}/crypto-sends` && c.method === 'GET') return Response.json({ sends })
    return new Response('null', { status: 404 })
  })
  return calls
}

async function mount() {
  queryClient.clear()
  render(
    <QueryClientProvider client={queryClient}>
      <AppMoney>
        <div data-design="pocket">
          <AgentCryptoSend agent={AGENT} agents={[AGENT]} />
        </div>
      </AppMoney>
    </QueryClientProvider>,
  )
  await screen.findByTestId('crypto-send-history')
}

afterEach(() => {
  cleanup()
  queryClient.clear()
  vi.restoreAllMocks()
})

describe('Send USDC from an agent’s crypto wallet (B48.36)', () => {
  it('quotes first, sends once under one key kept through a retry, and shows the receipt', async () => {
    let attempts = 0
    const calls = fakeBff((c) => {
      if (c.url.endsWith('/crypto-sends/quote')) return Response.json(QUOTE)
      if (c.url.endsWith('/crypto-sends') && c.method === 'POST') {
        attempts += 1
        return attempts === 1
          ? Response.json({ error: 'Lens could not answer just now' }, { status: 502 })
          : Response.json(send({ tx_hash: '0xabc', explorer_url: 'https://basescan.org/tx/0xabc' }))
      }
    })
    await mount()
    fireEvent.change(screen.getByLabelText('Wallet address, @name, email or phone'), { target: { value: TO } })
    fireEvent.change(screen.getByLabelText('Amount in USDC'), { target: { value: '2.5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Review' }))

    const quote = await screen.findByTestId('crypto-send-quote')
    expect(calls.find((c) => c.url.endsWith('/quote'))?.body).toEqual({ to: TO, network: 'base', token: 'USDC', amount_minor: 2_500_000 })
    expect(quote.textContent).toContain('Verified agent of Northwind Ltd')
    expect(quote.textContent).toContain('0.000042 ETH')
    expect(quote.textContent).toContain('Paid from your network fee budget')
    expect(screen.getByTestId('crypto-send-arrives')).toHaveTextContent('Arrives in about 12 seconds')
    expect(screen.getByTestId('crypto-send-amount')).toHaveTextContent('2.50 USDC')
    expect(screen.getByTestId('crypto-send-new-address')).toBeInTheDocument()

    fireEvent.click(within(quote).getByRole('button', { name: 'Send' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('There was no answer. Press Send again: it is sent once, however many times you press.')
    fireEvent.click(within(screen.getByTestId('crypto-send-quote')).getByRole('button', { name: 'Send' }))
    const receipt = await screen.findByTestId('crypto-send-receipt')
    expect(receipt.textContent).toContain('Arrived')
    expect(within(receipt).getByRole('link', { name: 'See it on the explorer' })).toHaveAttribute('href', 'https://basescan.org/tx/0xabc')

    const posts = calls.filter((c) => c.method === 'POST' && c.url === `/api/agents/${AGENT.id}/crypto-sends`)
    expect(posts).toHaveLength(2)
    expect(posts[0].key).toBeTruthy()
    expect(posts[1].key).toBe(posts[0].key)
    expect(posts[1].body).toEqual({ to: TO, network: 'base', token: 'USDC', amount_minor: 2_500_000 })
  })

  it('lets the owner approve, send a test amount first, or decline a send to a new address', async () => {
    const waiting = send({ id: 'cs_wait', status: 'awaiting_owner' })
    const calls = fakeBff((c) => (c.method === 'POST' ? Response.json(send({ id: 'cs_wait', status: 'sending' }), { status: 202 }) : undefined), [
      waiting,
      send({ id: 'cs_in', direction: 'in', to: '0x2222222222222222222222222222222222222222', explorer_url: 'https://basescan.org/tx/0xdef' }),
    ])
    await mount()
    const row = await screen.findByText('Researcher wants to send to a new address')
    const box = row.closest('[data-crypto-send]') as HTMLElement
    expect(screen.getByTestId('crypto-send-history').textContent).toContain('From 0x2222…2222')

    fireEvent.click(within(box).getByRole('button', { name: 'Review' }))
    fireEvent.click(within(box).getByRole('button', { name: 'Send a test amount first' }))
    fireEvent.change(within(box).getByLabelText('Test amount in USDC'), { target: { value: '0.1' } })
    fireEvent.click(within(box).getByRole('button', { name: 'Send the test amount' }))
    await waitFor(() => expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1))
    fireEvent.click(within(box).getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(calls.filter((c) => c.method === 'POST')).toHaveLength(2))
    fireEvent.click(within(box).getByRole('button', { name: 'Decline' }))
    await waitFor(() => expect(calls.filter((c) => c.method === 'POST')).toHaveLength(3))

    expect(calls.filter((c) => c.method === 'POST').map((c) => [c.url, c.body])).toEqual([
      [`/api/agents/${AGENT.id}/crypto-sends/cs_wait/approve`, { test_amount_minor: 100_000 }],
      [`/api/agents/${AGENT.id}/crypto-sends/cs_wait/approve`, {}],
      [`/api/agents/${AGENT.id}/crypto-sends/cs_wait/decline`, {}],
    ])
  })

  it('B48.47 — sends to a person on Talyvor by their @name, which Lens resolves', async () => {
    const calls = fakeBff((c) => (c.url.endsWith('/crypto-sends/quote') ? Response.json({ ...QUOTE, to: '@nick', to_kind: 'address', to_label: undefined }) : undefined))
    await mount()
    fireEvent.change(screen.getByLabelText('Wallet address, @name, email or phone'), { target: { value: '@nick' } })
    fireEvent.change(screen.getByLabelText('Amount in USDC'), { target: { value: '2.5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Review' }))
    await screen.findByTestId('crypto-send-quote')
    expect(calls.find((c) => c.url.endsWith('/crypto-sends/quote'))?.body).toEqual({ to: '@nick', network: 'base', token: 'USDC', amount_minor: 2_500_000 })
  })

  it('rounds the most the network fee can be up, never down', () => {
    expect(feeText('1')).toBe('0.000001 ETH')
    expect(feeText('1500000000000000000')).toBe('1.5 ETH')
  })
})
