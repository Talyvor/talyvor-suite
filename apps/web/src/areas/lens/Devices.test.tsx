import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'
import { hideSnack } from '@talyvor/ui/pocket'
import { b64u } from './passkeys'
import { keysLine } from './Devices'
import type { ApprovalKey } from './agentBankApi'

// B57.43 — /settings/devices, Approvals and devices, as Pocket's w-security draws it: every passkey and the phone's key by
// name, with Remove (asked first, never signed; the last key has none), Add this device (signed by a passkey the
// workspace has, or let in by the phone), a phone waiting to be let in, an agent's approval and Stop everything.
// The authenticator is stubbed (jsdom has none); Lens's checks of what is signed are proven in talyvor-lens.

const bytes = (s: string) => new TextEncoder().encode(s)

interface Mock {
  keys: Array<Record<string, unknown>>
  /** the phone keys /api/money/devices lists; by default the keys of kind phone */
  devices?: Array<Record<string, unknown>>
  enrolments?: Array<Record<string, unknown>>
  polls?: string[]
  refuse?: boolean
  paused?: boolean
}

function mockBff(m: Mock) {
  const sent: Array<{ method: string; url: string; body: unknown }> = []
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (method !== 'GET') sent.push({ method, url, body })
    const passkeys = () => m.keys.filter((k) => k.kind === 'passkey')
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/agents/keys') return json({ keys: m.keys })
    if (url === '/api/agents/passkeys' && method === 'GET')
      return json({ passkeys: passkeys().map((k) => ({ credential_id: k.id, name: k.name, created_at: k.created_at })) })
    if (url === '/api/money/devices') return json({ devices: m.devices ?? m.keys.filter((k) => k.kind === 'phone') })
    if ((url === '/api/agents/passkeys' && method === 'DELETE') || /^\/api\/money\/devices\/[^/]+\/revoke$/.test(url)) {
      if (m.refuse) return json({ error: 'This is your last key. With none, nobody could approve, so add another first.' }, 409)
      const id = method === 'DELETE' ? (body as { credential_id: string }).credential_id : url.split('/')[4]
      m.keys = m.keys.filter((k) => k.id !== id)
      return json({ removed: true })
    }
    if (url === '/api/agents/passkeys/challenge') return json({ challenge: b64u(bytes('reg')), rp_id: 'localhost', credential_ids: passkeys().map((k) => k.id) })
    if (url === '/api/agents/passkeys' && method === 'POST') {
      if (passkeys().length === 0 && m.keys.length > 0) return json({ enrolment: { id: 'enr_web', code: '482913', expires_at: '2026-11-08T06:10:00Z' } }, 202)
      m.keys = [...m.keys, { kind: 'passkey', id: 'newcred', name: 'This device', platform: '', created_at: '2026-11-14T09:00:00Z' }]
      return json({ credential_id: 'newcred', name: 'This device', created_at: '2026-11-14T09:00:00Z' })
    }
    if (url === '/api/agents/keys/enrolments') return json({ enrolments: m.enrolments ?? [] })
    if (url === '/api/agents/keys/enrolments/enr_web') return json({ id: 'enr_web', kind: 'passkey', status: m.polls?.shift() ?? 'waiting' })
    const challenge = /^\/api\/agents\/keys\/enrolments\/([^/]+)\/challenge$/.exec(url)
    if (challenge) return json({ challenge: b64u(bytes(`enrol:${challenge[1]}`)), allow_credentials: passkeys().map((k) => k.id) })
    const decided = /^\/api\/agents\/keys\/enrolments\/([^/]+)\/(approve|decline)$/.exec(url)
    if (decided) {
      const en = (m.enrolments ?? []).find((x) => x.id === decided[1])!
      en.status = decided[2] === 'approve' ? 'approved' : 'declined'
      return json(en)
    }
    if (url === '/api/agents/pause-all') {
      m.paused = true
      return json({ all_paused: true })
    }
    if (url === '/api/agents/approvals') return json({ approvals: [] })
    if (url === '/api/agents' && method === 'GET')
      return json({
        workspace_balance_ulxc: 0, allocated_ulxc: 0, unallocated_ulxc: 0, spent_ulxc: 0, agents: [],
        ...(m.paused ? { all_paused_at: '2026-11-14T09:00:00Z' } : {}),
      })
    return new Response('null', { status: 404 })
  })
  return sent
}

