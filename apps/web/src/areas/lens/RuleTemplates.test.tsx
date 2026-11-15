import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'
import { RULE_TEMPLATES } from './ruleTemplates'

// B28.305 — rule templates: a new agent created from one has the template saved as its rules in the same
// click, and an agent's Rules card filled from one saves exactly the template — every list, cap and window
// it held before replaced, not merged.
// B55.14 — a save first asks Lens what it does (Lens B55.13): a tighter one is saved at once; a looser one says what it
// loosens and, once the workspace has a key, is saved only with this browser's passkey.

const M = 1_000_000
const template = (id: string) => RULE_TEMPLATES.find((t) => t.id === id)!.rules

const BUILDER = {
  name: 'Builder',
  rules: {
    max_per_request_ulxc: 1 * M, hourly_limit_ulxc: 0, daily_limit_ulxc: 0, weekly_limit_ulxc: 9 * M, monthly_limit_ulxc: 0,
    approval_above_ulxc: 0, model_daily_limits_ulxc: { 'gpt-4o': 2 * M }, allowed_models: ['gpt-4o'], allowed_providers: ['openai'],
    allowed_listings: ['lst_1'], active_from: '09:00', active_until: '17:00', timezone: 'Europe/London', pause_on_unusual_spend: false,
  },
}
const LOOSER = ['Weekly limit: was 9 LXC, now none', 'Allowed models: was gpt-4o, now any']
const ASSERTION = { rawId: new Uint8Array([1]).buffer, response: { clientDataJSON: new Uint8Array([2]).buffer, authenticatorData: new Uint8Array([3]).buffer, signature: new Uint8Array([4]).buffer } }

function mockBff(existing?: { name: string; rules: Record<string, unknown> }, keys: { looser?: boolean; passkey?: boolean; phone?: boolean } = {}) {
  const agents: Array<{ id: string; name: string; balance_ulxc: number; spent_ulxc: number; keys: string[]; created_at: string }> = []
  const rules: Record<string, Record<string, unknown>> = {}
  const calls: string[] = []
  const saved: Record<string, unknown>[] = []
  const assertions: unknown[] = []
  if (existing) {
    agents.push({ id: 'agt_1', name: existing.name, balance_ulxc: 0, spent_ulxc: 0, keys: [], created_at: '2026-10-01T09:00:00Z' })
    rules.agt_1 = existing.rules
  }
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/agents' && method === 'GET')
      return json({ workspace_balance_ulxc: 100 * M, allocated_ulxc: 0, unallocated_ulxc: 100 * M, spent_ulxc: 0, agents })
    if (url === '/api/agents' && method === 'POST') {
      const body = JSON.parse(String(init?.body)) as { name: string }
      const a = { id: `agt_${agents.length + 1}`, name: body.name, balance_ulxc: 0, spent_ulxc: 0, keys: [], created_at: '2026-10-05T06:00:00Z' }
      agents.push(a)
      calls.push(`POST /api/agents ${a.name}`)
      return json(a, 201)
    }
    if (url === '/api/models')
      return json([{ id: 'gpt-4o', provider: 'openai', display_name: 'GPT-4o', input_per_1m: 2.5, output_per_1m: 10 }])
    if (url === '/api/agents/approvals') return json({ approvals: [] })
    if (url === '/api/agents/passkeys') return json({ passkeys: keys.passkey ? [{ credential_id: 'Y3JlZDE', name: 'iPhone', created_at: '2026-10-06T04:00:00Z' }] : [] })
    if (url === '/api/money/devices') return json({ devices: keys.phone ? [{ id: 'dk_1', platform: 'ios', name: 'Work iPhone' }] : [] })
    if (/^\/api\/agents\/[^/]+\/rules-challenge$/.test(url)) {
      calls.push(`POST ${url}`)
      return json({ looser: !!keys.looser, changes: keys.looser ? LOOSER : [], challenge: 'Y2gx', allow_credentials: keys.passkey ? ['Y3JlZDE'] : [] })
    }
    const m = /^\/api\/agents\/([^/]+)\/rules$/.exec(url)
    if (m) {
      if (method === 'PUT') {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>
        if (body.assertion !== undefined) assertions.push(body.assertion)
        rules[m[1]] = (body.rules ?? body) as Record<string, unknown>
        saved.push(rules[m[1]])
        calls.push(`PUT ${url}`)
      }
      return json(rules[m[1]] ?? { max_per_request_ulxc: 0, daily_limit_ulxc: 0, monthly_limit_ulxc: 0, approval_above_ulxc: 0, allowed_models: [], allowed_providers: [], active_from: '', active_until: '', timezone: 'UTC' })
    }
    return new Response('null', { status: 404 })
  })
  return { calls, saved, assertions }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  queryClient.clear()
  window.history.pushState({}, '', '/')
})

/** More rules → Start from a template → Coder, on Builder's rules page. */
async function coder() {
  fireEvent.click(within(await screen.findByTestId('more-rules')).getByRole('link', { name: /^Start from a template/ }))
  fireEvent.click(within(screen.getByRole('group', { name: 'Rule templates for Builder' })).getByRole('button', { name: 'Coder' }))
}

