import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'
import { settleQueries } from '../../populatedBff'
import { pressEverything } from '../../test/pressEverything'

// B45.37 — the plan an assistant's link opens: each order with its payee, amount and frequency, the mandate's limits in
// plain words, and one passkey signature over exactly the plan's canonical mandate, after which the orders read Running.
// B57.98 — drawn in Pocket (w-recurring-plan): waiting, signed, declined and expired in words, and with only the phone's
// key nothing here asks this browser for a signature.

const terms = (expires: string) => JSON.stringify({ id: 'pm_r', clients: ['schedule:rpp_1'], scope: { payees: ['payee_1', 'payee_2'], currencies: ['USD'] },
  limits: { per_payment: { USD: 45000 }, per_month: { USD: 63000 } }, requires_approval_above: { USD: 50000 },
  new_payee: { policy: 'always_ask' }, expires_at: expires })
const CANONICAL = terms('2099-06-30T00:00:00Z')

const plan = (signed: boolean, canonical = CANONICAL) => ({ id: 'rpp_1', status: signed ? 'signed' : 'awaiting_signature', created_at: '2026-11-05T09:00:00Z',
  mandate: { id: 'pm_r', canonical, challenge: 'Y2gx', credential_ids: ['Y3JlZDE'] },
  schedules: [
    { id: 'sch_1', from_agent_id: '', to_agent_id: '', to_payee_id: 'payee_1', amount_minor: 45000, currency: 'USD', amount_ulxc: 0, every: 'month', next_run_at: '2026-11-01T09:00:00Z', active: signed, created_at: '2026-11-05T09:00:00Z' },
    { id: 'sch_2', from_agent_id: '', to_agent_id: '', to_payee_id: 'payee_2', amount_minor: 1250, currency: 'USD', amount_ulxc: 0, every: 'week', next_run_at: '2026-11-01T09:00:00Z', active: signed, created_at: '2026-11-05T09:00:00Z' },
  ] })

const PAYEES = { payees: [{ id: 'payee_1', name: 'Kite Accounting', check: 'exact_match' }, { id: 'payee_2', name: 'Northwind Data', check: 'close_match' }] }
const PASSKEY = { passkeys: [{ credential_id: 'Y3JlZDE', name: 'This Mac', created_at: '2026-10-03T08:00:00Z' }] }

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  queryClient.clear()
})

/** The BFF for one plan: what was sent, and whether it has been signed. */
function bff(opts: { canonical?: string; passkeys?: unknown; devices?: unknown } = {}) {
  const sent: { url: string; body: unknown }[] = []
  const state = { signed: false, gone: false }
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/money/payees') return json(PAYEES)
    if (url === '/api/agents/passkeys') return json(opts.passkeys ?? PASSKEY)
    if (url === '/api/money/devices') return json(opts.devices ?? { devices: [] })
    if (url === '/api/money/assistant-requests') {
      const r = { id: 'ar_plan', kind: 'plan', assistant: 'Claude', created_at: '2026-11-05T09:00:00Z', status: state.signed ? 'signed' : 'pending_confirmation', details: plan(state.signed, opts.canonical) }
      return json({ requests: state.gone ? [] : [r] })
    }
    if (url === '/api/money/assistant-requests/ar_plan/sign') {
      sent.push({ url, body: JSON.parse(String(init?.body)) })
      state.signed = true
      return json({ id: 'pm_r', status: 'active' }, 201)
    }
    if (url === '/api/money/assistant-requests/ar_plan/dismiss') {
      sent.push({ url, body: null })
      state.gone = true
      return new Response(null, { status: 204 })
    }
    return json({})
  })
  const get = vi.fn().mockResolvedValue({ rawId: new Uint8Array([1]).buffer,
    response: { clientDataJSON: new Uint8Array([2]).buffer, authenticatorData: new Uint8Array([3]).buffer, signature: new Uint8Array([4]).buffer } })
  Object.defineProperty(navigator, 'credentials', { value: { get, create: vi.fn() }, configurable: true })
  window.history.pushState({}, '', '/money/plans/ar_plan')
  render(<App />)
  return { sent, get }
}

