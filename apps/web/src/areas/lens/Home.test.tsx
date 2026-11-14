import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'
import { greeting, pausedLine, planLine, waitingLine } from './Home'
import { nameFromEmail } from './Onboarding'
import { markWelcomed } from '../auth/Welcome'

// B57.18 — Home as the launch pack's W2 draws it, with Lens's figures. The mock BFF answers the routes Home reads exactly
// as Lens shapes them (economy.AgentBook, AgentRules, AgentApproval, SpendForecast, CurrencyAccount, the agent's wallet,
// the plan through GET /api/plan), behind an oidc session that is signed in and not new.

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
  mandates = [],
  account = { account_type: 'business', money_kind: 'hybrid' },
  accounts = [],
  wallets = {},
  plan = { plan: 'free', agents: 3, agents_used: 2, seats: 1 },
  allPaused = false,
}: {
  agents: Array<(typeof AGENTS)[number] & { paused_at?: string }>
  newWorkspace?: boolean
  briefing?: typeof QUIET | typeof BUSY | typeof PREPARED_BRIEFING
  workspaceName?: string
  prepared?: object[]
  mandates?: object[]
  account?: { account_type: string; money_kind: string }
  accounts?: object[]
  wallets?: Record<string, number>
  plan?: object
  allPaused?: boolean
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
        ...(allPaused ? { all_paused_at: '2026-10-04T09:00:00Z' } : {}),
      })
    if (url === '/api/workspace/account') return json(account)
    if (url === '/api/money/accounts') return json({ accounts })
    if (url === '/api/fx') return json({ rate_date: '2026-10-03', usd_per_eur: 1.2, gbp_per_eur: 0.8 })
    if (url === '/api/plan') return json(plan)
    const wallet = /^\/api\/agents\/([^/]+)\/wallet$/.exec(url)
    if (wallet)
      return json({ account_id: `macc_${wallet[1]}`, agent_id: wallet[1], asset: 'USDC', partner: 'sandbox', balance_minor: wallets[wallet[1]] ?? 0, receive: { asset: 'USDC' }, mode: 'TEST' })
    if (/^\/api\/agents\/[^/]+\/card$/.test(url)) return url.includes('agt_1') ? json({ card: { id: 'ic_1', agent_id: 'agt_1', last4: '4242', exp_month: 9, exp_year: 2029, currency: 'usd', livemode: false, created_at: '2026-10-01T09:00:00Z' }, authorizations: [] }) : new Response('{}', { status: 404 })
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
    if (url === '/api/money/mandates?status=requested') return json({ granted: mandates, received: [] })
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
  sessionStorage.clear()
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
    // It sits above the waiting card, under the greeting.
    const waiting = screen.getByRole('heading', { name: 'Waiting for your yes' })
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

describe('Home — the greeting and what needs you (B57.18)', () => {
  it('greets by the time of day and the person’s first name', () => {
    expect(greeting(8, 'Maya')).toBe('Good morning, Maya')
    expect(greeting(14, 'Maya')).toBe('Good afternoon, Maya')
    expect(greeting(21, '')).toBe('Good evening')
    expect(greeting(2, 'Nick')).toBe('Good evening, Nick')
  })

  it('says how many things wait, for none to three', () => {
    expect([0, 1, 2, 3].map(waitingLine)).toEqual([
      'You’re all caught up.',
      '1 thing is waiting for you.',
      '2 things are waiting for you.',
      '3 things are waiting for you.',
    ])
  })

  it('names the paused agents for every mix, and says when every agent is paused', () => {
    const a = (name: string, paused = false) => ({ ...AGENTS[0], id: name, name, ...(paused ? { paused_at: '2026-10-04T09:00:00Z' } : {}) })
    expect(pausedLine({ agents: [a('Ops'), a('Sales')] })).toBe('')
    expect(pausedLine({ agents: [a('Ops', true), a('Sales')] })).toBe('Ops is paused.')
    expect(pausedLine({ agents: [a('Ops', true), a('Sales', true), a('Ads')] })).toBe('Ops and Sales are paused.')
    expect(pausedLine({ agents: [a('Ops', true), a('Sales', true), a('Ads', true), a('Max')] })).toBe('Ops, Sales and Ads are paused.')
    expect(pausedLine({ agents: [a('Ops', true), a('Sales', true)] })).toBe('Every agent is paused.')
    expect(pausedLine({ agents: [a('Ops')], all_paused_at: '2026-10-04T09:00:00Z' })).toBe('Every agent is paused.')
    expect(pausedLine({ agents: [a('Ops', true)] })).toBe('Ops is paused.')
    expect(pausedLine({ agents: [] })).toBe('')
  })

  it('a Personal account is greeted by its first name, with what waits and who is paused under it', async () => {
    mockBff({
      agents: [AGENTS[0], { ...AGENTS[1], paused_at: '2026-10-04T09:00:00Z' }],
      account: { account_type: 'personal', money_kind: 'fiat' },
      workspaceName: 'Maya Lind',
    })
    render(<App />)

    expect(await screen.findByRole('heading', { level: 2, name: /^Good (morning|afternoon|evening), Maya$/ })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('home-status')).toHaveTextContent('2 things are waiting for you. Buyer is paused.'))
    // Its products are in the sidebar, not on Home.
    expect(screen.queryByRole('list', { name: 'Products' })).toBeNull()
  })

  it('a Business is greeted by the time of day alone: its name is the company’s', async () => {
    mockBff({ agents: AGENTS, workspaceName: 'Northwind Studio' })
    render(<App />)
    expect(await screen.findByRole('heading', { level: 2, name: /^Good (morning|afternoon|evening)$/ })).toBeInTheDocument()
  })
})

