import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B19.20 — the Agent Bank's safety controls, walked the way the DONE line reads: pause every agent with a
// reason and see it stated, start them again, pause one agent, and read the month-end forecast and an
// unusual-spend alert. The mock BFF keeps the pause state the way Lens B19.6/B19.7 do and answers the
// book with all_paused_at and each agent's paused_at.

function mockBff(passkey = false) {
  const posts: Array<{ url: string; body: unknown }> = []
  let allPaused: { at: string; reason: string } | null = null
  let researcherPaused = false
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'Content-Type': 'application/json' } })
    if (init?.method === 'POST') posts.push({ url, body: init.body ? JSON.parse(String(init.body)) : null })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/agents')
      return json({
        workspace_balance_ulxc: 0, allocated_ulxc: 0, unallocated_ulxc: 0, spent_ulxc: 0,
        ...(allPaused ? { all_paused_at: allPaused.at, all_paused_reason: allPaused.reason } : {}),
        agents: [{
          id: 'agt_1', name: 'Researcher', balance_ulxc: 0, spent_ulxc: 0, keys: [], created_at: '2026-09-28T09:00:00Z',
          ...(researcherPaused ? { paused_at: '2026-09-28T10:00:00Z', paused_reason: 'paused from Agent Wallets' } : {}),
        }],
      })
    if (url === '/api/agents/pause-all') { allPaused = { at: '2026-09-28T10:00:00Z', reason: 'audit' }; return json({ all_paused: true }) }
    // B41.8 — Lens B41.108: once the workspace has a passkey, resuming takes an assertion over its own challenge.
    if (url === '/api/agents/resume-all/challenge' || url === '/api/agents/agt_1/resume-challenge')
      return json({ challenge: 'Y2gx', allow_credentials: passkey ? ['Y3JlZDE'] : [], user_verification: 'required' })
    const signed = (body: unknown) => !passkey || (body as { assertion?: unknown } | null)?.assertion !== undefined
    const refused = () => new Response(JSON.stringify({ error: 'economy: this workspace signs resuming: sign its challenge with a passkey or the phone app' }), { status: 403 })
    if (url === '/api/agents/resume-all') {
      if (!signed(posts.at(-1)?.body)) return refused()
      allPaused = null
      return json({ all_paused: false })
    }
    if (url === '/api/agents/agt_1/resume') {
      if (!signed(posts.at(-1)?.body)) return refused()
      researcherPaused = false
      return json({ agent_id: 'agt_1', paused: false })
    }
    if (url === '/api/agents/agt_1/pause') { researcherPaused = true; return json({ agent_id: 'agt_1', paused: true }) }
    if (url === '/api/agents/forecast')
      return json({ at: '', month_start: '', month_end: '', spent_ulxc: 1_000_000, forecast_ulxc: 3_000_000, agents: [{ agent_id: 'agt_1', name: 'Researcher', spent_ulxc: 1_000_000, forecast_ulxc: 3_000_000 }] })
    if (url === '/api/agents/alerts')
      return json({ alerts: [{ id: 'al_1', agent_id: 'agt_1', last_hour_ulxc: 600_000, usual_per_hour_ulxc: 100_000, paused: false, created_at: '2026-09-28T09:30:00Z' }], rule: 'the rule' })
    if (url === '/api/agents/approvals') return json({ approvals: [] })
    if (url === '/api/agents/passkeys') return json({ passkeys: [] })
    if (url === '/api/agents/agt_1/statement') return json({ agent_id: 'agt_1', lines: [] })
    if (url === '/api/marketplace/listings') return json({ listings: [] })
    if (url === '/api/agents/agt_1/rules')
      return json({ max_per_request_ulxc: 0, daily_limit_ulxc: 0, monthly_limit_ulxc: 0, approval_above_ulxc: 0, allowed_models: [], allowed_providers: [], allowed_listings: [], active_from: '', active_until: '', timezone: 'UTC', pause_on_unusual_spend: false })
    return new Response('null', { status: 404 })
  })
  return posts
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  queryClient.clear()
})

