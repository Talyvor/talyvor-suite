import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentAnalytics } from './AgentAnalytics'
import { AppMoney } from './money'
import type { SpendAnalytics } from './agentBankApi'

// B28.53 — the DONE line: the buckets sum to the agent's total out on the statement. Lens's analytics (B28.326) for
// the same period as the statement; by day, by model and by destination, each adds up to the Out the card shows.

// B61.14 — the card reads in dollars alone, at Lens's peg of $0.10 a LXC: every bucket here is a whole number of cents
// (100,000 µLXC is $0.01), so the dollars the card draws add up exactly.
const PEG = 0.1
const analytics: SpendAnalytics = {
  agent_id: 'agt_1',
  time_zone: 'Europe/London',
  out_ulxc: 540_100_000,
  returned_ulxc: 2_000_000,
  spent_ulxc: 538_100_000,
  buckets: [
    { day: '2026-11-07', model: '', destination: 'agent:agt_2', out_ulxc: 500_000_000, returned_ulxc: 0, spent_ulxc: 500_000_000, postings: 1 },
    { day: '2026-11-07', model: 'claude-sonnet-5', destination: 'held', out_ulxc: 20_000_000, returned_ulxc: 2_000_000, spent_ulxc: 18_000_000, postings: 4 },
    { day: '2026-11-07', model: 'claude-sonnet-5', destination: 'spend', out_ulxc: 100_000, returned_ulxc: 0, spent_ulxc: 100_000, postings: 2 },
    { day: '2026-11-08', model: '', destination: 'spend', out_ulxc: 20_000_000, returned_ulxc: 0, spent_ulxc: 20_000_000, postings: 1 },
  ],
}

const asked: URLSearchParams[] = []

function fakeLens(answer: SpendAnalytics = analytics) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = new URL(String(input), 'http://app')
    if (url.pathname === '/api/lxc/topup-options') return Response.json({ allowed_usd_cents: [1000], billing_enabled: true, usd_per_lxc: PEG })
    if (url.pathname !== '/api/agents/agt_1/analytics') return new Response('null', { status: 404 })
    asked.push(url.searchParams)
    return new Response(JSON.stringify(answer), { status: 200, headers: { 'Content-Type': 'application/json' } })
  })
}

function renderCard() {
  const agent = { id: 'agt_1', name: 'Researcher', balance_ulxc: 0, spent_ulxc: 0, keys: [], created_at: '2026-10-01T09:00:00Z' }
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AppMoney>
        <AgentAnalytics agent={agent} nameOf={(id) => (id === 'agt_2' ? 'Writer' : 'an agent')} />
      </AppMoney>
    </QueryClientProvider>,
  )
}

/** "$54.01", as the card draws a figure → cents. */
const cents = (text: string) => Math.round(Number(/\$([\d,]+\.\d{2})/.exec(text)?.[1]?.replace(/,/g, '') ?? 'NaN') * 100)

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  asked.length = 0
})

describe('per-agent analytics', () => {
  it('adds up to the period’s out by day, by model and by destination, each in words', async () => {
    fakeLens()
    renderCard()
    await waitFor(() => expect(screen.getByTestId('agent-analytics-out')).toHaveTextContent('$54.01'))
    const out = cents(screen.getByTestId('agent-analytics-out').textContent ?? '')
    expect(out).toBe(Math.round((analytics.out_ulxc / 1e6) * PEG * 100))
    for (const view of ['day', 'model', 'destination']) {
      const figures = within(screen.getByTestId(`agent-analytics-${view}`)).getAllByTestId(`agent-analytics-${view}-out`)
      expect(figures.reduce((s, f) => s + cents(f.textContent ?? ''), 0)).toBe(out)
    }
    expect(screen.getByTestId('agent-analytics').textContent).not.toMatch(/LXC/)
    const labels = (view: string) =>
      within(screen.getByTestId(`agent-analytics-${view}`)).getAllByTestId(`agent-analytics-${view}-row`).map((r) => r.textContent ?? '')
    expect(labels('day')).toHaveLength(2)
    expect(labels('model')).toHaveLength(2)
    expect(labels('model')[0]).toMatch(/^Not a request/)
    expect(labels('model')[1]).toMatch(/^claude-sonnet-5/)
    expect(labels('destination')[0]).toContain('Writer')
    expect(labels('destination').join(' ')).toContain('Held for requests')
    expect(labels('destination').join(' ')).not.toContain('agent:')
  })

  it('reads the period chosen, from today back', async () => {
    fakeLens()
    renderCard()
    await screen.findByTestId('agent-analytics-out')
    const day = (back: number) => new Date(Date.now() - back * 86_400_000).toISOString().slice(0, 10)
    expect(asked[0].get('from')).toBe(day(29))
    const periods = screen.getByRole('tablist', { name: 'Period of Researcher’s spend' })
    expect(within(periods).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Last 7 days', 'Last 30 days', 'Last 90 days'])
    expect(within(periods).getByRole('tab', { name: 'Last 30 days' })).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(within(periods).getByRole('tab', { name: 'Last 7 days' }))
    await waitFor(() => expect(asked).toHaveLength(2))
    expect(asked[1].get('from')).toBe(day(6))
    expect(asked[1].has('to')).toBe(false)
  })

  // B57.111 — in Pocket's components: a white card, each view under its eyebrow, each row a Pocket row with its share as a
  // Pocket bar, every figure a Pocket figure.
  it('is drawn in Pocket’s components', async () => {
    fakeLens()
    renderCard()
    await screen.findByTestId('agent-analytics-out')
    const card = screen.getByTestId('agent-analytics')
    expect(card).toHaveAttribute('data-design', 'pocket')
    expect(card).toHaveClass('bg-page', 'shadow-pocket')
    expect(within(card).getByRole('heading', { level: 2, name: 'Spend by day, model and destination' })).toBeInTheDocument()
    for (const [view, title] of [['day', 'By day'], ['model', 'By model'], ['destination', 'By destination']]) {
      const part = screen.getByTestId(`agent-analytics-${view}`)
      expect(part.firstElementChild).toHaveTextContent(title)
      expect(part.firstElementChild).toHaveClass('text-pocket-eyebrow')
      for (const row of within(part).getAllByTestId(`agent-analytics-${view}-row`)) {
        expect(within(row).getByRole('img', { name: /% of the period’s out$/ })).toBeInTheDocument()
        expect(row.querySelector('[data-money]')).not.toBeNull()
      }
    }
    expect(within(screen.getByTestId('agent-analytics-destination')).getByRole('img', { name: 'Writer: 93% of the period’s out' })).toBeInTheDocument()
    expect(card.querySelector('select')).toBeNull()
  })

  it('says so when nothing left the wallet in the period', async () => {
    fakeLens({ agent_id: 'agt_1', time_zone: 'Europe/London', out_ulxc: 0, returned_ulxc: 0, spent_ulxc: 0, buckets: [] })
    renderCard()
    expect(await screen.findByTestId('agent-analytics-none')).toHaveTextContent(
      'Nothing left this wallet in the period. Choose a longer period above, or fund the agent under Money to start it spending.',
    )
    expect(screen.queryByTestId('agent-analytics-out')).toBeNull()
    expect(screen.getByRole('tablist', { name: 'Period of Researcher’s spend' })).toBeInTheDocument()
  })
})
