import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ConnectAI } from './ConnectAI'

// B40.8's DONE at the wire: the page shows the MCP address and each assistant's steps, and a connected client
// appears below with its last use and is revoked by its own button.

afterEach(() => vi.restoreAllMocks())

function renderScreen() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ConnectAI />
    </QueryClientProvider>,
  )
}

describe('Connect your AI', () => {
  it('shows the address and the steps for each assistant', () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ assistants: [] })))
    renderScreen()
    expect(screen.getByText(`${window.location.origin}/mcp`)).toBeInTheDocument()
    for (const name of ['Claude', 'ChatGPT', 'Mistral Le Chat', 'Grok', 'Cursor', 'Claude Code', 'Microsoft Copilot', 'Gemini'])
      expect(screen.getByRole('heading', { name })).toBeInTheDocument()
    expect(screen.getByText(/US personal Google accounts only/)).toBeInTheDocument()
    expect(screen.getByText(`claude mcp add --transport http talyvor ${window.location.origin}/mcp`)).toBeInTheDocument()
  })

  it('lists a connected assistant with its last use and revokes it with its button', async () => {
    let connected = [
      {
        id: 'g-1',
        name: 'Test client',
        scopes: ['wallets:read'],
        connected_at: '2026-10-20T09:00:00Z',
        last_used_at: '2026-10-23T08:15:00Z',
      },
    ]
    const calls: string[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      calls.push(`${init?.method ?? 'GET'} ${String(input)}`)
      if (init?.method === 'POST') {
        connected = []
        return new Response(null, { status: 204 })
      }
      return new Response(JSON.stringify({ assistants: connected }))
    })
    renderScreen()
    const row = (await screen.findByText('Test client')).closest('li')!
    expect(within(row).getByText(/Last used/)).toHaveTextContent(/Oct 23/)
    expect(within(row).getByText('See your wallets and bills')).toBeInTheDocument()
    fireEvent.click(within(row).getByRole('button', { name: 'Revoke Test client' }))
    await waitFor(() => expect(screen.queryByText('Test client')).not.toBeInTheDocument())
    expect(calls).toContain('POST /api/connect/assistants/g-1/revoke')
    expect(screen.getByText(/No assistant is connected yet/)).toBeInTheDocument()
  })
})
