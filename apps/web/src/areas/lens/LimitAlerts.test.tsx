import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B28.62 — limit-approach alerts on the Agent Bank: each alert Lens raised at 50, 80 or 100% of a budget, a card's cap or an
// agent's limit (Lens B28.335) reads as what it is about and the amounts, from GET /api/money/budgets/alerts.

function mockBff(alerts: unknown[], withAgent = true) {
  const agent = { id: 'agt_1', name: 'Researcher', balance_ulxc: 5_000_000, spent_ulxc: 0, keys: [], created_at: '2026-08-01T09:00:00Z', owner_user_id: 'ws_1', verified: true }
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/agents') return json({ workspace_balance_ulxc: 20_000_000, allocated_ulxc: 5_000_000, unallocated_ulxc: 15_000_000, spent_ulxc: 0, agents: withAgent ? [agent] : [] })
    if (url === '/api/money/budgets/alerts') return json({ alerts })
    // Lens's peg, 1 LXC = $0.10, so an agent's limit reads in dollars first.
    if (url === '/api/lxc/topup-options') return json({ allowed_usd_cents: [1000], billing_enabled: true, usd_per_lxc: 0.1 })
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
      { id: 'sal_1', kind: 'budget', subject: 'bdg_1', category: 'ai_software', period: 'month', period_start: '2026-11-01T00:00:00Z', percent: 80,
        spent_minor: 800, limit_minor: 1000, currency: 'GBP', created_at: '2026-11-04T09:00:00Z' },
    ])
    window.history.pushState({}, '', '/agents/agt_1')
    render(<App />)

    const budget = await screen.findByTestId('limit-alert-sal_1')
    expect(budget.textContent).toContain('80% of your own monthly AI and software budget')
    expect(budget.textContent).toContain('£8.00 of £10.00 spent')
    expect(budget.textContent).toContain('Nearing')
    const limit = screen.getByTestId('limit-alert-sal_2')
    expect(limit.textContent).toContain('100% of Researcher’s daily limit')
    expect(limit.textContent).toContain('Reached')
  })

  it('says when no limit has been reached', async () => {
    mockBff([])
    window.history.pushState({}, '', '/agents/agt_1')
    render(<App />)
    expect(await screen.findByText(/No limit reached yet/)).toBeTruthy()
  })

  // B17.364 — a budget on a company account raises alerts before any agent exists: they still show, named in words.
  it('shows an alert before the first agent exists', async () => {
    mockBff(
      [{ id: 'sal_3', kind: 'budget', subject: 'bdg_2', agent_id: 'all', category: 'ai_software', period: 'month', period_start: '2026-11-01T00:00:00Z',
        percent: 80, spent_minor: 8500, limit_minor: 10000, currency: 'GBP', created_at: '2026-11-07T01:00:00Z' }],
      false,
    )
    window.history.pushState({}, '', '/agents/agt_1')
    render(<App />)
    const alert = await screen.findByTestId('limit-alert-sal_3')
    expect(alert.textContent).toContain('80% of every wallet’s monthly AI and software budget')
    expect(alert.textContent).toContain('£85.00 of £100.00 spent')
  })
})

// B57.90 — the Limit alerts card on /agents, as Pocket's w-agents draws it: what each alert is about in words, dollars first
// with LXC beside them for an agent's limit, when, the chip Nearing or Reached, and a link to Budgets.
describe('the Limit alerts card on Agents (B57.90)', () => {
  it('reads each alert in words, dollars first with LXC beside them, and links to Budgets', async () => {
    mockBff([
      { id: 'sal_4', kind: 'agent_limit', subject: 'agt_1', agent_id: 'agt_1', period: 'monthly', period_start: '2026-10-01T00:00:00Z', percent: 50,
        spent_minor: 10_120_000_000, limit_minor: 20_000_000_000, currency: 'LXC', created_at: '2026-10-16T11:40:00Z' },
      { id: 'sal_5', kind: 'budget', subject: 'bdg_3', agent_id: 'all', category: 'bills', period: 'month', period_start: '2026-10-01T00:00:00Z', percent: 80,
        spent_minor: 90_000, limit_minor: 100_000, currency: 'USD', created_at: '2026-10-22T10:31:00Z' },
      { id: 'sal_6', kind: 'budget', subject: 'bdg_4', category: 'ai_software', period: 'week', period_start: '2026-10-19T00:00:00Z', percent: 100,
        spent_minor: 5_000, limit_minor: 5_000, currency: 'USD', created_at: '2026-10-21T08:00:00Z' },
      { id: 'sal_7', kind: 'card', subject: 'card_1', agent_id: 'agt_1', period_start: '2026-10-01T00:00:00Z', percent: 80,
        spent_minor: 8_000, limit_minor: 10_000, currency: 'USD', created_at: '2026-10-20T08:00:00Z' },
    ])
    window.history.pushState({}, '', '/agents')
    render(<App />)

    const card = await screen.findByTestId('agents-limit-alerts')
    const limit = await within(card).findByTestId('limit-alert-sal_4')
    expect(limit.textContent).toContain('50% of Researcher’s monthly limit')
    await waitFor(() => expect(limit.textContent).toContain('$1,012.00 of $2,000.00 (10,120 of 20,000 LXC) spent'))
    expect(within(limit).getByText('Nearing')).toBeTruthy()

    const bills = within(card).getByTestId('limit-alert-sal_5')
    expect(bills.textContent).toContain('80% of every wallet’s monthly bills budget')
    expect(bills.textContent).toContain('$900.00 of $1,000.00 spent')
    expect(within(bills).getByText('Nearing')).toBeTruthy()

    const ai = within(card).getByTestId('limit-alert-sal_6')
    expect(ai.textContent).toContain('100% of your own weekly AI and software budget')
    expect(within(ai).getByText('Reached')).toBeTruthy()
    expect(within(card).getByTestId('limit-alert-sal_7').textContent).toContain('80% of Researcher’s card cap')

    // Never a category id, and never µLXC.
    expect(card.textContent).not.toMatch(/ai[_ ]software|ai_|µ|ulxc|10120000000/i)
    expect(within(card).getByRole('link', { name: 'Budgets' }).getAttribute('href')).toBe('/money/budgets')
  })

  it('says when an alert appears while none has been raised', async () => {
    mockBff([])
    window.history.pushState({}, '', '/agents')
    render(<App />)
    const card = await screen.findByTestId('agents-limit-alerts')
    expect(await within(card).findByText('No limit reached yet.')).toBeTruthy()
    expect(card.textContent).toContain(
      'An alert appears here when spending reaches 50, 80 or 100% of a budget, a card’s cap or an agent’s limit, once each period.',
    )
  })
})
