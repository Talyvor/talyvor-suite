import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'
import { pressEverything } from '../../test/pressEverything'

// B30.96 — the Pay screen: a payee saved with its account details is listed with what its bank said of the name; a payment
// to it from the agent's account goes to the BFF in minor units with the account, the payee and one idempotency key, and the
// row then reads Completed; a payouts CSV goes up as text/csv and the batch reads its rows' results. B57.31 — Pay in Pocket: a
// saved payee pressed (or named by /money/pay#payee-<id>) fills To, Add a payee is a dialog, and Payments out reads in words.

let ACCOUNTS: Record<string, unknown>[] = [
  { id: 'macc_co', agent_id: '', currency: 'GBP', purpose: 'company', status: 'open', name: 'GBP account', balance_minor: 0, test_minor: 0, live_minor: 0 },
  { id: 'macc_agt', agent_id: 'agt_1', currency: 'GBP', purpose: 'agent', status: 'open', name: 'GBP account', balance_minor: 10000, test_minor: 10000, live_minor: 0 },
]

function mockBff(asked: unknown[] = [], bills: unknown[] = [], payees: Record<string, unknown>[] = [], payments: unknown[] = [], passkeys: string[] = [], prepared: unknown[] = []) {
  const sent: Array<{ url: string; headers: Record<string, string>; body: unknown }> = []
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/money/devices') return json({ devices: [] }) // B55.2: no phone key, so the web decides
    if (url === '/api/money/accounts') return json({ accounts: ACCOUNTS })
    if (url === '/api/agents') return json({ workspace_balance_ulxc: 0, allocated_ulxc: 0, unallocated_ulxc: 0, spent_ulxc: 0, agents: [{ id: 'agt_1', name: 'Researcher', balance_ulxc: 0, spent_ulxc: 0, keys: [], created_at: '2026-10-10T09:00:00Z' }] })
    if (url === '/api/wallets/capabilities') return json({ capabilities: [{ capability: 'payments_out', name: 'Money out', class: 'RED', real_money: false, level_needed: 'L2' }] })
    if (url === '/api/agents/approvals') return json({ approvals: [] })
    if (url === '/api/agents/passkeys') return json({ passkeys: [] })
    if (url === '/api/agents/schedules') return json({ schedules: [] })
    if (url === '/api/money/mandates') return json({ granted: [], received: [] })
    if (url === '/api/money/payouts' && init?.method === 'POST') {
      sent.push({ url, headers: init.headers as Record<string, string>, body: init.body })
      return json({ id: 'mpob_1', funding: 'test', status: 'awaiting_approval', rows_total: 2, rows_valid: 1, rows_invalid: 1, totals_minor: { GBP: 500 }, created_at: '2026-10-11T09:00:00Z',
        rows: [{ line: 2, payee_id: 'payee_1', payee_name: 'Acme Ltd', amount_minor: 500, currency: 'GBP', reference: 'May', status: 'valid' },
          { line: 3, payee_id: 'nobody', amount_minor: 100, currency: 'GBP', reference: '', status: 'invalid', detail: 'no such payee' }] }, 201)
    }
    if (url === '/api/money/payouts') return json({ payouts: [] })
    if (url.startsWith('/api/money/bills?') && init?.method === 'POST') {
      sent.push({ url, headers: init.headers as Record<string, string>, body: init.body })
      const again = bills.length > 0
      if (!again) bills.push({ id: 'bill_1', source: 'upload', filename: 'acme.pdf', supplier: 'Acme Hosting Ltd', invoice_number: 'INV-2041', amount_minor: 12000, currency: 'GBP',
        due_date: '2026-11-10', sort_code: '040004', account_number: '12345678', payee_match: 'new_payee', status: 'due', missing: [], created_at: '2026-10-25T09:00:00Z' })
      return json(bills[0], again ? 200 : 201)
    }
    if (url === '/api/money/bills') return json({ bills })
    if (url === '/api/money/bills/pay') {
      const body = JSON.parse(String(init?.body)) as { bill_ids: string[] }
      sent.push({ url, headers: init?.headers as Record<string, string>, body })
      const items = body.bill_ids.map((id, i) => {
        const b = bills.find((x) => (x as { id: string }).id === id) as { supplier: string; payee_id: string; currency: string; amount_minor: number; invoice_number: string }
        return { position: i + 1, payee_id: b.payee_id, payee_name: b.supplier, currency: b.currency, amount_minor: b.amount_minor, reference: b.invoice_number, bill_id: id,
          decision: 'needs_approval', reason: 'no permission mandate the person signed covers this payment' }
      })
      return json({ id: 'preq_1', kind: 'batch', status: 'pending_approval', client: 'chat', items, created_at: '2026-10-25T09:00:00Z' }, 201)
    }
    if (url === '/api/money/payment-requests/preq_1') return json({ id: 'preq_1', kind: 'batch', status: 'pending_approval', client: 'chat', created_at: '2026-10-25T09:00:00Z',
      items: (bills.slice(0, 2) as { supplier: string; payee_id: string; currency: string; amount_minor: number; invoice_number: string; id: string }[]).map((b, i) => ({
        position: i + 1, payee_id: b.payee_id, payee_name: b.supplier, currency: b.currency, amount_minor: b.amount_minor, reference: b.invoice_number, bill_id: b.id,
        decision: 'needs_approval', reason: 'no permission mandate the person signed covers this payment' })) })
    if (url === '/api/money/assistant-requests') return json({ requests: asked })
    if (url.startsWith('/api/money/assistant-requests/')) {
      sent.push({ url, headers: init?.headers as Record<string, string>, body: init?.body ? JSON.parse(String(init.body)) : undefined })
      const [, id, move] = /assistant-requests\/([^/]+)\/(\w+)$/.exec(url) ?? []
      if (move === 'prepare') return json({ canonical: '{"id":"pm-1"}', challenge: 'Y2gx', allow_credentials: ['Y3JlZDE'] })
      asked.splice(asked.findIndex((r) => (r as { id: string }).id === id), 1)
      return move === 'sign' ? json({ id: 'pm-1', status: 'active' }, 201) : new Response(null, { status: 204 })
    }
    if (url === '/api/money/payees' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as Record<string, string>
      sent.push({ url, headers: init.headers as Record<string, string>, body })
      const p = { id: 'payee_1', ...body, check: 'exact_match', checked_by: 'test', checked_at: '2026-10-11T09:00:00Z', needs_confirmation: false, created_at: '2026-10-11T09:00:00Z' }
      payees.push(p)
      return json(p, 201)
    }
    if (url === '/api/money/payees') return json({ payees })
    if (url === '/api/money/payees/payee_new/called/challenge') return json({ challenge: 'Y2gx', allow_credentials: ['Y3JlZDE'], user_verification: 'required' })
    if (url === '/api/money/payees/payee_new/called') {
      sent.push({ url, headers: init?.headers as Record<string, string>, body: JSON.parse(String(init?.body)) })
      delete payees[0].cooling_off_until
      return json({ ...payees[0], called_at: '2026-10-29T10:00:00Z' })
    }
    if (url === '/api/money/payees/payee_new/details/challenge') {
      sent.push({ url, headers: init?.headers as Record<string, string>, body: JSON.parse(String(init?.body)) })
      return json({ challenge: 'Y2gy', allow_credentials: ['Y3JlZDE'], user_verification: 'required', notice: 'Call them on a number you already know.' })
    }
    if (url === '/api/money/payees/payee_new/details') {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      sent.push({ url, headers: init?.headers as Record<string, string>, body })
      Object.assign(payees[0], { sort_code: '400000', account_number: '87654321', details_changed_at: '2026-10-29T10:00:00Z', held_until: '2026-10-30T10:00:00Z',
        notice: 'Call them on a number you already know — not one from the message that asked for the change — to check the new details are theirs.' })
      return json(payees[0])
    }
    if (url === '/api/money/payments/challenge') {
      sent.push({ url, headers: init?.headers as Record<string, string>, body: JSON.parse(String(init?.body)) })
      return json({ challenge: 'Y2gz', allow_credentials: passkeys, user_verification: 'required' })
    }
    if (url === '/api/money/payments' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>
      sent.push({ url, headers: init.headers as Record<string, string>, body })
      const p = { id: 'mpay_1', account_id: body.account_id, payee_id: body.payee_id, payee_name: 'Acme Ltd', amount_minor: body.amount_minor, currency: body.currency, funding: 'test',
        reference: body.reference, idempotency_key: body.idempotency_key, status: 'completed', created_at: '2026-10-11T09:00:00Z', updated_at: '2026-10-11T09:00:01Z' }
      payments.unshift(p)
      return json(p, 201)
    }
    if (url === '/api/money/payments') return json({ payments })
    if (url === '/api/money/payment-requests?status=pending_approval') return json({ requests: prepared })
    // B57.31 — a request Chat prepared that paid mpay_3; no other request exists, whatever a payment's key says.
    if (url === '/api/money/payment-requests/preq_7') return json({ id: 'preq_7', status: 'approved', summary: '', client: 'chat', totals: { GBP: 18000 }, created_at: '2026-10-01T09:00:00Z',
      items: [{ position: 1, payee_id: 'payee_2', payee_name: 'Kite Accounting', currency: 'GBP', amount_minor: 18000, reference: '', decision: 'auto', reason: '', payment_id: 'mpay_3' }] })
    return json({ error: 'not found' }, 404)
  })
  return { sent }
}