const MAC = { kind: 'passkey', id: 'cred_mac', name: 'This Mac', platform: '', created_at: '2026-10-14T09:00:00Z', last_used_at: '2026-10-20T09:00:00Z' }
const IPAD = { kind: 'passkey', id: 'cred_ipad', name: 'iPad', platform: '', created_at: '2026-10-15T09:00:00Z' }
const PHONE = { kind: 'phone', id: 'dk_1', name: 'Work iPhone', platform: 'ios', created_at: '2026-10-16T09:00:00Z', last_used_at: '2026-10-21T09:00:00Z' }

function open() {
  window.history.pushState({}, '', '/settings/devices')
  render(<App />)
}

/** The authenticator: `get` signs whatever challenge it is given with cred_mac, `create` makes newcred. */
function authenticator() {
  Object.assign(window, { PublicKeyCredential: function PublicKeyCredential() {} })
  const get = vi.fn(async (opts: CredentialRequestOptions) => {
    const challenge = new TextDecoder().decode(opts.publicKey!.challenge as Uint8Array)
    return {
      rawId: bytes('cred_mac').buffer,
      response: { clientDataJSON: bytes(`cd-${challenge}`).buffer, authenticatorData: bytes('ad').buffer, signature: bytes(`sig-over-${challenge}`).buffer },
    }
  })
  const create = vi.fn(async () => ({
    rawId: bytes('newcred').buffer,
    response: { clientDataJSON: bytes('cd').buffer, getAuthenticatorData: () => bytes('ad').buffer, getPublicKey: () => bytes('pk').buffer, getPublicKeyAlgorithm: () => -7 },
  }))
  Object.defineProperty(navigator, 'credentials', { value: { get, create }, configurable: true })
  return { get, create }
}

afterEach(() => {
  cleanup()
  hideSnack()
  queryClient.clear()
  vi.restoreAllMocks()
  delete (window as { PublicKeyCredential?: unknown }).PublicKeyCredential
  window.history.pushState({}, '', '/')
})

