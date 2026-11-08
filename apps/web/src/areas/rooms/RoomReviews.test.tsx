import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B41.44 — a contribution's quality, scored by two reviewers. The mock BFF plays Lens's B41.144: whoever asks, Lens
// draws the reviewers from members that are neither the author, an owner nor linked to the author, each drawn reviewer
// scores 0.5–1.5, and once both have, quality is the median; a workspace that is not synthetic gets 404 until
// room_equity is cleared.

const OWNER = 'ws_owner'
const AUTHOR = 'ws_author'
const ME = 'ws_me'
const OTHER = 'ws_other'
const NAMES: Record<string, string> = { [ME]: 'Kestrel Labs', [OTHER]: 'Northwind' }

type Seat = { reviewer_workspace_id: string; reviewer_workspace_name: string; score_bps: number | null; ring: boolean; drawn_at: string }
const seat = (ws: string, score: number | null = null): Seat => ({
  reviewer_workspace_id: ws, reviewer_workspace_name: NAMES[ws], score_bps: score, ring: false, drawn_at: '2026-11-07T10:00:00Z',
})

function mockBff({ me, gated = false, seats = [] }: { me: string; gated?: boolean; seats?: Seat[] }) {
  let reviews = seats
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
    // Lens's median of two counted scores, 1.0 until both are in.
    const quality = () => {
      const s = reviews.map((v) => (v.ring ? 10_000 : v.score_bps))
      return s.length === 2 && s.every((x) => x !== null) ? Math.floor(((s[0] as number) + (s[1] as number)) / 2) : 10_000
    }
    const answer = () => json({ contribution_id: 'rc_1', quality_bps: quality(), reviews })
    if (url === '/auth/me') return json({ mode: 'oidc', authenticated: true, user: { sub: 'u1', email: 'u1@example.com' } })
    if (url === '/api/rooms') return json({ rooms: [], joined: [], invited: null })
    if (url === '/api/rooms/room_1') {
      return json({
        id: 'room_1', owner_workspace_id: OWNER, title: 'Agent pricing', topic: 'research', description: '', visibility: 'public',
        status: 'open', terms_version: 1, member_count: 4, created_at: '', last_activity_at: '2026-10-07T10:00:00Z',
        terms: { version: 1, split_rule: 'by_votes', remix_share_bps: 0, default_price_usd_micros: 0, spend_policy: 'owner_only', created_at: '' },
        members: [OWNER, AUTHOR, ME, OTHER].map(member), agents: null, me: member(me),
      })
    }
    if (url.startsWith('/api/rooms/room_1/contributions/rc_1/review') && gated) return json({ error: 'rooms: not found: no such room' }, 404)
    if (url === '/api/rooms/room_1/contributions/rc_1/reviews') return answer()
    if (url === '/api/rooms/room_1/contributions/rc_1/reviewers') {
      // Lens fills the empty seats from the members not linked to the author; the owner decides, so it is never drawn.
      reviews = [...reviews, ...[OTHER, ME].filter((ws) => !reviews.some((v) => v.reviewer_workspace_id === ws)).map((ws) => seat(ws))].slice(0, 2)
      return answer()
    }
    if (url === '/api/rooms/room_1/contributions/rc_1/review') {
      reviews = reviews.map((v) => (v.reviewer_workspace_id === me ? { ...v, score_bps: Number(body.score_bps) } : v))
      return answer()
    }
    if (url.startsWith('/api/rooms/room_1/messages')) return json({ messages: [], more: false, events_cursor: 0 })
    if (url === '/api/rooms/room_1/contributions') {
      return json({
        contributions: [{
          id: 'rc_1', room_id: 'room_1', listing_id: 'lst_1', version: 1, kind: 'prompt', title: 'Pricing prompt', author_workspace_id: AUTHOR,
          status: 'proposed', tally: 0, up: 0, down: 0, my_vote: 0, points: 0, created_at: '2026-11-07T09:00:00Z',
        }],
      })
    }
    return json({ error: 'rooms: not found: no such room' }, 404)
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

describe('two random reviewers', () => {
  it('the author asks for the draw without naming anyone, and Lens seats two members who are not the author', async () => {
    const bff = mockBff({ me: AUTHOR })
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Draw reviewers' }))
    const list = await screen.findByRole('list', { name: 'Reviewers of Pricing prompt' })
    expect(within(list).getAllByTestId('contribution-reviewer').map((r) => r.textContent)).toEqual([
      'Northwindnot scored yet',
      'Kestrel Labsnot scored yet',
    ])
    expect(bff.sent).toEqual([{ method: 'POST', url: '/api/rooms/room_1/contributions/rc_1/reviewers', body: {} }])
    expect(screen.queryByRole('button', { name: /Draw/ })).toBeNull()
    expect(screen.queryByLabelText('Your score for Pricing prompt')).toBeNull()
  })

  it('a drawn reviewer scores ×1.2, and with the other’s ×1.4 the quality is the median, ×1.3', async () => {
    const bff = mockBff({ me: ME, seats: [seat(OTHER, 14_000), seat(ME)] })
    open()
    expect((await screen.findByTestId('contribution-quality')).textContent).toBe(
      'Quality is scored by two members drawn at random, never by its author or anyone linked to them.',
    )
    fireEvent.change(screen.getByLabelText('Your score for Pricing prompt'), { target: { value: '12000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Score' }))
    await waitFor(() =>
      expect(screen.getByTestId('contribution-quality').textContent).toBe('Quality ×1.3, the median of two reviewers’ scores'),
    )
    expect(screen.getAllByTestId('contribution-reviewer').map((r) => r.textContent)).toEqual(['Northwind×1.4', 'You×1.2'])
    expect(bff.sent).toEqual([{ method: 'PUT', url: '/api/rooms/room_1/contributions/rc_1/review', body: { score_bps: 12_000 } }])
  })

  it('a workspace that is not synthetic, before room_equity is cleared, sees no reviewers and no draw', async () => {
    mockBff({ me: AUTHOR, gated: true })
    open()
    await screen.findByTestId('contribution-card')
    await waitFor(() => expect(queryClient.getQueryState(['rooms', 'reviews', 'room_1', 'rc_1'])?.status).toBe('error'))
    expect(screen.queryByTestId('contribution-reviews')).toBeNull()
    expect(screen.queryByText(/reviewers could not be read/)).toBeNull()
  })
})
