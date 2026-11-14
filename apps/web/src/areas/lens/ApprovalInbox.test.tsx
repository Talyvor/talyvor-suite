import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B57.17 — /approvals in Pocket: what waits (agents' requests and prepared payments, counted as the badge counts them),
// the newest five decided with their date, how you approve, and each agent's rules. B41.33 — the inbox on Agent Wallets:
// filters, several approved together, keyboard shortcuts and a swipe. The BFF is stubbed; each decision is the same POST
// the single Approve button sends, and is counted here.

const M = 1_000_000

// B55.10 — a payment an assistant (client mcp:) prepared, waiting for the person.
const PREPARED = {
  id: 'preq_1', status: 'pending_approval', summary: '1 payment', client: 'mcp:tlv_oc_claude', agent_id: '', totals: { GBP: 12000 }, created_at: '2026-10-25T06:06:00Z',
  items: [{ position: 1, payee_id: 'payee_1', payee_name: 'Acme Hosting', currency: 'GBP', amount_minor: 12000, reference: 'INV-7', decision: 'needs_approval', reason: 'above the £100.00 the mandate pays without asking' }],
}

// B55.40 — an agent's own key asked for a mandate: it waits for the owner and pulls nothing until approved.
const REQUESTED = {
  id: 'mdt_1', agent_id: 'agt_1', account_id: 'macc_agt', currency: 'GBP', payee_workspace_id: 'ws_a', payee_name: 'Acme Hosting', max_per_pull_minor: 500,
  max_per_month_minor: 2000, pulled_this_month_minor: 0, expires_at: '2027-11-10T23:59:59Z', status: 'requested', created_at: '2026-11-10T06:00:00Z',
}

function mockBff(decided: Array<Record<string, unknown> & { id: string; status: string }> = [], prepared: object[] = [], only?: number, mandates: object[] = []) {
  const approvals: Array<Record<string, unknown> & { id: string; status: string }> = [
    { id: 'apr_1', agent_id: 'agt_1', amount_ulxc: 3 * M, model: '', status: 'pending', created_at: '2026-10-25T06:01:00Z', payee: { kind: 'company', id: 'ws_a', name: 'Acme Hosting' } },
    { id: 'apr_2', agent_id: 'agt_1', amount_ulxc: 2 * M, model: 'gpt-5', status: 'pending', created_at: '2026-10-25T06:02:00Z' },
    { id: 'apr_3', agent_id: 'agt_2', amount_ulxc: 4 * M, model: '', status: 'pending', created_at: '2026-10-25T06:03:00Z', payee: { kind: 'company', id: 'ws_b', name: 'Bolt Cloud' } },
    { id: 'apr_4', agent_id: 'agt_2', amount_ulxc: 1 * M, model: '', status: 'pending', created_at: '2026-10-25T06:04:00Z', payee: { kind: 'company', id: 'ws_c', name: 'Copy Desk' } },
    { id: 'apr_5', agent_id: 'agt_2', amount_ulxc: 5 * M, model: 'claude', status: 'pending', created_at: '2026-10-25T06:05:00Z' },
    ...decided,
  ].slice(0, only)
  const decisions: Array<{ id: string; decision: string }> = []
  const bodies: Record<string, unknown>[] = []
  const challenges: string[] = []
  const mandateCalls: Array<{ url: string; body: unknown }> = []
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/agents' && method === 'GET')
      return json({
        workspace_balance_ulxc: 100 * M, allocated_ulxc: 20 * M, unallocated_ulxc: 80 * M, spent_ulxc: 0,
        agents: [
          { id: 'agt_1', name: 'Researcher', balance_ulxc: 10 * M, spent_ulxc: 0, keys: [], created_at: '2026-10-25T06:00:00Z' },
          { id: 'agt_2', name: 'Buyer', balance_ulxc: 10 * M, spent_ulxc: 0, keys: [], created_at: '2026-10-25T06:00:00Z' },
        ],
      })
    if (url === '/api/agents/approvals') return json({ approvals })
    if (url === '/api/money/payment-requests?status=pending_approval') return json({ requests: prepared })
    if (url === '/api/agents/passkeys') return json({ passkeys: [] })
    if (url === '/api/money/devices') return json({ devices: [] })
    if (url === '/api/money/mandates?status=requested') return json({ granted: mandates, received: [] })
    if (url === '/api/money/mandates/challenge') {
      mandateCalls.push({ url, body: JSON.parse(String(init?.body)) })
      return json({ challenge: 'Y2gw', allow_credentials: ['Y3JlZDE'], user_verification: 'required' })
    }
    const mandate = /^\/api\/money\/mandates\/([^/]+)\/(approve|decline)$/.exec(url)
    if (mandate) {
      mandateCalls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined })
      mandates.splice(mandates.findIndex((m) => (m as { id: string }).id === mandate[1]), 1)
      return json({ ...REQUESTED, status: mandate[2] === 'approve' ? 'active' : 'declined' })
    }
    const challenge = /^\/api\/agents\/approvals\/([^/]+)\/challenge$/.exec(url)
    if (challenge) challenges.push(challenge[1])
    const decision = /^\/api\/agents\/approvals\/([^/]+)\/(approve|deny)$/.exec(url)
    if (decision) {
      decisions.push({ id: decision[1], decision: decision[2] })
      bodies.push(init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {})
      const a = approvals.find((x) => x.id === decision[1])!
      if (a.status !== 'pending') return json({ error: 'already decided' }, 409)
      a.status = decision[2] === 'approve' ? 'approved' : 'denied'
      return json(a)
    }
    return new Response('null', { status: 404 })
  })
  return { decisions, bodies, challenges, mandateCalls }
}

