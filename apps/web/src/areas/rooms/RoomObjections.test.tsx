import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B41.47 — objections to the frozen leaderboard. The mock BFF plays Lens's B41.147: the owner freezes the leaderboard once,
// opening a 14-day window; a member objects to the points a contribution earned its author, and Lens seats three members;
// two votes the same way decide it, and an upheld one writes an objection row to the points ledger. 404 in a workspace that
// is not synthetic until room_equity is cleared.

const OWNER = 'ws_owner'
const AUTHOR = 'ws_author'
const RULES = 'Objections are raised within 14 days of the leaderboard freezing. Two votes the same way decide it.'

function mockBff({ me, gated = false }: { me: string; gated?: boolean }) {
  const later = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString()
  let frozen: string | null = null
  const objections: Record<string, unknown>[] = []
  const ledger = [{ id: 'p1', contribution_id: 'c_1', workspace_id: AUTHOR, reason: 'accepted', size_points: 400, received_usd_micros: 0,
    quality_bps: 10_000, survival_bps: 10_000, remix_share_bps: 0, points: 400, created_at: '2026-11-01T10:00:00Z' }]
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
      workspace_id: ws, workspace_name: ws, role: ws === OWNER ? 'owner' : 'member', may_spend: false, terms_version: 1, terms_current: true, joined_at: '',
    })
    const read = () => ({ room_id: 'room_1', frozen_at: frozen, objections_close_at: frozen && later(14), rules: RULES, objections })
    if (url === '/auth/me') return json({ mode: 'oidc', authenticated: true, user: { sub: 'u1', email: 'u1@example.com' } })
    if (url === '/api/rooms') return json({ rooms: [], joined: [], invited: null })
    if (url === '/api/rooms/room_1') {
      return json({
        id: 'room_1', owner_workspace_id: OWNER, title: 'Agent pricing', topic: 'research', description: '', visibility: 'public',
        status: 'open', terms_version: 1, member_count: 5, created_at: '', last_activity_at: '2026-10-07T10:00:00Z',
        terms: { version: 1, split_rule: 'by_votes', remix_share_bps: 0, default_price_usd_micros: 0, spend_policy: 'owner_only', created_at: '' },
        members: [OWNER, AUTHOR, 'ws_obj', 'ws_p1', 'ws_p2', 'ws_p3'].map(member), agents: null, me: member(me),
      })
    }
    if (gated && (url === '/api/rooms/room_1/objections' || url === '/api/rooms/room_1/leaderboard/freeze')) return json({ error: 'rooms: not found: no such room' }, 404)
    if (url === '/api/rooms/room_1/leaderboard/freeze') {
      frozen = new Date().toISOString()
      return json(read())
    }
    if (url === '/api/rooms/room_1/objections' && method === 'POST') {
      const o = { id: 'robj_1', contribution_id: body.contribution_id, holder_workspace_id: AUTHOR, objector_workspace_id: me, points: body.points,
        reason: body.reason, status: 'open', raised_at: new Date().toISOString(), decide_by: later(14),
        panel: ['ws_p1', 'ws_p2', 'ws_p3'].map((ws) => ({ workspace_id: ws, workspace_name: ws, uphold: null })) }
      objections.push(o)
      return json(o, 201)
    }
    if (url === '/api/rooms/room_1/objections') return json(read())
    if (url === '/api/rooms/room_1/objections/robj_1/vote') {
      const o = objections[0] as { status: string; points: number; panel: { workspace_id: string; uphold: boolean | null }[] }
      // The other two panelists have already voted, one each way: this vote decides it.
      o.panel = o.panel.map((p, i) => (p.workspace_id === me ? { ...p, uphold: body.uphold as boolean } : { ...p, uphold: i === 0 }))
      o.status = body.uphold ? 'upheld' : 'dismissed'
      if (body.uphold) ledger.push({ ...ledger[0], id: 'p2', reason: 'objection', size_points: 0, points: o.points })
      return json(o)
    }
    if (url === '/api/rooms/room_1/points') {
      const held = ledger.reduce((a, r) => a + r.points, 0)
      return json({ room_id: 'room_1', total_points: held, holders: [{ workspace_id: AUTHOR, workspace_name: AUTHOR, points: held, identity_checked: true }], entries: [...ledger].reverse() })
    }
    if (url.startsWith('/api/rooms/room_1/messages')) return json({ messages: [], more: false, events_cursor: 0 })
    if (url === '/api/rooms/room_1/contributions') {
      return json({ contributions: [{ id: 'c_1', room_id: 'room_1', listing_id: 'l_1', version: 1, kind: 'prompt', title: 'Launch risks', author_workspace_id: AUTHOR,
        author_workspace_name: 'Author Ltd', status: 'accepted', size: 'M', points: 400, tally: 1, up: 1, down: 0, my_vote: 0, created_at: '' }] })
    }
    return new Response('null', { status: 404 })
  })
  return { sent }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  queryClient.clear()
})

