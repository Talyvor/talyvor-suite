import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentMoneyWalletCard } from './AgentMoneyWallet'
import { AppMoney } from './money'
import type { Agent } from './agentBankApi'

// B48.47 — under each of the agent's wallets: Top up and Cash out, each quoted then confirmed once (a cash-out signed
// with the owner's passkey over Lens's challenge), Request as a link and a QR code, Activity with explorer links, and a
// month's Statement with its CSV. The BFF is mocked at the wire with what Lens B48.8, B48.10 and B48.14 answer.
// B57.216 — in Pocket: each action a row of the Money card with its line, the quote as P7 draws it (You send, Rate, Fee,
// They get, then how long the price is locked), and the Statement with its downloads beside its heading.

/** What the owner's passkey signs, as the browser hands it over. */
const ASSERTION = { rawId: new Uint8Array([1]).buffer, response: { clientDataJSON: new Uint8Array([2]).buffer, authenticatorData: new Uint8Array([3]).buffer, signature: new Uint8Array([4]).buffer } }

const AGENT = { id: 'agt_1', name: 'Researcher', balance_ulxc: 0, owner_user_id: 'u1' } as Agent
const USDC = { agent_id: 'agt_1', asset: 'USDC', partner: 'circle', balance_minor: 25_000_000, mode: 'LIVE',
  receive: { asset: 'USDC', network: 'base', address: '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed' } }
const TX = `0x${'ab'.repeat(32)}`
const move = (over: object) => ({ id: 'wmove_1', agent_id: 'agt_1', route: 'card', sell_minor: 5000, sell_currency: 'GBP', fee_minor: 75,
  buy_minor: 6_255_000, buy_currency: 'USDC', rate: '1.2700', status: 'quoted', expires_at: '2026-11-25T10:00:00Z', created_at: '2026-11-25T09:59:30Z', ...over })

function mockBff() {
  const calls: { method: string; url: string; body: string; key: string }[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const headers = (init?.headers ?? {}) as Record<string, string>
    calls.push({ method, url, body: typeof init?.body === 'string' ? init.body : '', key: headers['Idempotency-Key'] ?? '' })
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/api/agents/agt_1/wallets') return json({ agent_id: 'agt_1', wallet_kind: 'crypto', wallets: [USDC] })
    if (url === '/api/money/payees')
      return json({ payees: [{ id: 'payee_me', name: 'My Monzo', country: 'GB', iban: 'GB33BUKB20201555555555', check: 'exact_match', checked_by: 't', checked_at: '2026-10-01T09:00:00Z', needs_confirmation: false }] })
    if (url === '/api/agents/agt_1/wallet-moves/quote') {
      const b = JSON.parse(String(init?.body))
      return json(b.route === 'cash_out' ? move({ route: 'cash_out', sell_minor: 10_000_000, sell_currency: 'USDC', fee_minor: 50_000, buy_minor: 7_830, buy_currency: 'GBP', rate: '0.7870' }) : move({}))
    }
    if (url === '/api/agents/agt_1/wallet-moves/wmove_1/challenge') return json({ challenge: 'Y2gx', allow_credentials: ['Y3JlZDE'] })
    if (url === '/api/agents/agt_1/wallet-moves/wmove_1/confirm') {
      const route = calls.some((c) => c.url.endsWith('/challenge')) ? 'cash_out' : 'card'
      return json(route === 'cash_out' ? move({ route, status: 'posted', buy_minor: 7_830, buy_currency: 'GBP' }) : move({ status: 'posted' }))
    }
    if (url === '/api/agents/agt_1/wallet-moves') return json([])
    if (url === '/api/agents/agt_1/crypto-requests' && method === 'POST')
      return json({ id: 'creq_1', token: 'USDC', network: 'base', pay_to: USDC.receive.address, amount_minor: 40_000_000, memo: 'May report', expires_at: '2026-12-02T09:00:00Z',
        status: 'open', received_minor: 0, remaining_minor: 40_000_000, created_at: '2026-11-25T09:00:00Z', link: 'https://app.talyvor.com/pay/creq_1',
        uri: `ethereum:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913@8453/transfer?address=${USDC.receive.address}&uint256=40000000` }, 201)
    if (url === '/api/agents/agt_1/crypto-requests') return json({ requests: [] })
    if (url.startsWith('/api/agents/agt_1/wallet/activity'))
      return json({ lines: [
        { entry_id: 'e2', line: 1, at: '2026-11-24T12:00:00Z', account_id: 'acc_c', account_name: 'chain:base', currency: 'USDC', kind: 'chain_deposit', amount_minor: 3_000_000,
          counterparty: '0x1111111111111111111111111111111111111111', ref: `${TX}:4`, balance_after_minor: 25_000_000 },
        { entry_id: 'e1', line: 1, at: '2026-11-20T12:00:00Z', account_id: 'acc_c', account_name: 'circle', currency: 'USDC', kind: 'wallet_move', amount_minor: 22_000_000, balance_after_minor: 22_000_000 },
      ] })
    if (url.startsWith('/api/agents/agt_1/wallet/statement') && url.includes('format=json'))
      return json({ from: '2026-11-01T00:00:00Z', to: '2026-12-01T00:00:00Z',
        accounts: [{ account_id: 'acc_c', account_name: 'chain:base', currency: 'USDC', opening_minor: 0, in_minor: 25_000_000, out_minor: 0, closing_minor: 25_000_000 }], lines: [] })
    if (url.startsWith('/api/agents/agt_1/wallet/statement')) return new Response('at,amount\n', { status: 200, headers: { 'Content-Type': 'text/csv' } })
    if (url === '/api/agents/passkeys') return json({ passkeys: [] })
    if (url === '/api/money/devices') return json({ devices: [] })
    return json(null, 404)
  })
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(async () => {}) }, configurable: true })
  Object.defineProperty(navigator, 'credentials', { value: { get: vi.fn(async () => ASSERTION), create: vi.fn() }, configurable: true })
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AppMoney>
        <MemoryRouter>
          <div data-design="pocket">
            <AgentMoneyWalletCard agent={AGENT} />
          </div>
        </MemoryRouter>
      </AppMoney>
    </QueryClientProvider>,
  )
  return calls
}

