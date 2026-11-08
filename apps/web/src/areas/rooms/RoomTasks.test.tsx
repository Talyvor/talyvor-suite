import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B41.52 — the open tasks board. The mock BFF plays Lens's B41.152: the owner or an editor posts a task at a size on the
// rate card, any member claims an open one for itself and lets it go again, and the board is shared, so another member
// sees the claim. A task has no assignee and no deadline. 404 in a workspace that is not synthetic until room_equity is
// cleared.

const OWNER = 'ws_owner'

const board = (): Record<string, unknown>[] => [
  { id: 'rtsk_1', room_id: 'room_1', poster_workspace_id: OWNER, title: 'Write the launch FAQ', description: 'Ten questions.', size: 'M',
    points: 400, created_at: '2026-11-01T10:00:00Z' },
]

// tasks is Lens's board: pass the same one to a second mock and the second member reads what the first one did.
function mockBff({ me, role = 'member', gated = false, tasks = board() }: { me: string; role?: string; gated?: boolean; tasks?: Record<string, unknown>[] }) {
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
      workspace_id: ws, workspace_name: ws, role: ws === OWNER ? 'owner' : ws === me ? role : 'member', may_spend: false, terms_version: 1,
      terms_current: true, joined_at: '',
    })
    if (url === '/auth/me') return json({ mode: 'oidc', authenticated: true, user: { sub: 'u1', email: 'u1@example.com' } })
    if (url === '/api/rooms') return json({ rooms: [], joined: [], invited: null })
    if (url === '/api/rooms/room_1') {
      return json({
        id: 'room_1', owner_workspace_id: OWNER, title: 'Agent pricing', topic: 'research', description: '', visibility: 'public',
        status: 'open', terms_version: 1, member_count: 3, created_at: '', last_activity_at: '2026-10-07T10:00:00Z',
        terms: { version: 1, split_rule: 'by_votes', remix_share_bps: 0, default_price_usd_micros: 0, spend_policy: 'owner_only', created_at: '' },
        members: [OWNER, 'ws_ada', 'ws_bob'].map(member), agents: null, me: member(me),
      })
    }
    if (gated && url.startsWith('/api/rooms/room_1/tasks')) return json({ error: 'rooms: not found: no such room' }, 404)
    if (url === '/api/rooms/room_1/rate-card') {
      return json({ room_id: 'room_1', pool_points: 10_000, item_cap_points: 500, sizes: [
        { size: 'S', hours: 2, points_per_hour: 50, points: 100 }, { size: 'M', hours: 8, points_per_hour: 50, points: 400 }] })
    }
    if (url === '/api/rooms/room_1/tasks' && method === 'POST') {
      const t = { id: `rtsk_${tasks.length + 1}`, room_id: 'room_1', poster_workspace_id: me, title: body.title, description: body.description,
        size: body.size, points: body.size === 'S' ? 100 : 400, created_at: new Date().toISOString() }
      tasks.push(t)
      return json(t, 201)
    }
    if (url === '/api/rooms/room_1/tasks') return json(tasks)
    const claim = /^\/api\/rooms\/room_1\/tasks\/(rtsk_\d+)\/claim$/.exec(url)
    if (claim) {
      const t = tasks.find((x) => x.id === claim[1]) as Record<string, unknown>
      if (method === 'DELETE') {
        delete t.claimant_workspace_id
        delete t.claimant_workspace_name
        delete t.claimed_at
      } else if (t.claimant_workspace_id && t.claimant_workspace_id !== me) {
        return json({ error: `rooms: conflict: ${String(t.claimant_workspace_name)} has claimed the task` }, 409)
      } else {
        Object.assign(t, { claimant_workspace_id: me, claimant_workspace_name: me === 'ws_ada' ? 'Ada Ltd' : me, claimed_at: '2026-11-08T10:00:00Z' })
      }
      return json(t)
    }
    if (url.startsWith('/api/rooms/room_1/messages')) return json({ messages: [], more: false, events_cursor: 0 })
    if (url === '/api/rooms/room_1/contributions') return json({ contributions: [] })
    return new Response('null', { status: 404 })
  })
  return { sent, tasks }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  queryClient.clear()
})

