import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B41.20 — /money/subscriptions: a listing rented monthly, a standing order and a card subscription Lens found (B41.120), each
// with its next charge, its monthly cost and its reminder three days before; one due within three days says so.

const DAY = 86_400_000
const iso = (ms: number) => new Date(ms).toISOString()
const day = (ms: number) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

function mockBff(now: number) {
  const agent = { id: 'agt_1', name: 'Researcher', balance_ulxc: 0, spent_ulxc: 0, keys: [], created_at: '2026-08-01T09:00:00Z', owner_user_id: 'ws_1', verified: true }
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/agents') return json({ workspace_balance_ulxc: 0, allocated_ulxc: 0, unallocated_ulxc: 0, spent_ulxc: 0, agents: [agent] })
    if (url === '/api/money/payees') return json({ payees: [{ id: 'pye_1', name: 'Office Rent Ltd', country: 'GB' }] })
    if (url === '/api/agents/schedules') {
      return json({ schedules: [{ id: 'sch_1', from_agent_id: 'agt_1', to_agent_id: '', to_payee_id: 'pye_1', amount_minor: 1000, currency: 'GBP',
        amount_ulxc: 0, every: 'week', next_run_at: iso(now + 2 * DAY), active: true, created_at: '2026-10-01T09:00:00Z' }] })
    }
    if (url === '/api/marketplace/licences') {
      return json({ licences: [{ id: 'lic_1', listing_id: 'lst_1', title: 'Market brief', offer_id: 'off_1', licence: 'commercial', terms: '', kind: 'rent',
        pinned_version: null, starts_at: iso(now - 10 * DAY), ends_at: iso(now + 20 * DAY), auto_renew: true, status: 'active', uses_covered: 0,
        rent_paid_usd_micros: 0, source: 'offer', created_at: iso(now - 10 * DAY), price_ulxc: 50_000_000 }] })
    }
    if (url === '/api/marketplace/listings/lst_1') {
      return json({ id: 'lst_1', title: 'Market brief', price_per_use_ulxc: 0, offers: [{ id: 'off_1', kind: 'rent', licence: 'commercial', price_usd_micros: 5_000_000, period_days: 30 }] })
    }
    if (url === '/api/money/spending/subscriptions') {
      return json({ subscriptions: [{ merchant: 'Acme Cloud', category: 'ai_and_software', amount_minor: 1200, currency: 'GBP', interval: 'monthly', charges: 3,
        last_at: iso(now - 20 * DAY), next_at: iso(now + 10 * DAY), remind_on: iso(now + 7 * DAY), monthly_minor: 1200, yearly_minor: 14_400 }] })
    }
    return new Response('null', { status: 404 })
  })
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  queryClient.clear()
})

describe('the subscriptions view (B41.20)', () => {
  it('shows a standing order, a monthly rental and a card subscription with next charge, monthly cost and reminder', async () => {
    const now = Date.now()
    mockBff(now)
    window.history.pushState({}, '', '/money/subscriptions')
    render(<App />)

    const rental = await screen.findByTestId('subscription-lic-lic_1')
    expect(rental.textContent).toContain('Market brief')
    expect(rental.textContent).toContain('$5.00 monthly')
    expect(rental.textContent).toContain(`Next charge ${day(now + 20 * DAY)}`)
    expect(rental.textContent).toContain('$5.00 a month')
    expect(rental.textContent).toContain(`Reminder ${day(now + 17 * DAY)}`)

    const order = screen.getByTestId('subscription-so-sch_1')
    expect(order.textContent).toContain('Office Rent Ltd')
    expect(order.textContent).toContain('Standing order · Researcher · £10.00 weekly')
    expect(order.textContent).toContain('£43.33 a month')
    expect(order.textContent).toContain(`Reminder ${day(now - 1 * DAY)}`)
    expect(order.textContent).toContain('Renews in 2 days')

    const card = screen.getByTestId('subscription-sub-own-Acme Cloud-GBP')
    expect(card.textContent).toContain('Card or payment · Your own wallet · £12.00 monthly')
    expect(card.textContent).toContain('£12.00 a month')
    expect(card.textContent).not.toContain('Renews in')

    expect(screen.getByTestId('subscriptions-count').textContent).toBe('3 renew, 1 in the next 3 days')
  })
})
