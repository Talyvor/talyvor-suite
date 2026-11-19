import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'
import { doorNav } from './doorApi'

// Door.test.tsx — B61.26: the web's door. The phone number, the code, the passcode (a known number) or a passcode
// chosen twice (a new one), "Sign in with a passkey", "Sign in faster next time", and each refusal in Lens's words.
// The words are typed here, not imported, so a changed word is red until the design says so too.

type Answer = { status?: number; body: unknown }
type Handler = (body: Record<string, unknown>) => Answer

function mockDoor(routes: Record<string, Handler> = {}, me: Record<string, unknown> = { mode: 'oidc', authenticated: false, user: null, signup_open: true }) {
  const sent: Array<{ url: string; body: Record<string, unknown> }> = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const json = (a: Answer) => new Response(JSON.stringify(a.body), { status: a.status ?? 200, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ body: me })
    if (init?.method === 'POST' && routes[url]) {
      const body = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>
      sent.push({ url, body })
      return json(routes[url](body))
    }
    return new Response('null', { status: 404 })
  })
  return sent
}

const START: Handler = () => ({ body: { expires_at: '2026-11-16T12:10:00Z', sandbox: true, sandbox_code: '482913' } })
const known: Handler = () => ({ body: { check: 'chk_1', has_person: true, expires_at: '2026-11-16T12:10:00Z' } })
const fresh: Handler = () => ({ body: { check: 'chk_1', has_person: false, expires_at: '2026-11-16T12:10:00Z' } })
const SIGNED: Handler = () => ({ body: { signed_in: true, signup_unfinished: false, account_id: 'ws_1' } })

function at(path: string) {
  window.history.pushState({}, '', path)
  return render(<App />)
}

/** Six digits into a group of boxes: a paste, as the browser's fill or a copied code arrives. */
function paste(group: string, digits: string) {
  fireEvent.paste(screen.getByLabelText(`${group}, digit 1 of 6`), { clipboardData: { getData: () => digits } })
}

/** Six digits typed one box at a time. */
function typeDigits(group: string, digits: string) {
  digits.split('').forEach((d, i) => fireEvent.change(screen.getByLabelText(`${group}, digit ${i + 1} of 6`), { target: { value: d } }))
}

async function throughPhone() {
  await screen.findByRole('heading', { level: 1, name: 'What’s your phone number?' })
  fireEvent.change(screen.getByLabelText('Your phone number'), { target: { value: '07700 900456' } })
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  await screen.findByRole('heading', { level: 1, name: 'Enter the code' })
}

beforeEach(() => {
  queryClient.clear()
  localStorage.clear()
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  Reflect.deleteProperty(navigator, 'credentials')
  window.history.pushState({}, '', '/')
})

