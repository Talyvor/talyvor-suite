import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B30.97 — the Invoices screen: an invoice issued from an agent's account with "Create and send" goes to the BFF with the
// lines the form holds, in minor units and basis points, and the row then reads Sent with its pay link.

let ACCOUNTS: Record<string, unknown>[] = [
  { id: 'macc_co', agent_id: '', currency: 'GBP', purpose: 'company', status: 'open', name: 'GBP account', balance_minor: 0, test_minor: 0, live_minor: 0 },
  { id: 'macc_agt', agent_id: 'agt_1', currency: 'GBP', purpose: 'agent', status: 'open', name: 'GBP account', balance_minor: 0, test_minor: 0, live_minor: 0 },
]

function mockBff(invoices: Array<Record<string, unknown>> = [], accounts: Array<Record<string, unknown>> = ACCOUNTS) {
  const sent: Array<{ url: string; body: unknown }> = []
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/money/accounts') return json({ accounts })
    if (url === '/api/agents') return json({ workspace_balance_ulxc: 0, allocated_ulxc: 0, unallocated_ulxc: 0, spent_ulxc: 0, agents: [{ id: 'agt_1', name: 'Researcher', balance_ulxc: 0, spent_ulxc: 0, keys: [], created_at: '2026-10-10T09:00:00Z' },
      { id: 'agt_2', name: 'Research', balance_ulxc: 0, spent_ulxc: 0, keys: [], created_at: '2026-10-10T09:00:00Z' }] })
    if (url === '/api/wallets/capabilities') return json({ capabilities: [{ capability: 'payments_in', name: 'Money in', class: 'RED', real_money: false, level_needed: 'L2' }] })
    if (url === '/api/money/invoices' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { lines: { quantity: number; unit_amount_minor: number; vat_rate_bps: number }[]; send: boolean }
      sent.push({ url, body })
      const net = body.lines.reduce((s, l) => s + l.quantity * l.unit_amount_minor, 0)
      const vat = body.lines.reduce((s, l) => s + Math.round((l.quantity * l.unit_amount_minor * l.vat_rate_bps) / 10000), 0)
      const inv = { id: 'inv_1', issuer: 'Fixture Ltd', number: 'INV-000001', reference: 'a1b2c3d4e5f6', pay_url: 'https://app.talyvor.com/pay/0123456789abcdef0123456789abcdef0123456789abcdef',
        currency: 'GBP', customer_name: 'Acme', lines: body.lines, subtotal_minor: net, vat_minor: vat, total_minor: net + vat, paid_minor: 0, due_minor: net + vat,
        due_date: '2026-12-31', remind_days_before: 0, status: body.send ? 'sent' : 'draft', created_at: '2026-10-11T09:00:00Z' }
      invoices.unshift(inv)
      return json(inv, 201)
    }
    const voided = /^\/api\/money\/invoices\/([^/]+)\/void$/.exec(url)
    if (voided && init?.method === 'POST') {
      sent.push({ url, body: null })
      const inv = invoices.find((i) => i.id === voided[1])!
      inv.status = 'void'
      return json(inv)
    }
    if (url === '/api/money/invoices') return json({ invoices })
    return json({ error: 'not found' }, 404)
  })
  return { sent }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  queryClient.clear()
})

