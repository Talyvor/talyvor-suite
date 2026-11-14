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
  window.history.pushState({}, '', '/agents/agt_1')
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

  // B57.22 — editing is the Settings row's name and look: the seven colours and four faces, each sent only once picked.
  it('editing an agent shows its colour and face and keeps them unless the owner picks another; the page’s face follows', async () => {
    const { sent } = mockBff({ name: 'Ledger', colour: 'mint' })
    window.history.pushState({}, '', '/agents/agt_1')
    render(<App />)

    fireEvent.click(within(await screen.findByTestId('agent-setting-Name, description, colour and face')).getByRole('button'))
    let look = await screen.findByRole('dialog', { name: 'Ledger’s name and look' })
    expect(within(look).getByRole('radio', { name: 'mint' })).toHaveAttribute('aria-checked', 'true')
    fireEvent.change(within(look).getByLabelText('Name'), { target: { value: 'Books' } })
    fireEvent.click(within(look).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0].body).toEqual({ name: 'Books', description: '' })

    fireEvent.click(within(await screen.findByTestId('agent-setting-Name, description, colour and face')).getByRole('button'))
    look = await screen.findByRole('dialog', { name: 'Books’s name and look' })
    fireEvent.click(within(look).getByRole('radio', { name: 'rose' }))
    fireEvent.click(within(look).getByRole('radio', { name: 'A flower face' }))
    fireEvent.click(within(look).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(sent).toHaveLength(2))
    expect(sent[1]).toEqual({ method: 'PATCH', url: '/api/agents/agt_1', body: { name: 'Books', description: '', colour: 'rose', face: 'flower' } })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(screen.getAllByRole('img', { name: 'Books agent' })[0]).toHaveAttribute('data-face', 'rose flower happy'))
    expect(screen.getByTestId('agent-setting-Name, description, colour and face')).toHaveTextContent('Books: rose, a flower face')
  })

  // B57.141 — in Pocket, both places draw the helpers as Pocket draws a choice of several (pocket.css .pill.pick):
  // a cloud pill 34 tall with the portrait 22 across, and the picked one on the page inside a 2px ink ring.
  // B57.22: editing moved to the name-and-look dialog, which draws the seven colours as the reference does.
  it('draws each helper as a Pocket pick where the agent is created', async () => {
    mockBff({ name: 'Ledger', colour: 'mint' })
    window.history.pushState({}, '', '/agents/agt_1')
    render(<App />)

    for (const name of ['Its helper']) {
      const choices = within(await screen.findByRole('group', { name })).getAllByRole('button')
      expect(choices.map((b) => b.textContent)).toEqual(['Remy', 'Sunny', 'Penny', 'Max', 'Nova', 'Ollie', 'Lime'])
      for (const b of choices) {
        expect(b.className.split(' ')).toEqual(expect.arrayContaining(['h-8.5', 'rounded-pill', 'bg-cloud', 'aria-pressed:bg-page', 'aria-pressed:shadow-pick']))
        expect(b.firstElementChild?.className.split(' ')).toContain('size-5.5')
      }
    }
  })
})
