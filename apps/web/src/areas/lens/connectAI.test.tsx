import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ConnectAI } from './ConnectAI'

// B57.45 — Pocket's w-connect at the wire: every assistant with its note, How to add it opening that assistant's
// steps in a dialog, a connected one with Connected, its last use, what it may do and a Revoke that asks first; the
// address and the Claude Code command to copy; how a payment works and the page a prepared payment opens.

afterEach(() => vi.restoreAllMocks())

const URL = `${window.location.origin}/mcp`

interface Wire {
  assistants: unknown[]
  requests?: unknown[]
}

function serve(wire: Wire) {
  const calls: string[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const path = String(input)
    calls.push(`${init?.method ?? 'GET'} ${path}`)
    if (init?.method === 'POST' && path.endsWith('/revoke')) {
      wire.assistants = []
      return new Response(null, { status: 204 })
    }
    if (path.startsWith('/api/money/payment-requests')) return new Response(JSON.stringify({ requests: wire.requests ?? [] }))
    return new Response(JSON.stringify({ assistants: wire.assistants }))
  })
  return calls
}

function renderScreen() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <div data-design="pocket">
          <ConnectAI />
        </div>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const claude = {
  id: 'g-1',
  name: 'Claude',
  scopes: ['wallets:read', 'invoices:draft', 'payments:prepare'],
  connected_at: '2026-10-03T09:00:00Z',
  last_used_at: '2026-10-23T08:15:00Z',
  calls: [{ tool: 'list_agents', args_sha256: 'e'.repeat(64), result: 'done', at: '2026-10-23T08:15:00Z' }],
}

/** Each assistant's steps, in today's words; in a dialog "the address above" is "your Talyvor address". */
const STEPS: Record<string, string[]> = {
  Claude: [
    'In Claude, open Settings › Connectors.',
    'Choose Add custom connector, name it Talyvor and paste your Talyvor address.',
    'Choose Connect, sign in to Talyvor and approve what Claude may do.',
  ],
  ChatGPT: [
    'On chatgpt.com, open Settings › Apps & Connectors › Advanced settings and turn on Developer mode.',
    'Back in Apps & Connectors, choose Create, name it Talyvor, paste your Talyvor address and choose OAuth.',
    'Sign in to Talyvor and approve what ChatGPT may do.',
  ],
  'Claude Code': ['Run this in a terminal.', 'In Claude Code, type /mcp, choose talyvor and sign in.'],
  Cursor: ['Add this to ~/.cursor/mcp.json (or .cursor/mcp.json in a project).', 'In Cursor Settings › MCP, choose Connect next to Talyvor and sign in.'],
  'Microsoft Copilot': [
    'Copilot reaches Talyvor through your organisation’s Microsoft 365.',
    'Your Microsoft 365 admin adds your Talyvor address as an MCP connector in Copilot Studio.',
    'Once they have, each person signs in to Talyvor the first time Copilot uses it.',
  ],
  'Mistral Le Chat': [
    'In Le Chat, open Intelligence › Connectors and choose Add connector.',
    'Choose Custom MCP connector, name it Talyvor and paste your Talyvor address.',
    'Connect, sign in to Talyvor and approve what Le Chat may do.',
  ],
  Grok: [
    'In Grok, open Settings › Connectors and add a custom connector.',
    'Name it Talyvor and paste your Talyvor address.',
    'Sign in to Talyvor and approve what Grok may do.',
  ],
}

describe('Connect your AI', () => {
  it('shows the address and the Claude Code command, each with Copy', async () => {
    serve({ assistants: [] })
    renderScreen()
    const card = screen.getByRole('region', { name: 'Your Talyvor address' })
    expect(within(card).getByText(URL)).toBeInTheDocument()
    expect(within(card).getByText(`claude mcp add --transport http talyvor ${URL}`)).toBeInTheDocument()
    expect(within(card).getAllByRole('button', { name: 'Copy' })).toHaveLength(2)
  })

  it("opens each assistant's steps in a dialog with Copy the address and Done", async () => {
    serve({ assistants: [] })
    renderScreen()
    const list = await screen.findByRole('region', { name: 'Assistants' })
    for (const [name, steps] of Object.entries(STEPS)) {
      fireEvent.click(within(list).getByRole('button', { name: `How to add ${name}` }))
      const dialog = screen.getByRole('dialog', { name: `Add Talyvor to ${name}` })
      expect(within(dialog).getAllByRole('listitem').map((li) => li.textContent)).toEqual(steps)
      expect(within(dialog).getByRole('button', { name: 'Copy the address' })).toBeInTheDocument()
      fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }))
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    }
    // Gemini is listed with its note, and nothing to press.
    expect(within(list).getByText(/US personal Google accounts only/)).toBeInTheDocument()
    expect(within(list).queryByRole('button', { name: 'How to add Gemini' })).not.toBeInTheDocument()
  })

  it('shows a connected assistant with its last use and what it may do, and Revoke asks first', async () => {
    const calls = serve({ assistants: [claude] })
    renderScreen()
    const list = await screen.findByRole('region', { name: 'Assistants' })
    const row = (await within(list).findByText('Connected')).closest('[data-assistant]') as HTMLElement
    expect(row).toHaveAttribute('data-assistant', 'Claude')
    expect(row).toHaveTextContent(
      /Last used .*Oct 23.* · connected .*Oct 3.* · may see your wallets and bills, draft invoices and payees, and prepare payments for you to approve/,
    )
    // Its latest tool calls, newest first.
    const trail = screen.getByRole('region', { name: 'Claude’s latest tool calls' })
    expect(within(trail).getByText('list_agents')).toBeInTheDocument()

    fireEvent.click(within(row).getByRole('button', { name: 'Revoke Claude' }))
    let dialog = screen.getByRole('dialog', { name: 'Revoke Claude?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep it' }))
    expect(calls.filter((c) => c.startsWith('POST'))).toEqual([])

    fireEvent.click(within(row).getByRole('button', { name: 'Revoke Claude' }))
    dialog = screen.getByRole('dialog', { name: 'Revoke Claude?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Revoke' }))
    await waitFor(() => expect(within(list).getByRole('button', { name: 'How to add Claude' })).toBeInTheDocument())
    expect(calls).toContain('POST /api/connect/assistants/g-1/revoke')
    expect(within(list).queryByText('Connected')).not.toBeInTheDocument()
  })

  it('lists a connected assistant that is not one of the eight, with its own Revoke', async () => {
    serve({ assistants: [{ ...claude, id: 'g-2', name: 'Test client', calls: null }] })
    renderScreen()
    const row = (await screen.findByText('Test client')).closest('[data-assistant]') as HTMLElement
    expect(within(row).getByText('Connected')).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: 'Revoke Test client' })).toBeInTheDocument()
  })

  it('says how a payment works and opens the page of the prepared payment waiting', async () => {
    serve({ assistants: [], requests: [{ id: 'pr-7', status: 'pending_approval', summary: '', client: 'Claude', totals: {}, items: [], created_at: '2026-11-13T09:00:00Z' }] })
    renderScreen()
    const how = screen.getByRole('region', { name: 'How a payment works' })
    for (const step of ['Your assistant prepares it', 'Talyvor writes it out', 'You approve it']) expect(within(how).getByText(step)).toBeInTheDocument()
    expect(await within(how).findByRole('link', { name: 'See the page a prepared payment opens' })).toHaveAttribute('href', '/approve/pr-7')
  })
})
