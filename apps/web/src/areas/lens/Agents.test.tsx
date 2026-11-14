import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'
import { pressEverything } from '../../test/pressEverything'

// B57.19 — /agents as Pocket's w-agents: the workspace's total, one card per agent, the room's wallet that takes no agent
// place, and New agent, which says the plan's limit before you try (GET /api/plan) and shows the create form below it.
// A 402 Lens answers anyway reads in words from its plan, gate, limit and allows fields.

const M = 1_000_000
const agent = (id: string, name: string, extra: Record<string, unknown> = {}): { id: string; name: string; balance_ulxc: number; kind?: string } & Record<string, unknown> => ({
  id, name, balance_ulxc: 10 * M, spent_ulxc: 0, keys: [], created_at: '2026-10-01T09:00:00Z', owner_user_id: 'u_1', ...extra,
})
// Lens's plan gates (B32.12), as GET /api/pricing serves them.
const PRICING = {
  min_usd_cents: 1000, max_usd_cents: 1000000, preset_usd_cents: [],
  plan_gates: { order: ['free', 'team', 'business'], plans: { free: { agents: 3 }, team: { agents: 25 }, business: { agents: -1 } } },
}

function mockBff({ agents, plan, create }: { agents: ReturnType<typeof agent>[]; plan: { plan: string; agents: number; agents_used: number }; create?: () => Response }) {
  const sent: Array<{ method: string; url: string; body: Record<string, unknown> }> = []
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
    if (method !== 'GET') sent.push({ method, url, body })
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/plan') return json(plan)
    if (url === '/api/pricing') return json(PRICING)
    if (url === '/api/agents' && method === 'GET') {
      const held = agents.reduce((s, a) => s + a.balance_ulxc, 0)
      return json({ workspace_balance_ulxc: 100 * M, allocated_ulxc: held, unallocated_ulxc: 100 * M - held, spent_ulxc: 0, agents })
    }
    if (url === '/api/agents' && method === 'POST') {
      if (create) return create()
      const a = agent(`agt_${agents.length + 1}`, String(body.name), { balance_ulxc: 0 })
      agents.push(a)
      return json(a, 201)
    }
    if (url === '/api/agents/approvals') return json({ approvals: [] })
    if (url === '/api/agents/forecast') return json({ at: '', month_start: '', month_end: '', spent_ulxc: 0, forecast_ulxc: 0, agents: [] })
    const m = /^\/api\/agents\/([^/?]+)(?:\/(\w+))?/.exec(url)
    const a = agents.find((x) => x.id === m?.[1])
    if (a && m?.[2] === undefined && method === 'PATCH') return json(Object.assign(a, body))
    if (a && m?.[2] === 'rules') return json({ max_per_request_ulxc: 0, daily_limit_ulxc: 0, monthly_limit_ulxc: a.kind === 'room' ? 1000 * M : 0, approval_above_ulxc: 0, ...(method === 'PUT' ? body : {}) })
    return new Response('null', { status: 404 })
  })
  return { sent }
}

afterEach(() => {
  cleanup()
  queryClient.clear()
  vi.restoreAllMocks()
  window.history.pushState({}, '', '/')
})

async function openNewAgent() {
  window.history.pushState({}, '', '/agents')
  render(<App />)
  await screen.findByTestId('agents-list')
  fireEvent.click(screen.getByRole('button', { name: 'New agent' }))
}

