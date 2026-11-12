import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B41.45 — the provisional leaderboard. The mock BFF plays Lens's B41.145: two accepted contributions, one each, split the
// pool 50/50; the owner accepts a third, by the member, and the shares become 800 and 400 points → 66.67% and 33.33%,
// adding up to 100%. A holder waiting for its owner's identity check is listed with no share. A workspace that is not
// synthetic gets 404 until room_equity is cleared.

const OWNER = 'ws_owner'
const ME = 'ws_me'

function mockBff({ me, gated = false }: { me: string; gated?: boolean }) {
  let status = 'proposed'
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const json = (v: unknown, s = 200) => new Response(JSON.stringify(v), { status: s, headers: { 'Content-Type': 'application/json' } })
    const member = (ws: string) => ({
      workspace_id: ws, role: ws === OWNER ? 'owner' : 'member', may_spend: false, terms_version: 1, terms_current: true, joined_at: '',
    })
    const work = (id: string, title: string, s: string) => ({
      id, room_id: 'room_1', listing_id: `lst_${id}`, version: 1, kind: 'prompt', title, author_workspace_id: id === 'rc_2' ? OWNER : ME,
      status: s, tally: 0, up: 0, down: 0, my_vote: 0, size: 'M', points: 400, created_at: '2026-11-07T09:00:00Z',
    })
    if (url === '/auth/me') return json({ mode: 'oidc', authenticated: true, user: { sub: 'u1', email: 'u1@example.com' } })
    if (url === '/api/rooms') return json({ rooms: [], joined: [], invited: null })
    if (url === '/api/rooms/room_1') {
      return json({
        id: 'room_1', owner_workspace_id: OWNER, title: 'Agent pricing', topic: 'research', description: '', visibility: 'public',
        status: 'open', terms_version: 1, member_count: 3, created_at: '', last_activity_at: '2026-10-07T10:00:00Z',
        terms: { version: 1, split_rule: 'by_votes', remix_share_bps: 2000, default_price_usd_micros: 0, spend_policy: 'owner_only', created_at: '' },
        members: [OWNER, ME].map(member), agents: null, me: member(me),
      })
    }
    if (url === '/api/rooms/room_1/leaderboard') {
      if (gated) return json({ error: 'rooms: not found: no such room' }, 404)
      const mine = status === 'accepted' ? 800 : 400
      const rows = [
        { workspace_id: ME, workspace_name: 'Northwind', points: mine, identity_checked: true, share_bps: mine === 800 ? 6667 : 5000 },
        { workspace_id: OWNER, workspace_name: 'Acme', points: 400, identity_checked: true, share_bps: mine === 800 ? 3333 : 5000 },
        { workspace_id: 'ws_new', workspace_name: 'Globex', points: 400, identity_checked: false, share_bps: 0 },
      ]
      return json({
        room_id: 'room_1', enabled: true, pool_bps: 2500, total_points: mine + 400, rows,
        note: 'Nothing is final until the Gate.', notice: '',
      })
    }
    if (url === '/api/rooms/room_1/contributions/rc_1' && method === 'PATCH') {
      status = 'accepted'
      return json(work('rc_1', 'Pricing prompt', status))
    }
    if (url === '/api/rooms/room_1/contributions') {
      return json({
        contributions: [work('rc_1', 'Pricing prompt', status), work('rc_2', 'Pricing table', 'accepted'), work('rc_3', 'Pricing FAQ', 'accepted')],
      })
    }
    if (url.startsWith('/api/rooms/room_1/messages')) return json({ messages: [], more: false, events_cursor: 0 })
    return new Response('null', { status: 404 })
  })
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
const rows = () => screen.getAllByTestId('room-leaderboard-row').map((r) => r.textContent)

describe('the provisional leaderboard', () => {
  it('after a third accepted contribution by two people, both are listed with shares that add up to 100% of the pool', async () => {
    mockBff({ me: OWNER })
    open()
    await waitFor(() => expect(rows()).toEqual(['Northwind40050%', 'You40050%', 'GlobexShares once its owner is identity-checked400Not yet']))
    const card = (await screen.findAllByTestId('contribution-card')).find((c) => within(c).queryByText('Pricing prompt'))!
    fireEvent.click(within(card).getByRole('button', { name: 'Accept' }))
    await waitFor(() => expect(rows()).toEqual(['Northwind80066.67%', 'You40033.33%', 'GlobexShares once its owner is identity-checked400Not yet']))
    expect(screen.getByTestId('room-leaderboard-note').textContent).toBe('Nothing is final until the Gate.')
  })

  it('a workspace that is not synthetic, before room_equity is cleared, sees no leaderboard', async () => {
    mockBff({ me: ME, gated: true })
    open()
    await screen.findAllByTestId('contribution-card')
    await waitFor(() => expect(queryClient.getQueryState(['rooms', 'points', 'room_1', 'leaderboard'])?.status).toBe('error'))
    expect(screen.queryByText('Leaderboard')).toBeNull()
  })
})
