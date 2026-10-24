import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B45.2 — a payment the assistant prepares in Chat (Lens's prepare_payment, through /api/chat/tools/call) is B40.9's card
// right in the conversation: payee, amount, why, the rule that asked, and Approve / Decline. Approve is the same passkey
// step as /approve/<id> and Lens pays once; Decline cancels and pays nothing; a decided card is a one-line receipt, also
// after a reload. The BFF and the model are mocked at the wire; that Lens pays once is Lens's, asserted on its ledger.

const sse = (...frames: unknown[]) => frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join('')
const ARGS = { payee_id: 'payee_1', currency: 'GBP', amount_minor: 12000, reference: 'INV-7' }
const PREPARES = sse(
  { type: 'message_start', message: { model: 'claude-opus-5', usage: { input_tokens: 100, output_tokens: 1 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_1', name: 'prepare_payment', input: {} } },
  { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(ARGS) } },
  { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 20 } },
  { type: 'message_stop' },
)
const SAYS = sse(
  { type: 'message_start', message: { model: 'claude-opus-5', usage: { input_tokens: 300, output_tokens: 1 } } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'I’ve prepared the payment to Acme Ltd for you to approve.' } },
  { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 30 } },
  { type: 'message_stop' },
)
const ITEM = { position: 1, payee_id: 'payee_1', payee_name: 'Acme Ltd', currency: 'GBP', amount_minor: 12000, reference: 'INV-7', decision: 'needs_approval',
  reason: 'above the £100.00 the mandate pays without asking', rule: 'requires_approval_above' }

function mockBff() {
  const sent: string[] = []
  let request: Record<string, unknown> = { id: 'preq_1', status: 'pending_approval', summary: '1 payment to Acme Ltd', client: 'chat', totals: { GBP: 12000 }, items: [ITEM], created_at: '2026-10-24T09:00:00Z' }
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/models') return json([{ id: 'claude-opus-5', provider: 'anthropic', display_name: 'Claude Opus 5', input_per_1m: 5, output_per_1m: 25, tier: 'frontier' }])
    if (url === '/api/ai/providers') return json({ unconfigured: [] })
    if (url === '/api/chat/tools')
      return json({ tools: [{ name: 'prepare_payment', description: 'Prepares one payment', input_schema: { type: 'object', properties: { payee_id: { type: 'string' } } }, product: 'lens' }] })
    if (url === '/api/chat/tools/call') {
      sent.push(`tool ${String(init?.body)}`)
      return json({ text: JSON.stringify(request), is_error: false })
    }
    if (url === '/api/ai/stream/anthropic/v1/messages') {
      const body = JSON.parse(String(init?.body)) as { messages: unknown[] }
      const reply = JSON.stringify(body.messages[body.messages.length - 1]).includes('tool_result') ? SAYS : PREPARES
      return new Response(reply, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
    }
    if (url === '/api/agents') return json({ workspace_balance_ulxc: 0, allocated_ulxc: 0, unallocated_ulxc: 0, spent_ulxc: 0, agents: [] })
    if (url === '/api/money/payees')
      return json({ payees: [{ id: 'payee_1', name: 'Acme Ltd', country: 'GB', check: 'exact_match', checked_by: 't', checked_at: '2026-10-01T09:00:00Z', needs_confirmation: false, created_at: '2026-10-01T09:00:00Z' }] })
    if (url === '/api/money/payments') return json({ payments: [] })
    if (url === '/api/money/payment-requests/preq_1') return json(request)
    if (url === '/api/money/payment-requests/preq_1/approval') {
      sent.push('approval')
      const items = [{ position: 1, payee_id: 'payee_1', payee_name: 'Acme Ltd', currency: 'GBP', amount_minor: 12000, reference: 'INV-7' }]
      const statement = JSON.stringify({ version: 'v1', request_id: 'preq_1', workspace_id: 'ws', payload_hash: 'h', items, totals: { GBP: 12000 }, expires_at: '2026-10-24T09:15:00Z' })
      return json({ statement, challenge: 'Y2gx', allow_credentials: ['Y3JlZDE'] })
    }
    if (url === '/api/money/payment-requests/preq_1/approve') {
      sent.push('approve')
      request = { ...request, status: 'approved', items: [{ ...ITEM, pay_status: 'completed' }] }
      return json(request)
    }
    if (url === '/api/money/payment-requests/preq_1/cancel') {
      sent.push('cancel')
      request = { ...request, status: 'cancelled' }
      return json(request)
    }
    return new Response('null', { status: 404 })
  })
  const get = vi.fn()
  Object.defineProperty(navigator, 'credentials', { value: { get, create: vi.fn() }, configurable: true })
  return { sent, get }
}

