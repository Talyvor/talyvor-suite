import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'
import { pressEverything } from '../../test/pressEverything'

// B57.23 — an agent's rules on their own page, /agents/:id/rules. Every row and every More rules field saves into the
// rules body Lens takes today (PUT /api/agents/{id}/rules); Always allow is a field there now; a save that changes
// nothing sends nothing and says so.

const M = 1_000_000

const RULES = {
  max_per_request_ulxc: 0, hourly_limit_ulxc: 0, daily_limit_ulxc: 0, weekly_limit_ulxc: 0, monthly_limit_ulxc: 0, approval_above_ulxc: 0,
  requests_per_minute: 0, model_daily_limits_ulxc: {}, allowed_models: [], allowed_providers: [], allowed_listings: [], allowed_payees: [],
  blocked_payees: [], payee_daily_limits_ulxc: {}, payee_monthly_limits_ulxc: {}, payee_allowances: {}, active_from: '', active_until: '',
  timezone: 'UTC', pause_on_unusual_spend: false,
}

function mockBff() {
  const sent: Array<{ method: string; url: string; body?: unknown }> = []
  const agents = [
    { id: 'agt_1', name: 'Research', balance_ulxc: 10 * M, spent_ulxc: 0, keys: [], created_at: '2026-08-01T09:00:00Z', owner_user_id: 'ws_1' },
    { id: 'agt_2', name: 'Sales', balance_ulxc: 0, spent_ulxc: 0, keys: [], created_at: '2026-08-01T09:00:00Z', owner_user_id: 'ws_1' },
  ]
  let rules: Record<string, unknown> = { ...RULES }
  const versions = [{ version: 1, rules, changed_by: 'jwt:user:ws_1', change: 'set', created_at: '2026-09-14T09:00:00Z' }]
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    if (method !== 'GET') sent.push({ method, url, body })
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/agents') return json({ workspace_balance_ulxc: 20 * M, allocated_ulxc: 10 * M, unallocated_ulxc: 10 * M, spent_ulxc: 0, agents })
    if (url === '/api/models')
      return json([
        { id: 'claude-sonnet-5', provider: 'anthropic', display_name: 'Claude Sonnet 5', input_per_1m: 3, output_per_1m: 15 },
        { id: 'claude-haiku-4-5', provider: 'anthropic', display_name: 'Claude Haiku 4.5', input_per_1m: 1, output_per_1m: 5 },
      ])
    if (url === '/api/money/payees') return json({ payees: [{ id: 'pye_acme', name: 'Acme Hosting', country: 'GB', check: 'exact_match', checked_by: 'x', checked_at: '2026-10-01T00:00:00Z' }] })
    if (url === '/api/agents/passkeys') return json({ passkeys: [] })
    if (url === '/api/money/devices') return json({ devices: [] })
    if (url === '/api/agents/agt_1/rules/history') return json({ versions })
    if (url === '/api/agents/agt_1/rules-challenge') return json({ looser: false, changes: [], allow_credentials: [] })
    if (url === '/api/agents/agt_1/rules' && method === 'PUT') {
      rules = { ...rules, ...(body as object) }
      versions.unshift({ version: versions.length + 1, rules, changed_by: 'jwt:user:ws_1', change: 'set', created_at: '2026-10-20T09:00:00Z' })
      return json(rules)
    }
    if (url === '/api/agents/agt_1/rules') return json(rules)
    return new Response('null', { status: 404 })
  })
  return sent
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  queryClient.clear()
  window.history.pushState({}, '', '/')
})

const field = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })
const turnOn = (rule: string) => fireEvent.click(screen.getByRole('switch', { name: rule }))
const more = (rule: string) => fireEvent.click(within(screen.getByTestId('more-rules')).getByRole('link', { name: new RegExp(`^${rule}`) }))

