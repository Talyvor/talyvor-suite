import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B41.39 — /money/budgets: a £100 monthly AI and software budget across every wallet, £80.50 spent, shows its progress and
// the one alert Lens raised at 80% this period (last period's does not count); saving a budget sends only its fields.

function mockBff(puts: unknown[], refusals: string[] = []) {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/agents') return json({ workspace_balance_ulxc: 0, allocated_ulxc: 0, unallocated_ulxc: 0, spent_ulxc: 0, agents: [] })
    if (url === '/api/money/budgets' && init?.method === 'PUT') {
      puts.push(JSON.parse(String(init.body)))
      const refusal = refusals.shift()
      return refusal ? new Response(JSON.stringify({ error: refusal }), { status: 400 }) : json({})
    }
    if (url === '/api/money/budgets') {
      return json({ budgets: [{ id: 'bdg_1', agent_id: 'all', category: 'ai_software', period: 'month', amount_minor: 10_000, currency: 'GBP',
        timezone: 'Europe/London', period_start: '2026-11-01T00:00:00Z', period_end: '2026-12-01T00:00:00Z', spent_minor: 8050, left_minor: 1950, percent: 80 }] })
    }
    if (url === '/api/money/budgets/alerts') {
      return json({ alerts: [
        { id: 'sal_2', kind: 'budget', subject: 'bdg_1', agent_id: 'all', category: 'ai_software', period: 'month', period_start: '2026-11-01T00:00:00Z',
          percent: 80, spent_minor: 8050, limit_minor: 10_000, currency: 'GBP', created_at: '2026-11-04T09:00:00Z' },
        { id: 'sal_1', kind: 'budget', subject: 'bdg_1', agent_id: 'all', category: 'ai_software', period: 'month', period_start: '2026-10-01T00:00:00Z',
          percent: 100, spent_minor: 10_000, limit_minor: 10_000, currency: 'GBP', created_at: '2026-10-20T09:00:00Z' },
      ] })
    }
    return new Response('null', { status: 404 })
  })
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  queryClient.clear()
})

describe('budgets by category (B41.39)', () => {
  it('shows a category budget’s progress and this period’s alert, and saves a new one', async () => {
    const puts: unknown[] = []
    mockBff(puts)
    window.history.pushState({}, '', '/money/budgets')
    render(<App />)

    const row = await screen.findByTestId('budget-bdg_1')
    expect(row.textContent).toContain('AI and software · Every wallet')
    expect(row.textContent).toContain('£80.50 of £100.00 this month · £19.50 left')
    await waitFor(() => expect(row.textContent).toContain('Alerted at 80%'))
    expect(row.textContent).not.toContain('100%')
    expect(screen.getByRole('progressbar', { name: 'AI and software · Every wallet: budget used' }).getAttribute('aria-valuenow')).toBe('80')

    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'travel' } })
    fireEvent.change(screen.getByLabelText('Period'), { target: { value: 'week' } })
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '250' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save budget' }))
    await waitFor(() => expect(puts).toHaveLength(1))
    expect(puts[0]).toEqual({ agent_id: 'all', category: 'travel', period: 'week', amount_minor: 25_000, currency: 'GBP',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone })
  })

  // B55.42 — Lens's own sentence names its error prefix and every category id; the screen says what to do instead.
  it('says a refused budget in words, never Lens’s prefix or a category id', async () => {
    mockBff([], [
      'economy: spending: category must be empty (all spending) or one of ai_software, groceries, eating_out',
      'economy: spending: at most 100 budgets in a workspace',
      'economy: spending: period must be week or month',
    ])
    window.history.pushState({}, '', '/money/budgets')
    render(<App />)
    await screen.findByTestId('budget-bdg_1')
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '250' } })

    for (const said of ['Choose a category from the list.', 'A workspace can have at most 100 budgets.', 'Period must be week or month.']) {
      fireEvent.click(screen.getByRole('button', { name: 'Save budget' }))
      expect(await screen.findByText(said)).toBeTruthy()
    }
    expect(document.body.textContent).not.toMatch(/Spending:|_/)
  })

  // B55.57 — lens #1116 drops the prefix and starts with a capital; the screen says the same.
  it('says a refused budget in words when Lens starts its sentence with a capital', async () => {
    mockBff([], [
      'Category must be empty (all spending) or one of ai_software, groceries, eating_out',
      'At most 100 budgets in a workspace',
    ])
    window.history.pushState({}, '', '/money/budgets')
    render(<App />)
    await screen.findByTestId('budget-bdg_1')
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '250' } })

    for (const said of ['Choose a category from the list.', 'A workspace can have at most 100 budgets.']) {
      fireEvent.click(screen.getByRole('button', { name: 'Save budget' }))
      expect(await screen.findByText(said)).toBeTruthy()
    }
  })
})
