import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B41.33 — the approvals inbox: filters, several approved together, keyboard shortcuts and a swipe. The BFF
// is stubbed; each decision is the same POST the single Approve button sends, and is counted here.

const M = 1_000_000

function mockBff() {
  const approvals = [
    { id: 'apr_1', agent_id: 'agt_1', amount_ulxc: 3 * M, model: '', status: 'pending', created_at: '2026-10-25T06:01:00Z', payee: { kind: 'company', id: 'ws_a', name: 'Acme Hosting' } },
    { id: 'apr_2', agent_id: 'agt_1', amount_ulxc: 2 * M, model: 'gpt-5', status: 'pending', created_at: '2026-10-25T06:02:00Z' },
    { id: 'apr_3', agent_id: 'agt_2', amount_ulxc: 4 * M, model: '', status: 'pending', created_at: '2026-10-25T06:03:00Z', payee: { kind: 'company', id: 'ws_b', name: 'Bolt Cloud' } },
    { id: 'apr_4', agent_id: 'agt_2', amount_ulxc: 1 * M, model: '', status: 'pending', created_at: '2026-10-25T06:04:00Z', payee: { kind: 'company', id: 'ws_c', name: 'Copy Desk' } },
    { id: 'apr_5', agent_id: 'agt_2', amount_ulxc: 5 * M, model: 'claude', status: 'pending', created_at: '2026-10-25T06:05:00Z' },
  ]
  const decisions: Array<{ id: string; decision: string }> = []
  const challenges: string[] = []
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/agents' && method === 'GET')
      return json({
        workspace_balance_ulxc: 100 * M, allocated_ulxc: 20 * M, unallocated_ulxc: 80 * M, spent_ulxc: 0,
        agents: [
          { id: 'agt_1', name: 'Researcher', balance_ulxc: 10 * M, spent_ulxc: 0, keys: [], created_at: '2026-10-25T06:00:00Z' },
          { id: 'agt_2', name: 'Buyer', balance_ulxc: 10 * M, spent_ulxc: 0, keys: [], created_at: '2026-10-25T06:00:00Z' },
        ],
      })
    if (url === '/api/agents/approvals') return json({ approvals })
    if (url === '/api/agents/passkeys') return json({ passkeys: [] })
    const challenge = /^\/api\/agents\/approvals\/([^/]+)\/challenge$/.exec(url)
    if (challenge) challenges.push(challenge[1])
    const decision = /^\/api\/agents\/approvals\/([^/]+)\/(approve|deny)$/.exec(url)
    if (decision) {
      decisions.push({ id: decision[1], decision: decision[2] })
      const a = approvals.find((x) => x.id === decision[1])!
      if (a.status !== 'pending') return json({ error: 'already decided' }, 409)
      a.status = decision[2] === 'approve' ? 'approved' : 'denied'
      return json(a)
    }
    return new Response('null', { status: 404 })
  })
  return { decisions, challenges }
}

const inbox = async () => {
  window.history.pushState({}, '', '/approvals')
  render(<App />)
  return within(await screen.findByRole('group', { name: 'Waiting for a person' }))
}

afterEach(() => {
  cleanup()
  queryClient.clear()
  vi.restoreAllMocks()
  window.history.pushState({}, '', '/')
})

describe('the approvals inbox (B41.33)', () => {
  it('narrows the waiting list by agent and by kind', async () => {
    mockBff()
    const list = await inbox()
    expect(list.getAllByRole('checkbox')).toHaveLength(5)
    fireEvent.change(screen.getByLabelText('Show approvals for'), { target: { value: 'agt_2' } })
    expect(list.getAllByRole('checkbox')).toHaveLength(3)
    fireEvent.change(screen.getByLabelText('Show which kind'), { target: { value: 'payment' } })
    expect(list.getAllByRole('checkbox')).toHaveLength(2)
    expect(list.getByText(/Bolt Cloud/)).toBeInTheDocument()
    expect(list.queryByText(/Acme Hosting/)).not.toBeInTheDocument()
  })

  it('approves five selected together, each decided exactly once', async () => {
    const bff = mockBff()
    await inbox()
    fireEvent.click(screen.getByLabelText('Select all 5'))
    fireEvent.click(screen.getByRole('button', { name: 'Approve 5' }))
    expect(await screen.findByText(/^Approved 5\./)).toBeInTheDocument()
    expect(bff.decisions.map((d) => d.id).sort()).toEqual(['apr_1', 'apr_2', 'apr_3', 'apr_4', 'apr_5'])
    expect(bff.decisions.every((d) => d.decision === 'approve')).toBe(true)
    await waitFor(() => expect(screen.getByText('Nothing is waiting. A request or payment appears here when it is above an agent’s approval amount.')).toBeInTheDocument())
  })

  it('moves with j and k and approves with a, denies with d', async () => {
    const bff = mockBff()
    const list = await inbox()
    const rows = list.getAllByRole('checkbox').map((c) => c.closest<HTMLElement>('[data-approval]')!)
    rows[0].focus()
    fireEvent.keyDown(rows[0], { key: 'j' })
    expect(document.activeElement).toBe(rows[1])
    fireEvent.keyDown(rows[1], { key: 'a' })
    await waitFor(() => expect(bff.decisions).toEqual([{ id: 'apr_2', decision: 'approve' }]))
    const first = (await list.findAllByRole('checkbox'))[0].closest<HTMLElement>('[data-approval]')!
    fireEvent.keyDown(first, { key: 'd' })
    await waitFor(() => expect(bff.decisions).toEqual([{ id: 'apr_2', decision: 'approve' }, { id: 'apr_1', decision: 'deny' }]))
  })

  it('approves a request swiped right, and nothing on a short or leftward swipe', async () => {
    const bff = mockBff()
    const list = await inbox()
    const row = list.getByText(/Bolt Cloud/).closest<HTMLElement>('[data-approval]')!
    fireEvent.touchStart(row, { touches: [{ clientX: 100, clientY: 10 }] })
    fireEvent.touchEnd(row, { changedTouches: [{ clientX: 20, clientY: 10 }] })
    fireEvent.touchStart(row, { touches: [{ clientX: 100, clientY: 10 }] })
    fireEvent.touchEnd(row, { changedTouches: [{ clientX: 150, clientY: 10 }] })
    expect(bff.decisions).toEqual([])
    fireEvent.touchStart(row, { touches: [{ clientX: 20, clientY: 10 }] })
    fireEvent.touchMove(row, { touches: [{ clientX: 90, clientY: 12 }] })
    fireEvent.touchEnd(row, { changedTouches: [{ clientX: 140, clientY: 14 }] })
    await waitFor(() => expect(bff.decisions).toEqual([{ id: 'apr_3', decision: 'approve' }]))
  })
})
