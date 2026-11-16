import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B19.4 — the Agent Bank, walked the way its DONE line reads: create an agent, set its limits, and approve a payment
// from the inbox. B61.14 — funding an agent and paying one agent from another moved the parked LXC credit wallet and are
// not drawn; the limits are typed in dollars at Lens's peg. The mock BFF keeps agents, their rules and the approvals.

const M = 1_000_000

function mockBff() {
  const agents: Array<{ id: string; name: string; balance_ulxc: number; spent_ulxc: number; keys: string[]; created_at: string }> = []
  const rules: Record<string, Record<string, unknown>> = {}
  const approvals: Array<{ id: string; agent_id: string; amount_ulxc: number; model: string; status: string; created_at: string; fp: string; payee?: { kind: 'agent'; id: string; name: string }; memo?: string }> = []
  const workspace = 100 * M
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
    const json = (v: unknown, status = 200) =>
      new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    const allocated = () => agents.reduce((s, a) => s + a.balance_ulxc, 0)
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/lxc/topup-options') return json({ allowed_usd_cents: [1000], billing_enabled: true, usd_per_lxc: 0.1 }) // Lens's peg: $0.10 a LXC
    // B55.14: Lens judges a change to an agent's rules first; these do not loosen them.
    if (url.endsWith('/rules-challenge')) return json({ looser: false, changes: [], allow_credentials: [] })
    if (url === '/api/agents/passkeys') return json({ passkeys: [] })
    if (url === '/api/money/devices') return json({ devices: [] }) // B55.2: no phone key, so the web decides
    if (url === '/api/agents' && method === 'GET')
      return json({
        workspace_balance_ulxc: workspace,
        allocated_ulxc: allocated(),
        unallocated_ulxc: workspace - allocated(),
        spent_ulxc: 0,
        agents,
      })
    if (url === '/api/agents' && method === 'POST') {
      const a = { id: `agt_${agents.length + 1}`, name: String(body.name), balance_ulxc: 0, spent_ulxc: 0, keys: [], created_at: '2026-09-28T06:00:00Z' }
      agents.push(a)
      return json(a, 201)
    }
    if (url === '/api/agents/approvals') return json({ approvals })
    const decision = /^\/api\/agents\/approvals\/([^/]+)\/(approve|deny)$/.exec(url)
    if (decision) {
      const a = approvals.find((x) => x.id === decision[1])!
      a.status = decision[2] === 'approve' ? 'approved' : 'denied'
      return json(a)
    }
    const m = /^\/api\/agents\/([^/]+)\/(\w+)(?:\?|$)/.exec(url)
    const agent = agents.find((a) => a.id === m?.[1])
    if (!m || !agent) return new Response('null', { status: 404 })
    switch (m[2]) {
      case 'rules':
        if (method === 'PUT') rules[agent.id] = body
        return json({
          max_per_request_ulxc: 0, daily_limit_ulxc: 0, monthly_limit_ulxc: 0, approval_above_ulxc: 0,
          allowed_models: null, allowed_providers: null, active_from: '', active_until: '', timezone: '',
          ...rules[agent.id],
        })
      case 'statement':
        return json({ agent_id: agent.id, lines: [] })
    }
    return new Response('null', { status: 404 })
  })
  return { agents, approvals, rules }
}

afterEach(() => {
  cleanup()
  queryClient.clear()
  vi.restoreAllMocks()
  window.history.pushState({}, '', '/')
})

async function createAgent(name: string) {
  fireEvent.change(screen.getByLabelText('New agent name'), { target: { value: name } })
  fireEvent.click(screen.getByRole('button', { name: 'Create agent' }))
  await waitFor(() => expect(screen.getByTestId('agent-open')).toHaveTextContent(name))
}

/** B57.23 — the open agent's rules, set on their own page: each rule switched on with its amount in dollars (B61.14), then saved. */
async function saveRules(name: string, rows: [string, string][], switches: string[] = []) {
  fireEvent.click(await screen.findByRole('link', { name: `Edit ${name}’s rules, see their history or ask whether a request would pass` }))
  await screen.findByRole('heading', { level: 1, name: `${name}’s rules` })
  for (const [rule, value] of rows) {
    fireEvent.click(screen.getByRole('switch', { name: rule }))
    fireEvent.change(screen.getByLabelText(`${rule} for ${name}, in dollars`), { target: { value } })
  }
  for (const rule of switches) fireEvent.click(screen.getByRole('switch', { name: rule }))
  fireEvent.click(screen.getByRole('button', { name: 'Save rules' }))
  await screen.findByText(`${name}’s rules are saved`)
  await waitFor(() => expect(screen.getByTestId('agent-open')).toHaveTextContent(name))
}

