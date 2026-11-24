import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'
import { forgetRecoveryCode } from './recoveryCodeStore'
import { b64u } from './passkeys'

// B28.68 — a lost phone does not lock approvals forever. With the phone's key the workspace's only key, Remove keeps it
// (Lens refuses the last key), so Lost your phone? locks it out through Lens's lockdown (B41.116); with no key left, the
// recovery code adds this browser's passkey (B55.54), and that passkey approves. The fake Lens below holds the keys and
// signs nothing a revoked key or an unknown credential sends; that Lens itself refuses them is proven in talyvor-lens
// (B28.340). The authenticator is stubbed (jsdom has none).

const M = 1_000_000
const bytes = (s: string) => new TextEncoder().encode(s)
const CODE = '7K2M9QXAHT4D0VWB3RCE'
const RECOVERED = b64u(bytes('recovered'))

function fakeLens() {
  const state = {
    passkeys: [] as { credential_id: string; name: string; created_at: string; revoked_at?: string }[],
    devices: [{ id: 'dk_1', platform: 'ios', name: 'iPhone', created_at: '2026-11-01T09:00:00Z' }] as { id: string; platform: string; name: string; created_at: string; revoked_at?: string }[],
    lockdown: { active: false } as { active: boolean; started_at?: string },
    approval: {
      id: 'apr_A', agent_id: 'agt_1', amount_ulxc: 3_400 * M, model: '', status: 'pending', created_at: '2026-11-24T09:17:00Z',
      expires_at: new Date(Date.now() + 86_400_000).toISOString(), payee: { kind: 'company', id: 'ws_acme', name: 'Acme Hosting' },
      memo: 'October hosting invoice', asks_above_ulxc: 2_500 * M, budget_left_after_ulxc: 4_200 * M,
    },
  }
  const sent: { method: string; url: string; body: Record<string, unknown> }[] = []
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (method !== 'GET') sent.push({ method, url, body })
    const livePasskeys = state.passkeys.filter((p) => !p.revoked_at)
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/lxc/topup-options') return json({ usd_per_lxc: 0.1, allowed_usd_cents: [] })
    if (url === '/api/money/devices') return json({ devices: state.devices })
    if (url === '/api/agents/passkeys' && method === 'GET') return json({ passkeys: state.passkeys })
    if (url === '/api/agents/keys')
      return json({
        keys: [
          ...livePasskeys.map((p) => ({ kind: 'passkey', id: p.credential_id, name: p.name, created_at: p.created_at })),
          ...state.devices.filter((d) => !d.revoked_at).map((d) => ({ kind: 'phone', id: d.id, name: d.name, created_at: d.created_at })),
        ],
      })
    if (url === '/api/money/lockdown' && method === 'GET') return json(state.lockdown)
    if (url === '/api/money/lockdown') {
      const ids = body.device_ids as string[]
      for (const d of state.devices) if (ids.includes(d.id)) d.revoked_at = '2026-11-24T10:00:00Z'
      state.lockdown = { active: true, started_at: '2026-11-24T10:00:00Z' }
      return json({ ...state.lockdown, revoked_devices: ids, revoked_passkeys: [], frozen_cards: 0 })
    }
    if (url === '/api/agents/passkeys/challenge') return json({ challenge: 'Q0hBTA', rp_id: 'localhost', credential_ids: [] })
    if (url === '/api/agents/keys/recover' && method === 'GET') return json({ recovery: null })
    if (url === '/api/agents/keys/recover') {
      const passkey = body.passkey as { credential_id: string; name: string }
      // Lens answers 409 while any key is live, and 403 to a wrong code.
      if (livePasskeys.length > 0 || state.devices.some((d) => !d.revoked_at)) return json({ error: 'this workspace still has a live key' }, 409)
      if (String(body.code).replace(/\s+/g, '') !== CODE) return json({ error: 'That recovery code is not right. Check it and try again.' }, 403)
      state.passkeys.push({ credential_id: passkey.credential_id, name: passkey.name, created_at: '2026-11-24T10:05:00Z' })
      return json({ key: { kind: 'passkey', id: passkey.credential_id, name: passkey.name }, recovery_code: 'NEWC0DE0NEWC0DE0NEWC' })
    }
    if (url === '/api/agents' && method === 'GET')
      return json({
        workspace_balance_ulxc: 10_000 * M, allocated_ulxc: 4_000 * M, unallocated_ulxc: 6_000 * M, spent_ulxc: 0,
        agents: [{ id: 'agt_1', name: 'Research', balance_ulxc: 4_000 * M, spent_ulxc: 0, keys: [], created_at: '2026-10-01T09:00:00Z', owner_user_id: 'ws_1' }],
      })
    if (url === '/api/agents/approvals') return json({ approvals: [state.approval] })
    if (url === '/api/money/payment-requests?status=pending_approval') return json({ requests: [] })
    if (url === '/api/agents/approvals/apr_A/challenge') return json({ challenge: b64u(bytes('challenge-apr_A')), allow_credentials: livePasskeys.map((p) => p.credential_id) })
    if (url === '/api/agents/approvals/apr_A/approve') {
      const by = (body.assertion as { credential_id?: string } | undefined)?.credential_id
      if (!livePasskeys.some((p) => p.credential_id === by)) return json({ error: 'that key cannot approve: it is not a live key of this workspace' }, 403)
      state.approval.status = 'approved'
      return json(state.approval)
    }
    if (/^\/api\/agents\/agt_1\/rules$/.test(url)) return json({ max_per_request_ulxc: 0, daily_limit_ulxc: 0, monthly_limit_ulxc: 20_000 * M, approval_above_ulxc: 2_500 * M })
    if (/statement/.test(url)) return json({ lines: [] })
    return new Response('null', { status: 404 })
  })
  // This browser's authenticator: the passkey it makes, and the same one signing.
  const create = vi.fn(async () => ({
    rawId: bytes('recovered').buffer,
    response: { clientDataJSON: bytes('cd').buffer, getAuthenticatorData: () => bytes('ad').buffer, getPublicKey: () => bytes('pk').buffer, getPublicKeyAlgorithm: () => -7 },
  }))
  const get = vi.fn(async () => ({
    rawId: bytes('recovered').buffer,
    response: { clientDataJSON: bytes('cd').buffer, authenticatorData: bytes('ad').buffer, signature: bytes('sig').buffer },
  }))
  Object.defineProperty(navigator, 'credentials', { configurable: true, value: { get, create } })
  return { state, sent, get }
}

