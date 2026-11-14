import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B19.4 — the Agent Bank, walked the way its DONE line reads: create an agent, fund it, set a daily
// limit, watch a payment over that limit refused with Lens's sentence, and approve a payment from the
// inbox. The mock BFF keeps balances and judges the two rules the walk needs the way Lens does
// (internal/economy/agent_rules.go): the daily limit before the approval amount, and an approved
// payment let through once.

const M = 1_000_000

function mockBff({ hold = 'sentence' }: { hold?: 'sentence' | 'accepted' } = {}) {
  const agents: Array<{ id: string; name: string; balance_ulxc: number; spent_ulxc: number; keys: string[]; created_at: string }> = []
  const rules: Record<string, Record<string, unknown>> = {}
  const approvals: Array<{ id: string; agent_id: string; amount_ulxc: number; model: string; status: string; created_at: string; fp: string; payee?: { kind: 'agent'; id: string; name: string }; memo?: string }> = []
  let workspace = 100 * M
  const paid: Record<string, number> = {}
  const moveKeys: string[] = []
  const blips: Array<502 | 'drop'> = []
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
    const json = (v: unknown, status = 200) =>
      new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    const allocated = () => agents.reduce((s, a) => s + a.balance_ulxc, 0)
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
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
    const r = rules[agent.id] ?? {}
    switch (m[2]) {
      case 'fund':
        agent.balance_ulxc += Number(body.amount_ulxc)
        return json({ agent_id: agent.id, balance_ulxc: agent.balance_ulxc })
      case 'withdraw': {
        moveKeys.push(new Headers(init?.headers).get('Idempotency-Key') ?? '')
        const blip = blips.shift()
        if (blip === 502) return json({ error: 'Lens could not answer just now' }, 502)
        if (blip === 'drop') throw new TypeError('Failed to fetch')
        agent.balance_ulxc -= Number(body.amount_ulxc)
        return json({ agent_id: agent.id, balance_ulxc: agent.balance_ulxc })
      }
      case 'rules':
        if (method === 'PUT') rules[agent.id] = body
        return json({
          max_per_request_ulxc: 0, daily_limit_ulxc: 0, monthly_limit_ulxc: 0, approval_above_ulxc: 0,
          allowed_models: null, allowed_providers: null, active_from: '', active_until: '', timezone: '',
          ...rules[agent.id],
        })
      case 'statement':
        return json({ agent_id: agent.id, lines: [] })
      case 'pay': {
        const amount = Number(body.amount_ulxc)
        const daily = Number(r.daily_limit_ulxc ?? 0)
        const spent = paid[agent.id] ?? 0
        if (daily > 0 && spent + amount > daily)
          return json({ error: `economy: the agent's spending rules refuse this request: the agent has spent ${spent / M} LXC of its daily limit of ${daily / M} LXC, and this payment would cost up to ${amount / M} LXC` }, 403)
        const fp = `${agent.id}>${String(body.to_agent_id)}:${amount}:${String(body.memo)}`
        if (Number(r.approval_above_ulxc ?? 0) > 0 && amount > Number(r.approval_above_ulxc)) {
          const ok = approvals.find((x) => x.fp === fp && x.status === 'approved')
          if (ok) ok.status = 'used'
          else {
            let open = approvals.find((x) => x.fp === fp && x.status === 'pending')
            if (!open) {
              // Lens B23.5: the approval names who it pays and why.
              const payee = agents.find((a) => a.id === body.to_agent_id)!
              open = { id: `apr_${approvals.length + 1}`, agent_id: agent.id, amount_ulxc: amount, model: '', status: 'pending', created_at: '2026-09-28T06:05:00Z', fp,
                payee: { kind: 'agent', id: payee.id, name: payee.name }, memo: String(body.memo) }
              approvals.push(open)
            }
            // B58.2: Lens answers a held payment 202 with the approval as a field, and the same words as its message.
            if (hold === 'accepted')
              return json({ status: 'pending_approval', approval_id: open.id, amount_ulxc: amount,
                message: `economy: payment of ${amount / M} LXC is above the agent's approval amount. Approval ${open.id} must be approved before it is sent` }, 202)
            return json({ error: `this request would cost up to ${amount / M} LXC, above the agent's approval amount — approval ${open.id} must be approved by the workspace's owner before it is retried` }, 403)
          }
        }
        const to = agents.find((a) => a.id === body.to_agent_id)!
        agent.balance_ulxc -= amount
        to.balance_ulxc += amount
        paid[agent.id] = spent + amount
        return json({ entry_id: 'e1', from_agent_id: agent.id, to_agent_id: to.id, amount_ulxc: amount, from_balance_ulxc: agent.balance_ulxc, to_balance_ulxc: to.balance_ulxc, memo: body.memo })
      }
    }
    return new Response('null', { status: 404 })
  })
  return { agents, approvals, moveKeys, blips, rules, setWorkspace: (v: number) => (workspace = v) }
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

/** B57.16 — the open agent's Move LXC: the amount typed, then Fund <agent> or Take back. */
async function moveLxc(name: string, amount: string, press: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Move LXC' }))
  const dialog = await screen.findByRole('dialog', { name: `Move LXC: ${name}` })
  fireEvent.change(within(dialog).getByLabelText('Amount in LXC'), { target: { value: amount } })
  fireEvent.click(within(dialog).getByRole('button', { name: press }))
}

