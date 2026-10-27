import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentMoneyWalletCard } from './AgentMoneyWallet'
import type { Agent } from './agentBankApi'

// B46.9 — the agent's wallet on the money layer: its balance, how to add money (an address with its QR code, or an IBAN
// with its holder; nothing to copy from the sandbox) and Send, which prepares a payment that waits for one-tap approval.
// The BFF is mocked at the wire with what Lens's wallet route answers for the sandbox and for a live partner.

const AGENT = { id: 'agt_1', name: 'Researcher', balance_ulxc: 0, owner_user_id: 'u1' } as Agent
const ADDRESS = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'
const SANDBOX = { agent_id: 'agt_1', asset: 'USDC', partner: 'sandbox', balance_minor: 2_500_000, mode: 'TEST',
  receive: { asset: 'USDC', network: 'base', address: '0xsandbox' } }
const LIVE_ADDRESS = { ...SANDBOX, partner: 'circle', mode: 'LIVE', notice: undefined, receive: { asset: 'USDC', network: 'base', address: ADDRESS } }
const LIVE_IBAN = { ...SANDBOX, partner: 'swan', mode: 'LIVE', notice: undefined, receive: { asset: 'EUR', holder: 'Acme Robotics SAS', iban: 'FR7630006000011234567890189', bic: 'AGRIFRPP' } }
const REQUEST = { id: 'preq_1', status: 'pending_approval', summary: '1 payment to Acme Ltd', client: 'chat', totals: { GBP: 1250 }, created_at: '2026-10-26T09:00:00Z',
  items: [{ position: 1, payee_id: 'payee_1', payee_name: 'Acme Ltd', currency: 'GBP', amount_minor: 1250, reference: 'INV-9', decision: 'needs_approval', reason: 'the first payment to a payee waits for you' }] }

function mockBff(wallet: unknown) {
  const sent: string[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/api/agents/agt_1/wallet') return json(wallet)
    if (url === '/api/money/payees')
      return json({ payees: [{ id: 'payee_1', name: 'Acme Ltd', country: 'GB', check: 'exact_match', checked_by: 't', checked_at: '2026-10-01T09:00:00Z', needs_confirmation: false }] })
    if (url === '/api/money/payment-requests' && init?.method === 'POST') {
      sent.push(String(init.body))
      return json(REQUEST, 201)
    }
    if (url === '/api/money/payment-requests/preq_1') return json(REQUEST)
    return json(null, 404)
  })
  const writeText = vi.fn(async () => {})
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <AgentMoneyWalletCard agent={AGENT} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { sent, writeText }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('the agent’s money-layer wallet', () => {
  it('on the sandbox shows the balance, no details and no notice, nothing to copy, and a send goes to approval', async () => {
    const { sent } = mockBff(SANDBOX)
    const card = await screen.findByTestId('agent-money-wallet')
    await within(card).findByText('2.50 USDC')
    expect(within(card).getByTestId('wallet-no-details').textContent).toBe('Researcher’s wallet has no details to pay into yet.')
    expect(within(card).queryByText('0xsandbox')).toBeNull()
    expect(within(card).queryByRole('button', { name: /copy/i })).toBeNull()

    fireEvent.change(await within(card).findByRole('combobox', { name: 'Send to' }), { target: { value: 'payee_1' } })
    fireEvent.change(within(card).getByRole('textbox', { name: 'Amount in GBP' }), { target: { value: '12.50' } })
    fireEvent.change(within(card).getByRole('textbox', { name: 'Reference' }), { target: { value: 'INV-9' } })
    fireEvent.click(within(card).getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(JSON.parse(sent[0])).toEqual({ voice: false, items: [{ payee_id: 'payee_1', currency: 'GBP', amount_minor: 1250, reference: 'INV-9' }] })
    await within(card).findByRole('button', { name: /approve/i })
  })

  it('from a live stablecoin partner shows the address, its QR code, and copies the address', async () => {
    const { writeText } = mockBff(LIVE_ADDRESS)
    const card = await screen.findByTestId('wallet-address')
    expect(within(card).getByText(ADDRESS)).toBeTruthy()
    expect(within(card).getByText(/Send USDC on Base to this address/)).toBeTruthy()
    expect(within(card).getByRole('img', { name: /QR code/ }).querySelector('path')?.getAttribute('d')).toMatch(/^M\d/)
    fireEvent.click(within(card).getByRole('button', { name: 'Copy address' }))
    expect(writeText).toHaveBeenCalledWith(ADDRESS)
  })

  it('from a live e-money partner shows the IBAN in the holder’s name and copies it', async () => {
    const { writeText } = mockBff(LIVE_IBAN)
    const card = await screen.findByTestId('wallet-iban')
    expect(within(card).getByText('Acme Robotics SAS')).toBeTruthy()
    expect(within(card).getByText('FR7630006000011234567890189')).toBeTruthy()
    fireEvent.click(within(card).getByRole('button', { name: 'Copy IBAN' }))
    expect(writeText).toHaveBeenCalledWith('FR7630006000011234567890189')
  })
})
