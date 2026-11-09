import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentAnalytics } from './AgentAnalytics'
import { AppMoney } from './money'
import type { SpendAnalytics } from './agentBankApi'

// B28.53 — the DONE line: the buckets sum to the agent's total out on the statement. Lens's analytics (B28.326) for
// the same period as the statement; by day, by model and by destination, each adds up to the Out the card shows.

const analytics: SpendAnalytics = {
  agent_id: 'agt_1',
  time_zone: 'Europe/London',
  out_ulxc: 54_010,
  returned_ulxc: 200,
  spent_ulxc: 53_810,
  buckets: [
    { day: '2026-11-07', model: '', destination: 'agent:agt_2', out_ulxc: 50_000, returned_ulxc: 0, spent_ulxc: 50_000, postings: 1 },
    { day: '2026-11-07', model: 'claude-sonnet-5', destination: 'held', out_ulxc: 2_000, returned_ulxc: 200, spent_ulxc: 1_800, postings: 4 },
    { day: '2026-11-07', model: 'claude-sonnet-5', destination: 'spend', out_ulxc: 10, returned_ulxc: 0, spent_ulxc: 10, postings: 2 },
    { day: '2026-11-08', model: '', destination: 'spend', out_ulxc: 2_000, returned_ulxc: 0, spent_ulxc: 2_000, postings: 1 },
  ],
}

const asked: URLSearchParams[] = []

function fakeLens() {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = new URL(String(input), 'http://app')
    if (url.pathname !== '/api/agents/agt_1/analytics') return new Response('null', { status: 404 })
    asked.push(url.searchParams)
    return new Response(JSON.stringify(analytics), { status: 200, headers: { 'Content-Type': 'application/json' } })
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

/** "0.05401 LXC", or with the person's currency beside it, as the card draws a figure → µLXC. */
const ulxc = (text: string) => Math.round(Number(/([\d,.]+)\s*LXC/.exec(text)?.[1]?.replace(/,/g, '') ?? 'NaN') * 1e6)

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  asked.length = 0
})

describe('per-agent analytics', () => {
  it('adds up to the period’s out by day, by model and by destination, each in words', async () => {
    fakeLens()
    renderCard()
    const out = ulxc((await screen.findByTestId('agent-analytics-out')).textContent ?? '')
    expect(out).toBe(analytics.out_ulxc)
    for (const view of ['day', 'model', 'destination']) {
      const figures = within(screen.getByTestId(`agent-analytics-${view}`)).getAllByTestId(`agent-analytics-${view}-out`)
      expect(figures.reduce((s, f) => s + ulxc(f.textContent ?? ''), 0)).toBe(out)
    }
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
    fireEvent.change(screen.getByRole('combobox', { name: 'Period of Researcher’s spend' }), { target: { value: '7' } })
    await waitFor(() => expect(asked).toHaveLength(2))
    expect(asked[1].get('from')).toBe(day(6))
    expect(asked[1].has('to')).toBe(false)
  })
})
