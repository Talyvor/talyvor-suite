import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Statement } from './AgentBank'
import { AgentStatement, NEWEST_LINES } from './AgentStatement'
import { AppMoney } from './money'
import { DESIGN_ATTR } from '../../pocketPending'
import type { PostingKind, StatementLine } from './agentBankApi'

// B28.51 — the DONE line: page 2 continues below page 1, and a filter by kind returns only that kind. Lens searches,
// filters and pages the statement (B28.324); the fake below answers as it does, newest first, 100 lines a page.

const TO = '2026-11-09T04:00:00Z'
const line = (n: number, kind: PostingKind, amount: number): StatementLine => ({
  entry_id: `ent_${n}`, kind, amount_ulxc: amount, counterparty: 'workspace', balance_after_ulxc: n * 1_000_000, at: `2026-11-0${1 + (n % 8)}T09:00:00Z`,
})
// 130 lines, newest first: every tenth a card charge, the rest funding.
const all = Array.from({ length: 130 }, (_, i) => (i % 10 === 0 ? line(130 - i, 'card', -1_000) : line(130 - i, 'fund', 2_000_000)))

const asked: URLSearchParams[] = []

function fakeLens() {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = new URL(String(input), 'http://app')
    if (url.pathname !== '/api/agents/agt_1/statement') return new Response('null', { status: 404 })
    const q = url.searchParams
    asked.push(q)
    const kinds = q.get('kind')?.split(',') ?? []
    const words = (q.get('q') ?? '').toLowerCase()
    const kept = all.filter((l) => (kinds.length === 0 || kinds.includes(l.kind)) && (words === '' || l.kind.includes(words)))
    const start = q.has('cursor') ? kept.findIndex((l) => l.entry_id === q.get('cursor')) + 1 : 0
    const page = kept.slice(start, start + Number(q.get('limit')))
    const more = start + page.length < kept.length
    const body = { to: TO, lines: page, ...(more ? { next_cursor: page[page.length - 1].entry_id } : {}) }
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
  })
}

function renderStatement() {
  const agent = { id: 'agt_1', name: 'Researcher', balance_ulxc: 0, spent_ulxc: 0, keys: [], created_at: '2026-10-01T09:00:00Z' }
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <Statement agent={agent} nameOf={() => 'an agent'} />
    </QueryClientProvider>,
  )
}

const shown = () => within(screen.getByTestId('agent-statement')).getAllByRole('row').slice(1)

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  asked.length = 0
})

describe('the agent statement, searched, filtered and paged', () => {
  it('shows the newest 100 lines, and Show older puts page 2 below page 1', async () => {
    fakeLens()
    renderStatement()
    await screen.findByTestId('agent-statement')
    expect(shown()).toHaveLength(100)
    expect(asked[0].get('from')).toBe('2026-10-01')
    expect(asked[0].get('limit')).toBe('100')

    fireEvent.click(screen.getByRole('button', { name: 'Show older lines' }))
    await waitFor(() => expect(shown()).toHaveLength(130))
    // Page 2 is asked for after page 1's last line, over the same period.
    expect(asked[1].get('cursor')).toBe('ent_31')
    expect(asked[1].get('to')).toBe(TO)
    // Every line once, in Lens's order: page 2 continues below page 1.
    const balances = shown().map((r) => within(r).getAllByRole('cell')[3].textContent)
    expect(balances).toEqual(all.map((l) => `${l.balance_after_ulxc / 1_000_000} LXC`))
    expect(screen.queryByRole('button', { name: 'Show older lines' })).toBeNull()
  })

  it('a filter by kind shows only lines of that kind', async () => {
    fakeLens()
    renderStatement()
    await screen.findByTestId('agent-statement')
    const card = (screen.getByRole('option', { name: 'Card' }) as HTMLOptionElement).value
    fireEvent.change(screen.getByRole('combobox', { name: 'Kind of line in Researcher’s statement' }), { target: { value: card } })
    await waitFor(() => expect(shown()).toHaveLength(13))
    expect(asked[asked.length - 1].get('kind')).toBe('card')
    expect(new Set(shown().map((r) => within(r).getByTestId('statement-what').textContent))).toEqual(new Set(['Card charge']))
  })

  it('a search is sent to Lens, and says so when nothing matches', async () => {
    fakeLens()
    renderStatement()
    await screen.findByTestId('agent-statement')
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search Researcher’s statement' }), { target: { value: 'nothing like it' } })
    expect(await screen.findByText('No line on this statement matches.')).toBeInTheDocument()
    expect(asked[asked.length - 1].get('q')).toBe('nothing like it')
  })
})

// B57.110 — the same search, kind filter, empty match and Show older lines on the Pocket statement B57.24 draws: Lens
// reads the month by model and day (group=day) and keeps the lines of those kinds holding q; while a search or a filter
// is on, the newest 100 come first and Show older lines puts the next 100 below them.

