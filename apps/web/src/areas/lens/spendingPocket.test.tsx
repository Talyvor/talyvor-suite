import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'
import { inPocket } from '../../pocketPending'

// B57.89 — Spending, Budgets and Subscriptions in Pocket: tabs of Activity (B61.3), each page held to Pocket's rules,
// Spending opening on what was spent this month and the safe-to-spend figure large, a budget's bar tangerine from 80%,
// and Subscriptions soonest first with its next charge, a month and the reminder.

const DAY = 86_400_000
const iso = (ms: number) => new Date(ms).toISOString()

function mockBff(subscriptions: unknown[]) {
  const now = Date.now()
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    const path = url.split('?')[0]
    const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/agents')
      return json({ workspace_balance_ulxc: 0, allocated_ulxc: 0, unallocated_ulxc: 0, spent_ulxc: 0, agents: [{ id: 'agt_1', name: 'Researcher' }] })
    if (path === '/api/money/spending') {
      return json({
        from: '',
        to: '',
        categories: [],
        payments: [],
        totals: [{ currency: 'USD', total_minor: 4200, by_category: { travel: 3000, ai_software: 1200 } }],
      })
    }
    if (path === '/api/money/spending/unusual') return json({ findings: [] })
    if (url === '/api/money/coach') return json({ lines: [], review: [] })
    if (url === '/api/money/budgets') {
      return json({
        budgets: [
          {
            id: 'bdg_hot',
            agent_id: 'all',
            category: 'ai_software',
            period: 'month',
            amount_minor: 10_000,
            currency: 'USD',
            timezone: 'UTC',
            period_start: '2026-11-01T00:00:00Z',
            period_end: '2026-12-01T00:00:00Z',
            spent_minor: 8000,
            left_minor: 2000,
            percent: 80,
          },
          {
            id: 'bdg_cool',
            agent_id: '',
            category: 'travel',
            period: 'week',
            amount_minor: 10_000,
            currency: 'USD',
            timezone: 'UTC',
            period_start: '2026-11-16T00:00:00Z',
            period_end: '2026-11-23T00:00:00Z',
            spent_minor: 7900,
            left_minor: 2100,
            percent: 79,
          },
        ],
      })
    }
    if (url === '/api/money/budgets/alerts') return json({ alerts: [] })
    if (url === '/api/money/spending/subscriptions') return json({ subscriptions })
    if (url === '/api/agents/schedules') return json({ schedules: [] })
    if (url === '/api/money/payees') return json({ payees: [] })
    if (url === '/api/money/notices') return json({ settings: { timezone: 'UTC', quiet_from: '', quiet_until: '', off: [] }, notices: [] })
    if (url === '/api/money/plan') {
      return json({
        currency: 'USD',
        until: '2026-11-30',
        days: 15,
        money_now_minor: 90_000,
        upcoming_minor: 10_000,
        budgets_left_minor: 5_000,
        safe_per_day_minor: 5_000,
        pace_per_day_minor: 2_500,
        payments: [],
        findings: [],
      })
    }
    return new Response('null', { status: 404 })
  })
  return now
}

const subscription = (now: number) => ({
  merchant: 'Northwind Data',
  category: 'ai_software',
  amount_minor: 1800,
  currency: 'USD',
  interval: 'monthly',
  charges: 3,
  last_at: iso(now - 20 * DAY),
  next_at: iso(now + 10 * DAY),
  remind_on: iso(now + 7 * DAY),
  monthly_minor: 1800,
  yearly_minor: 21_600,
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  queryClient.clear()
})

describe('Spending, Budgets and Subscriptions in Pocket (B57.89)', () => {
  for (const [to, tab, mark] of [
    ['/money/spending', 'Spending', 'Spent this month'],
    ['/money/budgets', 'Budgets', 'Your budgets'],
    ['/money/subscriptions', 'Subscriptions', 'Soonest first'],
  ] as const) {
    it(`${tab} is a tab of Activity and is drawn in Pocket`, async () => {
      mockBff([])
      window.history.pushState({}, '', to)
      render(<App />)
      const row = await screen.findByRole('tablist', { name: 'Activity' })
      expect(
        within(row)
          .getAllByRole('tab')
          .map((t) => t.textContent),
      ).toEqual(['All', 'Spending', 'Budgets', 'Subscriptions', 'Statements'])
      expect(within(row).getByRole('tab', { selected: true }).textContent).toBe(tab)
      expect(inPocket(await screen.findByText(mark))).toBe(true)
    })
  }

  it('Spending opens on the month’s spend and what is safe to spend, large', async () => {
    mockBff([])
    window.history.pushState({}, '', '/money/spending')
    render(<App />)
    const spent = await screen.findByTestId('spending-spent')
    expect(spent.textContent).toContain('Spent this month')
    await waitFor(() => expect(spent.querySelector('[data-money]')?.textContent).toBe('$42.00'))
    const safe = await screen.findByTestId('plan-safe-per-day')
    expect(safe.querySelector('[data-money] .text-pocket-balance')?.textContent).toBe('$50.00')
    expect(safe.textContent).toBe('$50.00 a day until 30 Nov, the month’s end')
    for (const heading of [
      'Until payday',
      'This week, from Monday',
      'This month’s payments',
      'Your budgets',
      'What was unusual this month',
      'What you pay again and again',
      'When you hear from us',
    ]) {
      expect(screen.getByRole('heading', { name: heading })).toBeTruthy()
    }
  })

  it('a budget’s bar turns tangerine from 80%, and not before', async () => {
    mockBff([])
    window.history.pushState({}, '', '/money/budgets')
    render(<App />)
    const hot = await screen.findByTestId('budget-bdg_hot')
    const cool = screen.getByTestId('budget-bdg_cool')
    expect(
      within(hot)
        .getByRole('img', { name: /budget used/ })
        .querySelector('.bg-tangerine'),
    ).not.toBeNull()
    expect(
      within(cool)
        .getByRole('img', { name: /budget used/ })
        .querySelector('.bg-tangerine'),
    ).toBeNull()
    expect(within(hot).getByTestId('budget-percent-bdg_hot').textContent).toBe('80%')
    expect(within(hot).getByRole('button', { name: 'Remove the AI and software · Every wallet budget' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Set or change a budget' })).toBeTruthy()
  })

  it('Subscriptions lists each with whose it is, its next charge, a month and the reminder, and says when there is none', async () => {
    const now = mockBff([])
    window.history.pushState({}, '', '/money/subscriptions')
    const { unmount } = render(<App />)
    expect(await screen.findByText(/Nothing renews yet/)).toBeTruthy()
    unmount()
    queryClient.clear()
    vi.restoreAllMocks()

    mockBff([subscription(now)])
    render(<App />)
    const row = await screen.findByTestId('subscription-sub-own-Northwind Data-USD')
    expect(row.textContent).toContain('Northwind Data')
    expect(row.textContent).toContain('Card or payment · Your own wallet')
    expect(row.textContent).toContain('$18.00')
    expect(row.textContent).toContain('Next charge')
    expect(row.textContent).toContain('$18.00 a month')
    expect(row.textContent).toContain('Reminder')
  })
})