describe('the open tasks board', () => {
  it('a member claims a task and another member sees the claim', async () => {
    const bff = mockBff({ me: 'ws_ada' })
    window.history.pushState({}, '', '/rooms/room_1')
    render(<App />)
    const task = await screen.findByTestId('room-task')
    expect(within(task).getByText('Write the launch FAQ')).toBeTruthy()
    expect(within(task).getByTestId('room-task-status').textContent).toBe('Open · anyone in the room may claim it')
    fireEvent.click(within(task).getByRole('button', { name: 'Claim it' }))
    await waitFor(() => expect(within(task).getByTestId('room-task-status').textContent).toMatch(/^Claimed by you on .+$/))
    expect(bff.sent).toEqual([{ method: 'POST', url: '/api/rooms/room_1/tasks/rtsk_1/claim', body: {} }])

    // The same board, read by another member: Ada's claim, and no button to take it from her.
    cleanup()
    queryClient.clear()
    vi.restoreAllMocks()
    mockBff({ me: 'ws_bob', tasks: bff.tasks })
    window.history.pushState({}, '', '/rooms/room_1')
    render(<App />)
    const seen = await screen.findByTestId('room-task')
    expect(within(seen).getByTestId('room-task-status').textContent).toMatch(/^Claimed by Ada Ltd on .+$/)
    expect(within(seen).queryByRole('button')).toBeNull()
  })

  it('the claimant lets a task go and it is open again', async () => {
    const bff = mockBff({ me: 'ws_ada' })
    await fetch('/api/rooms/room_1/tasks/rtsk_1/claim', { method: 'POST' })
    window.history.pushState({}, '', '/rooms/room_1')
    render(<App />)
    const task = await screen.findByTestId('room-task')
    fireEvent.click(within(task).getByRole('button', { name: 'Let it go' }))
    await waitFor(() => expect(within(task).getByTestId('room-task-status').textContent).toBe('Open · anyone in the room may claim it'))
    expect(bff.sent.at(-1)).toEqual({ method: 'DELETE', url: '/api/rooms/room_1/tasks/rtsk_1/claim', body: {} })
  })

  it('the owner posts a task at a size on the rate card, with no assignee and no deadline', async () => {
    const bff = mockBff({ me: OWNER })
    window.history.pushState({}, '', '/rooms/room_1')
    render(<App />)
    const form = await screen.findByRole('form', { name: 'Post a task' })
    expect(within(form).queryByLabelText(/assign|due|deadline/i)).toBeNull()
    fireEvent.change(within(form).getByLabelText('Title'), { target: { value: ' Price the API tiers ' } })
    fireEvent.change(within(form).getByLabelText('Size'), { target: { value: 'S' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Post the task' }))
    await waitFor(() => expect(screen.getAllByTestId('room-task')).toHaveLength(2))
    expect(bff.sent.at(-1)).toEqual({ method: 'POST', url: '/api/rooms/room_1/tasks', body: { title: 'Price the API tiers', description: '', size: 'S' } })
  })

  it('a member sees no form to post one, and nothing is drawn where Lens answers 404', async () => {
    mockBff({ me: 'ws_ada' })
    window.history.pushState({}, '', '/rooms/room_1')
    render(<App />)
    await screen.findByTestId('room-task')
    expect(screen.queryByRole('form', { name: 'Post a task' })).toBeNull()

    cleanup()
    queryClient.clear()
    vi.restoreAllMocks()
    mockBff({ me: OWNER, gated: true })
    window.history.pushState({}, '', '/rooms/room_1')
    render(<App />)
    await screen.findByRole('heading', { name: 'Agent pricing' })
    await waitFor(() => expect(queryClient.getQueryState(['rooms', 'tasks', 'room_1'])?.status).toBe('error'))
    expect(screen.queryByText('Tasks')).toBeNull()
  })
})
