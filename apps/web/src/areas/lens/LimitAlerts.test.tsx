import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B28.62 — limit-approach alerts on the Agent Bank: each alert Lens raised at 50, 80 or 100% of a budget, a card's cap or an
// agent's limit (Lens B28.335) reads as what it is about and the amounts, from GET /api/money/budgets/alerts.

function mockBff(alerts: unknown[]) {
  const agent = { id: 'agt_1', name: 'Researcher', balance_ulxc: 5_000_000, spent_ulxc: 0, keys: [], created_at: '2026-08-01T09:00:00Z', owner_user_id: 'ws_1', verified: true }
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/agents') return json({ workspace_balance_ulxc: 20_000_000, allocated_ulxc: 5_000_000, unallocated_ulxc: 15_000_000, spent_ulxc: 0, agents: [agent] })
    if (url === '/api/money/budgets/alerts') return json({ alerts })
    if (url === '/api/agents/forecast') return json({ at: '', month_start: '', month_end: '', spent_ulxc: 0, forecast_ulxc: 0, agents: [] })
    if (url === '/api/agents/alerts') return json({ alerts: [], rule: 'the rule' })
    return new Response('null', { status: 404 })
  })
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  queryClient.clear()
})

describe('limit alerts on the Agent Bank (B28.62)', () => {
  it('shows each alert with what it is about and how much of the limit is spent', async () => {
    mockBff([
      { id: 'sal_2', kind: 'agent_limit', subject: 'agt_1', agent_id: 'agt_1', period: 'daily', period_start: '2026-11-04T00:00:00Z', percent: 100,
        spent_minor: 5_000_000, limit_minor: 5_000_000, currency: 'LXC', created_at: '2026-11-04T10:00:00Z' },
      { id: 'sal_1', kind: 'budget', subject: 'bdg_1', category: 'eating_out', period: 'month', period_start: '2026-11-01T00:00:00Z', percent: 80,
        spent_minor: 800, limit_minor: 1000, currency: 'GBP', created_at: '2026-11-04T09:00:00Z' },
    ])
    window.history.pushState({}, '', '/agents')
    render(<App />)

    const budget = await screen.findByTestId('limit-alert-sal_1')
    expect(budget.textContent).toContain('80% of your own monthly eating out budget')
    expect(budget.textContent).toContain('£8.00 of £10.00 spent')
    expect(budget.textContent).toContain('Nearing')
    const limit = screen.getByTestId('limit-alert-sal_2')
    expect(limit.textContent).toContain('100% of Researcher’s daily limit')
    expect(limit.textContent).toContain('Reached')
  })

  it('says when no limit has been reached', async () => {
    mockBff([])
    window.history.pushState({}, '', '/agents')
    render(<App />)
    expect(await screen.findByText(/No limit reached yet/)).toBeTruthy()
  })
})