// The inbox with its filters lives on Agent Wallets; /approvals decides in the sheet (B57.17).
const inbox = async () => {
  window.history.pushState({}, '', '/agents/agt_1')
  render(<App />)
  const list = within(await screen.findByRole('group', { name: 'Waiting for a person' }))
  // Agent Wallets reads more than Approvals did, so the keys can still be reading when the list is in.
  await waitFor(() => ['agent-passkeys', 'money-devices'].forEach((k) => expect(queryClient.getQueryState([k])?.status).toMatch(/success|error/)))
  return list
}

// B55.2 — no passkey and these phone keys, answered over mockBff's stub (null: the read is refused); every POST from here is counted.
function onlyThePhoneKey(devices: object[] | null = [{ id: 'dk_1', platform: 'ios', name: 'Work iPhone' }]) {
  const inner = vi.mocked(fetch).getMockImplementation()!
  const posts: string[] = []
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const url = String(input)
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/api/agents/passkeys') return json({ passkeys: [] })
    if (url === '/api/money/devices') return devices ? json({ devices }) : json({ error: "only the workspace's owner or an admin may register, list or revoke its device keys" }, 403)
    if ((init?.method ?? 'GET') !== 'GET') posts.push(url)
    return inner(input, init)
  })
  return posts
}

afterEach(() => {
  cleanup()
  queryClient.clear()
  vi.restoreAllMocks()
  window.history.pushState({}, '', '/')
})

