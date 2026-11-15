import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B57.16 — the agent card, its switch and Resume. B61.14 — LXC is parked: the card draws no credit balance and no safe to
// spend, the agent's page has no Move LXC, and every figure reads in dollars alone at Lens's peg ($0.10 a LXC here).

function mockBff({ allPaused = false, paused = false } = {}) {
  const sent: Array<{ url: string; body: unknown; key: string | null }> = []
  const state = { researcher: 2_000_000, free: 5_000_000, allPaused, paused }
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (method !== 'GET') {
      const key = new Headers(init?.headers).get('Idempotency-Key')
      sent.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null, key })
    }
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/lxc/topup-options') return json({ usd_per_lxc: 0.1, allowed_usd_cents: [] })
    if (url === '/api/money/devices') return json({ devices: [] })
    if (url === '/api/agents/passkeys') return json({ passkeys: [] })
    if (url === '/api/agents')
      return json({
        workspace_balance_ulxc: state.researcher + state.free, allocated_ulxc: state.researcher, unallocated_ulxc: state.free, spent_ulxc: 0,
        ...(state.allPaused ? { all_paused_at: '2026-11-08T09:00:00Z', all_paused_reason: '' } : {}),
        agents: [
          { id: 'agt_1', name: 'Researcher', balance_ulxc: state.researcher, spent_ulxc: 0, keys: [], created_at: '2026-09-28T09:00:00Z', owner_user_id: 'ws_1', ...(state.paused ? { paused_at: '2026-11-08T09:00:00Z' } : {}) },
          { id: 'agt_2', name: 'Writer', balance_ulxc: 0, spent_ulxc: 0, keys: [], created_at: '2026-09-29T09:00:00Z', owner_user_id: 'ws_1' },
        ],
      })
    if (url === '/api/agents/agt_1/pause') { state.paused = true; return json({ agent_id: 'agt_1', paused: true }) }
    if (url === '/api/agents/agt_1/resume-challenge') return json({ challenge: 'Y2gx', allow_credentials: [] })
    if (url === '/api/agents/agt_1/resume') { state.paused = false; return json({ agent_id: 'agt_1', paused: false }) }
    if (url === '/api/agents/forecast')
      return json({
        at: '', month_start: '', month_end: '', spent_ulxc: 1_500_000, forecast_ulxc: 3_000_000,
        agents: [
          { agent_id: 'agt_1', name: 'Researcher', spent_ulxc: 1_500_000, forecast_ulxc: 3_000_000, runs_out_on: '2026-11-28', timezone: 'Pacific/Auckland' },
          { agent_id: 'agt_2', name: 'Writer', spent_ulxc: 0, forecast_ulxc: 0, runs_out_on: null, timezone: 'UTC' },
        ],
      })
    if (url === '/api/agents/safe-to-spend')
      return json({ company: [], agents: [{ agent_id: 'agt_1', name: 'Researcher', figures: [{ currency: 'LXC', balance: state.researcher, scheduled: 0, bills_due: 0, pending_approvals: 0, safe_to_spend: 1_250_000 }] }] })
    if (url === '/api/agents/approvals') return json({ approvals: [] })
    if (url === '/api/agents/alerts') return json({ alerts: [], rule: 'the rule' })
    if (url === '/api/agents/schedules') return json({ schedules: [] })
    if (url === '/api/marketplace/listings') return json({ listings: [] })
    if (/^\/api\/agents\/agt_\d\/statement(\?.*)?$/.test(url)) return json({ agent_id: 'agt_1', lines: [] })
    if (/^\/api\/agents\/agt_\d\/rules$/.test(url))
      return json({ max_per_request_ulxc: 0, daily_limit_ulxc: 0, monthly_limit_ulxc: 2_000_000, approval_above_ulxc: 0, allowed_models: [], allowed_providers: [], allowed_listings: [], active_from: '', active_until: '', timezone: 'UTC', pause_on_unusual_spend: false })
    return new Response('null', { status: 404 })
  })
  return { sent, state }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  queryClient.clear()
})

