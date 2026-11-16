import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B30.97 — the Invoices screen: an invoice issued from an agent's account with "Create and send" goes to the BFF with the
// lines the form holds, in minor units and basis points, and the row then reads Sent with Copy link and Void.
// B57.33 — drawn in Pocket: Issued beside Accounts, New invoice in a dialog with More details, Void asks first in a dialog.

const ACCOUNTS: Record<string, unknown>[] = [
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
      const body = JSON.parse(String(init.body)) as { account_id: string; lines: { quantity: number; unit_amount_minor: number; vat_rate_bps: number }[]; send: boolean }
      sent.push({ url, body })
      const net = body.lines.reduce((s, l) => s + l.quantity * l.unit_amount_minor, 0)
      const vat = body.lines.reduce((s, l) => s + Math.round((l.quantity * l.unit_amount_minor * l.vat_rate_bps) / 10000), 0)
      const inv = { id: 'inv_1', agent_id: 'agt_1', account_id: body.account_id, issuer: 'Fixture Ltd', number: 'INV-000001', reference: 'a1b2c3d4e5f6', pay_url: 'https://app.talyvor.com/pay/0123456789abcdef0123456789abcdef0123456789abcdef',
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

const open = async () => {
  window.history.pushState({}, '', '/money/invoices')
  render(<App />)
  return screen.findByRole('list', { name: 'Currency accounts' })
}

describe('the Invoices screen', () => {
  it('issues an invoice from New invoice’s dialog with its lines in minor units, and the row reads Sent with Copy link and Void', async () => {
    const bff = mockBff()
    await open()

    expect(document.body.textContent).not.toMatch(/test money/i)
    expect(screen.getByText('No invoice issued yet')).toBeTruthy()
    // The form is not on the page: New invoice opens it in a dialog.
    expect(screen.queryByTestId('new-invoice')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'New invoice' }))
    const dialog = await screen.findByRole('dialog', { name: 'New invoice' })

    // The main fields only, then More details for the rest.
    expect(within(dialog).queryByLabelText('Customer’s VAT number')).toBeNull()
    expect((within(dialog).getByLabelText('Due on') as HTMLInputElement).value).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    fireEvent.change(within(dialog).getByLabelText('Paid into'), { target: { value: 'macc_agt' } })
    fireEvent.change(within(dialog).getByLabelText('Customer’s name'), { target: { value: 'Acme' } })
    fireEvent.change(within(dialog).getByLabelText('What for'), { target: { value: 'Research' } })
    fireEvent.change(within(dialog).getByLabelText('Amount'), { target: { value: '50.00' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'More details' }))
    for (const label of ['Customer’s VAT number', 'Your VAT number', 'Customer’s address', 'Remind this many days before (0: none)', 'A note on the invoice'])
      expect(within(dialog).getByLabelText(label)).toBeTruthy()
    fireEvent.change(within(dialog).getByLabelText('Quantity'), { target: { value: '2' } })
    fireEvent.change(within(dialog).getByLabelText('VAT'), { target: { value: '20' } })
    fireEvent.change(within(dialog).getByLabelText('Customer’s VAT number'), { target: { value: 'GB123' } })
    expect(within(dialog).getByTestId('new-invoice-total').textContent).toBe('£120.00')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create and send' }))

    const row = await screen.findByTestId('invoice-INV-000001')
    expect(bff.sent).toHaveLength(1)
    expect(bff.sent[0].body).toMatchObject({ account_id: 'macc_agt', customer_name: 'Acme', customer_vat_number: 'GB123', send: true, due_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) as string,
      lines: [{ description: 'Research', quantity: 2, unit_amount_minor: 5000, vat_rate_bps: 2000 }] })
    expect(screen.queryByRole('dialog', { name: 'New invoice' })).toBeNull()
    expect(within(row).getByText('Sent')).toBeTruthy()
    expect(within(row).getByText('£120.00')).toBeTruthy()
    expect(within(row).getByText('Due 31 Dec · paid into Researcher · GBP')).toBeTruthy()
    expect(within(row).getByRole('button', { name: 'Copy link' })).toBeTruthy()
    expect(within(row).getByRole('button', { name: 'Void' })).toBeTruthy()
  })

  // B55.41 — voiding cannot be undone, so Void asks first in a dialog: Keep it voids nothing, Void it voids once.
  it('asks before voiding an invoice, and voids it once only on Void it', async () => {
    const bff = mockBff([{ id: 'inv_9', issuer: 'Fixture Ltd', number: 'INV-000009', reference: 'ref9', currency: 'GBP', customer_name: 'Orbit Studio', lines: [],
      subtotal_minor: 1000, vat_minor: 0, total_minor: 1000, paid_minor: 0, due_minor: 1000, due_date: '2026-12-31', remind_days_before: 0, status: 'sent', created_at: '2026-10-11T09:00:00Z' }])
    await open()
    const row = await screen.findByTestId('invoice-INV-000009')

    fireEvent.click(within(row).getByRole('button', { name: 'Void' }))
    const ask = await screen.findByRole('dialog', { name: 'Void invoice INV-000009?' })
    expect(within(ask).getByText('Orbit Studio can no longer pay it, and this cannot be undone.')).toBeTruthy()
    fireEvent.click(within(ask).getByRole('button', { name: 'Keep it' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(bff.sent).toHaveLength(0)

    fireEvent.click(within(row).getByRole('button', { name: 'Void' }))
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Void invoice INV-000009?' })).getByRole('button', { name: 'Void it' }))
    await waitFor(() => expect(bff.sent.map((s) => s.url)).toEqual(['/api/money/invoices/inv_9/void']))
    await waitFor(() => expect(within(screen.getByTestId('invoice-INV-000009')).getByText('Void')).toBeTruthy())
    expect(within(screen.getByTestId('invoice-INV-000009')).queryByRole('button', { name: 'Void' })).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(bff.sent).toHaveLength(1)
  })

  // B54.31 — Lens's balance_minor is test plus live, so only live_minor is the account's balance.
  it('shows each account’s live balance, never its test figure', async () => {
    mockBff([], [{ ...ACCOUNTS[0], balance_minor: 150, test_minor: 150, live_minor: 0 }])
    const list = await open()
    expect(list.textContent).toContain('£0.00')
    expect(list.textContent).not.toContain('1.50')
  })

  // B57.25 — each account on Invoices opens its statement, in its own currency.
  it('links each account to its statement', async () => {
    mockBff()
    const list = await open()
    await waitFor(() =>
      expect(within(list).getAllByRole('link').map((l) => [l.textContent, l.getAttribute('href')])).toEqual([
        ['Company · GBP£0.00', '/statements?wallet=macc_co'],
        ['Researcher · GBP£0.00', '/statements?wallet=macc_agt'],
      ]),
    )
  })

  // B55.26 — Lens opens every crypto agent a USDC wallet: Intl refused the code and the whole screen with it.
  it('draws with an agent’s USDC wallet, lists it to six decimals, and never offers it as Paid into', async () => {
    mockBff([], [
      { id: 'macc_co', agent_id: '', currency: 'USD', purpose: 'company', status: 'open', name: 'USD account', balance_minor: 0, test_minor: 0, live_minor: 0 },
      { id: 'macc_usd', agent_id: 'agt_1', currency: 'USD', purpose: 'agent', status: 'open', name: 'USD account', balance_minor: 0, test_minor: 0, live_minor: 0 },
      { id: 'macc_usdc', agent_id: 'agt_2', currency: 'USDC', purpose: 'agent', status: 'open', name: 'USDC wallet', balance_minor: 1500000, test_minor: 0, live_minor: 1500000 },
    ])
    const list = await open()
    await waitFor(() => expect(within(list).getAllByRole('link').map((l) => l.textContent)).toContain('Research · USDC1.50 USDC'))
    fireEvent.click(screen.getByRole('button', { name: 'New invoice' }))
    const dialog = await screen.findByRole('dialog', { name: 'New invoice' })
    const paidInto = within(dialog).getByLabelText('Paid into') as HTMLSelectElement
    expect([...paidInto.options].map((o) => o.value)).toEqual(['macc_usd'])
  })
})
