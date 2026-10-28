import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from './App'
import { Markdown } from './areas/chat/Markdown'

// B50.6 — text from people, agents, models, files and partners is shown as text wherever the app shows it: a payload
// set goes through a chat answer, a file name, a payee name, a merchant name and a Room message, and nothing in it
// runs, loads or links anywhere. (The app has no link previews.)

const PAYLOAD = [
  '<img src=x onerror="window.__xss=1">',
  '<script>window.__xss=1</script>',
  '"><svg onload="window.__xss=1">',
  '<iframe srcdoc="<script>window.__xss=1</script>"></iframe>',
  '<a href="javascript:window.__xss=1">here</a>',
  '[click](javascript:top.xss=1)',
].join(' ')

declare global {
  interface Window {
    __xss?: number
  }
}

function assertInert(root: HTMLElement) {
  expect(root.textContent).toContain('onerror=') // the payload is on screen, as text
  expect(root.querySelectorAll('script, iframe, object, embed').length).toBe(0)
  for (const el of Array.from(root.querySelectorAll('*'))) {
    for (const { name, value } of Array.from(el.attributes)) {
      expect(name, `${el.tagName} carries a handler`).not.toMatch(/^on/i)
      if (/^(href|src|action|formaction|xlink:href)$/i.test(name)) {
        expect(value, `${el.tagName} ${name}`).not.toMatch(/^\s*(javascript|vbscript|data:text\/html)/i)
      }
    }
  }
  expect(window.__xss).toBeUndefined()
}

const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })

function mockBff(routes: Record<string, unknown>) {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input).split('?')[0]
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url in routes) return json(routes[url])
    if (url === '/api/rooms/room_1/events') {
      return new Response(new ReadableStream({ start: (c) => c.enqueue(new TextEncoder().encode('retry: 1000\n\n')) }), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    }
    return new Response('null', { status: 404 })
  })
}

afterEach(() => {
  cleanup()
  queryClient.clear()
  vi.restoreAllMocks()
  window.history.pushState({}, '', '/')
})

describe('untrusted text is only ever text', () => {
  it('in a chat answer', () => {
    const { container } = render(<Markdown source={`**${PAYLOAD}**\n\n- ${PAYLOAD}\n\n> ${PAYLOAD}\n\n[click](javascript:top.xss=1) <javascript:top.xss=1>`} />)
    assertInert(container)
  })

  it('in a file name', async () => {
    mockBff({
      '/api/documents': {
        documents: [{ id: 'tdoc_1', media_type: 'application/pdf', filename: PAYLOAD, size_bytes: 10, uploaded_at: '2026-10-07T09:00:00Z' }],
      },
    })
    window.history.pushState({}, '', '/chat/files')
    const { container } = render(<App />)
    const list = await screen.findByRole('list', { name: 'Uploaded files' })
    await within(list).findByText(/onerror=/)
    assertInert(container)
  })

  it('in a payee name', async () => {
    const item = { position: 1, payee_id: 'payee_1', payee_name: PAYLOAD, currency: 'GBP', amount_minor: 100, reference: PAYLOAD, decision: 'needs_approval', reason: 'r' }
    mockBff({
      '/api/agents': { workspace_balance_ulxc: 0, allocated_ulxc: 0, unallocated_ulxc: 0, spent_ulxc: 0, agents: [] },
      '/api/money/payees': { payees: [] },
      '/api/money/payments': { payments: [] },
      '/api/money/payment-requests/preq_1': { id: 'preq_1', status: 'pending_approval', summary: PAYLOAD, client: 'mcp:tlv_oc_claude', agent_id: 'agt_1', totals: { GBP: 100 }, items: [item], created_at: '2026-10-23T09:00:00Z' },
    })
    window.history.pushState({}, '', '/approve/preq_1')
    const { container } = render(<App />)
    await within(await screen.findByTestId('approve-item-1')).findAllByText(/onerror=/)
    assertInert(container)
  })

  it('in a merchant name', async () => {
    const agent = { id: 'agt_1', name: 'Researcher', balance_ulxc: 0, spent_ulxc: 0, keys: [], created_at: '2026-08-01T09:00:00Z', owner_user_id: 'ws_1', verified: true }
    const card = { id: 'ic_1', agent_id: 'agt_1', last4: '4242', exp_month: 9, exp_year: 2029, currency: 'gbp', livemode: false, created_at: '2026-09-28T09:00:00Z' }
    mockBff({
      '/api/agents': { workspace_balance_ulxc: 0, allocated_ulxc: 0, unallocated_ulxc: 0, spent_ulxc: 0, agents: [agent] },
      '/api/agents/schedules': { schedules: [] },
      '/api/agents/forecast': { at: '', month_start: '', month_end: '', spent_ulxc: 0, forecast_ulxc: 0, agents: [] },
      '/api/agents/alerts': { alerts: [], rule: 'the rule' },
      '/api/agents/approvals': { approvals: [] },
      '/api/agents/passkeys': { passkeys: [] },
      '/api/agents/agt_1/rules': { max_per_request_ulxc: 0, daily_limit_ulxc: 0, monthly_limit_ulxc: 0, approval_above_ulxc: 0, allowed_models: [], allowed_providers: [], allowed_listings: [], active_from: '', active_until: '', timezone: 'UTC', pause_on_unusual_spend: false },
      '/api/agents/agt_1/card': {
        card,
        authorizations: [{ id: 'a', authorization_id: 'iauth_a', approved: true, reason: 'ok', amount_minor: 100, currency: 'gbp', merchant_name: PAYLOAD, merchant_category: 'x', rate_date: '2026-09-25T00:00:00Z', ecb_usd_per_eur: '1.1672', ecb_currency_per_eur: '0.8354', amount_ulxc: 1, created_at: '2026-09-28T10:00:00Z' }],
      },
    })
    window.history.pushState({}, '', '/agents')
    const { container } = render(<App />)
    await within(await screen.findByTestId('agent-card-purchases')).findAllByText(/onerror=/)
    assertInert(container)
  })

  it('in a Room message', async () => {
    const me = { workspace_id: 'ws_me', role: 'owner', may_spend: true, terms_version: 1, terms_current: true, joined_at: '' }
    mockBff({
      '/api/rooms': { rooms: [], joined: [], invited: null },
      '/api/rooms/room_1': {
        id: 'room_1', owner_workspace_id: 'ws_me', title: 'Agent pricing', topic: 'research', description: '', visibility: 'public',
        status: 'open', terms_version: 1, member_count: 2, created_at: '', last_activity_at: '2026-10-07T10:00:00Z',
        terms: { version: 1, split_rule: 'equal', remix_share_bps: 1000, default_price_usd_micros: 100_000, spend_policy: 'owner_only', created_at: '' },
        members: [me], agents: null, me,
      },
      '/api/rooms/room_1/messages': {
        messages: [{ id: 'm_1', cursor: 1, room_id: 'room_1', author_workspace_id: 'ws_other', kind: 'text', body: PAYLOAD, refs: {}, created_at: '2026-10-07T10:00:00Z' }],
        more: false,
        events_cursor: 1,
      },
      '/api/rooms/room_1/contributions': { contributions: [] },
    })
    window.history.pushState({}, '', '/rooms/room_1')
    const { container } = render(<App />)
    await within(await screen.findByRole('list', { name: 'Messages' })).findByText(/onerror=/)
    assertInert(container)
  })
})
