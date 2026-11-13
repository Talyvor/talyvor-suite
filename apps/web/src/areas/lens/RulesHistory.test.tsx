import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B28.31 — an agent's rules history on Agent Wallets. The mock BFF keeps versions the way Lens B28.307 does: version 1
// is a 5 LXC daily limit saved by you, version 2 the Researcher template (1 LXC a day, approval above 0.5 LXC). Rolling
// back to version 1 writes version 1's rules back exactly and adds version 3, "rollback to 1", by whoever asked.
// B55.14 — the rollback loosens the rules (Lens B55.13), so it asks first, and once the workspace has a passkey it is
// signed over its challenge; Lens refuses it unsigned, as here.

const CHANGES = ['Daily limit: was 1 LXC, now 5 LXC', 'Ask a person above: was 0.5 LXC, now none']

function mockBff(passkey = false) {
  const sent: Array<{ method: string; url: string; body?: unknown }> = []
  const agents = [
    { id: 'agt_1', name: 'Researcher', balance_ulxc: 10_000_000, spent_ulxc: 0, keys: [], created_at: '2026-08-01T09:00:00Z', owner_user_id: 'ws_1', verified: true },
  ]
  const base = { max_per_request_ulxc: 0, monthly_limit_ulxc: 0, allowed_models: [], allowed_providers: [], active_from: '', active_until: '', timezone: 'UTC', pause_on_unusual_spend: false }
  const v1 = { ...base, daily_limit_ulxc: 5_000_000, approval_above_ulxc: 0 }
  const v2 = { ...base, daily_limit_ulxc: 1_000_000, approval_above_ulxc: 500_000 }
  let rules = v2
  const versions = [
    { version: 2, rules: v2, changed_by: 'jwt:user:ws_1', change: 'template researcher', created_at: '2026-10-05T09:01:00Z' },
    { version: 1, rules: v1, changed_by: 'jwt:user:ws_1', change: 'set', created_at: '2026-10-05T09:00:00Z' },
  ]
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    if (method !== 'GET') sent.push({ method, url, body })
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/agents') return json({ workspace_balance_ulxc: 20_000_000, allocated_ulxc: 10_000_000, unallocated_ulxc: 10_000_000, spent_ulxc: 0, agents })
    if (url === '/api/agents/agt_1/rules/history') return json({ versions })
    if (url === '/api/agents/agt_1/rules-challenge') {
      return json({ looser: true, changes: CHANGES, challenge: 'Y2gx', allow_credentials: passkey ? ['Y3JlZDE'] : [], user_verification: 'required' })
    }
    if (url === '/api/agents/agt_1/rules/rollback' && method === 'POST') {
      if (passkey && (body as { assertion?: unknown }).assertion === undefined) {
        return json({ error: "loosening an agent's rules is signed with your passkey or your phone: sign this change's challenge" }, 403)
      }
      const back = versions.find((v) => v.version === (body as { version: number }).version)
      if (!back) return json({ error: 'economy: the agent has no such version of its rules' }, 404)
      rules = back.rules
      versions.unshift({ version: versions.length + 1, rules, changed_by: 'jwt:user:ws_1', change: `rollback to ${back.version}`, created_at: '2026-10-05T09:02:00Z' })
      return json(rules)
    }
    if (url === '/api/agents/agt_1/rules') return json(rules)
    if (url === '/api/agents/agt_1/statement') return json({ agent_id: 'agt_1', lines: [] })
    if (url === '/api/agents/schedules') return json({ schedules: [] })
    if (url === '/api/agents/agt_1/topup') return json({ error: 'the agent has no automatic top-up' }, 404)
    if (url === '/api/agents/forecast') return json({ at: '', month_start: '', month_end: '', spent_ulxc: 0, forecast_ulxc: 0, agents: [] })
    if (url === '/api/agents/alerts') return json({ alerts: [], rule: 'the rule' })
    if (url === '/api/agents/approvals') return json({ approvals: [] })
    if (url === '/api/agents/passkeys') return json({ passkeys: passkey ? [{ credential_id: 'Y3JlZDE', name: 'iPhone', created_at: '2026-10-06T04:00:00Z' }] : [] })
    if (url === '/api/money/devices') return json({ devices: [] })
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

describe('an agent’s rules history', () => {
  it('shows who changed what, and rolling back puts the earlier rules back in the Rules card and its form', async () => {
    const sent = mockBff()
    window.history.pushState({}, '', '/agents')
    render(<App />)

    const v2 = await screen.findByTestId('rules-version-2')
    expect(v2.textContent).toContain('Researcher template applied by you')
    expect(v2.textContent).toContain('In force')
    expect(within(v2).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Daily limit: was 5 LXC, now 1 LXC',
      'Ask a person above: was none, now 0.5 LXC',
    ])
    expect(screen.getByTestId('rules-version-1').textContent).toContain('Saved by you')
    expect((screen.getByLabelText('Daily limit for Researcher, in LXC') as HTMLInputElement).value).toBe('1')

    fireEvent.click(screen.getByRole('button', { name: 'Roll Researcher’s rules back to version 1' }))
    const ask = await screen.findByTestId('rules-rollback-ask')
    expect(ask.textContent).toContain('Roll Researcher’s rules back to version 1?')
    expect(within(ask).getAllByRole('listitem').map((li) => li.textContent)).toEqual(CHANGES)
    fireEvent.click(within(ask).getByRole('button', { name: 'Roll back' }))
    expect((await screen.findByTestId('rules-version-3')).textContent).toContain('Rolled back to version 1 by you')
    expect(screen.getByText(/rules are back as they were at version/).textContent).toBe(
      'Researcher’s rules are back as they were at version 1. The rollback is kept as a new version.',
    )
    expect(screen.getByTestId('rules-in-words').textContent).toContain('Researcher may spend at most 5 LXC a day.')
    expect(screen.getByTestId('rules-in-words').textContent).not.toContain('A person must approve')
    await waitFor(() => expect((screen.getByLabelText('Daily limit for Researcher, in LXC') as HTMLInputElement).value).toBe('5'))
    expect((screen.getByLabelText('Ask a person above for Researcher, in LXC') as HTMLInputElement).value).toBe('')

    expect(sent).toEqual([
      { method: 'POST', url: '/api/agents/agt_1/rules-challenge', body: { rollback_to: 1 } },
      { method: 'POST', url: '/api/agents/agt_1/rules/rollback', body: { version: 1 } },
    ])
  })

  it('rolls back to looser rules only with the passkey, and a cancelled prompt sends nothing', async () => {
    const sent = mockBff(true)
    const ASSERTION = { rawId: new Uint8Array([1]).buffer, response: { clientDataJSON: new Uint8Array([2]).buffer, authenticatorData: new Uint8Array([3]).buffer, signature: new Uint8Array([4]).buffer } }
    const get = vi.fn().mockRejectedValueOnce(new DOMException('The operation was cancelled.', 'NotAllowedError')).mockResolvedValue(ASSERTION)
    Object.defineProperty(navigator, 'credentials', { value: { get, create: vi.fn() }, configurable: true })
    window.history.pushState({}, '', '/agents')
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: 'Roll Researcher’s rules back to version 1' }))
    const ask = await screen.findByTestId('rules-rollback-ask')
    fireEvent.click(within(ask).getByRole('button', { name: 'Roll back with your passkey' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Nothing changed. You can try again.')
    expect(get).toHaveBeenCalledTimes(1)
    expect(sent.some((s) => s.url === '/api/agents/agt_1/rules/rollback')).toBe(false)

    fireEvent.click(within(ask).getByRole('button', { name: 'Roll back with your passkey' }))
    expect((await screen.findByTestId('rules-version-3')).textContent).toContain('Rolled back to version 1 by you')
    expect(sent.filter((s) => s.url === '/api/agents/agt_1/rules/rollback')).toEqual([
      { method: 'POST', url: '/api/agents/agt_1/rules/rollback', body: { version: 1, assertion: { credential_id: 'AQ', client_data_json: 'Ag', authenticator_data: 'Aw', signature: 'BA' } } },
    ])
  })

  it('cancels a rollback without sending it', async () => {
    const sent = mockBff()
    window.history.pushState({}, '', '/agents')
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: 'Roll Researcher’s rules back to version 1' }))
    fireEvent.click(within(await screen.findByTestId('rules-rollback-ask')).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByTestId('rules-rollback-ask')).toBeNull()
    expect(sent).toEqual([{ method: 'POST', url: '/api/agents/agt_1/rules-challenge', body: { rollback_to: 1 } }])
  })
})
