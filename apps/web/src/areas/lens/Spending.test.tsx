import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'
import { parseSpend } from '../chat/SpendQuestion'

// B53.8 — /money/spending shows the month by category from Lens's totals, the budget with what is left, the unusual payment
// with the Coach's sentence on it, and correcting a payment's category sends its merchant; Chat answers "how much did I
// spend on eating out this month?" from the same totals, every wallet together. That the figures equal Lens's own is
// proven against Lens by the e2e scenario spending-screen.

function mockBff(puts: { url: string; body: unknown }[], coachAnswers: Promise<void> = Promise.resolve(), notices: unknown[] = []) {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const path = url.split('?')[0]
    const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'Content-Type': 'application/json' } })
    if (init?.method === 'PUT') {
      puts.push({ url, body: JSON.parse(String(init.body)) })
      return json(JSON.parse(String(init.body)))
    }
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/models') {
      return json([{ id: 'claude-opus-5', provider: 'anthropic', display_name: 'Claude Opus 5', input_per_1m: 5, output_per_1m: 25, tier: 'frontier', release_date: '2026-06-01' }])
    }
    if (url === '/api/ai/providers') return json({ unconfigured: [] })
    if (url === '/api/agents/approvals') return json({ approvals: [] })
    if (url === '/api/agents') return json({ workspace_balance_ulxc: 0, allocated_ulxc: 0, unallocated_ulxc: 0, spent_ulxc: 0, agents: [{ id: 'agt_1', name: 'Researcher' }] })
    if (path === '/api/money/spending') {
      return json({ from: '', to: '', categories: [], payments: [
        { entry_id: 'ent_1', kind: 'payment_out', merchant: 'Bistro', amount_minor: 2500, currency: 'GBP', category: 'other', category_source: 'none', created_at: '2026-11-03T12:00:00Z' },
      ], totals: [
        { currency: 'GBP', total_minor: 2500, by_category: { eating_out: 2500 } },
        { agent_id: 'agt_1', currency: 'GBP', total_minor: 1250, by_category: { eating_out: 1000, ai_software: 250 } },
      ] })
    }
    if (path === '/api/money/spending/unusual') {
      return json({ findings: [{ rule: 'new_merchant', entry_id: 'ent_1', merchant: 'Bistro', amount_minor: 2500, currency: 'GBP', at: '2026-11-03T12:00:00Z' }] })
    }
    if (url === '/api/money/coach') {
      await coachAnswers
      return json({ lines: [{ fact: { kind: 'new_merchant', merchant: 'Bistro', amount: '£25.00' }, sentence: 'You paid Bistro £25.00, somewhere new for you.', source: 'template' }], review: [] })
    }
    if (url === '/api/money/budgets') {
      return json({ budgets: [{ id: 'bdg_1', agent_id: 'all', category: 'eating_out', period: 'month', amount_minor: 10_000, currency: 'GBP', timezone: 'UTC',
        period_start: '2026-11-01T00:00:00Z', period_end: '2026-12-01T00:00:00Z', spent_minor: 3500, left_minor: 6500, percent: 35 }] })
    }
    if (url === '/api/money/spending/subscriptions') return json({ subscriptions: [] })
    if (url === '/api/money/notices') return json({ settings: { timezone: 'UTC', quiet_from: '', quiet_until: '', off: [] }, notices })
    return new Response('null', { status: 404 })
  })
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  queryClient.clear()
})

describe('Spending (B53.8)', () => {
  it('shows the month by category, the budget left and the Coach’s sentence, and corrects a category by its merchant', async () => {
    const puts: { url: string; body: unknown }[] = []
    mockBff(puts)
    window.history.pushState({}, '', '/money/spending')
    render(<App />)

    expect((await screen.findByTestId('spending-month-eating_out')).textContent).toContain('£35.00')
    expect((await screen.findByTestId('spending-budget-bdg_1')).textContent).toContain('£35.00 of £100.00 this month · £65.00 left')
    expect((await screen.findByTestId('spending-unusual-ent_1')).textContent).toContain('You paid Bistro £25.00, somewhere new for you.')

    fireEvent.change(await screen.findByLabelText('Category of Bistro'), { target: { value: 'eating_out' } })
    await waitFor(() => expect(puts).toEqual([{ url: '/api/money/spending/merchants', body: { merchant: 'Bistro', category: 'eating_out' } }]))

    fireEvent.click(await screen.findByLabelText('The Coach’s daily tip'))
    fireEvent.change(screen.getByLabelText('Quiet from'), { target: { value: '22:00' } })
    fireEvent.change(screen.getByLabelText('Quiet until'), { target: { value: '07:00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save notice settings' }))
    await waitFor(() => expect(puts[1]).toEqual({ url: '/api/money/notices/settings', body: { timezone: 'UTC', quiet_from: '22:00', quiet_until: '07:00', off: ['tip'] } }))
  })

  it('shows an unusual payment only once the Coach has answered, so its row never reads without the sentence (B17.349)', async () => {
    let answer = () => {}
    mockBff([], new Promise<void>((r) => (answer = r)))
    window.history.pushState({}, '', '/money/spending')
    render(<App />)

    await screen.findByTestId('spending-budget-bdg_1')
    expect(screen.queryByTestId('spending-unusual-ent_1')).toBeNull()
    answer()
    expect((await screen.findByTestId('spending-unusual-ent_1')).textContent).toContain('You paid Bistro £25.00, somewhere new for you.')
  })

  it('a push for a payment notice opens Spending on that notice (B55.43)', async () => {
    const scrolled: string[] = []
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this.id)
    }
    mockBff([], Promise.resolve(), [
      { id: 'ntc_4', kind: 'payment', title: 'You paid Bistro £25.00', body: 'Researcher paid it.', status: 'sent', created_at: '2026-11-03T12:00:00Z' },
    ])
    window.history.pushState({}, '', '/money/spending#notice-ntc_4')
    render(<App />)

    expect((await screen.findByText('You paid Bistro £25.00')).closest('#notice-ntc_4')).not.toBeNull()
    await waitFor(() => expect(scrolled).toContain('notice-ntc_4'))
  })

  it('answers a category total in Chat from Lens’s totals, never the model', async () => {
    mockBff([])
    window.history.pushState({}, '', '/chat')
    render(<App />)
    const box = await screen.findByRole('textbox', { name: /message/i })
    await waitFor(() => expect(box).not.toBeDisabled())
    fireEvent.change(box, { target: { value: 'How much did I spend on eating out this month?' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    const card = await screen.findByTestId('chat-spend')
    expect((await within(card).findByTestId('chat-spend-answer')).textContent).toBe('You spent £35.00 on eating out this month.')
    expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'POST').map(([u]) => String(u))).toEqual([])
  })

  it('reads the category and period a question asks about', () => {
    expect(parseSpend('how much have we spent on restaurants this week?')).toEqual({ category: 'eating_out', said: 'restaurants', period: 'week' })
    expect(parseSpend('How much did I spend on Groceries')).toEqual({ category: 'groceries', said: 'groceries', period: 'month' })
    expect(parseSpend('how much did I spend on yachts?')?.category).toBe('')
    expect(parseSpend('How much can Researcher spend?')).toBeNull()
  })
})
