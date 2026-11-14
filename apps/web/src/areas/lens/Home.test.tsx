import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, CONSOLE_ROUTES, queryClient } from '../../App'
import { PRODUCT_CARDS } from './Home'
import { nameFromEmail } from './Onboarding'

// B28.6 — the first screen after sign-in is the wallet home. DONE reads: "after sign-in a returning
// user lands on Home and sees per-agent budget-used and the approvals count". The mock BFF answers the
// routes Home reads exactly as Lens shapes them (economy.AgentBook, AgentRules, AgentApproval,
// SpendForecast), behind an oidc session that is signed in and not new.

const M = 1_000_000

const AGENTS = [
  { id: 'agt_1', name: 'Researcher', balance_ulxc: 6 * M, spent_ulxc: 4 * M, keys: [], created_at: '2026-10-01T09:00:00Z' },
  { id: 'agt_2', name: 'Buyer', balance_ulxc: 10 * M, spent_ulxc: 0, keys: [], created_at: '2026-10-01T09:05:00Z' },
]

const QUIET = { items: [], spent_yesterday: [], quiet: true, line: 'A quiet day: nothing was spent yesterday, and nothing is waiting for you.' }

// B41.6 — the morning after a day with two payments, one held approval and one bill due, as Lens's DailyBriefing writes it.
const BUSY = {
  items: [
    { kind: 'approval', id: 'apr_1', agent_id: 'agt_1', name: 'Acme Hosting', amount: 30 * M, currency: 'LXC', text: '30 LXC waits for your approval' },
    { kind: 'bill', id: 'bill_1', name: 'Northwind Supplies', amount: 4200, currency: 'GBP', due_date: '2026-10-31', text: 'A bill from Northwind Supplies for £42.00 is due' },
    { kind: 'payment', id: 'ent_1', agent_id: 'agt_1', name: 'Writer', amount: 30_000, currency: 'LXC', text: '0.03 LXC was paid to Writer' },
    { kind: 'payment', id: 'ent_2', agent_id: 'agt_1', name: 'Writer', amount: 45_000, currency: 'LXC', text: '0.045 LXC was paid to Writer' },
  ],
  spent_yesterday: [{ currency: 'LXC', amount: 75_000 }],
  quiet: false,
  line: '1 approval waiting, 1 bill due this week, 2 payments yesterday, spent yesterday 0.075 LXC.',
}

// B55.10 — a payment an assistant (client mcp:) prepared, and the briefing's line for it, as Lens lists it with its preq_ id.
const PREPARED = {
  id: 'preq_1', status: 'pending_approval', summary: '1 payment', client: 'mcp:tlv_oc_claude', agent_id: 'agt_1', totals: { GBP: 12000 }, created_at: '2026-10-04T08:20:00Z',
  items: [{ position: 1, payee_id: 'payee_1', payee_name: 'Acme Hosting', currency: 'GBP', amount_minor: 12000, reference: 'INV-7', decision: 'needs_approval', reason: 'above the £100.00 the mandate pays without asking' }],
}
const PREPARED_BRIEFING = {
  ...BUSY,
  items: [{ kind: 'approval', id: 'preq_1', name: 'Acme Hosting', amount: 12000, currency: 'GBP', text: 'A payment of £120.00 to Acme Hosting waits for your approval' }, ...BUSY.items],
}