/** Answers the first-payment scam questions (B41.13), as Pocket's choices: told to pay urgently, then details by email or chat. */
function answer(form: HTMLElement, urgent: 'Yes' | 'No', byMessage: 'Yes' | 'No') {
  fireEvent.click(within(within(form).getByRole('radiogroup', { name: 'Were you told to pay urgently?' })).getByRole('radio', { name: urgent }))
  fireEvent.click(within(within(form).getByRole('radiogroup', { name: 'Did the bank details arrive by email or chat?' })).getByRole('radio', { name: byMessage }))
}

const PAYEE = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, name, country: 'GB', sort_code: '040004', account_number: '12345678',
  check: 'exact_match', checked_by: 'test', checked_at: '2026-10-28T09:00:00Z', needs_confirmation: false, created_at: '2026-10-28T09:00:00Z', ...extra })
const PAYMENT = (id: string, payeeID: string, name: string, minor: number, status: string, extra: Record<string, unknown> = {}) => ({ id, account_id: 'macc_co',
  payee_id: payeeID, payee_name: name, amount_minor: minor, currency: 'GBP', funding: 'test', reference: '', idempotency_key: `k_${id}`, status,
  created_at: '2026-10-01T09:00:00Z', updated_at: '2026-10-01T09:00:01Z', ...extra })

