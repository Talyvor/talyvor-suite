import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ActivityPaymentScreen } from './ActivityPayment'
import { App, queryClient } from '../../App'
import { AppMoney } from './money'
import { pressEverything } from '../../test/pressEverything'

// B62.3 — a payment's page shows its proof (Lens B62.1): what the owner approved, when, with which key, the rule that
// asked them or let it pass, and what was sent; the agent's task above it, after "The agent says:" (Lens B62.2); and one
// button that copies the proof as text. Approval cards show the task the same way.

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const ACME = { kind: 'outside', id: 'payee_acme', name: 'Acme Hosting' }
const line = (entry_id: string, task = '') => ({
  entry_id, line: 1, at: '2026-11-16T10:00:00Z', kind: 'payment_out', amount_minor: -15_000, funding: 'test', counterparty: 'Acme Hosting', balance_after_minor: 0, ...(task ? { task } : {}),
})
const proof = (over: Record<string, unknown>) => ({
  id: 'pp_1', rule: 'approval_above', rules_version: 4, created_at: '2026-11-16T10:00:00Z', verified: false,
  shown: { agent_id: 'agt_research', agent_name: 'Research', payee: ACME, amount_minor: 15_000, currency: 'EUR' },
  sent: { agent_id: 'agt_research', payee: ACME, amount_minor: 15_000, currency: 'EUR', rail: 'account', reference: 'ref_1' },
  ...over,
})

const APPROVED = proof({ approval_id: 'apr_1', key_kind: 'device', key_id: 'dk_1', signed_at: '2026-11-16T09:58:00Z', verified: true })
const PASSED = proof({ rule: 'within_rules', rules_version: 2 })
let proofs: Record<string, unknown>

