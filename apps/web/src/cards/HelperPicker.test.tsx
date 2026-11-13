import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../App'

// B57.124 — the owner chooses an agent's colour by its helper: picking Remy sends cobalt, and so on for each of
// the six; lime stays a plain choice. Editing an agent shows the helper it wears and keeps its colour unless the
// owner picks another.

const M = 1_000_000

function mockBff(existing?: { name: string; colour: string }) {
  const agents: Array<Record<string, unknown>> = []
  const sent: Array<{ method: string; url: string; body: Record<string, unknown> }> = []
  if (existing) agents.push({ id: 'agt_1', ...existing, balance_ulxc: 0, spent_ulxc: 0, keys: [], created_at: '2026-11-01T09:00:00Z' })
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/agents' && method === 'GET')
      return json({ workspace_balance_ulxc: 100 * M, allocated_ulxc: 0, unallocated_ulxc: 100 * M, spent_ulxc: 0, agents })
    if (url === '/api/agents' && method === 'POST') {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      sent.push({ method, url, body })
      const a = { id: `agt_${agents.length + 1}`, name: body.name, colour: body.colour ?? 'sky', balance_ulxc: 0, spent_ulxc: 0, keys: [], created_at: '2026-11-12T09:00:00Z' }
      agents.push(a)
      return json(a, 201)
    }
    if (url === '/api/agents/agt_1' && method === 'PATCH') {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      sent.push({ method, url, body })
      Object.assign(agents[0], body)
      return json(agents[0])
    }
    if (url === '/api/agents/approvals') return json({ approvals: [] })
    return new Response('null', { status: 404 })
  })
  return { sent }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  queryClient.clear()
  window.history.pushState({}, '', '/')
})

async function createWith(choice: string) {
  window.history.pushState({}, '', '/agents')
  render(<App />)
  const helpers = await screen.findByRole('group', { name: 'Its helper' })
  fireEvent.click(within(helpers).getByRole('button', { name: choice }))
  expect(within(helpers).getByRole('button', { name: choice })).toHaveAttribute('aria-pressed', 'true')
  fireEvent.change(screen.getByLabelText('New agent name'), { target: { value: 'Atlas' } })
  fireEvent.click(screen.getByRole('button', { name: 'Create agent' }))
}

describe('the helper picker', () => {
  it('picking Remy creates the agent in cobalt, under the name its owner gave it', async () => {
    const { sent } = mockBff()
    await createWith('Remy')
    await waitFor(() => expect(sent).toEqual([{ method: 'POST', url: '/api/agents', body: { name: 'Atlas', colour: 'cobalt' } }]))
  })

  it.each([
    ['Sunny', 'orchid'],
    ['Penny', 'mint'],
    ['Max', 'lemon'],
    ['Nova', 'sky'],
    ['Ollie', 'rose'],
    ['Lime', 'lime'],
  ])('picking %s sends %s', async (choice, colour) => {
    const { sent } = mockBff()
    await createWith(choice)
    await waitFor(() => expect(sent.map((s) => s.body.colour)).toEqual([colour]))
  })

  it('editing an agent shows its helper and keeps its colour unless the owner picks another', async () => {
    const { sent } = mockBff({ name: 'Ledger', colour: 'mint' })
    window.history.pushState({}, '', '/agents')
    render(<App />)

    const helpers = await screen.findByRole('group', { name: 'Helper for Ledger' })
    expect(within(helpers).getByRole('button', { name: 'Penny' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.change(screen.getByLabelText('Name of Ledger'), { target: { value: 'Books' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0].body).not.toHaveProperty('colour')

    const after = await screen.findByRole('group', { name: 'Helper for Books' })
    fireEvent.click(within(after).getByRole('button', { name: 'Ollie' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(sent).toHaveLength(2))
    expect(sent[1]).toEqual({ method: 'PATCH', url: '/api/agents/agt_1', body: { name: 'Books', description: '', colour: 'rose' } })
  })

  // B57.141 — in Pocket, both places draw the helpers as Pocket draws a choice of several (pocket.css .pill.pick):
  // a cloud pill 34 tall with the portrait 22 across, and the picked one on the page inside a 2px ink ring.
  it('draws each helper as a Pocket pick, where the agent is created and on its Name and description card', async () => {
    mockBff({ name: 'Ledger', colour: 'mint' })
    window.history.pushState({}, '', '/agents')
    render(<App />)

    for (const name of ['Its helper', 'Helper for Ledger']) {
      const choices = within(await screen.findByRole('group', { name })).getAllByRole('button')
      expect(choices.map((b) => b.textContent)).toEqual(['Remy', 'Sunny', 'Penny', 'Max', 'Nova', 'Ollie', 'Lime'])
      for (const b of choices) {
        expect(b.className.split(' ')).toEqual(expect.arrayContaining(['h-8.5', 'rounded-pill', 'bg-cloud', 'aria-pressed:bg-page', 'aria-pressed:shadow-pick']))
        expect(b.firstElementChild?.className.split(' ')).toContain('size-5.5')
      }
    }
  })
})
