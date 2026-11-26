import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StatementsScreen } from './WalletScreens'
import { AppMoney } from './money'

// B56.15 — Statements has a tab per account: every currency account the company or an agent holds, each in its own
// currency with the opening, in, out and balance band and Download CSV. B61.55: the agents' credits are parked.
// B57.25 — each currency account's statement is Pocket's document (w-stmt-cusd, w-stmt-rausd).
// B61.134 — Statements as one sheet of paper (Pocket Live DESIGN.md 16.2): the paper, and Download (PDF, Excel, CSV),
// Statement for (the balances, then the agents) and Period, each file the statement on the paper.

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
// Twelve lines, oldest first, so the paper shows ten and See all.
const MANY = {
  account_id: 'acct_many', currency: 'USD', opening_minor: 0, in_minor: 120_000, out_minor: 0, closing_minor: 120_000,
  lines: Array.from({ length: 12 }, (_, i) => ({ entry_id: `ent_m${i}`, line: 1, at: `2026-10-${String(i + 1).padStart(2, '0')}T09:00:00Z`, kind: 'payment_in',
    amount_minor: 10_000, funding: 'test', counterparty: `Payer ${i + 1}`, balance_after_minor: 10_000 * (i + 1) })),
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
      return json({ accounts: [account('acct_usd', 'USD'), account('acct_ceur', 'EUR'), account('acct_rusd', 'USD', 'agt_research'), account('acct_usdc', 'USDC', 'agt_research'),
        account('acct_eur', 'EUR', 'agt_research'), account('acct_gbp', 'GBP', 'agt_research')] })
    if (path === '/api/agents/agt_research/statement' && url.includes('format=json'))
      return json({ agent_id: 'agt_research', lines: [], marketplace_bill: [
        { use_id: 'use_1', at: '2026-10-12T09:00:00Z', kind: 'use', amount_ulxc: 500_000, memo: 'Lead finder', label: 'on the marketplace bill' }] })
    if (path === '/api/agents/agt_research/statement' || path === '/api/agents/room_1/statement') return json({ lines: [] })
    if (path === '/api/money/accounts/acct_gbp/statement') return json({ error: 'Lens could not answer just now' }, 502)
    if (path.endsWith('/statement') && url.includes('format=pdf')) return new Response('%PDF-1.4\n', { status: 200, headers: { 'Content-Type': 'application/pdf' } })
    if (path.endsWith('/statement') && url.includes('format=xlsx')) return new Response('PK', { status: 200, headers: { 'Content-Type': 'application/zip' } })
    if (path.endsWith('/statement') && url.includes('format=csv')) return new Response('entry_id,line\n', { status: 200, headers: { 'Content-Type': 'text/csv' } })
    if (path === '/api/money/accounts/acct_ceur/statement') return json({ ...EUR, account_id: 'acct_ceur', opening_minor: 12_000, closing_minor: 12_000 })
    if (path === '/api/money/accounts/acct_many/statement') return json(MANY)
    if (path === '/api/money/accounts/acct_usd/statement') return json(USD)
    if (path === '/api/money/accounts/acct_rusd/statement') return json(RESEARCH_USD)
    if (path === '/api/money/accounts/acct_usdc/statement') return json(RESEARCH_USDC)
    if (path === '/api/money/accounts/acct_eur/statement') return json(EUR)
    if (path === '/api/lxc/topup-options') return json({ allowed_usd_cents: [1000], billing_enabled: true, usd_per_lxc: 0.1 })
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

const day = (d: Date) => d.toISOString().slice(0, 10)
const now = new Date()
const thisMonth = day(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)))
const tomorrow = day(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)))
const read = (el: Element) => el.textContent?.replace(/\u00a0/g, ' ')
const pills = (label: string) => within(screen.getByRole('radiogroup', { name: label })).getAllByRole('radio')
const band = async () => {
  const el = await screen.findByTestId('account-statement-band')
  return { labels: [...el.querySelectorAll('dt')].map(read), figures: [...el.querySelectorAll('[data-money]')].map(read) }
}
/** Each line of the paper as its cells read: date and time, details, money out, money in, balance. */
const lineCells = () => within(screen.getByTestId('account-statement')).getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell').map(read))

function saving() {
  URL.createObjectURL = vi.fn(() => 'blob:x')
  URL.revokeObjectURL = vi.fn()
  const saved: string[] = []
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    saved.push(this.download)
  })
  return saved
}

