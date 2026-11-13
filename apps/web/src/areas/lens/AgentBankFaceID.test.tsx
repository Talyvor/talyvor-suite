import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'
import { b64u } from './passkeys'

// B19.10 — once the workspace has a passkey, every approve and deny is signed on this device over the
// challenge Lens issues for that one approval, and the BFF is sent the assertion; a denied payment is
// not sent. The authenticator is stubbed (jsdom has none); Lens's verification of what it signs is
// proven in talyvor-lens (TestAgentRoutes_ApprovalsAreSignedWithAPasskeyAndPushedToTheOwner).

const M = 1_000_000
const bytes = (s: string) => new TextEncoder().encode(s)

function mockBff() {
  const approvals = [
    {
      id: 'apr_1', agent_id: 'agt_1', amount_ulxc: 3 * M, model: '', reason: 'October hosting', status: 'pending', created_at: '2026-09-28T06:05:00Z',
      payee: { kind: 'company', id: 'ws_acme', name: 'Acme Hosting' }, memo: 'October invoice',
    },
    { id: 'apr_2', agent_id: 'agt_1', amount_ulxc: 1 * M, model: '', reason: 'A second invoice', status: 'pending', created_at: '2026-09-28T06:06:00Z' },
  ]
  const decisions: Array<{ id: string; decision: string; body: Record<string, unknown> }> = []
  const pays: string[] = []
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
    const json = (v: unknown, status = 200) =>
      new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/money/devices') return json({ devices: [] }) // B55.2: no phone key, so the web decides
    if (url === '/api/agents' && method === 'GET')
      return json({
        workspace_balance_ulxc: 100 * M, allocated_ulxc: 10 * M, unallocated_ulxc: 90 * M, spent_ulxc: 0,
        agents: [{ id: 'agt_1', name: 'Researcher', balance_ulxc: 10 * M, spent_ulxc: 0, keys: [], created_at: '2026-09-28T06:00:00Z' }],
      })
    if (url === '/api/agents/approvals') return json({ approvals })
    if (url === '/api/agents/passkeys') return json({ passkeys: [{ credential_id: b64u(bytes('cred1')), name: 'iPhone', created_at: '2026-09-28T06:00:00Z' }] })
    const challenge = /^\/api\/agents\/approvals\/([^/]+)\/challenge$/.exec(url)
    if (challenge) return json({ challenge: b64u(bytes(`challenge-${challenge[1]}`)), allow_credentials: [b64u(bytes('cred1'))] })
    const decision = /^\/api\/agents\/approvals\/([^/]+)\/(approve|deny)$/.exec(url)
    if (decision) {
      decisions.push({ id: decision[1], decision: decision[2], body })
      const a = approvals.find((x) => x.id === decision[1])!
      a.status = decision[2] === 'approve' ? 'approved' : 'denied'
      return json(a)
    }
    if (/\/pay$/.test(url)) pays.push(url)
    if (/\/(rules|statement)(?:\?|$)/.test(url)) return json(url.endsWith('rules') ? { approval_above_ulxc: 2 * M } : { lines: [] })
    return new Response('null', { status: 404 })
  })
  return { decisions, pays }
}

afterEach(() => {
  cleanup()
  queryClient.clear()
  vi.restoreAllMocks()
  window.history.pushState({}, '', '/')
})

