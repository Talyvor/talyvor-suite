import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B41.4 — "Approve and always allow this" on Approvals: the rule is previewed in Lens's rule simulator before it can
// be saved, and approving sends it with the approval. The BFF is stubbed; that the next payment is then not held is
// proven against Lens by the e2e scenario approve-always-allow.

const M = 1_000_000

function mockBff(passkey = false) {
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
    if (url === '/api/money/devices') return json({ devices: [] }) // B55.2: no phone key, so the web decides
    if (url === '/api/agents' && method === 'GET')
      return json({
        workspace_balance_ulxc: 100 * M, allocated_ulxc: 10 * M, unallocated_ulxc: 90 * M, spent_ulxc: 0,
        agents: [{ id: 'agt_1', name: 'Researcher', balance_ulxc: 10 * M, spent_ulxc: 0, keys: [], created_at: '2026-10-28T06:00:00Z' }],
      })
    if (url === '/api/agents/approvals') return json({ approvals })
    if (url === '/api/agents/passkeys') return json({ passkeys: passkey ? [{ credential_id: 'Y3JlZDE', name: 'iPhone', created_at: '2026-10-28T06:00:00Z' }] : [] })
    if (url === '/api/agents/approvals/apr_1/challenge') return json({ challenge: 'Y2gx', allow_credentials: ['Y3JlZDE'] })
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
    window.history.pushState({}, '', '/agents/agt_1')
    render(<App />)
    const list = within(await screen.findByRole('group', { name: 'Waiting for a person' }))
    // B57.17 — the inbox with this form is Agent Wallets', which offers it once the keys are read.
    expect(await list.findAllByRole('button', { name: 'Approve and always allow this…' })).toHaveLength(1)

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
  // B54.34 — Lens signs the allowance too (B54.29): the challenge is asked for with the allowance the approval saves.
  it('with a passkey, asks for the challenge with the allowance it approves with', async () => {
    const sent = mockBff(true)
    const sig = new TextEncoder().encode('sig').buffer
    Object.defineProperty(navigator, 'credentials', {
      value: { get: vi.fn(async () => ({ rawId: sig, response: { clientDataJSON: sig, authenticatorData: sig, signature: sig } })), create: vi.fn() },
      configurable: true,
    })
    window.history.pushState({}, '', '/agents/agt_1')
    render(<App />)
    const list = within(await screen.findByRole('group', { name: 'Waiting for a person' }))
    fireEvent.click(await list.findByRole('button', { name: 'Approve and always allow this…' }))
    fireEvent.change(list.getByLabelText('Always allow Researcher to pay Acme Hosting up to, in LXC'), { target: { value: '50' } })
    fireEvent.change(list.getByLabelText('Each'), { target: { value: 'day' } })
    fireEvent.click(list.getByRole('button', { name: 'Preview' }))
    await list.findByTestId('always-allow-preview')
    fireEvent.click(await list.findByRole('button', { name: 'Approve and always allow with Face ID' }))
    await screen.findByText(/From now on Researcher pays Acme Hosting up to/)

    const allow = { amount_ulxc: 50 * M, per: 'day' }
    expect(sent.filter((s) => s.url === '/api/agents/approvals/apr_1/challenge').map((s) => s.body)).toEqual([{ always_allow: allow }])
    expect(sent.find((s) => s.url === '/api/agents/approvals/apr_1/approve')?.body.always_allow).toEqual(allow)
  })

  // B57.23 — an always-allow is also a field on the agent's rules page: the one an approval saved is there to edit, and
  // raising it loosens the rules, so it is saved with the passkey, with the allowances whole in the rules body.
  it('edits an always-allow on the rules page and saves it, raised, with the passkey', async () => {
    const sent: Array<{ url: string; method: string; body: Record<string, unknown> }> = []
    const rules = {
      max_per_request_ulxc: 0, daily_limit_ulxc: 0, monthly_limit_ulxc: 0, approval_above_ulxc: 2 * M, allowed_models: [], allowed_providers: [],
      active_from: '', active_until: '', timezone: 'UTC', payee_allowances: { ws_a: { amount_ulxc: 40 * M, per: 'month' } },
    }
    const ASSERTION = { rawId: new Uint8Array([1]).buffer, response: { clientDataJSON: new Uint8Array([2]).buffer, authenticatorData: new Uint8Array([3]).buffer, signature: new Uint8Array([4]).buffer } }
    Object.defineProperty(navigator, 'credentials', { value: { get: vi.fn().mockResolvedValue(ASSERTION), create: vi.fn() }, configurable: true })
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
      const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
      if (method !== 'GET') sent.push({ url, method, body })
      if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
      if (url === '/api/money/devices') return json({ devices: [] })
      if (url === '/api/agents/passkeys') return json({ passkeys: [{ credential_id: 'Y3JlZDE', name: 'iPhone', created_at: '2026-10-28T06:00:00Z' }] })
      if (url === '/api/agents')
        return json({
          workspace_balance_ulxc: 100 * M, allocated_ulxc: 10 * M, unallocated_ulxc: 90 * M, spent_ulxc: 0,
          agents: [{ id: 'agt_1', name: 'Researcher', balance_ulxc: 10 * M, spent_ulxc: 0, keys: [], created_at: '2026-10-28T06:00:00Z' }],
        })
      if (url === '/api/money/payees') return json({ payees: [{ id: 'ws_a', name: 'Acme Hosting', country: 'GB', check: 'exact_match', checked_by: 'x', checked_at: '2026-10-28T06:00:00Z' }] })
      if (url === '/api/agents/agt_1/rules-challenge')
        return json({ looser: true, changes: ['Always allows Acme Hosting: was up to 40 LXC a month, now up to 60 LXC a month'], challenge: 'Y2gx', allow_credentials: ['Y3JlZDE'] })
      if (url === '/api/agents/agt_1/rules') return json(method === 'PUT' ? (body.rules as object) : rules)
      return new Response('null', { status: 404 })
    })
    window.history.pushState({}, '', '/agents/agt_1/rules')
    render(<App />)

    expect((await screen.findByRole('switch', { name: 'Always allow a payee' })).getAttribute('aria-checked')).toBe('true')
    const field = await screen.findByLabelText('Always allow Acme Hosting from Researcher, in LXC a month')
    expect(field).toHaveValue('40')
    fireEvent.change(field, { target: { value: '60' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save rules' }))
    expect((await screen.findByTestId('rules-loosen')).textContent).toContain('Always allows Acme Hosting: was up to 40 LXC a month, now up to 60 LXC a month')
    fireEvent.click(screen.getByRole('button', { name: 'Save with your passkey' }))
    await screen.findByText('Your passkey was asked first, because the change loosens them.')
    const put = sent.find((s) => s.method === 'PUT')!
    expect(put.url).toBe('/api/agents/agt_1/rules')
    expect((put.body.rules as Record<string, unknown>).payee_allowances).toEqual({ ws_a: { amount_ulxc: 60 * M, per: 'month' } })
    expect(put.body.assertion).toEqual({ credential_id: 'AQ', client_data_json: 'Ag', authenticator_data: 'Aw', signature: 'BA' })
  })
})
