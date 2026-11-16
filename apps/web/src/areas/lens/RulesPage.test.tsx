import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'
import { pressEverything } from '../../test/pressEverything'

// B57.23 — an agent's rules on their own page, /agents/:id/rules. Every row and every More rules field saves into the
// rules body Lens takes today (PUT /api/agents/{id}/rules); Always allow is a field there now; a save that changes
// nothing sends nothing and says so. B61.14 — every amount is typed in money, and the model, provider and
// requests-a-minute rules are not drawn: a save sends back what Lens holds for them. B61.87 — the limits are typed in the
// rules' currency and saved in its minor units ($25 is 2,500 cents); payee amounts stay in dollars at Lens's peg ($0.10
// a LXC here, so $40 is 400,000,000 µLXC).

const M = 1_000_000

const RULES = {
  max_per_request_ulxc: 0, hourly_limit_ulxc: 0, daily_limit_ulxc: 0, weekly_limit_ulxc: 0, monthly_limit_ulxc: 0, approval_above_ulxc: 0,
  requests_per_minute: 0, model_daily_limits_ulxc: {}, allowed_models: [], allowed_providers: [], allowed_listings: [], allowed_payees: [],
  blocked_payees: [], payee_daily_limits_ulxc: {}, payee_monthly_limits_ulxc: {}, payee_allowances: {}, active_from: '', active_until: '',
  timezone: 'UTC', pause_on_unusual_spend: false,
}

