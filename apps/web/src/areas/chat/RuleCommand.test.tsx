import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'
import { parseAskAbove, parseRule } from './RuleCommand'

// B28.352 — an agent's rule set in plain words in Chat: the sentence opens a card, read as typed, and Save puts the
// agent's rules back with that one limit changed. The BFF is mocked at the wire; that Lens then refuses an over-limit
// call is proven against Lens by the e2e scenario chat-plain-rule.
// B55.14 — both raise a limit, which loosens the rules (Lens B55.13): once the workspace has a passkey the card says so
// and saves only with it; Lens refuses the save unsigned, as here.

const M = 1_000_000

function mockBff(passkey = false) {
  const saved: Array<Record<string, unknown>> = []
  const challenged: unknown[] = []
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/models') {
      return json([
        { id: 'claude-opus-4-1', provider: 'anthropic', display_name: 'Claude Opus 4.1', input_per_1m: 15, output_per_1m: 75, tier: 'frontier', release_date: '2025-08-05' },
        { id: 'claude-opus-5', provider: 'anthropic', display_name: 'Claude Opus 5', input_per_1m: 5, output_per_1m: 25, tier: 'frontier', release_date: '2026-06-01' },
        { id: 'claude-haiku-4-5', provider: 'anthropic', display_name: 'Claude Haiku 4.5', input_per_1m: 1, output_per_1m: 5, tier: 'fast', release_date: '2025-10-01' },
      ])
    }
    if (url === '/api/ai/providers') return json({ unconfigured: [] })
    if (url === '/api/agents/approvals') return json({ approvals: [] })
    if (url === '/api/agents' && method === 'GET') {
      const agents = [{ id: 'agt_1', name: 'Researcher', balance_ulxc: 10 * M, spent_ulxc: 0, keys: [], created_at: '2026-10-06T05:00:00Z' }]
      return json({ workspace_balance_ulxc: 100 * M, allocated_ulxc: 10 * M, unallocated_ulxc: 90 * M, spent_ulxc: 0, agents })
    }
    if (url === '/api/agents/agt_1/rules' && method === 'GET') {
      return json({
        max_per_request_ulxc: M,
        daily_limit_ulxc: 8 * M,
        monthly_limit_ulxc: 100 * M,
        approval_above_ulxc: 2 * M,
        model_daily_limits_ulxc: { 'claude-opus-5': 2 * M, 'claude-haiku-4-5': M },
        allowed_models: [],
        allowed_providers: [],
        active_from: '',
        active_until: '',
        timezone: 'UTC',
      })
    }
    if (url === '/api/agents/passkeys') return json({ passkeys: passkey ? [{ credential_id: 'Y3JlZDE', name: 'iPhone', created_at: '2026-10-06T04:00:00Z' }] : [] })
    if (url === '/api/money/devices') return json({ devices: [] })
    if (url === '/api/agents/agt_1/rules-challenge') {
      challenged.push(body)
      return json({ looser: true, changes: ['Claude Opus 5 daily limit: was 2 LXC, now 5 LXC'], challenge: 'Y2gx', allow_credentials: passkey ? ['Y3JlZDE'] : [] })
    }
    if (url === '/api/agents/agt_1/rules' && method === 'PUT') {
      if (passkey && body.assertion === undefined) {
        return json({ error: "loosening an agent's rules is signed with your passkey or your phone: sign this change's challenge" }, 403)
      }
      saved.push(body)
      return json(body.rules ?? body)
    }
    return new Response('null', { status: 404 })
  })
  return { saved, challenged }
}

afterEach(() => {
  cleanup()
  queryClient.clear()
  vi.restoreAllMocks()
  window.localStorage.clear()
  window.history.pushState({}, '', '/')
})

