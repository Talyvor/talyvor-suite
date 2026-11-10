import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StatementsScreen } from './WalletScreens'

// B56.15 — Statements has a tab per wallet: each agent's credits, the room's wallet, then every currency account the
// company or an agent holds, each in its own currency with the opening, in, out and balance band and Download CSV.

const agent = (id: string, name: string, kind = 'agent') => ({ id, name, kind, balance_ulxc: 0, spent_ulxc: 0, keys: [], created_at: '2026-10-01T09:00:00Z' })
const account = (id: string, currency: string, agent_id = '') => ({
  id, currency, agent_id, purpose: agent_id ? 'agent' : 'company', status: 'open', name: id, balance_minor: 0, test_minor: 0, live_minor: 0,
})
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const USD = {
  account_id: 'acct_usd', currency: 'USD', from: '2026-10-01T00:00:00Z', to: '2026-11-01T00:00:00Z',
  opening_minor: 365_000, in_minor: 0, out_minor: 45_000, closing_minor: 320_000,
  lines: [{ entry_id: 'ent_1', line: 1, at: '2026-10-01T10:00:00Z', kind: 'payment_out', amount_minor: -45_000, funding: 'test', counterparty: 'Kite Accounting', balance_after_minor: 320_000 }],
}
const EUR = { account_id: 'acct_eur', currency: 'EUR', opening_minor: 0, in_minor: 0, out_minor: 0, closing_minor: 0, lines: null }

let asked: string[]

beforeEach(() => {
  asked = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    asked.push(url)
    const path = url.split('?')[0]
    if (path === '/api/agents')
      return json({ workspace_balance_ulxc: 0, allocated_ulxc: 0, unallocated_ulxc: 0, spent_ulxc: 0,
        agents: [agent('room_1', 'Room: Agent pricing', 'room'), agent('agt_research', 'Research')] })
    if (path === '/api/money/accounts')
      return json({ accounts: [account('acct_usd', 'USD'), account('acct_eur', 'EUR', 'agt_research'), account('acct_gbp', 'GBP', 'agt_research')] })
    if (path === '/api/agents/agt_research/statement' && url.includes('format=json'))
      return json({ agent_id: 'agt_research', lines: [], marketplace_bill: [
        { use_id: 'use_1', at: '2026-10-12T09:00:00Z', kind: 'use', amount_ulxc: 500_000, memo: 'Lead finder', label: 'on the marketplace bill' }] })
    if (path === '/api/agents/agt_research/statement' || path === '/api/agents/room_1/statement') return json({ lines: [] })
    if (path === '/api/money/accounts/acct_usd/statement' && url.includes('format=csv'))
      return new Response('entry_id,line\n', { status: 200, headers: { 'Content-Type': 'text/csv' } })
    if (path === '/api/money/accounts/acct_usd/statement') return json(USD)
    if (path === '/api/money/accounts/acct_eur/statement') return json(EUR)
    if (path === '/api/money/accounts/acct_gbp/statement') return json({ error: 'Lens could not answer just now' }, 502)
    return json({ error: 'not here' }, 404)
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function show(at = '/statements') {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[at]}>
        <StatementsScreen />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const tabs = async () => within(await screen.findByRole('tablist', { name: 'Statements' })).findAllByRole('tab')

describe('Statements, a tab per wallet and account', () => {
  it('lists each agent, then the room’s wallet, then every currency account, and opens on the first agent', async () => {
    show()
    await waitFor(async () => expect((await tabs()).map((t) => t.textContent)).toEqual(['Research', 'Room: Agent pricing', 'Company · USD', 'Research · EUR', 'Research · GBP']))
    expect((await tabs())[0].getAttribute('aria-selected')).toBe('true')
    expect(await screen.findByText('Nothing has moved in this wallet yet. Fund it under Money to start.')).toBeTruthy()
  })

  it('puts what an agent used on the marketplace on its tab, each line on the marketplace bill', async () => {
    show()
    const bill = await screen.findByTestId('marketplace-bill-lines')
    expect(bill.textContent).toContain('Lead finder · on the marketplace bill')
    expect(bill.textContent).toContain('0.5 LXC')
  })

  it('shows the room’s wallet on its own tab', async () => {
    show()
    fireEvent.click((await tabs())[1])
    expect(await screen.findByLabelText('Search Room: Agent pricing’s statement')).toBeTruthy()
    expect(asked.some((u) => u.startsWith('/api/agents/room_1/statement?'))).toBe(true)
  })

  it('shows a currency account’s opening, in, out and balance and every line, in its own currency, and downloads its CSV', async () => {
    show('/statements?wallet=acct_usd')
    const band = await screen.findByTestId('account-statement-band')
    expect([...band.querySelectorAll('dt')].map((d) => d.textContent)).toEqual(['Opening', 'Money in', 'Money out', 'Balance'])
    expect([...band.querySelectorAll('dd')].map((d) => d.textContent)).toEqual(['$3,650.00', '$0.00', '−$450.00', '$3,200.00'])
    const row = within(screen.getByTestId('account-statement')).getAllByRole('row')[1]
    expect(within(row).getAllByRole('cell').map((c) => c.textContent).slice(1)).toEqual(['Paid out · Kite Accounting', '−$450.00', '$3,200.00'])
    expect(screen.getAllByText('Company · USD').length).toBeGreaterThan(1)

    URL.createObjectURL = vi.fn(() => 'blob:x')
    URL.revokeObjectURL = vi.fn()
    const saved: string[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      saved.push(this.download)
    })
    fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }))
    expect(await screen.findByText(/^Saved company-usd-statement-/)).toBeTruthy()
    expect(saved).toHaveLength(1)
    expect(asked.some((u) => u.startsWith('/api/money/accounts/acct_usd/statement?') && u.includes('format=csv'))).toBe(true)
  })

  it('says an empty account has had nothing move', async () => {
    show('/statements?wallet=acct_eur')
    expect((await screen.findByText(/^Nothing moved in this account in this period\./)).textContent).toBe(
      'Nothing moved in this account in this period. Payments in on Invoices and out on Pay show here.',
    )
    expect(screen.getByRole('link', { name: 'Invoices' }).getAttribute('href')).toBe('/money/invoices')
    expect([...screen.getByTestId('account-statement-band').querySelectorAll('dd')].map((d) => d.textContent)).toEqual(['€0.00', '€0.00', '€0.00', '€0.00'])
  })

  it('says so when an account’s statement cannot be read', async () => {
    show('/statements?wallet=acct_gbp')
    expect(await screen.findByText('This account’s statement could not be read just now.')).toBeTruthy()
    expect(screen.queryByTestId('account-statement-band')).toBeNull()
  })
})
