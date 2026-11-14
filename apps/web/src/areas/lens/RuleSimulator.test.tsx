import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B28.30 — "would this request pass my rules?", on the agent's rules page (B57.23). The mock BFF judges the request the way Lens
// B28.306 does for a daily limit of 5 LXC: above it refused with the rule's sentence, at or below it allowed. It
// moves nothing, so the only write the screen sends is the question itself.

function mockBff({ paused = false, allPaused = false } = {}) {
  const sent: Array<{ method: string; url: string; body?: unknown }> = []
  const agents = [
    { id: 'agt_1', name: 'Researcher', balance_ulxc: 10_000_000, spent_ulxc: 0, keys: [], created_at: '2026-08-01T09:00:00Z', owner_user_id: 'ws_1', verified: true, ...(paused ? { paused_at: '2026-10-05T08:00:00Z', paused_reason: 'paused from its page' } : {}) },
    { id: 'agt_2', name: 'Writer', balance_ulxc: 0, spent_ulxc: 0, keys: [], created_at: '2026-08-01T09:00:00Z', owner_user_id: 'ws_1', verified: true },
  ]
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    if (method !== 'GET') sent.push({ method, url, body })
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/agents')
      return json({ workspace_balance_ulxc: 20_000_000, allocated_ulxc: 10_000_000, unallocated_ulxc: 10_000_000, spent_ulxc: 0, agents, ...(allPaused ? { all_paused_at: '2026-10-05T08:00:00Z' } : {}) })
    if (url === '/api/agents/agt_1/rules/simulate') {
      const amount = (body as { amount_ulxc: number }).amount_ulxc
      // Lens (refuseIfPaused) refuses a paused agent first, with its own sentence.
      if (allPaused) return json({ verdict: 'refused', reason: "every agent in this workspace is paused (paused by the workspace's owner) — the workspace's owner can resume them", amount_ulxc: amount, at: '2026-10-05T09:00:00Z', balance_ulxc: 10_000_000 })
      if (paused) return json({ verdict: 'refused', reason: "the agent is paused (paused from its page) — the workspace's owner can resume it", amount_ulxc: amount, at: '2026-10-05T09:00:00Z', balance_ulxc: 10_000_000 })
      return amount > 5_000_000
        ? json({ verdict: 'refused', reason: 'the agent has spent 0 LXC of its daily limit of 5 LXC, and this payment would cost up to 6 LXC', amount_ulxc: amount, at: '2026-10-05T09:00:00Z', balance_ulxc: 10_000_000 })
        : json({ verdict: 'allowed', reason: '', amount_ulxc: amount, at: '2026-10-05T09:00:00Z', balance_ulxc: 10_000_000 })
    }
    if (url === '/api/agents/agt_1/rules')
      return json({ max_per_request_ulxc: 0, daily_limit_ulxc: 5_000_000, monthly_limit_ulxc: 0, approval_above_ulxc: 0, allowed_models: [], allowed_providers: [], allowed_listings: [], active_from: '', active_until: '', timezone: 'UTC', pause_on_unusual_spend: false })
    if (url === '/api/agents/agt_1/statement') return json({ agent_id: 'agt_1', lines: [] })
    if (url === '/api/agents/schedules') return json({ schedules: [] })
    if (url === '/api/agents/agt_1/topup') return json({ error: 'the agent has no automatic top-up' }, 404)
    if (url === '/api/agents/forecast') return json({ at: '', month_start: '', month_end: '', spent_ulxc: 0, forecast_ulxc: 0, agents: [] })
    if (url === '/api/agents/alerts') return json({ alerts: [], rule: 'the rule' })
    if (url === '/api/agents/approvals') return json({ approvals: [] })
    if (url === '/api/agents/passkeys') return json({ passkeys: [] })
    if (url === '/api/marketplace/listings') return json({ listings: [] })
    return new Response('null', { status: 404 })
  })
  return sent
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  queryClient.clear()
})

describe('asking whether an agent’s rules would let a request through', () => {
  it('says refused, with the rule, for a payment over the daily limit and allowed for a question under it, sending nothing else', async () => {
    const sent = mockBff()
    window.history.pushState({}, '', '/agents/agt_1/rules')
    render(<App />)

    const card = await screen.findByTestId('would-it-pass')
    expect(card.textContent).toContain('Ask whether these rules would let a request through, counting what it has really spent. Nothing is spent, paid or sent for approval.')
    fireEvent.change(within(card).getByLabelText('What Researcher would do'), { target: { value: 'agent:agt_2' } })
    fireEvent.change(within(card).getByLabelText('Amount in LXC to try for Researcher'), { target: { value: '6' } })
    fireEvent.click(within(card).getByRole('button', { name: 'Would it pass?' }))
    expect((await within(card).findByRole('alert')).textContent).toBe(
      'RefusedThe agent has spent 0 LXC of its daily limit of 5 LXC, and this payment would cost up to 6 LXC. Nothing was spent.',
    )

    fireEvent.change(within(card).getByLabelText('What Researcher would do'), { target: { value: '' } })
    fireEvent.change(within(card).getByLabelText('Amount in LXC to try for Researcher'), { target: { value: '1' } })
    fireEvent.click(within(card).getByRole('button', { name: 'Would it pass?' }))
    expect((await within(card).findByRole('status')).textContent).toBe('AllowedResearcher’s rules would let this through. Nothing was spent.')

    expect(sent).toEqual([
      { method: 'POST', url: '/api/agents/agt_1/rules/simulate', body: { amount_ulxc: 6_000_000, payee: { kind: 'agent', id: 'agt_2' } } },
      { method: 'POST', url: '/api/agents/agt_1/rules/simulate', body: { amount_ulxc: 1_000_000, model: '', provider: '' } },
    ])
  })

  it('says a paused agent’s requests are refused until it is resumed, and when every agent is paused, until they start again', async () => {
    for (const [state, words] of [
      [{ paused: true }, 'RefusedResearcher is paused, so its requests are refused until you resume it. Nothing was spent.'],
      [{ allPaused: true }, 'RefusedEvery agent is paused, so its requests are refused until you start them again. Nothing was spent.'],
    ] as const) {
      const sent = mockBff(state)
      window.history.pushState({}, '', '/agents/agt_1/rules')
      render(<App />)
      const card = await screen.findByTestId('would-it-pass')
      fireEvent.change(within(card).getByLabelText('Amount in LXC to try for Researcher'), { target: { value: '1' } })
      fireEvent.click(within(card).getByRole('button', { name: 'Would it pass?' }))
      expect((await within(card).findByRole('alert')).textContent).toBe(words)
      expect(sent).toEqual([{ method: 'POST', url: '/api/agents/agt_1/rules/simulate', body: { amount_ulxc: 1_000_000, model: '', provider: '' } }])
      cleanup()
      vi.restoreAllMocks()
      queryClient.clear()
    }
  })
})
