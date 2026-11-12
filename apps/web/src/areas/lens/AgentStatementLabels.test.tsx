import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Statement } from './AgentBank'
import { AgentStatement, NEWEST_LINES } from './AgentStatement'
import { AppMoney } from './money'
import type { PostingKind, StatementLine } from './agentBankApi'

// B28.19 — the DONE line: a statement with a transfer, a card charge, a top-up and a pot move shows four
// different, correct labels. The statement below carries every kind Lens posts on an agent's account
// (internal/economy: postEntry and the transfer, escrow, pay and reversal inserts), each as Lens writes it.

const M = 1_000_000
const line = (kind: PostingKind, amount: number, counterparty: string, ref = ''): StatementLine => ({
  entry_id: `ent_${kind}_${amount}`, kind, amount_ulxc: amount * M, counterparty, ref, balance_after_ulxc: 0, at: '2026-10-04T09:00:00Z',
})

const rows: Array<[StatementLine, string]> = [
  [line('fund', 10, 'workspace'), 'Funded by the workspace'],
  [line('withdraw', -1, 'workspace'), 'Taken back by the workspace'],
  [line('topup', 4, 'workspace'), 'Topped up automatically by the workspace'],
  [line('credit_line', 2, 'workspace'), 'Covered by the credit line'],
  [line('spend', -1, 'spend'), 'Spent on a request'],
  [line('hold', -1, 'spend'), 'Held for a request'],
  [line('release', 1, 'spend'), 'Released after a request'],
  [line('settle', -1, 'spend'), 'Settled a request'],
  [line('pay', -3, 'agent:agt_2', 'draft'), 'Paid Writer · draft'],
  [line('transfer', 5, 'agent:agt_2', 'tr_1'), 'Transfer from Writer'],
  [line('transfer', -2, 'agent:agt_2', 'tr_2'), 'Transferred to Writer'],
  [line('reversal', -5, 'agent:agt_2'), 'Given back to Writer'],
  [line('escrow', -6, 'escrow:esc_1'), 'Held in escrow'],
  [line('escrow', 6, 'escrow:esc_1'), 'Released from escrow'],
  [line('card', -7, 'spend', 'iauth_1'), 'Card charge'],
  [line('card', 7, 'spend', 'iauth_1'), 'Card refund'],
  [line('cash_out', -8, 'cash_out:co_1'), 'Cashed out'],
  [line('cash_out', 8, 'cash_out:co_1'), 'Cash-out returned'],
  [line('pot_in', -9, 'pot:pot_1'), 'Moved into a pot'],
  [line('pot_out', 9, 'pot:pot_1'), 'Moved out of a pot'],
  // B32.69 — the platform fee on a call is its own line, in the words Lens labels it with.
  [{ ...line('platform_fee', 0, 'spend', 'rq_1'), amount_ulxc: -300_000, label: 'Platform fee 3%' }, 'Platform fee 3%'],
]

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('the agent statement', () => {
  it('names every kind of line, and a transfer, a card charge, a top-up and a pot move each by what it was', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (String(input).split('?')[0] === '/api/agents/agt_1/statement')
        return new Response(JSON.stringify({ agent_id: 'agt_1', lines: rows.map(([l]) => l) }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      return new Response('null', { status: 404 })
    })
    const agent = { id: 'agt_1', name: 'Researcher', balance_ulxc: 0, spent_ulxc: 0, keys: [], created_at: '2026-10-01T09:00:00Z' }
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <Statement agent={agent} nameOf={(id) => (id === 'agt_2' ? 'Writer' : 'an agent')} />
      </QueryClientProvider>,
    )

    const table = await screen.findByTestId('agent-statement')
    const what = within(table)
      .getAllByRole('row')
      .slice(1)
      .map((r) => within(r).getByTestId('statement-what').textContent)
    expect(what).toEqual(rows.map(([, label]) => label))
    // Every kind Lens posts is on this statement, and none of them falls through to another's words.
    const kinds: PostingKind[] = ['fund', 'withdraw', 'topup', 'credit_line', 'spend', 'hold', 'settle', 'release', 'pay', 'transfer', 'escrow', 'reversal', 'card', 'cash_out', 'pot_in', 'pot_out', 'platform_fee']
    expect(new Set(rows.map(([l]) => l.kind))).toEqual(new Set(kinds))
    expect(what.filter((t) => t === 'Spent on a request')).toHaveLength(1)
    // The DONE line's four: four different labels, each the right one.
    const done = ['Transfer from Writer', 'Card charge', 'Topped up automatically by the workspace', 'Moved into a pot']
    for (const label of done) expect(what).toContain(label)
    expect(new Set(done).size).toBe(4)
    // A received transfer reads as money in, signed +.
    const received = within(table).getByText('Transfer from Writer').closest('tr')!
    expect(within(received).getAllByRole('cell')[2].textContent).toBe('+5 LXC')
    const fee = within(table).getByText('Platform fee 3%').closest('tr')!
    expect(within(fee).getAllByRole('cell')[2].textContent).toBe('−0.3 LXC')
  })
})