/** Adds a payee through Add a payee's dialog, with a sort code and account number. */
async function addPayee(name: string) {
  fireEvent.click((await screen.findAllByRole('button', { name: 'Add a payee' }))[0])
  const dialog = screen.getByRole('dialog', { name: 'Add a payee' })
  fireEvent.change(within(dialog).getByLabelText('Name on the account'), { target: { value: name } })
  fireEvent.change(within(dialog).getByLabelText('Sort code'), { target: { value: '04-00-04' } })
  fireEvent.change(within(dialog).getByLabelText('Account number'), { target: { value: '12345678' } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save payee' }))
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
describe('the Pay screen', () => {
  // B57.31 — the address ⌘K's Payees open fills To with that payee.
  it('fills To with the payee /money/pay#payee-<id> names', async () => {
    mockBff([], [], [PAYEE('payee_1', 'Acme Ltd'), PAYEE('payee_2', 'Kite Accounting')])
    window.history.pushState({}, '', '/money/pay#payee-payee_2')
    render(<App />)
    const form = await screen.findByTestId('send-payment')
    await vi.waitFor(() => expect((within(form).getByLabelText('To') as HTMLSelectElement).value).toBe('payee_2'))
    expect(within(screen.getByTestId('payee-payee_2')).getByText('Paying')).toBeTruthy()
  })

  // B57.31 — pressing a saved payee pays it: To is filled, and the row says so.
  it('fills To when a saved payee is pressed', async () => {
    mockBff([], [], [PAYEE('payee_1', 'Acme Ltd'), PAYEE('payee_2', 'Kite Accounting')])
    window.history.pushState({}, '', '/money/pay')
    render(<App />)
    const row = await screen.findByTestId('payee-payee_1')
    fireEvent.click(within(row).getByRole('link', { name: /Acme Ltd/ }))
    const form = screen.getByTestId('send-payment')
    await vi.waitFor(() => expect((within(form).getByLabelText('To') as HTMLSelectElement).value).toBe('payee_1'))
    expect(within(row).getByText('Paying')).toBeTruthy()
  })

  // B57.31 — each saved payee says its country, its account kind and its last payment; one paid today says so beside its name.
  it('shows each payee’s country, account kind and last payment, and one paid today says so', async () => {
    const today = new Date().toISOString()
    mockBff([], [], [
      PAYEE('payee_kite', 'Kite Accounting', { country: 'US', sort_code: undefined, account_number: '000123456', routing_number: '011000015' }),
      PAYEE('payee_nw', 'Northwind Data', { country: 'DE', sort_code: undefined, account_number: undefined, iban: 'DE89370400440532013000' }),
      PAYEE('payee_acme', 'Acme Ltd'),
    ], [
      PAYMENT('mpay_2', 'payee_kite', 'Kite Accounting', 45000, 'completed', { currency: 'USD', created_at: '2026-10-01T09:00:00Z' }),
      PAYMENT('mpay_1', 'payee_kite', 'Kite Accounting', 30000, 'completed', { currency: 'USD', created_at: '2026-09-01T09:00:00Z' }),
      PAYMENT('mpay_3', 'payee_nw', 'Northwind Data', 9900, 'failed', { currency: 'EUR' }),
      PAYMENT('mpay_4', 'payee_acme', 'Acme Ltd', 2000, 'completed', { created_at: today }),
    ])
    window.history.pushState({}, '', '/money/pay')
    render(<App />)
    const kite = await screen.findByTestId('payee-payee_kite')
    expect(kite.textContent).toContain('US · routing and account number · last paid $450.00 on 1 Oct')
    expect(within(kite).getByText('Exact match')).toBeTruthy()
    expect(screen.getByTestId('payee-payee_nw').textContent).toContain('DE · IBAN · not paid yet') // a refused payment paid nothing
    const acme = screen.getByTestId('payee-payee_acme')
    expect(acme.textContent).toContain('GB · sort code and account number')
    expect(within(acme).getByText('paid today')).toBeTruthy()
  })

  // B57.31 — Payments out reads each status in words, with why a refused one was refused and who prepared a payment.
  it('reads each payment out in words: Completed, Refused and why, Waiting for approval, and prepared by Chat, approved by you', async () => {
    mockBff([], [], [PAYEE('payee_1', 'Acme Ltd'), PAYEE('payee_2', 'Kite Accounting')], [
      PAYMENT('mpay_1', 'payee_1', 'Acme Ltd', 2000, 'completed', { reference: 'October hosting' }),
      PAYMENT('mpay_2', 'payee_2', 'Kite Accounting', 45000, 'failed', { detail: 'the account partner refused the payee’s account' }),
      PAYMENT('mpay_3', 'payee_2', 'Kite Accounting', 18000, 'completed', { idempotency_key: 'preq:preq_7:1' }),
      PAYMENT('mpay_4', 'payee_2', 'Kite Accounting', 100, 'completed', { idempotency_key: 'preq:preq_forged:1' }),
    ], [], [
      { id: 'preq_9', status: 'pending_approval', summary: '', client: 'chat', totals: { GBP: 5000 }, created_at: '2026-10-22T10:31:00Z',
        items: [{ position: 1, payee_id: 'payee_1', payee_name: 'Acme Ltd', currency: 'GBP', amount_minor: 5000, reference: 'Invoice 1042', decision: 'needs_approval', reason: '' }] },
    ])
    window.history.pushState({}, '', '/money/pay')
    render(<App />)
    const done = await screen.findByTestId('payment-mpay_1')
    expect(done.textContent).toContain('Acme Ltd · £20.00')
    expect(done.textContent).toContain('October hosting · 1 Oct')
    expect(within(done).getByText('Completed')).toBeTruthy()
    const refused = screen.getByTestId('payment-mpay_2')
    expect(within(refused).getByText('Refused')).toBeTruthy()
    expect(refused.textContent).toContain('the account partner refused the payee’s account')
    await vi.waitFor(() => expect(screen.getByTestId('payment-mpay_3').textContent).toContain('prepared by Chat, approved by you'))
    expect(screen.getByTestId('payment-mpay_4').textContent).not.toContain('prepared') // a key alone proves nothing
    const waiting = await screen.findByTestId('prepared-preq_9')
    expect(waiting.textContent).toContain('Acme Ltd · £50.00')
    expect(waiting.textContent).toContain('Invoice 1042 · prepared by Chat')
    expect(within(waiting).getByText('Waiting for approval')).toBeTruthy()
  })

  // B57.31 — a payee with a payment an assistant prepared, still waiting: Review it in place of Send, so it is not sent twice.
  it('offers Review it in place of Send for a payee whose prepared payment still waits', async () => {
    mockBff([], [], [PAYEE('payee_nw', 'Northwind Data'), PAYEE('payee_2', 'Kite Accounting')], [], [], [
      { id: 'preq_9', status: 'pending_approval', summary: '', client: 'chat', totals: { GBP: 18000 }, created_at: '2026-10-22T10:31:00Z',
        items: [{ position: 1, payee_id: 'payee_nw', payee_name: 'Northwind Data', currency: 'GBP', amount_minor: 18000, reference: 'Invoice 1042', decision: 'needs_approval', reason: '' }] },
    ])
    window.history.pushState({}, '', '/money/pay#payee-payee_nw')
    render(<App />)
    const form = await screen.findByTestId('send-payment')
    expect(await within(form).findByText('Chat prepared this payment, and it waits for your approval.')).toBeTruthy()
    expect(within(form).getByRole('link', { name: 'Review it' }).getAttribute('href')).toBe('/approve/preq_9')
    expect(within(form).queryByRole('button', { name: /^Send/ })).toBeNull()

    fireEvent.change(within(form).getByLabelText('To'), { target: { value: 'payee_2' } })
    expect(within(form).queryByRole('link', { name: 'Review it' })).toBeNull()
    expect(within(form).getByRole('button', { name: /^Send/ })).toBeTruthy()
  })

  // B57.31 — from the company's account a payment needs no approval; from an agent's, its rules judge it at its LXC value.
  it('says what approval a payment needs from the account chosen', async () => {
    mockBff([], [], [PAYEE('payee_1', 'Acme Ltd')])
    window.history.pushState({}, '', '/money/pay')
    render(<App />)
    const form = await screen.findByTestId('send-payment')
    expect(within(form).getByTestId('pay-approval').textContent).toBe('From the company’s account, a payment needs no approval.')
    fireEvent.change(within(form).getByLabelText('From'), { target: { value: 'macc_agt' } })
    expect(within(form).getByTestId('pay-approval').textContent).toBe(
      'From Researcher’s account, its rules judge it at its LXC value, and above its approval amount it waits for you.')
  })

  it('shows when a new payee’s large payments wait until, and ends the wait when the owner signs “I called them”', async () => {
    const bff = mockBff([], [], [PAYEE('payee_new', 'Joinery Ltd', { checked_at: '2026-10-29T09:00:00Z', created_at: '2026-10-29T09:00:00Z', cooling_off_until: '2026-10-30T09:00:00Z' })])
    const get = vi.fn().mockResolvedValue({ rawId: new Uint8Array([1]).buffer,
      response: { clientDataJSON: new Uint8Array([2]).buffer, authenticatorData: new Uint8Array([3]).buffer, signature: new Uint8Array([4]).buffer } })
    Object.defineProperty(navigator, 'credentials', { value: { get, create: vi.fn() }, configurable: true })
    window.history.pushState({}, '', '/money/pay')
    render(<App />)

    const wait = await screen.findByTestId('cooling-off-payee_new')
    expect(wait.textContent).toContain('A payment of more than 1,000 to Joinery Ltd waits until')
    expect(wait.textContent).toContain('call Joinery Ltd on a number you already had')
    expect(within(screen.getByTestId('payee-payee_new')).getByText('New payee')).toBeTruthy()
    fireEvent.click(within(wait).getByRole('button', { name: 'I called them: confirm with a passkey' }))
    await vi.waitFor(() => expect(screen.queryByTestId('cooling-off-payee_new')).toBeNull())
    expect(get).toHaveBeenCalledTimes(1)
    expect(bff.sent).toEqual([expect.objectContaining({ url: '/api/money/payees/payee_new/called', body: { assertion: expect.objectContaining({ credential_id: 'AQ', signature: 'BA' }) } })])
  })

  it('changes a payee’s bank details only with a passkey over the new details, and shows every payment to it held for 24 hours', async () => {
    const bff = mockBff([], [], [PAYEE('payee_new', 'Joinery Ltd')])
    const get = vi.fn().mockResolvedValue({ rawId: new Uint8Array([1]).buffer,
      response: { clientDataJSON: new Uint8Array([2]).buffer, authenticatorData: new Uint8Array([3]).buffer, signature: new Uint8Array([4]).buffer } })
    Object.defineProperty(navigator, 'credentials', { value: { get, create: vi.fn() }, configurable: true })
    window.history.pushState({}, '', '/money/pay#payee-payee_new')
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: 'Change Joinery Ltd’s bank details' }))
    const form = screen.getByTestId('change-details-payee_new')
    expect(form.textContent).toContain('Call them on a number you already know')
    fireEvent.change(within(form).getByLabelText('New sort code'), { target: { value: '40-00-00' } })
    fireEvent.change(within(form).getByLabelText('New account number'), { target: { value: '87654321' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Change with a passkey' }))

    const held = await screen.findByTestId('details-held-payee_new')
    expect(held.textContent).toContain('Joinery Ltd’s bank details changed, so every payment to them is held until')
    expect(held.textContent).toContain('a number you already know')
    expect(within(screen.getByTestId('payee-payee_new')).getByText('Details changed')).toBeTruthy()
    expect(get).toHaveBeenCalledTimes(1)
    const details = { country: 'GB', sort_code: '400000', account_number: '87654321' }
    expect(bff.sent).toEqual([
      expect.objectContaining({ url: '/api/money/payees/payee_new/details/challenge', body: details }),
      expect.objectContaining({ url: '/api/money/payees/payee_new/details', body: { ...details, assertion: expect.objectContaining({ credential_id: 'AQ', signature: 'BA' }) } }),
    ])
  })

  // B55.26 — a USDC wallet cannot pay a bank payee, and Intl refused its code and the whole screen with it.
  it('never offers an agent’s USDC wallet as From, and with only the wallet draws its no-account line', async () => {
    const before = ACCOUNTS
    const wallet = { id: 'macc_usdc', agent_id: 'agt_1', currency: 'USDC', purpose: 'agent', status: 'open', name: 'USDC wallet', balance_minor: 1500000, test_minor: 1500000, live_minor: 0 }
    try {
      ACCOUNTS = [{ id: 'macc_co', agent_id: '', currency: 'USD', purpose: 'company', status: 'open', name: 'USD account', balance_minor: 0, test_minor: 0, live_minor: 0 }, wallet]
      mockBff()
      window.history.pushState({}, '', '/money/pay')
      render(<App />)
      const from = within(await screen.findByTestId('send-payment')).getByLabelText('From') as HTMLSelectElement
      expect([...from.options].map((o) => o.value)).toEqual(['macc_co'])
      cleanup()
      queryClient.clear()

      ACCOUNTS = [wallet]
      render(<App />)
      expect(await screen.findByTestId('pay-no-account')).toBeTruthy()
    } finally {
      ACCOUNTS = before
    }
  })

  // B57.31 — Add a payee: the name on the account, the account, the name check, Save payee.
  it('adds a payee in its dialog and shows what the name check said', async () => {
    const bff = mockBff()
    window.history.pushState({}, '', '/money/pay')
    render(<App />)
    expect(await screen.findByText('No payees yet')).toBeTruthy()
    await addPayee('Acme Ltd')
    const payee = await screen.findByTestId('payee-payee_1')
    expect(bff.sent[0].body).toEqual({ name: 'Acme Ltd', country: 'GB', sort_code: '040004', account_number: '12345678' })
    expect(screen.queryByRole('dialog', { name: 'Add a payee' })).toBeNull()
    expect(within(payee).getByText('Exact match')).toBeTruthy()
    expect(screen.getByText('Acme Ltd saved: exact match.')).toBeTruthy()
  })

  it('pays a saved payee from the agent’s account in minor units under one key, and the payment reads Completed', async () => {
    const bff = mockBff()
    window.history.pushState({}, '', '/money/pay')
    render(<App />)
    await addPayee('Acme Ltd')
    const payee = await screen.findByTestId('payee-payee_1')
    expect(document.body.textContent).not.toMatch(/test money/i)

    fireEvent.click(within(payee).getByRole('link', { name: /Acme Ltd/ }))
    const form = screen.getByTestId('send-payment')
    fireEvent.change(within(form).getByLabelText('From'), { target: { value: 'macc_agt' } })
    await vi.waitFor(() => expect((within(form).getByLabelText('To') as HTMLSelectElement).value).toBe('payee_1'))
    fireEvent.change(within(form).getByLabelText('Amount in GBP'), { target: { value: '20.00' } })
    fireEvent.change(within(form).getByLabelText('Reference'), { target: { value: 'Rent' } })
    answer(form, 'No', 'No')
    expect(within(form).queryByTestId('scam-warning')).toBeNull()
    fireEvent.click(within(form).getByRole('button', { name: 'Send £20.00' }))
    const row = await screen.findByTestId('payment-mpay_1')
    expect(bff.sent[1]).toEqual(expect.objectContaining({ url: '/api/money/payments/challenge', body: bff.sent[2].body }))
    expect(bff.sent[2].body).toEqual({ account_id: 'macc_agt', payee_id: 'payee_1', amount_minor: 2000, currency: 'GBP', reference: 'Rent', idempotency_key: expect.any(String) })
    expect(String((bff.sent[2].body as { idempotency_key: string }).idempotency_key).length).toBeGreaterThan(8)
    expect(row.textContent).toContain('Acme Ltd · £20.00')
    expect(within(row).getByText('Completed')).toBeTruthy()
  })

  it('pays only once the workspace’s passkey signs the payment’s own challenge: cancelled, nothing is sent to pay', async () => {
    const bff = mockBff([], [], [PAYEE('payee_1', 'Acme Ltd')], [PAYMENT('mpay_0', 'payee_1', 'Acme Ltd', 100, 'completed')], ['Y3JlZDE'])
    const get = vi.fn().mockResolvedValueOnce(null).mockResolvedValue({ rawId: new Uint8Array([1]).buffer,
      response: { clientDataJSON: new Uint8Array([2]).buffer, authenticatorData: new Uint8Array([3]).buffer, signature: new Uint8Array([4]).buffer } })
    Object.defineProperty(navigator, 'credentials', { value: { get, create: vi.fn() }, configurable: true })
    window.history.pushState({}, '', '/money/pay#payee-payee_1')
    render(<App />)

    const form = await screen.findByTestId('send-payment')
    fireEvent.change(within(form).getByLabelText('From'), { target: { value: 'macc_agt' } })
    await vi.waitFor(() => expect((within(form).getByLabelText('To') as HTMLSelectElement).value).toBe('payee_1'))
    fireEvent.change(within(form).getByLabelText('Amount in GBP'), { target: { value: '20.00' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Send £20.00' }))
    await within(form).findByText('Nothing changed. You can try again.')
    expect(bff.sent.map((c) => c.url)).toEqual(['/api/money/payments/challenge'])

    fireEvent.click(within(form).getByRole('button', { name: 'Send £20.00' }))
    await screen.findByTestId('payment-mpay_1')
    expect(get).toHaveBeenCalledTimes(2)
    const payment = { account_id: 'macc_agt', payee_id: 'payee_1', amount_minor: 2000, currency: 'GBP', reference: '', idempotency_key: expect.any(String) }
    expect(bff.sent).toEqual([
      expect.objectContaining({ url: '/api/money/payments/challenge', body: payment }),
      expect.objectContaining({ url: '/api/money/payments/challenge', body: payment }),
      expect.objectContaining({ url: '/api/money/payments', body: { ...payment, assertion: { credential_id: 'AQ', client_data_json: 'Ag', authenticator_data: 'Aw', signature: 'BA' } } }),
    ])
    expect(bff.sent[2].body).toEqual({ ...(bff.sent[1].body as object), assertion: expect.anything() }) // signed over exactly what it pays
  })

  it('asks two scam questions before a first payment: a yes warns and needs a second confirmation, and a second payment asks nothing', async () => {
    const bff = mockBff()
    window.history.pushState({}, '', '/money/pay')
    render(<App />)
    await addPayee('Acme Ltd')
    const payee = await screen.findByTestId('payee-payee_1')
    fireEvent.click(within(payee).getByRole('link', { name: /Acme Ltd/ }))

    const form = screen.getByTestId('send-payment')
    fireEvent.change(within(form).getByLabelText('Amount in GBP'), { target: { value: '20.00' } })
    // Read afresh each time: a disabled Send says why beside it, so the button is drawn anew when it is enabled.
    const send = () => within(form).getByRole('button', { name: 'Send £20.00' }) as HTMLButtonElement
    expect(send().disabled).toBe(true) // unanswered
    answer(form, 'No', 'Yes')
    const warning = within(form).getByTestId('scam-warning')
    expect(warning.textContent).toContain('This could be a scam.')
    expect(send().disabled).toBe(true) // a yes needs the second confirmation
    fireEvent.click(within(warning).getByRole('checkbox'))
    expect(send().disabled).toBe(false)
    fireEvent.click(send())
    await screen.findByTestId('payment-mpay_1')
    expect(bff.sent).toHaveLength(3)

    fireEvent.change(within(form).getByLabelText('To'), { target: { value: 'payee_1' } })
    fireEvent.change(within(form).getByLabelText('Amount in GBP'), { target: { value: '5.00' } })
    expect(within(form).queryByTestId('scam-check')).toBeNull()
    expect((within(form).getByRole('button', { name: 'Send £5.00' }) as HTMLButtonElement).disabled).toBe(false)
  })

  // B57.31 — every control on the redrawn Pay does something. The buttons below are today's cards kept under it, which B57.32
  // redraws on their own pages (its forms' buttons are disabled until filled, and say why only once drawn in Pocket).
  it('presses every control on Pay and each does something', async () => {
    const today = ['Set up standing order', 'Grant mandate', 'Revoke', 'Upload and check', 'Rows', 'Add bill'].map((b) => `button “${b}”:`)
    const report = await pressEverything('/money/pay')
    expect(report.pressed).toBeGreaterThan(0)
    expect(report.dead.filter((d) => !today.some((t) => d.startsWith(t)))).toEqual([])
  }, 120_000)
  it('uploads a payouts CSV as text/csv under one key and shows each row’s result', async () => {
    const bff = mockBff()
    window.history.pushState({}, '', '/money/pay')
    render(<App />)
    const form = await screen.findByTestId('payout-upload')
    const csv = 'payee_id,amount,currency,reference\npayee_1,5.00,GBP,May\nnobody,1.00,GBP,\n'
    const file = new File([csv], 'payouts.csv', { type: 'text/csv' })
    file.text = () => Promise.resolve(csv)
    fireEvent.change(within(form).getByLabelText('Payouts CSV'), { target: { files: [file] } })
    fireEvent.click(within(form).getByRole('button', { name: 'Upload and check' }))
    const batch = await screen.findByTestId('payout-mpob_1')
    expect(bff.sent[0].headers['Content-Type']).toBe('text/csv')
    expect(bff.sent[0].headers['Idempotency-Key'].length).toBeGreaterThan(8)
    expect(bff.sent[0].body).toBe(csv)
    expect(within(batch).getByTestId('payout-row-3').textContent).toContain('no such payee')
    expect(within(batch).getByRole('button', { name: 'Approve and pay 1 row' })).toBeTruthy()
  })

  // B41.1 — an invoice uploaded as a file goes up as its own type and becomes one bill; the same invoice again is the same bill.
  it('adds an uploaded PDF invoice as one bill marked New payee, and the same invoice again stays one bill', async () => {
    const bff = mockBff()
    window.history.pushState({}, '', '/money/pay')
    render(<App />)
    const form = await screen.findByTestId('bill-upload')
    const file = new File(['%PDF-1.4'], 'acme.pdf', { type: 'application/pdf' })
    fireEvent.change(within(form).getByLabelText('Invoice file'), { target: { files: [file] } })
    fireEvent.click(within(form).getByRole('button', { name: 'Add bill' }))
    const bill = await screen.findByTestId('bill-bill_1')
    expect(bff.sent[0].url).toBe('/api/money/bills?source=upload&filename=acme.pdf')
    expect(bff.sent[0].headers['Content-Type']).toBe('application/pdf')
    expect(bff.sent[0].body).toBe(file)
    for (const text of ['Acme Hosting Ltd', 'INV-2041', '£120.00', 'Due 2026-11-10', 'New payee']) expect(bill.textContent).toContain(text)
    expect(await within(form).findByText('Added: Acme Hosting Ltd')).toBeTruthy()
    fireEvent.change(within(form).getByLabelText('Invoice file'), { target: { files: [file] } })
    fireEvent.click(within(form).getByRole('button', { name: 'Add bill' }))
    expect(await within(form).findByText('Already in your inbox: Acme Hosting Ltd')).toBeTruthy()
    expect(within(screen.getByRole('list', { name: 'Bills' })).getAllByRole('listitem')).toHaveLength(1)
  })

  // B41.2 — pay all due: the bills ticked go up as one request under one key, and its card shows their count, total and payees.
  it('pays the ticked due bills as one request and opens its one approval card with the count, total and every payee', async () => {
    const bill = (id: string, supplier: string, minor: number, extra: object = {}) => ({ id, source: 'upload', supplier, invoice_number: `INV-${id}`, amount_minor: minor,
      currency: 'GBP', due_date: '2026-11-10', payee_id: `payee_${id}`, payee_match: 'matched', status: 'due', missing: [], created_at: '2026-10-25T09:00:00Z', ...extra })
    const bff = mockBff([], [
      bill('1', 'Acme Hosting Ltd', 12000),
      bill('2', 'Brightline Studio Ltd', 3050),
      bill('3', 'Cloud Rent Ltd', 5000),
      bill('4', 'Paid Already Ltd', 999, { status: 'paid' }),
      bill('5', 'Unknown Supplier Ltd', 777, { payee_id: undefined, payee_match: 'new_payee' }),
    ])
    window.history.pushState({}, '', '/money/pay')
    render(<App />)
    const panel = await screen.findByTestId('bills-pay')
    // Only a due bill with a saved payee can be ticked.
    expect(screen.queryByRole('checkbox', { name: 'Pay £9.99 to Paid Already Ltd' })).toBeNull()
    expect(screen.queryByRole('checkbox', { name: 'Pay £7.77 to Unknown Supplier Ltd' })).toBeNull()
    expect(within(panel).getByTestId('bills-pay-total').textContent).toBe('Total £200.50')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Pay £50.00 to Cloud Rent Ltd' }))
    expect(within(panel).getByTestId('bills-pay-total').textContent).toBe('Total £150.50')
    fireEvent.click(within(panel).getByRole('button', { name: 'Pay 2 bills' }))

    const card = await screen.findByTestId('approve-card')
    const pay = bff.sent.filter((s) => s.url === '/api/money/bills/pay')
    expect(pay).toHaveLength(1)
    expect(pay[0].body).toEqual({ bill_ids: ['1', '2'] })
    expect(pay[0].headers['Idempotency-Key'].length).toBeGreaterThan(8)
    expect(within(card).getByTestId('approve-total').textContent).toBe('2 of 2 payments to approve, total £150.50')
    for (const text of ['Acme Hosting Ltd', 'Brightline Studio Ltd', 'Reference: INV-1', 'Reference: INV-2']) expect(card.textContent).toContain(text)
    expect(within(card).getByRole('button', { name: 'Approve 2 payments with a passkey' })).toBeTruthy()
  })

  // B40.35 — what an assistant asked for over /mcp waits here: a payee is saved only when the person presses Save, through the
  // same route as the form; a drafted mandate reads in plain words and is kept only with the passkey's signature.
  it('saves an assistant’s payee only on Save, and signs its drafted mandate with a passkey', async () => {
    const bff = mockBff([
      { id: 'ar_p', kind: 'payee', assistant: 'Claude', created_at: '2026-10-23T09:00:00Z', details: { name: 'Acme Ltd', country: 'GB', sort_code: '040004', account_number: '12345678' } },
      { id: 'ar_m', kind: 'mandate', assistant: 'Claude', created_at: '2026-10-23T09:01:00Z', details: { clients: ['mcp:tlv_oc_1'],
        scope: { payees: ['payee_9'], payee_categories: null, sellers: null, currencies: ['GBP'] },
        limits: { per_payment: { GBP: 50000 }, per_day: null, per_month: { GBP: 200000 }, batch_total: null, payments_per_hour: 0 },
        requires_approval_above: { GBP: 20000 }, new_payee: { policy: 'always_ask', cooling_off_hours: 0 }, expires_at: '2027-01-31T00:00:00Z' } },
    ])
    const get = vi.fn().mockResolvedValue({ rawId: new Uint8Array([1]).buffer,
      response: { clientDataJSON: new Uint8Array([2]).buffer, authenticatorData: new Uint8Array([3]).buffer, signature: new Uint8Array([4]).buffer } })
    Object.defineProperty(navigator, 'credentials', { value: { get, create: vi.fn() }, configurable: true })
    window.history.pushState({}, '', '/money/pay')
    render(<App />)

    const payee = await screen.findByTestId('asked-payee-ar_p')
    expect(screen.getByTestId('pay-asked').textContent).toContain('1 payee to save and 1 mandate to sign')
    expect(bff.sent).toHaveLength(0) // nothing saved before the person presses Save
    fireEvent.click(within(payee).getByRole('button', { name: 'Save payee' }))
    await screen.findByTestId('payee-payee_1')
    expect(bff.sent[0]).toMatchObject({ url: '/api/money/payees', body: { name: 'Acme Ltd', country: 'GB', sort_code: '040004', account_number: '12345678' } })
    expect(bff.sent[1].url).toBe('/api/money/assistant-requests/ar_p/dismiss')

    const mandate = screen.getByTestId('asked-mandate-ar_m')
    expect(mandate.textContent).toContain('Payments Claude prepares for payee_9, in GBP, are paid without asking you again.')
    expect(mandate.textContent).toContain('At most £500.00 a payment, £2,000.00 a month.')
    expect(mandate.textContent).toContain('A payment above £200.00 waits for your approval.')
    fireEvent.click(within(mandate).getByRole('button', { name: 'Sign with a passkey' }))
    await screen.findByText('Signed. The mandate is in force until it ends or you revoke it.')
    expect(get).toHaveBeenCalledTimes(1)
    expect(bff.sent.slice(2).map((x) => x.url)).toEqual(['/api/money/assistant-requests/ar_m/prepare', '/api/money/assistant-requests/ar_m/sign'])
    expect(bff.sent[3].body).toMatchObject({ canonical: '{"id":"pm-1"}', assertion: { credential_id: 'AQ', signature: 'BA' } })
  })

  // B55.41 — a payment status this screen has no words for never shows Lens's own word.
  it('reads a payment status it does not know as a sentence, never Lens’s word', async () => {
    mockBff([], [], [], [{ id: 'mpay_9', account_id: 'macc_co', payee_id: 'mpe_1', payee_name: 'Acme Ltd', amount_minor: 500, currency: 'GBP', funding: 'test',
      reference: 'R9', idempotency_key: 'k9', status: 'on_review', created_at: '2026-10-11T09:00:00Z', updated_at: '2026-10-11T09:00:01Z' }])
    window.history.pushState({}, '', '/money/pay')
    render(<App />)
    const row = await screen.findByTestId('payment-mpay_9')
    expect(within(row).getByText('We could not read this payment’s status')).toBeTruthy()
    expect(row.textContent).not.toMatch(/on_review|on review/)
  })
})

// B58.6 — a payout batch awaiting approval, answered over mockBff's stub: its challenge, and Lens's answers to Approve in turn.
const BATCH = { id: 'mpob_1', funding: 'test', status: 'awaiting_approval', rows_total: 2, rows_valid: 1, rows_invalid: 1, totals_minor: { GBP: 500 }, created_at: '2026-10-11T09:00:00Z' }
const BATCH_ROWS = [{ line: 2, payee_id: 'payee_1', payee_name: 'Acme Ltd', amount_minor: 500, currency: 'GBP', reference: 'May', status: 'valid' },
  { line: 3, payee_id: 'nobody', amount_minor: 100, currency: 'GBP', reference: '', status: 'invalid', detail: 'no such payee' }]
function awaitingBatch(passkeys: unknown[], approvals: Array<[number, unknown]>) {
  const inner = vi.mocked(fetch).getMockImplementation()!
  const posts: Array<{ url: string; body: unknown }> = []
  let now: unknown = { ...BATCH, rows: BATCH_ROWS } // what Lens holds, read back after each approval
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const url = String(input)
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if ((init?.method ?? 'GET') !== 'GET') posts.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (url === '/api/agents/passkeys') return json({ passkeys })
    if (url === '/api/money/payouts') return json({ payouts: [now] })
    if (url === '/api/money/payouts/mpob_1') return json(now)
    if (url === '/api/money/payouts/mpob_1/approve/challenge')
      return json({ challenge: 'Y2g0', allow_credentials: ['Y3JlZDE'], user_verification: 'required', payout: { id: 'mpob_1', rows_total: 2, rows_valid: 1, totals_minor: { GBP: 500 } } })
    if (url === '/api/money/payouts/mpob_1/approve') {
      const [status, body] = approvals.shift()!
      if (status === 200) now = body
      return json(body, status)
    }
    return inner(input, init)
  })
  return posts
}

describe('a payout batch’s approval (B58.6)', () => {
  it('shows the rows and totals it signs, asks for the passkey over the batch’s challenge, and a refusal pays nothing', async () => {
    mockBff()
    const posts = awaitingBatch([{ id: 'pk_1', name: 'MacBook' }], [
      [403, { error: 'a payment by a person needs the passkey or the phone key’s signature' }],
      [200, { ...BATCH, status: 'approved', approved_at: '2026-10-11T09:05:00Z', totals_minor: { GBP: 500 }, rows: [{ ...BATCH_ROWS[0], status: 'completed' }, BATCH_ROWS[1]] }],
    ])
    const get = vi.fn().mockResolvedValue({ rawId: new Uint8Array([1]).buffer,
      response: { clientDataJSON: new Uint8Array([2]).buffer, authenticatorData: new Uint8Array([3]).buffer, signature: new Uint8Array([4]).buffer } })
    Object.defineProperty(navigator, 'credentials', { value: { get, create: vi.fn() }, configurable: true })
    window.history.pushState({}, '', '/money/pay')
    render(<App />)

    const batch = await screen.findByTestId('payout-mpob_1')
    expect((await within(batch).findByTestId('payout-row-2')).textContent).toContain('Acme Ltd')
    expect((await within(batch).findByTestId('payout-signs')).textContent).toBe('Your passkey signs these 1 valid row and £5.00. If the batch changes after you sign, nothing is paid.')

    fireEvent.click(within(batch).getByRole('button', { name: 'Approve and pay 1 row' }))
    await within(batch).findByText('A payment by a person needs the passkey or the phone key’s signature.')
    expect(within(batch).getByText('Awaiting approval')).toBeTruthy()
    expect(within(within(batch).getByTestId('payout-row-2')).getByText('valid')).toBeTruthy()

    fireEvent.click(within(batch).getByRole('button', { name: 'Approve and pay 1 row' }))
    await within(batch).findByText('Approved')
    expect(within(within(batch).getByTestId('payout-row-2')).getByText('completed')).toBeTruthy()
    expect(get).toHaveBeenCalledTimes(2)
    expect(new Uint8Array(get.mock.calls[0][0].publicKey.challenge)).toEqual(new Uint8Array([0x63, 0x68, 0x34]))
    const signed = { assertion: { credential_id: 'AQ', client_data_json: 'Ag', authenticator_data: 'Aw', signature: 'BA' } }
    expect(posts).toEqual([
      { url: '/api/money/payouts/mpob_1/approve/challenge', body: {} },
      { url: '/api/money/payouts/mpob_1/approve', body: signed },
      { url: '/api/money/payouts/mpob_1/approve/challenge', body: {} },
      { url: '/api/money/payouts/mpob_1/approve', body: signed },
    ])
  })

  it('with only the phone’s key, sends nothing and says to approve on the phone', async () => {
    mockBff()
    const posts = onlyThePhoneKey({ '/api/money/payouts': { payouts: [BATCH] }, '/api/money/payouts/mpob_1': { ...BATCH, rows: BATCH_ROWS } })
    window.history.pushState({}, '', '/money/pay')
    render(<App />)
    const batch = await screen.findByTestId('payout-mpob_1')
    expect(await within(batch).findByText('Approve this on your phone: it is waiting in Talyvor there.')).toBeInTheDocument()
    expect(within(batch).queryByRole('button', { name: /Approve/ })).toBeNull()
    expect(posts).toEqual([])
  })
})

describe('an agent’s payment waiting on Pay when only the phone holds a key (B55.2)', () => {
  it('sends no decision and says to approve on the phone', async () => {
    mockBff()
    const posts = onlyThePhoneKey({ '/api/agents/approvals': { approvals: [
      { id: 'apr_9', agent_id: 'agt_1', amount_ulxc: 2_000_000, model: '', status: 'pending', created_at: '2026-10-25T06:01:00Z', payee: { kind: 'outside', id: 'payee_1', name: 'Acme Ltd' } },
    ] } })
    window.history.pushState({}, '', '/money/pay')
    render(<App />)
    const card = await screen.findByTestId('approval-apr_9')
    expect(await within(card).findByText('Approve this on your phone: it is waiting in Talyvor there.')).toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: /Approve|Decline/ })).toBeNull()
    expect(posts).toEqual([])
  })
})