function mockBff(held: Record<string, unknown> = {}) {
  const sent: Array<{ method: string; url: string; body?: unknown }> = []
  const agents = [
    { id: 'agt_1', name: 'Research', balance_ulxc: 10 * M, spent_ulxc: 0, keys: [], created_at: '2026-08-01T09:00:00Z', owner_user_id: 'ws_1' },
    { id: 'agt_2', name: 'Sales', balance_ulxc: 0, spent_ulxc: 0, keys: [], created_at: '2026-08-01T09:00:00Z', owner_user_id: 'ws_1' },
  ]
  let rules: Record<string, unknown> = { ...RULES, ...held }
  const versions = [{ version: 1, rules, changed_by: 'jwt:user:ws_1', change: 'set', created_at: '2026-09-14T09:00:00Z' }]
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    if (method !== 'GET') sent.push({ method, url, body })
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/lxc/topup-options') return json({ allowed_usd_cents: [1000], billing_enabled: true, usd_per_lxc: 0.1 })
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
    // B61.14 — the parked gateway's rules are not drawn, as rows or under More rules.
    for (const rule of ['Only these models', 'At most requests a minute']) expect(screen.queryByRole('switch', { name: rule })).not.toBeInTheDocument()
    for (const rule of [/^Only these providers/, /^At most a day on one model/])
      expect(within(screen.getByTestId('more-rules')).queryByRole('link', { name: rule })).not.toBeInTheDocument()
    for (const [rule, value] of [['Asks you above', '25'], ['At most on one request', '100'], ['At most a day', '50'], ['At most a month', '200']]) {
      turnOn(rule)
      field(`${rule} for Research, in dollars`, value)
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
    field('Always allow Acme Hosting from Research, in dollars a month', '40')
    turnOn('Pauses if its spending looks unusual')
    more('At most an hour')
    field('At most an hour for Research, in dollars', '5')
    more('At most a week')
    field('At most a week for Research, in dollars', '150')
    more('Never these payees')
    field('A payee’s id to add to payees Research may never pay', 'mrc_casino')
    fireEvent.click(within(screen.getByRole('group', { name: 'Payees Research may never pay' })).getByRole('button', { name: 'Add' }))
    more('At most a day to one payee')
    field('Add to a day to one payee from Research', 'agt_2')
    field('A day to one payee from Research: Sales, in dollars', '0.5')
    more('At most a month to one payee')
    field('Add to a month to one payee from Research', 'agt_2')
    field('A month to one payee from Research: Sales, in dollars', '6')
    more('Time zone')
    field('Time zone for Research', 'Europe/London')
    fireEvent.click(screen.getByRole('button', { name: 'Save rules' }))

    await waitFor(() => expect(sent.some((s) => s.method === 'PUT')).toBe(true))
    expect(sent.find((s) => s.method === 'PUT')).toEqual({
      method: 'PUT',
      url: '/api/agents/agt_1/rules',
      body: {
        // B61.87 — the limits in the rules' currency (dollars, as Lens names none here), in cents, and no µLXC limit.
        currency: 'USD', max_per_payment_minor: 10000, hourly_limit_minor: 500, daily_limit_minor: 5000, weekly_limit_minor: 15000,
        monthly_limit_minor: 20000, approval_above_minor: 2500, requests_per_minute: 0, model_daily_limits_ulxc: {},
        allowed_models: [], allowed_providers: [], allowed_listings: [], allowed_payees: ['agt_2', 'mrc_compute'],
        blocked_payees: ['mrc_casino'], payee_daily_limits_ulxc: { agt_2: 5 * M }, payee_monthly_limits_ulxc: { agt_2: 60 * M },
        active_from: '08:00', active_until: '20:00', timezone: 'Europe/London', pause_on_unusual_spend: true,
        payee_allowances: { pye_acme: { amount_ulxc: 400 * M, per: 'month' } },
      },
    })
    // The save asked Lens first what it does; it tightens, so it was saved at once, and the page goes back to the agent.
    expect(sent.map((s) => `${s.method} ${s.url}`)).toEqual(['POST /api/agents/agt_1/rules-challenge', 'PUT /api/agents/agt_1/rules'])
    await waitFor(() => expect(window.location.pathname).toBe('/agents/agt_1'))
    // B61.82 — the address moves before React Router's move lands: the confirmation is asked for once the rules page is
    // gone from the screen, and it is still there a moment later.
    await waitFor(() => expect(screen.queryByTestId('rules-page')).toBeNull())
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.getByRole('status')).toHaveTextContent('Research’s rules are saved as version 2')
  })

  it('says Nothing changed and sends nothing when no rule changed, and a rule turned off is saved as none', async () => {
    const sent = mockBff()
    window.history.pushState({}, '', '/agents/agt_1/rules')
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: 'Save rules' }))
    expect((await screen.findByRole('status')).textContent).toBe('Nothing changed. Research’s rules are as they were, so no new version was kept.')
    // Turned on and off again with a value typed: still nothing to save.
    turnOn('At most a day')
    field('At most a day for Research, in dollars', '0.5')
    turnOn('At most a day')
    fireEvent.click(screen.getByRole('button', { name: 'Save rules' }))
    expect((await screen.findByRole('status')).textContent).toContain('Nothing changed.')
    expect(sent).toEqual([])
  })

  it('sends back unchanged the model, provider and requests-a-minute rules Lens holds, which it does not draw (B61.14)', async () => {
    const held = { requests_per_minute: 30, model_daily_limits_ulxc: { 'claude-sonnet-5': 20 * M }, allowed_models: ['claude-haiku-4-5'], allowed_providers: ['anthropic'] }
    const sent = mockBff(held)
    window.history.pushState({}, '', '/agents/agt_1/rules')
    render(<App />)

    expect(await screen.findByRole('heading', { level: 1, name: 'Research’s rules' })).toBeInTheDocument()
    turnOn('At most a day')
    field('At most a day for Research, in dollars', '4.5')
    fireEvent.click(screen.getByRole('button', { name: 'Save rules' }))
    await waitFor(() => expect(sent.some((s) => s.method === 'PUT')).toBe(true))
    // B61.87 — $4.50 is 450 cents, and no µLXC limit is sent. Always allow did not change, so it is not sent (toEqual reads
    // undefined as absent).
    const noULXC = { max_per_request_ulxc: undefined, hourly_limit_ulxc: undefined, daily_limit_ulxc: undefined, weekly_limit_ulxc: undefined, monthly_limit_ulxc: undefined, approval_above_ulxc: undefined }
    const inCents = { currency: 'USD', max_per_payment_minor: 0, hourly_limit_minor: 0, daily_limit_minor: 450, weekly_limit_minor: 0, monthly_limit_minor: 0, approval_above_minor: 0 }
    expect(sent.find((s) => s.method === 'PUT')?.body).toEqual({ ...RULES, ...held, ...noULXC, ...inCents, payee_allowances: undefined })
  })

  it('has no control that does nothing', { timeout: 120_000 }, async () => {
    const report = await pressEverything('/agents/agt_research/rules')
    expect(report.dead).toEqual([])
    expect(report.pressed).toBeGreaterThan(20)
  })
})