describe('Agent Bank approvals with Face ID', () => {
  it('says who a payment pays, how much and what for (B23.10)', async () => {
    mockBff()
    window.history.pushState({}, '', '/agents')
    render(<App />)
    const asks = await screen.findByText(/wants to pay/)
    expect(asks).toHaveTextContent(/^Researcher wants to pay Acme Hosting 3 LXC · October invoice$/)
  })

  it('signs each approve and deny with the passkey over that approval’s challenge', async () => {
    const bff = mockBff()
    const get = vi.fn(async (opts: CredentialRequestOptions) => {
      const challenge = new TextDecoder().decode(opts.publicKey!.challenge as Uint8Array)
      return {
        rawId: bytes('cred1').buffer,
        response: {
          clientDataJSON: bytes(`{"type":"webauthn.get","challenge":"${challenge}"}`).buffer,
          authenticatorData: bytes('authdata').buffer,
          signature: bytes(`sig-over-${challenge}`).buffer,
        },
      }
    })
    Object.defineProperty(navigator, 'credentials', { value: { get, create: vi.fn() }, configurable: true })
    window.history.pushState({}, '', '/agents')
    render(<App />)

    expect(await screen.findByText(/October hosting/)).toBeInTheDocument()
    await screen.findByText(/Approvals are signed with a passkey \(1 registered\)/)
    const approveButtons = await screen.findAllByRole('button', { name: 'Approve with your passkey' })
    fireEvent.click(approveButtons[0])
    await waitFor(() => expect(bff.decisions).toHaveLength(1))

    const opts = get.mock.calls[0][0].publicKey!
    expect(new TextDecoder().decode(opts.challenge as Uint8Array)).toBe('challenge-apr_1')
    expect(opts.userVerification).toBe('required')
    expect(new TextDecoder().decode(opts.allowCredentials![0].id as Uint8Array)).toBe('cred1')
    expect(bff.decisions[0]).toEqual({
      id: 'apr_1', decision: 'approve',
      body: { assertion: {
        credential_id: b64u(bytes('cred1')),
        client_data_json: b64u(bytes('{"type":"webauthn.get","challenge":"challenge-apr_1"}')),
        authenticator_data: b64u(bytes('authdata')),
        signature: b64u(bytes('sig-over-challenge-apr_1')),
      } },
    })

    fireEvent.click((await screen.findAllByRole('button', { name: 'Decline' }))[0])
    fireEvent.submit(screen.getByLabelText('Why (optional, the agent sees it)').closest('form')!)
    await waitFor(() => expect(bff.decisions).toHaveLength(2))
    expect(bff.decisions[1].id).toBe('apr_2')
    expect(bff.decisions[1].decision).toBe('deny')
    expect((bff.decisions[1].body.assertion as Record<string, string>).signature).toBe(b64u(bytes('sig-over-challenge-apr_2')))
    expect(bff.pays).toEqual([])
  })
})

// B55.3 — a key let in from the other device (Lens B55.1): with only the phone's key a passkey made here waits for the
// phone, and with a passkey here a phone waiting is let in by this browser signing its enrolment challenge.
function mockEnrol({ passkeys, enrolments, polls = [] }: { passkeys: string[]; enrolments: Record<string, unknown>[]; polls?: string[] }) {
  const sent: Array<{ url: string; body: Record<string, unknown> }> = []
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
    const json = (v: unknown, status = 200) =>
      new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (method === 'POST') sent.push({ url, body })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/money/devices') return json({ devices: [{ id: 'dev_1', platform: 'ios', name: 'iPhone' }] })
    if (url === '/api/agents' && method === 'GET')
      return json({ workspace_balance_ulxc: 0, allocated_ulxc: 0, unallocated_ulxc: 0, spent_ulxc: 0, agents: [] })
    if (url === '/api/agents/approvals') return json({ approvals: [] })
    if (url === '/api/agents/passkeys' && method === 'GET')
      return json({ passkeys: passkeys.map((c) => ({ credential_id: b64u(bytes(c)), name: 'Laptop', created_at: '2026-11-08T06:00:00Z' })) })
    if (url === '/api/agents/passkeys/challenge') return json({ challenge: b64u(bytes('reg')), rp_id: 'localhost', credential_ids: passkeys.map((c) => b64u(bytes(c))) })
    if (url === '/api/agents/passkeys')
      return json({ enrolment: { id: 'enr_web', code: '482913', expires_at: '2026-11-08T06:10:00Z' } }, 202)
    if (url === '/api/agents/keys/enrolments') return json({ enrolments })
    if (url === '/api/agents/keys/enrolments/enr_web') return json({ id: 'enr_web', kind: 'passkey', status: polls.shift() ?? 'waiting' })
    const challenge = /^\/api\/agents\/keys\/enrolments\/([^/]+)\/challenge$/.exec(url)
    if (challenge) return json({ challenge: b64u(bytes(`enrol:${challenge[1]}`)), allow_credentials: passkeys.map((c) => b64u(bytes(c))) })
    const decided = /^\/api\/agents\/keys\/enrolments\/([^/]+)\/(approve|decline)$/.exec(url)
    if (decided) {
      const en = enrolments.find((x) => x.id === decided[1])!
      en.status = decided[2] === 'approve' ? 'approved' : 'declined'
      return json(en)
    }
    return new Response('null', { status: 404 })
  })
  return { sent }
}

