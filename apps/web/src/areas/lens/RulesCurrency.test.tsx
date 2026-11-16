import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'
import { convertDown, parseRuleAmount, ruleAmountText } from './rulesCurrency'

// B61.87 — an agent's rules are typed and shown in the account's own currency (Lens B61.12): a save names the currency
// and each limit in its minor units, and no µLXC limit; "Would it pass?" asks amount_minor and currency; rules Lens still
// holds in dollars on a euros account open converted at the day's rate, rounded down, and that save names every limit.

const M = 1_000_000

const RULES = {
  max_per_request_ulxc: 0, hourly_limit_ulxc: 0, daily_limit_ulxc: 0, weekly_limit_ulxc: 0, monthly_limit_ulxc: 0, approval_above_ulxc: 0,
  requests_per_minute: 0, model_daily_limits_ulxc: {}, allowed_models: [], allowed_providers: [], allowed_listings: [], allowed_payees: [],
  blocked_payees: [], payee_daily_limits_ulxc: {}, payee_monthly_limits_ulxc: {}, payee_allowances: {}, active_from: '', active_until: '',
  timezone: 'UTC', pause_on_unusual_spend: false,
  currency: 'USD', max_per_payment_minor: 0, hourly_limit_minor: 0, daily_limit_minor: 0, weekly_limit_minor: 0, monthly_limit_minor: 0,
  approval_above_minor: 0,
}

