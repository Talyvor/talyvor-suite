import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'
import { isPlanQuestion } from '../chat/PlanQuestion'

// B53.16 — /money/spending opens with the month plan from Lens: safe to spend per day until payday, the payments due with
// whether each is covered, the payday, and a "rent short" finding with the Coach's sentence and its adjustments (moving money
// out of a budget sends the lowered budget); Chat answers "how much can I spend today?" from the same plan, never the model.
// That the figures equal Lens's own is proven against Lens by the e2e scenario month-plan.

const SENTENCE = 'At this pace, £28.57 a day, the £700.00 payment to Landlord on 14 November is short by £215.70; keeping to £7.00 a day until then covers it.'
const RENT = { source: 'bill', id: 'bill_rent', payee: 'Landlord', amount_minor: 70_000, currency: 'GBP', due: '2026-11-14', covered: true }
const PLAN = {
  currency: 'GBP', timezone: 'UTC', today: '2026-11-04', until: '2026-11-28', next_income: '2026-11-29', days: 25,
  income: { payday: 29, amount_minor: 250_000, currency: 'GBP', payer: '', confirmed: true }, money_now_minor: 80_000, upcoming_minor: 73_000,
  budgets_left_minor: 10_000, available_minor: -3000, safe_per_day_minor: 0, pace_per_day_minor: 2857,
  payments: [{ source: 'bill', id: 'bill_phone', payee: 'Phone Co', amount_minor: 3000, currency: 'GBP', due: '2026-11-09', covered: true }, RENT],
  findings: [{ kind: 'plan_pace_short', urgent: true, payment: RENT, short_minor: 21_570, pace_per_day_minor: 2857, keep_to_per_day_minor: 700, sentence: SENTENCE }],
}

function mockBff(puts: { url: string; body: unknown }[]) {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'Content-Type': 'application/json' } })
    if (init?.method === 'PUT') {
      puts.push({ url, body: JSON.parse(String(init.body)) })
      return json(url === '/api/money/plan/income' ? PLAN : JSON.parse(String(init.body)))
    }
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/models') {
      return json([{ id: 'claude-opus-5', provider: 'anthropic', display_name: 'Claude Opus 5', input_per_1m: 5, output_per_1m: 25, tier: 'frontier', release_date: '2026-06-01' }])
    }
    if (url === '/api/ai/providers') return json({ unconfigured: [] })
    if (url === '/api/agents/approvals') return json({ approvals: [] })
    if (url === '/api/agents') return json({ workspace_balance_ulxc: 0, allocated_ulxc: 0, unallocated_ulxc: 0, spent_ulxc: 0, agents: [] })
    if (url === '/api/money/plan') return json(PLAN)
    if (url === '/api/money/budgets') {
      return json({ budgets: [{ id: 'bdg_1', agent_id: 'all', category: 'eating_out', period: 'month', amount_minor: 10_000, currency: 'GBP', timezone: 'UTC',
        period_start: '2026-11-01T00:00:00Z', period_end: '2026-12-01T00:00:00Z', spent_minor: 0, left_minor: 10_000, percent: 0 }] })
    }
    return new Response('null', { status: 404 })
  })
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  queryClient.clear()
})

describe('Month plan (B53.16)', () => {
  it('shows safe to spend per day, the payments due, the rent-short finding and its adjustments, and sets the payday', async () => {
    const puts: { url: string; body: unknown }[] = []
    mockBff(puts)
    window.history.pushState({}, '', '/money/spending')
    render(<App />)

    expect((await screen.findByTestId('plan-safe-per-day')).textContent).toBe('£0.00 a day until payday, 29 Nov')
    expect((await screen.findByTestId('plan-payment-bill-bill_rent')).textContent).toContain('£700.00')
    const finding = await screen.findByTestId('plan-finding-plan_pace_short')
    expect(within(finding).getByTestId('plan-sentence').textContent).toBe(SENTENCE)
    expect(within(finding).getByTestId('plan-adjust-keep-to').textContent).toBe('Spend at most £7.00 a day until 14 Nov.')

    const move = within(finding).getByTestId('plan-adjust-budget-bdg_1')
    expect(move.textContent).toContain('Move £100.00 out of the eating out budget.')
    fireEvent.click(within(move).getByRole('button', { name: 'Move it' }))
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([u, init]) => String(u) === '/api/money/budgets/bdg_1' && init?.method === 'DELETE')).toBe(true))

    fireEvent.change(screen.getByLabelText('Payday, day of the month'), { target: { value: '28' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save payday' }))
    await waitFor(() => expect(puts[0]).toEqual({ url: '/api/money/plan/income', body: { payday: 28, amount_minor: 250_000, currency: 'GBP', payer: '' } }))
  })

  it('answers "how much can I spend today?" in Chat from the plan, never the model', async () => {
    mockBff([])
    window.history.pushState({}, '', '/chat')
    render(<App />)
    const box = await screen.findByRole('textbox', { name: /message/i })
    await waitFor(() => expect(box).not.toBeDisabled())
    fireEvent.change(box, { target: { value: 'How much can I spend today?' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    const card = await screen.findByTestId('chat-plan')
    expect((await within(card).findByTestId('chat-plan-answer')).textContent).toBe('You can spend £0.00 today, and each day until payday on 29 Nov.')
    expect(within(card).getByTestId('chat-plan-off').textContent).toBe(SENTENCE)
    expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'POST').map(([u]) => String(u))).toEqual([])
    expect(isPlanQuestion('What’s safe to spend today?')).toBe(true)
    expect(isPlanQuestion('How much can Researcher spend?')).toBe(false)
  })
})