/** B57.23 — the open agent's rules, set on their own page: each rule switched on with its amount, then saved. */
async function saveRules(name: string, rows: [string, string][], switches: string[] = []) {
  fireEvent.click(await screen.findByRole('link', { name: `Edit ${name}’s rules, see their history or ask whether a request would pass` }))
  await screen.findByRole('heading', { level: 1, name: `${name}’s rules` })
  for (const [rule, value] of rows) {
    fireEvent.click(screen.getByRole('switch', { name: rule }))
    fireEvent.change(screen.getByLabelText(`${rule} for ${name}, in LXC`), { target: { value } })
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
    fireEvent.change(await within(dialog).findByLabelText('Name'), { target: { value: 'First' } })
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

  // B17.26 — a Take back that meets a deploy's restart (a 502, then no answer) is sent again under one
  // Idempotency-Key and lands, instead of "Nothing changed. You can try again."
  it('takes LXC back through a restart, sending the same key until it is answered', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const bff = mockBff()
      window.history.pushState({}, '', '/agents/agt_1')
      render(<App />)
      await screen.findByTestId('agent-first')
      await createAgent('South')
      await moveLxc('South', '1', 'Fund South')
      await waitFor(() => expect(screen.getByTestId('agent-balance-agt_1')).toHaveTextContent('1 LXC'))

      bff.blips.push(502, 'drop')
      await moveLxc('South', '0.25', 'Take back')
      await vi.advanceTimersByTimeAsync(4_000) // the dialog's two retry delays, without waiting them out
      await waitFor(() => expect(screen.getByText(/South now holds/)).toHaveTextContent('South now holds 0.75 LXC'))
      expect(screen.queryByRole('alert')).toBeNull()
      expect(bff.moveKeys).toHaveLength(3)
      expect(bff.moveKeys[0]).not.toBe('')
      expect(new Set(bff.moveKeys).size).toBe(1)
    } finally {
      vi.useRealTimers()
    }
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

  it('creates and funds an agent, refuses a payment over its daily limit, and pays once approved from the inbox', async () => {
    const bff = mockBff()
    window.history.pushState({}, '', '/agents/agt_1')
    render(<App />)

    await screen.findByTestId('agent-first')
    await createAgent('Writer')
    await createAgent('Researcher')

    await moveLxc('Researcher', '10', 'Fund Researcher')
    await waitFor(() => expect(screen.getByTestId('agent-balance-agt_2')).toHaveTextContent('10 LXC'))
    expect(screen.getByTestId('agent-bank-totals')).toHaveTextContent('10 LXC with its agents and 90 LXC free to fund them')

    await saveRules('Researcher', [['At most a day', '5'], ['Asks you above', '2']])

    const pay = within(screen.getByRole('group', { name: 'Pay to' }))
    fireEvent.click(pay.getByRole('button', { name: 'Writer' }))
    fireEvent.change(screen.getByLabelText('Payment in LXC from Researcher'), { target: { value: '6' } })
    fireEvent.click(screen.getByRole('button', { name: 'Pay' }))
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        "Refused. The agent's spending rules refuse this request: the agent has spent 0 LXC of its daily limit of 5 LXC, and this payment would cost up to 6 LXC.",
      ),
    )
    expect(screen.getByTestId('agent-balance-agt_2')).toHaveTextContent('10 LXC')

    fireEvent.change(screen.getByLabelText('Payment in LXC from Researcher'), { target: { value: '3' } })
    fireEvent.change(screen.getByLabelText('What the payment is for'), { target: { value: 'draft' } })
    fireEvent.click(screen.getByRole('button', { name: 'Pay' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('It is waiting in Approvals'))
    expect(bff.approvals.map((a) => a.status)).toEqual(['pending'])
    // B27.21: the row reads single-spaced — the figure alone in the figure face, " LXC" in the sentence's.
    const asks = await screen.findByText(/wants to pay Writer/)
    expect(asks.textContent).toBe('Researcher wants to pay Writer 3 LXC · draft')
    expect(asks.querySelector('.font-figure')?.textContent).toBe('3 LXC')

    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }))
    await waitFor(() =>
      expect(screen.getByText(/Approved and paid/)).toHaveTextContent('Approved and paid 3 LXC from Researcher to Writer.'),
    )
    expect(bff.approvals.map((a) => a.status)).toEqual(['used'])
    expect(screen.queryByRole('alert')).toBeNull()
    await waitFor(() => expect(screen.getByTestId('agent-balance-agt_2')).toHaveTextContent('7 LXC'))
    expect(screen.getByTestId('agent-balance-agt_1')).toHaveTextContent('3 LXC')
  })

  // B58.1 — Lens answers a held payment 202 {"status":"pending_approval","approval_id"} (B58.2): the screen says it
  // waits in Approvals, the same as the sentence says it today, and never that it was paid.
  it('shows a payment Lens answers as pending approval as waiting in Approvals, never as paid', async () => {
    const bff = mockBff({ hold: 'accepted' })
    window.history.pushState({}, '', '/agents/agt_1')
    render(<App />)

    await screen.findByTestId('agent-first')
    await createAgent('Writer')
    await createAgent('Researcher')
    await moveLxc('Researcher', '10', 'Fund Researcher')
    await waitFor(() => expect(screen.getByTestId('agent-balance-agt_2')).toHaveTextContent('10 LXC'))
    await saveRules('Researcher', [['Asks you above', '2']])

    fireEvent.click(within(screen.getByRole('group', { name: 'Pay to' })).getByRole('button', { name: 'Writer' }))
    fireEvent.change(screen.getByLabelText('Payment in LXC from Researcher'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Pay' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('It is waiting in Approvals'))
    expect(screen.getByRole('alert')).toHaveTextContent('Approval apr_1 must be approved before it is sent.')
    expect(screen.queryByText(/^Paid /)).toBeNull()
    expect(bff.approvals.map((a) => a.status)).toEqual(['pending'])
    expect(screen.getByTestId('agent-balance-agt_2')).toHaveTextContent('10 LXC')
    expect(await screen.findByText(/wants to pay Writer/)).toHaveTextContent('Researcher wants to pay Writer 3 LXC')
  })
})