function renderPocketStatement() {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = new URL(String(input), 'http://app')
    const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'Content-Type': 'application/json' } })
    if (url.pathname === '/api/models' || url.pathname === '/api/lxc/topup-options') return json([])
    if (url.pathname !== '/api/agents/agt_1/statement') return new Response('null', { status: 404 })
    const q = url.searchParams
    asked.push(q)
    const kinds = q.get('kind')?.split(',') ?? []
    const words = (q.get('q') ?? '').toLowerCase()
    const kept = all.filter((l) => (kinds.length === 0 || kinds.includes(l.kind)) && (words === '' || l.kind.includes(words)))
    const start = q.has('cursor') ? kept.findIndex((l) => l.entry_id === q.get('cursor')) + 1 : 0
    const page = kept.slice(start, start + Number(q.get('limit')))
    const more = start + page.length < kept.length
    return json({ to: TO, group: 'day', time_zone: 'UTC', accounts: [], lines: page, ...(more ? { next_cursor: page[page.length - 1].entry_id } : {}) })
  })
  const agent = { id: 'agt_1', name: 'Researcher', balance_ulxc: 0, spent_ulxc: 0, keys: [], created_at: '2026-10-01T09:00:00Z' }
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <AppMoney>
          <AgentStatement agent={agent} nameOf={() => 'an agent'} />
        </AppMoney>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const docLines = () => within(screen.getByTestId('statement-lines')).getAllByRole('row').slice(1)
const kindBox = () => screen.getByRole('combobox', { name: 'Kind of line in Researcher’s statement' }) as HTMLSelectElement
const searchBox = () => screen.getByRole('searchbox', { name: 'Search Researcher’s statement' }) as HTMLInputElement

describe('the Pocket statement, searched, filtered and paged (B57.110)', () => {
  it('draws the search and the kind filter in Pocket’s fields on the statement, every kind B28.51 names', async () => {
    renderPocketStatement()
    await screen.findByTestId('statement-lines')
    const doc = screen.getByTestId('statement-doc')
    expect(doc.getAttribute(DESIGN_ATTR)).toBe('pocket')
    expect(doc.contains(searchBox()) && doc.contains(kindBox())).toBe(true)
    // Pocket's Input and Select: the 46-tall box with the 1.5px control edge, the same as every Pocket field.
    for (const field of [searchBox(), kindBox()]) expect(field.parentElement!.className).toMatch(/\bshadow-edge\b.*\brounded-control\b|\brounded-control\b.*\bshadow-edge\b/)
    expect([...kindBox().options].map((o) => o.text)).toEqual([
      'Every kind', 'Funded', 'Taken back', 'Top-ups', 'Requests', 'Platform fees', 'Payments', 'Transfers', 'Card', 'Escrow', 'Pots', 'Cash-outs', 'Credit line',
    ])
  })

  it('a filter by kind asks Lens for that kind by model and day, and shows only it', async () => {
    renderPocketStatement()
    await screen.findByTestId('statement-lines')
    fireEvent.change(kindBox(), { target: { value: (screen.getByRole('option', { name: 'Card' }) as HTMLOptionElement).value } })
    await waitFor(() => expect(docLines()).toHaveLength(13))
    const last = asked[asked.length - 1]
    expect([last.get('kind'), last.get('group')]).toEqual(['card', 'day'])
    expect(new Set(docLines().map((r) => within(r).getByTestId('statement-doc-what').textContent))).toEqual(new Set(['Card charge · Settled']))
  })

  it('a search is sent to Lens, and says so when nothing matches', async () => {
    renderPocketStatement()
    await screen.findByTestId('statement-lines')
    fireEvent.change(searchBox(), { target: { value: 'nothing like it' } })
    expect(await screen.findByText('No line on this statement matches.')).toBeInTheDocument()
    expect(asked[asked.length - 1].get('q')).toBe('nothing like it')
    expect(screen.queryByText('Nothing has moved in this wallet yet. Fund it under Money to start.')).toBeNull()
  })

  it('while searching, the newest 100 come first and Show older lines puts the next page below them', async () => {
    renderPocketStatement()
    await screen.findByTestId('statement-lines')
    expect(docLines()).toHaveLength(NEWEST_LINES)
    fireEvent.change(searchBox(), { target: { value: 'fund' } })
    await waitFor(() => expect(docLines()).toHaveLength(100))
    expect(asked[asked.length - 1].get('limit')).toBe('100')
    expect(screen.queryByRole('button', { name: 'Show all' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show older lines' }))
    await waitFor(() => expect(docLines()).toHaveLength(117))
    const fund = all.filter((l) => l.kind === 'fund')
    expect([asked[asked.length - 1].get('cursor'), asked[asked.length - 1].get('to')]).toEqual([fund[99].entry_id, TO])
    expect(screen.queryByRole('button', { name: 'Show older lines' })).toBeNull()
  })
})