describe('the Invoices screen', () => {
  it('issues an invoice from the agent’s account with its lines in minor units, and the row reads Sent with its pay link', async () => {
    const bff = mockBff()
    window.history.pushState({}, '', '/money/invoices')
    render(<App />)

    const form = await screen.findByTestId('new-invoice')
    expect(screen.queryByTestId('invoices-preview')).toBeNull()
    expect(document.body.textContent).not.toMatch(/test money/i)
    expect(screen.getByText('No invoice issued yet: create one above, and it appears here when it is issued.')).toBeTruthy()
    fireEvent.change(within(form).getByLabelText('Paid into'), { target: { value: 'macc_agt' } })
    fireEvent.change(within(form).getByLabelText('Customer'), { target: { value: 'Acme' } })
    fireEvent.change(within(form).getByLabelText('Line 1: description'), { target: { value: 'Research' } })
    fireEvent.change(within(form).getByLabelText('Line 1: quantity'), { target: { value: '2' } })
    fireEvent.change(within(form).getByLabelText('Line 1: unit price in GBP'), { target: { value: '50.00' } })
    fireEvent.change(within(form).getByLabelText('Line 1: VAT %'), { target: { value: '20' } })
    expect(within(form).getByTestId('new-invoice-total').textContent).toBe('£120.00')
    fireEvent.click(within(form).getByRole('button', { name: 'Create and send' }))

    const row = await screen.findByTestId('invoice-INV-000001')
    expect(bff.sent).toHaveLength(1)
    expect(bff.sent[0].body).toMatchObject({ account_id: 'macc_agt', customer_name: 'Acme', send: true, due_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) as string,
      lines: [{ description: 'Research', quantity: 2, unit_amount_minor: 5000, vat_rate_bps: 2000 }] })
    expect(within(row).getByText('Sent')).toBeTruthy()
    expect(within(row).getByText('£120.00')).toBeTruthy()
    expect((within(row).getByTestId('pay-link') as HTMLInputElement).value).toBe('https://app.talyvor.com/pay/0123456789abcdef0123456789abcdef0123456789abcdef')
    expect(screen.getByTestId('invoices-count').textContent).toBe('1 invoice, 0 paid')
  })

  // B55.41 — voiding cannot be undone, so the Void button asks first: Keep it voids nothing, Void it voids once.
  it('asks before voiding an invoice, and voids it once only on Void it', async () => {
    const bff = mockBff([{ id: 'inv_9', issuer: 'Fixture Ltd', number: 'INV-000009', reference: 'ref9', currency: 'GBP', customer_name: 'Acme', lines: [],
      subtotal_minor: 1000, vat_minor: 0, total_minor: 1000, paid_minor: 0, due_minor: 1000, due_date: '2026-12-31', remind_days_before: 0, status: 'sent', created_at: '2026-10-11T09:00:00Z' }])
    window.history.pushState({}, '', '/money/invoices')
    render(<App />)
    const row = await screen.findByTestId('invoice-INV-000009')

    fireEvent.click(within(row).getByRole('button', { name: 'Void' }))
    expect(within(row).getByText('Void invoice INV-000009? Acme can no longer pay it, and this cannot be undone.')).toBeTruthy()
    fireEvent.click(within(row).getByRole('button', { name: 'Keep it' }))
    expect(within(row).queryByText(/cannot be undone/)).toBeNull()
    expect(bff.sent).toHaveLength(0)

    fireEvent.click(within(row).getByRole('button', { name: 'Void' }))
    fireEvent.click(within(row).getByRole('button', { name: 'Void it' }))
    await waitFor(() => expect(bff.sent.map((s) => s.url)).toEqual(['/api/money/invoices/inv_9/void']))
    await waitFor(() => expect(within(screen.getByTestId('invoice-INV-000009')).queryByRole('button', { name: 'Void' })).toBeNull())
    expect(bff.sent).toHaveLength(1)
  })

  // B54.31 — Lens's balance_minor is test plus live, so only live_minor is the account's balance.
  it('shows each account’s live balance, never its test figure', async () => {
    mockBff([], [{ ...ACCOUNTS[0], balance_minor: 150, test_minor: 150, live_minor: 0 }])
    window.history.pushState({}, '', '/money/invoices')
    render(<App />)

    const list = await screen.findByRole('list', { name: 'Currency accounts' })
    expect(list.textContent).toContain('£0.00')
    expect(list.textContent).not.toContain('1.50')
  })

  // B57.25 — each account on Invoices opens its statement, in its own currency.
  it('links each account to its statement', async () => {
    mockBff()
    window.history.pushState({}, '', '/money/invoices')
    render(<App />)
    const list = await screen.findByRole('list', { name: 'Currency accounts' })
    const links = await within(list).findAllByRole('link')
    expect(links.map((l) => [l.textContent, l.getAttribute('href')])).toEqual([
      ['The company · GBP', '/statements?wallet=macc_co'],
      [expect.stringMatching(/ · GBP$/), '/statements?wallet=macc_agt'],
    ])
  })

  // B55.26 — Lens opens every crypto agent a USDC wallet: Intl refused the code and the whole screen with it.
  it('draws with an agent’s USDC wallet, lists it to six decimals, and never offers it as Paid into', async () => {
    const before = ACCOUNTS
    ACCOUNTS = [
      { id: 'macc_co', agent_id: '', currency: 'USD', purpose: 'company', status: 'open', name: 'USD account', balance_minor: 0, test_minor: 0, live_minor: 0 },
      { id: 'macc_usd', agent_id: 'agt_1', currency: 'USD', purpose: 'agent', status: 'open', name: 'USD account', balance_minor: 0, test_minor: 0, live_minor: 0 },
      { id: 'macc_usdc', agent_id: 'agt_2', currency: 'USDC', purpose: 'agent', status: 'open', name: 'USDC wallet', balance_minor: 1500000, test_minor: 0, live_minor: 1500000 },
    ]
    try {
      mockBff()
      window.history.pushState({}, '', '/money/invoices')
      render(<App />)
      const form = await screen.findByTestId('new-invoice')
      const rows = () => within(screen.getByRole('list', { name: 'Currency accounts' })).getAllByRole('listitem').map((li) => [...li.children].map((c) => c.textContent))
      await waitFor(() => expect(rows()).toContainEqual(['Research · USDC', '1.50 USDC']))
      const paidInto = within(form).getByLabelText('Paid into') as HTMLSelectElement
      expect([...paidInto.options].map((o) => o.value)).toEqual(['macc_usd'])
    } finally {
      ACCOUNTS = before
    }
  })
})