describe('the approvals inbox on Agent Wallets (B41.33)', () => {
  it('narrows the waiting list by agent and by kind', async () => {
    mockBff()
    const list = await inbox()
    expect(list.getAllByRole('checkbox')).toHaveLength(5)
    fireEvent.change(screen.getByLabelText('Show approvals for'), { target: { value: 'agt_2' } })
    expect(list.getAllByRole('checkbox')).toHaveLength(3)
    fireEvent.change(screen.getByLabelText('Show which kind'), { target: { value: 'payment' } })
    expect(list.getAllByRole('checkbox')).toHaveLength(2)
    expect(list.getByText(/Bolt Cloud/)).toBeInTheDocument()
    expect(list.queryByText(/Acme Hosting/)).not.toBeInTheDocument()
  })

  it('approves five selected together, each decided exactly once', async () => {
    const bff = mockBff()
    await inbox()
    fireEvent.click(screen.getByLabelText('Select all 5'))
    fireEvent.click(screen.getByRole('button', { name: 'Approve 5' }))
    expect(await screen.findByText(/^Approved 5\./)).toBeInTheDocument()
    expect(bff.decisions.map((d) => d.id).sort()).toEqual(['apr_1', 'apr_2', 'apr_3', 'apr_4', 'apr_5'])
    expect(bff.decisions.every((d) => d.decision === 'approve')).toBe(true)
    await waitFor(() => expect(screen.getByText('Nothing is waiting. A request or payment appears here when it is above an agent’s approval amount, or when Chat or an assistant prepares a payment.')).toBeInTheDocument())
  })

  it('moves with j and k and approves with a, declines with d', async () => {
    const bff = mockBff()
    const list = await inbox()
    const rows = list.getAllByRole('checkbox').map((c) => c.closest<HTMLElement>('[data-approval]')!)
    rows[0].focus()
    fireEvent.keyDown(rows[0], { key: 'j' })
    expect(document.activeElement).toBe(rows[1])
    fireEvent.keyDown(rows[1], { key: 'a' })
    await waitFor(() => expect(bff.decisions).toEqual([{ id: 'apr_2', decision: 'approve' }]))
    const first = (await list.findAllByRole('checkbox'))[0].closest<HTMLElement>('[data-approval]')!
    // Agent Wallets reads its book again after a decision; the keys wait until it is in.
    await waitFor(() => expect(within(first).getByRole('button', { name: 'Decline' })).toBeEnabled())
    fireEvent.keyDown(first, { key: 'd' })
    // d opens the decline form on that row, its reason field focused; Decline sends it.
    expect(document.activeElement).toBe(screen.getByLabelText('Why (optional, the agent sees it)'))
    expect(bff.decisions).toHaveLength(1)
    fireEvent.click(within(first).getByRole('button', { name: 'Decline' }))
    await waitFor(() => expect(bff.decisions).toEqual([{ id: 'apr_2', decision: 'approve' }, { id: 'apr_1', decision: 'deny' }]))
  })

  // B55.19 — Decline asks why (optional, the agent sees it); the reason goes with the decline, and the note says it holds for 24 hours.
  it('declines with a reason, cancels without sending, and says what declining does', async () => {
    const bff = mockBff()
    const list = await inbox()
    const row = list.getByText(/Acme Hosting/).closest<HTMLElement>('[data-approval]')!
    fireEvent.click(within(row).getByRole('button', { name: 'Decline' }))
    fireEvent.click(within(row).getByRole('button', { name: 'Cancel' }))
    expect(bff.decisions).toEqual([])
    fireEvent.click(within(row).getByRole('button', { name: 'Decline' }))
    fireEvent.change(within(row).getByLabelText('Why (optional, the agent sees it)'), { target: { value: 'not this month' } })
    fireEvent.click(within(row).getByRole('button', { name: 'Decline' }))
    expect(await screen.findByText('Declined. Researcher’s payment is refused, and the same request is refused without asking you for 24 hours.')).toBeInTheDocument()
    expect(bff.decisions).toEqual([{ id: 'apr_1', decision: 'deny' }])
    expect(bff.bodies).toEqual([{ reason: 'not this month' }])
    expect(await screen.findByText('Declined')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/Deny|Denied|denies/)
  })

  it('approves a request swiped right, and nothing on a short or leftward swipe', async () => {
    const bff = mockBff()
    const list = await inbox()
    const row = list.getByText(/Bolt Cloud/).closest<HTMLElement>('[data-approval]')!
    fireEvent.touchStart(row, { touches: [{ clientX: 100, clientY: 10 }] })
    fireEvent.touchEnd(row, { changedTouches: [{ clientX: 20, clientY: 10 }] })
    fireEvent.touchStart(row, { touches: [{ clientX: 100, clientY: 10 }] })
    fireEvent.touchEnd(row, { changedTouches: [{ clientX: 150, clientY: 10 }] })
    expect(bff.decisions).toEqual([])
    fireEvent.touchStart(row, { touches: [{ clientX: 20, clientY: 10 }] })
    fireEvent.touchMove(row, { touches: [{ clientX: 90, clientY: 12 }] })
    fireEvent.touchEnd(row, { changedTouches: [{ clientX: 140, clientY: 14 }] })
    await waitFor(() => expect(bff.decisions).toEqual([{ id: 'apr_3', decision: 'approve' }]))
  })
})

