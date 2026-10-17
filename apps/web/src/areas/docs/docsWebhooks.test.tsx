import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DocsWebhooks } from './DocsWebhooks'

// B39.25 — Settings → Webhooks, driven at the wire against a BFF that keeps what it is told: add,
// rotate, delete, and the secret on screen only after add and rotate. A non-owner is told why.

afterEach(() => vi.restoreAllMocks())

function mockBFF(owner = true) {
  let hooks: Array<{ id: string; url: string; events: string[]; created_at: string }> = []
  const writes: Array<{ url: string; method: string; body: unknown }> = []
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } })
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    if (!owner) return json({ error: 'owner role required', code: 'OWNER_REQUIRED' }, 403)
    if (method !== 'GET') writes.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null })
    if (url === '/api/docs/webhooks' && method === 'GET') return json(hooks)
    if (url === '/api/docs/webhooks' && method === 'POST') {
      const { url: to, events } = JSON.parse(String(init?.body)) as { url: string; events: string[] }
      hooks = [{ id: 'wh-1', url: to, events, created_at: '2026-10-17T00:00:00Z' }]
      return json({ ...hooks[0], secret: 'whsec_FIRST' }, 201)
    }
    if (url === '/api/docs/webhooks/wh-1/rotate' && method === 'POST') return json({ id: 'wh-1', secret: 'whsec_SECOND' })
    if (url === '/api/docs/webhooks/wh-1' && method === 'DELETE') {
      hooks = []
      return new Response(null, { status: 204 })
    }
    return json(null, 404)
  })
  return writes
}

function renderScreen() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <DocsWebhooks />
    </QueryClientProvider>,
  )
}

describe('Docs webhooks settings', () => {
  it('adds, rotates and deletes a webhook, showing the secret only after add and rotate', async () => {
    const writes = mockBFF()
    renderScreen()
    await screen.findByText(/No webhooks yet/)
    expect(screen.queryByText(/whsec_/)).toBeNull()

    fireEvent.change(screen.getByRole('textbox', { name: 'Webhook URL' }), { target: { value: 'https://hooks.example.com/d' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'approval.requested' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add webhook' }))
    expect(await screen.findByText('whsec_FIRST')).toBeInTheDocument()
    expect(writes[0]).toEqual({
      url: '/api/docs/webhooks',
      method: 'POST',
      body: { url: 'https://hooks.example.com/d', events: ['approval.requested'] },
    })
    const row = await screen.findByText('https://hooks.example.com/d')
    expect(within(row.closest('li')!).getByText(/approval\.requested/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'I’ve saved it' }))
    expect(screen.queryByText(/whsec_/)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Rotate secret for https://hooks.example.com/d' }))
    expect(await screen.findByText('whsec_SECOND')).toBeInTheDocument()
    expect(screen.queryByText('whsec_FIRST')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'I’ve saved it' }))

    fireEvent.click(screen.getByRole('button', { name: 'Delete https://hooks.example.com/d' }))
    await screen.findByText(/No webhooks yet/)
    expect(writes.map((w) => `${w.method} ${w.url}`)).toEqual([
      'POST /api/docs/webhooks',
      'POST /api/docs/webhooks/wh-1/rotate',
      'DELETE /api/docs/webhooks/wh-1',
    ])
    expect(screen.queryByText(/whsec_/)).toBeNull()
  })

  it('tells a non-owner why they cannot manage webhooks', async () => {
    mockBFF(false)
    renderScreen()
    expect(await screen.findByText(/Only this workspace’s owner can manage its Docs webhooks/)).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Add webhook' })).toBeNull())
  })
})
