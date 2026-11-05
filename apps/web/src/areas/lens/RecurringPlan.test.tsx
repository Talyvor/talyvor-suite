import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B45.37 — the plan an assistant's link opens: each order with its payee, amount and frequency, the mandate's limits in
// plain words, and one passkey signature over exactly the plan's canonical mandate, after which the orders read Running.

const CANONICAL = JSON.stringify({ id: 'pm_r', clients: ['schedule:rpp_1'], scope: { payees: ['payee_1', 'payee_2'], currencies: ['GBP'] },
  limits: { per_payment: { GBP: 120000 }, per_month: { GBP: 125000 } }, requires_approval_above: { GBP: 100000 },
  new_payee: { policy: 'always_ask' }, expires_at: '2027-06-30T00:00:00Z' })

const plan = (signed: boolean) => ({ id: 'rpp_1', status: signed ? 'signed' : 'awaiting_signature', created_at: '2026-11-05T09:00:00Z',
  mandate: { id: 'pm_r', canonical: CANONICAL, challenge: 'Y2gx', credential_ids: ['Y3JlZDE'] },
  schedules: [
    { id: 'sch_1', from_agent_id: '', to_agent_id: '', to_payee_id: 'payee_1', amount_minor: 120000, currency: 'GBP', amount_ulxc: 0, every: 'month', next_run_at: '2026-11-05T09:00:00Z', active: signed, created_at: '2026-11-05T09:00:00Z' },
    { id: 'sch_2', from_agent_id: '', to_agent_id: '', to_payee_id: 'payee_2', amount_minor: 1250, currency: 'GBP', amount_ulxc: 0, every: 'week', next_run_at: '2026-11-05T09:00:00Z', active: signed, created_at: '2026-11-05T09:00:00Z' },
  ] })

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  queryClient.clear()
})

it('shows a prepared plan in plain words and signs exactly its mandate with a passkey, then shows its orders running', async () => {
  const sent: { url: string; body: unknown }[] = []
  let signed = false
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/money/payees') return json({ payees: [{ id: 'payee_1', name: 'Northside Lettings' }, { id: 'payee_2', name: 'Fibre Co' }] })
    if (url === '/api/money/assistant-requests') {
      return json({ requests: [{ id: 'ar_plan', kind: 'plan', assistant: 'Claude', created_at: '2026-11-05T09:00:00Z', status: signed ? 'signed' : 'pending_confirmation', details: plan(signed) }] })
    }
    if (url === '/api/money/assistant-requests/ar_plan/sign') {
      sent.push({ url, body: JSON.parse(String(init?.body)) })
      signed = true
      return json({ id: 'pm_r', status: 'active' }, 201)
    }
    return json({})
  })
  const get = vi.fn().mockResolvedValue({ rawId: new Uint8Array([1]).buffer,
    response: { clientDataJSON: new Uint8Array([2]).buffer, authenticatorData: new Uint8Array([3]).buffer, signature: new Uint8Array([4]).buffer } })
  Object.defineProperty(navigator, 'credentials', { value: { get, create: vi.fn() }, configurable: true })
  window.history.pushState({}, '', '/money/plans/ar_plan')
  render(<App />)

  const card = await screen.findByTestId('plan-card')
  await screen.findByText('Northside Lettings')
  expect(screen.getByTestId('plan-order-sch_1').textContent).toContain('£1,200.00 every month')
  expect(screen.getByTestId('plan-order-sch_2').textContent).toContain('£12.50 every week')
  expect(card.textContent).toContain('Waiting for your signature')
  const terms = screen.getByTestId('plan-terms').textContent
  expect(terms).toContain('No payment is more than £1,200.00.')
  expect(terms).toContain('At most £1,250.00 a month in all.')
  expect(terms).toContain('A payment above £1,000.00 always waits for your approval.')
  expect(terms).toContain('Paid only to Northside Lettings, Fibre Co, in GBP.')
  expect(sent).toHaveLength(0)

  fireEvent.click(screen.getByRole('button', { name: 'Sign with passkey' }))
  await screen.findByText(/Signed\. The orders are running/)
  expect(get).toHaveBeenCalledTimes(1)
  expect(sent).toEqual([{ url: '/api/money/assistant-requests/ar_plan/sign', body: { canonical: CANONICAL, assertion: expect.objectContaining({ credential_id: 'AQ', signature: 'BA' }) } }])
  expect(screen.getByTestId('plan-order-sch_1').textContent).toContain('Running')
  expect(screen.queryByRole('button', { name: 'Sign with passkey' })).toBeNull()
})
