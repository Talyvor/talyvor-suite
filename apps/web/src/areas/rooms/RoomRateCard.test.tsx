import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B41.42 — the rate card. The mock BFF plays Lens's B41.142: the owner publishes it, a contribution claims a size whose
// points are fixed on it then, a raise once it is decided is 409, and a workspace that is not synthetic gets 404 until
// room_equity is cleared.

const OWNER = 'ws_owner'
const ME = 'ws_me'
const RAISE = 'rooms: conflict: the contribution was decided at 400 points, and points are never raised after delivery'

const CARD = {
  room_id: 'room_1', pool_points: 10000, item_cap_points: 500, updated_at: '2026-11-07T10:00:00Z',
  sizes: [
    { size: 'S', hours: 2, points_per_hour: 100, points: 200 },
    { size: 'M', hours: 4, points_per_hour: 100, points: 400 },
    { size: 'L', hours: 5, points_per_hour: 100, points: 500 },
  ],
}

function mockBff({ me, gated = false, card = CARD, work = {} }: { me: string; gated?: boolean; card?: Record<string, unknown>; work?: Record<string, unknown> }) {
  let rc = card
  let c: Record<string, unknown> = {
    id: 'rc_1', room_id: 'room_1', listing_id: 'lst_1', version: 1, kind: 'prompt', title: 'Pricing prompt', author_workspace_id: ME,
    status: 'proposed', tally: 0, up: 0, down: 0, my_vote: 0, points: 0, created_at: '2026-11-07T09:00:00Z', ...work,
  }
  const sent: { method: string; url: string; body: Record<string, unknown> }[] = []
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
    if (method !== 'GET') sent.push({ method, url, body })
    const json = (v: unknown, status = 200) =>
      new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    const member = (ws: string) => ({
      workspace_id: ws, role: ws === OWNER ? 'owner' : 'member', may_spend: false, terms_version: 1, terms_current: true, joined_at: '',
    })
    if (url === '/auth/me') return json({ mode: 'oidc', authenticated: true, user: { sub: 'u1', email: 'u1@example.com' } })
    if (url === '/api/rooms') return json({ rooms: [], joined: [], invited: null })
    if (url === '/api/rooms/room_1') {
      return json({
        id: 'room_1', owner_workspace_id: OWNER, title: 'Agent pricing', topic: 'research', description: '', visibility: 'public',
        status: 'open', terms_version: 1, member_count: 2, created_at: '', last_activity_at: '2026-10-07T10:00:00Z',
        terms: { version: 1, split_rule: 'by_votes', remix_share_bps: 0, default_price_usd_micros: 0, spend_policy: 'owner_only', created_at: '' },
        members: [OWNER, ME].map(member), agents: null, me: member(me),
      })
    }
    if (url === '/api/rooms/room_1/rate-card' || url === '/api/rooms/room_1/contributions/rc_1/size') {
      if (gated) return json({ error: 'rooms: not found: no such room' }, 404)
    }
    if (url === '/api/rooms/room_1/rate-card') {
      if (method === 'PUT') {
        const sizes = (body.sizes as { hours: number; points_per_hour: number }[]).map((z) => ({ ...z, points: z.hours * z.points_per_hour }))
        rc = { ...rc, pool_points: body.pool_points, sizes, item_cap_points: Number(body.pool_points) / 20, updated_at: '2026-11-07T11:00:00Z' }
      }
      return json(rc)
    }
    if (url === '/api/rooms/room_1/contributions/rc_1/size') {
      const z = (rc.sizes as { size: string; points: number }[]).find((x) => x.size === body.size)!
      if (c.status !== 'proposed' && z.points > Number(c.points)) return json({ error: RAISE }, 409)
      c = { ...c, size: z.size, points: z.points }
      return json(c)
    }
    if (url === '/api/rooms/room_1/shared-ownership') return json({ error: 'rooms: not found: no such room' }, 404)
    if (url.startsWith('/api/rooms/room_1/messages')) return json({ messages: [], more: false, events_cursor: 0 })
    if (url === '/api/rooms/room_1/contributions') return json({ contributions: [c] })
    return new Response('null', { status: 404 })
  })
  return { sent }
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

describe('the rate card', () => {
  it('the owner publishes points for each size, and a size worth more than 5% of the pool is not sent', async () => {
    const bff = mockBff({ me: OWNER, card: { room_id: 'room_1', pool_points: 0, item_cap_points: 0, sizes: [] } })
    open()
    expect((await screen.findByTestId('room-rate-card-empty')).textContent).toBe('The room’s owner has not published a rate card yet.')
    const form = screen.getByRole('form', { name: 'Publish the rate card' })
    fireEvent.change(within(form).getByLabelText('Pool, in points'), { target: { value: '10000' } })
    fireEvent.change(within(form).getByLabelText('Size'), { target: { value: 'M' } })
    fireEvent.change(within(form).getByLabelText('Hours'), { target: { value: '6' } })
    fireEvent.change(within(form).getByLabelText('Points per hour'), { target: { value: '100' } })
    expect(within(form).getByRole('alert').textContent).toBe('Size M is worth 600 points, more than 5% of the pool (500).')
    expect(within(form).getByRole('button', { name: 'Publish' })).toHaveProperty('disabled', true)

    fireEvent.change(within(form).getByLabelText('Hours'), { target: { value: '4' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Publish' }))
    await waitFor(() => expect(screen.getAllByTestId('rate-card-size').map((r) => r.textContent)).toEqual(['M4100400']))
    expect(bff.sent).toEqual([
      { method: 'PUT', url: '/api/rooms/room_1/rate-card', body: { pool_points: 10000, sizes: [{ size: 'M', hours: 4, points_per_hour: 100 }] } },
    ])
  })

  it('the author claims size M before the work and the card shows M’s points, claimed once', async () => {
    const bff = mockBff({ me: ME })
    open()
    fireEvent.change(await screen.findByLabelText('Size for Pricing prompt'), { target: { value: 'M' } })
    fireEvent.click(screen.getByRole('button', { name: 'Claim size' }))
    await waitFor(() => expect(screen.getByTestId('contribution-size').textContent).toBe('Size M · 400 points'))
    expect(screen.queryByLabelText('Size for Pricing prompt')).toBeNull()
    expect(bff.sent).toEqual([{ method: 'PUT', url: '/api/rooms/room_1/contributions/rc_1/size', body: { size: 'M' } }])
  })

  it('once accepted at M, raising it to L is refused with Lens’s sentence and it keeps M’s points', async () => {
    mockBff({ me: OWNER, work: { status: 'accepted', size: 'M', points: 400 } })
    open()
    fireEvent.change(await screen.findByLabelText('Size for Pricing prompt'), { target: { value: 'L' } })
    fireEvent.click(screen.getByRole('button', { name: 'Change size' }))
    expect((await screen.findByText(/never raised after delivery/)).textContent).toBe(
      'The contribution was decided at 400 points, and points are never raised after delivery.',
    )
    expect(screen.getByTestId('contribution-size').textContent).toBe('Size M · 400 points')
  })

  it('a workspace that is not synthetic, before room_equity is cleared, sees no rate card and no sizes', async () => {
    mockBff({ me: OWNER, gated: true })
    open()
    await screen.findByTestId('contribution-card')
    await waitFor(() => expect(queryClient.getQueryState(['rooms', 'rate-card', 'room_1'])?.status).toBe('error'))
    expect(screen.queryByText('Rate card')).toBeNull()
    expect(screen.queryByTestId('contribution-size')).toBeNull()
  })
})
