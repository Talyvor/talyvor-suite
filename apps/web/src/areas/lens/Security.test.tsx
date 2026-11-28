import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { App, queryClient } from '../../App'
import { bodyFor } from '../../populatedBff'
import { pressEverything } from '../../test/pressEverything'

// Security.test.tsx — B61.106: Settings, Security on the web. The person's passkeys (listed, removed with the passcode,
// never the last way in in Lens's words, one added here), their passcode (the old one, then the new one twice) and their
// phone number (the new number's code, then the passcode). The words are typed here, not imported.

type Answer = { status?: number; body: unknown }
type Handler = (body: Record<string, unknown>) => Answer

const KEYS = {
  keys: [
    { id: 'key_1', kind: 'passkey', name: 'Mac, Safari', created_at: '2026-10-14T09:00:00Z', last_used_at: '2026-10-20T08:00:00Z' },
    { id: 'key_2', kind: 'device', name: 'iPhone', created_at: '2026-10-15T09:00:00Z' },
  ],
}

/** The BFF: the console's reads from the populated fixture, the sign-in keys, and the Security POSTs by handler. */
function mockBff(routes: Record<string, Handler> = {}, keys: unknown = KEYS) {
  const sent: Array<{ url: string; body: Record<string, unknown> }> = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const json = (a: Answer) => new Response(JSON.stringify(a.body), { status: a.status ?? 200, headers: { 'Content-Type': 'application/json' } })
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>
      sent.push({ url, body })
      return routes[url] ? json(routes[url](body)) : new Response('null', { status: 404 })
    }
    if (url === '/auth/passkey/keys') return json({ body: keys })
    const got = bodyFor(url)
    return got === undefined ? new Response('null', { status: 404 }) : json({ body: got })
  })
  return sent
}

const refused = (status: number, reason: string, error: string): Handler => () => ({ status, body: { reason, error } })

/** Six digits into a group of boxes, as a paste lands. */
function paste(digits: string) {
  const first = screen.getAllByLabelText(/, digit 1 of 6$/).at(-1)!
  fireEvent.paste(first, { clipboardData: { getData: () => digits } })
}

async function open() {
  window.history.pushState({}, '', '/settings/security')
  render(<App />)
  await screen.findByRole('heading', { level: 2, name: 'Your devices' })
}

beforeEach(() => {
  queryClient.clear()
  localStorage.clear()
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  window.history.pushState({}, '', '/')
})