describe('Agent Bank', () => {
  // B57.19 — with no agents /agents says so, and New agent creates the first: its own page opens, and only then are there
  // approvals, spending and a forecast to show (B28.271). The plan is not read here, so the form shows and Lens judges.
  it('shows a workspace with no agents that it has none, and New agent opens the first one’s page', async () => {
    mockBff()
    window.history.pushState({}, '', '/agents')
    render(<App />)
    expect(await screen.findByText('No agents yet')).toBeInTheDocument()
    // B57.8 — the top bar's Pause every agent is on every page; the page draws none of its own.
    expect(screen.queryByTestId('pause-every-agent')).toBeNull()
    expect(screen.queryByTestId('agents-list')).toBeNull()
    for (const region of ['Approvals', 'Spending', 'Between owners', 'Held and cashed out'])
      expect(screen.queryByRole('region', { name: region })).toBeNull()

    fireEvent.click(screen.getAllByRole('button', { name: 'New agent' })[0])
    const dialog = await screen.findByRole('dialog', { name: 'New agent' })
    fireEvent.click(await within(dialog).findByRole('button', { name: /^Make your own/ }))
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'First' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create agent' }))
    await waitFor(() => expect(window.location.pathname).toBe('/agents/agt_1'))
    await waitFor(() => expect(screen.getByTestId('agent-open')).toHaveTextContent('First'))
    expect(screen.getByRole('region', { name: 'Approvals' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Spending' })).toBeInTheDocument()
  })

  // B55.7 — an approval nobody answered within its 24 hours reads Expired on the agent's screen too.
  it('shows an expired approval as Expired', async () => {
    const bff = mockBff()
    bff.agents.push({ id: 'agt_1', name: 'Researcher', balance_ulxc: 0, spent_ulxc: 0, keys: [], created_at: '2026-09-28T06:00:00Z' })
    bff.approvals.push({ id: 'apr_1', agent_id: 'agt_1', amount_ulxc: M, model: 'gpt-5', status: 'expired', created_at: '2026-09-27T06:00:00Z', fp: '' })
    window.history.pushState({}, '', '/agents/agt_1')
    render(<App />)
    const approvals = await screen.findByRole('region', { name: 'Approvals' })
    expect(await within(approvals).findByText('Expired')).toBeInTheDocument()
    expect(within(approvals).getByText('Not answered within 24 hours')).toBeInTheDocument()
  })

  // B61.14 — funding an agent and taking LXC back moved the parked LXC credit wallet: the agent's page draws neither
  // Move LXC nor Pay another agent, and says nothing of LXC. (B17.26's Take back through a restart, under one
  // Idempotency-Key, went with the Move LXC dialog; retryMoveThroughRestart is still used by Chat and by pots.)
  it('draws no Move LXC and no Pay another agent on an agent’s page', async () => {
    mockBff()
    window.history.pushState({}, '', '/agents/agt_1')
    render(<App />)
    await screen.findByTestId('agent-first')
    await createAgent('Writer')
    await createAgent('South')
    await screen.findByTestId('agent-setting-Scheduled payments')
    expect(screen.queryByRole('button', { name: 'Move LXC' })).toBeNull()
    expect(screen.queryByRole('dialog', { name: /^Move LXC/ })).toBeNull()
    expect(screen.queryByTestId('agent-setting-Pay another agent')).toBeNull()
    expect(screen.queryByLabelText(/^Payment in LXC from/)).toBeNull()
    expect(document.body.textContent).not.toMatch(/\bLXC\b/)
  })

  // B59.19 — "Can use Instant transfer" is off by default; turned on and saved, the rules carry it to Lens.
  it('turns on Can use Instant transfer and saves it with the rules', async () => {
    const bff = mockBff()
    window.history.pushState({}, '', '/agents/agt_1')
    render(<App />)
    await screen.findByTestId('agent-first')
    await createAgent('Researcher')
    fireEvent.click(await screen.findByRole('link', { name: 'Edit Researcher’s rules, see their history or ask whether a request would pass' }))
    const can = await screen.findByRole('switch', { name: 'Can use Instant transfer' })
    expect(can.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(can)
    expect(can.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Save rules' }))
    await screen.findByText('Researcher’s rules are saved')
    expect(bff.rules.agt_1.may_instant_transfer).toBe(true)
  })

  // B61.14 — the walk without the LXC credit wallet: the limits are typed in dollars at Lens's peg and saved in µLXC, and
  // a payment the agent asked Lens for, held above its approval amount, is approved from the inbox.
  it('creates an agent, saves its limits typed in dollars, and approves its held payment from the inbox', async () => {
    const bff = mockBff()
    window.history.pushState({}, '', '/agents/agt_1')
    render(<App />)

    await screen.findByTestId('agent-first')
    await createAgent('Writer')
    await createAgent('Researcher')

    await saveRules('Researcher', [['At most a day', '0.5'], ['Asks you above', '0.2']])
    expect(bff.rules.agt_2).toMatchObject({ currency: 'USD', daily_limit_minor: 50, approval_above_minor: 20 }) // $0.50 and $0.20, in cents (B61.87)

    // Researcher asks Lens itself for a payment above its approval amount: Lens holds it for the workspace's yes.
    bff.approvals.push({ id: 'apr_1', agent_id: 'agt_2', amount_ulxc: 3 * M, model: '', status: 'pending', created_at: '2026-09-28T06:05:00Z', fp: 'agt_2>agt_1:3000000:draft',
      payee: { kind: 'agent', id: 'agt_1', name: 'Writer' }, memo: 'draft' })
    await queryClient.invalidateQueries()
    // B27.21: the row reads single-spaced — the figure alone in the figure face, in dollars alone (B61.14).
    const asks = await screen.findByText(/wants to pay Writer/)
    expect(asks.textContent).toBe('Researcher wants to pay Writer $0.30 · draft')
    expect(asks.querySelector('.font-figure')?.textContent).toBe('$0.30')

    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(screen.getByText(/^Approved\./)).toHaveTextContent('Approved. Researcher’s next identical request goes through, once.'))
    expect(bff.approvals.map((a) => a.status)).toEqual(['approved'])
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
