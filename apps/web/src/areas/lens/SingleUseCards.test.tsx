import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentCardPanel } from './AgentCardPanel'
import { AppMoney } from './money'

// B28.49 — on an agent's card, the owner asks for a single-use card for one job (one merchant, capped), approves it, and
// sees where each card stands: waiting, ready for its one purchase, or used with what it spent.

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const AGENT = { id: 'agt_trip', name: 'Trips', kind: 'agent', balance_ulxc: 0, spent_ulxc: 0, keys: [], created_at: '2026-10-01T09:00:00Z', fiat_currency: 'GBP' }
const card = (over: Record<string, unknown> = {}) => ({
  id: 'mcard_1', line: 1, merchant: 'Rail Co', cap_minor: 4500, currency: 'GBP', status: 'awaiting_approval', spent_minor: 0, form_factor: 'virtual', ...over,
})
const batch = (over: Record<string, unknown> = {}, cards = [card()]) => ({
  id: 'mcb_1', workspace_id: 'ws_1', agent_id: 'agt_trip', idempotency_key: 'k', purpose: 'Book a train ticket', currency: 'GBP', funding: 'test',
  total_minor: 4500, status: 'awaiting_approval', cards, created_at: '2026-11-19T09:00:00Z', ...over,
})

let asked: { method: string; url: string; key: string; body: string }[]
let batches: ReturnType<typeof batch>[]

beforeEach(() => {
  asked = []
  batches = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const key = new Headers(init?.headers).get('Idempotency-Key') ?? ''
    asked.push({ method, url, key, body: String(init?.body ?? '') })
    const path = url.split('?')[0]
    if (path === '/api/money/cards' && method === 'POST') {
      const made = batch()
      batches = [made]
      return json(made, 201)
    }
    if (path === '/api/money/cards') return json({ batches })
    if (path === '/api/money/cards/mcb_1/approve') {
      batches = [batch({ status: 'issued', approved_by: 'usr_owner' }, [card({ status: 'active', last4: '4021', expires_at: '2026-11-20T09:00:00Z' })])]
      return json(batches[0])
    }
    if (path === '/api/money/card-disputes') return json({ card_disputes: [] })
    if (path === '/api/money/card-refunds') return json({ card_refunds: [] })
    return json({ error: 'not here' }, 404)
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function show() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <AppMoney>
          <AgentCardPanel agent={AGENT as never} />
        </AppMoney>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const words = (el: Element | null | undefined) => el?.textContent?.replace(/ /g, ' ')

describe('single-use cards on the agent’s card', () => {
  it('asks Lens for one capped card for one merchant, then approves it, and the card is ready for one purchase', async () => {
    show()
    const box = await screen.findByTestId('single-use-cards')
    fireEvent.change(within(box).getByLabelText('For'), { target: { value: 'Book a train ticket' } })
    fireEvent.change(within(box).getByLabelText('Merchant'), { target: { value: 'Rail Co' } })
    fireEvent.change(within(box).getByLabelText('Up to'), { target: { value: '45' } })
    fireEvent.click(within(box).getByRole('button', { name: 'Ask for a single-use card' }))

    const waiting = await within(box).findByTestId('single-use-card')
    expect(words(waiting)).toContain('Waiting for approval')
    const posted = asked.filter((a) => a.method === 'POST' && a.url === '/api/money/cards')
    expect(posted.map((a) => JSON.parse(a.body))).toEqual([
      { agent_id: 'agt_trip', purpose: 'Book a train ticket', currency: 'GBP', cards: [{ merchant: 'Rail Co', cap_minor: 4500 }] },
    ])
    expect(posted[0].key).not.toBe('')

    fireEvent.click(within(box).getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(words(within(box).getByTestId('single-use-card'))).toContain('Ready for one purchase'))
    expect(words(within(box).getByTestId('single-use-card'))).toContain('•••• 4021')
    expect(asked.filter((a) => a.url === '/api/money/cards/mcb_1/approve').map((a) => a.method)).toEqual(['POST'])
    expect(within(box).queryByRole('button', { name: 'Approve' })).toBeNull()
  })

  it('shows a used card with what its one purchase spent, and no Approve on an issued batch', async () => {
    batches = [batch({ status: 'issued' }, [card({ status: 'used', last4: '4021', spent_minor: 3870 })])]
    show()
    const line = await screen.findByTestId('single-use-card')
    await waitFor(() => expect(words(line)).toContain('Used · £38.70 spent'))
    expect(words(line)).toContain('£45.00')
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()
  })

  // B57.200 — drawn in Pocket as the card's "Disputes and refunds" rows are: the merchant is the row's title, where the
  // card stands and its number under it, and the most it may spend on the right; the ask form fills the dialog's width.
  it('draws each card as a Pocket row, its state under the merchant, and the ask form at the dialog’s width', async () => {
    batches = [batch({ status: 'issued' }, [card({ status: 'active', last4: '7310', expires_at: '2026-11-20T09:05:00Z', merchant: 'City Taxis' })])]
    show()
    const line = await screen.findByTestId('single-use-card')
    const title = await within(line).findByText('City Taxis')
    expect(words(title.closest('.font-semibold'))).toBe('City Taxis')
    const state = within(line).getByText('Ready for one purchase')
    expect(state.closest('.text-ink-3')?.textContent).toContain('•••• 7310')

    const form = screen.getByTestId('single-use-ask')
    for (const label of ['For', 'Merchant', 'Up to', 'Currency']) {
      expect(within(form).getByLabelText(label).closest('span')?.className ?? '').not.toMatch(/(^|\s)w-\d/)
    }
    const pair = within(form).getByLabelText('Up to').closest('.grid-cols-2')
    expect(pair).not.toBeNull()
    expect(pair?.contains(within(form).getByLabelText('Currency'))).toBe(true)
    expect(pair?.contains(within(form).getByLabelText('Merchant'))).toBe(false)
  })
})