describe('Approvals and devices (B57.43)', () => {
  it('says the keys in one line for every mix of them', () => {
    const k = (kind: 'passkey' | 'phone', id: string): ApprovalKey => ({ kind, id, name: id, platform: '', created_at: '2026-10-14T09:00:00Z' })
    const some = 'You approve with one of them; nothing is approved without one.'
    const one = 'You approve with it; nothing is approved without it.'
    expect(keysLine([k('passkey', 'a'), k('passkey', 'b'), k('phone', 'p')])).toBe(`2 passkeys and your phone’s key are registered. ${some}`)
    expect(keysLine([k('passkey', 'a'), k('passkey', 'b')])).toBe(`2 passkeys are registered. ${some}`)
    expect(keysLine([k('passkey', 'a'), k('phone', 'p')])).toBe(`1 passkey and your phone’s key are registered. ${some}`)
    expect(keysLine([k('passkey', 'a')])).toBe(`1 passkey is registered. ${one}`)
    expect(keysLine([k('phone', 'p')])).toBe(`Your phone’s key is registered. ${one}`)
    expect(keysLine([])).toBe('No key is registered, so nobody can approve. Add one.')
  })

  it('names every key with its kind, when it was added and last used, and removes a passkey after asking, unsigned', async () => {
    const sent = mockBff({ keys: [MAC, IPAD, PHONE] })
    const { get } = authenticator()
    open()

    expect(await screen.findByText('2 passkeys and your phone’s key are registered. You approve with one of them; nothing is approved without one.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Approvals and devices' }).closest('[data-design]')).toHaveAttribute('data-design', 'pocket')
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings')
    const keys = screen.getByTestId('approval-keys')
    expect(keys).toHaveTextContent('This MacPasskey · added 14 Oct · last used 20 Oct')
    expect(keys).toHaveTextContent('iPadPasskey · added 15 Oct · never used')
    expect(keys).toHaveTextContent('Work iPhonePhone key · added 16 Oct · last used 21 Oct')

    fireEvent.click(screen.getByRole('button', { name: 'Remove This Mac' }))
    const dialog = await screen.findByRole('dialog', { name: 'Remove “This Mac”?' })
    expect(dialog).toHaveTextContent('It can no longer approve anything.')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep it' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(sent).toEqual([])

    fireEvent.click(screen.getByRole('button', { name: 'Remove This Mac' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove it' }))
    expect(await screen.findByText('Removed: This Mac')).toBeInTheDocument()
    expect(sent).toEqual([{ method: 'DELETE', url: '/api/agents/passkeys', body: { credential_id: 'cred_mac' } }])
    expect(get).not.toHaveBeenCalled()
    await waitFor(() => expect(within(screen.getByTestId('approval-keys')).queryByText('This Mac')).toBeNull())
    expect(screen.getByText('1 passkey and your phone’s key are registered. You approve with one of them; nothing is approved without one.')).toBeInTheDocument()
  })

  it('removes the phone’s key with its revoke', async () => {
    const sent = mockBff({ keys: [MAC, IPAD, PHONE] })
    open()

    fireEvent.click(await screen.findByRole('button', { name: 'Remove Work iPhone' }))
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Remove “Work iPhone”?' })).getByRole('button', { name: 'Remove it' }))
    expect(await screen.findByText('Removed: Work iPhone')).toBeInTheDocument()
    expect(sent).toEqual([{ method: 'POST', url: '/api/money/devices/dk_1/revoke', body: null }])
  })

  it('keeps the last key: no Remove, and says why', async () => {
    mockBff({ keys: [PHONE] })
    open()

    expect(await screen.findByText('Your phone’s key is registered. You approve with it; nothing is approved without it.')).toBeInTheDocument()
    expect(screen.getByTestId('approval-keys')).toHaveTextContent('Work iPhone')
    expect(screen.getByText('It is your last key. With none, nobody could approve, so add another first.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Remove/ })).toBeNull()
  })

  it('says the same when Lens refuses a key as the last (409), and offers only Keep it', async () => {
    mockBff({ keys: [MAC, IPAD], refuse: true })
    open()

    fireEvent.click(await screen.findByRole('button', { name: 'Remove iPad' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove it' }))
    await waitFor(() => expect(dialog).toHaveTextContent('It is your last key. With none, nobody could approve, so add another first.'))
    expect(within(dialog).queryByRole('button', { name: 'Remove it' })).toBeNull()
  })

  it('adds this device with a passkey the workspace has signing for it', async () => {
    const sent = mockBff({ keys: [MAC] })
    const { create } = authenticator()
    open()

    fireEvent.click(await screen.findByRole('button', { name: 'Add this device' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add this device' })
    expect(dialog).toHaveTextContent(
      'This browser makes a passkey, and one you already have signs for it. From then on, Face ID, Touch ID or this device’s PIN asks each time you approve or decline.',
    )
    fireEvent.click(within(dialog).getByRole('button', { name: 'Make a passkey' }))
    expect(await screen.findByText('This browser now signs approvals')).toBeInTheDocument()
    expect(create).toHaveBeenCalledOnce()
    const reg = sent.find((s) => s.url === '/api/agents/passkeys' && s.method === 'POST')!
    expect((reg.body as { assertion: Record<string, string> }).assertion.signature).toBe(b64u(bytes('sig-over-reg')))
    expect(await screen.findByText('2 passkeys are registered. You approve with one of them; nothing is approved without one.')).toBeInTheDocument()
  })

  it('with only the phone’s key, adding this device waits for the phone with its code, and says so until it is let in', async () => {
    const polls = ['waiting', 'approved']
    const sent = mockBff({ keys: [PHONE], polls })
    const { get } = authenticator()
    open()

    fireEvent.click(await screen.findByRole('button', { name: 'Add this device' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add this device' })
    expect(dialog).toHaveTextContent('This browser makes a passkey, and your phone lets it in: only your phone’s key can sign for it now.')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Make a passkey' }))
    const waiting = 'Waiting for your phone. Open Talyvor on your phone and let this browser in. The code there should be 482913.'
    await waitFor(() => expect(dialog).toHaveTextContent(waiting))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    // Closed, the card still says it waits, until the phone answers.
    expect(await screen.findByText(/^Waiting for your phone/)).toHaveTextContent(waiting)
    expect(screen.getByRole('button', { name: 'Add this device' })).toBeDisabled()
    expect(sent.find((s) => s.url === '/api/agents/passkeys' && s.method === 'POST')!.body).not.toHaveProperty('assertion')
    expect(get).not.toHaveBeenCalled()
    expect(await screen.findByText('This browser now signs approvals', {}, { timeout: 6000 })).toBeInTheDocument()
    expect(screen.queryByText(/^Waiting for your phone/)).toBeNull()
    expect(polls).toEqual([])
  }, 10_000)

  it('lets a waiting phone in from Your phone, signed by this browser, and turns another away', async () => {
    const waiting = (id: string, name: string, code: string) => ({
      id, kind: 'device', name, platform: 'ios', code, status: 'waiting', created_at: '2026-11-08T06:00:00Z', expires_at: '2026-11-08T06:10:00Z',
    })
    const sent = mockBff({ keys: [MAC], devices: [], enrolments: [waiting('enr_1', 'iPhone', '551203'), waiting('enr_2', 'Pixel', '700114')] })
    authenticator()
    open()

    const phone = await screen.findByRole('region', { name: 'Your phone' })
    expect(await within(phone).findByText(/^Your iPhone asks/)).toHaveTextContent(
      /^Your iPhone asks to approve payments too\. Let it in only if you are adding it now and its code is 551203\.$/,
    )
    fireEvent.click(within(phone).getAllByRole('button', { name: 'Let it approve' })[0])
    expect(await screen.findByText('Your iPhone can approve now')).toBeInTheDocument()
    expect(sent.find((s) => s.url === '/api/agents/keys/enrolments/enr_1/approve')!.body).toEqual({
      assertion: {
        credential_id: b64u(bytes('cred_mac')),
        client_data_json: b64u(bytes('cd-enrol:enr_1')),
        authenticator_data: b64u(bytes('ad')),
        signature: b64u(bytes('sig-over-enrol:enr_1')),
      },
    })

    fireEvent.click(within(phone).getAllByRole('button', { name: 'Not this one' }).at(-1)!)
    expect(await screen.findByText('Not let in')).toBeInTheDocument()
    expect(sent.map((s) => s.url)).toContain('/api/agents/keys/enrolments/enr_2/decline')
    expect(sent.map((s) => s.url)).not.toContain('/api/agents/keys/enrolments/enr_2/approve')
  })

  it('says what an agent’s approval covers, and pauses every agent from Stop everything', async () => {
    const sent = mockBff({ keys: [MAC, PHONE] })
    open()

    const approval = await screen.findByRole('region', { name: 'An agent’s approval' })
    expect(approval).toHaveTextContent('One approval coversThat payment only')
    expect(approval).toHaveTextContent('Once you approve, it lasts24 hours')
    expect(approval).toHaveTextContent('A request you don’t answerExpires after 24 hours')
    expect(screen.getByRole('region', { name: 'Your phone' })).toHaveTextContent(
      'On your phone, the Talyvor app keeps a key in its secure chip that only Face ID can use, and signs your approvals with it.',
    )
    const stop = screen.getByRole('region', { name: 'Stop everything' })
    fireEvent.click(within(stop).getByRole('button', { name: 'Pause every agent' }))
    await waitFor(() => expect(sent.map((s) => s.url)).toContain('/api/agents/pause-all'))
    expect(await within(stop).findByRole('button', { name: 'Start every agent again' })).toBeInTheDocument()
  })

  it('is linked from Settings and from Approvals, and the Face ID card has left Approvals', async () => {
    mockBff({ keys: [MAC] })
    window.history.pushState({}, '', '/settings')
    render(<App />)
    expect(await screen.findByRole('link', { name: /^Approvals and devices/ })).toHaveAttribute('href', '/settings/devices')

    cleanup()
    window.history.pushState({}, '', '/approvals')
    render(<App />)
    expect(await screen.findByRole('link', { name: 'Approvals and devices' })).toHaveAttribute('href', '/settings/devices')
    expect(screen.queryByText('Face ID and notifications')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Add this device' })).toBeNull()
  })
})
