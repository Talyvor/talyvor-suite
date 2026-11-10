import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'
import { pressEverything } from '../../test/pressEverything'

// B30.97 — the pay page, signed out: it shows the invoice as Lens serves it with no test-money label (B46.2), the card button asks
// the BFF's public route for the checkout and sends the browser there, and back with ?paid=card it reads again until paid.

const TOKEN = '0123456789abcdef0123456789abcdef0123456789abcdef'

function mockBff(labels?: Record<string, string>) {
  let status: 'sent' | 'paid' = 'sent'
  let cardCalls = 0
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const json = (v: unknown, code = 200) => new Response(JSON.stringify(v), { status: code, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'oidc', authenticated: false, user: null })
    if (url === '/api/agents') return json({ error: 'sign in' }, 401)
    if (url === '/api/pricing' && labels) return json({ min_usd_cents: 1000, max_usd_cents: 1_000_000, preset_usd_cents: [1000], labels })
    if (url === `/api/public/pay/${TOKEN}/card` && init?.method === 'POST') {
      cardCalls += 1
      return json({ url: 'https://checkout.stripe.com/c/pay/cs_test_1' }, 201)
    }
    if (url === `/api/public/pay/${TOKEN}`) {
      const paid = status === 'paid'
      return json({
        notice: 'Preview — test money only. Nothing paid here moves real money.',
        card: !paid,
        ...(paid ? {} : { transfer: { details: { holder: 'Fixture Ltd', currency: 'GBP', sort_code: '040004', account_number: '12345678' }, mode: 'TEST', reference: 'TLV-AGT a1b2c3' } }),
        invoice: { id: 'inv_1', issuer: 'Fixture Ltd', number: 'INV-000001', reference: 'a1b2c3', currency: 'GBP', customer_name: 'Acme',
          lines: [{ description: 'Research', quantity: 2, unit_amount_minor: 5000, vat_rate_bps: 2000, net_minor: 10000, vat_minor: 2000 }],
          subtotal_minor: 10000, vat_minor: 2000, total_minor: 12000, paid_minor: paid ? 12000 : 0, due_minor: paid ? 0 : 12000, due_date: '2026-12-31',
          remind_days_before: 0, status, created_at: '2026-10-11T09:00:00Z', ...(paid ? { paid_at: '2026-10-11T10:00:00Z', payments: [{ entry_id: 'e1', method: 'card', amount_minor: 12000, paid_at: '2026-10-11T10:00:00Z' }] } : {}) },
      })
    }
    return json({ error: 'not found' }, 404)
  })
  return { pay: () => (status = 'paid'), cards: () => cardCalls }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  queryClient.clear()
})

describe('the pay page', () => {
  it('shows the invoice with no test-money label, sends the payer to the checkout Lens opened, and reads paid on return', async () => {
    const bff = mockBff()
    const assign = vi.fn()
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, assign, pathname: `/pay/${TOKEN}`, search: '' } as Location)
    window.history.pushState({}, '', `/pay/${TOKEN}`)
    const view = render(<App />)

    // B57.63 — the reference's s-pay-invoice: the page says what it is for, and the invoice card says who is asking,
    // how much in its currency, by when, and its lines.
    expect((await screen.findByTestId('pay-headline')).textContent).toBe('Pay an invoice')
    const invoice = screen.getByTestId('pay-invoice')
    expect(within(invoice).getByText('Fixture Ltd')).toBeInTheDocument()
    expect(within(invoice).getByTestId('pay-amount').textContent).toBe('£120.00')
    expect(within(invoice).getByText(/^Due/, { selector: 'p' }).textContent).toBe('Due 31 December 2026')
    expect(within(invoice).getByRole('cell', { name: 'Research' })).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/test money/i)
    expect(screen.getByTestId('pay-due').textContent).toBe('£120.00')
    expect(screen.queryByTestId('pay-reference')).toBeNull() // the Test partner's details are not shown (B49.2)
    expect(await screen.findByRole('link', { name: 'Sign in' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Pay £120.00 by card' }))
    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/cs_test_1'))
    expect(bff.cards()).toBe(1)

    // Back from Stripe: the invoice is paid, and the page says so with the card payment.
    bff.pay()
    view.unmount()
    queryClient.clear()
    window.history.pushState({}, '', `/pay/${TOKEN}?paid=card`)
    render(<App />)
    expect((await screen.findByTestId('pay-headline')).textContent).toBe('Paid, thank you')
    expect(screen.getByTestId('pay-paid').textContent).toContain('£120.00 by card')
    expect(screen.queryByRole('button', { name: /by card/ })).toBeNull()
  })
})

// B56.10 — Lens's label for money paid in from outside Talyvor, as /api/pricing serves it; B57.63 draws it beside Pay by card.
describe('the pay page label', () => {
  it.each([
    ['sandbox', 'Sandbox'],
    ['live', 'Live'],
  ])('draws %s beside Pay by card when Lens labels payments in %s', async (served, drawn) => {
    mockBff({ payments_in: served })
    window.history.pushState({}, '', `/pay/${TOKEN}`)
    render(<App />)
    const heading = await screen.findByRole('heading', { level: 2, name: 'Pay by card' })
    const label = await vi.waitFor(() => {
      const el = heading.parentElement!.querySelector('[data-status-label]')
      expect(el).not.toBeNull()
      return el!
    })
    expect(label.getAttribute('data-status-key')).toBe('payments_in')
    expect(label.textContent).toBe(drawn)
  })
})

// B57.63 — the pay page is drawn in Pocket, and every control on it does something.
describe('the pay page in Pocket', () => {
  it('is held to Pocket’s rules, and every control on it does something', async () => {
    mockBff()
    window.history.pushState({}, '', `/pay/${TOKEN}`)
    const { container } = render(<App />)
    await screen.findByTestId('pay-invoice')
    expect(container.querySelector('main')?.closest('[data-design]')?.getAttribute('data-design')).toBe('pocket')
    cleanup()
    vi.restoreAllMocks()
    const report = await pressEverything('/pay/:token')
    expect(report.dead).toEqual([])
    expect(report.pressed).toBeGreaterThan(5)
  })
})