const posts = (calls: ReturnType<typeof mockBff>, end: string) => calls.filter((c) => c.method === 'POST' && c.url.endsWith(end))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('the agent’s wallet: top up, cash out, request, activity, statements', () => {
  it('tops up by card: the quote shows what is paid, the fee, the rate and what arrives, and Confirm makes it once, unsigned', async () => {
    const calls = mockBff()
    const card = await screen.findByTestId('agent-money-wallet')
    fireEvent.click(await within(card).findByRole('button', { name: 'Top up' }))
    const form = within(card).getByTestId('wallet-top-up-USDC')
    fireEvent.change(within(form).getByRole('combobox', { name: 'How' }), { target: { value: 'card' } })
    fireEvent.change(within(form).getByRole('textbox', { name: 'Amount in GBP' }), { target: { value: '50' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Review' }))
    const quote = await within(card).findByTestId('wallet-move-quote')
    expect(JSON.parse(posts(calls, '/wallet-moves/quote')[0].body)).toEqual({ route: 'card', amount_minor: 5000, currency: 'GBP' })
    expect(within(quote).getByText('1 GBP = 1.2700 USDC')).toBeTruthy()
    expect(within(quote).getByTestId('wallet-move-gets').textContent).toMatch(/^6\.255\sUSDC$/)
    fireEvent.click(within(quote).getByRole('button', { name: 'Confirm' }))
    await within(card).findByText(/is in Researcher’s wallet/)
    expect(posts(calls, '/wallet-moves/wmove_1/confirm')).toHaveLength(1)
    expect(posts(calls, '/wallet-moves/wmove_1/confirm')[0].body).toBe('{}')
    expect(posts(calls, '/challenge')).toHaveLength(0)
  })

  it('cashes out to the owner’s own bank account, signed with their passkey over Lens’s challenge', async () => {
    const calls = mockBff()
    const card = await screen.findByTestId('agent-money-wallet')
    fireEvent.click(await within(card).findByRole('button', { name: 'Cash out' }))
    fireEvent.change(await within(card).findByRole('combobox', { name: 'To your bank account' }), { target: { value: 'payee_me' } })
    fireEvent.change(within(card).getByRole('textbox', { name: 'Amount in USDC' }), { target: { value: '10' } })
    fireEvent.click(within(card).getByRole('button', { name: 'Review' }))
    const quote = await within(card).findByTestId('wallet-move-quote')
    expect(JSON.parse(posts(calls, '/wallet-moves/quote')[0].body)).toEqual({ route: 'cash_out', amount_minor: 10_000_000, currency: 'USDC', payee_id: 'payee_me', to_currency: 'GBP' })
    expect(within(quote).getByText('They get')).toBeTruthy()
    fireEvent.click(within(quote).getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(card.textContent).toMatch(/is on its way to your bank account/))
    expect(posts(calls, '/wallet-moves/wmove_1/challenge')).toHaveLength(1)
    const confirms = posts(calls, '/wallet-moves/wmove_1/confirm')
    expect(confirms).toHaveLength(1)
    expect(JSON.parse(confirms[0].body)).toEqual({ assertion: { credential_id: 'AQ', client_data_json: 'Ag', authenticator_data: 'Aw', signature: 'BA' } })
  })

  it('requests a payment: one request under one key, then its link and its QR code', async () => {
    const calls = mockBff()
    const card = await screen.findByTestId('agent-money-wallet')
    fireEvent.click(await within(card).findByRole('button', { name: 'Request' }))
    fireEvent.change(within(card).getByRole('textbox', { name: 'Amount in USDC' }), { target: { value: '40' } })
    fireEvent.change(within(card).getByRole('textbox', { name: 'What it is for' }), { target: { value: 'May report' } })
    fireEvent.click(within(card).getByRole('button', { name: 'Make the link' }))
    const link = await within(card).findByTestId('wallet-request-link')
    const sent = posts(calls, '/api/agents/agt_1/crypto-requests')
    expect(sent).toHaveLength(1)
    expect(sent[0].key).not.toBe('')
    expect(JSON.parse(sent[0].body)).toMatchObject({ token: 'USDC', network: 'base', amount_minor: 40_000_000, memo: 'May report' })
    expect(within(link).getByRole('link', { name: 'https://app.talyvor.com/pay/creq_1' })).toBeTruthy()
    expect(within(link).getByRole('img', { name: /^QR code to pay Researcher/ })).toBeTruthy()
  })

  it('shows the wallet’s activity, a payment on the chain with its explorer link', async () => {
    mockBff()
    const card = await screen.findByTestId('agent-money-wallet')
    fireEvent.click(await within(card).findByRole('button', { name: 'Activity' }))
    const activity = await within(card).findByTestId('wallet-activity-USDC')
    const links = within(activity).getAllByRole('link', { name: 'See it on the explorer' })
    expect(links).toHaveLength(1)
    expect(links[0]).toHaveAttribute('href', `https://basescan.org/tx/${TX}`)
  })

  it('shows a month’s statement of the wallet and downloads its CSV', async () => {
    const calls = mockBff()
    const saved = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', { value: saved.mockReturnValue('blob:x'), configurable: true })
    Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true })
    const card = await screen.findByTestId('agent-money-wallet')
    fireEvent.click(await within(card).findByRole('button', { name: 'Statements' }))
    const statement = await within(card).findByTestId('wallet-statements-USDC')
    await within(statement).findByText('Closing balance')
    expect(within(statement).getByRole('heading', { name: 'Statement' })).toBeTruthy()
    fireEvent.click(within(statement).getByRole('button', { name: 'Download CSV' }))
    await waitFor(() => expect(saved).toHaveBeenCalledTimes(1))
    expect(calls.some((c) => /\/api\/agents\/agt_1\/wallet\/statement\?month=\d{4}-\d{2}&format=csv$/.test(c.url))).toBe(true)
  })

  it('draws each action as a row with its line, and the quote as P7’s facts with the seconds its price is locked', async () => {
    mockBff()
    const card = await screen.findByTestId('agent-money-wallet')
    const top = await within(card).findByRole('button', { name: 'Top up' })
    expect(top).toHaveAttribute('aria-expanded', 'false')
    expect(top).toHaveAccessibleDescription('By card, bank transfer, or from your own money or USDC')
    expect(within(card).getByRole('button', { name: 'Cash out' })).toHaveAccessibleDescription('Turn Researcher’s USDC back into money, in your own bank account')
    fireEvent.click(top)
    expect(top).toHaveAttribute('aria-expanded', 'true')
    const form = within(card).getByTestId('wallet-top-up-USDC')
    fireEvent.change(within(form).getByRole('textbox', { name: 'Amount in GBP' }), { target: { value: '50' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Review' }))
    const quote = await within(card).findByTestId('wallet-move-quote')
    expect(quote.textContent).toMatch(/^You send.+Rate.+Fee.+They get/)
    expect(quote.textContent).not.toMatch(/You pay|Price held until/)
    expect(within(quote).getByText(/Locked for/).textContent).toBe('Locked for 30 seconds')
    expect(within(quote).getByTestId('wallet-move-seconds-left').textContent).toMatch(/^(30|29) seconds left$/)
  })
})