function mockBff({
  agents,
  newWorkspace = false,
  briefing = QUIET,
  workspaceName = 'Acme',
  prepared = [],
}: {
  agents: Array<(typeof AGENTS)[number] & { paused_at?: string }>
  newWorkspace?: boolean
  briefing?: typeof QUIET | typeof BUSY | typeof PREPARED_BRIEFING
  workspaceName?: string
  prepared?: object[]
}) {
  const writes: string[] = []
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const json = (v: unknown, status = 200) =>
      new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    const allocated = agents.reduce((s, a) => s + a.balance_ulxc, 0)
    if (url === '/auth/me')
      return json({
        mode: 'oidc',
        authenticated: true,
        user: { sub: 'u1', email: 'owner@example.com' },
        workspace_id: 'ws_1',
        cache_poolable: false,
        needs_pooling_choice: newWorkspace,
      })
    if (url === '/api/agents')
      return json({
        workspace_balance_ulxc: 50 * M,
        allocated_ulxc: allocated,
        unallocated_ulxc: 50 * M - allocated,
        spent_ulxc: 4 * M,
        agents,
      })
    if (url === '/api/agents/approvals')
      return json({
        approvals: [
          { id: 'apr_1', agent_id: 'agt_1', amount_ulxc: 2 * M, model: 'gpt-4o', status: 'pending', created_at: '2026-10-04T08:00:00Z' },
          { id: 'apr_2', agent_id: 'agt_2', amount_ulxc: 3 * M, model: '', status: 'pending', created_at: '2026-10-04T08:10:00Z' },
          { id: 'apr_3', agent_id: 'agt_1', amount_ulxc: 1 * M, model: 'gpt-4o', status: 'approved', created_at: '2026-10-03T08:00:00Z' },
        ],
      })
    if (url === '/api/agents/safe-to-spend')
      return json({
        // B41.5 — the company's bills are in pounds: £500.00 held, a £42.00 bill due this month.
        company: [
          { currency: 'LXC', balance: 34 * M, scheduled: 0, bills_due: 0, pending_approvals: 0, safe_to_spend: 34 * M },
          { currency: 'GBP', balance: 50000, scheduled: 0, bills_due: 4200, pending_approvals: 0, safe_to_spend: 45800 },
        ],
        // Researcher holds 6 LXC with a 2 LXC approval waiting; Buyer holds 10 with a 3 LXC schedule and 3 waiting.
        agents: [
          { agent_id: 'agt_1', name: 'Researcher', figures: [{ currency: 'LXC', balance: 6 * M, scheduled: 0, bills_due: 0, pending_approvals: 2 * M, safe_to_spend: 4 * M }] },
          { agent_id: 'agt_2', name: 'Buyer', figures: [{ currency: 'LXC', balance: 10 * M, scheduled: 3 * M, bills_due: 0, pending_approvals: 3 * M, safe_to_spend: 4 * M }] },
        ],
      })
    if (url === '/api/agents/briefing') return json(briefing)
    if (url === '/api/money/payment-requests?status=pending_approval') return json({ requests: prepared })
    if (url === '/api/workspace/name' && init?.method === 'PUT') {
      workspaceName = JSON.parse(String(init.body)).name
      writes.push(`PUT ${url} ${init.body}`)
    }
    if (url === '/api/workspace/name') return json({ id: 'ws_1', name: workspaceName })
    if (/^\/api\/agents\/[^/]+\/(pause|resume)$/.test(url)) {
      writes.push(url)
      return json({ paused: url.endsWith('/pause') })
    }
    if (url === '/api/agents/forecast')
      return json({
        at: '2026-10-04T12:00:00Z',
        month_start: '2026-10-01T00:00:00Z',
        month_end: '2026-11-01T00:00:00Z',
        spent_ulxc: 3 * M,
        forecast_ulxc: 25 * M,
        // B28.57 — Researcher, in Sydney, runs out at 17:00 UTC on 27 October: 28 October in its own zone (Lens B28.330).
        // Buyer does not run out at its pace.
        agents: agents.map((a) => ({
          agent_id: a.id,
          name: a.name,
          spent_ulxc: a.id === 'agt_1' ? 3 * M : 0,
          forecast_ulxc: 0,
          ...(a.id === 'agt_1'
            ? { runs_out_at: '2026-10-28T04:00:00+11:00', runs_out_on: '2026-10-28', timezone: 'Australia/Sydney' }
            : { runs_out_at: null, runs_out_on: null, timezone: 'UTC' }),
        })),
      })
    const rules = /^\/api\/agents\/([^/]+)\/rules$/.exec(url)
    if (rules)
      return json({
        max_per_request_ulxc: 0,
        daily_limit_ulxc: 0,
        // Researcher's budget is 12 LXC a month; Buyer has none.
        monthly_limit_ulxc: rules[1] === 'agt_1' ? 12 * M : 0,
        approval_above_ulxc: 0,
        allowed_models: null,
        allowed_providers: null,
        active_from: '',
        active_until: '',
        timezone: '',
      })
    if (url === '/api/workspace/pooling' || url.startsWith('/api/')) return json({})
    return new Response('null', { status: 404 })
  })
  return writes
}

