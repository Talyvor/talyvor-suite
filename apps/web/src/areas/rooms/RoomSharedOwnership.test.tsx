import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B41.41 — shared ownership, intent only. The mock BFF plays Lens's B41.141: the owner sets the pool, members see it
// with the notice, and a workspace that is not synthetic gets 404 until room_equity is cleared.

const OWNER = 'ws_owner'
const ME = 'ws_me'
const NOTICE =
  'No shares, options or rights arise unless and until a company is formed, a regulated partner adopts a Contributor Plan, and the Gate is met'

function mockBff({ me, gated = false }: { me: string; gated?: boolean }) {
  let ownership = { room_id: 'room_1', enabled: false, pool_bps: 2500, notice: NOTICE } as Record<string, unknown>
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
    if (url === '/api/rooms/room_1/shared-ownership') {
      if (gated) return json({ error: 'rooms: not found: no such room' }, 404)
      if (method === 'PUT') ownership = { ...ownership, ...body, updated_at: '2026-11-07T10:00:00Z' }
      return json(ownership)
    }
    if (url.startsWith('/api/rooms/room_1/messages')) return json({ messages: [], more: false, events_cursor: 0 })
    if (url === '/api/rooms/room_1/contributions') return json({ contributions: [] })
    return new Response('null', { status: 404 })
  })
  return { sent }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  queryClient.clear()
})

describe('shared ownership', () => {
  it('the owner switches it on with a 25% pool, and the room shows the notice word for word', async () => {
    const bff = mockBff({ me: OWNER })
    window.history.pushState({}, '', '/rooms/room_1')
    render(<App />)
    expect((await screen.findByTestId('room-shared-ownership')).textContent).toBe('Off')
    expect(screen.getByTestId('room-shared-ownership-notice').textContent).toBe(NOTICE)
    expect((screen.getByLabelText('Pool for contributors, in percent') as HTMLInputElement).value).toBe('25')

    fireEvent.click(screen.getByLabelText('Shared ownership on'))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.getByTestId('room-shared-ownership').textContent).toBe('On · pool for contributors 25%'))
    expect(bff.sent).toEqual([{ method: 'PUT', url: '/api/rooms/room_1/shared-ownership', body: { enabled: true, pool_bps: 2500 } }])
  })

  it('a pool outside 10–50% is not sent', async () => {
    const bff = mockBff({ me: OWNER })
    window.history.pushState({}, '', '/rooms/room_1')
    render(<App />)
    fireEvent.change(await screen.findByLabelText('Pool for contributors, in percent'), { target: { value: '60' } })
    expect(screen.getByRole('button', { name: 'Save' })).toHaveProperty('disabled', true)
    expect(screen.getByRole('alert').textContent).toBe('The pool is a percentage from 10 to 50, like 25.')
    expect(bff.sent).toEqual([])
  })

  it('a member sees the pool and the notice, and no switch', async () => {
    mockBff({ me: ME })
    window.history.pushState({}, '', '/rooms/room_1')
    render(<App />)
    expect((await screen.findByTestId('room-shared-ownership-notice')).textContent).toBe(NOTICE)
    expect(screen.queryByLabelText('Shared ownership on')).toBeNull()
    expect(screen.getByText('Only the room’s owner sets shared ownership.')).toBeTruthy()
  })

  it('a workspace that is not synthetic, before room_equity is cleared, sees no shared ownership at all', async () => {
    mockBff({ me: OWNER, gated: true })
    window.history.pushState({}, '', '/rooms/room_1')
    render(<App />)
    await screen.findByRole('heading', { name: 'Agent pricing' })
    await waitFor(() => expect(queryClient.getQueryState(['rooms', 'shared-ownership', 'room_1'])?.status).toBe('error'))
    expect(screen.queryByText(/Shared ownership/)).toBeNull()
    expect(screen.queryByText(NOTICE)).toBeNull()
  })
})
