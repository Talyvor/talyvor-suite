import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B61.84 — Add money and Take back on an agent's page (Pocket Live's fund and take panels): the owner gives the agent money
// from the company's account in its account's currency, or takes it back, now (BFF B61.84, Lens B61.66). The dialog names
// the company's account and what it holds, has one review line, sends one move under one key, and the snack says what
// moved while both balances are read again. Lens's refusal is its own sentence; a currency the agent has no account in
// is said, with the currencies it has.

const M = 1_000_000
const RESEARCH = { id: 'agt_1', name: 'Research', balance_ulxc: 0, spent_ulxc: 0, keys: [], created_at: '2026-09-14T09:00:00Z', owner_user_id: 'usr_nick' }
const acct = (id: string, currency: string, purpose: 'company' | 'agent', minor: number, agent_id = '') => ({
  id, agent_id, currency, purpose, status: 'open', name: `${currency} account`, balance_minor: minor, test_minor: minor, live_minor: 0,
})

let company: number
let agent: number
let refusal: { status: number; error: string } | null
let posts: { path: string; body: Record<string, unknown>; key: string | null }[]
let reads: Record<string, number>

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
const text = (el: Element | null) => (el?.textContent ?? '').replace(/ /g, ' ')

beforeEach(() => {
  company = 10_000
  agent = 0
  refusal = null
  posts = []
  reads = {}
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const path = String(input).split('?')[0]
    const method = init?.method ?? 'GET'
    if (method === 'GET') reads[path] = (reads[path] ?? 0) + 1
    if (method === 'POST') posts.push({ path, body: JSON.parse(String(init?.body)), key: new Headers(init?.headers).get('Idempotency-Key') })
    if (path === '/auth/me') return json({ mode: 'oidc', authenticated: true, user: { sub: 'usr_nick', email: 'nick@example.com' } })
    if (path === '/api/workspace/account') return json({ account_type: 'business', money_kind: 'fiat' })
    if (path === '/api/agents') return json({ workspace_balance_ulxc: 0, allocated_ulxc: 0, unallocated_ulxc: 0, spent_ulxc: 0, agents: [RESEARCH] })
    if (path === '/api/agents/agt_1/summary')
      return json({
        as_of: '2026-11-16T09:30:00Z', agent: RESEARCH, made_at: '2026-09-14T09:00:00Z', owner_user_id: 'usr_nick', safe_to_spend: [],
        month: { start: '2026-11-01T00:00:00Z', end: '2026-12-01T00:00:00Z', spent_ulxc: 0, forecast_ulxc: 0, runs_out_at: null, runs_out_on: null, monthly_limit_ulxc: 20 * M },
        approvals: [], statement: [], statement_time_zone: 'UTC', rules: { version: 1, saved_at: '2026-11-01T09:00:00Z' }, card: { status: 'none' },
        currency_accounts: [acct('macc_research', 'USD', 'agent', agent, 'agt_1')],
      })
    if (path === '/api/money/accounts')
      return json({ accounts: [acct('macc_usd', 'USD', 'company', company), acct('macc_eur', 'EUR', 'company', 5_000), acct('macc_research', 'USD', 'agent', agent, 'agt_1')] })
    if (path === '/api/money/accounts/macc_research/funding') {
      if (refusal) return json({ error: refusal.error }, refusal.status)
      const body = JSON.parse(String(init?.body)) as { direction: string; amount_minor: number }
      const sign = body.direction === 'to_agent' ? 1 : -1
      company -= sign * body.amount_minor
      agent += sign * body.amount_minor
      return json({ direction: body.direction, currency: 'USD', amount_minor: body.amount_minor, company_account_id: 'macc_usd', agent_account_id: 'macc_research',
        agent_id: 'agt_1', company_balance_minor: company, agent_balance_minor: agent }, 201)
    }
    return json({ error: 'not here' }, 404)
  })
})

afterEach(() => {
  cleanup()
  queryClient.clear()
  vi.restoreAllMocks()
  window.history.pushState({}, '', '/')
})

async function openAgentPage() {
  window.history.pushState({}, '', '/agents/agt_1')
  render(<App />)
  return screen.findByTestId('agent-page-balance')
}

describe('Add money and Take back on an agent’s page (B61.84)', () => {
  it('adds $10.00 from the company account once under one key, says so, and reads both balances again', async () => {
    const page = await openAgentPage()
    fireEvent.click(within(page).getByRole('button', { name: 'Add money to Research' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add money to Research' })
    await waitFor(() => expect(text(within(dialog).getByTestId('agent-funding-line'))).toBe('From the company account. It holds $100.00.'))
    fireEvent.change(within(dialog).getByLabelText('Amount'), { target: { value: '10' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continue' }))
    expect(text(within(dialog).getByTestId('agent-funding-review'))).toBe('$10.00From the company account to Research’s US dollar account, now.')
    const accountsRead = reads['/api/money/accounts']
    const summaryRead = reads['/api/agents/agt_1/summary']
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move $10.00' }))
    await waitFor(() => expect(text(document.body)).toContain('$10.00 moved to Research'))
    expect(posts).toHaveLength(1)
    expect(posts[0].path).toBe('/api/money/accounts/macc_research/funding')
    expect(posts[0].body).toEqual({ direction: 'to_agent', amount_minor: 1000 })
    expect(posts[0].key).toMatch(/.{8,}/)
    await waitFor(() => expect(reads['/api/money/accounts']).toBeGreaterThan(accountsRead))
    await waitFor(() => expect(reads['/api/agents/agt_1/summary']).toBeGreaterThan(summaryRead))
    await waitFor(() => expect(text(screen.getByTestId('agent-page-account-USD'))).toContain('$10.00'))
  })

  it('shows Lens’s refusal in its own words and moves nothing', async () => {
    refusal = { status: 403, error: 'only the workspace’s owner or an admin may move money between the company and an agent' }
    const page = await openAgentPage()
    fireEvent.click(within(page).getByRole('button', { name: 'Take back from Research' }))
    const dialog = await screen.findByRole('dialog', { name: 'Take back from Research' })
    await waitFor(() => expect(text(within(dialog).getByTestId('agent-funding-line'))).toBe('Into the company account. Research holds $0.00.'))
    fireEvent.change(within(dialog).getByLabelText('Amount'), { target: { value: '4' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continue' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Take back $4.00' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Only the workspace’s owner or an admin may move money between the company and an agent.')
    expect(posts.map((p) => p.body)).toEqual([{ direction: 'to_company', amount_minor: 400 }])
    expect(company).toBe(10_000)
  })

  it('says when the agent has no account in the currency chosen, and offers the ones it has', async () => {
    const page = await openAgentPage()
    fireEvent.click(within(page).getByRole('button', { name: 'Add money to Research' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add money to Research' })
    fireEvent.change(await within(dialog).findByLabelText('Currency'), { target: { value: 'EUR' } })
    expect(text(within(dialog).getByTestId('agent-funding-other-currencies'))).toContain('Research has no Euro account. It has:')
    expect(within(dialog).getByRole('button', { name: 'Continue' })).toBeDisabled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'US dollar account' }))
    expect(within(dialog).queryByTestId('agent-funding-other-currencies')).toBeNull()
    expect(within(dialog).getByLabelText('Currency')).toHaveValue('USD')
  })
})
