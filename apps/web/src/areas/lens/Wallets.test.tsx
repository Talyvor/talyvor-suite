import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WalletsScreen } from './Wallets'
import { AppMoney } from './money'

// B59.53 — Wallets on the web: each side the account's kind shows (SPEC 3.3), a tile per currency and each account with
// what it holds; Top up, Withdraw and, for Hybrid, Convert, each with a confirm step, the last two signed with the owner's
// passkey over Lens's challenge under the same key as the move.

/** What the browser's passkey prompt answers, once the owner has signed. */
const ASSERTION = {
  rawId: new Uint8Array([1]).buffer,
  response: { clientDataJSON: new Uint8Array([2]).buffer, authenticatorData: new Uint8Array([3]).buffer, signature: new Uint8Array([4]).buffer },
}

const read = (el: Element | null) => (el?.textContent ?? '').replace(/ /g, ' ')
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const acct = (id: string, currency: string, purpose: 'company' | 'agent', minor: number, agent_id = '') => ({
  id, agent_id, currency, purpose, status: 'open', name: `${currency} account`, balance_minor: minor, test_minor: minor, live_minor: 0,
})
const ACCOUNTS = [
  acct('macc_usd', 'USD', 'company', 1_840_000),
  acct('macc_eur', 'EUR', 'company', 750_000),
  acct('macc_usdc', 'USDC', 'company', 14_000_000_000),
  acct('macc_remy', 'USD', 'agent', 620_000, 'agt_remy'),
]
const OWN_BANK = { id: 'payee_own', name: 'Maya Lind', country: 'US', routing_number: '021000021', account_number: '55779911', own: true, check: 'exact_match', checked_by: 'test', checked_at: '2026-11-01T09:00:00Z', needs_confirmation: false, created_at: '2026-11-01T09:00:00Z' }
const SUPPLIER = { ...OWN_BANK, id: 'payee_lf', name: 'Lumen Freight GmbH', own: false }

let kind: string
let posts: { path: string; body: Record<string, unknown>; key: string | null }[]
let creds: string[]