describe('an agent’s rules page', () => {
  it('saves every rule it draws into the rules body Lens takes, Always allow among them', async () => {
    const sent = mockBff()
    window.history.pushState({}, '', '/agents/agt_1/rules')
    render(<App />)

    expect(await screen.findByRole('heading', { level: 1, name: 'Research’s rules' })).toBeInTheDocument()
    expect(screen.getByText('Turn on the rules you want. Every change is kept in the history.')).toBeInTheDocument()
    for (const [rule, value] of [['Asks you above', '250'], ['At most on one request', '1000'], ['At most a day', '500'], ['At most a month', '2000']]) {
      turnOn(rule)
      field(`${rule} for Research, in LXC`, value)
    }
    turnOn('Only at certain hours')
    field('Research works from', '08:00')
    field('Research works until', '20:00')
    turnOn('Only these payees')
    field('Add to payees Research may pay', 'agt_2')
    field('A payee’s id to add to payees Research may pay', 'mrc_compute')
    fireEvent.click(within(screen.getByRole('group', { name: 'Payees Research may pay' })).getByRole('button', { name: 'Add' }))
    turnOn('Always allow a payee')
    field('A payee Research always may pay', 'pye_acme')
    fireEvent.click(within(screen.getByRole('switch', { name: 'Always allow a payee' }).parentElement!).getByRole('button', { name: 'Add' }))
    field('Always allow Acme Hosting from Research, in LXC a month', '400')
    turnOn('Only these models')
    await waitFor(() => expect(screen.getByLabelText('Add to models Research may use')).toBeInTheDocument())
    field('Add to models Research may use', 'claude-haiku-4-5')
    turnOn('At most requests a minute')
    field('Requests a minute for Research', '30')
    turnOn('Pauses if its spending looks unusual')
    more('At most an hour')
    field('At most an hour for Research, in LXC', '50')
    more('At most a week')
    field('At most a week for Research, in LXC', '1500')
    more('Only these providers')
    field('Add to providers Research may use', 'anthropic')
    more('Never these payees')
    field('A payee’s id to add to payees Research may never pay', 'mrc_casino')
    fireEvent.click(within(screen.getByRole('group', { name: 'Payees Research may never pay' })).getByRole('button', { name: 'Add' }))
    more('At most a day on one model')
    field('Add to a day on one model for Research', 'claude-sonnet-5')
    field('A day on one model for Research: Claude Sonnet 5, in LXC', '20')
    more('At most a day to one payee')
    field('Add to a day to one payee from Research', 'agt_2')
    field('A day to one payee from Research: Sales, in LXC', '5')
    more('At most a month to one payee')
    field('Add to a month to one payee from Research', 'agt_2')
    field('A month to one payee from Research: Sales, in LXC', '60')
    more('Time zone')
    field('Time zone for Research', 'Europe/London')
    fireEvent.click(screen.getByRole('button', { name: 'Save rules' }))

    await waitFor(() => expect(sent.some((s) => s.method === 'PUT')).toBe(true))
    expect(sent.find((s) => s.method === 'PUT')).toEqual({
      method: 'PUT',
      url: '/api/agents/agt_1/rules',
      body: {
        max_per_request_ulxc: 1000 * M, hourly_limit_ulxc: 50 * M, daily_limit_ulxc: 500 * M, weekly_limit_ulxc: 1500 * M, monthly_limit_ulxc: 2000 * M,
        approval_above_ulxc: 250 * M, requests_per_minute: 30, model_daily_limits_ulxc: { 'claude-sonnet-5': 20 * M },
        allowed_models: ['claude-haiku-4-5'], allowed_providers: ['anthropic'], allowed_listings: [], allowed_payees: ['agt_2', 'mrc_compute'],
        blocked_payees: ['mrc_casino'], payee_daily_limits_ulxc: { agt_2: 5 * M }, payee_monthly_limits_ulxc: { agt_2: 60 * M },
        active_from: '08:00', active_until: '20:00', timezone: 'Europe/London', pause_on_unusual_spend: true,
        payee_allowances: { pye_acme: { amount_ulxc: 400 * M, per: 'month' } },
      },
    })
    // The save asked Lens first what it does; it tightens, so it was saved at once, and the page goes back to the agent.
    expect(sent.map((s) => `${s.method} ${s.url}`)).toEqual(['POST /api/agents/agt_1/rules-challenge', 'PUT /api/agents/agt_1/rules'])
    await waitFor(() => expect(window.location.pathname).toBe('/agents/agt_1'))
    expect(await screen.findByText('Research’s rules are saved as version 2')).toBeInTheDocument()
  })

  it('says Nothing changed and sends nothing when no rule changed, and a rule turned off is saved as none', async () => {
    const sent = mockBff()
    window.history.pushState({}, '', '/agents/agt_1/rules')
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: 'Save rules' }))
    expect((await screen.findByRole('status')).textContent).toBe('Nothing changed. Research’s rules are as they were, so no new version was kept.')
    // Turned on and off again with a value typed: still nothing to save.
    turnOn('At most a day')
    field('At most a day for Research, in LXC', '5')
    turnOn('At most a day')
    fireEvent.click(screen.getByRole('button', { name: 'Save rules' }))
    expect((await screen.findByRole('status')).textContent).toContain('Nothing changed.')
    expect(sent).toEqual([])
  })

  it('has no control that does nothing', { timeout: 120_000 }, async () => {
    const report = await pressEverything('/agents/agt_research/rules')
    expect(report.dead).toEqual([])
    expect(report.pressed).toBeGreaterThan(20)
  })
})