describe('Statements, one sheet of paper (B61.134)', () => {
  it('chooses the balances, then the agents, and opens on the company’s first balance this month so far', async () => {
    show()
    expect((await screen.findByTestId('statement-title')).textContent).toMatch(/^\w+ so far$/)
    expect(pills('Balance').map(read)).toEqual(['US dollar', 'Euro'])
    expect(pills('Agent').map(read)).toEqual(['Research · USD', 'Research · USDC', 'Research · EUR', 'Research · GBP'])
    expect(pills('Balance')[0].getAttribute('aria-checked')).toBe('true')
    expect(read(screen.getByTestId('statement-for'))).toMatch(/^US dollar balance · 1 to \d+ \w+ \d{4}$/)
    expect(asked).toContain(`/api/money/accounts/acct_usd/statement?${new URLSearchParams({ from: thisMonth, to: tomorrow })}`)
    // B61.55 — the agents' credit statements stay parked.
    expect(asked.some((u) => u.includes('/statement') && u.startsWith('/api/agents/'))).toBe(false)
    expect(pills('Period').map(read)).toEqual(expect.arrayContaining(['Last 3 months', `${now.getUTCFullYear()} so far`]))
  })

  it('redraws the paper for Euro over the last 3 months, and each of the three files is that statement', async () => {
    show()
    await screen.findByTestId('account-statement-band')
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Balance' })).getByRole('radio', { name: 'Euro' }))
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Period' })).getByRole('radio', { name: 'Last 3 months' }))
    const from = day(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, 1)))
    const through = day(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)))
    await waitFor(() => expect(screen.getByTestId('statement-title').textContent).toBe('Last 3 months'))
    expect(read(screen.getByTestId('statement-for'))).toMatch(/^Euro balance · \d+ \w+ to \d+ \w+ \d{4}$/)
    expect(asked).toContain(`/api/money/accounts/acct_ceur/statement?${new URLSearchParams({ from, to: thisMonth })}`)
    expect((await band()).figures).toEqual(['€120.00', '€0.00', '€0.00', '€120.00'])
    expect((await band()).labels[3]).toBe('Closing balance')

    const saved = saving()
    for (const name of ['Download PDF', 'Download Excel', 'Download CSV']) {
      await waitFor(() => expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(false))
      fireEvent.click(screen.getByRole('button', { name }))
      await waitFor(() => expect(saved).toHaveLength(['Download PDF', 'Download Excel', 'Download CSV'].indexOf(name) + 1))
    }
    const stem = `talyvor-statement-EUR-${from}-to-${through}`
    expect(saved).toEqual([`${stem}.pdf`, `${stem}.xlsx`, `${stem}.csv`])
    for (const format of ['pdf', 'xlsx', 'csv'])
      expect(asked).toContain(`/api/money/accounts/acct_ceur/statement?${new URLSearchParams({ from, to: thisMonth, format })}`)
  })

  it('draws the paper: the four figures with the balance now, the five columns, and how it adds up', async () => {
    show('/statements?wallet=acct_usd')
    expect(await band()).toEqual({ labels: ['Opening balance', 'Money in', 'Money out', 'Balance now'], figures: ['$3,650.00', '$0.00', '$450.00', '$3,200.00'] })
    expect(within(screen.getByTestId('account-statement')).getAllByRole('columnheader').map(read)).toEqual(['Date', 'Details', 'Money out', 'Money in', 'Balance'])
    // DESIGN.md 16.1 — a payout is a Withdrawal, never a code.
    expect(lineCells()).toEqual([['01 Oct10:00', 'Kite AccountingWithdrawal · October bookkeeping', '450.00', '', '3,200.00', '−$450.00$3,200.00']])
    expect(read(screen.getByTestId('statement-adds-up'))).toBe('$3,650.00 opening + $0.00 in − $450.00 out = $3,200.00')
  })

  it('names an agent’s file with the agent before the currency', async () => {
    show('/statements?wallet=acct_rusd')
    expect(read(await screen.findByTestId('statement-for'))).toMatch(/^Research · US dollar balance · /)
    const saved = saving()
    fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }))
    await waitFor(() => expect(saved).toEqual([`talyvor-statement-research-USD-${thisMonth.slice(0, 7)}.pdf`]))
  })

  it('shows ten lines, then See all opens the rest in place', async () => {
    const accounts = [{ id: 'acct_many', currency: 'USD', purpose: 'company', status: 'open', name: 'acct_many', balance_minor: 0, test_minor: 0, live_minor: 0 }]
    const base = (globalThis.fetch as unknown as { getMockImplementation: () => (i: unknown) => Promise<Response> }).getMockImplementation()
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => (String(input) === '/api/money/accounts' ? json({ accounts }) : base(input)))
    show()
    await screen.findByTestId('account-statement-band')
    expect(lineCells()).toHaveLength(10)
    expect(screen.queryByTestId('statement-adds-up')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'See all 12 lines' }))
    expect(lineCells()).toHaveLength(12)
    expect(read(screen.getByTestId('statement-adds-up'))).toBe('$0.00 opening + $1,200.00 in − $0.00 out = $1,200.00')
  })

  it('shows a USDC balance in USDC, never in dollars', async () => {
    show('/statements?wallet=acct_usdc')
    expect((await band()).figures).toEqual(['0.00 USDC', '12.50 USDC', '0.00 USDC', '12.50 USDC'])
    expect(lineCells()[0].slice(2, 4)).toEqual(['', '12.50'])
    expect(screen.getByTestId('account-statement-doc').textContent).not.toContain('$')
  })

  it('says when nothing moved, and still downloads', async () => {
    show('/statements?wallet=acct_eur')
    expect(await screen.findByText('Nothing moved in this period.')).toBeTruthy()
    expect((await band()).figures).toEqual(['€0.00', '€0.00', '€0.00', '€0.00'])
    expect(screen.getByRole('button', { name: 'Download CSV' })).toBeTruthy()
  })

  it('says so when a statement cannot be read, and when a file is refused', async () => {
    show('/statements?wallet=acct_gbp')
    expect(await screen.findByText('This account’s statement could not be read just now.')).toBeTruthy()
    expect(screen.queryByTestId('account-statement-band')).toBeNull()
    saving()
    fireEvent.click(screen.getByRole('button', { name: 'Download Excel' }))
    expect(await within(screen.getByTestId('statement-download')).findByRole('alert')).toBeTruthy()
  })
})