it('shows each standing order dollars first and what signing allows, then signs exactly its mandate with one passkey assertion', async () => {
  const { sent, get } = bff()
  const card = await screen.findByTestId('plan-card')
  await waitFor(() => expect(screen.getByTestId('plan-order-sch_1').textContent).toContain('Kite Accounting · $450.00 every month'))
  expect(screen.getByTestId('plan-order-sch_2').textContent).toContain('Northwind Data · $12.50 every week')
  expect(screen.getByTestId('plan-order-sch_1').textContent).toContain('From the company’s US dollar account · first on 1 November · saved payee, exact match')
  expect(screen.getByTestId('plan-order-sch_2').textContent).toContain('saved payee, close match')
  expect(card.textContent).toContain('Prepared')
  expect(screen.getByText(/Claude prepared two standing orders .*\. Nothing is paid until you sign\./)).toBeTruthy()
  const allows = screen.getByTestId('plan-terms').textContent
  expect(allows).toContain('Each order’s first payment waits for your approval under Approvals. After that it pays on its own, and you are told each time.')
  expect(allows).toContain('No payment is more than $450.00.')
  expect(allows).toContain('At most $630.00 a month in all.')
  expect(allows).toContain('A payment above $500.00 always waits for your approval.')
  expect(allows).toContain('Paid only to Kite Accounting, Northwind Data, in USD.')
  expect(allows).toContain('A new payee always needs your approval.')
  expect(sent).toHaveLength(0)

  fireEvent.click(screen.getByRole('button', { name: 'Sign with your passkey' }))
  await screen.findByText('Running.')
  expect(get).toHaveBeenCalledTimes(1)
  expect(sent).toEqual([{ url: '/api/money/assistant-requests/ar_plan/sign', body: { canonical: CANONICAL, assertion: expect.objectContaining({ credential_id: 'AQ', signature: 'BA' }) } }])
  expect(screen.getByTestId('plan-order-sch_1').textContent).toContain('Running')
  expect(screen.getByTestId('plan-card').textContent).toContain('Each order’s first payment waits for your approval under Approvals.')
  expect(screen.queryByRole('button', { name: 'Sign with your passkey' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Decline' })).toBeNull()
})

it('with only the phone’s key, asks nothing of this browser: no Sign or Decline, and says where to sign', async () => {
  const { sent, get } = bff({ passkeys: { passkeys: [] }, devices: { devices: [{ id: 'dk_iphone', name: 'iPhone, Talyvor app', created_at: '2026-10-04T09:00:00Z' }] } })
  await waitFor(() => expect(screen.getByTestId('plan-order-sch_1').textContent).toContain('Kite Accounting · $450.00 every month'))
  await screen.findByTestId('on-the-phone')
  expect(screen.getByTestId('on-the-phone').textContent).toContain('Sign these with a passkey on this browser: add this browser first.')
  expect(screen.queryByRole('button', { name: 'Sign with your passkey' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Decline' })).toBeNull()
  expect(get).not.toHaveBeenCalled()
  expect(sent).toHaveLength(0)
})

it('declines: the plan is dropped, nothing is signed, and the page says nothing is set up', async () => {
  const { sent, get } = bff()
  await waitFor(() => expect(screen.getByTestId('plan-order-sch_1').textContent).toContain('Kite Accounting · $450.00 every month'))
  fireEvent.click(screen.getByRole('button', { name: 'Decline' }))
  await screen.findByText('Declined.')
  expect(screen.getByTestId('plan-card').textContent).toContain('Declined. Nothing is set up, and nothing is paid.')
  expect(sent).toEqual([{ url: '/api/money/assistant-requests/ar_plan/dismiss', body: null }])
  expect(get).not.toHaveBeenCalled()
  expect(screen.getByTestId('plan-order-sch_1').textContent).toContain('Declined')
})

it('an expired plan says so and offers no signature', async () => {
  const { sent } = bff({ canonical: terms('2020-01-01T00:00:00Z') })
  await waitFor(() => expect(screen.getByTestId('plan-order-sch_1').textContent).toContain('Kite Accounting · $450.00 every month'))
  await settleQueries(queryClient, waitFor)
  expect(screen.getByTestId('plan-card').textContent).toContain('Expired. Nothing is set up, and nothing is paid.')
  expect(screen.getByTestId('plan-order-sch_1').textContent).toContain('Expired')
  expect(screen.queryByRole('button', { name: 'Sign with your passkey' })).toBeNull()
  expect(sent).toHaveLength(0)
})

it('presses every control on the plan and each does something', async () => {
  const request = { id: 'ar_plan', kind: 'plan', assistant: 'Claude', created_at: '2026-11-05T09:00:00Z', status: 'pending_confirmation', details: plan(false) }
  const report = await pressEverything('/money/plans/ar_plan', { '/api/money/assistant-requests': { requests: [request] }, '/api/money/payees': PAYEES })
  expect(report.pressed).toBeGreaterThan(0)
  expect(report.dead).toEqual([])
}, 120_000)
