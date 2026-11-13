import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B40.9 — the approval link opens one card with each item and the total; unticking an item approves only the others, and
// the passkey signs Lens's statement only when it names exactly the payments still ticked.

const BASE = [
  { position: 1, payee_id: 'payee_1', payee_name: 'Acme Ltd', currency: 'GBP', amount_minor: 12000, reference: 'INV-7', decision: 'needs_approval', reason: 'above the £100.00 the mandate pays without asking', rule: 'requires_approval_above' },
  { position: 2, payee_id: 'payee_2', payee_name: 'Brightline Studio', currency: 'GBP', amount_minor: 4550, reference: 'May', decision: 'needs_approval', reason: 'no permission mandate the person signed covers this payment' },
  { position: 3, payee_id: 'payee_3', payee_name: 'Shady Co', currency: 'GBP', amount_minor: 900, reference: 'X', decision: 'blocked', reason: "the agent's rules block this payee", rule: 'payee' },
]

function mockBff(lie = false, ITEMS: Record<string, unknown>[] = BASE, extra: Record<string, unknown> = {}) {
  const sent: Array<{ url: string; body: Record<string, unknown> }> = []
  let request: Record<string, unknown> = { id: 'preq_1', status: 'pending_approval', summary: '3 payments for Researcher', client: 'mcp:tlv_oc_claude', agent_id: 'agt_1',
    totals: { GBP: 17450 }, items: ITEMS, created_at: '2026-10-23T09:00:00Z', ...extra }
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/agents/passkeys') return json({ passkeys: [] })
    if (url === '/api/money/devices') return json({ devices: [] }) // B55.2: no phone key, so the web decides
    if (url === '/api/agents') return json({ workspace_balance_ulxc: 0, allocated_ulxc: 0, unallocated_ulxc: 0, spent_ulxc: 0, agents: [{ id: 'agt_1', name: 'Researcher', balance_ulxc: 0, spent_ulxc: 0, keys: [], created_at: '2026-10-10T09:00:00Z' }] })
    if (url === '/api/money/payees') return json({ payees: [
      { id: 'payee_1', name: 'Acme Ltd', country: 'GB', check: 'exact_match', checked_by: 't', checked_at: '2026-10-01T09:00:00Z', needs_confirmation: false, created_at: '2026-10-01T09:00:00Z' },
      { id: 'payee_2', name: 'Brightline Studio', country: 'GB', check: 'close_match', checked_by: 't', checked_at: '2026-10-22T09:00:00Z', needs_confirmation: true, created_at: '2026-10-22T09:00:00Z' },
    ] })
    if (url === '/api/money/payments') return json({ payments: [{ id: 'mpay_0', account_id: 'macc_agt', payee_id: 'payee_1', payee_name: 'Acme Ltd', amount_minor: 100, currency: 'GBP', funding: 'test', reference: 'Apr', idempotency_key: 'k', status: 'completed', created_at: '2026-10-02T09:00:00Z', updated_at: '2026-10-02T09:00:00Z' }] })
    if (url === '/api/money/payment-requests/preq_1') return json(request)
    if (url === '/api/money/payment-requests/preq_1/approval') {
      const body = JSON.parse(String(init?.body)) as { positions: number[]; reason?: string }
      sent.push({ url, body })
      const items = (ITEMS as typeof BASE).filter((it) => (lie ? [1, 2] : body.positions).includes(it.position))
        .map(({ position, payee_id, payee_name, currency, amount_minor, reference }) => ({ position, payee_id, payee_name, currency, amount_minor, reference }))
      const statement = JSON.stringify({ version: 'v1', request_id: 'preq_1', workspace_id: 'ws', payload_hash: 'h', items, totals: { GBP: 12000 }, reason: body.reason, expires_at: '2026-10-23T09:15:00Z' })
      return json({ statement, challenge: 'Y2gx', allow_credentials: ['Y3JlZDE'], user_verification: 'required' })
    }
    if (url === '/api/money/payment-requests/preq_1/approve') {
      sent.push({ url, body: JSON.parse(String(init?.body)) as Record<string, unknown> })
      request = { ...request, status: 'approved', items: ITEMS.map((it) => (it.position === 1 ? { ...it, pay_status: 'completed' } : it)) }
      return json(request)
    }
    return json({ error: 'not found' }, 404)
  })
  const get = vi.fn().mockResolvedValue({ rawId: new Uint8Array([1]).buffer,
    response: { clientDataJSON: new Uint8Array([2]).buffer, authenticatorData: new Uint8Array([3]).buffer, signature: new Uint8Array([4]).buffer } })
  Object.defineProperty(navigator, 'credentials', { value: { get, create: vi.fn() }, configurable: true })
  return { sent, get }
}