describe('Agents (B57.19)', () => {
  it('lists every agent as its card, with the total, and the room’s wallet apart from the agents', async () => {
    const room = agent('agt_room', 'Room: Agent pricing research', { kind: 'room', balance_ulxc: 0 })
    mockBff({ agents: [agent('agt_1', 'Research'), agent('agt_2', 'Sales'), agent('agt_3', 'Ops'), room], plan: { plan: 'free', agents: 3, agents_used: 3 } })
    window.history.pushState({}, '', '/agents')
    render(<App />)
    const list = await screen.findByTestId('agents-list')
    expect(within(list).getAllByRole('link', { name: /^Open / }).map((l) => l.getAttribute('aria-label'))).toEqual(['Open Research', 'Open Sales', 'Open Ops'])
    expect(within(list).getByRole('link', { name: 'Open Research' })).toHaveAttribute('href', '/agents/agt_1')
    expect(screen.getByTestId('agents-totals')).toHaveTextContent('30 LXC with its agents and')
    const wallet = await screen.findByTestId('room-wallet-agt_room')
    expect(within(list).queryByText('Room: Agent pricing research')).toBeNull()
    await waitFor(() => expect(wallet).toHaveTextContent('A room’s wallet. It does not take one of Free’s 3 agent places.'))
    expect(wallet).toHaveTextContent('Its budget is the room’s:')
    expect(within(wallet).getByRole('link', { name: 'Open the room' })).toHaveAttribute('href', '/rooms')
  })

  it('says the plan’s limit before you try, naming only the agents — the room’s wallet takes no place', async () => {
    const room = agent('agt_room', 'Room: Agent pricing research', { kind: 'room' })
    const { sent } = mockBff({ agents: [agent('agt_1', 'Research'), agent('agt_2', 'Sales'), agent('agt_3', 'Ops'), room], plan: { plan: 'free', agents: 3, agents_used: 3 } })
    await openNewAgent()
    const dialog = await screen.findByRole('dialog', { name: 'Free has room for 3 agents' })
    await waitFor(() =>
      expect(within(dialog).getByTestId('new-agent-limit')).toHaveTextContent(
        'Research, Sales and Ops fill Free’s 3 places. Team has room for 25. Archiving an agent frees its place; a room’s wallet does not take one.',
      ),
    )
    expect(within(dialog).queryByRole('textbox')).toBeNull()
    expect(within(dialog).getByRole('link', { name: 'See plans' })).toHaveAttribute('href', '/plans')
    // The reference draws the corner's x and the Close button; both are named Close.
    fireEvent.click(within(dialog).getAllByRole('button', { name: 'Close' }).at(-1)!)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(sent).toEqual([])
  })

  it('shows the create form below the limit, and opens the new agent’s page with what it is for and its rules saved', async () => {
    const room = agent('agt_room', 'Room: Agent pricing research', { kind: 'room' })
    const { sent } = mockBff({ agents: [agent('agt_1', 'Research'), agent('agt_2', 'Sales'), room], plan: { plan: 'free', agents: 3, agents_used: 2 } })
    await openNewAgent()
    const dialog = await screen.findByRole('dialog', { name: 'New agent' })
    fireEvent.change(await within(dialog).findByLabelText('Name'), { target: { value: 'Ops' } })
    fireEvent.change(within(dialog).getByLabelText('What it is for'), { target: { value: 'Pays the hosting bills' } })
    fireEvent.click(within(within(dialog).getByRole('group', { name: 'Rules to start from' })).getByRole('button', { name: 'Support bot' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create agent' }))
    await waitFor(() => expect(window.location.pathname).toBe('/agents/agt_4'))
    expect(sent.map((s) => `${s.method} ${s.url}`)).toEqual(['POST /api/agents', 'PATCH /api/agents/agt_4', 'PUT /api/agents/agt_4/rules'])
    expect(sent[0].body).toEqual({ name: 'Ops' })
    expect(sent[1].body).toEqual({ description: 'Pays the hosting bills' })
  })

  it('reads a 402 in words from its plan, gate, limit and allows fields, never Lens’s sentence', async () => {
    mockBff({
      agents: [agent('agt_1', 'Research'), agent('agt_2', 'Sales')],
      // The plan read before the agent was made elsewhere: Lens still refuses the create.
      plan: { plan: 'free', agents: 3, agents_used: 2 },
      create: () =>
        new Response(
          JSON.stringify({ error: 'LENS_PLAN_GATES: Free allows 3 agents, and all 3 are in use. Team allows 25.', setting: 'LENS_PLAN_GATES', plan: 'free', gate: 'agents', limit: 3, allows: 'team' }),
          { status: 402, headers: { 'Content-Type': 'application/json' } },
        ),
    })
    await openNewAgent()
    const form = await screen.findByRole('dialog', { name: 'New agent' })
    fireEvent.change(await within(form).findByLabelText('Name'), { target: { value: 'Ops' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Create agent' }))
    const dialog = await screen.findByRole('dialog', { name: 'Free has room for 3 agents' })
    await waitFor(() => expect(within(dialog).getByTestId('new-agent-limit')).toHaveTextContent('Team has room for 25.'))
    expect(within(dialog).getByTestId('new-agent-limit')).toHaveTextContent('Your 2 agents fill Free’s 3 places.')
    expect(dialog).not.toHaveTextContent('LENS_PLAN_GATES')
    expect(within(dialog).getByRole('link', { name: 'See plans' })).toBeInTheDocument()
  })

  it('sends /agents?agent=<id> on to that agent’s own page, with its statement line', async () => {
    mockBff({ agents: [agent('agt_1', 'Research')], plan: { plan: 'free', agents: 3, agents_used: 1 } })
    window.history.pushState({}, '', '/agents?agent=agt_1&entry=ent_9')
    render(<App />)
    await waitFor(() => expect(window.location.pathname).toBe('/agents/agt_1'))
    expect(window.location.search).toBe('?entry=ent_9')
  })

  it('pressEverything finds no dead control on Agents', async () => {
    const report = await pressEverything('/agents')
    expect(report.pressed).toBeGreaterThan(0)
    expect(report.dead).toEqual([])
  }, 300_000)
})
