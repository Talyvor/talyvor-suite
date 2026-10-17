import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'
import { specBody } from './RoomSpec'

// B41.60 — a Docs page as the room's living spec. The mock BFF plays Lens's room and Docs: the owner attaches a page,
// whose text goes to the room as a spec message; the page is then edited in Docs, and asking the room's AI posts the
// edit to the room first, so the AI — whose context is the room's latest messages — reads the page's latest text.

const ME = 'ws_me'

function mockBff() {
  let seq = 1
  const messages: Record<string, unknown>[] = []
  const sent: { method: string; url: string; body: Record<string, unknown> }[] = []
  const page = { id: 'pg_1', title: 'Pricing spec', content_text: 'Charge per seat.', updated_at: '2026-10-17T09:00:00Z' }
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
    if (method !== 'GET') sent.push({ method, url, body })
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'oidc', authenticated: true, user: { sub: 'u1', email: 'u1@example.com' } })
    if (url === '/api/rooms') return json({ rooms: [], joined: [], invited: null })
    if (url === '/api/rooms/room_1') {
      const me = { workspace_id: ME, role: 'owner', may_spend: true, terms_version: 1, terms_current: true, joined_at: '' }
      return json({
        id: 'room_1', owner_workspace_id: ME, title: 'Agent pricing', topic: 'research', description: '', visibility: 'private',
        status: 'open', terms_version: 1, member_count: 1, created_at: '', last_activity_at: '',
        terms: { version: 1, split_rule: 'equal', remix_share_bps: 0, default_price_usd_micros: 0, spend_policy: 'owner_only', created_at: '' },
        members: [me], agents: null, me,
      })
    }
    if (url.startsWith('/api/rooms/room_1/messages')) {
      if (method === 'POST') {
        const m = { id: `m_${++seq}`, cursor: seq, room_id: 'room_1', author_workspace_id: ME, kind: 'text', body: body.body, refs: {}, created_at: '2026-10-17T10:00:00Z' }
        messages.push(m)
        return json(m, 201)
      }
      return json({ messages, more: false, events_cursor: seq })
    }
    if (url.startsWith('/api/rooms/room_1/events')) return new Response('', { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
    if (url === '/api/rooms/room_1/ask') {
      const m = { id: `m_${++seq}`, cursor: seq, room_id: 'room_1', author_workspace_id: ME, kind: 'run', body: `asked the room's AI: ${String(body.question)}\n\nTen dollars.`,
        refs: { run: 'ask', pay: 'self', payer_workspace_id: ME }, created_at: '2026-10-17T10:02:00Z' }
      messages.push(m)
      return json({ answer: 'Ten dollars.', pay: 'self', payer_workspace_id: ME, message: m })
    }
    if (url === '/api/docs/spaces') return json([{ id: 'sp_1', name: 'Product' }])
    if (url === '/api/docs/spaces/sp_1/pages') return json([{ id: 'pg_1', title: 'Pricing spec' }])
    if (url === '/api/docs/spaces/sp_1/pages/pg_1') return json(page)
    if (url === '/api/models') return json([{ id: 'gpt-4o-mini', provider: 'openai', display_name: 'GPT-4o mini', input_per_1m: 0, output_per_1m: 0 }])
    if (url.startsWith('/api/marketplace/listings')) return json({ listings: [] })
    return new Response('null', { status: 404 })
  })
  return { sent, page }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  queryClient.clear()
})

describe('the room’s spec', () => {
  it('puts an attached page’s text in the room, and an edit in Docs reaches the room before the room’s AI is asked', async () => {
    const bff = mockBff()
    window.history.pushState({}, '', '/rooms/room_1')
    render(<App />)
    const panel = await screen.findByTestId('room-spec')
    fireEvent.click(within(panel).getByRole('button', { name: 'Docs page' }))
    fireEvent.click(await within(panel).findByRole('button', { name: 'Pricing spec' }))

    const attached = specBody('Pricing spec', 'sp_1', 'pg_1', '2026-10-17T09:00:00Z', 'Charge per seat.', false)
    await waitFor(() => expect(bff.sent.filter((s) => s.url === '/api/rooms/room_1/messages').map((s) => s.body)).toEqual([{ body: attached }]))
    expect(await within(panel).findByText('Charge per seat.')).toBeTruthy()
    const list = await screen.findByRole('list', { name: 'Messages' })
    expect(within(list).getByTestId('spec-message').textContent).toContain('Attached the room’s spec: Pricing spec')

    // Edited in Docs; the next question carries it — the update is in the room before the ask.
    bff.page.content_text = 'Charge per seat, with a $10 floor.'
    bff.page.updated_at = '2026-10-17T10:01:00Z'
    fireEvent.change(screen.getByLabelText('Ask the room’s AI'), { target: { value: 'What is the floor?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
    expect((await screen.findByTestId('room-ai-answer')).textContent).toBe('Ten dollars.')

    const updated = specBody('Pricing spec', 'sp_1', 'pg_1', '2026-10-17T10:01:00Z', 'Charge per seat, with a $10 floor.', true)
    const writes = bff.sent.filter((s) => s.method === 'POST').map((s) => [s.url, s.body])
    expect(writes).toEqual([
      ['/api/rooms/room_1/messages', { body: attached }],
      ['/api/rooms/room_1/messages', { body: updated }],
      ['/api/rooms/room_1/ask', { question: 'What is the floor?', model: 'gpt-4o-mini', pay: 'self' }],
    ])
    expect(within(panel).getByText('Charge per seat, with a $10 floor.')).toBeTruthy()
    expect(within(list).getAllByTestId('spec-message').map((m) => m.textContent?.split('The page')[0])).toEqual([
      'Attached the room’s spec: Pricing spec',
      'Updated the room’s spec: Pricing spec',
    ])
  })
})