// B55.2 — no passkey and the phone's key, answered over mockBff's stub; every POST from here is counted.
function onlyThePhoneKey(extra: Record<string, unknown> = {}) {
  const inner = vi.mocked(fetch).getMockImplementation()!
  const posts: string[] = []
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const url = String(input)
    const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'Content-Type': 'application/json' } })
    if (url === '/api/agents/passkeys') return json({ passkeys: [] })
    if (url === '/api/money/devices') return json({ devices: [{ id: 'dk_1', platform: 'ios', name: 'Work iPhone' }] })
    if (url in extra) return json(extra[url])
    if ((init?.method ?? 'GET') !== 'GET') posts.push(url)
    return inner(input, init)
  })
  return posts
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  queryClient.clear()
})

describe('the approval screen', () => {
  it('shows each item and the total, and approves only the items left ticked with one passkey', async () => {
    const bff = mockBff()
    window.history.pushState({}, '', '/approve/preq_1')
    render(<App />)

    const card = await screen.findByTestId('approve-card')
    expect(card.textContent).not.toMatch(/test money/i)
    await within(card).findByText(/From Researcher’s account · asked by an assistant you connected/)
    expect(screen.getByTestId('approve-total').textContent).toBe('2 of 2 payments to approve, total £165.50')
    const acme = await within(card).findByTestId('approve-item-1')
    await within(acme).findByText('Known payee')
    expect(acme.textContent).toContain('Verified')
    expect(acme.textContent).toContain('£120.00')
    expect(acme.textContent).toContain('Reference: INV-7')
    expect(acme.textContent).toContain('Asks for approval: above the £100.00 the mandate pays without asking.')
    expect(screen.getByTestId('approve-item-2').textContent).toContain('New payee')
    expect(screen.getByTestId('approve-item-2').textContent).toContain('Not verified')
    expect(screen.getByTestId('approve-item-3').textContent).toContain('Blocked: the agent\'s rules block this payee.')
    expect(within(screen.getByTestId('approve-item-3')).queryByRole('checkbox')).toBeNull()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Approve £45.50 to Brightline Studio' }))
    expect(screen.getByTestId('approve-total').textContent).toBe('1 of 2 payments to approve, total £120.00')
    fireEvent.click(screen.getByRole('button', { name: 'Approve 1 payment with a passkey' }))
    await screen.findByText('Approved. Each payment you approved is paid once.')

    expect(bff.get).toHaveBeenCalledTimes(1)
    expect(bff.sent.map((x) => x.url)).toEqual(['/api/money/payment-requests/preq_1/approval', '/api/money/payment-requests/preq_1/approve'])
    expect(bff.sent[0].body).toEqual({ positions: [1] })
    const signed = JSON.parse(String(bff.sent[1].body.statement)) as { items: { position: number }[] }
    expect(signed.items.map((it) => it.position)).toEqual([1])
    expect(bff.sent[1].body.assertion).toMatchObject({ credential_id: 'AQ', signature: 'BA' })
  })

  it('signs nothing when the statement names payments other than those ticked', async () => {
    const bff = mockBff(true)
    window.history.pushState({}, '', '/approve/preq_1')
    render(<App />)

    fireEvent.click(await screen.findByRole('checkbox', { name: 'Approve £45.50 to Brightline Studio' }))
    fireEvent.click(screen.getByRole('button', { name: 'Approve 1 payment with a passkey' }))
    await screen.findByText('What you were asked to sign is not what is shown here, so nothing was signed. Reload the page.')
    expect(bff.get).not.toHaveBeenCalled()
    expect(bff.sent.map((x) => x.url)).toEqual(['/api/money/payment-requests/preq_1/approval'])
  })

  // B41.3 — Lens's flags (B41.103) each show on their item; a duplicate is approved only with a reason, signed in the statement.
  it('shows each flag and approves a flagged duplicate only with a reason the passkey signs', async () => {
    const flagged = [
      { ...BASE[0], flags: [{ code: 'duplicate', detail: 'invoice INV-7 was paid to Acme Ltd already, £120.00 on 2026-10-02' }] },
      { ...BASE[1], flags: [{ code: 'bank_details_changed', detail: 'the bank details on invoice May differ from those saved for Brightline Studio: the saved ones are paid' },
        { code: 'first_payment', detail: 'the first payment to Brightline Studio' }] },
    ]
    const bff = mockBff(false, flagged)
    window.history.pushState({}, '', '/approve/preq_1')
    render(<App />)

    const acme = await screen.findByTestId('approve-item-1')
    await within(acme).findByText('Possible duplicate')
    expect(screen.getByTestId('approve-flag-1-duplicate').textContent).toBe('Invoice INV-7 was paid to Acme Ltd already, £120.00 on 2026-10-02.')
    const bright = screen.getByTestId('approve-item-2')
    expect(within(bright).getByText('Bank details changed')).toBeTruthy()
    expect(within(bright).getByText('First payment')).toBeTruthy()

    const button = screen.getByRole('button', { name: 'Approve 2 payments with a passkey' })
    expect((button as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByRole('textbox', { name: /Say why you are paying it/ }), { target: { value: '  The supplier re-sent a corrected invoice.  ' } })
    fireEvent.click(button)
    await screen.findByText('Approved. Each payment you approved is paid once.')

    expect(bff.sent[0].body).toEqual({ positions: [1, 2], reason: 'The supplier re-sent a corrected invoice.' })
    expect(JSON.parse(String(bff.sent[1].body.statement))).toMatchObject({ reason: 'The supplier re-sent a corrected invoice.' })
  })

  // B45.25 — an outside agent's request says who is asking; "Verified agent of" only at the verified level, whatever Lens's label says.
  it.each([
    [{ level: 'verified', domain: 'agents.acme.example', business: 'Acme Inc.', label: 'Verified agent of Acme Inc.' }, 'Verified agent of Acme Inc.', /Talyvor has checked that agents\.acme\.example, which signed this request, belongs to Acme Inc\.$/],
    [{ level: 'signed', domain: 'bot.example', label: 'Verified agent of Acme Inc.' }, 'Signed by bot.example (business not checked)', /Talyvor has not checked the business behind bot\.example\.$/],
    [{ level: 'unverified', label: 'Unverified agent' }, 'Unverified agent', /This request was not signed, so Talyvor cannot tell who sent it/],
  ])('shows the %o trust level in plain words', async (agent_trust, who, detail) => {
    mockBff(false, BASE, { agent_trust })
    window.history.pushState({}, '', '/approve/preq_1')
    render(<App />)

    const trust = await screen.findByTestId('approve-trust')
    expect(within(trust).getByText(who)).toBeTruthy()
    expect(trust.textContent).toMatch(detail)
    if (agent_trust.level !== 'verified') expect(screen.getByTestId('approve-card').textContent).not.toContain('Verified agent of')
  })
})

// B55.22 — Lens pays a covered item when it is prepared (B55.21): the card says it was paid, and a Decline says what still was.
describe('the approval screen for a covered payment (B55.22)', () => {
  const PAID = { ...BASE[0], decision: 'auto', reason: '', rule: '', payment_id: 'mpay_1', pay_status: 'completed' }
  it('says a covered payment was paid without asking, with its payment status', async () => {
    mockBff(false, [PAID], { status: 'auto' })
    window.history.pushState({}, '', '/approve/preq_1')
    render(<App />)
    expect(await screen.findByText('Paid without asking you: each payment is inside a permission you signed.')).toBeInTheDocument()
    const item = screen.getByTestId('approve-item-1')
    expect(item.textContent).toContain('Inside a permission you signed: paid without asking you.')
    expect(item.textContent).toContain('Paid')
  })

  it.each([
    [[], 'Declined. Nothing that waited for you will be paid.'],
    [[PAID], 'Declined. Nothing that waited for you will be paid. 1 inside a permission you signed was paid.'],
    [[PAID, { ...PAID, position: 4, payment_id: 'mpay_2' }], 'Declined. Nothing that waited for you will be paid. 2 inside a permission you signed were paid.'],
  ])('says what was paid when a request is declined (%#)', async (paid, line) => {
    mockBff(false, [...paid, { ...BASE[1], pay_status: 'not_approved' }], { status: 'cancelled' })
    window.history.pushState({}, '', '/approve/preq_1')
    render(<App />)
    expect(await screen.findByText(line)).toBeInTheDocument()
  })
})

// B55.33 — every status, rule and flag on the card reads in words: no raw status, rule code or flag code.
describe('the approval card in words (B55.33)', () => {
  it.each([
    ['pending', 'On its way'],
    ['sent', 'Sent'],
    ['completed', 'Paid'],
    ['failed', 'Not paid: it failed'],
    ['returned', 'Came back'],
    ['not_approved', 'Not paid: you left it out'],
    ['not_paid', 'Not paid: a marketplace purchase is not paid from here yet'],
    ['queued_somewhere', 'Not paid yet'],
  ])('says a payment that is %s as "%s"', async (pay_status, words) => {
    mockBff(false, [{ ...BASE[0], pay_status }], { status: 'approved' })
    window.history.pushState({}, '', '/approve/preq_1')
    render(<App />)
    const item = await screen.findByTestId('approve-item-1')
    expect(within(item).getByText(words)).toBeInTheDocument()
    expect(item.textContent).not.toContain('Payment:')
  })

  it('says a refused payment with the reason Lens gives', async () => {
    mockBff(false, [{ ...BASE[0], pay_status: 'refused', pay_detail: 'the payee’s bank turned it down' }], { status: 'approved' })
    window.history.pushState({}, '', '/approve/preq_1')
    render(<App />)
    expect(await screen.findByText('Not paid: the payee’s bank turned it down')).toBeInTheDocument()
  })

  it('shows no rule code, no raw status, and no pill for a flag it has no words for', async () => {
    mockBff(false, [{ ...BASE[0], flags: [{ code: 'velocity_spike', detail: 'three payments to Acme Ltd in an hour' }] }, { ...BASE[2], pay_status: 'not_paid' }],
      { summary: 'Pay 2 payments, £129.00: 1 waits for you, 1 blocked' })
    window.history.pushState({}, '', '/approve/preq_1')
    render(<App />)
    const card = await screen.findByTestId('approve-card')
    const text = card.textContent ?? ''
    expect(text).not.toMatch(/\([a-z_.]+\)/)
    expect(text).not.toContain('requires_approval_above')
    expect(text).not.toContain('not_')
    expect(text).not.toContain('item(s)')
    expect(text).not.toContain('velocity_spike')
    expect(within(card).getByText('Three payments to Acme Ltd in an hour.')).toBeInTheDocument()
  })

  it('says a request in a state it does not know is closed', async () => {
    mockBff(false, BASE, { status: 'superseded' })
    window.history.pushState({}, '', '/approve/preq_1')
    render(<App />)
    expect(await screen.findByText('This request is closed.')).toBeInTheDocument()
    expect(screen.getByTestId('approve-card').textContent).not.toContain('superseded')
  })
})

// B55.10 — Lens reads a request nobody answered within 24 hours as expired (B55.9): the card says so, and offers nothing.
describe('the approval screen for an expired request (B55.10)', () => {
  it('says the request expired and that nothing waiting was paid', async () => {
    mockBff(false, BASE, { status: 'expired' })
    window.history.pushState({}, '', '/approve/preq_1')
    render(<App />)
    expect(await screen.findByText('This request expired: nobody approved it within 24 hours. Nothing waiting was paid.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Approve/ })).not.toBeInTheDocument()
  })
})

describe('the approval screen when only the phone holds a key (B55.2)', () => {
  it('opens no passkey prompt, sends nothing, and says to approve on the phone', async () => {
    const bff = mockBff()
    const posts = onlyThePhoneKey()
    window.history.pushState({}, '', '/approve/preq_1')
    render(<App />)
    expect(await screen.findByText('Approve this on your phone: it is waiting in Talyvor there.')).toBeInTheDocument()
    const card = screen.getByTestId('approve-card')
    expect(within(card).queryByRole('button', { name: /Approve|Decline/ })).toBeNull()
    expect(within(card).queryByRole('checkbox')).toBeNull()
    expect(bff.get).not.toHaveBeenCalled()
    expect(posts).toEqual([])
  })
})
