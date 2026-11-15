import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'
import { pressEverything } from '../../test/pressEverything'
import { b64u } from './passkeys'

// B57.15 — the approval sheet, over the page you are on: ?approval=<id> on any page and /approvals#approval-<id> open
// it. It says what pays (Lens B57.11's paid_from), why it asks, the budget left after and when it expires, and each
// decision is signed with the passkey over that approval's challenge. The authenticator is stubbed (jsdom has none).

const M = 1_000_000
const bytes = (s: string) => new TextEncoder().encode(s)

/** Tomorrow at 09:17 on this machine's clock, as Lens's expires_at. */
function tomorrowAt917(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  d.setHours(9, 17, 0, 0)
  return d.toISOString()
}

type Approval = Record<string, unknown> & { id: string; status: string }

function acme(over: Partial<Approval> = {}): Approval {
  return {
    id: 'apr_A', agent_id: 'agt_1', amount_ulxc: 3_400 * M, model: '', status: 'pending', created_at: '2026-11-13T09:17:00Z',
    expires_at: tomorrowAt917(), payee: { kind: 'company', id: 'ws_acme', name: 'Acme Hosting' }, memo: 'October hosting invoice',
    paid_from: { kind: 'account', account_id: 'acc_1', name: 'Research’s US dollar account', currency: 'USD', amount_minor: 34_000, balance_minor: 40_000 },
    asks_above_ulxc: 2_500 * M, budget_left_after_ulxc: 4_200 * M,
    ...over,
  }
}

function mockBff({ approvals = [acme()], phoneOnly = false, paused = false }: { approvals?: Approval[]; phoneOnly?: boolean; paused?: boolean } = {}) {
  const decisions: Array<{ id: string; decision: string; body: Record<string, unknown> }> = []
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/lxc/topup-options') return json({ usd_per_lxc: 0.1, allowed_usd_cents: [] })
    if (url === '/api/money/devices')
      return json({ devices: phoneOnly ? [{ id: 'dev_1', name: 'iPhone', created_at: '2026-11-01T09:00:00Z' }] : [] })
    if (url === '/api/agents/passkeys')
      return json({ passkeys: phoneOnly ? [] : [{ credential_id: b64u(bytes('cred1')), name: 'This Mac', created_at: '2026-11-01T09:00:00Z' }] })
    if (url === '/api/agents' && method === 'GET')
      return json({
        workspace_balance_ulxc: 10_000 * M, allocated_ulxc: 4_000 * M, unallocated_ulxc: 6_000 * M, spent_ulxc: 0,
        agents: [
          { id: 'agt_1', name: 'Research', balance_ulxc: 4_000 * M, spent_ulxc: 0, keys: [], created_at: '2026-10-01T09:00:00Z', owner_user_id: 'ws_1', ...(paused ? { paused_at: '2026-11-13T08:00:00Z' } : {}) },
          { id: 'agt_2', name: 'Sales', balance_ulxc: 1_000 * M, spent_ulxc: 0, keys: [], created_at: '2026-10-01T09:00:00Z', owner_user_id: 'ws_1' },
        ],
      })
    if (url === '/api/agents/approvals') return json({ approvals })
    if (url === '/api/money/payment-requests?status=pending_approval') return json({ requests: [] })
    const challenge = /^\/api\/agents\/approvals\/([^/]+)\/challenge$/.exec(url)
    if (challenge) return json({ challenge: b64u(bytes(`challenge-${challenge[1]}`)), allow_credentials: [b64u(bytes('cred1'))] })
    const decision = /^\/api\/agents\/approvals\/([^/]+)\/(approve|deny)$/.exec(url)
    if (decision) {
      decisions.push({ id: decision[1], decision: decision[2], body })
      const a = approvals.find((x) => x.id === decision[1])!
      a.status = decision[2] === 'approve' ? 'approved' : 'denied'
      return json(a)
    }
    if (/^\/api\/agents\/agt_\d\/rules$/.test(url)) return json({ max_per_request_ulxc: 0, daily_limit_ulxc: 0, monthly_limit_ulxc: 20_000 * M, approval_above_ulxc: 2_500 * M })
    if (/statement/.test(url)) return json({ lines: [] })
    return new Response('null', { status: 404 })
  })
  const get = vi.fn(async (opts: CredentialRequestOptions) => {
    const c = new TextDecoder().decode(opts.publicKey!.challenge as Uint8Array)
    return {
      rawId: bytes('cred1').buffer,
      response: { clientDataJSON: bytes(`cd-${c}`).buffer, authenticatorData: bytes('authdata').buffer, signature: bytes(`sig-over-${c}`).buffer },
    }
  })
  Object.defineProperty(navigator, 'credentials', { value: { get, create: vi.fn() }, configurable: true })
  return { decisions, get }
}

