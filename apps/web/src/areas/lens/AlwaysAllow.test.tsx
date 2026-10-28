import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B41.4 — "Approve and always allow this" on Approvals: the rule is previewed in Lens's rule simulator before it can
// be saved, and approving sends it with the approval. The BFF is stubbed; that the next payment is then not held is
// proven against Lens by the e2e scenario approve-always-allow.

const M = 1_000_000

function mockBff() {
  const approvals = [
    { id: 'apr_1', agent_id: 'agt_1', amount_ulxc: 3 * M, model: '', status: 'pending', created_at: '2026-10-28T06:01:00Z', payee: { kind: 'company', id: 'ws_a', name: 'Acme Hosting' } },
    { id: 'apr_2', agent_id: 'agt_1', amount_ulxc: 2 * M, model: '', status: 'pending', created_at: '2026-10-28T06:02:00Z', payee: { kind: 'outside', id: 'pye_1', name: 'Bolt Ltd' } },
  ]
  const sent: Array<{ url: string; body: Record<string, unknown> }> = []
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (method === 'POST') sent.push({ url, body })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/agents' && method === 'GET')
      return json({
        workspace_balance_ulxc: 100 * M, allocated_ulxc: 10 * M, unallocated_ulxc: 90 * M, spent_ulxc: 0,
        agents: [{ id: 'agt_1', name: 'Researcher', balance_ulxc: 10 * M, spent_ulxc: 0, keys: [], created_at: '2026-10-28T06:00:00Z' }],
      })
    if (url === '/api/agents/approvals') return json({ approvals })
    if (url === '/api/agents/passkeys') return json({ passkeys: [] })
    if (url === '/api/agents/agt_1/rules/simulate') return json({ verdict: 'allowed', reason: '', amount_ulxc: 3 * M, at: '2026-10-28T06:05:00Z', balance_ulxc: 10 * M })
    if (url === '/api/agents/approvals/apr_1/approve') {
      approvals[0].status = 'approved'
      return json({ ...approvals[0], rules: {} })
    }
    return new Response('null', { status: 404 })
  })
  return sent
}

afterEach(() => {
  cleanup()
  queryClient.clear()
  vi.restoreAllMocks()
  window.history.pushState({}, '', '/')
})

describe('Approve and always allow this (B41.4)', () => {
  it('previews the rule in the simulator, then approves with it; an outside payee is not offered it', async () => {
    const sent = mockBff()
    window.history.pushState({}, '', '/approvals')
    render(<App />)
    const list = within(await screen.findByRole('group', { name: 'Waiting for a person' }))
    expect(list.getAllByRole('button', { name: 'Approve and always allow this…' })).toHaveLength(1)

    fireEvent.click(list.getByRole('button', { name: 'Approve and always allow this…' }))
    fireEvent.change(list.getByLabelText('Always allow Researcher to pay Acme Hosting up to, in LXC'), { target: { value: '50' } })
    const approve = list.getByRole('button', { name: 'Approve and always allow' })
    expect(approve).toBeDisabled()
    fireEvent.click(list.getByRole('button', { name: 'Preview' }))
    expect(await list.findByTestId('always-allow-preview')).toHaveTextContent('With this rule, Researcher could pay Acme Hosting 3 LXC')
    expect(sent.find((s) => s.url.endsWith('/rules/simulate'))?.body).toEqual({
      amount_ulxc: 3 * M,
      payee: { kind: 'company', id: 'ws_a' },
      always_allow: { amount_ulxc: 50 * M, per: 'month' },
    })
    const approvals = () => sent.filter((s) => s.url === '/api/agents/approvals/apr_1/approve')
    expect(approvals()).toEqual([])

    fireEvent.click(approve)
    expect(await screen.findByText(/From now on Researcher pays Acme Hosting up to/)).toHaveTextContent(/up to 50 LXC.* a month without asking you\./)
    expect(approvals().map((s) => s.body)).toEqual([{ always_allow: { amount_ulxc: 50 * M, per: 'month' } }])
  })
})
