import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B40.9 — the approval link opens one card with each item and the total; unticking an item approves only the others, and
// the passkey signs Lens's statement only when it names exactly the payments still ticked.

const ITEMS = [
  { position: 1, payee_id: 'payee_1', payee_name: 'Acme Ltd', currency: 'GBP', amount_minor: 12000, reference: 'INV-7', decision: 'needs_approval', reason: 'above the £100.00 the mandate pays without asking', rule: 'requires_approval_above' },
  { position: 2, payee_id: 'payee_2', payee_name: 'Brightline Studio', currency: 'GBP', amount_minor: 4550, reference: 'May', decision: 'needs_approval', reason: 'no permission mandate the person signed covers this payment' },
  { position: 3, payee_id: 'payee_3', payee_name: 'Shady Co', currency: 'GBP', amount_minor: 900, reference: 'X', decision: 'blocked', reason: "the agent's rules block this payee", rule: 'payee' },
]

function mockBff(lie = false) {
  const sent: Array<{ url: string; body: Record<string, unknown> }> = []
  let request: Record<string, unknown> = { id: 'preq_1', status: 'pending_approval', summary: '3 payments for Researcher', client: 'mcp:tlv_oc_claude', agent_id: 'agt_1',
    totals: { GBP: 17450 }, items: ITEMS, created_at: '2026-10-23T09:00:00Z' }
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/agents') return json({ workspace_balance_ulxc: 0, allocated_ulxc: 0, unallocated_ulxc: 0, spent_ulxc: 0, agents: [{ id: 'agt_1', name: 'Researcher', balance_ulxc: 0, spent_ulxc: 0, keys: [], created_at: '2026-10-10T09:00:00Z' }] })
    if (url === '/api/money/payees') return json({ payees: [
      { id: 'payee_1', name: 'Acme Ltd', country: 'GB', check: 'exact_match', checked_by: 't', checked_at: '2026-10-01T09:00:00Z', needs_confirmation: false, created_at: '2026-10-01T09:00:00Z' },
      { id: 'payee_2', name: 'Brightline Studio', country: 'GB', check: 'close_match', checked_by: 't', checked_at: '2026-10-22T09:00:00Z', needs_confirmation: true, created_at: '2026-10-22T09:00:00Z' },
    ] })
    if (url === '/api/money/payments') return json({ payments: [{ id: 'mpay_0', account_id: 'macc_agt', payee_id: 'payee_1', payee_name: 'Acme Ltd', amount_minor: 100, currency: 'GBP', funding: 'test', reference: 'Apr', idempotency_key: 'k', status: 'completed', created_at: '2026-10-02T09:00:00Z', updated_at: '2026-10-02T09:00:00Z' }] })
    if (url === '/api/money/payment-requests/preq_1') return json(request)
    if (url === '/api/money/payment-requests/preq_1/approval') {
      const body = JSON.parse(String(init?.body)) as { positions: number[] }
      sent.push({ url, body })
      const items = ITEMS.filter((it) => (lie ? [1, 2] : body.positions).includes(it.position))
        .map(({ position, payee_id, payee_name, currency, amount_minor, reference }) => ({ position, payee_id, payee_name, currency, amount_minor, reference }))
      const statement = JSON.stringify({ version: 'v1', request_id: 'preq_1', workspace_id: 'ws', payload_hash: 'h', items, totals: { GBP: 12000 }, expires_at: '2026-10-23T09:15:00Z' })
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
    expect(card.textContent).toContain('Test money')
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

    await screen.findByTestId('approve-card')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Approve £45.50 to Brightline Studio' }))
    fireEvent.click(screen.getByRole('button', { name: 'Approve 1 payment with a passkey' }))
    await screen.findByText('What you were asked to sign is not what is shown here, so nothing was signed. Reload the page.')
    expect(bff.get).not.toHaveBeenCalled()
    expect(bff.sent.map((x) => x.url)).toEqual(['/api/money/payment-requests/preq_1/approval'])
  })
})