describe('the door: one field and one button', () => {
  it('asks for the phone number with the country picker, and sends the number with its country code', async () => {
    const sent = mockDoor({ '/auth/phone/start': START })
    at('/signin')
    await screen.findByRole('heading', { level: 1, name: 'What’s your phone number?' })
    expect(screen.getByText('We text you a code to check it’s yours.')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Country' })).toHaveValue('GB')
    expect(screen.getAllByRole('button', { name: 'Continue' })).toHaveLength(1)
    expect(screen.getByText('Type your phone number.')).toBeInTheDocument()
    expect(document.querySelector('input[type="password"]')).toBeNull()
    await throughPhone()
    expect(sent).toEqual([{ url: '/auth/phone/start', body: { phone: '+447700900456' } }])
    expect(screen.getByText('We sent it to +44 7700 900456.')).toBeInTheDocument()
  })
})

describe('the code', () => {
  it('shows the Sandbox code under the Sandbox label, takes a paste into all six boxes, and sends it', async () => {
    const sent = mockDoor({ '/auth/phone/start': START, '/auth/phone/finish': known })
    at('/signin')
    await throughPhone()
    expect(screen.getByText('Sandbox')).toBeInTheDocument()
    expect(screen.getByText('In Sandbox no text is sent. Your code is 482 913.')).toBeInTheDocument()
    const boxes = within(screen.getByRole('group', { name: 'The code' })).getAllByRole('textbox')
    expect(boxes).toHaveLength(6)
    // The browser's fill from the text lands in the first box.
    expect(boxes[0]).toHaveAttribute('autocomplete', 'one-time-code')
    paste('The code', '482 913')
    await screen.findByRole('heading', { level: 1, name: 'Enter your passcode' })
    expect(sent[1]).toEqual({ url: '/auth/phone/finish', body: { phone: '+447700900456', code: '482913' } })
  })

  it('offers "Send again" only after 30 seconds, and sends a new code then', async () => {
    const sent = mockDoor({ '/auth/phone/start': START })
    at('/signin')
    await throughPhone()
    const again = screen.getByRole('button', { name: 'Send again' })
    expect(again).toBeDisabled()
    expect(screen.getByText(/You can ask for a new code in (30|29) seconds\./)).toBeInTheDocument()
    const t0 = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(t0 + 31_000)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send again' })).toBeEnabled(), { timeout: 2500 })
    fireEvent.click(screen.getByRole('button', { name: 'Send again' }))
    await waitFor(() => expect(sent.filter((s) => s.url === '/auth/phone/start')).toHaveLength(2))
  })

  it('a wrong code says Lens’s words and clears the boxes for another try', async () => {
    mockDoor({
      '/auth/phone/start': START,
      '/auth/phone/finish': () => ({ status: 400, body: { error: 'That code is not right. Check the text and try again.', reason: 'wrong_code' } }),
    })
    at('/signin')
    await throughPhone()
    paste('The code', '111111')
    expect(await screen.findByRole('alert')).toHaveTextContent('That code is not right. Check the text and try again.')
    await waitFor(() => expect(screen.getByLabelText('The code, digit 1 of 6')).toHaveValue(''))
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Enter the code')
  })

  it('too many codes asked for says when to try again, in Lens’s words', async () => {
    mockDoor({
      '/auth/phone/start': () => ({ status: 429, body: { error: 'Too many codes asked for. Try again at 2026-11-16T13:00:00Z.', reason: 'limited' } }),
    })
    at('/signin')
    await screen.findByRole('heading', { level: 1, name: 'What’s your phone number?' })
    fireEvent.change(screen.getByLabelText('Your phone number'), { target: { value: '7700900456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many codes asked for. Try again at 2026-11-16T13:00:00Z.')
  })
})

describe('the passcode', () => {
  it('a known number: six masked numeric digits sign in, and a wrong one says so and clears', async () => {
    let tries = 0
    const sent = mockDoor({
      '/auth/phone/start': START,
      '/auth/phone/finish': known,
      '/auth/phone/signin': () =>
        ++tries === 1 ? { status: 400, body: { error: 'That passcode is not right.', reason: 'wrong_passcode' } } : SIGNED({}),
    })
    at('/signin')
    await throughPhone()
    paste('The code', '482913')
    await screen.findByRole('heading', { level: 1, name: 'Enter your passcode' })
    for (let i = 1; i <= 6; i++) {
      const box = screen.getByLabelText(`Passcode, digit ${i} of 6`)
      expect(box).toHaveAttribute('type', 'password')
      expect(box).toHaveAttribute('inputmode', 'numeric')
    }
    // Letters are not digits: nothing lands.
    fireEvent.change(screen.getByLabelText('Passcode, digit 1 of 6'), { target: { value: 'a' } })
    expect(screen.getByLabelText('Passcode, digit 1 of 6')).toHaveValue('')
    typeDigits('Passcode', '000000')
    expect(await screen.findByRole('alert')).toHaveTextContent('That passcode is not right.')
    await waitFor(() => expect(screen.getByLabelText('Passcode, digit 1 of 6')).toHaveValue(''))
    typeDigits('Passcode', '135790')
    await waitFor(() => expect(window.location.pathname).toBe('/'))
    expect(sent.filter((s) => s.url === '/auth/phone/signin').map((s) => s.body)).toEqual([
      { check: 'chk_1', passcode: '000000' },
      { check: 'chk_1', passcode: '135790' },
    ])
  })

  it('a new number: the passcode is typed twice, two that differ start again, then it joins and goes on to sign-up', async () => {
    const sent = mockDoor({
      '/auth/phone/start': START,
      '/auth/phone/finish': fresh,
      '/auth/phone/join': () => ({ body: { signed_in: true, signup_unfinished: true, account_id: '' } }),
    })
    at('/signup')
    await throughPhone()
    paste('The code', '482913')
    await screen.findByRole('heading', { level: 1, name: 'Choose a passcode' })
    expect(screen.getByText('6 digits. You type it each time you sign in to Talyvor.')).toBeInTheDocument()
    typeDigits('Passcode', '135790')
    await screen.findByRole('heading', { level: 1, name: 'Type it again' })
    typeDigits('Passcode', '135791')
    await screen.findByRole('heading', { level: 1, name: 'Choose a passcode' })
    expect(screen.getByRole('alert')).toHaveTextContent('Those two were not the same. Choose a passcode again.')
    expect(sent.some((s) => s.url === '/auth/phone/join')).toBe(false)
    typeDigits('Passcode', '135790')
    await screen.findByRole('heading', { level: 1, name: 'Type it again' })
    typeDigits('Passcode', '135790')
    await waitFor(() => expect(sent.filter((s) => s.url === '/auth/phone/join').map((s) => s.body)).toEqual([{ check: 'chk_1', passcode: '135790' }]))
    await waitFor(() => expect(window.location.pathname).toBe('/signup'))
  })

  it('a passcode Lens will not take is chosen again, with Lens’s reason', async () => {
    mockDoor({
      '/auth/phone/start': START,
      '/auth/phone/finish': fresh,
      '/auth/phone/join': () => ({ status: 400, body: { error: 'Choose six digits that are not all the same or in a row.', reason: 'weak_passcode' } }),
    })
    at('/signup')
    await throughPhone()
    paste('The code', '482913')
    await screen.findByRole('heading', { level: 1, name: 'Choose a passcode' })
    typeDigits('Passcode', '123456')
    await screen.findByRole('heading', { level: 1, name: 'Type it again' })
    typeDigits('Passcode', '123456')
    await screen.findByRole('heading', { level: 1, name: 'Choose a passcode' })
    expect(screen.getByRole('alert')).toHaveTextContent('Choose six digits that are not all the same or in a row.')
  })

  it('a passcode that cannot be set just now keeps the person on "Type it again", and the next try uses the same check', async () => {
    let tries = 0
    const sent = mockDoor({
      '/auth/phone/start': START,
      '/auth/phone/finish': fresh,
      '/auth/phone/join': () =>
        ++tries === 1
          ? { status: 503, body: { error: "We can't set passcodes just now. Try again in a few minutes.", reason: 'passcode_unavailable' } }
          : { body: { signed_in: true, signup_unfinished: true, account_id: '' } },
    })
    at('/signup')
    await throughPhone()
    paste('The code', '482913')
    await screen.findByRole('heading', { level: 1, name: 'Choose a passcode' })
    typeDigits('Passcode', '135790')
    await screen.findByRole('heading', { level: 1, name: 'Type it again' })
    typeDigits('Passcode', '135790')
    expect(await screen.findByRole('alert')).toHaveTextContent("We can't set passcodes just now. Try again in a few minutes.")
    expect(screen.getByRole('heading', { level: 1, name: 'Type it again' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByLabelText('Passcode, digit 1 of 6')).toBeEnabled())
    typeDigits('Passcode', '135790')
    await waitFor(() =>
      expect(sent.filter((x) => x.url === '/auth/phone/join').map((x) => x.body)).toEqual([
        { check: 'chk_1', passcode: '135790' },
        { check: 'chk_1', passcode: '135790' },
      ]),
    )
    expect(sent.filter((x) => x.url === '/auth/phone/start')).toHaveLength(1)
  })
})

/** A browser with passkeys: get and create answer with fixed bytes. */
function passkeyBrowser() {
  const bytes = (n: number) => new Uint8Array([n, n, n]).buffer
  vi.stubGlobal('PublicKeyCredential', function PublicKeyCredential() {})
  const get = vi.fn(async () => ({ rawId: bytes(1), response: { clientDataJSON: bytes(2), authenticatorData: bytes(3), signature: bytes(4) } }))
  const create = vi.fn(async () => ({
    rawId: bytes(5),
    response: { clientDataJSON: bytes(6), getPublicKey: () => bytes(7), getPublicKeyAlgorithm: () => -7, getAuthenticatorData: () => bytes(8) },
  }))
  Object.defineProperty(navigator, 'credentials', { value: { get, create }, configurable: true })
  return { get, create }
}

describe('the passkey', () => {
  it('"Sign in with a passkey" is above the phone field, the main action once this browser has signed in, and signs in with one touch', async () => {
    const { get } = passkeyBrowser()
    localStorage.setItem('talyvor.signed-in-here', '1')
    const sent = mockDoor({
      '/auth/passkey/challenge': () => ({ body: { challenge: 'AAAA', rp_id: 'app.talyvor.com', user_verification: 'required' } }),
      '/auth/passkey/finish': SIGNED,
    })
    at('/signin')
    const key = await screen.findByRole('button', { name: 'Sign in with a passkey' })
    expect(key.compareDocumentPosition(screen.getByLabelText('Your phone number')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(key).toHaveClass('bg-primary')
    expect(screen.getByRole('button', { name: 'Continue' })).not.toHaveClass('bg-primary')
    fireEvent.click(key)
    await waitFor(() => expect(window.location.pathname).toBe('/'))
    expect(get).toHaveBeenCalledWith({ publicKey: expect.objectContaining({ rpId: 'app.talyvor.com', userVerification: 'required' }) })
    expect(sent.map((s) => s.url)).toEqual(['/auth/passkey/challenge', '/auth/passkey/finish'])
    expect(sent[1].body).toEqual({ credential_id: 'AQEB', client_data_json: 'AgIC', authenticator_data: 'AwMD', signature: 'BAQE' })
  })

  it('for a browser that has not signed in here, the phone number is the main action and the passkey is still offered', async () => {
    passkeyBrowser()
    mockDoor()
    at('/signin')
    expect(await screen.findByRole('button', { name: 'Sign in with a passkey' })).not.toHaveClass('bg-primary')
    expect(screen.getByRole('button', { name: 'Continue' })).toHaveClass('bg-primary')
  })

  it('a refused key says Lens’s words', async () => {
    passkeyBrowser()
    mockDoor({
      '/auth/passkey/challenge': () => ({ body: { challenge: 'AAAA', rp_id: 'app.talyvor.com' } }),
      '/auth/passkey/finish': () => ({ status: 401, body: { error: 'That key is not one Talyvor knows. Sign in with your phone number.', reason: 'no_key' } }),
    })
    at('/signin')
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in with a passkey' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('That key is not one Talyvor knows. Sign in with your phone number.')
  })

  it('after a passcode sign-in, "Sign in faster next time" makes a passkey with the passcode as proof, or is skipped', async () => {
    const { create } = passkeyBrowser()
    const sent = mockDoor({
      '/auth/phone/start': START,
      '/auth/phone/finish': known,
      '/auth/phone/signin': SIGNED,
      '/auth/passkey/register/challenge': () => ({ body: { challenge: 'AAAA', rp_id: 'app.talyvor.com', user_handle: 'CQkJ' } }),
      '/auth/passkey/register': () => ({ status: 201, body: { id: 'pk_1' } }),
    })
    at('/signin')
    await throughPhone()
    paste('The code', '482913')
    await screen.findByRole('heading', { level: 1, name: 'Enter your passcode' })
    typeDigits('Passcode', '135790')
    await screen.findByRole('heading', { level: 1, name: 'Sign in faster next time' })
    expect(screen.getByRole('button', { name: 'Not now' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Make a passkey' }))
    await waitFor(() => expect(window.location.pathname).toBe('/'))
    expect(create).toHaveBeenCalledWith({
      publicKey: expect.objectContaining({ authenticatorSelection: { userVerification: 'required', residentKey: 'required' } }),
    })
    const kept = sent.find((s) => s.url === '/auth/passkey/register')!
    expect(kept.body).toMatchObject({ passcode: '135790', passkey: { credential_id: 'BQUF', public_key: 'BwcH', client_data_json: 'BgYG', authenticator_data: 'CAgI' } })
    expect(localStorage.getItem('talyvor.passkey-here')).toBe('1')
  })

  it('"Not now" goes on without a passkey', async () => {
    passkeyBrowser()
    const sent = mockDoor({ '/auth/phone/start': START, '/auth/phone/finish': known, '/auth/phone/signin': SIGNED })
    at('/signin')
    await throughPhone()
    paste('The code', '482913')
    await screen.findByRole('heading', { level: 1, name: 'Enter your passcode' })
    typeDigits('Passcode', '135790')
    fireEvent.click(await screen.findByRole('button', { name: 'Not now' }))
    await waitFor(() => expect(window.location.pathname).toBe('/'))
    expect(sent.some((s) => s.url.startsWith('/auth/passkey'))).toBe(false)
  })
})

describe('B61.29 — Google sign-in is gone', () => {
  it('the door offers no Google, whatever /auth/me says', async () => {
    mockDoor({}, { mode: 'oidc', authenticated: false, user: null, signup_open: true, google_signin: true })
    at('/signin')
    await screen.findByRole('heading', { level: 1, name: 'What’s your phone number?' })
    expect(screen.queryByText('Continue with Google')).toBeNull()
    expect(document.querySelector('a[href^="/auth/login"]')).toBeNull()
  })

  it('a sign-in that started at an assistant’s Connect page goes back to it, as a page load', async () => {
    const leave = vi.spyOn(doorNav, 'leave').mockImplementation(() => {})
    mockDoor({ '/auth/phone/start': START, '/auth/phone/finish': known, '/auth/phone/signin': SIGNED })
    const connect = '/oauth/authorize?client_id=c1&state=s1'
    at(`/signin?return_to=${encodeURIComponent(connect)}`)
    await throughPhone()
    paste('The code', '482913')
    await screen.findByRole('heading', { level: 1, name: 'Enter your passcode' })
    typeDigits('Passcode', '135790')
    await waitFor(() => expect(leave).toHaveBeenCalledWith(connect))
  })

  it('a return_to that leaves the app is not followed', async () => {
    const leave = vi.spyOn(doorNav, 'leave').mockImplementation(() => {})
    mockDoor({ '/auth/phone/start': START, '/auth/phone/finish': known, '/auth/phone/signin': SIGNED })
    at(`/signin?return_to=${encodeURIComponent('//evil.example/oauth/authorize')}`)
    await throughPhone()
    paste('The code', '482913')
    await screen.findByRole('heading', { level: 1, name: 'Enter your passcode' })
    typeDigits('Passcode', '135790')
    await waitFor(() => expect(window.location.pathname).toBe('/'))
    expect(leave).not.toHaveBeenCalled()
  })
})

describe('sign-up’s key step, for a person who joined by phone', () => {
  it('one passkey is both the sign-in key (proved by the passcode just chosen) and the account’s approval key', async () => {
    const { create } = passkeyBrowser()
    const sent: Array<{ url: string; body: Record<string, unknown> }> = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
      if (url === '/auth/me') {
        const joined = sent.some((x) => x.url === '/auth/phone/join')
        return json({ mode: 'oidc', authenticated: joined, user: joined ? { sub: 'person:p1', email: '' } : null, signup_open: true, ...(joined && !sent.some((x) => x.url === '/auth/signup/account') ? { signup_unfinished: true } : {}) })
      }
      if (url === '/api/agents/passkeys' && init?.method !== 'POST') return json({ passkeys: [] })
      if (url === '/api/money/devices') return json({ devices: [] })
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>
        sent.push({ url, body })
        const answers: Record<string, unknown> = {
          '/auth/phone/start': START({}).body,
          '/auth/phone/finish': fresh({}).body,
          '/auth/phone/join': { signed_in: true, signup_unfinished: true },
          '/auth/signup/account': { account_id: 'ws_1', created: true },
          '/auth/passkey/register/challenge': { challenge: 'AAAA', rp_id: 'app.talyvor.com', user_handle: 'CQkJ' },
          '/auth/passkey/register': { id: 'pk_1' },
          '/api/agents/passkeys': { id: 'pk_1', name: 'This device', created_at: '2026-11-16T12:00:00Z' },
        }
        if (url in answers) return json(answers[url])
      }
      return new Response('null', { status: 404 })
    })
    at('/signup')
    await throughPhone()
    paste('The code', '482913')
    await screen.findByRole('heading', { level: 1, name: 'Choose a passcode' })
    typeDigits('Passcode', '135790')
    await screen.findByRole('heading', { level: 1, name: 'Type it again' })
    typeDigits('Passcode', '135790')
    await screen.findByRole('heading', { level: 1, name: 'Who is this account for?' })
    fireEvent.click(screen.getByRole('radio', { name: /^Personal/ }))
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Maya Lind' } })
    fireEvent.change(screen.getByLabelText('Country'), { target: { value: 'GB' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.click(await screen.findByRole('radio', { name: /^Hybrid/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    const make = await screen.findByRole('button', { name: 'Make a passkey' })
    await waitFor(() => expect(make).toBeEnabled())
    fireEvent.click(make)
    await waitFor(() => expect(sent.some((x) => x.url === '/api/agents/passkeys')).toBe(true))
    expect(create).toHaveBeenCalledTimes(1)
    const signIn = sent.find((x) => x.url === '/auth/passkey/register')!
    const approvals = sent.find((x) => x.url === '/api/agents/passkeys')!
    expect(signIn.body).toMatchObject({ passcode: '135790', passkey: { credential_id: 'BQUF' } })
    expect(approvals.body).toMatchObject({ credential_id: 'BQUF', public_key: 'BwcH' })
  })
})

// B57.184 — the door in Pocket: Pocket Live's phone `su0`, `su1`, `su2` and `lock`, one question per page in the auth card.
describe('the door, drawn as Pocket Live’s su steps', () => {
  it('asks the question in the 30px display step, with the globe and the calling code as the country picker’s face', async () => {
    mockDoor()
    at('/signin')
    const title = await screen.findByRole('heading', { level: 1, name: 'What’s your phone number?' })
    expect(title).toHaveClass('text-pocket-question')
    const face = screen.getByTestId('door-country')
    expect(face).toHaveTextContent(/^\+44$/)
    expect(face.querySelector('svg[data-icon="globe"]')).not.toBeNull()
    // The field is named for a screen reader, and shows the reference's example number instead of a visible label.
    expect(screen.getByText('Your phone number')).toHaveClass('sr-only')
    expect(screen.getByLabelText('Your phone number')).toHaveAttribute('placeholder', '7700 900456')
    fireEvent.change(screen.getByRole('combobox', { name: 'Country' }), { target: { value: 'MD' } })
    expect(face).toHaveTextContent(/^\+373$/)
  })

  it('puts Back and the Sandbox label across the top, and the Sandbox code in a note', async () => {
    mockDoor({ '/auth/phone/start': START })
    at('/signin')
    await throughPhone()
    const top = screen.getByTestId('door-top')
    expect(within(top).getByText('Sandbox')).toBeInTheDocument()
    expect(screen.getByText('In Sandbox no text is sent. Your code is 482 913.').closest('[data-door-note]')).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'Use another number' })).toBeNull()
    fireEvent.click(within(top).getByRole('button', { name: 'Back' }))
    await screen.findByRole('heading', { level: 1, name: 'What’s your phone number?' })
  })

  it('goes Back from "Type it again" to "Choose a passcode"', async () => {
    mockDoor({ '/auth/phone/start': START, '/auth/phone/finish': fresh })
    at('/signin')
    await throughPhone()
    paste('The code', '482913')
    await screen.findByRole('heading', { level: 1, name: 'Choose a passcode' })
    paste('Passcode', '271828')
    await screen.findByRole('heading', { level: 1, name: 'Type it again' })
    fireEvent.click(within(screen.getByTestId('door-top')).getByRole('button', { name: 'Back' }))
    await screen.findByRole('heading', { level: 1, name: 'Choose a passcode' })
  })
})
