import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { WalletWebhooks } from './WalletWebhooks'

// B28.74 — Settings › Wallet webhooks, driven at the wire against a BFF that keeps what it is told (Lens B28.344): add,
// rotate and delete, the secret on screen only after add and rotate, each event sent with how it went, and Lens's
// refusal in its own words.

afterEach(() => vi.restoreAllMocks())

const TYPES = ['transfer.created', 'approval.requested', 'approval.decided', 'alert.limit', 'alert.unusual_spend', 'balance.low']

function mockBFF(events: unknown[] = []) {
  let hooks: Array<{ id: string; url: string; events: string[]; created_at: string }> = []
  const writes: Array<{ url: string; method: string; body: unknown }> = []
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } })
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null
    if (method !== 'GET') writes.push({ url, method, body })
    if (url === '/api/money/event-webhooks' && method === 'GET') return json({ webhooks: hooks, event_types: TYPES })
    if (url === '/api/money/event-webhooks/events') return json({ events })
    if (url === '/api/money/event-webhooks' && method === 'POST') {
      const { url: to, events: chosen } = body as { url: string; events: string[] }
      if (!to.startsWith('https://')) return json({ error: 'economy: webhook: the url must be https, on the public internet' }, 400)
      hooks = [{ id: 'wwh_1', url: to, events: chosen, created_at: '2026-11-28T10:00:00Z' }]
      return json({ ...hooks[0], secret: 'whsec_FIRST' }, 201)
    }
    if (url === '/api/money/event-webhooks/wwh_1/rotate') return json({ ...hooks[0], secret: 'whsec_SECOND' })
    if (url === '/api/money/event-webhooks/wwh_1' && method === 'DELETE') {
      hooks = []
      return json({ deleted: 'wwh_1' })
    }
    return json({ error: 'not found' }, 404)
  })
  return writes
}

function renderScreen() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <WalletWebhooks />
    </QueryClientProvider>,
  )
}

describe('Wallet webhooks settings', () => {
  it('adds, rotates and deletes a webhook, showing the secret only after add and rotate', async () => {
    const writes = mockBFF()
    renderScreen()
    await screen.findByText(/No webhooks yet/)
    expect(screen.queryByText(/whsec_/)).toBeNull()

    fireEvent.change(screen.getByRole('textbox', { name: 'Webhook URL' }), { target: { value: 'https://hooks.example.com/w' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'transfer.created', checked: false }))
    fireEvent.click(screen.getByRole('button', { name: 'Add webhook' }))
    expect(await screen.findByText('whsec_FIRST')).toBeInTheDocument()
    expect(writes[0]).toEqual({ url: '/api/money/event-webhooks', method: 'POST', body: { url: 'https://hooks.example.com/w', events: ['transfer.created'] } })
    const row = await screen.findByText('https://hooks.example.com/w')
    expect(within(row.closest('li')!).getByText(/transfer\.created/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'I’ve saved it' }))
    expect(screen.queryByText(/whsec_/)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Rotate secret for https://hooks.example.com/w' }))
    expect(await screen.findByText('whsec_SECOND')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'I’ve saved it' }))

    fireEvent.click(screen.getByRole('button', { name: 'Delete https://hooks.example.com/w' }))
    await screen.findByText(/No webhooks yet/)
    expect(writes.map((w) => `${w.method} ${w.url}`)).toEqual([
      'POST /api/money/event-webhooks',
      'POST /api/money/event-webhooks/wwh_1/rotate',
      'DELETE /api/money/event-webhooks/wwh_1',
    ])
  })

  it('lists each event sent: a delivered transfer, and a failed one with the server’s last answer', async () => {
    mockBFF([
      { id: 'msg_2', webhook_id: 'wwh_9', type: 'balance.low', ref: 'lba_1', occurred_at: '2026-11-28T11:00:00Z', status: 'failed', attempts: 8, last_error: 'answered 500', created_at: '2026-11-28T11:00:00Z' },
      { id: 'msg_1', webhook_id: 'wwh_9', type: 'transfer.created', ref: 'atr_1', occurred_at: '2026-11-28T10:30:00Z', status: 'delivered', attempts: 1, delivered_at: '2026-11-28T10:31:00Z', created_at: '2026-11-28T10:30:00Z' },
    ])
    renderScreen()
    const transfer = (await screen.findByText('A transfer')).closest('li')!
    expect(within(transfer).getByText('Delivered')).toBeInTheDocument()
    expect(within(transfer).getByText('atr_1')).toBeInTheDocument()
    expect(within(transfer).getByText('attempt', { exact: false })).toHaveTextContent('1 attempt')
    const low = screen.getByText('A low balance').closest('li')!
    expect(within(low).getByText('Failed')).toBeInTheDocument()
    expect(within(low).getByText('Last answer: answered 500')).toBeInTheDocument()
  })

  // B57.230 — Pocket's w-docs-webhooks: each event is a pick that ticks, and Add webhook, waiting for a URL, says so beside it.
  it('draws the events as picks that tick, and says why Add webhook waits', async () => {
    mockBFF()
    renderScreen()
    await screen.findByText(/No webhooks yet/)
    const events = screen.getByRole('group', { name: 'Events, none chosen sends every one' })
    expect(within(events).getAllByRole('checkbox').map((c) => c.textContent)).toEqual(TYPES)
    const add = screen.getByRole('button', { name: 'Add webhook' })
    expect(add).toBeDisabled()
    expect(add).toHaveAccessibleDescription('Type your server’s https URL to add it.')
    fireEvent.change(screen.getByRole('textbox', { name: 'Webhook URL' }), { target: { value: 'https://hooks.example.com/w' } })
    expect(add).toBeEnabled()
    expect(add).not.toHaveAccessibleDescription()
    const pick = within(events).getByRole('checkbox', { name: 'balance.low' })
    fireEvent.click(pick)
    expect(pick).toHaveAttribute('aria-checked', 'true')
  })

  it('shows Lens’s refusal of an address it will not send to, and adds nothing', async () => {
    mockBFF()
    renderScreen()
    await screen.findByText(/No webhooks yet/)
    fireEvent.change(screen.getByRole('textbox', { name: 'Webhook URL' }), { target: { value: 'http://hooks.example.com/w' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add webhook' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Webhook: the url must be https, on the public internet.')
    expect(screen.getByText(/No webhooks yet/)).toBeInTheDocument()
  })
})
