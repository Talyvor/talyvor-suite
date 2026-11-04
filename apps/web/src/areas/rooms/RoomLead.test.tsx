import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B41.48 — the room's lead. The mock BFF plays Lens's takeover (B41.148) for a room whose owner has been away past its
// notice: members vote for a lead, and the first whose voters hold more than half of the points becomes the owner.

const ME = 'ws_me'
const OWNER = 'ws_owner'
const OTHER = 'ws_other'

function mockBff() {
  let owner = OWNER
  const votes: Record<string, string> = {}
  const points: Record<string, number> = { [OWNER]: 0, [ME]: 6, [OTHER]: 4 }
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
      workspace_id: ws, role: ws === owner ? 'owner' : 'member', may_spend: false, terms_version: 1, terms_current: true, joined_at: '',
    })
    const takeover = () => {
      const elected = owner !== OWNER
      const tally: Record<string, number> = {}
      for (const [v, c] of Object.entries(votes)) tally[c] = (tally[c] ?? 0) + points[v]
      return {
        owner_workspace_id: owner, owner_last_active_at: '2026-08-01T10:00:00Z', notice_from: '2026-09-30T10:00:00Z',
        notice: {
          id: 'rtko_1', owner_workspace_id: OWNER, noticed_by_workspace_id: OTHER, noticed_at: '2026-10-01T10:00:00Z',
          voting_from: '2026-10-15T10:00:00Z', status: elected ? 'elected' : 'open',
          ...(elected ? { elected_workspace_id: owner, closed_at: '2026-10-20T10:00:00Z' } : {}),
        },
        voting: !elected,
        members: [OWNER, ME, OTHER].map((ws) => ({ ...member(ws), points: points[ws], voted_for: votes[ws] })),
        total_points: 10,
        tally,
      }
    }
    if (url === '/auth/me') return json({ mode: 'oidc', authenticated: true, user: { sub: 'u1', email: 'u1@example.com' } })
    if (url === '/api/rooms') return json({ rooms: [], joined: [], invited: null })
    if (url === '/api/rooms/room_1') {
      return json({
        id: 'room_1', owner_workspace_id: owner, title: 'Agent pricing', topic: 'research', description: '', visibility: 'public',
        status: 'open', terms_version: 1, member_count: 3, created_at: '', last_activity_at: '2026-10-07T10:00:00Z',
        terms: { version: 1, split_rule: 'by_votes', remix_share_bps: 0, default_price_usd_micros: 0, spend_policy: 'owner_only', created_at: '' },
        members: [OWNER, ME, OTHER].map(member), agents: null, me: member(ME),
      })
    }
    if (url === '/api/rooms/room_1/takeover') return json(takeover())
    if (url === '/api/rooms/room_1/takeover/vote' && method === 'PUT') {
      votes[ME] = String(body.candidate_workspace_id)
      const t = takeover()
      if (t.tally[votes[ME]] * 2 > t.total_points) owner = votes[ME]
      return json(takeover())
    }
    if (url.startsWith('/api/rooms/room_1/messages')) return json({ messages: [], more: false, events_cursor: 0 })
    if (url === '/api/rooms/room_1/contributions') return json({ contributions: [] })
    if (url.startsWith('/api/marketplace/listings')) return json({ listings: [] })
    return new Response('null', { status: 404 })
  })
  return { sent }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  queryClient.clear()
})

describe('the room’s lead', () => {
  it('a vote by members holding most of the points makes another member the lead', async () => {
    const bff = mockBff()
    window.history.pushState({}, '', '/rooms/room_1')
    render(<App />)
    expect((await screen.findByTestId('room-lead')).textContent).toMatch(/^ws_owner leads the room/)
    const candidates = await screen.findByRole('list', { name: 'Candidates' })
    expect(within(candidates).getByTestId(`lead-tally-${OTHER}`).textContent).toBe('0 of 10 points vote for them · holds 4')

    fireEvent.click(within(candidates).getByRole('button', { name: `Vote for ${OTHER} as lead` }))
    await waitFor(() => expect(screen.getByTestId('room-lead').textContent).toMatch(/^ws_other leads the room/))
    expect(bff.sent).toEqual([{ method: 'PUT', url: '/api/rooms/room_1/takeover/vote', body: { candidate_workspace_id: OTHER } }])
    expect(screen.getByText(/elected/).textContent).toMatch(/^Members holding most of the points elected ws_other as lead/)
  })
})