// B57.24 — the agent's statement on Statements, as w-stmt-research draws it: Lens reads it by model and day (B57.13), so
// each model's requests on one day are one line with their count, its platform fee its own line under it, and every
// other line says what it was and that it settled. The fake answers as Lens does: the period's accounts on every page,
// the lines newest first, NEWEST_LINES then the asked limit a page, the next page after the cursor.

const NOW = new Date('2026-10-22T10:30:00Z')
const AGENT = { id: 'agt_research', name: 'Research', balance_ulxc: 0, spent_ulxc: 0, keys: [], created_at: '2026-09-01T09:00:00Z' }
const dayLine = (n: number, over: Partial<StatementLine>): StatementLine => ({
  entry_id: `ent_${n}`, kind: 'spend', amount_ulxc: 0, counterparty: 'spend', balance_after_ulxc: 0, at: NOW.toISOString(), ...over,
})
// Newest first: today's Sonnet and its fee, yesterday's Haiku and its fee, the funding of 20 October, then 40 older
// lines of the month, so Show all has pages to read.
const GROUPED: StatementLine[] = [
  dayLine(1, { at: '2026-10-22T10:24:00Z', model: 'claude-sonnet-5', day: '2026-10-22', requests: 312, amount_ulxc: -420 * M }),
  dayLine(2, { at: '2026-10-22T10:24:00Z', kind: 'platform_fee', model: 'claude-sonnet-5', day: '2026-10-22', label: 'Platform fee 5.5%', memo: 'On those requests', amount_ulxc: -23_100_000 }),
  dayLine(3, { at: '2026-10-21T11:12:00Z', model: 'claude-haiku-4-5', day: '2026-10-21', requests: 88, amount_ulxc: -20 * M }),
  dayLine(4, { at: '2026-10-21T11:12:00Z', kind: 'platform_fee', model: 'claude-haiku-4-5', day: '2026-10-21', label: 'Platform fee 5.5%', memo: 'On those requests', amount_ulxc: -1_100_000 }),
  dayLine(5, { at: '2026-10-20T04:30:00Z', kind: 'fund', counterparty: 'workspace', amount_ulxc: 10_000 * M }),
  ...Array.from({ length: 40 }, (_, i) => dayLine(6 + i, { at: `2026-10-${String(19 - Math.floor(i / 3)).padStart(2, '0')}T09:00:00Z`, model: 'claude-haiku-4-5', day: `2026-10-${String(19 - Math.floor(i / 3)).padStart(2, '0')}`, requests: 1, amount_ulxc: -(i + 1) * M })),
]
const OPENING = 18_900 * M
const sum = GROUPED.reduce((t, l) => t + l.amount_ulxc, 0)
const IN = GROUPED.filter((l) => l.amount_ulxc > 0).reduce((t, l) => t + l.amount_ulxc, 0)
const ACCOUNT = { account: 'agent:agt_research', opening_ulxc: OPENING, in_ulxc: IN, out_ulxc: IN - sum, closing_ulxc: OPENING + sum }

function fakeLensByDay() {
  const asked: URLSearchParams[] = []
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = new URL(String(input), 'http://app')
    const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'Content-Type': 'application/json' } })
    if (url.pathname === '/api/lxc/topup-options') return json({ allowed_usd_cents: [1000], billing_enabled: true, usd_per_lxc: 0.1 })
    if (url.pathname === '/api/models')
      return json([{ id: 'claude-sonnet-5', display_name: 'Claude Sonnet 5' }, { id: 'claude-haiku-4-5', display_name: 'Claude Haiku 4.5' }])
    if (url.pathname !== '/api/agents/agt_research/statement') return new Response('null', { status: 404 })
    const q = url.searchParams
    asked.push(q)
    const start = q.has('cursor') ? GROUPED.findIndex((l) => l.entry_id === q.get('cursor')) + 1 : 0
    const page = GROUPED.slice(start, start + Number(q.get('limit')))
    const more = start + page.length < GROUPED.length
    return json({ to: '2026-10-22T10:30:00Z', group: 'day', time_zone: 'UTC', accounts: [ACCOUNT], lines: page, ...(more ? { next_cursor: page[page.length - 1].entry_id } : {}) })
  })
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <AppMoney>
          <AgentStatement agent={AGENT} nameOf={() => 'an agent'} />
        </AppMoney>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return asked
}