beforeEach(() => {
  Object.assign(window, { PublicKeyCredential: function PublicKeyCredential() {} })
})

afterEach(() => {
  cleanup()
  forgetRecoveryCode()
  queryClient.clear()
  vi.restoreAllMocks()
  window.history.pushState({}, '', '/')
})

describe('a lost phone, locked out and replaced by a recovery passkey (B28.68)', () => {
  it('locks out the phone’s last key, gets a passkey back with the recovery code, and that passkey approves', async () => {
    const { state, sent, get } = fakeLens()
    window.history.pushState({}, '', '/settings/devices')
    render(<App />)

    // The phone's key is the only one, so Remove is not offered; Lost your phone? is.
    const keys = await screen.findByTestId('approval-keys')
    expect(within(keys).queryByRole('button', { name: /Remove/ })).toBeNull()
    fireEvent.click(await screen.findByRole('button', { name: 'Lost your phone?' }))
    const dialog = await screen.findByRole('dialog', { name: 'Lost your phone?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lock out my phone' }))

    expect(await screen.findByText('Every key of this workspace was removed, so nothing can approve.')).toBeInTheDocument()
    expect(await screen.findByRole('region', { name: 'Locked down' })).toHaveTextContent('Locked down after a lost phone')
    expect(sent.find((s) => s.url === '/api/money/lockdown')?.body).toEqual({ device_ids: ['dk_1'], reason: 'lost phone' })
    expect(state.devices[0].revoked_at).toBeDefined()

    fireEvent.change(screen.getByLabelText('Recovery code'), { target: { value: '7K2M 9QXA HT4D 0VWB 3RCE' } })
    fireEvent.click(screen.getByRole('button', { name: 'Use your recovery code' }))
    const saved = await screen.findByRole('dialog', { name: 'Save your recovery code' })
    fireEvent.click(within(saved).getByRole('button', { name: 'I saved it' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Save your recovery code' })).toBeNull())
    expect(state.passkeys.map((p) => p.credential_id)).toEqual([RECOVERED])

    // The recovered passkey approves the payment that was waiting.
    cleanup()
    queryClient.clear()
    window.history.pushState({}, '', '/?approval=apr_A')
    render(<App />)
    const sheet = await screen.findByRole('dialog', { name: /wants to pay/ })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Approve with your passkey' }))
    expect(await screen.findByText('Approved: Acme Hosting, $340.00')).toBeInTheDocument()
    expect(get).toHaveBeenCalledTimes(1)
    expect(sent.find((s) => s.url === '/api/agents/approvals/apr_A/approve')?.body).toMatchObject({ assertion: { credential_id: RECOVERED } })
    expect(state.approval.status).toBe('approved')
  })
})