describe('rule templates', () => {
  it('creates a new agent from the Support bot template in one click: its rules are saved as the template', async () => {
    const { calls, saved } = mockBff()
    window.history.pushState({}, '', '/agents/agt_1')
    render(<App />)

    const start = await screen.findByRole('group', { name: 'Rules to start from' })
    fireEvent.click(within(start).getByRole('button', { name: 'Support bot' }))
    expect(within(start).getByRole('button', { name: 'Support bot' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.change(screen.getByLabelText('New agent name'), { target: { value: 'Helpdesk' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create agent' }))

    await waitFor(() => expect(screen.getByTestId('agent-open')).toHaveTextContent('Helpdesk'))
    expect(calls).toEqual(['POST /api/agents Helpdesk', 'PUT /api/agents/agt_1/rules'])
    expect(saved[0]).toEqual(template('support-bot'))
    // B57.23 — today's agent view states them; they are edited on the agent's rules page.
    const words = await screen.findByTestId('rules-in-words')
    await waitFor(() => expect(words.textContent).toContain('0.5 LXC on one request'))
    expect(words.textContent).toContain('20 LXC an hour')
  })

  // B57.23 — on the agent's rules page, under More rules.
  it('fills an agent’s rules page from the Coder template and saves exactly the template, replacing what it held', async () => {
    const { calls, saved } = mockBff(BUILDER)
    window.history.pushState({}, '', '/agents/agt_1/rules')
    render(<App />)

    await coder()
    expect(screen.getByRole('switch', { name: 'Only at certain hours' }).getAttribute('aria-checked')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: 'Save rules' }))

    await screen.findByText('Builder’s rules are saved')
    expect(saved).toEqual([template('coder')])
    expect(calls).toEqual(['POST /api/agents/agt_1/rules-challenge', 'PUT /api/agents/agt_1/rules'])
  })

  it('says what a looser template loosens and saves it only with the passkey; a cancelled prompt saves nothing', async () => {
    const { calls, saved, assertions } = mockBff(BUILDER, { looser: true, passkey: true })
    const get = vi.fn().mockRejectedValueOnce(new DOMException('The operation was cancelled.', 'NotAllowedError')).mockResolvedValue(ASSERTION)
    Object.defineProperty(navigator, 'credentials', { value: { get, create: vi.fn() }, configurable: true })
    window.history.pushState({}, '', '/agents/agt_1/rules')
    render(<App />)

    await coder()
    fireEvent.click(screen.getByRole('button', { name: 'Save rules' }))
    expect((await screen.findByTestId('rules-loosen')).textContent).toBe(
      `This loosens Builder’s rules: ${LOOSER.join('. ')}. It needs your passkey. Tightening is saved at once.`,
    )
    expect(get).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Save with your passkey' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Nothing changed. You can try again.')
    expect(saved).toEqual([])

    fireEvent.click(screen.getByRole('button', { name: 'Save with your passkey' }))
    await screen.findByText('Your passkey was asked first, because the change loosens them.')
    expect(saved).toEqual([template('coder')])
    expect(assertions).toEqual([{ credential_id: 'AQ', client_data_json: 'Ag', authenticator_data: 'Aw', signature: 'BA' }])
    expect(calls.filter((c) => c.startsWith('PUT'))).toEqual(['PUT /api/agents/agt_1/rules'])
  })

  it('saves a tighter change at once, with no prompt, even once the workspace has a passkey', async () => {
    const { calls, assertions } = mockBff(BUILDER, { passkey: true })
    const get = vi.fn()
    Object.defineProperty(navigator, 'credentials', { value: { get, create: vi.fn() }, configurable: true })
    window.history.pushState({}, '', '/agents/agt_1/rules')
    render(<App />)

    fireEvent.click(within(await screen.findByTestId('more-rules')).getByRole('link', { name: /^At most a week/ }))
    fireEvent.change(screen.getByLabelText('At most a week for Builder, in LXC'), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save rules' }))
    await screen.findByText('Tightening is saved at once.')
    expect(get).not.toHaveBeenCalled()
    expect(assertions).toEqual([])
    expect(calls).toEqual(['POST /api/agents/agt_1/rules-challenge', 'PUT /api/agents/agt_1/rules'])
  })

  it('with only the phone’s key, a looser save says to add this browser and sends nothing', async () => {
    const { calls, saved } = mockBff(BUILDER, { looser: true, phone: true })
    window.history.pushState({}, '', '/agents/agt_1/rules')
    render(<App />)

    await coder()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save rules' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Save rules' }))
    expect((await screen.findByTestId('on-the-phone')).textContent).toBe(
      'Loosen Builder’s rules with a passkey on this browser: add this browser first.Add this browser',
    )
    expect(screen.queryByRole('button', { name: /^Save/ })).toBeNull()
    expect(saved).toEqual([])
    expect(calls).toEqual(['POST /api/agents/agt_1/rules-challenge'])
  })
})
