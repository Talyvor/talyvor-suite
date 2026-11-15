import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B19.21 — scheduled payments and automatic top-ups on the Agent Bank, walked the way the DONE line
// reads: schedule a weekly payment from one agent to another, see its runs, and stop it (B61.14: the top-up is no
// longer drawn). The mock BFF keeps schedules the way Lens B19.8 does: a new schedule is active, its runs are Lens's
// record of each tick, stopping it makes it inactive, and an agent with no top-up is 404.

function mockBff() {
  const sent: Array<{ method: string; url: string; body: unknown }> = []
  const schedules: Array<Record<string, unknown>> = []
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : null
    if (method !== 'GET') sent.push({ method, url, body })
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/lxc/topup-options') return json({ allowed_usd_cents: [1000], billing_enabled: true, usd_per_lxc: 0.1 })
    if (url === '/api/agents')
      return json({
        workspace_balance_ulxc: 20_000_000, allocated_ulxc: 0, unallocated_ulxc: 20_000_000, spent_ulxc: 0,
        agents: [
          { id: 'agt_1', name: 'Researcher', balance_ulxc: 0, spent_ulxc: 0, keys: [], created_at: '2026-09-28T09:00:00Z' },
          { id: 'agt_2', name: 'Writer', balance_ulxc: 0, spent_ulxc: 0, keys: [], created_at: '2026-09-28T09:00:00Z' },
        ],
      })
    if (url === '/api/agents/schedules') return json({ schedules })
    if (url === '/api/agents/agt_1/schedules') {
      const sc = { id: 'sch_1', from_agent_id: 'agt_1', ...body, next_run_at: '2026-10-05T09:00:00Z', active: true, created_at: '2026-09-28T09:00:00Z' }
      schedules.push(sc)
      return json(sc, 201)
    }
    if (url === '/api/agents/schedules/sch_1/runs')
      return json({ schedule_id: 'sch_1', runs: [{ tick_at: '2026-09-28T09:00:00Z', outcome: 'paid', entry_id: 'e1', created_at: '2026-09-28T09:00:01Z' }] })
    if (url === '/api/agents/schedules/sch_1/stop') { schedules[0].active = false; return json({ schedule_id: 'sch_1', active: false }) }
    if (url === '/api/agents/agt_1/topup') return json({ error: 'the agent has no automatic top-up' }, 404)
    if (url === '/api/agents/forecast') return json({ at: '', month_start: '', month_end: '', spent_ulxc: 0, forecast_ulxc: 0, agents: [] })
    if (url === '/api/agents/alerts') return json({ alerts: [], rule: 'the rule' })
    if (url === '/api/agents/approvals') return json({ approvals: [] })
    if (url === '/api/agents/passkeys') return json({ passkeys: [] })
    if (url === '/api/agents/agt_1/statement') return json({ agent_id: 'agt_1', lines: [] })
    if (url === '/api/marketplace/listings') return json({ listings: [] })
    if (url === '/api/agents/agt_1/rules')
      return json({ max_per_request_ulxc: 0, daily_limit_ulxc: 0, monthly_limit_ulxc: 0, approval_above_ulxc: 0, allowed_models: [], allowed_providers: [], allowed_listings: [], active_from: '', active_until: '', timezone: 'UTC', pause_on_unusual_spend: false })
    return new Response('null', { status: 404 })
  })
  return sent
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  queryClient.clear()
})

describe('scheduled payments and automatic top-ups on the Agent Bank', () => {
  // B61.14 — an automatic top-up moves LXC, which is parked: the agent's Settings no longer draw it.
  it('schedules a weekly payment, shows its runs and stops it; there is no automatic top-up to set', async () => {
    const sent = mockBff()
    window.history.pushState({}, '', '/agents/agt_1')
    render(<App />)

    // B57.22 — each is a row of the agent's Settings, opened over its page.
    fireEvent.click(within(await screen.findByTestId('agent-setting-Scheduled payments')).getByRole('button'))
    expect(await screen.findByText('Researcher pays nothing on a schedule.')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Who Researcher pays on a schedule'), { target: { value: 'agent:agt_2' } })
    fireEvent.change(screen.getByLabelText('Scheduled amount in dollars for Researcher'), { target: { value: '0.1' } })
    fireEvent.change(screen.getByLabelText('Memo for Researcher’s scheduled payment'), { target: { value: 'drafts' } })
    fireEvent.click(screen.getByRole('button', { name: 'Schedule' }))
    const row = await screen.findByText(/Pays Writer/)
    expect(row.textContent).toBe('Pays Writer $0.10 every week') // 1 LXC at $0.10, in dollars alone (B61.14)

    fireEvent.click(screen.getByRole('button', { name: 'Runs' }))
    expect(await screen.findByText('Paid')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(await screen.findByText('Researcher pays nothing on a schedule.')).toBeTruthy()
    expect(screen.queryByTestId('agent-setting-Automatic top-up')).toBeNull()
    expect(screen.queryByTestId('agent-topup')).toBeNull()

    expect(sent).toEqual([
      { method: 'POST', url: '/api/agents/agt_1/schedules', body: { to_agent_id: 'agt_2', to_listing_id: '', amount_ulxc: 1_000_000, memo: 'drafts', every: 'week' } },
      { method: 'POST', url: '/api/agents/schedules/sch_1/stop', body: {} },
    ])
  })
})
