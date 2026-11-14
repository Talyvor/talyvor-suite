import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'
import { populatedBff, settleQueries } from '../../populatedBff'
import { pressAll } from '../../test/pressEverything'
import { AgentSummaryView } from './AgentPage'
import { AppMoney } from './money'

// B57.20 — an agent's page (Pocket w-agent-research, w-agent-sales, w-agent-ops): every figure from Lens B57.12's one
// read, GET /api/agents/{id}/summary; the header's Pause, Resume or Start every agent again; the card's Freeze switch; and
// the last declined purchase in words.

const M = 1_000_000
const RESEARCH: Record<string, unknown> & { paused_at?: string } = { id: 'agt_1', name: 'Research', balance_ulxc: 16_500 * M, spent_ulxc: 12_400 * M, keys: [], created_at: '2026-09-14T09:00:00Z', owner_user_id: 'usr_nick' }

function summary(over: { agent?: Record<string, unknown>; all_paused_at?: string; card?: Record<string, unknown> } = {}) {
  return {
    as_of: '2026-10-22T09:30:00Z',
    agent: { ...RESEARCH, ...over.agent },
    made_at: '2026-09-14T09:00:00Z',
    owner_user_id: 'usr_nick',
    ...(over.all_paused_at ? { all_paused_at: over.all_paused_at } : {}),
    safe_to_spend: [{ currency: 'LXC', balance: 16_500 * M, scheduled: 0, bills_due: 0, pending_approvals: 3_400 * M, safe_to_spend: 13_100 * M }],
    month: { start: '2026-10-01T00:00:00Z', end: '2026-11-01T00:00:00Z', spent_ulxc: 12_400 * M, forecast_ulxc: 17_966 * M, runs_out_at: null, runs_out_on: null, monthly_limit_ulxc: 20_000 * M },
    approvals: [
      { id: 'apr_acme', agent_id: 'agt_1', amount_ulxc: 3_400 * M, model: '', status: 'pending', created_at: '2026-10-22T08:17:00Z',
        payee: { kind: 'outside', id: 'payee_acme', name: 'Acme Hosting' },
        paid_from: { kind: 'account', account_id: 'acc_usd', name: 'Research’s US dollar account', currency: 'USD', amount_minor: 34_000, balance_minor: 40_000 } },
    ],
    statement: [
      { entry_id: 'e1', kind: 'spend', amount_ulxc: -420 * M, counterparty: 'provider', at: '2026-10-21T09:24:00Z', balance_after_ulxc: 16_500 * M, model: 'claude-sonnet-5', day: '2026-10-21', requests: 312 },
    ],
    statement_time_zone: 'Europe/London',
    rules: { version: 4, saved_at: '2026-10-01T09:00:00Z' },
    card: { status: 'active', currency: 'gbp', last4: '4242',
      last_declined: { merchant_name: 'Compute shop', amount_minor: 2_400, currency: 'gbp', words: 'Declined: not one of its payees', reason: 'economy: …', at: '2026-10-20T10:00:00Z' },
      ...over.card },
    currency_accounts: [{ id: 'acc_usd', agent_id: 'agt_1', currency: 'USD', purpose: 'agent', status: 'open', name: 'US dollar account', balance_minor: 40_000, test_minor: 40_000, live_minor: 0 }],
  }
}

function mockBff(first: ReturnType<typeof summary>) {
  let now = first
  const sent: string[] = []
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (method !== 'GET') sent.push(`${method} ${url}`)
    const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'oidc', authenticated: true, user: { sub: 'usr_nick', email: 'nick@example.com' } })
    if (url === '/api/lxc/topup-options') return json({ allowed_usd_cents: [1000], billing_enabled: true, usd_per_lxc: 0.1 })
    if (url === '/api/agents/agt_1/summary') return json(now)
    if (url === '/api/agents/agt_1/card/freeze' || url === '/api/agents/agt_1/card/unfreeze') {
      const frozen = url.endsWith('/freeze')
      now = { ...now, card: { ...now.card, status: frozen ? 'frozen' : 'active' } }
      return json({ id: 'ic_1', agent_id: 'agt_1', last4: '4242', frozen })
    }
    if (url === '/api/agents/agt_1/pause') {
      now = { ...now, agent: { ...now.agent, paused_at: '2026-10-22T09:31:00Z' } }
      return json({ agent_id: 'agt_1', paused: true })
    }
    if (url === '/api/agents/agt_1/rules')
      return json({ max_per_request_ulxc: 10_000 * M, daily_limit_ulxc: 5_000 * M, monthly_limit_ulxc: 20_000 * M, approval_above_ulxc: 2_500 * M, allowed_models: null, allowed_providers: null, active_from: '08:00', active_until: '20:00', timezone: 'Europe/London' })
    if (url === '/api/agents') return json({ workspace_balance_ulxc: 100_000 * M, allocated_ulxc: 16_500 * M, unallocated_ulxc: 83_500 * M, spent_ulxc: 0, agents: [now.agent] })
    return new Response('null', { status: 404 })
  })
  return { sent }
}

/** An element's words, its figures' no-break spaces as spaces. */
const text = (el: Element) => (el.textContent ?? '').replace(/\u00a0/g, ' ')

afterEach(() => {
  cleanup()
  queryClient.clear()
  vi.restoreAllMocks()
  window.history.pushState({}, '', '/')
})

async function open(s: ReturnType<typeof summary>) {
  const bff = mockBff(s)
  window.history.pushState({}, '', '/agents/agt_1')
  render(<App />)
  const page = await screen.findByTestId('agent-page-balance')
  return { bff, page }
}