const ASSERTION = { rawId: new Uint8Array([1]).buffer, response: { clientDataJSON: new Uint8Array([2]).buffer, authenticatorData: new Uint8Array([3]).buffer, signature: new Uint8Array([4]).buffer } }

afterEach(() => {
  cleanup()
  queryClient.clear()
  vi.restoreAllMocks()
  window.localStorage.clear()
  window.history.pushState({}, '', '/')
})

async function prepareInChat() {
  window.history.pushState({}, '', '/chat')
  render(<App />)
  await screen.findByRole('button', { name: 'Model: Claude Opus 5' })
  fireEvent.change(await screen.findByPlaceholderText('Ask anything'), { target: { value: 'Settle the Acme invoice INV-7, £120' } })
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  return screen.findByTestId('approve-card', {}, { timeout: 5_000 })
}

describe('payment cards in the conversation (B45.2)', () => {
  it('shows a prepared payment inline, pays only after the passkey step, once, and keeps the receipt after a reload', async () => {
    const bff = mockBff()
    const card = await prepareInChat()
    expect(within(card).getByTestId('approve-item-1').textContent).toContain('Acme Ltd')
    expect(card.textContent).toContain('£120.00')
    expect(card.textContent).toContain('Reference: INV-7')
    expect(card.textContent).toContain('Asks for approval: above the £100.00 the mandate pays without asking.')
    expect(card.textContent).toContain('requires_approval_above')
    expect(within(card).getByRole('button', { name: 'Decline' })).toBeTruthy()
    expect(bff.sent).toEqual([`tool ${JSON.stringify({ name: 'prepare_payment', arguments: ARGS, confirmed: false })}`])

    // The person dismisses Face ID: nothing is approved, and the card still asks.
    bff.get.mockRejectedValueOnce(new DOMException('The operation was cancelled.', 'NotAllowedError'))
    fireEvent.click(within(card).getByRole('button', { name: 'Approve 1 payment with a passkey' }))
    await waitFor(() => expect(bff.get).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(within(card).getByRole('button', { name: 'Approve 1 payment with a passkey' }).hasAttribute('disabled')).toBe(false))
    expect(bff.sent.filter((s) => s === 'approve')).toHaveLength(0)

    bff.get.mockResolvedValueOnce(ASSERTION)
    fireEvent.click(within(card).getByRole('button', { name: 'Approve 1 payment with a passkey' }))
    const receipt = await screen.findByTestId('chat-pay-receipt')
    expect(receipt.textContent).toBe('Approved with your passkey: £120.00 to Acme Ltd.')
    expect(screen.queryByTestId('approve-card')).toBeNull()
    expect(bff.get).toHaveBeenCalledTimes(2)
    expect(bff.sent.filter((s) => s === 'approve')).toHaveLength(1)

    // Opened again: the conversation shows the receipt, not a card to approve again.
    cleanup()
    queryClient.clear()
    render(<App />)
    expect((await screen.findByTestId('chat-pay-receipt')).textContent).toBe('Approved with your passkey: £120.00 to Acme Ltd.')
    expect(screen.queryByRole('button', { name: /Approve/ })).toBeNull()
    expect(bff.sent.filter((s) => s === 'approve')).toHaveLength(1)
  })

  it('pays nothing when the person declines: the request is cancelled and the card becomes a receipt', async () => {
    const bff = mockBff()
    const card = await prepareInChat()
    fireEvent.click(within(card).getByRole('button', { name: 'Decline' }))
    const receipt = await screen.findByTestId('chat-pay-receipt')
    expect(receipt.textContent).toBe('Declined. Nothing was paid (£120.00 to Acme Ltd).')
    expect(bff.sent.slice(1)).toEqual(['cancel'])
    expect(bff.get).not.toHaveBeenCalled()
  })
})