describe('a key let in from the other device (B55.3)', () => {
  afterEach(() => {
    delete (window as { PublicKeyCredential?: unknown }).PublicKeyCredential
  })

  it('with only the phone’s key, Add this device waits for the phone with its code, then says it was let in', async () => {
    const polls = ['waiting', 'approved']
    const { sent } = mockEnrol({ passkeys: [], enrolments: [], polls })
    Object.assign(window, { PublicKeyCredential: function PublicKeyCredential() {} })
    const create = vi.fn(async () => ({
      rawId: bytes('newcred').buffer,
      response: { clientDataJSON: bytes('cd').buffer, getAuthenticatorData: () => bytes('ad').buffer, getPublicKey: () => bytes('pk').buffer, getPublicKeyAlgorithm: () => -7 },
    }))
    Object.defineProperty(navigator, 'credentials', { value: { get: vi.fn(), create }, configurable: true })
    window.history.pushState({}, '', '/approvals')
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: 'Add this device' }))
    expect(await screen.findByText(/^Waiting for your phone/)).toHaveTextContent(
      /^Waiting for your phone\. Open Talyvor on your phone and let this browser in\. The code there should be 482913\.$/,
    )
    const reg = sent.find((s) => s.url === '/api/agents/passkeys')!
    expect(reg.body).not.toHaveProperty('assertion')
    expect(
      await screen.findByText(
        'This browser now signs approvals. Face ID, Touch ID or this device’s PIN asks each time you approve or decline.',
        {},
        { timeout: 6000 },
      ),
    ).toBeInTheDocument()
    expect(polls).toEqual([])
  }, 10_000)

  it('with a passkey here, a waiting phone shows its code; Let it approve signs its challenge, Not this one turns another away', async () => {
    const get = vi.fn(async (opts: CredentialRequestOptions) => {
      const challenge = new TextDecoder().decode(opts.publicKey!.challenge as Uint8Array)
      return {
        rawId: bytes('cred1').buffer,
        response: { clientDataJSON: bytes(`cd-${challenge}`).buffer, authenticatorData: bytes('authdata').buffer, signature: bytes(`sig-over-${challenge}`).buffer },
      }
    })
    Object.defineProperty(navigator, 'credentials', { value: { get, create: vi.fn() }, configurable: true })
    const waiting = (id: string, name: string, code: string) => ({
      id, kind: 'device', name, platform: 'ios', code, status: 'waiting', created_at: '2026-11-08T06:00:00Z', expires_at: '2026-11-08T06:10:00Z',
    })
    const { sent } = mockEnrol({ passkeys: ['cred1'], enrolments: [waiting('enr_1', 'iPhone', '551203'), waiting('enr_2', 'Pixel', '700114')] })
    window.history.pushState({}, '', '/approvals')
    render(<App />)

    expect(await screen.findByText(/^Your iPhone asks/)).toHaveTextContent(
      /^Your iPhone asks to approve payments too\. Let it in only if you are adding it now and its code is 551203\.$/,
    )
    fireEvent.click(screen.getAllByRole('button', { name: 'Let it approve' })[0])
    expect(await screen.findByText('iPhone can approve now.')).toBeInTheDocument()
    const approve = sent.find((s) => s.url === '/api/agents/keys/enrolments/enr_1/approve')!
    expect(approve.body).toEqual({
      assertion: {
        credential_id: b64u(bytes('cred1')),
        client_data_json: b64u(bytes('cd-enrol:enr_1')),
        authenticator_data: b64u(bytes('authdata')),
        signature: b64u(bytes('sig-over-enrol:enr_1')),
      },
    })

    fireEvent.click(screen.getAllByRole('button', { name: 'Not this one' }).at(-1)!)
    expect(await screen.findByText('Pixel was not added. Nothing changed.')).toBeInTheDocument()
    expect(sent.map((s) => s.url)).toContain('/api/agents/keys/enrolments/enr_2/decline')
    expect(sent.map((s) => s.url)).not.toContain('/api/agents/keys/enrolments/enr_2/approve')
  })
})