describe('Settings, Security: your passkeys', () => {
  it('lists each sign-in key and removes one with the passcode', async () => {
    const sent = mockBff({ '/auth/passkey/keys/remove': () => ({ body: { removed: true } }) })
    await open()
    const list = await screen.findByTestId('sign-in-keys')
    expect(within(list).getByText('Mac, Safari')).toBeInTheDocument()
    expect(within(list).getByText('iPhone')).toBeInTheDocument()
    expect(within(list).getByText(/^Phone key · added /)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Remove Mac, Safari' }))
    const dialog = await screen.findByRole('dialog', { name: 'Remove “Mac, Safari”?' })
    expect(within(dialog).getByText('It can no longer sign you in. Enter your passcode to remove it.')).toBeInTheDocument()
    paste('418263')
    await screen.findByText('Removed: Mac, Safari')
    expect(sent).toEqual([{ url: '/auth/passkey/keys/remove', body: { key_id: 'key_1', passcode: '418263' } }])
  })

  it('says Lens’s words when the key is the last way in, and keeps it', async () => {
    mockBff({ '/auth/passkey/keys/remove': refused(409, 'last_way_in', 'This key is your last way in. Set a passcode or add another key first.') })
    await open()
    fireEvent.click(await screen.findByRole('button', { name: 'Remove iPhone' }))
    paste('418263')
    expect(await screen.findByRole('alert')).toHaveTextContent('This key is your last way in. Set a passcode or add another key first.')
    expect(screen.getByRole('dialog', { name: 'Remove “iPhone”?' })).toBeInTheDocument()
  })

  it('adds a passkey on this browser, proved by the passcode', async () => {
    const sent = mockBff({
      '/auth/passkey/register/challenge': () => ({ body: { challenge: 'AQID', rp_id: 'localhost', user_handle: 'BAUG' } }),
      '/auth/passkey/register': () => ({ status: 201, body: { key_id: 'key_3' } }),
    })
    vi.stubGlobal('PublicKeyCredential', function PublicKeyCredential() {})
    const create = vi.fn().mockResolvedValue({
      rawId: new Uint8Array([9, 9]).buffer,
      response: {
        clientDataJSON: new Uint8Array([1]).buffer,
        getPublicKey: () => new Uint8Array([2]).buffer,
        getPublicKeyAlgorithm: () => -7,
        getAuthenticatorData: () => new Uint8Array([3]).buffer,
      },
    })
    Object.defineProperty(navigator, 'credentials', { configurable: true, value: { create, get: vi.fn() } })
    try {
      await open()
      fireEvent.click(screen.getByRole('button', { name: 'Add a passkey on this browser' }))
      await screen.findByRole('dialog', { name: 'Add a passkey on this browser' })
      expect(screen.getByText('Your browser asks for your fingerprint or face, then the passkey is added.')).toBeInTheDocument()
      paste('418263')
      await screen.findByText('Passkey added')
      const reg = sent.find((s) => s.url === '/auth/passkey/register')
      expect(reg?.body.passcode).toBe('418263')
      expect(create).toHaveBeenCalledTimes(1)
    } finally {
      Reflect.deleteProperty(navigator, 'credentials')
      vi.unstubAllGlobals()
    }
  })
})

describe('Settings, Security: your passcode', () => {
  it('asks the old passcode, then the new one twice, and changes it', async () => {
    const sent = mockBff({ '/auth/passcode/change': () => ({ body: { changed: true } }) })
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Change passcode' }))
    await screen.findByRole('dialog', { name: 'Enter your passcode' })
    paste('418263')
    await screen.findByRole('dialog', { name: 'Choose a new passcode' })
    paste('905172')
    await screen.findByRole('dialog', { name: 'Type it again' })
    paste('905172')
    await screen.findByText('Your passcode is changed')
    expect(sent).toEqual([{ url: '/auth/passcode/change', body: { old_passcode: '418263', passcode: '905172' } }])
  })

  it('asks the old passcode again in Lens’s words when it is wrong', async () => {
    mockBff({ '/auth/passcode/change': refused(400, 'wrong_passcode', 'That passcode is not right.') })
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Change passcode' }))
    await screen.findByRole('dialog', { name: 'Enter your passcode' })
    paste('111111')
    await screen.findByRole('dialog', { name: 'Choose a new passcode' })
    paste('905172')
    await screen.findByRole('dialog', { name: 'Type it again' })
    paste('905172')
    expect(await screen.findByRole('alert')).toHaveTextContent('That passcode is not right.')
    expect(screen.getByRole('dialog', { name: 'Enter your passcode' })).toBeInTheDocument()
  })
})

describe('Settings, Security: your phone number', () => {
  it('sends a code to the new number, then takes the passcode, and the number changes', async () => {
    const sent = mockBff({
      '/auth/phone/start': () => ({ body: { expires_at: '2026-11-20T12:10:00Z', sandbox: true, sandbox_code: '482913' } }),
      '/auth/phone/finish': () => ({ body: { check: 'chk_9', has_person: false, expires_at: '2026-11-20T12:10:00Z' } }),
      '/auth/phone/change-number': () => ({ body: { changed: true, phone: '+447700900999' } }),
    })
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Change number' }))
    await screen.findByRole('dialog', { name: 'Your new phone number' })
    fireEvent.change(screen.getByRole('textbox', { name: 'Your new phone number' }), { target: { value: '07700 900999' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }))
    await screen.findByRole('dialog', { name: 'Enter the code' })
    expect(screen.getByText('In Sandbox no text is sent. Your code is 482 913.')).toBeInTheDocument()
    paste('482913')
    await screen.findByRole('dialog', { name: 'Enter your passcode' })
    paste('418263')
    await screen.findByText('Your number is now +447700900999')
    expect(sent).toEqual([
      { url: '/auth/phone/start', body: { phone: '+447700900999' } },
      { url: '/auth/phone/finish', body: { phone: '+447700900999', code: '482913' } },
      { url: '/auth/phone/change-number', body: { check: 'chk_9', passcode: '418263' } },
    ])
  })

  it('starts the passcode in empty boxes, so a passcode typed a digit at a time is the one sent (B17.556)', async () => {
    const sent = mockBff({
      '/auth/phone/start': () => ({ body: { expires_at: '2026-11-20T12:10:00Z', sandbox: true, sandbox_code: '482913' } }),
      '/auth/phone/finish': () => ({ body: { check: 'chk_9', has_person: false, expires_at: '2026-11-20T12:10:00Z' } }),
      '/auth/phone/change-number': () => ({ body: { changed: true, phone: '+447700900999' } }),
    })
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Change number' }))
    fireEvent.change(await screen.findByRole('textbox', { name: 'Your new phone number' }), { target: { value: '07700 900999' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }))
    await screen.findByRole('dialog', { name: 'Enter the code' })
    paste('482913')
    await screen.findByRole('dialog', { name: 'Enter your passcode' })
    const box = (i: number) => screen.getByLabelText<HTMLInputElement>(`Passcode, digit ${i + 1} of 6`)
    expect([0, 1, 2, 3, 4, 5].map((i) => box(i).value)).toEqual(['', '', '', '', '', ''])
    for (const [i, d] of [...'418263'].entries()) fireEvent.change(box(i), { target: { value: d } })
    await screen.findByText('Your number is now +447700900999')
    expect(sent.filter((r) => r.url === '/auth/phone/change-number')).toEqual([{ url: '/auth/phone/change-number', body: { check: 'chk_9', passcode: '418263' } }])
  })

  it('goes back to the number in Lens’s words when another person holds it', async () => {
    mockBff({
      '/auth/phone/start': () => ({ body: { expires_at: '2026-11-20T12:10:00Z', sandbox: true, sandbox_code: '482913' } }),
      '/auth/phone/finish': () => ({ body: { check: 'chk_9', has_person: true, expires_at: '2026-11-20T12:10:00Z' } }),
      '/auth/phone/change-number': refused(409, 'held', 'That number or identity belongs to another person.'),
    })
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Change number' }))
    fireEvent.change(await screen.findByRole('textbox', { name: 'Your new phone number' }), { target: { value: '07700 900111' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }))
    await screen.findByRole('dialog', { name: 'Enter the code' })
    paste('482913')
    await screen.findByRole('dialog', { name: 'Enter your passcode' })
    paste('418263')
    expect(await screen.findByRole('alert')).toHaveTextContent('That number or identity belongs to another person.')
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Your new phone number' })).toBeInTheDocument())
  })
})

describe('Settings, Security: the page', () => {
  it('is drawn as Pocket Live’s panel: the rows that open a sheet, then Your devices, then the note', async () => {
    mockBff()
    vi.stubGlobal('PublicKeyCredential', function PublicKeyCredential() {})
    Object.defineProperty(navigator, 'credentials', { configurable: true, value: { create: vi.fn(), get: vi.fn() } })
    onTestFinished(() => {
      Reflect.deleteProperty(navigator, 'credentials')
      vi.unstubAllGlobals()
    })
    window.history.pushState({}, '', '/settings/security')
    render(<App />)
    const devices = await screen.findByRole('heading', { level: 2, name: 'Your devices' })
    const add = screen.getByRole('button', { name: 'Add a passkey on this browser' })
    const passcode = screen.getByRole('button', { name: 'Change passcode' })
    const number = screen.getByRole('button', { name: 'Change number' })
    expect(passcode).toHaveAccessibleDescription('6 digits, asked each time you sign in to Talyvor')
    const card = add.parentElement!.parentElement!
    expect(within(card).getByRole('button', { name: 'Change passcode' })).toBe(passcode)
    expect(within(card).getByRole('button', { name: 'Change number' })).toBe(number)
    const list = await screen.findByTestId('sign-in-keys')
    const mac = within(list).getByRole('button', { name: 'Remove Mac, Safari' })
    expect(mac).toHaveAccessibleDescription('Passkey · last used 20 Oct')
    const note = screen.getByText('Your passcode opens the phone app. It never approves a payment.')
    const follows = (x: Element, y: Element) => Boolean(x.compareDocumentPosition(y) & Node.DOCUMENT_POSITION_FOLLOWING)
    expect(follows(number, devices) && follows(devices, mac) && follows(mac, note)).toBe(true)
    expect(screen.queryByText('How you sign in to Talyvor.')).toBeNull()
  })

  it('is linked from Settings', async () => {
    mockBff()
    window.history.pushState({}, '', '/settings')
    render(<App />)
    expect(await screen.findByRole('link', { name: /Security/ })).toHaveAttribute('href', '/settings/security')
  })

  it('every control on the page does something', async () => {
    const report = await pressEverything('/settings/security')
    expect(report.dead).toEqual([])
    expect(report.pressed).toBeGreaterThan(4)
  }, 60_000)
})