describe('Home — waiting for your yes (B57.18)', () => {
  it('lists the agents’ requests as Approvals does, each with Review, and the count opens Approvals', async () => {
    mockBff({ agents: AGENTS })
    render(<App />)

    const card = (await screen.findByRole('heading', { name: 'Waiting for your yes' })).closest('div.rounded-card') as HTMLElement
    expect(within(card).getByTestId('home-approvals-waiting')).toHaveTextContent('2')
    expect(within(card).getByRole('link', { name: '2 waiting, open Approvals' })).toHaveAttribute('href', '/approvals')
    const links = within(screen.getByTestId('home-approvals')).getAllByRole('link', { name: /^Review/ })
    expect(links.map((l) => l.getAttribute('href'))).toEqual(['/?approval=apr_1', '/?approval=apr_2'])
    expect(within(card).getByText(/Researcher wants to use gpt-4o, up to/)).toBeInTheDocument()
    expect(card).toHaveTextContent('Anything outside your rules waits for your yes.')
    fireEvent.click(links[0])
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  it('counts a prepared payment with the agents’ requests', async () => {
    mockBff({ agents: AGENTS, prepared: [PREPARED] })
    render(<App />)
    expect(await screen.findByTestId('home-approvals-waiting')).toHaveTextContent('3')
    await waitFor(() => expect(screen.getByTestId('home-status')).toHaveTextContent('3 things are waiting for you.'))
    const rows = screen.getByTestId('home-approvals').querySelectorAll('[data-prepared], [data-approval]')
    expect([...rows].map((r) => r.getAttribute('data-prepared') ?? r.getAttribute('data-approval'))).toEqual(['preq_1', 'apr_1', 'apr_2'])
  })

  it('counts an agent’s mandate request as Approvals does (B55.40), and opens it there', async () => {
    mockBff({ agents: AGENTS, mandates: [{ id: 'mdt_1', status: 'requested' }, { id: 'mdt_2', status: 'active' }] })
    render(<App />)
    expect(await screen.findByTestId('home-approvals-waiting')).toHaveTextContent('3')
    await waitFor(() => expect(screen.getByTestId('home-status')).toHaveTextContent('3 things are waiting for you.'))
    expect(screen.getByRole('link', { name: '1 more waiting' })).toHaveAttribute('href', '/approvals')
  })

  it('with nothing waiting there is no card: You’re all caught up, and See what you decided', async () => {
    mockBff({ agents: AGENTS })
    const inner = vi.mocked(fetch).getMockImplementation()!
    vi.mocked(fetch).mockImplementation(async (input, init) =>
      String(input) === '/api/agents/approvals' ? new Response(JSON.stringify({ approvals: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }) : inner(input, init),
    )
    render(<App />)
    await waitFor(() => expect(screen.getByTestId('home-status')).toHaveTextContent('You’re all caught up.'))
    expect(within(screen.getByTestId('home-status')).getByRole('link', { name: 'See what you decided' })).toHaveAttribute('href', '/approvals')
    expect(screen.queryByRole('heading', { name: 'Waiting for your yes' })).toBeNull()
  })
})

// A Business, Hybrid workspace: $18,400.00 in the company's dollar account, €7,500.00 in the Researcher's euro account,
// £4,000.00 in the company's pound account, 14,000 USDC in the company's USDC account and 1,500 USDC in the Researcher's
// wallet. At $1.20 a euro and £0.80 a euro: €7,500.00 is $9,000.00 and £4,000.00 is $6,000.00.
const HYBRID_ACCOUNTS = [
  { id: 'macc_usd', agent_id: '', currency: 'USD', purpose: 'company', status: 'open', name: 'USD account', balance_minor: 1_840_000, test_minor: 1_840_000, live_minor: 0 },
  { id: 'macc_eur', agent_id: 'agt_1', currency: 'EUR', purpose: 'agent', status: 'open', name: 'EUR account', balance_minor: 750_000, test_minor: 750_000, live_minor: 0 },
  { id: 'macc_gbp', agent_id: '', currency: 'GBP', purpose: 'company', status: 'open', name: 'GBP account', balance_minor: 400_000, test_minor: 400_000, live_minor: 0 },
  { id: 'macc_usdc', agent_id: '', currency: 'USDC', purpose: 'company', status: 'open', name: 'USDC account', balance_minor: 14_000_000_000, test_minor: 14_000_000_000, live_minor: 0 },
  { id: 'macc_old', agent_id: '', currency: 'GBP', purpose: 'company', status: 'closed', name: 'GBP account', balance_minor: 999_999, test_minor: 0, live_minor: 0 },
]

describe('Home — the total (B57.18)', () => {
  it('a Business, Hybrid account: the company’s total in dollars, split into Fiat and Stablecoin, each currency under it', async () => {
    mockBff({ agents: AGENTS, accounts: HYBRID_ACCOUNTS, wallets: { agt_1: 1_500_000_000 } })
    render(<App />)

    expect(await screen.findByText('Your company’s total')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('home-total')).toHaveTextContent('$48,900.00'))
    const fiat = screen.getByTestId('home-fiat')
    expect(fiat).toHaveTextContent('Fiat$33,400.00')
    expect(fiat).toHaveTextContent('US dollar$18,400.00Euro€7,500.00British pound£4,000.00')
    // The company's US dollar account opens Invoices.
    expect(within(fiat).getByRole('link', { name: /US dollar/ })).toHaveAttribute('href', '/money/invoices')
    expect(screen.getByTestId('home-stablecoin')).toHaveTextContent('Stablecoin$15,500.00USDC15,500.00')
    expect(screen.getByRole('img', { name: 'Fiat 68%, Stablecoin 32%' })).toBeInTheDocument()
    // Only the actions with a screen behind them.
    expect(screen.getByRole('link', { name: 'Top up' })).toHaveAttribute('href', '/billing')
    expect(screen.getAllByRole('link', { name: 'Pay' }).some((l) => l.getAttribute('href') === '/money/pay')).toBe(true)

    // What the agents hold in LXC, what is not yet given to one, and Lens's forecast.
    expect(screen.getByTestId('home-agents-total')).toHaveTextContent('16 LXC')
    expect(screen.getByTestId('home-unallocated')).toHaveTextContent('34 LXC')
    await waitFor(() => expect(screen.getByTestId('home-spent')).toHaveTextContent('3 LXC'))
    expect(screen.getByTestId('home-forecast')).toHaveTextContent('25 LXC')
  })

  it('a Personal, Fiat only account: its total and its currencies, with no stablecoin side and no split', async () => {
    mockBff({ agents: AGENTS, account: { account_type: 'personal', money_kind: 'fiat' }, accounts: HYBRID_ACCOUNTS })
    render(<App />)

    expect(await screen.findByText('Your total')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('home-total')).toHaveTextContent('$33,400.00'))
    expect(screen.queryByTestId('home-stablecoin')).toBeNull()
    expect(screen.getByTestId('home-fiat')).not.toHaveTextContent('Fiat$')
    expect(screen.queryByRole('img', { name: /^Fiat \d+%/ })).toBeNull()
  })

  it('a Stablecoin only account has no fiat side and no Top up; an empty one says how to start', async () => {
    mockBff({ agents: AGENTS, account: { account_type: 'personal', money_kind: 'stablecoin' } })
    render(<App />)

    await waitFor(() => expect(screen.getByTestId('home-total')).toHaveTextContent('$0.00'))
    expect(screen.getByText('Receive stablecoins to get started.')).toBeInTheDocument()
    expect(screen.queryByTestId('home-fiat')).toBeNull()
    expect(screen.queryByRole('link', { name: 'Top up' })).toBeNull()
  })

  it('a balance read that failed says so and never draws a total', async () => {
    mockBff({ agents: AGENTS })
    const inner = vi.mocked(fetch).getMockImplementation()!
    vi.mocked(fetch).mockImplementation(async (input, init) => (String(input) === '/api/money/accounts' ? new Response('{}', { status: 502 }) : inner(input, init)))
    render(<App />)

    expect(await screen.findByText('We couldn’t read your balances. Nothing changed.')).toBeInTheDocument()
    expect(screen.queryByTestId('home-total')).toBeNull()
  })
})

describe('Home — the agents and the cards (B57.18)', () => {
  it('“2 of 3 on Free” opens Plans; each agent’s balances and its month against its budget', async () => {
    mockBff({ agents: AGENTS, accounts: HYBRID_ACCOUNTS, wallets: { agt_1: 1_500_000_000 } })
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Your team’s agents' })).toBeInTheDocument()
    expect(await screen.findByTestId('home-plan')).toHaveTextContent('2 of 3 on Free')
    expect(screen.getByTestId('home-plan')).toHaveAttribute('href', '/plans')

    const researcher = screen.getByTestId('home-agent-agt_1')
    await waitFor(() => expect(researcher).toHaveTextContent('€7,500.00'))
    await waitFor(() => expect(researcher).toHaveTextContent('1,500.00 USDC'))
    expect(within(researcher).getByRole('link', { name: /Researcher/ })).toHaveAttribute('href', '/agents/agt_1')
    // Researcher spent 3 of its 12 LXC monthly budget: 25%.
    await waitFor(() => expect(screen.getByTestId('home-budget-used-agt_1')).toHaveAttribute('data-used', '25%'))
    expect(screen.getByRole('img', { name: /^25% of Researcher’s monthly budget used/ })).toBeInTheDocument()
    expect(researcher).toHaveTextContent('3 LXC of 12 LXC')
    expect(screen.queryByTestId('home-above-budget-agt_1')).toBeNull()
    // Buyer has no budget, so it is offered one, on its rules.
    const buyer = screen.getByTestId('home-agent-agt_2')
    expect(buyer).toHaveTextContent('No account')
    expect(within(buyer).getByRole('link', { name: 'Set a budget' })).toHaveAttribute('href', '/agents/agt_2/rules')

    // The cards: the company's own, then each agent's that Lens issued.
    const cards = within(await screen.findByTestId('home-card-list'))
    await waitFor(() => expect(cards.getAllByRole('listitem')).toHaveLength(2))
    expect(cards.getByRole('img', { name: "Researcher's agent card" })).toBeInTheDocument()
  })

  it('an agent above its budget wears the chip', async () => {
    mockBff({ agents: AGENTS })
    const inner = vi.mocked(fetch).getMockImplementation()!
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (String(input) !== '/api/agents/agt_1/rules') return inner(input, init)
      const rules = await (await inner(input, init)).json()
      return new Response(JSON.stringify({ ...rules, monthly_limit_ulxc: 2 * M }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    render(<App />)
    expect(await screen.findByTestId('home-above-budget-agt_1')).toHaveTextContent('Above budget')
  })

  it('the plan line for a plan with no agent limit', () => {
    expect(planLine({ plan: 'free', agents: 3, agents_used: 3, seats: 1 })).toBe('3 of 3 on Free')
    expect(planLine({ plan: 'business', agents: -1, agents_used: 12, seats: 25 })).toBe('12 on Business')
  })

  it('a workspace with no agents opens Home in onboarding mode', async () => {
    mockBff({ agents: [] })
    render(<App />)

    expect(await screen.findByText('No agents yet')).toBeInTheDocument()
    expect(screen.getByTestId('home-onboarding')).toHaveTextContent('Give an agent its own account, wallet and card.')
    expect(screen.getByRole('button', { name: 'Create my first agent' })).toBeEnabled()
  })
})


// B55.39 — Lens names a new workspace by its id and makes "My first agent" at sign-up, so the book is never
// empty and the onboarding card, which names the workspace, never shows. Home asks first instead.
describe('Home — a new workspace is asked its name (B55.39)', () => {
  const FIRST = [{ id: 'agt_first', name: 'My first agent', balance_ulxc: 0, spent_ulxc: 0, keys: [], created_at: '2026-11-06T09:00:00Z' }]

  it('while the name is the id, Home asks for it first, Save name PUTs it, and the sidebar then shows it', async () => {
    const writes = mockBff({ agents: FIRST, workspaceName: 'ws_1' })
    // B57.50 — this tab saw /welcome and pressed Go to Home with the workspace still unnamed: Home asks again.
    markWelcomed()
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

    expect(await screen.findByText('No agents yet')).toBeInTheDocument()
    expect(screen.getByTestId('home-onboarding')).toHaveTextContent('Give an agent its own account, wallet and card.')
    expect(screen.queryByText(/Share your answers, and earn from them/i)).not.toBeInTheDocument()
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
    expect(await screen.findByRole('heading', { name: 'Your team’s agents' })).toBeInTheDocument()
    expect(screen.getByTestId('home-agent-agt_new')).toHaveTextContent('Researcher')
  })

  it('a webmail address prefills no workspace name', () => {
    expect(nameFromEmail('ada@gmail.com')).toBe('')
    expect(nameFromEmail('ada@acme.co.uk')).toBe('Acme')
  })
})