describe('objections to the frozen leaderboard', () => {
  it('the owner freezes the leaderboard after confirming, which opens the 14-day window', async () => {
    const bff = mockBff({ me: OWNER })
    window.history.pushState({}, '', '/rooms/room_1')
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Freeze the leaderboard' }))
    expect(bff.sent).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'Freeze it' }))
    await waitFor(() => expect(screen.getByTestId('room-objections-state').textContent).toMatch(/^Frozen on .+\. Objections are open until .+\.$/))
    expect(screen.getByTestId('room-objections-rules').textContent).toBe(RULES)
    expect(bff.sent).toEqual([{ method: 'POST', url: '/api/rooms/room_1/leaderboard/freeze', body: {} }])
  })

  it('a member objects, a drawn panelist upholds it, and the points ledger shows the objection row', async () => {
    const bff = mockBff({ me: 'ws_p1' })
    window.history.pushState({}, '', '/rooms/room_1')
    render(<App />)
    expect(screen.queryByRole('button', { name: 'Freeze the leaderboard' })).toBeNull()
    // The owner freezes it, and another member objects, while this member reads the room.
    await fetch('/api/rooms/room_1/leaderboard/freeze', { method: 'POST' })
    await fetch('/api/rooms/room_1/objections', { method: 'POST', body: JSON.stringify({ contribution_id: 'c_1', points: -200, reason: 'Half of it was copied.' }) })
    await queryClient.invalidateQueries()
    const objection = await screen.findByTestId('room-objection')
    expect(within(objection).getByText('Half of it was copied.')).toBeTruthy()
    expect(within(objection).getByTestId('room-objection-status').textContent).toMatch(/^Open · the panel decides by /)
    expect(within(objection).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['You · not voted yet', 'ws_p2 · not voted yet', 'ws_p3 · not voted yet'])

    fireEvent.click(within(objection).getByRole('button', { name: 'Uphold' }))
    await waitFor(() => expect(within(objection).getByTestId('room-objection-status').textContent).toMatch(/^Upheld: the points changed$/))
    expect(within(objection).queryByRole('button', { name: 'Uphold' })).toBeNull()
    expect(bff.sent.at(-1)).toEqual({ method: 'PUT', url: '/api/rooms/room_1/objections/robj_1/vote', body: { uphold: true } })
    await waitFor(() => expect(screen.getByText('Changed by an upheld objection')).toBeTruthy())
  })

  it('a member raises an objection in the window with the change it proposes', async () => {
    const bff = mockBff({ me: 'ws_obj' })
    await fetch('/api/rooms/room_1/leaderboard/freeze', { method: 'POST' })
    window.history.pushState({}, '', '/rooms/room_1')
    render(<App />)
    const form = await screen.findByRole('form', { name: 'Raise an objection' })
    fireEvent.change(within(form).getByLabelText('Change to its author’s points, like −200 or 100'), { target: { value: '−200' } })
    fireEvent.change(within(form).getByLabelText('Why'), { target: { value: ' Half of it was copied. ' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Raise the objection' }))
    await screen.findByTestId('room-objection')
    expect(bff.sent.at(-1)).toEqual({ method: 'POST', url: '/api/rooms/room_1/objections', body: { contribution_id: 'c_1', points: -200, reason: 'Half of it was copied.' } })
  })

  it('is not drawn where Lens answers 404', async () => {
    mockBff({ me: OWNER, gated: true })
    window.history.pushState({}, '', '/rooms/room_1')
    render(<App />)
    await screen.findByRole('heading', { name: 'Agent pricing' })
    await waitFor(() => expect(queryClient.getQueryState(['rooms', 'objections', 'room_1'])?.status).toBe('error'))
    expect(screen.queryByText('Objections')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Freeze the leaderboard' })).toBeNull()
  })
})