describe('the agent card', () => {
  it('shows the month against its budget and the pace above it in dollars, no credit balance or safe to spend, and pauses at once', async () => {
    const { sent } = mockBff()
    window.history.pushState({}, '', '/agents/agt_1')
    render(<App />)

    const card = await screen.findByTestId('agent-card-agt_1')
    expect(within(card).getByRole('link', { name: 'Open Researcher' })).toHaveAttribute('href', '/agents/agt_1')
    expect(await within(card).findByRole('img', { name: '75% of budget used' })).toBeInTheDocument()
    expect(await within(card).findByTestId('agent-card-month-agt_1')).toHaveTextContent(/^\$0\.15 of \$0\.20$/)
    await waitFor(() => expect(within(card).getByTestId('agent-card-note-agt_1')).toHaveTextContent('On pace for about $0.30Above its budget'))
    expect(within(card).queryByTestId('agent-card-balance-agt_1')).toBeNull()
    expect(within(card).queryByTestId('agent-card-safe-agt_1')).toBeNull()
    expect(card).not.toHaveTextContent(/LXC|safe to spend/)

    fireEvent.click(within(card).getByRole('switch', { name: 'Pause Researcher' }))
    expect(await within(card).findByText('Paused. Resuming needs your passkey or your phone.')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(sent.map((s) => s.url)).toEqual(['/api/agents/agt_1/pause'])
  })

  it('says the day each agent runs out in its own zone, or that it does not at this pace (B57.114)', async () => {
    mockBff()
    window.history.pushState({}, '', '/agents')
    render(<App />)

    const researcher = await screen.findByTestId('agent-card-agt_1')
    const runsOut = await within(researcher).findByTestId('agent-card-runs-out-agt_1')
    expect(runsOut).toHaveTextContent('runs out on 28 November 2026 (Pacific/Auckland)')
    expect(within(runsOut).getByText('28 November 2026')).toHaveAttribute('dateTime', '2026-11-28')
    expect(within(researcher).getByTestId('agent-card-note-agt_1')).toHaveTextContent('On pace for about $0.30')
    const writer = screen.getByTestId('agent-card-agt_2')
    expect(await within(writer).findByTestId('agent-card-runs-out-agt_2')).toHaveTextContent('does not run out at this pace')
  })

  it('resuming while every agent is paused says it waits for every agent, and says so again after', async () => {
    const { sent } = mockBff({ allPaused: true, paused: true })
    window.history.pushState({}, '', '/agents/agt_2')
    render(<App />)

    const writer = await screen.findByTestId('agent-card-agt_2')
    expect(within(writer).getByText('Paused with every agent.')).toBeInTheDocument()
    expect(within(writer).getByRole('switch', { name: 'Start every agent again' })).toBeInTheDocument()

    // B57.18 — each agent's card is on its own page now that Home draws a table of the agents.
    cleanup()
    window.history.pushState({}, '', '/agents/agt_1')
    render(<App />)
    fireEvent.click(within(await screen.findByTestId('agent-card-agt_1')).getByRole('switch', { name: 'Resume Researcher' }))
    const dialog = await screen.findByRole('dialog', { name: 'Resume Researcher?' })
    expect(dialog).toHaveTextContent('Every agent is paused too, so Researcher waits until you start every agent again.')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Resume with your passkey' }))
    expect(await screen.findByText('Researcher runs when you start every agent again')).toBeInTheDocument()
    expect(sent.map((s) => s.url)).toEqual(['/api/agents/agt_1/resume-challenge', '/api/agents/agt_1/resume'])
  })
})

describe('no Move LXC (B61.14)', () => {
  it('draws no Move LXC on the agent’s page: the LXC credit wallet is parked, and nothing moves it', async () => {
    const { sent } = mockBff()
    window.history.pushState({}, '', '/agents/agt_1')
    render(<App />)

    const card = await screen.findByTestId('agent-card-agt_1')
    expect(await within(card).findByTestId('agent-card-month-agt_1')).toHaveTextContent(/^\$0\.15 of \$0\.20$/)
    expect(screen.getByTestId('agent-open')).toHaveTextContent('Researcher')
    expect(screen.queryByRole('button', { name: /Move LXC/ })).toBeNull()
    expect(screen.queryByRole('dialog', { name: /Move LXC/ })).toBeNull()
    expect(card).not.toHaveTextContent(/LXC/)
    expect(sent.filter((s) => /fund|withdraw/.test(s.url))).toEqual([])
  })
})

describe('an agent’s own addresses', () => {
  it('/agents/:id opens that agent, and /agents/:id/rules opens its rules page', async () => {
    mockBff()
    window.history.pushState({}, '', '/agents/agt_2')
    render(<App />)
    expect((await screen.findByTestId('agent-open')).textContent).toBe('Writer')
    cleanup()
    queryClient.clear()

    window.history.pushState({}, '', '/agents/agt_2/rules')
    render(<App />)
    // B57.23 — the agent's rules on their own page.
    expect(await screen.findByRole('heading', { level: 1, name: 'Writer’s rules' })).toBeInTheDocument()
  })
})