function mockBff(fiat: string, held: Record<string, unknown>) {
  const sent: Array<{ method: string; url: string; body?: unknown }> = []
  const agents = [
    { id: 'agt_1', name: 'Research', balance_ulxc: 0, spent_ulxc: 0, keys: [], created_at: '2026-08-01T09:00:00Z', owner_user_id: 'ws_1', wallet_kind: 'fiat', fiat_currency: fiat },
    { id: 'agt_2', name: 'Sales', balance_ulxc: 0, spent_ulxc: 0, keys: [], created_at: '2026-08-01T09:00:00Z', owner_user_id: 'ws_1', wallet_kind: 'fiat', fiat_currency: fiat },
  ]
  let rules: Record<string, unknown> = { ...RULES, ...held }
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    if (method !== 'GET') sent.push({ method, url, body })
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/lxc/topup-options') return json({ allowed_usd_cents: [1000], billing_enabled: true, usd_per_lxc: 0.1 })
    if (url === '/api/fx') return json({ rate_date: '2026-11-13', usd_per_eur: 1.25, gbp_per_eur: 0.8 })
    if (url === '/api/agents') return json({ workspace_balance_ulxc: 0, allocated_ulxc: 0, unallocated_ulxc: 0, spent_ulxc: 0, agents })
    if (url === '/api/money/payees') return json({ payees: [] })
    if (url === '/api/agents/passkeys') return json({ passkeys: [] })
    if (url === '/api/money/devices') return json({ devices: [] })
    if (url === '/api/agents/agt_1/rules/history') return json({ versions: [{ version: 1, rules, changed_by: 'jwt:user:ws_1', change: 'set', created_at: '2026-09-14T09:00:00Z' }] })
    if (url === '/api/agents/agt_1/rules-challenge') return json({ looser: false, changes: [], allow_credentials: [] })
    if (url === '/api/agents/agt_1/rules/simulate') return json({ verdict: 'allowed', reason: '', amount_ulxc: 0, at: '2026-11-13T09:00:00Z', balance_ulxc: 0 })
    if (url === '/api/agents/agt_1/rules' && method === 'PUT') {
      rules = { ...rules, ...(body as object) }
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

describe('an agent’s rules in the account’s own currency', () => {
  it('on a pounds account types a limit in pounds, and the save names GBP and daily_limit_minor and no µLXC limit', async () => {
    const sent = mockBff('GBP', { currency: 'GBP', daily_limit_minor: 5000, daily_limit_ulxc: 62_500 * M })
    window.history.pushState({}, '', '/agents/agt_1/rules')
    render(<App />)

    const daily = await screen.findByLabelText('At most a day for Research, in pounds')
    expect(daily).toHaveValue('50')
    fireEvent.change(daily, { target: { value: '125.55' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save rules' }))

    await waitFor(() => expect(sent.some((s) => s.method === 'PUT')).toBe(true))
    const body = sent.find((s) => s.method === 'PUT')!.body as Record<string, unknown>
    expect(body).toMatchObject({
      currency: 'GBP',
      daily_limit_minor: 12555,
      max_per_payment_minor: 0,
      hourly_limit_minor: 0,
      weekly_limit_minor: 0,
      monthly_limit_minor: 0,
      approval_above_minor: 0,
    })
    for (const k of ['max_per_request_ulxc', 'hourly_limit_ulxc', 'daily_limit_ulxc', 'weekly_limit_ulxc', 'monthly_limit_ulxc', 'approval_above_ulxc'])
      expect(body).not.toHaveProperty(k)
  })

  it('asks Would it pass? in the account’s currency: amount_minor and currency, no µLXC', async () => {
    const sent = mockBff('EUR', { currency: 'EUR' })
    window.history.pushState({}, '', '/agents/agt_1/rules')
    render(<App />)

    const card = await screen.findByTestId('would-it-pass')
    fireEvent.change(within(card).getByLabelText('Amount in euros to try for Research'), { target: { value: '12.34' } })
    fireEvent.click(within(card).getByRole('button', { name: 'Would it pass?' }))

    await waitFor(() => expect(sent.some((s) => s.url.endsWith('/rules/simulate'))).toBe(true))
    expect(sent.find((s) => s.url.endsWith('/rules/simulate'))!.body).toEqual({
      amount_ulxc: 0,
      amount_minor: 1234,
      currency: 'EUR',
      payee: { kind: 'agent', id: 'agt_2' },
    })
  })

  it('opens dollar rules on a euros account converted at the day’s rate, rounded down, and the save names every limit in euros', async () => {
    // $100.00 a day and $33.33 to ask above, at $1.25 a euro: €80.00 and €26.664 → €26.66.
    const sent = mockBff('EUR', { currency: 'USD', daily_limit_minor: 10000, approval_above_minor: 3333 })
    window.history.pushState({}, '', '/agents/agt_1/rules')
    render(<App />)

    expect(await screen.findByTestId('rules-currency')).toHaveTextContent(
      'Research’s rules are still held in dollars. Each limit below is in euros at today’s rate, rounded down: check them, then save to hold the rules in euros.',
    )
    expect(screen.getByLabelText('At most a day for Research, in euros')).toHaveValue('80')
    expect(screen.getByLabelText('Asks you above for Research, in euros')).toHaveValue('26.66')
    expect(screen.getByText('Held at $100.00, rounded down at today’s rate')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save rules' }))

    await waitFor(() => expect(sent.some((s) => s.method === 'PUT')).toBe(true))
    const body = sent.find((s) => s.method === 'PUT')!.body as Record<string, unknown>
    expect(body).toMatchObject({
      currency: 'EUR',
      max_per_payment_minor: 0,
      hourly_limit_minor: 0,
      daily_limit_minor: 8000,
      weekly_limit_minor: 0,
      monthly_limit_minor: 0,
      approval_above_minor: 2666,
    })
    expect(Object.keys(body).filter((k) => k.endsWith('_ulxc') && !k.startsWith('payee_') && k !== 'model_daily_limits_ulxc')).toEqual([])
  })

  it('reads back exactly what is typed, in GBP, EUR, USD and USDC', () => {
    for (const [currency, text, minor] of [
      ['GBP', '125.55', 12555],
      ['EUR', '0.01', 1],
      ['USD', '1000000', 100_000_000],
      ['USDC', '12.000001', 12_000_001],
      ['USDC', '0.5', 500_000],
    ] as const) {
      expect(parseRuleAmount(text, currency)).toBe(minor)
      expect(ruleAmountText(minor, currency)).toBe(text)
      expect(parseRuleAmount(ruleAmountText(minor, currency), currency)).toBe(minor)
    }
    expect(parseRuleAmount('12.555', 'GBP')).toBeNull()
    expect(parseRuleAmount('0.0000001', 'USDC')).toBeNull()
    expect(parseRuleAmount('', 'EUR')).toBe(0)
    // Between dollars and USDC by their decimals, with no rate; to pounds at the rate, rounded down.
    expect(convertDown(1234, 'USD', 'USDC', undefined)).toBe(12_340_000)
    expect(convertDown(12_345_678, 'USDC', 'USD', undefined)).toBe(1234)
    expect(convertDown(10001, 'USD', 'GBP', { rate_date: '', usd_per_eur: 1.25, gbp_per_eur: 0.8 })).toBe(6400)
  })
})