beforeEach(() => {
  proofs = { ent_approved: APPROVED, ent_passed: PASSED }
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const path = String(input).split('?')[0]
    if (path === '/api/agents') return json({ workspace_balance_ulxc: 0, allocated_ulxc: 0, unallocated_ulxc: 0, spent_ulxc: 0, agents: [{ id: 'agt_research', name: 'Research', balance_ulxc: 0, spent_ulxc: 0, keys: [], created_at: '2026-10-01T09:00:00Z' }] })
    if (path === '/api/money/accounts')
      return json({ accounts: [{ id: 'acct_eur', currency: 'EUR', agent_id: 'agt_research', purpose: 'agent', status: 'open', name: 'EUR', balance_minor: 0, test_minor: 0, live_minor: 0 }] })
    if (path === '/api/money/accounts/acct_eur/statement')
      return json({ account_id: 'acct_eur', currency: 'EUR', opening_minor: 0, in_minor: 0, out_minor: 0, closing_minor: 0,
        lines: [line('ent_approved', 'Renew the hosting for the research cluster'), line('ent_passed'), line('ent_none')] })
    if (path === '/api/money/devices') return json({ devices: [{ id: 'dk_1', platform: 'ios', name: 'Nicolai’s iPhone' }] })
    if (path === '/api/agents/passkeys') return json({ passkeys: [] })
    const m = /^\/api\/payment-proofs\/(\w+)$/.exec(path)
    if (m && proofs[m[1]]) return json(proofs[m[1]])
    return json({ error: 'no payment of this workspace has a record by that id' }, 404)
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function show(entry: string) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[`/activity/acct_eur/${entry}`]}>
        <AppMoney>
          <Routes>
            <Route path="/activity/:account/:entry" element={<ActivityPaymentScreen />} />
          </Routes>
        </AppMoney>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const fact = (section: HTMLElement, label: string) =>
  [...section.querySelectorAll('dl > div')].find((d) => d.querySelector('dt')?.textContent === label)?.querySelector('dd')?.textContent ?? null

describe('a payment’s proof', () => {
  it('says what the owner approved, when, with which key, the rule and what was sent', async () => {
    show('ent_approved')
    const section = await screen.findByTestId('payment-proof')
    expect(within(section).getByRole('heading', { name: 'Proof' })).toBeTruthy()
    expect(fact(section, 'You approved')).toBe('€150.00 to Acme Hosting')
    expect(fact(section, 'When')).toMatch(/^(Today|Yesterday|\d+ \w+), \d\d:\d\d$/)
    await waitFor(() => expect(fact(section, 'Signed with')).toBe('Face ID on Nicolai’s iPhone'))
    expect(fact(section, 'The rule')).toBe('It was above the amount the agent’s rules ask you about (rules version 4)')
    expect(fact(section, 'What was sent')).toBe('€150.00 to Acme Hosting')
    expect(section.textContent).toContain('The signature checks out')
    expect(section.textContent).not.toMatch(/pp_1|apr_1|dk_1|ref_1/)
  })

  it('names the rule that let a payment pass, with no key', async () => {
    show('ent_passed')
    const section = await screen.findByTestId('payment-proof')
    expect(fact(section, 'The rule')).toBe('Inside the agent’s rules, so it needed no approval (rules version 2)')
    expect(fact(section, 'You approved')).toBeNull()
    expect(fact(section, 'Signed with')).toBeNull()
    expect(fact(section, 'What was sent')).toBe('€150.00 to Acme Hosting')
  })

  it('says when a signature does not check out', async () => {
    proofs.ent_approved = { ...APPROVED, verified: false }
    show('ent_approved')
    const section = await screen.findByTestId('payment-proof')
    expect(section.textContent).toContain('The signature does not check out against what you approved.')
  })

  it('shows the agent’s task above the proof, in its own words after “The agent says:”', async () => {
    show('ent_approved')
    const section = await screen.findByTestId('payment-proof')
    const says = within(section).getByTestId('agent-says')
    expect(says.textContent).toBe('The agent says: “Renew the hosting for the research cluster”')
    expect(says.compareDocumentPosition(within(section).getByRole('heading', { name: 'Proof' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('draws no proof for a payment the rules never judged', async () => {
    show('ent_none')
    await screen.findByTestId('activity-payment')
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([u]) => String(u) === '/api/payment-proofs/ent_none')).toBe(true))
    expect(screen.queryByTestId('payment-proof')).toBeNull()
    expect(screen.queryByText(/couldn’t read this payment’s proof/)).toBeNull()
  })

  it('copies the proof as text, for a dispute', async () => {
    const writeText = vi.fn(async (_: string) => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    show('ent_approved')
    const section = await screen.findByTestId('payment-proof')
    await waitFor(() => expect(fact(section, 'Signed with')).toBe('Face ID on Nicolai’s iPhone'))
    fireEvent.click(within(section).getByRole('button', { name: 'Copy the proof' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    const text = writeText.mock.calls[0][0]
    expect(text.split('\n').slice(0, 3)).toEqual(['Payment proof', 'The agent says: “Renew the hosting for the research cluster”', 'You approved: €150.00 to Acme Hosting'])
    expect(text).toContain('You approved: €150.00 to Acme Hosting')
    expect(text).toContain('Signed with: Face ID on Nicolai’s iPhone')
    expect(text).toContain('The rule: It was above the amount the agent’s rules ask you about (rules version 4)')
    expect(text).toContain('What was sent: €150.00 to Acme Hosting')
  })
})

describe('an approval card', () => {
  it('shows the agent’s task the same way', async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const path = String(input).split('?')[0]
      if (path === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
      if (path === '/api/agents/approvals')
        return json({ approvals: [{ id: 'apr_9', agent_id: 'agt_research', amount_ulxc: 3_000_000, model: '', status: 'pending', created_at: '2026-11-16T10:00:00Z', payee: ACME, task: 'Renew the hosting for the research cluster' }] })
      if (path === '/api/agents') return json({ workspace_balance_ulxc: 0, allocated_ulxc: 0, unallocated_ulxc: 0, spent_ulxc: 0, agents: [] })
      if (path === '/api/money/payment-requests') return json({ requests: [] })
      if (path === '/api/money/mandates') return json({ granted: [], received: [] })
      if (path === '/api/agents/passkeys') return json({ passkeys: [] })
      if (path === '/api/money/devices') return json({ devices: [] })
      return json({ error: 'not here' }, 404)
    })
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    queryClient.clear()
    window.history.pushState({}, '', '/approvals')
    render(<App />)
    const row = await waitFor(() => {
      const r = document.querySelector('[data-approval="apr_9"]')
      if (!r) throw new Error('no row yet')
      return r as HTMLElement
    })
    expect(within(row).getByTestId('agent-says').textContent).toBe('The agent says: “Renew the hosting for the research cluster”')
  })
})

describe('a payment’s proof in the app', () => {
  it('has no control that does nothing', async () => {
    const report = await pressEverything('/activity/macc_agt/ment_out')
    expect(report.dead).toEqual([])
    expect(report.pressed).toBeGreaterThan(0)
  }, 60_000)
})
