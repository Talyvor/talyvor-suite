import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StatementsScreen } from './WalletScreens'
import { AppMoney } from './money'

// B56.15 — Statements has a tab per wallet: each agent's credits, the room's wallet, then every currency account the
// company or an agent holds, each in its own currency with the opening, in, out and balance band and Download CSV.
// B57.25 — each currency account's statement is Pocket's document (w-stmt-cusd, w-stmt-rausd): the account's name and
// kind, this month so far in its own currency, the band, its lines newest first, and Accounts, on Invoices.

const agent = (id: string, name: string, kind = 'agent') => ({ id, name, kind, balance_ulxc: 0, spent_ulxc: 0, keys: [], created_at: '2026-10-01T09:00:00Z' })
const account = (id: string, currency: string, agent_id = '') => ({
  id, currency, agent_id, purpose: agent_id ? 'agent' : 'company', status: 'open', name: id, balance_minor: 0, test_minor: 0, live_minor: 0,
})
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const USD = {
  account_id: 'acct_usd', currency: 'USD', from: '2026-10-01T00:00:00Z', to: '2026-11-01T00:00:00Z',
  opening_minor: 365_000, in_minor: 0, out_minor: 45_000, closing_minor: 320_000,
  lines: [{ entry_id: 'ent_1', line: 1, at: '2026-10-01T10:00:00Z', kind: 'payout', amount_minor: -45_000, funding: 'test', counterparty: 'Kite Accounting', memo: 'October bookkeeping', balance_after_minor: 320_000 }],
}
const RESEARCH_USD = {
  account_id: 'acct_rusd', agent_id: 'agt_research', currency: 'USD', opening_minor: 0, in_minor: 40_000, out_minor: 0, closing_minor: 40_000,
  lines: [{ entry_id: 'ent_2', line: 1, at: '2026-10-12T14:20:00Z', kind: 'invoice_payment', amount_minor: 40_000, funding: 'test', counterparty: 'Fennel Labs', memo: 'INV-000001', balance_after_minor: 40_000 }],
}
const RESEARCH_USDC = {
  account_id: 'acct_usdc', agent_id: 'agt_research', currency: 'USDC', opening_minor: 0, in_minor: 12_500_000, out_minor: 0, closing_minor: 12_500_000,
  lines: [{ entry_id: 'ent_3', line: 1, at: '2026-10-14T08:00:00Z', kind: 'payment_in', amount_minor: 12_500_000, funding: 'test', counterparty: 'Fennel Labs', balance_after_minor: 12_500_000 }],
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
      return json({ accounts: [account('acct_usd', 'USD'), account('acct_rusd', 'USD', 'agt_research'), account('acct_usdc', 'USDC', 'agt_research'),
        account('acct_eur', 'EUR', 'agt_research'), account('acct_gbp', 'GBP', 'agt_research')] })
    if (path === '/api/agents/agt_research/statement' && url.includes('format=json'))
      return json({ agent_id: 'agt_research', lines: [], marketplace_bill: [
        { use_id: 'use_1', at: '2026-10-12T09:00:00Z', kind: 'use', amount_ulxc: 500_000, memo: 'Lead finder', label: 'on the marketplace bill' }] })
    if (path === '/api/agents/agt_research/statement' || path === '/api/agents/room_1/statement') return json({ lines: [] })
    if (path === '/api/money/accounts/acct_usd/statement' && url.includes('format=csv'))
      return new Response('entry_id,line\n', { status: 200, headers: { 'Content-Type': 'text/csv' } })
    if (path === '/api/money/accounts/acct_usd/statement') return json(USD)
    if (path === '/api/money/accounts/acct_rusd/statement') return json(RESEARCH_USD)
    if (path === '/api/money/accounts/acct_usdc/statement') return json(RESEARCH_USDC)
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
        <AppMoney>
          <StatementsScreen />
        </AppMoney>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const tabs = async () => within(await screen.findByRole('tablist', { name: 'Statements' })).findAllByRole('tab')

describe('Statements, a tab per wallet and account', () => {
  it('lists each agent, then the room’s wallet, then every currency account, and opens on the first agent', async () => {
    show()
    await waitFor(async () => expect((await tabs()).map((t) => t.textContent)).toEqual(['Research', 'Room: Agent pricing', 'Company · USD', 'Research · USD', 'Research · USDC', 'Research · EUR', 'Research · GBP']))
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

  const band = async () => {
    const el = await screen.findByTestId('account-statement-band')
    return {
      labels: [...el.querySelectorAll('dt')].map((d) => d.textContent),
      figures: [...el.querySelectorAll('[data-money]')].map((d) => d.textContent?.replace(/\u00a0/g, ' ')),
    }
  }
  const lineCells = () =>
    within(screen.getByTestId('account-statement'))
      .getAllByRole('row')
      .slice(1)
      .map((r) => [screen.getAllByTestId('account-statement-what').find((w) => r.contains(w))?.textContent, r.querySelector('[data-money]')?.textContent?.replace(/\u00a0/g, ' ')])

  it('draws the company’s account as a document in its own currency, with a payout line, and downloads its CSV from the top', async () => {
    show('/statements?wallet=acct_usd')
    const doc = await screen.findByTestId('account-statement-doc')
    expect(within(doc).getByRole('heading', { level: 2 }).textContent).toBe('Company · US dollar account')
    expect(within(doc).getByText(/^Statement · \w+ \d{4}, so far · in US dollars$/)).toBeTruthy()
    const { labels, figures } = await band()
    expect(labels).toEqual([expect.stringMatching(/^Opening, 1 \w+$/), 'Money in', 'Money out', 'Balance now'])
    expect(figures).toEqual(['$3,650.00', '$0.00', '−$450.00', '$3,200.00'])
    expect(lineCells()).toEqual([['Kite Accounting · Paid out · October bookkeeping', '−$450.00']])
    expect(within(doc).getByText('Payments in and out of this account. An agent’s LXC is on its own statement.')).toBeTruthy()
    expect(within(doc).getByRole('link', { name: 'Accounts, on Invoices' }).getAttribute('href')).toBe('/money/invoices')

    URL.createObjectURL = vi.fn(() => 'blob:x')
    URL.revokeObjectURL = vi.fn()
    const saved: string[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      saved.push(this.download)
    })
    fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }))
    await waitFor(() => expect(saved).toEqual([expect.stringMatching(/^company-usd-statement-\d{4}-\d{2}-01-to-\d{4}-\d{2}-\d{2}\.csv$/)]))
    expect(asked.some((u) => u.startsWith('/api/money/accounts/acct_usd/statement?') && u.includes('format=csv'))).toBe(true)
  })

  it('shows an invoice paid into an agent’s account as money in, under the agent’s face', async () => {
    show('/statements?wallet=acct_rusd')
    const doc = await screen.findByTestId('account-statement-doc')
    expect(within(doc).getByRole('heading', { level: 2 }).textContent).toBe('Research · US dollar account')
    expect(within(doc).getByRole('link', { name: 'Open Research' }).getAttribute('href')).toBe('/agents?agent=agt_research')
    expect((await band()).figures).toEqual(['$0.00', '+$400.00', '$0.00', '$400.00'])
    expect(lineCells()).toEqual([['Fennel Labs · Invoice paid · INV-000001', '+$400.00']])
  })

  it('shows a USDC account in USDC, never in dollars', async () => {
    show('/statements?wallet=acct_usdc')
    const doc = await screen.findByTestId('account-statement-doc')
    expect(within(doc).getByRole('heading', { level: 2 }).textContent).toBe('Research · USDC account')
    expect(within(doc).getByText(/so far · in USDC$/)).toBeTruthy()
    expect((await band()).figures).toEqual(['0.00 USDC', '+12.50 USDC', '0.00 USDC', '12.50 USDC'])
    expect(lineCells()).toEqual([['Fennel Labs · Paid in', '+12.50 USDC']])
    expect(doc.textContent).not.toContain('$')
  })

  it('says an empty account has had nothing move', async () => {
    show('/statements?wallet=acct_eur')
    expect((await screen.findByText(/^Nothing moved in this account in this period\./)).textContent).toBe(
      'Nothing moved in this account in this period. Payments in on Invoices and out on Pay show here.',
    )
    expect(screen.getByRole('link', { name: 'Invoices' }).getAttribute('href')).toBe('/money/invoices')
    expect((await band()).figures).toEqual(['€0.00', '€0.00', '€0.00', '€0.00'])
  })

  it('says so when an account’s statement cannot be read', async () => {
    show('/statements?wallet=acct_gbp')
    expect(await screen.findByText('This account’s statement could not be read just now.')).toBeTruthy()
    expect(screen.queryByTestId('account-statement-band')).toBeNull()
  })
})
