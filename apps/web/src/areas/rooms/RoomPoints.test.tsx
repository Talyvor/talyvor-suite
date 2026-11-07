import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B41.43 — the points ledger. The mock BFF plays Lens's B41.143: accepting a contribution claimed at M (400 points) with
// quality 1.2 writes its author an accepted row of 480, a fork passes the room's 20% remix share of its points to the
// original's author, and a workspace that is not synthetic gets 404 until room_equity is cleared.

const OWNER = 'ws_owner'
const ME = 'ws_me'

const row = (over: Record<string, unknown>) => ({
  id: `rpts_${Math.random()}`, contribution_id: 'rc_1', workspace_id: ME, reason: 'accepted', size_points: 400, received_usd_micros: 0,
  quality_bps: 12_000, survival_bps: 10_000, remix_share_bps: 0, points: 480, created_at: '2026-11-07T12:00:00Z', ...over,
})

function mockBff({ me, gated = false }: { me: string; gated?: boolean }) {
  let status = 'proposed'
  const entries: Record<string, unknown>[] = [
    row({ contribution_id: 'rc_2', workspace_id: ME, reason: 'remix_share', remix_share_bps: 2000, quality_bps: 10_000, points: 80 }),
    row({ contribution_id: 'rc_2', workspace_id: OWNER, remix_share_bps: 2000, quality_bps: 10_000, points: 320 }),
  ]
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const json = (v: unknown, s = 200) => new Response(JSON.stringify(v), { status: s, headers: { 'Content-Type': 'application/json' } })
    const member = (ws: string) => ({
      workspace_id: ws, role: ws === OWNER ? 'owner' : 'member', may_spend: false, terms_version: 1, terms_current: true, joined_at: '',
    })
    const work = (id: string, title: string, s: string) => ({
      id, room_id: 'room_1', listing_id: `lst_${id}`, version: 1, kind: 'prompt', title, author_workspace_id: id === 'rc_1' ? ME : OWNER,
      status: s, tally: 0, up: 0, down: 0, my_vote: 0, size: 'M', points: 400, created_at: '2026-11-07T09:00:00Z',
    })
    if (url === '/auth/me') return json({ mode: 'oidc', authenticated: true, user: { sub: 'u1', email: 'u1@example.com' } })
    if (url === '/api/rooms') return json({ rooms: [], joined: [], invited: null })
    if (url === '/api/rooms/room_1') {
      return json({
        id: 'room_1', owner_workspace_id: OWNER, title: 'Agent pricing', topic: 'research', description: '', visibility: 'public',
        status: 'open', terms_version: 1, member_count: 2, created_at: '', last_activity_at: '2026-10-07T10:00:00Z',
        terms: { version: 1, split_rule: 'by_votes', remix_share_bps: 2000, default_price_usd_micros: 0, spend_policy: 'owner_only', created_at: '' },
        members: [OWNER, ME].map(member), agents: null, me: member(me),
      })
    }
    if (url === '/api/rooms/room_1/points') {
      if (gated) return json({ error: 'rooms: not found: no such room' }, 404)
      const holders = [
        { workspace_id: ME, workspace_name: 'Northwind', points: entries.filter((e) => e.workspace_id === ME).reduce((a, e) => a + Number(e.points), 0), identity_checked: true },
        { workspace_id: OWNER, workspace_name: 'Acme', points: 320, identity_checked: false },
      ]
      return json({ room_id: 'room_1', total_points: holders[0].points, holders, entries: [...entries].reverse() })
    }
    if (url === '/api/rooms/room_1/contributions/rc_1' && method === 'PATCH') {
      status = 'accepted'
      entries.push(row({}))
      return json(work('rc_1', 'Pricing prompt', status))
    }
    if (url === '/api/rooms/room_1/contributions') {
      return json({ contributions: [work('rc_1', 'Pricing prompt', status), work('rc_2', 'Pricing prompt, ranked', 'accepted')] })
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
const entries = () => screen.getAllByTestId('room-points-entry').map((r) => r.textContent)

describe('the points ledger', () => {
  it('a fork’s rows show its author earning its points less the remix share, and the original’s author the share', async () => {
    mockBff({ me: ME })
    open()
    await waitFor(() => expect(screen.getAllByTestId('room-points-entry')).toHaveLength(2))
    expect(entries()).toEqual([
      'Pricing prompt, ranked · Acme400 × quality 1 × survival 100%, less 20% to the original320',
      'Pricing prompt, ranked · You20% of a fork’s 400 points80',
    ])
    expect(screen.getAllByTestId('room-points-holder').map((r) => r.textContent)).toEqual([
      'You80',
      'AcmeCounts once its owner is identity-checked320',
    ])
  })

  it('the owner accepts an M-size contribution scored 1.2 and the ledger gains a row of 1.2 × 400 = 480 for its author', async () => {
    mockBff({ me: OWNER })
    open()
    await waitFor(() => expect(screen.getAllByTestId('room-points-entry')).toHaveLength(2))
    const card = (await screen.findAllByTestId('contribution-card')).find((c) => within(c).queryByText('Pricing prompt'))!
    fireEvent.click(within(card).getByRole('button', { name: 'Accept' }))
    await waitFor(() => expect(screen.getAllByTestId('room-points-entry')).toHaveLength(3))
    expect(entries()[0]).toBe('Pricing prompt · Northwind400 × quality 1.2 × survival 100%480')
  })

  it('a workspace that is not synthetic, before room_equity is cleared, sees no points', async () => {
    mockBff({ me: ME, gated: true })
    open()
    await screen.findAllByTestId('contribution-card')
    await waitFor(() => expect(queryClient.getQueryState(['rooms', 'points', 'room_1'])?.status).toBe('error'))
    expect(screen.queryByText('Points')).toBeNull()
  })
})
