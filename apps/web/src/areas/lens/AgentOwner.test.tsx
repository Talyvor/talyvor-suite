import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B19.23 — an agent's owner, and whether it is verified, on its page's Settings. The mock BFF keeps the agent the way
// Lens B19.11 does: owner_user_id is "" while nobody owns it, and verified follows the workspace once somebody does.
// B61.14 — LXC is parked: the old view's Money card keeps only its Claim; Move LXC is not drawn, so nothing funds it.

function mockBff({ owner = '', verified = false }: { owner?: string; verified?: boolean } = {}) {
  const sent: Array<{ method: string; url: string }> = []
  const agent = { id: 'agt_1', name: 'Researcher', balance_ulxc: 0, spent_ulxc: 0, keys: [], created_at: '2026-08-01T09:00:00Z', owner_user_id: owner, verified }
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (method !== 'GET') sent.push({ method, url })
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/agents')
      return json({ workspace_balance_ulxc: 20_000_000, allocated_ulxc: agent.balance_ulxc, unallocated_ulxc: 20_000_000 - agent.balance_ulxc, spent_ulxc: 0, agents: [agent] })
    if (url === '/api/agents/schedules') return json({ schedules: [] })
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

describe("an agent's owner and verified badge on the Agent Bank", () => {
  it('says nobody owns an ownerless agent and offers Claim, but no Move LXC to fund it (B61.14)', async () => {
    const sent = mockBff()
    window.history.pushState({}, '', '/agents/agt_1')
    render(<App />)

    // B57.22 — its Ownership row in Settings.
    expect(await screen.findByTestId('agent-setting-Ownership')).toHaveTextContent('Nobody owns Researcher yet')
    expect(screen.getByTestId('agent-ownerless')).toHaveTextContent('Researcher has no owner, so it cannot be funded')
    expect(screen.getByRole('button', { name: 'Claim Researcher' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Move LXC' })).toBeNull()
    expect(sent).toEqual([])
  })

  it('says an owned agent’s owner is verified, in words that never name LXC', async () => {
    mockBff({ owner: 'ws_1', verified: true })
    window.history.pushState({}, '', '/agents/agt_1')
    render(<App />)

    expect(await screen.findByTestId('agent-setting-Ownership')).toHaveTextContent('Its owner is verified: this workspace has paid by card, or Talyvor vouches for it')
    expect(screen.queryByRole('button', { name: 'Move LXC' })).toBeNull()
  })
})
