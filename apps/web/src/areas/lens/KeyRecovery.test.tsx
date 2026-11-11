import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'
import type { KeyRecovery, Passkey } from './agentBankApi'
import { forgetRecoveryCode } from './recoveryCodeStore'

// B55.54 — the web's half of Lens's B55.48: the recovery code shown once, a key got back with it, and a recovery waiting
// 72 hours shown on every page to everyone in the workspace, who can cancel it. The authenticator is stubbed (jsdom has
// none); what Lens does with the code is proven in talyvor-lens (key_recovery_handler_realpg_test.go).

const M = 1_000_000
const buf = (n: number) => new Uint8Array([n]).buffer
const CODE = '7K2M9QXAHT4D0VWB3RCE'

function mockBff(state: { passkeys: Passkey[]; devices?: { id: string; platform: string; name: string; revoked_at?: string }[]; recovery?: KeyRecovery | null; approvals?: unknown[] }) {
  const sent: { method: string; url: string; body: Record<string, unknown> }[] = []
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (method !== 'GET') sent.push({ method, url, body })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/money/devices') return json({ devices: state.devices ?? [] })
    if (url === '/api/agents/passkeys' && method === 'GET') return json({ passkeys: state.passkeys })
    if (url === '/api/agents/passkeys/challenge') return json({ challenge: 'Q0hBTA', rp_id: 'localhost', credential_ids: [] })
    if (url === '/api/agents/passkeys') {
      const key = { credential_id: 'new', name: 'This device', created_at: '2026-11-11T09:00:00Z' }
      state.passkeys = [key]
      return json({ ...key, recovery_code: CODE }, 201)
    }
    if (url === '/api/agents/keys/recover' && method === 'GET') return json({ recovery: state.recovery ?? null })
    if (url === '/api/agents/keys/recover') return json({ error: 'That recovery code is not right. Check it and try again.' }, 403)
    if (url === '/api/agents/keys/recover/cancel') {
      state.recovery = null
      return json({ recovery: { status: 'cancelled' } })
    }
    if (url === '/api/agents' && method === 'GET')
      return json({
        workspace_balance_ulxc: 100 * M, allocated_ulxc: 10 * M, unallocated_ulxc: 90 * M, spent_ulxc: 0,
        agents: [{ id: 'agt_1', name: 'Researcher', balance_ulxc: 10 * M, spent_ulxc: 0, keys: [], created_at: '2026-09-28T06:00:00Z' }],
      })
    if (url === '/api/agents/approvals') return json({ approvals: state.approvals ?? [] })
    return new Response('null', { status: 404 })
  })
  const create = vi.fn(async () => ({
    rawId: buf(1),
    response: { clientDataJSON: buf(2), getAuthenticatorData: () => buf(3), getPublicKey: () => buf(4), getPublicKeyAlgorithm: () => -7 },
  }))
  Object.defineProperty(navigator, 'credentials', { configurable: true, value: { get: vi.fn(), create } })
  return { sent, state }
}

beforeEach(() => {
  Object.assign(window, { PublicKeyCredential: function PublicKeyCredential() {} })
})

afterEach(() => {
  cleanup()
  forgetRecoveryCode()
  queryClient.clear()
  vi.restoreAllMocks()
  localStorage.clear()
  sessionStorage.clear()
  window.history.pushState({}, '', '/')
})