describe('Set an agent’s rule in plain words from Chat (B28.352)', () => {
  it('reads the agent, the amount, how often and the model; a sentence without LXC is a question', () => {
    expect(parseRule('Cap agent A at 5 LXC a day on Opus')).toEqual({ agent: 'A', amount: '5', period: 'day', model: 'Opus' })
    expect(parseRule('limit “Support bot” to 0.5 LXC per hour.')).toEqual({ agent: 'Support bot', amount: '0.5', period: 'hour', model: '' })
    expect(parseRule('Limit caffeine to 3 a day')).toBeNull()
  })

  it('saves the one limit the sentence names and keeps every other rule', async () => {
    const bff = mockBff()
    window.history.pushState({}, '', '/chat')
    render(<App />)

    const box = await screen.findByRole('textbox', { name: /message/i })
    await waitFor(() => expect(box).not.toBeDisabled())
    fireEvent.change(box, { target: { value: 'Cap agent researcher at 5 LXC a day on Opus' } })
    fireEvent.keyDown(box, { key: 'Enter' })

    const card = await screen.findByTestId('chat-rule')
    expect(box).toHaveValue('')
    expect(screen.queryAllByTestId('turn-user')).toHaveLength(0) // nothing went to the model
    await waitFor(() => expect(within(card).getByLabelText('Agent')).toHaveValue('agt_1'))
    expect(within(card).getByLabelText('At most, in LXC')).toHaveValue('5')
    expect(within(card).getByLabelText('How often')).toHaveValue('day')
    await waitFor(() => expect(within(card).getByLabelText('On which model')).toHaveValue('claude-opus-5')) // the newest Opus
    expect(await within(card).findByText('It is', { exact: false })).toHaveTextContent('It is 2 LXC now.')
    expect(within(card).getByTestId('chat-rule-change')).toHaveTextContent(/^Researcher may spend at most 5 LXC a day on Claude Opus 5\./)

    fireEvent.click(within(card).getByRole('button', { name: 'Save the rule' }))
    const done = await within(card).findByTestId('chat-rule-saved')
    expect(done).toHaveTextContent(/^Saved: Researcher may spend at most 5 LXC a day on Claude Opus 5\. Lens refuses a call that would take it past that\. See its rules on Agent Wallets$/)
    expect(within(done).getByRole('link')).toHaveAttribute('href', '/agents?agent=agt_1')
    expect(bff.saved).toEqual([
      {
        max_per_request_ulxc: M,
        daily_limit_ulxc: 8 * M,
        monthly_limit_ulxc: 100 * M,
        approval_above_ulxc: 2 * M,
        model_daily_limits_ulxc: { 'claude-haiku-4-5': M, 'claude-opus-5': 5 * M },
        allowed_models: [],
        allowed_providers: [],
        active_from: '',
        active_until: '',
        timezone: 'UTC',
      },
    ])
  })

  it('a raise says what it loosens and saves only with the passkey', async () => {
    const bff = mockBff(true)
    const ASSERTION = { rawId: new Uint8Array([1]).buffer, response: { clientDataJSON: new Uint8Array([2]).buffer, authenticatorData: new Uint8Array([3]).buffer, signature: new Uint8Array([4]).buffer } }
    const get = vi.fn().mockResolvedValue(ASSERTION)
    Object.defineProperty(navigator, 'credentials', { value: { get, create: vi.fn() }, configurable: true })
    window.history.pushState({}, '', '/chat')
    render(<App />)

    const box = await screen.findByRole('textbox', { name: /message/i })
    await waitFor(() => expect(box).not.toBeDisabled())
    fireEvent.change(box, { target: { value: 'Cap agent researcher at 5 LXC a day on Opus' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    const card = await screen.findByTestId('chat-rule')
    await waitFor(() => expect(within(card).getByLabelText('On which model')).toHaveValue('claude-opus-5'))

    fireEvent.click(within(card).getByRole('button', { name: 'Save the rule' }))
    expect((await within(card).findByTestId('rules-loosen')).textContent).toBe(
      'This loosens Researcher’s rules:Claude Opus 5 daily limit: was 2 LXC, now 5 LXCIt needs your passkey. Tightening is saved at once.',
    )
    expect(get).not.toHaveBeenCalled()
    expect(bff.saved).toEqual([])

    fireEvent.click(within(card).getByRole('button', { name: 'Save with your passkey' }))
    await within(card).findByTestId('chat-rule-saved')
    expect(get).toHaveBeenCalledTimes(1)
    expect(bff.challenged).toHaveLength(2)
    expect(bff.saved).toHaveLength(1)
    expect(bff.saved[0].assertion).toEqual({ credential_id: 'AQ', client_data_json: 'Ag', authenticator_data: 'Aw', signature: 'BA' })
    expect((bff.saved[0].rules as Record<string, unknown>).model_daily_limits_ulxc).toEqual({ 'claude-haiku-4-5': M, 'claude-opus-5': 5 * M })
  })
})

describe('Set an agent’s approval amount from Chat (B28.353)', () => {
  it('reads the amount and the agent; without LXC it is a question', () => {
    expect(parseAskAbove('Ask me above 2 LXC')).toEqual({ agent: '', amount: '2' })
    expect(parseAskAbove('please ask me before anything over 0.5 LXC for “Support bot”.')).toEqual({ agent: 'Support bot', amount: '0.5' })
    expect(parseAskAbove('Ask me above 2 dollars')).toBeNull()
  })

  it('saves the approval amount on the workspace’s one agent and keeps every other rule', async () => {
    const bff = mockBff()
    window.history.pushState({}, '', '/chat')
    render(<App />)

    const box = await screen.findByRole('textbox', { name: /message/i })
    await waitFor(() => expect(box).not.toBeDisabled())
    fireEvent.change(box, { target: { value: 'Ask me above 2.5 LXC' } })
    fireEvent.keyDown(box, { key: 'Enter' })

    const card = await screen.findByTestId('chat-ask-above')
    expect(screen.queryAllByTestId('turn-user')).toHaveLength(0) // nothing went to the model
    await waitFor(() => expect(within(card).getByLabelText('Agent')).toHaveValue('agt_1'))
    expect(within(card).getByLabelText('Ask above, in LXC')).toHaveValue('2.5')
    expect(await within(card).findByText('It is', { exact: false })).toHaveTextContent('It is 2 LXC now.')
    expect(within(card).getByTestId('chat-ask-above-change')).toHaveTextContent(/^A person must approve any request or payment Researcher makes above 2\.5 LXC\./)

    fireEvent.click(within(card).getByRole('button', { name: 'Save the rule' }))
    const done = await within(card).findByTestId('chat-ask-above-saved')
    expect(done).toHaveTextContent(/^Saved: a person must approve any request or payment Researcher makes above 2\.5 LXC\. Until then it waits in Approvals\. See its rules on Agent Wallets$/)
    expect(bff.saved).toEqual([
      {
        max_per_request_ulxc: M,
        daily_limit_ulxc: 8 * M,
        monthly_limit_ulxc: 100 * M,
        approval_above_ulxc: 2.5 * M,
        model_daily_limits_ulxc: { 'claude-opus-5': 2 * M, 'claude-haiku-4-5': M },
        allowed_models: [],
        allowed_providers: [],
        active_from: '',
        active_until: '',
        timezone: 'UTC',
      },
    ])
  })
})