afterEach(() => {
  cleanup()
  queryClient.clear()
  vi.restoreAllMocks()
  window.history.pushState({}, '', '/')
})

async function openSheet(path: string) {
  window.history.pushState({}, '', path)
  render(<App />)
  return screen.findByRole('dialog', { name: /wants to (pay|use)/ })
}

describe('the approval sheet', () => {
  it('opens over Home from ?approval=<id> with every fact, and approves signed with the passkey', async () => {
    const { decisions, get } = mockBff()
    const sheet = await openSheet('/?approval=apr_A')
    // Home is still the page under it, and its waiting row opens this same sheet over it.
    expect(within(await screen.findByTestId('home-approvals')).getByRole('link', { name: /Research/ })).toHaveAttribute('href', '/?approval=apr_A')
    expect(sheet).toHaveTextContent('Research wants to pay')
    expect(sheet).toHaveTextContent('October hosting invoice')
    expect(sheet).toHaveTextContent('to Acme Hosting')
    const facts = sheet.querySelector('dl')!
    expect(facts).toHaveTextContent('Why it’s askingIt asks you above $250.00 2,500 LXC')
    expect(facts).toHaveTextContent('Paid fromResearch’s US dollar account (holds $400.00)')
    expect(await within(sheet).findByTestId('approval-budget-left')).toHaveTextContent('$420.00 of $2,000.00 4,200 of 20,000 LXC')
    expect(facts).toHaveTextContent('ExpiresTomorrow at 09:17')
    expect(sheet).toHaveTextContent('This approves this payment only. Approving or declining asks for your passkey.')
    expect(within(sheet).getByRole('link', { name: 'Open Research' })).toHaveAttribute('href', '/agents/agt_1')

    fireEvent.click(within(sheet).getByRole('button', { name: 'Approve with your passkey' }))
    expect(await screen.findByText('Approved: Acme Hosting, $340.00')).toBeInTheDocument()
    expect(screen.getByText('It goes through the next time Research sends it, once, within 24 hours.')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(window.location.search).toBe('')
    expect(get).toHaveBeenCalledTimes(1)
    expect(decisions).toEqual([
      { id: 'apr_A', decision: 'approve', body: { assertion: expect.objectContaining({ signature: b64u(bytes('sig-over-challenge-apr_A')) }) } },
    ])
  })

  it.each([
    ['a listing’s use on the monthly bill', { payee: { kind: 'listing', id: 'lst_1', name: 'Lead finder' }, memo: 'One use of Lead finder (version 3)', paid_from: { kind: 'marketplace_bill', account_id: 'ws_1', name: 'Your monthly marketplace bill', currency: 'USD', amount_minor: 34_000, balance_minor: null } }, 'Research wants to use', 'Paid fromYour monthly marketplace bill'],
    ['the agent’s LXC', { paid_from: { kind: 'lxc', account_id: 'agt_1', name: 'Research’s LXC balance', currency: 'LXC', amount_minor: 3_400 * M, balance_minor: 4_000 * M } }, 'Research wants to pay', 'Paid fromResearch’s LXC balance (holds $400.00 4,000 LXC)'],
    ['the agent’s card', { paid_from: { kind: 'card', account_id: 'crd_1', name: 'Research’s card', currency: 'USD', amount_minor: 34_000, balance_minor: null } }, 'Research wants to pay', 'Paid fromResearch’s card'],
  ])('says what pays: %s', async (_, over, title, paid) => {
    mockBff({ approvals: [acme(over as Partial<Approval>)] })
    const sheet = await openSheet('/?approval=apr_A')
    expect(sheet).toHaveTextContent(title)
    expect(sheet.querySelector('dl')).toHaveTextContent(paid)
  })

  it('declines with a reason, signed, from its reason form', async () => {
    const { decisions } = mockBff()
    const sheet = await openSheet('/agents/agt_1?approval=apr_A')
    fireEvent.click(within(sheet).getByRole('button', { name: 'Decline' }))
    const form = await screen.findByRole('dialog', { name: 'Decline Research’s payment?' })
    expect(form).toHaveTextContent('$340.00 3,400 LXC to Acme Hosting. The same request is then refused without asking you for 24 hours.')
    fireEvent.change(within(form).getByLabelText('Why (optional, the agent sees it)'), { target: { value: 'not this month' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Decline' }))
    expect(await screen.findByText('Declined. Research’s payment is refused')).toBeInTheDocument()
    expect(screen.getByText('And the same request is refused without asking you for 24 hours.')).toBeInTheDocument()
    expect(decisions).toEqual([
      { id: 'apr_A', decision: 'deny', body: { assertion: expect.objectContaining({ signature: b64u(bytes('sig-over-challenge-apr_A')) }), reason: 'not this month' } },
    ])
  })

  it('says a paused agent’s approval waits until it runs again', async () => {
    mockBff({ paused: true })
    const sheet = await openSheet('/?approval=apr_A')
    expect(await within(sheet).findByText('Research is paused: nothing goes through until it runs again. An approval lasts 24 hours.')).toBeInTheDocument()
    fireEvent.click(within(sheet).getByRole('button', { name: 'Approve with your passkey' }))
    expect(await screen.findByText('Research is paused: it goes through once Research runs again and sends it, within 24 hours.')).toBeInTheDocument()
  })

  it('says an expired request and one already decided in words, with nothing to approve', async () => {
    mockBff({ approvals: [acme({ status: 'expired' }), acme({ id: 'apr_B', status: 'denied' })] })
    let sheet = await openSheet('/?approval=apr_A')
    expect(sheet).toHaveTextContent('This request expired. If Research asks again, it waits for you again.')
    expect(within(sheet).queryByRole('button', { name: /Approve|Decline/ })).toBeNull()
    cleanup()
    sheet = await openSheet('/?approval=apr_B')
    expect(sheet).toHaveTextContent('Already decided: declined.')
    expect(within(sheet).queryByRole('button', { name: /Approve|Decline/ })).toBeNull()
  })

  it('sends nothing from a workspace whose only key is the phone’s', async () => {
    const { decisions } = mockBff({ phoneOnly: true })
    const sheet = await openSheet('/?approval=apr_A')
    expect(await within(sheet).findByText('Approve this on your phone: it is waiting in Talyvor there.')).toBeInTheDocument()
    expect(within(sheet).getByRole('link', { name: 'Add this browser' })).toHaveAttribute('href', '/settings/devices')
    expect(within(sheet).queryByRole('button', { name: /Approve|Decline/ })).toBeNull()
    expect(decisions).toEqual([])
  })

  it('opens from /approvals#approval-<id>, the address a notification opens, and the x closes it', async () => {
    mockBff()
    const sheet = await openSheet('/approvals#approval-apr_A')
    expect(sheet).toHaveTextContent('Research wants to pay')
    fireEvent.click(within(sheet).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(window.location.pathname).toBe('/approvals')
    expect(window.location.hash).toBe('')
  })

  it('pressEverything finds no dead control with the sheet open over Approvals', async () => {
    const report = await pressEverything('/approvals?approval=apr_1')
    expect(report.pressed).toBeGreaterThan(0)
    expect(report.dead).toEqual([])
  }, 300_000)
})