// B55.16 — Approvals and devices lists each passkey and the phone's key by name, and removes any but the last: a passkey
// with DELETE /api/agents/passkeys, the phone's key with its revoke. Removing asks first and needs no signature.
function mockKeys(keys: Array<Record<string, unknown>>, refuse = false) {
  const sent: Array<{ method: string; url: string; body: unknown }> = []
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const json = (v: unknown, status = 200) =>
      new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/agents/keys') return json({ keys })
    if (url === '/api/agents/passkeys' && method === 'GET')
      return json({ passkeys: keys.filter((k) => k.kind === 'passkey').map((k) => ({ credential_id: k.id, name: k.name, created_at: k.created_at })) })
    if (url === '/api/money/devices') return json({ devices: keys.filter((k) => k.kind === 'phone') })
    if ((url === '/api/agents/passkeys' && method === 'DELETE') || /^\/api\/money\/devices\/[^/]+\/revoke$/.test(url)) {
      sent.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : null })
      if (refuse) return json({ error: 'This is your last key. With none, nobody could approve, so add another first.' }, 409)
      const id = method === 'DELETE' ? (JSON.parse(String(init!.body)) as { credential_id: string }).credential_id : url.split('/')[4]
      keys = keys.filter((k) => k.id !== id)
      return json({ removed: true })
    }
    if (url === '/api/agents/approvals') return json({ approvals: [] })
    if (url === '/api/agents' && method === 'GET') return json({ workspace_balance_ulxc: 0, allocated_ulxc: 0, unallocated_ulxc: 0, spent_ulxc: 0, agents: [] })
    return new Response('null', { status: 404 })
  })
  return sent
}

const THREE_KEYS = [
  { kind: 'passkey', id: 'cred_mac', name: 'This Mac', platform: '', created_at: '2026-10-14T09:00:00Z', last_used_at: '2026-10-20T09:00:00Z' },
  { kind: 'passkey', id: 'cred_ipad', name: 'iPad', platform: '', created_at: '2026-10-15T09:00:00Z' },
  { kind: 'phone', id: 'dk_1', name: 'Work iPhone', platform: 'ios', created_at: '2026-10-16T09:00:00Z', last_used_at: '2026-10-21T09:00:00Z' },
]

describe('B55.16 — each key by name, with Remove', () => {
  it('lists two passkeys and the phone’s key by name, and removes a passkey after asking', async () => {
    const sent = mockKeys([...THREE_KEYS])
    window.history.pushState({}, '', '/approvals')
    render(<App />)

    expect(await screen.findByText('2 passkeys and your phone’s key are registered. You approve with one of them; nothing is approved without one.')).toBeInTheDocument()
    expect(screen.getByText('This Mac')).toBeInTheDocument()
    expect(screen.getByText('Passkey · added 14 Oct · last used 20 Oct')).toBeInTheDocument()
    expect(screen.getByText('iPad')).toBeInTheDocument()
    expect(screen.getByText('Work iPhone')).toBeInTheDocument()
    expect(screen.getByText('Phone key · added 16 Oct · last used 21 Oct')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Remove This Mac' }))
    const dialog = await screen.findByRole('dialog', { name: 'Remove “This Mac”?' })
    expect(dialog).toHaveTextContent('It can no longer approve anything.')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep it' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(sent).toEqual([])

    fireEvent.click(screen.getByRole('button', { name: 'Remove This Mac' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove it' }))
    expect(await screen.findByText('Removed: This Mac. It can no longer approve anything.')).toBeInTheDocument()
    expect(sent).toEqual([{ method: 'DELETE', url: '/api/agents/passkeys', body: { credential_id: 'cred_mac' } }])
    await waitFor(() => expect(screen.queryByText('This Mac')).toBeNull())
  })

  it('removes the phone’s key with its revoke', async () => {
    const sent = mockKeys([...THREE_KEYS])
    window.history.pushState({}, '', '/approvals')
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: 'Remove Work iPhone' }))
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Remove “Work iPhone”?' })).getByRole('button', { name: 'Remove it' }))
    expect(await screen.findByText('Removed: Work iPhone. It can no longer approve anything.')).toBeInTheDocument()
    expect(sent).toEqual([{ method: 'POST', url: '/api/money/devices/dk_1/revoke', body: {} }])
  })

  it('offers no Remove on the last key, and says why', async () => {
    mockKeys([THREE_KEYS[2]])
    window.history.pushState({}, '', '/approvals')
    render(<App />)

    expect(await screen.findByText('Your phone’s key is registered. You approve with it; nothing is approved without it.')).toBeInTheDocument()
    expect(screen.getByText('Work iPhone')).toBeInTheDocument()
    expect(screen.getByText('It is your last key. With none, nobody could approve, so add another first.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove Work iPhone' })).toBeNull()
  })

  it('says the same line when Lens refuses the last key (409)', async () => {
    mockKeys(THREE_KEYS.slice(0, 2), true)
    window.history.pushState({}, '', '/approvals')
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: 'Remove iPad' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove it' }))
    await waitFor(() => expect(dialog).toHaveTextContent('It is your last key. With none, nobody could approve, so add another first.'))
    expect(within(dialog).queryByRole('button', { name: 'Remove it' })).toBeNull()
  })
})