beforeEach(() => {
  kind = 'hybrid'
  posts = []
  creds = []
  Object.defineProperty(navigator, 'credentials', { value: { get: vi.fn().mockResolvedValue(ASSERTION), create: vi.fn() }, configurable: true })
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const path = String(input).split('?')[0]
    if (init?.method === 'POST') posts.push({ path, body: JSON.parse(String(init.body)), key: new Headers(init.headers).get('Idempotency-Key') })
    if (path === '/api/workspace/account') return json({ account_type: 'business', money_kind: kind })
    if (path === '/api/agents') return json({ workspace_balance_ulxc: 0, allocated_ulxc: 0, unallocated_ulxc: 0, spent_ulxc: 0, agents: [{ id: 'agt_remy', name: 'Remy', balance_ulxc: 0, spent_ulxc: 0, keys: [], created_at: '2026-10-01T09:00:00Z' }] })
    if (path === '/api/money/accounts') return json({ accounts: ACCOUNTS })
    if (path === '/api/money/payees') return json({ payees: [OWN_BANK, SUPPLIER] })
    if (path === '/api/money/accounts/macc_usd/top-up') return json({ id: 'ent_1' }, 201)
    if (path === '/api/money/accounts/macc_usd/withdraw/challenge' || path === '/api/money/convert/challenge') return json({ challenge: 'Y2g', allow_credentials: creds, user_verification: 'required' })
    if (path === '/api/money/accounts/macc_usd/withdraw') return json({ id: 'pay_1', status: 'sent' }, 201)
    if (path === '/api/money/convert/quote')
      return json({ id: 'mcv_1', sell_minor: 100_000, sell_currency: 'USD', margin_minor: 500, buy_minor: 995_000_000, buy_currency: 'USDC', rate: '0.995', status: 'quoted', expires_at: '2026-11-15T10:00:30Z' }, 201)
    if (path === '/api/money/convert') return json({ id: 'mcv_1', status: 'converted' })
    return json({ error: 'not here' }, 404)
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function show(at = '/money/wallets') {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[at]}>
        <AppMoney>
          <Routes>
            <Route path="/money/wallets" element={<WalletsScreen />} />
          </Routes>
        </AppMoney>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('Wallets — the sides by kind', () => {
  it('Hybrid: Fiat and Stablecoin side by side, a tile per currency and each account, with Top up, Withdraw and Convert', async () => {
    show()
    const fiat = await screen.findByTestId('wallets-fiat')
    expect(read(within(fiat).getByTestId('wallets-tile-USD'))).toBe('US dollar$24,600.00')
    expect(read(within(fiat).getByTestId('wallets-tile-EUR'))).toBe('Euro€7,500.00')
    expect(read(fiat)).toContain('The company · USD')
    expect(read(fiat)).toContain('Remy · USD')
    const coins = screen.getByTestId('wallets-stablecoin')
    expect(read(within(coins).getByTestId('wallets-tile-USDC'))).toContain('14,000.00 USDC')
    const actions = screen.getByTestId('wallets-actions')
    expect(within(actions).getAllByRole('button').map((b) => b.textContent)).toEqual(['Top up', 'Withdraw', 'Convert'])
  })

  it('Fiat only: no stablecoin side and no Convert', async () => {
    kind = 'fiat'
    show()
    await screen.findByTestId('wallets-fiat')
    expect(screen.queryByTestId('wallets-stablecoin')).toBeNull()
    expect(within(screen.getByTestId('wallets-actions')).getAllByRole('button').map((b) => b.textContent)).toEqual(['Top up', 'Withdraw'])
  })

  it('Stablecoin and crypto only: no fiat side, no Withdraw and no Convert', async () => {
    kind = 'stablecoin'
    show()
    await screen.findByTestId('wallets-stablecoin')
    expect(screen.queryByTestId('wallets-fiat')).toBeNull()
    expect(within(screen.getByTestId('wallets-actions')).getAllByRole('button').map((b) => b.textContent)).toEqual(['Top up'])
  })
})

describe('Wallets — each action confirms first', () => {
  it('Top up: Continue shows what is added where, and only Top up sends it, under its key', async () => {
    show('/money/wallets?do=top-up')
    const dialog = await screen.findByRole('dialog', { name: 'Top up' })
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Amount' }), { target: { value: '250' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continue' }))
    const confirm = await screen.findByTestId('top-up-confirm')
    expect(read(confirm)).toContain('$250.00')
    expect(read(confirm)).toContain('The company · USD')
    expect(posts).toEqual([])
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Top up' }))
    await waitFor(() => expect(posts.map((p) => p.path)).toEqual(['/api/money/accounts/macc_usd/top-up']))
    expect(posts[0].body).toEqual({ amount_minor: 25_000 })
    expect(posts[0].key).toBeTruthy()
  })

  it('Withdraw: only to a bank of your own, confirmed, then signed with the passkey over the challenge under the same key', async () => {
    creds = ['Y3JlZDE']
    show('/money/wallets?do=withdraw')
    const dialog = await screen.findByRole('dialog', { name: 'Withdraw' })
    const banks = await within(dialog).findByRole('combobox', { name: 'To your own bank' })
    expect(within(banks).getAllByRole('option').map((o) => o.textContent)).toEqual(['Maya Lind · account ending 9911'])
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Amount' }), { target: { value: '1000' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continue' }))
    const confirm = await screen.findByTestId('withdraw-confirm')
    expect(read(confirm)).toContain('$1,000.00')
    expect(read(confirm)).toContain('Maya Lind · account ending 9911')
    expect(posts).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw with your passkey' }))
    await waitFor(() => expect(posts.map((p) => p.path)).toEqual(['/api/money/accounts/macc_usd/withdraw/challenge', '/api/money/accounts/macc_usd/withdraw']))
    expect(posts[1].body).toMatchObject({ payee_id: 'payee_own', amount_minor: 100_000, assertion: { credential_id: 'AQ' } })
    expect(posts[1].key).toBe(posts[0].key)
  })

  it('Convert: the quote is the confirm step, then signed with the passkey and converted once under the key', async () => {
    creds = ['Y3JlZDE']
    show('/money/wallets?do=convert')
    const dialog = await screen.findByRole('dialog', { name: 'Convert' })
    expect(within(within(dialog).getByRole('combobox', { name: 'To' })).getAllByRole('option').map((o) => o.textContent)).toEqual(['USDC'])
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Amount' }), { target: { value: '1000' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continue' }))
    const confirm = await screen.findByTestId('convert-confirm')
    expect(posts[0]).toMatchObject({ path: '/api/money/convert/quote', body: { sell_currency: 'USD', buy_currency: 'USDC', sell_minor: 100_000 } })
    expect(read(confirm)).toContain('1 USD = 0.9950 USDC')
    expect(read(confirm)).toContain('995.00 USDC')
    fireEvent.click(screen.getByRole('button', { name: 'Convert with your passkey' }))
    await waitFor(() => expect(posts.map((p) => p.path)).toEqual(['/api/money/convert/quote', '/api/money/convert/challenge', '/api/money/convert']))
    expect(posts[2].body).toMatchObject({ quote_id: 'mcv_1', assertion: { credential_id: 'AQ' } })
    expect(posts[2].key).toBe(posts[1].key)
  })

  it('a kind without the action never opens it', async () => {
    kind = 'fiat'
    show('/money/wallets?do=convert')
    await screen.findByTestId('wallets-fiat')
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
