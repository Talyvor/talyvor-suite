import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B61.33 — Pay, to a person (Pocket Live's web `pay` and its panel): first on Pay, one field takes a Talyvor name, phone
// number or email; a match shows the person's shown name with Pay, and no match says Lens's words. The panel takes the
// amount, the account it leaves and a note, reviews it and sends it once under one key, signed with the passkey when
// Lens names one; Lens's refusals are said in its words; the person paid is a chip afterwards.

const ASSERTION_FIELDS = ['credential_id', 'client_data_json', 'authenticator_data', 'signature']
const acct = (id: string, currency: string, purpose: 'company' | 'agent', minor: number) => ({
  id, agent_id: purpose === 'agent' ? 'agt_1' : '', currency, purpose, status: 'open', name: `${currency} account`, balance_minor: minor, test_minor: minor, live_minor: 0,
})

let posts: { path: string; body: Record<string, unknown> }[]
let passkeys: string[]
let refusal: { status: number; error: string } | null
let lookups: { status: number; error: string } | null

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
const text = (el: Element | null) => (el?.textContent ?? '').replace(/[\u00a0\u202f]/g, ' ')

beforeEach(() => {
  posts = []
  passkeys = []
  refusal = null
  lookups = null
  window.localStorage.clear()
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const path = String(input).split('?')[0]
    const method = init?.method ?? 'GET'
    const body = method === 'POST' && init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
    if (method === 'POST') posts.push({ path, body })
    if (path === '/auth/me') return json({ mode: 'oidc', authenticated: true, workspace_id: 'ws_maya', user: { sub: 'usr_maya', email: 'maya@example.com' } })
    if (path === '/api/workspace/account') return json({ account_type: 'personal', money_kind: 'fiat' })
    if (path === '/api/money/accounts') return json({ accounts: [acct('macc_usd', 'USD', 'company', 240_000), acct('macc_gbp', 'GBP', 'company', 156_000), acct('macc_agt', 'USD', 'agent', 40_000)] })
    if (path === '/api/agents/passkeys') return json({ passkeys: passkeys.map((id) => ({ id, credential_id: id, created_at: '2026-11-01T09:00:00Z' })) })
    if (path === '/api/money/devices') return json({ devices: [] })
    if (path === '/api/money/people/find') {
      if (lookups) return json({ error: lookups.error }, lookups.status)
      return body.to === 'dana' || body.to === '+44 7700 900123'
        ? json({ shown_name: 'Dana R.' })
        : json({ error: 'Nobody found. Check the name or number, or ask them to turn on being found in Settings.', reason: 'not_found' }, 404)
    }
    if (path === '/api/money/people/pay/challenge') return json({ challenge: 'Y2g0', allow_credentials: passkeys, user_verification: 'required' })
    if (path === '/api/money/people/pay') {
      if (refusal) return json({ error: refusal.error }, refusal.status)
      return json({ id: 'me_1', to_shown_name: 'Dana R.', from_account_id: body.account_id, amount_minor: body.amount_minor, currency: body.currency, funding: 'test',
        note: body.note, idempotency_key: body.idempotency_key, created_at: '2026-11-16T09:00:00Z' }, 201)
    }
    if (path === '/api/agents') return json({ workspace_balance_ulxc: 0, allocated_ulxc: 0, unallocated_ulxc: 0, spent_ulxc: 0, agents: [] })
    if (path === '/api/money/payees') return json({ payees: [] })
    if (path === '/api/money/payments') return json({ payments: [] })
    return json({ error: 'not here' }, 404)
  })
})

afterEach(() => {
  cleanup()
  queryClient.clear()
  vi.restoreAllMocks()
  Reflect.deleteProperty(navigator, 'credentials')
  window.history.pushState({}, '', '/')
})

async function openPay() {
  window.history.pushState({}, '', '/money/pay')
  render(<App />)
  return screen.findByTestId('pay-a-person')
}

