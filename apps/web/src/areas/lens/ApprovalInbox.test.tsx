import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B41.33 — the approvals inbox: filters, several approved together, keyboard shortcuts and a swipe. The BFF
// is stubbed; each decision is the same POST the single Approve button sends, and is counted here.

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

const inbox = async () => {
  window.history.pushState({}, '', '/approvals')
  render(<App />)
  return within(await screen.findByRole('group', { name: 'Waiting for a person' }))
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

describe('the approvals inbox (B41.33)', () => {
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
    expect(screen.getByText(/decline it and the request is refused, and asking again the same way is refused for 24 hours\./)).toBeInTheDocument()
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

  // B55.7 — Lens reads an approval nobody used within its 24 hours as expired: the row says so, and a status
  // this screen does not know yet reads Closed, instead of the whole screen failing to draw.
  it('shows an expired approval as Expired, and a status it does not know as Closed', async () => {
    mockBff([
      { id: 'apr_6', agent_id: 'agt_1', amount_ulxc: M, model: 'gpt-5', status: 'expired', created_at: '2026-10-24T06:00:00Z', expires_at: '2026-10-25T06:00:00Z' },
      { id: 'apr_7', agent_id: 'agt_2', amount_ulxc: M, model: 'claude', status: 'expired', created_at: '2026-10-24T06:01:00Z', decided_at: '2026-10-24T07:00:00Z', expires_at: '2026-10-25T06:01:00Z' },
      { id: 'apr_8', agent_id: 'agt_2', amount_ulxc: M, model: 'claude', status: 'withdrawn', created_at: '2026-10-24T06:02:00Z' },
    ])
    await inbox()
    expect(screen.getAllByText('Expired')).toHaveLength(2)
    expect(screen.getByText(/^Not answered within 24 hours,$/)).toBeInTheDocument()
    expect(screen.getByText(/^Approved, but not used within 24 hours,$/)).toBeInTheDocument()
    expect(screen.getByText('Closed')).toBeInTheDocument()
    expect(screen.queryByText('This screen couldn’t be read.')).toBeNull()
  })

  // B55.41 — each decided row says when it was decided, and by which agent when another agent approved it.
  it('says when each decided approval was decided, and by which agent', async () => {
    mockBff([
      { id: 'apr_6', agent_id: 'agt_1', amount_ulxc: M, model: 'gpt-5', status: 'denied', created_at: '2026-10-14T08:00:00Z', decided_at: '2026-10-14T09:12:00Z' },
      { id: 'apr_7', agent_id: 'agt_1', amount_ulxc: M, model: '', status: 'approved', created_at: '2026-10-13T08:00:00Z', decided_at: '2026-10-13T09:00:00Z',
        approved_by_agent_id: 'agt_2', payee: { kind: 'company', id: 'ws_d', name: 'Dock Labs' } },
    ])
    await inbox()
    expect(document.body.textContent).toMatch(/, 14 Oct(?! by)/)
    expect(document.body.textContent).toMatch(/, 13 Oct by Buyer/)
  })
})

describe('payments prepared for the person (B55.10)', () => {
  it('lists a payment an assistant prepared, with Review opening its card', async () => {
    mockBff([], [PREPARED])
    window.history.pushState({}, '', '/approvals')
    render(<App />)
    const prepared = within(await screen.findByRole('group', { name: 'Prepared payments' }))
    expect(prepared.getByText('Your assistant prepared a payment to Acme Hosting')).toBeInTheDocument()
    expect(prepared.getByText(/INV-7 · from the company’s account · asked/)).toBeInTheDocument()
    expect(prepared.getByText('£120.00')).toBeInTheDocument()
    expect(prepared.getByRole('link', { name: 'Review' })).toHaveAttribute('href', '/approve/preq_1')
  })

  // B57.116 — drawn as w-approvals draws a waiting request: Chat's mark, the line over its hint, the total over its
  // currency, and Pocket's Review.
  it('draws the row in Pocket’s components: the line, its hint, the total and Review to /approve/{id}', async () => {
    const MANY = { ...PREPARED, id: 'preq_2', client: 'chat', summary: '2 payments', totals: { GBP: 15000 }, items: [PREPARED.items[0], { ...PREPARED.items[0], position: 2, payee_name: 'Bolt Cloud', amount_minor: 3000 }] }
    mockBff([], [PREPARED, MANY])
    window.history.pushState({}, '', '/approvals')
    render(<App />)
    await screen.findByRole('group', { name: 'Prepared payments' })
    const one = document.querySelector<HTMLElement>('[data-prepared="preq_1"]')!
    expect(one.querySelector('[data-icon="chat"]')).not.toBeNull()
    expect(within(one).getByText('Your assistant prepared a payment to Acme Hosting')).toHaveClass('font-semibold')
    expect(one).toHaveTextContent('INV-7 · from the company’s account · asked')
    expect(within(one).getByText('£120.00')).toBeInTheDocument()
    expect(within(one).getByText('GBP')).toBeInTheDocument()
    const review = within(one).getByRole('link', { name: 'Review' })
    expect(review).toHaveAttribute('href', '/approve/preq_1')
    expect(review).toHaveClass('rounded-pill')
    const many = document.querySelector<HTMLElement>('[data-prepared="preq_2"]')!
    expect(within(many).getByText('Chat prepared 2 payments')).toBeInTheDocument()
    expect(many).toHaveTextContent('2 payments · from the company’s account · asked')
    expect(within(many).getByText('£150.00')).toBeInTheDocument()
    expect(within(many).getByRole('link', { name: 'Review' })).toHaveAttribute('href', '/approve/preq_2')
  })

  it('counts one agent request and one prepared payment as 2 on the badge', async () => {
    mockBff([], [PREPARED], 1)
    window.history.pushState({}, '', '/approvals')
    render(<App />)
    expect(await screen.findByRole('link', { name: 'Approvals 2 waiting' })).toBeInTheDocument()
  })

  it('with nothing waiting, says a prepared payment appears here too', async () => {
    mockBff([], [], 0)
    window.history.pushState({}, '', '/approvals')
    render(<App />)
    expect(
      await screen.findByText('Nothing is waiting. A request or payment appears here when it is above an agent’s approval amount, or when Chat or an assistant prepares a payment.'),
    ).toBeInTheDocument()
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
    const group = await screen.findByRole('group', { name: 'Mandate requests' })
    const requests = within(group)
    expect(group.textContent).toContain('Researcher asks to let Acme Hosting pull up to £20.00 a month')
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
    const requests = within(await screen.findByRole('group', { name: 'Mandate requests' }))
    fireEvent.click(requests.getByRole('button', { name: 'Review' }))
    fireEvent.click(await requests.findByRole('button', { name: 'Decline' }))
    await waitFor(() => expect(bff.mandateCalls).toEqual([{ url: '/api/money/mandates/mdt_1/decline', body: {} }]))
    expect(get).not.toHaveBeenCalled()
  })
})

describe('the approvals inbox when only the phone holds a key (B55.2)', () => {
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
    // Lens refuses a passkey made here unsigned, and on Approvals the link would lead back to this page.
    expect(screen.queryByRole('button', { name: /Add this device|Approve with Face ID from now on/ })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Add this browser' })).toBeNull()
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