const doc = () => screen.getByTestId('statement-doc')
const docLines = () => within(screen.getByTestId('statement-lines')).getAllByRole('row').slice(1)
const flat = (el: Element) => (el.textContent ?? '').replace(/\u00a0/g, ' ')

describe('the agent’s statement on Statements (B57.24)', () => {
  afterEach(() => vi.useRealTimers())

  it('groups requests to one model on one day into one line, with its count, and says what every other line was', async () => {
    const asked = fakeLensByDay()
    await screen.findByTestId('statement-lines')
    expect(asked[0].get('group')).toBe('day')
    expect(asked[0].get('from')).toBe('2026-10-01')
    expect(asked[0].get('limit')).toBe(String(NEWEST_LINES))
    await waitFor(() => expect(flat(docLines()[0])).toContain('Claude Sonnet 5 · 312 requests today'))
    const what = docLines().slice(0, 5).map((r) => flat(within(r).getByTestId('statement-doc-what')))
    expect(what).toEqual([
      'Claude Sonnet 5 · 312 requests today',
      'Platform fee 5.5% · On those requests',
      'Claude Haiku 4.5 · 88 requests',
      'Platform fee 5.5% · On those requests',
      'Funded by the workspace · Settled',
    ])
    expect(flat(docLines()[0])).toContain('Today, ')
    expect(flat(docLines()[2])).toContain('Yesterday, ')
    expect(flat(docLines()[4])).toContain('20 Oct, 18:30') // the browser's clock: these tests run at +14
    // Dollars first with LXC beside: 420 LXC at $0.10 is $42.00.
    expect(flat(docLines()[0])).toContain('−$42.00 −420 LXC')
    expect(flat(docLines()[4])).toContain('+$1,000.00 +10,000 LXC')
    expect(flat(doc())).toContain('Statement · October 2026, so far · updated')
  })

  it('pages with Show all to the month’s first line, every line once, and the band agrees with the lines', async () => {
    const asked = fakeLensByDay()
    await screen.findByTestId('statement-lines')
    expect(docLines()).toHaveLength(NEWEST_LINES)
    fireEvent.click(screen.getByRole('button', { name: 'Show all' }))
    await waitFor(() => expect(docLines()).toHaveLength(GROUPED.length))
    expect(screen.queryByRole('button', { name: 'Show all' })).toBeNull()
    // Each page after the first is asked after the page before's last line, over the first page's period.
    expect(asked.slice(1).map((q) => [q.get('cursor'), q.get('to')])).toEqual([[`ent_${NEWEST_LINES}`, '2026-10-22T10:30:00Z']])
    // Every line once, in Lens's order, the oldest last.
    const shown = docLines().map((r) => flat(within(r).getAllByRole('cell')[2]))
    expect(shown).toHaveLength(new Set(GROUPED.map((l) => l.entry_id)).size)
    expect(shown.at(-1)).toContain('−$4.00 −40 LXC')
    // The band: opening + in − out is the balance now, and the lines move exactly that much.
    const band = within(screen.getByTestId('statement-band')).getAllByRole('definition').map(flat)
    expect(band).toEqual(['$1,890.00 18,900 LXC', `+$${(IN / M / 10).toLocaleString('en-US', { minimumFractionDigits: 2 })} +${(IN / M).toLocaleString('en-US')} LXC`, expect.stringMatching(/^−\$/), expect.stringMatching(/^\$/)])
    expect(ACCOUNT.opening_ulxc + ACCOUNT.in_ulxc - ACCOUNT.out_ulxc).toBe(ACCOUNT.closing_ulxc)
    expect(ACCOUNT.closing_ulxc - ACCOUNT.opening_ulxc).toBe(GROUPED.reduce((t, l) => t + l.amount_ulxc, 0))
    expect(within(screen.getByTestId('statement-band')).getByText('Opening, 1 October')).toBeTruthy()
  })
})