async function find(card: HTMLElement, to: string) {
  fireEvent.change(within(card).getByLabelText('Name, phone number or email'), { target: { value: to } })
  fireEvent.click(within(card).getByRole('button', { name: 'Find' }))
}

/** Pays Dana R. $12.50 from the dollar account with a note, up to the review. */
async function review(card: HTMLElement) {
  await find(card, 'dana')
  fireEvent.click(await within(card).findByRole('button', { name: 'Pay Dana R.' }))
  const dialog = await screen.findByRole('dialog', { name: 'Pay Dana R.' })
  fireEvent.change(within(dialog).getByLabelText('Amount in USD'), { target: { value: '12.50' } })
  fireEvent.change(within(dialog).getByLabelText('Note'), { target: { value: 'Lunch' } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Review' }))
  await within(dialog).findByTestId('pay-a-person-review')
  return dialog
}

describe('Pay, to a person (B61.33)', () => {
  it('is first on Pay, and its one field finds a person by name: their shown name, with Pay', async () => {
    const card = await openPay()
    const left = card.parentElement as HTMLElement
    expect(left.firstElementChild).toBe(card)
    expect(within(card).getByRole('heading', { name: 'To a person' })).toBeTruthy()
    expect(within(card).getByLabelText('Name, phone number or email').getAttribute('placeholder')).toBe('Name, phone number or email')
    await find(card, 'dana')
    const found = await within(card).findByTestId('pay-a-person-found')
    expect(text(found)).toContain('Dana R.')
    expect(within(card).getByRole('button', { name: 'Pay Dana R.' })).toBe(found)
    // One main action: Find goes once there is someone to pay.
    expect(within(card).queryByRole('button', { name: 'Find' })).toBeNull()
    expect(posts).toEqual([{ path: '/api/money/people/find', body: { to: 'dana' } }])
  })

  it('is drawn as Pocket Live draws it: the person found is one row to press, From is picked by what each account holds, then Send', async () => {
    const card = await openPay()
    // B57.182 — the field is the reference's search pill, named by its placeholder alone.
    expect(within(card).queryByText('Name, phone number or email', { selector: 'label' })).toBeNull()
    await find(card, 'dana')
    const found = await within(card).findByTestId('pay-a-person-found')
    expect(within(card).getByRole('button', { name: 'Pay Dana R.' })).toBe(found)
    expect(text(found)).toContain('On Talyvor')
    fireEvent.click(found)
    const dialog = await screen.findByRole('dialog', { name: 'Pay Dana R.' })
    expect(text(within(dialog).getByTestId('pay-a-person-who'))).toBe('On Talyvor')
    expect(within(dialog).getByText('Type the amount')).toBeTruthy()
    const from = within(dialog).getByRole('radiogroup', { name: 'From' })
    const picks = within(from).getAllByRole('radio')
    expect(picks.map((r) => (r as HTMLInputElement).checked)).toEqual([true, false])
    expect(text(from)).toContain('Holds $2,400.00')
    expect(text(from)).toContain('Holds £1,560.00')
    fireEvent.click(picks[1])
    fireEvent.change(within(dialog).getByLabelText('Amount in GBP'), { target: { value: '5' } })
    // One main action a step: no Cancel beside Review, the close x is there.
    expect(within(dialog).queryByRole('button', { name: 'Cancel' })).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Review' }))
    await within(dialog).findByTestId('pay-a-person-review')
    const order = Array.from(dialog.querySelectorAll('button')).map((b) => text(b))
    expect(order.indexOf('Send')).toBeGreaterThan(-1)
    expect(order.indexOf('Send')).toBeLessThan(order.indexOf('Change something'))
  })

  it('says Lens’s words when nobody is found, and at the limit of lookups', async () => {
    const card = await openPay()
    await find(card, 'grace')
    expect(text(await within(card).findByTestId('pay-a-person-nobody'))).toBe('Nobody found. Check the name or number, or ask them to turn on being found in Settings.')
    expect(within(card).queryByTestId('pay-a-person-found')).toBeNull()
    lookups = { status: 429, error: 'economy: too many people looked up: an account looks up at most 30 people an hour. Try again after 10:00 UTC' }
    await find(card, 'dana')
    await waitFor(() => expect(text(within(card).getByTestId('pay-a-person-nobody'))).toBe('Too many people looked up: an account looks up at most 30 people an hour. Try again after 10:00 UTC.'))
  })

  it('pays the person once from the account chosen, signed with the passkey Lens names, and keeps them as a chip', async () => {
    passkeys = ['Y3JlZDE']
    const get = vi.fn().mockResolvedValue({
      rawId: new Uint8Array([1]).buffer,
      response: { clientDataJSON: new Uint8Array([2]).buffer, authenticatorData: new Uint8Array([3]).buffer, signature: new Uint8Array([4]).buffer },
    })
    Object.defineProperty(navigator, 'credentials', { value: { get, create: vi.fn() }, configurable: true })
    const card = await openPay()
    const dialog = await review(card)
    expect(text(within(dialog).getByTestId('pay-a-person-review'))).toContain('$12.50')
    expect(text(within(dialog).getByTestId('pay-a-person-review'))).toContain('In seconds')
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Send with your passkey' }))
    expect(text(await within(dialog).findByTestId('pay-a-person-sent'))).toBe('$12.50 to Dana R.. It is there now.')
    expect(get).toHaveBeenCalledTimes(1)
    const [challenge, pay] = posts.filter((p) => p.path.startsWith('/api/money/people/pay'))
    const payment = { to: 'dana', amount_minor: 1250, currency: 'USD', account_id: 'macc_usd', note: 'Lunch' }
    expect(challenge).toMatchObject({ path: '/api/money/people/pay/challenge', body: payment })
    expect(pay).toMatchObject({ path: '/api/money/people/pay', body: { ...payment, idempotency_key: challenge.body.idempotency_key } })
    expect(Object.keys(pay.body.assertion as object).sort()).toEqual([...ASSERTION_FIELDS].sort())
    expect(posts.filter((p) => p.path === '/api/money/people/pay')).toHaveLength(1)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }))
    const chips = await within(card).findByTestId('pay-a-person-paid')
    fireEvent.click(within(chips).getByRole('button', { name: 'Pay Dana R. again' }))
    await within(card).findByTestId('pay-a-person-found')
    expect(posts.filter((p) => p.path === '/api/money/people/find').map((p) => p.body.to)).toEqual(['dana', 'dana'])
  })

  it('says each refusal in Lens’s words, and the first payment without a key offers the way to add one', async () => {
    const card = await openPay()
    let dialog = await review(card)
    refusal = { status: 403, error: "economy: the first payment to a person is signed with your passkey or the phone app's key. Add one first" }
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send' }))
    expect(text(await within(dialog).findByTestId('pay-a-person-refused'))).toBe("The first payment to a person is signed with your passkey or the phone app's key. Add one first.")
    expect(within(dialog).getByRole('link', { name: 'Approvals and devices' }).getAttribute('href')).toBe('/approvals')
    for (const [status, error, said] of [
      [409, 'economy: the person paid has no account in this currency: Dana R. has no USD account', 'The person paid has no account in this currency: Dana R. has no USD account.'],
      [409, 'economy: this person cannot be paid just now', 'This person cannot be paid just now.'],
      [403, 'economy: this account is frozen: no money moves out of it', 'This account is frozen: no money moves out of it.'],
    ] as const) {
      refusal = { status, error }
      fireEvent.click(within(dialog).getByRole('button', { name: 'Send' }))
      await waitFor(() => expect(text(within(dialog).getByTestId('pay-a-person-refused'))).toBe(said))
    }
    expect(within(dialog).queryByTestId('pay-a-person-sent')).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Change something' }))
    dialog = screen.getByRole('dialog', { name: 'Pay Dana R.' })
    expect(within(dialog).getByLabelText('Amount in USD')).toBeTruthy()
  })
})