describe('Key recovery on the web (B55.54)', () => {
  it('the recovery code of the first key shows once, kept nowhere in the browser, and never again on reload', async () => {
    mockBff({ passkeys: [] })
    window.history.pushState({}, '', '/approvals')
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Approve with Face ID from now on' }))

    const sheet = await screen.findByRole('dialog', { name: 'Save your recovery code' })
    expect(sheet).toHaveTextContent('If you ever lose every passkey and phone, this code lets you add a new key at once. We show it only now.')
    expect(within(sheet).getByText('7K2M 9QXA HT4D 0VWB 3RCE')).toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: /Copy/ })).toBeInTheDocument()
    const stored = [localStorage, sessionStorage].flatMap((st) => Array.from({ length: st.length }, (_, i) => `${st.key(i)}=${st.getItem(st.key(i)!)}`))
    expect(stored.join('\n')).not.toMatch(/7K2M|9QXA|3RCE/)
    expect(document.cookie).not.toContain('7K2M')

    fireEvent.click(within(sheet).getByRole('button', { name: 'I saved it' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Save your recovery code' })).toBeNull())

    // A reload reads the keys again; Lens answers the code only once, so nothing shows it.
    cleanup()
    queryClient.clear()
    window.history.pushState({}, '', '/approvals')
    render(<App />)
    await screen.findByText(/Approvals are signed with a passkey \(1 registered\)/)
    expect(screen.queryByRole('dialog', { name: 'Save your recovery code' })).toBeNull()
  })

  it('with every key removed, a wrong recovery code shows Lens’s sentence', async () => {
    const { sent } = mockBff({ passkeys: [{ credential_id: 'old', name: 'iPhone', created_at: '2026-10-01T09:00:00Z', revoked_at: '2026-10-02T09:00:00Z' }] })
    window.history.pushState({}, '', '/approvals')
    render(<App />)
    expect(await screen.findByText('Every key of this workspace was removed, so nothing can approve.')).toBeInTheDocument()
    expect(screen.getByText('We wait 72 hours before you can add a new key, and tell everyone in your workspace. Anyone in it can cancel in that time.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Wait 72 hours' })).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Recovery code'), { target: { value: 'AAAA BBBB CCCC DDDD EEEE' } })
    fireEvent.click(screen.getByRole('button', { name: 'Use your recovery code' }))

    expect(await screen.findByText('That recovery code is not right. Check it and try again.')).toBeInTheDocument()
    const recover = sent.find((s) => s.url === '/api/agents/keys/recover')
    expect(recover?.body).toMatchObject({ code: 'AAAA BBBB CCCC DDDD EEEE', passkey: { credential_id: expect.any(String), public_key: expect.any(String) } })
    expect(screen.queryByRole('dialog', { name: 'Save your recovery code' })).toBeNull()
  })

  it('an approve control says every key was removed and offers the two ways back', async () => {
    mockBff({
      passkeys: [],
      devices: [{ id: 'dev_1', platform: 'ios', name: 'iPhone', revoked_at: '2026-10-02T09:00:00Z' }],
      approvals: [{ id: 'apr_1', agent_id: 'agt_1', amount_ulxc: 3 * M, model: '', reason: 'October hosting', status: 'pending', created_at: '2026-11-11T06:05:00Z' }],
    })
    window.history.pushState({}, '', '/agents')
    render(<App />)
    const said = await screen.findAllByTestId('no-live-key')
    expect(said[0]).toHaveTextContent('Every key of this workspace was removed, so nothing can approve.')
    expect(within(said[0]).getByRole('link', { name: 'Use your recovery code' })).toHaveAttribute('href', '/approvals#get-a-key-back')
    expect(within(said[0]).getByRole('link', { name: 'Wait 72 hours' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Approve/ })).toBeNull()
  })

  it('a waiting recovery shows on every page to someone who did not start it, who can cancel it', async () => {
    const { sent } = mockBff({
      passkeys: [{ credential_id: 'old', name: 'iPhone', created_at: '2026-10-01T09:00:00Z', revoked_at: '2026-10-02T09:00:00Z' }],
      recovery: { id: 'rcv_1', status: 'waiting', created_at: '2026-11-11T09:00:00Z', ready_at: '2099-11-14T09:00:00Z', expires_at: '2099-11-15T09:00:00Z', mine: false },
    })
    window.history.pushState({}, '', '/agents')
    render(<App />)
    const notice = await screen.findByTestId('key-recovery-notice')
    expect(notice).toHaveTextContent(/^The owner started a recovery\. A new key can be added from 14 Nov 2099 at \d\d:\d\d\./)
    expect(within(notice).queryByRole('button', { name: 'Add your new key' })).toBeNull()

    fireEvent.click(within(notice).getByRole('button', { name: 'Cancel recovery' }))
    await waitFor(() => expect(screen.queryByTestId('key-recovery-notice')).toBeNull())
    expect(sent.map((s) => `${s.method} ${s.url}`)).toContain('POST /api/agents/keys/recover/cancel')
  })
})
