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
  const rules: Record<string, Record<string, unknown>> = {}
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
    if (method !== 'GET') sent.push({ method, url, body })
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    // B57.44: /api/plan carries the plan's seats too; Agents reads none of them.
    if (url === '/api/plan' && !('seats' in plan)) return json({ ...plan, seats: 1 })
    if (url === '/api/plan') return json(plan)
    if (url === '/api/pricing') return json(PRICING)
    // B61.13 — the peg New agent reads its dollars at, and the saved payees More rules offers.
    if (url === '/api/lxc/topup-options') return json({ allowed_usd_cents: [], usd_per_lxc: 0.1 })
    if (url === '/api/money/payees') return json({ payees: [{ id: 'pye_1', name: 'Hetzner', country: 'DE' }] })
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
    if (a && m?.[2] === 'rules') {
      if (method === 'PUT') rules[a.id] = body
      return json({ max_per_request_ulxc: 0, daily_limit_ulxc: 0, monthly_limit_ulxc: a.kind === 'room' ? 1000 * M : 0, approval_above_ulxc: 0, ...rules[a.id] })
    }
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
    // B61.14 — the workspace's LXC credit wallet is not drawn: no "holds … free to fund them".
    expect(screen.getByTestId('agents-totals').textContent).toBe('Each agent spends its own money, inside its own rules.')
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

  it('shows the create form below the limit, and opens the new agent’s page with what it does and its rules saved', async () => {
    const room = agent('agt_room', 'Room: Agent pricing research', { kind: 'room' })
    const { sent } = mockBff({ agents: [agent('agt_1', 'Research'), agent('agt_2', 'Sales'), room], plan: { plan: 'free', agents: 3, agents_used: 2 } })
    await openNewAgent()
    const dialog = await screen.findByRole('dialog', { name: 'New agent' })
    fireEvent.click(await within(dialog).findByRole('button', { name: /^Make your own/ }))
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Ops' } })
    fireEvent.change(within(dialog).getByLabelText('What it does, in your own words'), { target: { value: 'Pays the hosting bills' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create agent' }))
    await waitFor(() => expect(window.location.pathname).toBe('/agents/agt_4'))
    expect(sent.map((s) => `${s.method} ${s.url}`)).toEqual(['POST /api/agents', 'PATCH /api/agents/agt_4', 'PUT /api/agents/agt_4/rules'])
    expect(sent[0].body).toEqual({ name: 'Ops', fiat_currency: 'USD' })
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
    fireEvent.click(await within(form).findByRole('button', { name: /^Make your own/ }))
    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'Ops' } })
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

// B61.13 — New agent is one of Talyvor's six, named by what it does, or the owner's own. Either way the owner types the
// name, and sets the four rules the approved rules screen names (W4), in the account's currency (B61.87).
describe('New agent (B61.13)', () => {
  const helpers = ['Remy', 'Sunny', 'Penny', 'Max', 'Nova', 'Ollie']

  it('one of ours, named by its owner, with Per payment 50, Per day 200, Per month 1000 and Ask me above 20: its rules read back exactly those', async () => {
    const { sent } = mockBff({ agents: [agent('agt_1', 'Books')], plan: { plan: 'free', agents: 3, agents_used: 1 } })
    await openNewAgent()
    const dialog = await screen.findByRole('dialog', { name: 'New agent' })
    fireEvent.click(await within(dialog).findByRole('button', { name: /^Research/ }))
    // Its suggested amounts are filled in, each the owner's to change.
    expect(within(dialog).getByLabelText('Per payment')).toHaveValue('50')
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Atlas' } })
    for (const [field, value] of [['Per payment', '50'], ['Per day', '200'], ['Per month', '1000'], ['Ask me above', '20']])
      fireEvent.change(within(dialog).getByLabelText(field), { target: { value } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create agent' }))
    await waitFor(() => expect(window.location.pathname).toBe('/agents/agt_2'))
    expect(sent[0]).toEqual({ method: 'POST', url: '/api/agents', body: { name: 'Atlas', colour: 'cobalt', fiat_currency: 'USD' } })
    expect(sent[1].body).toEqual({ description: 'Research' })
    // B61.87 — held in the account's currency (dollars here: it has no account in another), in its minor units.
    const read = (await (await fetch('/api/agents/agt_2/rules')).json()) as Record<string, number>
    expect({ currency: read.currency, per_payment: read.max_per_payment_minor, per_day: read.daily_limit_minor, per_month: read.monthly_limit_minor, ask_above: read.approval_above_minor }).toEqual({
      currency: 'USD',
      per_payment: 5000,
      per_day: 20000,
      per_month: 100000,
      ask_above: 2000,
    })
  })

  it('your own, with nothing typed, creates the agent with the name typed and every payment waiting for your yes', async () => {
    const { sent } = mockBff({ agents: [agent('agt_1', 'Books')], plan: { plan: 'free', agents: 3, agents_used: 1 } })
    await openNewAgent()
    const dialog = await screen.findByRole('dialog', { name: 'New agent' })
    fireEvent.click(await within(dialog).findByRole('button', { name: /^Make your own/ }))
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Ledger' } })
    fireEvent.click(within(within(dialog).getByRole('group', { name: 'Picture' })).getByRole('button', { name: 'Picture 3' }))
    fireEvent.click(within(within(dialog).getByRole('group', { name: 'What it does' })).getByRole('button', { name: 'Bookkeeping' }))
    expect(within(dialog).getByTestId('new-agent-every-payment')).toHaveTextContent('With none of these set, every payment waits for your yes.')
    fireEvent.click(within(dialog).getByRole('button', { name: 'More rules' }))
    fireEvent.click(await within(within(dialog).getByTestId('new-agent-more-rules')).findByRole('button', { name: 'Hetzner' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create agent' }))
    await waitFor(() => expect(window.location.pathname).toBe('/agents/agt_2'))
    expect(sent[0].body).toEqual({ name: 'Ledger', colour: 'mint', fiat_currency: 'USD' })
    expect(sent[1].body).toEqual({ description: 'Bookkeeping' })
    const put = sent.find((s) => s.method === 'PUT')!.body
    // Lens asks above its smallest amount: the first payment, of any size, waits for approval.
    expect(put).toMatchObject({ currency: 'USD', max_per_payment_minor: 0, daily_limit_minor: 0, monthly_limit_minor: 0, approval_above_minor: 1, allowed_payees: ['pye_1'] })
  })

  // B61.102 — Make your own offers the gallery's 27 pictures (the six helpers, lime and the twenty), none with a name;
  // the chef goes to the BFF as its picture, which Lens draws in lemon.
  it('your own offers 27 pictures, and the chef creates the agent wearing picture chef', async () => {
    const { sent } = mockBff({ agents: [agent('agt_1', 'Books')], plan: { plan: 'free', agents: 3, agents_used: 1 } })
    await openNewAgent()
    const dialog = await screen.findByRole('dialog', { name: 'New agent' })
    fireEvent.click(await within(dialog).findByRole('button', { name: /^Make your own/ }))
    const pictures = within(within(dialog).getByRole('group', { name: 'Picture' })).getAllByRole('button')
    expect(pictures.map((b) => b.getAttribute('aria-label'))).toEqual(Array.from({ length: 27 }, (_, i) => `Picture ${i + 1}`))
    for (const b of pictures) expect(b.textContent).toBe('')
    const chef = pictures.find((b) => b.querySelector('[data-picture="chef"]'))!
    fireEvent.click(chef)
    expect(chef).toHaveAttribute('aria-pressed', 'true')
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Supper' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create agent' }))
    await waitFor(() => expect(window.location.pathname).toBe('/agents/agt_2'))
    expect(sent[0]).toEqual({ method: 'POST', url: '/api/agents', body: { name: 'Supper', picture: 'chef', fiat_currency: 'USD' } })
  })

  it('offers no helper name, no fixed rule set and no LXC, and keeps Create off until a name is typed', async () => {
    const { sent } = mockBff({ agents: [agent('agt_1', 'Books')], plan: { plan: 'free', agents: 3, agents_used: 1 } })
    await openNewAgent()
    const dialog = await screen.findByRole('dialog', { name: 'New agent' })
    const kinds = await within(dialog).findByTestId('new-agent-kinds')
    expect(within(kinds).getAllByRole('button').map((b) => b.textContent)).toEqual(['Research', 'Sales', 'Bookkeeping', 'Ads', 'Travel', 'Support'])
    for (const start of [/^Research/, /^Make your own/]) {
      fireEvent.click(within(dialog).getByRole('button', { name: start }))
      for (const word of [...helpers, 'Support bot', 'Researcher', 'Coder', 'No rules', 'Rules to start from', 'LXC']) expect(dialog).not.toHaveTextContent(word)
      fireEvent.click(within(dialog).getByRole('button', { name: 'More rules' }))
      for (const word of [...helpers, 'LXC']) expect(dialog).not.toHaveTextContent(word)
      expect(within(dialog).getByRole('button', { name: 'Create agent' })).toBeDisabled()
      expect(dialog).toHaveTextContent('Name it first.')
      fireEvent.click(within(dialog).getByRole('button', { name: 'Change' }))
    }
    expect(sent).toEqual([])
  })
})

// B57.172 — the two ways in Pocket: each start is a row button (cloud, 16 round, its picture, its two lines and a
// chevron), one under another at every width; on the long form Cancel and Create agent stay at the dialog's foot.
describe('New agent in Pocket (B57.172)', () => {
  it('draws every start as a row button with its chevron, and keeps the form’s actions in view', async () => {
    mockBff({ agents: [agent('agt_1', 'Books')], plan: { plan: 'free', agents: 3, agents_used: 1 } })
    await openNewAgent()
    const dialog = await screen.findByRole('dialog', { name: 'New agent' })
    const kinds = await within(dialog).findByTestId('new-agent-kinds')
    expect(kinds.className).not.toMatch(/grid-cols-2/)
    const starts = within(dialog).getAllByTestId('new-agent-way')
    expect(starts.map((s) => within(s).getByRole('button').textContent)).toEqual(['Research', 'Sales', 'Bookkeeping', 'Ads', 'Travel', 'Support', 'Make your own'])
    for (const s of starts) {
      expect(s).toHaveClass('rounded-inset', 'bg-cloud')
      expect(s.querySelector('[data-icon="chev"]')).not.toBeNull()
    }
    fireEvent.click(within(dialog).getByRole('button', { name: /^Make your own/ }))
    expect(within(dialog).getByTestId('new-agent-start')).toHaveClass('rounded-inset', 'bg-cloud')
    const create = within(dialog).getByRole('button', { name: 'Create agent' })
    expect(create.closest('[data-testid="new-agent-actions"]')).toHaveClass('sticky', '-bottom-8.5', 'bg-page')
  })
})

