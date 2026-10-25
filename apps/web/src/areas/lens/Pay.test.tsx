import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B30.96 — the Pay screen: a payee saved with its account details is listed with what its bank said of the name; a payment
// to it from the agent's account goes to the BFF in minor units with the account, the payee and one idempotency key, and the
// row then reads Completed; a payouts CSV goes up as text/csv and the batch reads its rows' results.

const ACCOUNTS = [
  { id: 'macc_co', agent_id: '', currency: 'GBP', purpose: 'company', status: 'open', name: 'GBP account', balance_minor: 0, test_minor: 0, live_minor: 0 },
  { id: 'macc_agt', agent_id: 'agt_1', currency: 'GBP', purpose: 'agent', status: 'open', name: 'GBP account', balance_minor: 10000, test_minor: 10000, live_minor: 0 },
]

function mockBff(asked: unknown[] = []) {
  const sent: Array<{ url: string; headers: Record<string, string>; body: unknown }> = []
  const payees: unknown[] = []
  const payments: unknown[] = []
  const bills: unknown[] = []
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
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
    if (url === '/api/money/payments' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>
      sent.push({ url, headers: init.headers as Record<string, string>, body })
      const p = { id: 'mpay_1', account_id: body.account_id, payee_id: body.payee_id, payee_name: 'Acme Ltd', amount_minor: body.amount_minor, currency: body.currency, funding: 'test',
        reference: body.reference, idempotency_key: body.idempotency_key, status: 'completed', created_at: '2026-10-11T09:00:00Z', updated_at: '2026-10-11T09:00:01Z' }
      payments.unshift(p)
      return json(p, 201)
    }
    if (url === '/api/money/payments') return json({ payments })
    return json({ error: 'not found' }, 404)
  })
  return { sent }
}

/** Answers the first-payment scam questions (B41.13): told to pay urgently, then details by email or chat. */
function answer(form: HTMLElement, urgent: 'Yes' | 'No', byMessage: 'Yes' | 'No') {
  fireEvent.click(within(within(form).getByRole('radiogroup', { name: 'Were you told to pay urgently?' })).getByLabelText(urgent))
  fireEvent.click(within(within(form).getByRole('radiogroup', { name: 'Did the bank details arrive by email or chat?' })).getByLabelText(byMessage))
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  queryClient.clear()
})

describe('the Pay screen', () => {
  it('saves a payee, pays it from the agent’s account in minor units under one key, and the payment reads Completed', async () => {
    const bff = mockBff()
    window.history.pushState({}, '', '/money/pay')
    render(<App />)

    const payeeForm = await screen.findByTestId('new-payee')
    expect(screen.queryByTestId('pay-preview')).toBeNull()
    expect(document.body.textContent).not.toMatch(/test money/i)
    fireEvent.change(within(payeeForm).getByLabelText('Payee’s name'), { target: { value: 'Acme Ltd' } })
    fireEvent.change(within(payeeForm).getByLabelText('Sort code'), { target: { value: '04-00-04' } })
    fireEvent.change(within(payeeForm).getByLabelText('Account number'), { target: { value: '12345678' } })
    fireEvent.click(within(payeeForm).getByRole('button', { name: 'Save payee' }))
    const payee = await screen.findByTestId('payee-payee_1')
    expect(bff.sent[0].body).toEqual({ name: 'Acme Ltd', country: 'GB', sort_code: '040004', account_number: '12345678' })
    expect(within(payee).getByText('Exact match')).toBeTruthy()

    const form = screen.getByTestId('send-payment')
    fireEvent.change(within(form).getByLabelText('From'), { target: { value: 'macc_agt' } })
    fireEvent.change(within(form).getByLabelText('To'), { target: { value: 'payee_1' } })
    fireEvent.change(within(form).getByLabelText('Amount in GBP'), { target: { value: '20.00' } })
    fireEvent.change(within(form).getByLabelText('Reference'), { target: { value: 'Rent' } })
    answer(form, 'No', 'No')
    expect(within(form).queryByTestId('scam-warning')).toBeNull()
    fireEvent.click(within(form).getByRole('button', { name: 'Send' }))
    const row = await screen.findByTestId('payment-mpay_1')
    expect(bff.sent[1].body).toMatchObject({ account_id: 'macc_agt', payee_id: 'payee_1', amount_minor: 2000, currency: 'GBP', reference: 'Rent' })
    expect(String((bff.sent[1].body as { idempotency_key: string }).idempotency_key).length).toBeGreaterThan(8)
    expect(within(row).getByText('£20.00')).toBeTruthy()
    expect(within(row).getByText('Completed')).toBeTruthy()
    expect(screen.getByTestId('pay-count').textContent).toBe('1 payment out, 1 completed')
  })

  it('asks two scam questions before a first payment: a yes warns and needs a second confirmation, and a second payment asks nothing', async () => {
    const bff = mockBff()
    window.history.pushState({}, '', '/money/pay')
    render(<App />)
    const payeeForm = await screen.findByTestId('new-payee')
    fireEvent.change(within(payeeForm).getByLabelText('Payee’s name'), { target: { value: 'Acme Ltd' } })
    fireEvent.change(within(payeeForm).getByLabelText('Sort code'), { target: { value: '04-00-04' } })
    fireEvent.change(within(payeeForm).getByLabelText('Account number'), { target: { value: '12345678' } })
    fireEvent.click(within(payeeForm).getByRole('button', { name: 'Save payee' }))
    await screen.findByTestId('payee-payee_1')

    const form = screen.getByTestId('send-payment')
    fireEvent.change(within(form).getByLabelText('To'), { target: { value: 'payee_1' } })
    fireEvent.change(within(form).getByLabelText('Amount in GBP'), { target: { value: '20.00' } })
    const send = within(form).getByRole('button', { name: 'Send' }) as HTMLButtonElement
    expect(send.disabled).toBe(true) // unanswered
    answer(form, 'No', 'Yes')
    const warning = within(form).getByTestId('scam-warning')
    expect(warning.textContent).toContain('This could be a scam.')
    expect(send.disabled).toBe(true) // a yes needs the second confirmation
    fireEvent.click(within(warning).getByRole('checkbox'))
    expect(send.disabled).toBe(false)
    fireEvent.click(send)
    await screen.findByTestId('payment-mpay_1')
    expect(bff.sent).toHaveLength(2)

    fireEvent.change(within(form).getByLabelText('To'), { target: { value: 'payee_1' } })
    fireEvent.change(within(form).getByLabelText('Amount in GBP'), { target: { value: '5.00' } })
    expect(within(form).queryByTestId('scam-check')).toBeNull()
    expect((within(form).getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(false)
  })

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
})