describe('the Agent Bank stops every agent or one, and shows what they are spending', () => {
  it('pauses every agent with a reason, starts them again, pauses one, and shows the forecast and an alert', async () => {
    const posts = mockBff()
    window.history.pushState({}, '', '/agents')
    render(<App />)

    await waitFor(() => expect(screen.getByTestId('agents-forecast').textContent).toBe('3 LXC'))
    expect(screen.getByText(/spent/, { selector: 'div' }).textContent).toContain('Researcher spent 0.6 LXC in an hour')

    fireEvent.change(await screen.findByLabelText('Why every agent is paused'), { target: { value: 'audit' } })
    fireEvent.click(screen.getByRole('button', { name: 'Pause every agent' }))
    expect((await screen.findByTestId('agents-all-paused')).textContent).toContain('Every agent is paused — audit.')

    fireEvent.click(screen.getByRole('button', { name: 'Start every agent again' }))
    await screen.findByRole('button', { name: 'Pause every agent' })

    fireEvent.click(await screen.findByRole('button', { name: 'Pause Researcher' }))
    expect((await screen.findByTestId('agent-paused')).textContent).toBe('Researcher is paused — paused from Agent Wallets.')
    expect(screen.getByText('Paused')).toBeTruthy()

    expect(posts.map((p) => [p.url, p.body])).toEqual([
      ['/api/agents/pause-all', { reason: 'audit' }],
      ['/api/agents/resume-all/challenge', {}],
      ['/api/agents/resume-all', {}],
      ['/api/agents/agt_1/pause', { reason: 'paused from Agent Wallets' }],
    ])
  })

  it('pauses with no passkey, and starts an agent and the fleet again only with Face ID once the workspace has one', async () => {
    const posts = mockBff(true)
    const ASSERTION = { rawId: new Uint8Array([1]).buffer, response: { clientDataJSON: new Uint8Array([2]).buffer, authenticatorData: new Uint8Array([3]).buffer, signature: new Uint8Array([4]).buffer } }
    const get = vi.fn().mockRejectedValueOnce(new DOMException('The operation was cancelled.', 'NotAllowedError')).mockResolvedValue(ASSERTION)
    Object.defineProperty(navigator, 'credentials', { value: { get, create: vi.fn() }, configurable: true })
    window.history.pushState({}, '', '/agents')
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: 'Pause Researcher' }))
    await screen.findByTestId('agent-paused')
    expect(get).not.toHaveBeenCalled()

    // Face ID cancelled: nothing is sent and Researcher stays paused.
    fireEvent.click(screen.getByRole('button', { name: 'Resume Researcher' }))
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1))
    expect(screen.getByTestId('agent-paused')).toBeTruthy()
    expect(posts.some((p) => p.url === '/api/agents/agt_1/resume')).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Resume Researcher' }))
    await screen.findByRole('button', { name: 'Pause Researcher' })

    fireEvent.click(screen.getByRole('button', { name: 'Pause every agent' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Start every agent again' }))
    await screen.findByRole('button', { name: 'Pause every agent' })

    const assertion = { credential_id: 'AQ', client_data_json: 'Ag', authenticator_data: 'Aw', signature: 'BA' }
    expect(posts.map((p) => [p.url, p.body])).toEqual([
      ['/api/agents/agt_1/pause', { reason: 'paused from Agent Wallets' }],
      ['/api/agents/agt_1/resume-challenge', {}],
      ['/api/agents/agt_1/resume-challenge', {}],
      ['/api/agents/agt_1/resume', { assertion }],
      ['/api/agents/pause-all', { reason: '' }],
      ['/api/agents/resume-all/challenge', {}],
      ['/api/agents/resume-all', { assertion }],
    ])
    expect(get.mock.calls[1][0].publicKey.userVerification).toBe('required')
  })
})