describe('an agent’s mandate request waiting on Approvals (B55.40)', () => {
  it('lists it in words, and Review then Approve is signed over its own challenge', async () => {
    const bff = mockBff([], [], 0, [REQUESTED])
    const inner = vi.mocked(fetch).getMockImplementation()!
    vi.mocked(fetch).mockImplementation(async (input, init) =>
      String(input) === '/api/agents/passkeys'
        ? new Response(JSON.stringify({ passkeys: [{ id: 'pk_1', credential_id: 'Y3JlZDE', name: 'This Mac', created_at: '2026-11-01T09:00:00Z' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
        : inner(input, init),
    )
    const get = vi.fn().mockResolvedValue({ rawId: new Uint8Array([1]).buffer,
      response: { clientDataJSON: new Uint8Array([2]).buffer, authenticatorData: new Uint8Array([3]).buffer, signature: new Uint8Array([4]).buffer } })
    Object.defineProperty(navigator, 'credentials', { value: { get, create: vi.fn() }, configurable: true })
    window.history.pushState({}, '', '/approvals')
    render(<App />)
    // B57.17 — it waits with the rest under Waiting for you, in Pocket's row.
    const group = (await screen.findByText(/asks to let Acme Hosting/)).closest<HTMLElement>('[data-mandate="mdt_1"]')!
    expect(group.closest('[data-design]')).toHaveAttribute('data-design', 'pocket')
    const requests = within(group)
    expect(group.textContent).toContain('Researcher asks to let Acme Hosting pull up to £20.00 a month')
    // The payee's name is the agent's own words: the account the money goes to is shown as Lens holds it.
    expect(group.textContent).toContain('into Talyvor workspace ws_a')
    expect(await screen.findByRole('link', { name: 'Approvals 1 waiting' })).toBeInTheDocument()
    fireEvent.click(requests.getByRole('button', { name: 'Review' }))
    fireEvent.click(await requests.findByRole('button', { name: 'Approve' }))
    await waitFor(() =>
      expect(bff.mandateCalls).toEqual([
        { url: '/api/money/mandates/challenge', body: { mandate_id: 'mdt_1' } },
        { url: '/api/money/mandates/mdt_1/approve', body: { assertion: { credential_id: 'AQ', client_data_json: 'Ag', authenticator_data: 'Aw', signature: 'BA' } } },
      ]),
    )
    expect(get).toHaveBeenCalledTimes(1)
    expect(bff.decisions).toEqual([])
  })

  it('Decline sends the decline, and nothing is signed', async () => {
    const bff = mockBff([], [], 0, [REQUESTED])
    const get = vi.fn()
    Object.defineProperty(navigator, 'credentials', { value: { get, create: vi.fn() }, configurable: true })
    window.history.pushState({}, '', '/approvals')
    render(<App />)
    const requests = within((await screen.findByText(/asks to let Acme Hosting/)).closest<HTMLElement>('[data-mandate="mdt_1"]')!)
    fireEvent.click(requests.getByRole('button', { name: 'Review' }))
    fireEvent.click(await requests.findByRole('button', { name: 'Decline' }))
    await waitFor(() => expect(bff.mandateCalls).toEqual([{ url: '/api/money/mandates/mdt_1/decline', body: {} }]))
    expect(get).not.toHaveBeenCalled()
  })
})

describe('the approvals inbox on Agent Wallets when only the phone holds a key (B55.2)', () => {
  it('sends no decision, by button, key or swipe, and says to approve on the phone', async () => {
    const bff = mockBff()
    const posts = onlyThePhoneKey()
    const list = await inbox()
    expect(await list.findAllByText('Approve this on your phone: it is waiting in Talyvor there.')).toHaveLength(5)
    expect(list.queryByRole('button', { name: /Approve|Decline/ })).toBeNull()
    expect(list.queryByRole('checkbox')).toBeNull()
    const row = document.querySelector<HTMLElement>('[data-approval="apr_1"]')!
    fireEvent.keyDown(row, { key: 'a' })
    fireEvent.keyDown(row, { key: 'd' })
    fireEvent.touchStart(row, { touches: [{ clientX: 0, clientY: 0 }] })
    fireEvent.touchEnd(row, { changedTouches: [{ clientX: 200, clientY: 0 }] })
    expect(bff.decisions).toEqual([])
    expect(posts).toEqual([])
    // Lens refuses a passkey made here unsigned.
    expect(screen.queryByRole('button', { name: /Add this device|Approve with Face ID from now on/ })).toBeNull()
  })

  // B55.54: and with no key live there is no phone to approve on either, so each row says every key was removed.
  it('a revoked phone key still counts, as Lens counts it: nothing is sent and each row says every key was removed', async () => {
    const bff = mockBff()
    const posts = onlyThePhoneKey([{ id: 'dk_1', platform: 'ios', name: 'Old iPhone', revoked_at: '2026-10-30T09:00:00Z' }])
    const list = await inbox()
    expect(await list.findAllByText('Every key of this workspace was removed, so nothing can approve.')).toHaveLength(5)
    expect(list.queryByRole('button', { name: /Approve|Decline/ })).toBeNull()
    fireEvent.keyDown(document.querySelector<HTMLElement>('[data-approval="apr_1"]')!, { key: 'a' })
    expect(bff.decisions).toEqual([])
    expect(posts).toEqual([])
  })

  it('shows no decision and sends nothing while the phone keys cannot be read', async () => {
    const bff = mockBff()
    const posts = onlyThePhoneKey(null)
    const list = await inbox()
    await waitFor(() => expect(queryClient.getQueryState(['money-devices'])?.status).toBe('error'))
    expect(list.queryByRole('button', { name: /Approve|Decline/ })).toBeNull()
    expect(list.queryByRole('checkbox')).toBeNull()
    expect(screen.queryByRole('button', { name: /Add this device|Approve with Face ID from now on/ })).toBeNull()
    fireEvent.keyDown(document.querySelector<HTMLElement>('[data-approval="apr_1"]')!, { key: 'a' })
    expect(bff.decisions).toEqual([])
    expect(posts).toEqual([])
  })

  it('a workspace with no key at all still approves unsigned', async () => {
    const bff = mockBff()
    await inbox()
    fireEvent.click(await within(document.querySelector<HTMLElement>('[data-approval="apr_1"]')!).findByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(bff.decisions).toEqual([{ id: 'apr_1', decision: 'approve' }]))
    expect(bff.challenges).toEqual([])
  })
})

const page = async () => {
  window.history.pushState({}, '', '/approvals')
  render(<App />)
  return within(await screen.findByRole('group', { name: 'Waiting for you' }))
}

/** Today at hh:mm on this device's clock, as an ISO time. */
const todayAt = (h: number, m: number) => {
  const d = new Date()
  d.setHours(h, m, 0, 0)
  return d.toISOString()
}

describe('Approvals in Pocket (B57.17)', () => {
  it('lists each agent’s request and each prepared payment, counted as the sidebar’s badge counts them', async () => {
    mockBff([], [PREPARED], 1)
    const waiting = await page()
    const row = document.querySelector<HTMLElement>('[data-approval="apr_1"]')!
    expect(row).toHaveTextContent('Researcher wants to pay Acme Hosting')
    expect(within(row).getByRole('link', { name: 'Researcher' })).toHaveAttribute('href', '/agents/agt_1')
    expect(within(row).getByRole('link', { name: 'Review' })).toHaveAttribute('href', '/approvals?approval=apr_1')
    const prepared = document.querySelector<HTMLElement>('[data-prepared="preq_1"]')!
    expect(waiting.getByText('Your assistant prepared a payment to Acme Hosting')).toBeInTheDocument()
    expect(prepared).toHaveTextContent('INV-7 · from the company’s account · asked')
    expect(within(prepared).getByRole('link', { name: 'Review' })).toHaveAttribute('href', '/approve/preq_1')
    expect(screen.getByTestId('approvals-waiting')).toHaveTextContent('2 waiting')
    expect(await screen.findByRole('link', { name: 'Approvals 2 waiting' })).toBeInTheDocument()
  })

  it('names a listing it would use as a link, and where it is paid from and when it expires', async () => {
    mockBff([], [], 0)
    const inner = vi.mocked(fetch).getMockImplementation()!
    vi.mocked(fetch).mockImplementation(async (input, init) =>
      String(input) === '/api/agents/approvals'
        ? new Response(
            JSON.stringify({
              approvals: [
                { id: 'apr_9', agent_id: 'agt_2', amount_ulxc: 9 * M, model: '', status: 'pending', created_at: todayAt(8, 41), expires_at: '2099-01-02T08:41:00Z',
                  memo: 'One use of Lead finder (version 3)', payee: { kind: 'listing', id: 'lst_1', name: 'Lead finder' },
                  paid_from: { kind: 'marketplace_bill', account_id: '', name: 'Your monthly marketplace bill', currency: 'USD', amount_minor: 900, balance_minor: null } },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          )
        : inner(input, init),
    )
    await page()
    const row = document.querySelector<HTMLElement>('[data-approval="apr_9"]')!
    expect(row).toHaveTextContent('Buyer wants to use Lead finder')
    expect(within(row).getByRole('link', { name: 'Lead finder' })).toHaveAttribute('href', '/marketplace/listings/lst_1')
    expect(row).toHaveTextContent('One use of Lead finder (version 3) · on your monthly marketplace bill · expires 2 Jan at')
  })

  it('draws Expired and Closed, dates every decided row, names the agent that approved, and shows the newest five', async () => {
    mockBff(
      [
        { id: 'apr_6', agent_id: 'agt_1', amount_ulxc: M, model: 'gpt-5', status: 'expired', created_at: '2025-10-01T06:00:00Z', expires_at: '2025-10-02T06:00:00Z' },
        { id: 'apr_7', agent_id: 'agt_2', amount_ulxc: M, model: 'claude', status: 'withdrawn', created_at: '2025-10-03T06:02:00Z', decided_at: '2025-10-03T07:00:00Z' },
        { id: 'apr_8', agent_id: 'agt_1', amount_ulxc: M, model: '', status: 'denied', created_at: '2025-10-14T08:00:00Z', decided_at: '2025-10-14T09:12:00Z', memo: 'October hosting invoice', payee: { kind: 'company', id: 'ws_a', name: 'Acme Hosting' } },
        { id: 'apr_10', agent_id: 'agt_1', amount_ulxc: M, model: '', status: 'approved', created_at: todayAt(9, 0), decided_at: todayAt(9, 12), approved_by_agent_id: 'agt_2', payee: { kind: 'company', id: 'ws_d', name: 'Dock Labs' } },
        { id: 'apr_11', agent_id: 'agt_2', amount_ulxc: M, model: '', status: 'used', created_at: '2025-10-20T08:00:00Z', decided_at: '2025-10-20T08:30:00Z', payee: { kind: 'company', id: 'ws_b', name: 'Bolt Cloud' } },
        { id: 'apr_12', agent_id: 'agt_2', amount_ulxc: M, model: 'claude', status: 'expired', created_at: '2025-10-21T06:00:00Z', decided_at: '2025-10-21T07:00:00Z', expires_at: '2025-10-22T07:00:00Z' },
        { id: 'apr_13', agent_id: 'agt_2', amount_ulxc: M, model: 'claude', status: 'denied', created_at: '2025-09-01T06:00:00Z', decided_at: '2025-09-01T07:00:00Z' },
      ],
      [],
    )
    await page()
    const rows = Array.from(screen.getByTestId('approvals-decided').querySelectorAll<HTMLElement>('[data-decided]'))
    // Newest first, five of them: apr_13 (1 Sep) and apr_6 (2 Oct) are left out.
    expect(rows.map((r) => r.dataset.decided)).toEqual(['apr_10', 'apr_12', 'apr_11', 'apr_8', 'apr_7'])
    expect(rows[0]).toHaveTextContent('Researcher wants to pay Dock LabsA payment to a company · today at 09:12 by Buyer')
    expect(within(rows[0]).getByText('Approved')).toBeInTheDocument()
    expect(rows[1]).toHaveTextContent('Approved, but not used within 24 hours · 21 Oct')
    expect(within(rows[1]).getByText('Expired')).toBeInTheDocument()
    expect(within(rows[2]).getByText('Approved and used')).toBeInTheDocument()
    expect(rows[3]).toHaveTextContent('October hosting invoice · 14 Oct')
    expect(rows[3]).not.toHaveTextContent('by ')
    expect(within(rows[3]).getByText('Declined')).toBeInTheDocument()
    expect(within(rows[4]).getByText('Closed')).toBeInTheDocument()
    expect(screen.getByText('The newest five. A request lasts 24 hours, and so does an approval its agent has not used yet.')).toBeInTheDocument()
  })

  it('a approves the focused request, d opens its sheet on Decline, and j moves between them', async () => {
    const bff = mockBff([], [], 2)
    await page()
    const [first, second] = Array.from(document.querySelectorAll<HTMLElement>('[data-approval]'))
    first.focus()
    fireEvent.keyDown(first, { key: 'j' })
    expect(document.activeElement).toBe(second)
    fireEvent.keyDown(second, { key: 'a' })
    await waitFor(() => expect(bff.decisions).toEqual([{ id: 'apr_2', decision: 'approve' }]))
    fireEvent.keyDown(document.querySelector<HTMLElement>('[data-approval="apr_1"]')!, { key: 'd' })
    expect(await screen.findByLabelText('Why (optional, the agent sees it)')).toBeInTheDocument()
    expect(window.location.search).toBe('?approval=apr_1&decline=1')
    expect(bff.decisions).toHaveLength(1)
  })

  it('sends nothing from the keys when only the phone holds a key', async () => {
    const bff = mockBff([], [], 1)
    const posts = onlyThePhoneKey()
    await page()
    await waitFor(() => expect(queryClient.getQueryState(['money-devices'])?.status).toBe('success'))
    const row = document.querySelector<HTMLElement>('[data-approval="apr_1"]')!
    fireEvent.keyDown(row, { key: 'a' })
    fireEvent.keyDown(row, { key: 'd' })
    expect(window.location.search).toBe('')
    expect(bff.decisions).toEqual([])
    expect(posts).toEqual([])
    // Lens refuses a passkey made here unsigned, and on Approvals the link would lead back to this page.
    expect(screen.queryByRole('button', { name: /Add this device|Approve with Face ID from now on/ })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Add this browser' })).toBeNull()
  })

  it('says how approving works, links each agent’s rules, and Approvals and devices', async () => {
    mockBff([], [], 0)
    window.history.pushState({}, '', '/approvals')
    render(<App />)
    expect(
      await screen.findByText('Nothing is waiting. A request or payment appears here when it is above an agent’s approval amount, or when Chat or an assistant prepares a payment.'),
    ).toBeInTheDocument()
    expect(screen.getByTestId('approvals-waiting')).toHaveTextContent('Nothing waiting')
    expect(screen.getByText(/decline it and the request is refused, and asking again the same way is refused for 24 hours\./)).toBeInTheDocument()
    const how = screen.getByLabelText('How you approve')
    expect(how).toHaveTextContent('On the webWith your passkey')
    expect(how).toHaveTextContent('If you declineThat request is refused, and asking again the same way is refused for 24 hours')
    expect(await screen.findByRole('link', { name: 'Researcher’s rules' })).toHaveAttribute('href', '/agents/agt_1/rules')
    expect(screen.getByRole('link', { name: 'Buyer’s rules' })).toHaveAttribute('href', '/agents/agt_2/rules')
    expect(screen.getByRole('link', { name: 'Approvals and devices' })).toHaveAttribute('href', '/settings/devices')
    expect(screen.getByRole('heading', { level: 1, name: 'Approvals' }).closest('[data-design]')).toHaveAttribute('data-design', 'pocket')
    expect(document.body.textContent).not.toMatch(/Taly\b/)
  })
})