describe('An agent’s page (B57.20)', () => {
  it('draws every figure from the one summary read: balance, safe to spend, the month, its account, what waits and its lines', async () => {
    const { page } = await open(summary())
    expect(screen.getByRole('heading', { level: 2, name: 'Research' })).toBeInTheDocument()
    expect(screen.getByTestId('agent-page-state')).toHaveTextContent('RunningMade by you on 14 September')
    expect(text(page)).toContain('$1,650.00')
    expect(text(screen.getByTestId('agent-page-safe'))).toBe('$1,310.00 13,100 LXC safe to spend, after the $340.00 3,400 LXC waiting')
    expect(text(screen.getByTestId('agent-page-month'))).toBe('This month$1,240.00 of $2,000.0012,400 of 20,000 LXCOn pace for about $1,796.60 17,966 LXC by 31 October')
    expect(within(page).getByRole('link', { name: /US dollar account/ })).toHaveAttribute('href', '/money/invoices')
    expect(text(screen.getByTestId('agent-page-account-USD'))).toContain('$400.00')
    const waiting = screen.getByTestId('agent-page-waiting-apr_acme')
    expect(text(waiting)).toContain('Acme Hosting, $340.00')
    expect(waiting).toHaveTextContent('3,400 LXC for its rules · waiting for you since')
    expect(within(waiting).getByRole('link', { name: 'Review Research’s request' })).toHaveAttribute('href', '/agents/agt_1?approval=apr_acme')
    expect(screen.getAllByTestId('agent-page-line')[0]).toHaveTextContent('312 requests')
    expect(screen.getByRole('link', { name: 'Full statement' })).toHaveAttribute('href', '/statements?wallet=agt_1')
    // The rules in words, from its rules.
    const rules = screen.getByTestId('agent-page-rules')
    await within(rules).findByText('Asks you above $250.00')
    expect(rules).toHaveTextContent('At most $1,000.00 on one request10,000 LXC. Anything larger is refused')
    expect(rules).toHaveTextContent('At most $500.00 a day5,000 LXC. Counted in London time')
    expect(rules).toHaveTextContent('At most $2,000.00 a month20,000 LXC. Counted from 1 November again')
    expect(rules).toHaveTextContent('Only from 08:00 to 20:00London time')
    // The card tile names the agent and the card, with no number on it.
    const card = screen.getByTestId('agent-page-card')
    expect(card).toHaveTextContent('Agent card · pounds')
    expect(card).not.toHaveTextContent('4242')
  })

  it('says a declined purchase in words', async () => {
    await open(summary())
    expect(text(screen.getByTestId('agent-page-declined'))).toBe('Last declinedCompute shop, £24.00Declined: not one of its payees')
  })

  it('freezes the card with its switch, and unfreezes it', async () => {
    const { bff } = await open(summary())
    fireEvent.click(screen.getByRole('switch', { name: 'Freeze Research’s card' }))
    expect(await screen.findByText('Research’s card is frozen')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('agent-page-state')).toHaveTextContent('Card frozen'))
    fireEvent.click(await screen.findByRole('switch', { name: 'Unfreeze Research’s card' }))
    expect(await screen.findByText('Research’s card takes purchases again')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('agent-page-state')).not.toHaveTextContent('Card frozen'))
    expect(bff.sent).toEqual(['POST /api/agents/agt_1/card/freeze', 'POST /api/agents/agt_1/card/unfreeze'])
  })

  it('offers Pause while it runs, and pausing turns it to Resume', async () => {
    const { bff } = await open(summary())
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    await waitFor(() => expect(screen.getByTestId('agent-page-state')).toHaveTextContent('Paused'))
    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument()
    expect(bff.sent).toEqual(['POST /api/agents/agt_1/pause'])
  })

  it('offers Resume while it is paused, and Start every agent again while every agent is', async () => {
    await open(summary({ agent: { paused_at: '2026-10-21T17:00:00Z' } }))
    expect(screen.getByTestId('agent-page-state')).toHaveTextContent(/^Paused/)
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    expect(await screen.findByRole('dialog', { name: 'Resume Research?' })).toBeInTheDocument()
    cleanup()
    queryClient.clear()
    vi.restoreAllMocks()
    await open(summary({ all_paused_at: '2026-10-22T09:00:00Z' }))
    expect(screen.getByTestId('agent-page-state')).toHaveTextContent('Paused with every agent')
    fireEvent.click(screen.getByRole('button', { name: 'Start every agent again' }))
    expect(await screen.findByRole('dialog', { name: 'Start every agent again?' })).toBeInTheDocument()
  })

  it('offers Issue a card when it has none', async () => {
    await open(summary({ card: { status: 'none', last_declined: null } }))
    fireEvent.click(within(await screen.findByTestId('agent-page-no-card')).getByRole('button', { name: 'Issue a card' }))
    expect(await screen.findByRole('dialog', { name: 'Issue Research a card' })).toBeInTheDocument()
  })

  it('every control on the page does something', async () => {
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    const { asked } = populatedBff((impl) => vi.spyOn(globalThis, 'fetch').mockImplementation(impl))
    const report = await pressAll(
      async () => {
        queryClient.clear()
        window.history.pushState({}, '', '/agents/agt_research')
        // The page's own part: today's agent view under it is B57.21's and B57.22's to press.
        render(
          <QueryClientProvider client={queryClient}>
            <AppMoney>
              <BrowserRouter>
                <Routes>
                  <Route path="/agents/:id" element={<AgentSummaryView id="agt_research" />} />
                  <Route path="*" element={<p>Elsewhere</p>} />
                </Routes>
              </BrowserRouter>
            </AppMoney>
          </QueryClientProvider>,
        )
        await settleQueries(queryClient, waitFor)
      },
      () => asked.length,
    )
    expect(report.pressed).toBeGreaterThan(0)
    expect(report.dead).toEqual([])
  }, 300_000)
})
