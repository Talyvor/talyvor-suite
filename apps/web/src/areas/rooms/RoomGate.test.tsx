import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B41.46 — the Gate tracker. The mock BFF plays Lens's B41.146: 3 unlinked people active in 6 of the last 8 weeks, and
// Shipped and Paid reading "needs a published build" until the room can publish one. Lens answers 409 to a threshold
// below the current one and saves a higher one; a workspace that is not synthetic gets 404 until room_equity is cleared.

const OWNER = 'ws_owner'

function mockBff() {
  const sent: string[] = []
  let t = { shipped_weeks: 8, used_people: 100, used_active_weeks: 6, used_window_weeks: 8, paid_usd_micros: 1_000_000_000, paid_payers: 10 }
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const json = (v: unknown, s = 200) => new Response(JSON.stringify(v), { status: s, headers: { 'Content-Type': 'application/json' } })
    const member = { workspace_id: OWNER, role: 'owner', may_spend: false, terms_version: 1, terms_current: true, joined_at: '' }
    if (url === '/auth/me') return json({ mode: 'oidc', authenticated: true, user: { sub: 'u1', email: 'u1@example.com' } })
    if (url === '/api/rooms') return json({ rooms: [], joined: [], invited: null })
    if (url === '/api/rooms/room_1') {
      return json({
        id: 'room_1', owner_workspace_id: OWNER, title: 'Agent pricing', topic: 'research', description: '', visibility: 'public',
        status: 'open', terms_version: 1, member_count: 1, created_at: '', last_activity_at: '2026-10-07T10:00:00Z',
        terms: { version: 1, split_rule: 'by_votes', remix_share_bps: 2000, default_price_usd_micros: 0, spend_policy: 'owner_only', created_at: '' },
        members: [member], agents: null, me: member,
      })
    }
    if (url === '/api/rooms/room_1/gate') {
      return json({
        room_id: 'room_1', thresholds: t,
        shipped: { status: 'needs_published_build', note: 'needs a published build', weeks: 0 },
        used: { status: 'in_progress', people: 3 },
        paid: { status: 'needs_published_build', note: 'needs a published build', usd_micros: 0, payers: 0 },
        met: false, notice: 'No shares, options or rights arise unless and until a company is formed.',
      })
    }
    if (url === '/api/rooms/room_1/gate-thresholds' && method === 'PUT') {
      const body = JSON.parse(String(init?.body))
      sent.push(String(init?.body))
      if (body.used_people < t.used_people) {
        return json({ error: `rooms: conflict: a Gate threshold may be raised, never lowered: used_people is ${t.used_people}` }, 409)
      }
      t = { ...t, ...body, updated_at: '2026-11-07T22:00:00Z' }
      return json(t)
    }
    if (url === '/api/rooms/room_1/contributions') return json({ contributions: [] })
    if (url.startsWith('/api/rooms/room_1/messages')) return json({ messages: [], more: false, events_cursor: 0 })
    return new Response('null', { status: 404 })
  })
  return sent
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  queryClient.clear()
})

const open = () => {
  window.history.pushState({}, '', '/rooms/room_1')
  render(<App />)
}

describe('the Gate tracker', () => {
  it('shows each test’s progress from Lens’s records, Shipped and Paid waiting on a published build', async () => {
    mockBff()
    open()
    await waitFor(() => expect(screen.getByTestId('room-gate-used').textContent).toBe(
      '3 of 100 people not linked to the owner, active in 6 of the last 8 weeksIn progress',
    ))
    expect(screen.getByTestId('room-gate-shipped').textContent).toBe('Needs a published build')
    expect(screen.getByTestId('room-gate-paid').textContent).toBe('Needs a published build')
  })

  it('an owner’s attempt to lower a threshold is refused, and a higher one is saved', async () => {
    const sent = mockBff()
    open()
    const form = await screen.findByRole('form', { name: 'Raise the Gate thresholds' })
    fireEvent.change(within(form).getByLabelText('People'), { target: { value: '50' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }))
    await within(form).findByText('A Gate threshold may be raised, never lowered: used_people is 100.')
    expect(screen.getByTestId('room-gate-used').textContent).toContain('of 100 people')

    fireEvent.change(within(form).getByLabelText('People'), { target: { value: '150' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.getByTestId('room-gate-used').textContent).toContain('3 of 150 people'))
    expect(JSON.parse(sent[1])).toEqual({ shipped_weeks: 8, used_people: 150, used_active_weeks: 6, paid_usd_micros: 1_000_000_000, paid_payers: 10 })
  })
})