afterEach(() => {
  cleanup()
  queryClient.clear()
  vi.restoreAllMocks()
  window.history.pushState({}, '', '/')
})

describe('Home — the 30-second daily briefing (B41.6)', () => {
  it('after two payments, a held approval and a bill due, the morning briefing names all four with their amounts, approval first', async () => {
    mockBff({ agents: AGENTS, briefing: BUSY })
    render(<App />)

    await waitFor(() => expect(screen.getByTestId('home-briefing-line')).toHaveTextContent(BUSY.line))
    const items = within(screen.getByTestId('home-briefing-items')).getAllByRole('listitem')
    expect(items.map((li) => li.textContent)).toEqual([
      '30 LXC waits for your approvalAcme Hosting',
      'A bill from Northwind Supplies for £42.00 is duedue 2026-10-31',
      '0.03 LXC was paid to Writer',
      '0.045 LXC was paid to Writer',
    ])
    expect(within(items[0]).getByRole('link')).toHaveAttribute('href', '/?approval=apr_1')
    // It sits above the approvals card, the first thing on Home.
    const waiting = screen.getByRole('heading', { name: /^Waiting for you/ })
    expect(screen.getByTestId('home-briefing').compareDocumentPosition(waiting) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('a quiet day says so in one line, with nothing to open', async () => {
    mockBff({ agents: AGENTS })
    render(<App />)

    const card = await screen.findByTestId('home-briefing')
    await waitFor(() => expect(card).toHaveTextContent(QUIET.line))
    expect(card.tagName).toBe('DIV')
    expect(screen.queryByTestId('home-briefing-items')).not.toBeInTheDocument()
  })
})

describe('Home — payments prepared for the person (B55.10)', () => {
  it('lists a payment an assistant prepared first, counts it, and the briefing opens its card', async () => {
    mockBff({ agents: AGENTS, briefing: PREPARED_BRIEFING, prepared: [PREPARED] })
    render(<App />)

    const list = within(await screen.findByTestId('home-approvals'))
    // B57.116 — drawn as w-home draws a waiting request: Chat's mark, the line over its hint, the total over its
    // currency, and Pocket's Review opening the request's card.
    const row = list.getByText('Your assistant prepared a payment to Acme Hosting').closest<HTMLElement>('[data-prepared]')!
    expect(row).toHaveAttribute('data-prepared', 'preq_1')
    expect(row.querySelector('[data-icon="chat"]')).not.toBeNull()
    expect(row).toHaveTextContent('INV-7 · from Researcher’s account · asked')
    expect(within(row).getByText('£120.00')).toBeInTheDocument()
    expect(within(row).getByText('GBP')).toBeInTheDocument()
    const review = within(row).getByRole('link', { name: 'Review' })
    expect(review).toHaveAttribute('href', '/approve/preq_1')
    expect(review).toHaveClass('rounded-pill')
    expect(screen.getByTestId('home-approvals-waiting')).toHaveTextContent('3')
    await waitFor(() => expect(screen.getByTestId('home-briefing-line')).toHaveTextContent(BUSY.line))
    const items = within(screen.getByTestId('home-briefing-items')).getAllByRole('listitem')
    expect(within(items[0]).getByRole('link')).toHaveAttribute('href', '/approve/preq_1')
  })
})

describe('Home — the wallet home (B28.6)', () => {
  it('a returning user lands on Home and sees each agent’s budget used and the approvals waiting', async () => {
    mockBff({ agents: AGENTS })
    window.history.pushState({}, '', '/')
    render(<App />)

    expect(await screen.findByRole('heading', { level: 2, name: 'Welcome to Talyvor' })).toBeInTheDocument()
    expect(await screen.findByText('Your agents’ wallets, at a glance.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Home')


    // Researcher spent 3 of its 12 LXC monthly budget: 25%. Buyer has no budget, so it is offered one.
    expect(await screen.findByTestId('home-budget-used-agt_1')).toHaveTextContent('25%')
    expect(screen.getByRole('progressbar', { name: 'Researcher’s monthly budget used' })).toHaveAttribute('aria-valuenow', '25')
    const buyer = screen.getByText(/no monthly budget set/).closest('div.flex.min-h-row') as HTMLElement
    expect(within(buyer).getByText('Buyer')).toBeInTheDocument()
    expect(within(buyer).getByRole('link', { name: 'Set a budget' })).toHaveAttribute('href', '/agents')

    // The rest of the home: the forecast, and pause-all.
    expect(await screen.findByTestId('home-forecast')).toHaveTextContent('25 LXC')
    expect(within(screen.getByTestId('pause-every-agent')).getByRole('button', { name: 'Pause every agent' })).toBeInTheDocument()
  })

  // B45.11 — DONE reads: "the approvals, the total and the first agent rows are visible without scrolling; every
  // figure matches the API". jsdom has no fold, so this pins the order and the figures; the 390px screenshot the fold.
  it('each agent’s row says the day it runs out in its own time zone, not UTC’s, or that it does not run out (B28.57)', async () => {
    mockBff({ agents: AGENTS })
    render(<App />)

    const researcher = await screen.findByTestId('runs-out-agt_1')
    expect(researcher).toHaveTextContent('runs out on 28 October 2026 (Australia/Sydney)')
    expect(within(researcher).getByText('28 October 2026')).toHaveAttribute('dateTime', '2026-10-28')
    expect(screen.getByTestId('runs-out-agt_2')).toHaveTextContent('does not run out at this pace')
  })

  it('Home in one glance: approvals first, then one total, then a row per agent, then Taly’s input', async () => {
    const writes = mockBff({ agents: AGENTS })
    window.history.pushState({}, '', '/')
    render(<App />)

    // Two pending, one decided: the pending two are listed, each opening its own card on Approvals.
    expect(await screen.findByTestId('home-approvals-waiting')).toHaveTextContent('2')
    const approvals = screen.getByTestId('home-approvals')
    const links = within(approvals).getAllByRole('link')
    expect(links.map((l) => l.getAttribute('href'))).toEqual(['/?approval=apr_1', '/?approval=apr_2'])
    expect(links[0]).toHaveTextContent(/Researcher.*2 LXC/)

    // One total: what the agents hold together (6 + 10), and what the workspace has not given out.
    const total = screen.getByTestId('home-total')
    expect(total).toHaveTextContent('16 LXC')
    expect(screen.getByTestId('home-unallocated')).toHaveTextContent('34 LXC')

    // A card per agent (B57.16): balance, and safe to spend as Lens reports it.
    const researcher = screen.getByTestId('agent-card-agt_1')
    expect(within(researcher).getByTestId('agent-card-balance-agt_1')).toHaveTextContent('6 LXC')
    await waitFor(() => expect(within(researcher).getByTestId('agent-card-safe-agt_1')).toHaveTextContent('4 LXC safe to spend'))
    expect(screen.getByTestId('agent-card-safe-agt_2')).toHaveTextContent('4 LXC safe to spend')
    // B41.5 — the company's safe to spend, per currency, its bills due taken off.
    const pounds = await screen.findByTestId('home-company-safe-GBP')
    expect(pounds).toHaveTextContent('£458.00')
    expect(document.body).toHaveTextContent('£500.00 held, less £0.00 scheduled, £42.00 in bills due and £0.00 waiting for approval')

    const ask = screen.getByRole('textbox', { name: 'Ask Taly' })
    const order = [approvals, total, researcher, ask]
    for (let i = 1; i < order.length; i++) expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // …and the product cards come after all of it.
    expect(ask.compareDocumentPosition(screen.getByRole('list', { name: 'Products' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    // B57.16 — switching off pauses at once; only resuming asks first, and signs.
    fireEvent.click(within(researcher).getByRole('switch', { name: 'Pause Researcher' }))
    await waitFor(() => expect(writes).toEqual(['/api/agents/agt_1/pause']))

    // Taly's input takes the question to Chat.
    fireEvent.change(ask, { target: { value: 'Which agent spent most?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
    expect(window.location.pathname).toBe('/chat')
    expect(await screen.findByDisplayValue('Which agent spent most?')).toBeInTheDocument()
  })

  // B55.2 — with only the phone's key Lens refuses an unsigned resume, so Home sends none and says where to do it.
  it('with only the phone’s key, the switch on a paused agent sends nothing and says to resume it on the phone', async () => {
    const writes = mockBff({ agents: [{ ...AGENTS[0], paused_at: '2026-10-04T09:00:00Z' }, AGENTS[1]] })
    const inner = vi.mocked(fetch).getMockImplementation()!
    const keys: Record<string, unknown> = { '/api/agents/passkeys': { passkeys: [] }, '/api/money/devices': { devices: [{ id: 'dk_1', platform: 'ios', name: 'Work iPhone' }] } }
    vi.mocked(fetch).mockImplementation(async (input, init) =>
      String(input) in keys ? new Response(JSON.stringify(keys[String(input)]), { status: 200, headers: { 'Content-Type': 'application/json' } }) : inner(input, init),
    )
    window.history.pushState({}, '', '/')
    render(<App />)
    const researcher = await screen.findByTestId('agent-card-agt_1')
    await waitFor(() => expect(queryClient.getQueryState(['money-devices'])?.status).toBe('success'))
    fireEvent.click(within(researcher).getByRole('switch', { name: 'Resume Researcher' }))
    const resume = await screen.findByRole('dialog', { name: 'Resume Researcher?' })
    expect(within(resume).getByTestId('on-the-phone')).toHaveTextContent('Resume Researcher on your phone with Face ID.')
    expect(within(resume).getByRole('link', { name: 'Add this browser' })).toHaveAttribute('href', '/approvals')
    expect(within(resume).queryByRole('button', { name: 'Resume with your passkey' })).toBeNull()
    expect(writes).toEqual([])
  })

  it('a workspace with no agents opens Home in onboarding mode', async () => {
    mockBff({ agents: [] })
    window.history.pushState({}, '', '/')
    render(<App />)

    expect(await screen.findByText('Give every agent a wallet.')).toBeInTheDocument()
    expect(screen.getByTestId('home-onboarding')).toHaveTextContent('your first agent is one click away')
    expect(screen.getByRole('button', { name: 'Create my first agent' })).toBeEnabled()
    expect(screen.queryByTestId('home-approvals-waiting')).not.toBeInTheDocument()
  })
})

// B55.39 — Lens names a new workspace by its id and makes "My first agent" at sign-up, so the book is never
// empty and the onboarding card, which names the workspace, never shows. Home asks first instead.
describe('Home — a new workspace is asked its name (B55.39)', () => {
  const FIRST = [{ id: 'agt_first', name: 'My first agent', balance_ulxc: 0, spent_ulxc: 0, keys: [], created_at: '2026-11-06T09:00:00Z' }]

  it('while the name is the id, Home asks for it first, Save name PUTs it, and the sidebar then shows it', async () => {
    const writes = mockBff({ agents: FIRST, workspaceName: 'ws_1' })
    render(<App />)

    const card = await screen.findByTestId('name-workspace')
    expect(card).toHaveTextContent('Name your workspace')
    expect(card).toHaveTextContent('It shows under the logo and on your invoices.')
    expect(screen.getByTestId('sidebar-workspace-name')).toHaveTextContent('Your workspace')
    expect(screen.queryByText('ws_1')).not.toBeInTheDocument()
    // It comes before the briefing, the first thing Home shows a workspace with agents.
    await screen.findByTestId('home-briefing')
    expect(card.compareDocumentPosition(screen.getByTestId('home-briefing')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    fireEvent.change(within(card).getByLabelText('Workspace name'), { target: { value: 'Acme Labs' } })
    fireEvent.click(within(card).getByRole('button', { name: 'Save name' }))

    expect(await screen.findByText('Saved. Your workspace has a name now.')).toBeInTheDocument()
    expect(screen.queryByTestId('name-workspace')).not.toBeInTheDocument()
    expect(writes).toEqual(['PUT /api/workspace/name {"name":"Acme Labs"}'])
    await waitFor(() => expect(screen.getByTestId('sidebar-workspace-name')).toHaveTextContent('Acme Labs'))
  })

  it('a workspace with a real name is not asked', async () => {
    mockBff({ agents: FIRST })
    render(<App />)

    await waitFor(() => expect(screen.getByTestId('sidebar-workspace-name')).toHaveTextContent('Acme'))
    await screen.findByTestId('home-briefing')
    expect(screen.queryByTestId('name-workspace')).not.toBeInTheDocument()
  })
})

// B46.2 — a brand-new workspace reaches Home with a funded, keyed first agent in one click, with no consent
// page and no disclaimer sentence (B46.14). The BFF below keeps state the way Lens
// does: an agent created, the workspace's free LXC moved into it, a key issued.
function mockNewWorkspace() {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  const writes: { path: string; body: unknown }[] = []
  let agent: { id: string; name: string; balance_ulxc: number; spent_ulxc: number; keys: string[]; created_at: string; owner_user_id: string } | null = null
  let rules = { max_per_request_ulxc: 0, daily_limit_ulxc: 0, monthly_limit_ulxc: 0, approval_above_ulxc: 0, allowed_models: null, allowed_providers: null, active_from: '', active_until: '', timezone: '' }
  const lines: object[] = []
  let workspaceName = 'new@example.com'
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    if (method !== 'GET') writes.push({ path: `${method} ${url}`, body })
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me')
      return json({ mode: 'oidc', authenticated: true, user: { sub: 'u1', email: 'new@example.com' }, workspace_id: 'ws_new', cache_poolable: true, needs_pooling_choice: true })
    if (url === '/api/context') return json({ workspace_id: 'ws_new', lens_base_url: 'http://lens:8080', lens_public_base_url: 'https://lens.example.com' })
    if (url === '/api/workspace/name' && method === 'PUT') workspaceName = body.name
    if (url === '/api/workspace/name') return json({ id: 'ws_new', name: workspaceName })
    if (url === '/api/agents' && method === 'POST') {
      agent = { id: 'agt_new', name: body.name, balance_ulxc: 0, spent_ulxc: 0, keys: [], created_at: '2026-10-04T12:00:00Z', owner_user_id: 'u1' }
      return json(agent, 201)
    }
    if (url === '/api/agents') {
      const allocated = agent?.balance_ulxc ?? 0
      return json({ workspace_balance_ulxc: 20 * M, allocated_ulxc: allocated, unallocated_ulxc: 20 * M - allocated, spent_ulxc: 0, agents: agent ? [agent] : [] })
    }
    if (url === '/api/agents/agt_new/rules' && method === 'PUT') return json((rules = body))
    if (url === '/api/agents/agt_new/rules') return json(rules)
    if (url === '/api/agents/agt_new/fund' && agent) {
      agent.balance_ulxc += body.amount_ulxc
      lines.unshift({ entry_id: 'e1', kind: 'fund', amount_ulxc: body.amount_ulxc, counterparty: 'workspace', balance_after_ulxc: agent.balance_ulxc, at: '2026-10-04T12:01:00Z' })
      return json({ balance_ulxc: agent.balance_ulxc })
    }
    if (url === '/api/agents/agt_new/keys' && agent) {
      agent.keys.push('tlv_ak_1234')
      return json({ agent_id: 'agt_new', key: 'tlv_ak_1234secret', id: 'key_1', prefix: 'tlv_ak_1234' }, 201)
    }
    if (url === '/api/agents/agt_new/statement') {
      // The agent's first request, sent with its key, is on the statement once the key exists.
      if (agent && agent.keys.length > 0 && lines.length === 1) {
        agent.balance_ulxc -= 1200
        lines.unshift({ entry_id: 'e2', kind: 'spend', amount_ulxc: -1200, counterparty: 'provider:anthropic', balance_after_ulxc: agent.balance_ulxc, at: '2026-10-04T12:02:00Z' })
      }
      return json({ lines })
    }
    if (url === '/api/agents/approvals') return json({ approvals: [] })
    if (url === '/api/agents/forecast') return json({ spent_ulxc: 0, forecast_ulxc: 0, agents: [] })
    if (url === '/api/wallets/capabilities') return json({ capabilities: [] })
    if (url.startsWith('/api/')) return json({})
    return new Response('null', { status: 404 })
  })
  return writes
}

describe('Home — the first agent in one click (B46.2)', () => {
  it('a brand-new workspace reaches a funded agent with a key in one click, with no disclaimer sentence', async () => {
    const writes = mockNewWorkspace()
    window.history.pushState({}, '', '/')
    render(<App />)

    expect(await screen.findByText('Give every agent a wallet.')).toBeInTheDocument()
    expect(screen.queryByText(/Share your answers, and earn from them/i)).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /Share answers with other companies/i })).toBeChecked()
    expect(await screen.findByTestId('wallet-onboarding')).not.toHaveTextContent(/real money|money partner/i)

    // B46.16 — the workspace's name, prefilled from the email's domain, saved in the same click.
    expect(screen.getByLabelText('Workspace name')).toHaveValue('Example')
    fireEvent.change(screen.getByLabelText('Workspace name'), { target: { value: 'Acme Labs' } })
    fireEvent.change(screen.getByLabelText('Agent name'), { target: { value: 'Researcher' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create my first agent' }))

    const ready = await screen.findByTestId('first-agent-ready')
    expect(ready).toHaveTextContent('Your first agent is ready')
    expect(ready).toHaveTextContent('Researcher holds 20 LXC.')
    expect(screen.getByTestId('onboarding-key')).toHaveTextContent('tlv_ak_1234secret')
    expect(within(screen.getByTestId('onboarding-key')).getByRole('button', { name: /copy/i })).toBeInTheDocument()
    expect(screen.getAllByText(/OPENAI_API_KEY="tlv_ak_1234secret"/).length).toBeGreaterThan(0)

    // What reached the BFF, in order: the agent, all the workspace's free credit into it, the key.
    expect(writes.map((w) => w.path)).toEqual(['PUT /api/workspace/name', 'POST /api/agents', 'POST /api/agents/agt_new/fund', 'POST /api/agents/agt_new/keys'])
    expect(writes[0].body).toEqual({ name: 'Acme Labs' })
    expect(writes[2].body).toEqual({ amount_ulxc: 20 * M })
    expect(await screen.findByTestId('sidebar-workspace-name')).toHaveTextContent('Acme Labs')

    // Home hands back its wallets view.
    fireEvent.click(screen.getByRole('button', { name: 'Go to Home' }))
    expect(await screen.findByText('Your agents’ wallets, at a glance.')).toBeInTheDocument()
  })

  it('a webmail address prefills no workspace name', () => {
    expect(nameFromEmail('ada@gmail.com')).toBe('')
    expect(nameFromEmail('ada@acme.co.uk')).toBe('Acme')
  })
})

// B29.8 — DONE reads: "every card opens its existing route; every figure the home shows today is still
// shown". The figures are the first describe's; this clicks each card from a freshly opened Home and reads
// the address and the top bar's title, which is the route table's own name for the page it landed on.
describe('Home — the product cards (B29.8)', () => {
  it('every card opens its existing route', async () => {
    mockBff({ agents: AGENTS })
    for (const card of PRODUCT_CARDS) {
      window.history.pushState({}, '', '/')
      render(<App />)
      const cards = await screen.findByRole('list', { name: 'Products' })
      const link = within(cards).getByRole('link', { name: new RegExp(`^${card.title}`) })
      expect(link).toHaveAttribute('href', card.to)
      expect(link.querySelector('svg[data-icon]')).not.toBeNull()
      fireEvent.click(link)
      expect(window.location.pathname).toBe(card.to)
      const route = CONSOLE_ROUTES.find((r) => (r.path.endsWith('/*') ? card.to === r.path.slice(0, -2) : r.path === card.to))
      expect(route, `${card.to} is not a console route`).toBeDefined()
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(route!.title)
      cleanup()
      queryClient.clear()
    }
    expect(PRODUCT_CARDS.map((c) => c.title)).toEqual(['Agent Wallets', 'Approvals', 'Statements', 'Chat', 'Marketplace', 'Track', 'Docs', 'Developers'])
  })
})
