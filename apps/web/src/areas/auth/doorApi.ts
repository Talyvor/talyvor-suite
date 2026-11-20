// doorApi.ts — B61.26: the web's half of the BFF's door (apps/bff/phone_signin.go, B61.25). Lens holds every rule; the
// BFF relays its words, and the screens show them as they come, so a refusal says what Lens said to do next.

import { ApiError } from '../../lib/api'
import { b64u, fromB64u, passkeysSupported } from '../lens/passkeys'

/** A refusal from the door: Lens's sentence for the person, and its reason for the screen to act on. An ApiError, so
 *  the shared predicates (isSessionExpired, the retry rule) read it as they read every other. */
export class DoorError extends ApiError {
  constructor(
    status: number,
    readonly reason: string,
    sentence: string,
    path = '',
  ) {
    super(status, path)
    this.name = 'DoorError'
    this.message = sentence
  }
}

/** The sentence when the door gave none of its own. */
export const DOOR_FAILED = 'That did not work just now. Try again.'

async function door<T>(path: string, body: object = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    throw new DoorError(0, '', DOOR_FAILED)
  }
  return answer<T>(res, path)
}

/** The door's answer: its body, or its refusal as a DoorError in Lens's words. */
async function answer<T>(res: Response, path: string): Promise<T> {
  let got: Record<string, unknown> = {}
  try {
    got = ((await res.json()) as Record<string, unknown> | null) ?? {}
  } catch {
    // a body that is not JSON carries no sentence
  }
  if (!res.ok) {
    // A 5xx carries no sentence of the door's own, but for the passcode that cannot be set just now (B61.112).
    const worded = res.status < 500 || got.reason === 'passcode_unavailable'
    const said = typeof got.error === 'string' && got.error && worded ? got.error : DOOR_FAILED
    // B61.110 — Lens's own code, like country_not_served, when the door relayed one of Lens's refusals.
    const reason = typeof got.reason === 'string' ? got.reason : typeof got.code === 'string' ? got.code : ''
    throw new DoorError(res.status, reason, said, path)
  }
  return got as T
}

export interface PhoneStarted {
  expires_at: string
  sandbox: boolean
  /** Only the Sandbox sender hands its code back, for the screen to show under the Sandbox label. */
  sandbox_code?: string
}

export interface PhoneChecked {
  check: string
  has_person: boolean
}

export interface SignedIn {
  signed_in: boolean
  /** A new number's session: it may only finish sign-up. */
  signup_unfinished: boolean
}

export const phoneStart = (phone: string) => door<PhoneStarted>('/auth/phone/start', { phone })
export const phoneFinish = (phone: string, code: string) => door<PhoneChecked>('/auth/phone/finish', { phone, code })
export const phoneSignIn = (check: string, passcode: string) => door<SignedIn>('/auth/phone/signin', { check, passcode })
export const phoneJoin = (check: string, passcode: string) => door<SignedIn>('/auth/phone/join', { check, passcode })
/** Leaving the app for a page the BFF serves (an assistant's Connect page, /oauth/): a page load. Tests replace it. */
export const doorNav = { leave: (url: string) => window.location.assign(url) }

/** "Sign in again" (B61.29): the door, which lands back on returnTo. */
export const signInAgainHref = (returnTo: string) => `/signin?return_to=${encodeURIComponent(returnTo)}`

/** Ends this session first, so the door is a fresh sign-in (a key recovery needs one within 10 minutes), then opens it. */
export async function signInAgain(returnTo: string) {
  await fetch('/auth/logout', { method: 'POST' }).catch(() => undefined)
  doorNav.leave(signInAgainHref(returnTo))
}

/** return_to as the door may follow it: a path in this app, never another site; anything else is Home. */
export function safeReturnTo(raw: string | null): string | undefined {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\') || [...raw].some((c) => c.charCodeAt(0) < 32)) return undefined
  return raw
}

/** Sign-up's account, from the sign-up session: who it is for and the kind of money. */
export const signupAccount = (body: { account_type: string; money_kind: string; name: string; country: string; registration_number?: string }) =>
  door<{ account_id: string }>('/auth/signup/account', body)

/** What the browser says when the person closes the passkey prompt, or it times out. */
const PASSKEY_STOPPED = 'No passkey was used. Try again, or use your phone number.'

/** Signs in with a passkey: the browser offers the person's own key, with no number typed. */
export async function passkeySignIn(): Promise<SignedIn> {
  const c = await door<{ challenge: string; rp_id?: string }>('/auth/passkey/challenge')
  let cred: PublicKeyCredential | null
  try {
    cred = (await navigator.credentials.get({
      publicKey: { challenge: fromB64u(c.challenge), ...(c.rp_id ? { rpId: c.rp_id } : {}), userVerification: 'required', timeout: 60_000 },
    })) as PublicKeyCredential | null
  } catch {
    cred = null
  }
  if (!cred) throw new DoorError(0, 'no_key', PASSKEY_STOPPED)
  const res = cred.response as AuthenticatorAssertionResponse
  return door<SignedIn>('/auth/passkey/finish', {
    credential_id: b64u(cred.rawId),
    client_data_json: b64u(res.clientDataJSON),
    authenticator_data: b64u(res.authenticatorData),
    signature: b64u(res.signature),
  })
}

export interface MadeKey {
  credential_id: string
  name: string
  public_key: string
  client_data_json: string
  authenticator_data: string
}

/**
 * Makes a passkey for the signed-in person and keeps it as their sign-in key. The passcode proves it is them (Lens
 * B61.24); straight after a passkey sign-in the session's key ticket does instead. With an account, the BFF's challenge
 * is the account's approval-key challenge too (one ceremony), so the same key can also be given to approvals.
 */
export async function makeSignInKey(name: string, passcode?: string): Promise<MadeKey> {
  const c = await door<{ challenge: string; rp_id: string; user_handle: string }>('/auth/passkey/register/challenge', { kind: 'passkey' })
  let cred: PublicKeyCredential | null
  try {
    cred = (await navigator.credentials.create({
      publicKey: {
        challenge: fromB64u(c.challenge),
        rp: { id: c.rp_id, name: 'Talyvor' },
        user: { id: fromB64u(c.user_handle), name: 'Talyvor', displayName: name },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }], // ES256, the one Lens verifies
        authenticatorSelection: { userVerification: 'required', residentKey: 'required' },
        attestation: 'none',
        timeout: 60_000,
      },
    })) as PublicKeyCredential | null
  } catch {
    cred = null
  }
  if (!cred) throw new DoorError(0, 'no_key', 'No passkey was made. Try again, or skip this for now.')
  const res = cred.response as AuthenticatorAttestationResponse
  const spki = res.getPublicKey()
  if (!spki || res.getPublicKeyAlgorithm() !== -7) {
    throw new DoorError(0, 'no_key', 'This browser made a passkey Talyvor cannot check. Try another browser, or skip this for now.')
  }
  const key: MadeKey = {
    credential_id: b64u(cred.rawId),
    name,
    public_key: b64u(spki),
    client_data_json: b64u(res.clientDataJSON),
    authenticator_data: b64u(res.getAuthenticatorData()),
  }
  const { name: _n, ...passkey } = key
  await door('/auth/passkey/register', { name, passkey, ...(passcode ? { passcode } : {}) })
  return key
}

// ─── Settings, Security (B61.106, the BFF's B61.105 routes) ─────────────────

/** One of the person's sign-in keys, as Lens keeps it: a passkey, or a phone's key. */
export interface SignInKey {
  id: string
  kind: string
  name: string
  created_at: string
  last_used_at?: string
}

/** The person's sign-in keys. */
export async function signInKeys(): Promise<SignInKey[]> {
  let res: Response
  try {
    res = await fetch('/auth/passkey/keys', { headers: { Accept: 'application/json' } })
  } catch {
    throw new DoorError(0, '', DOOR_FAILED)
  }
  const got = await answer<{ keys?: SignInKey[] | null }>(res, '/auth/passkey/keys')
  if (got.keys !== null && !Array.isArray(got.keys)) throw new DoorError(0, '', 'Your passkeys could not be read. Reload the page to try again.')
  return got.keys ?? []
}

/** Removes one sign-in key, proved by the passcode. Lens refuses the last way in. */
export const removeSignInKey = (keyId: string, passcode: string) => door<{ removed: boolean }>('/auth/passkey/keys/remove', { key_id: keyId, passcode })
/** The passcode changed: the old one, then the new. */
export const changePasscode = (oldPasscode: string, passcode: string) => door<{ changed: boolean }>('/auth/passcode/change', { old_passcode: oldPasscode, passcode })
/** The person's number becomes the new one: its check (phoneStart and phoneFinish for it) and the passcode. */
export const changeNumber = (check: string, passcode: string) => door<{ changed: boolean; phone: string }>('/auth/phone/change-number', { check, passcode })

/** The name a new passkey is kept under, so the person can tell their keys apart. */
export function thisBrowserName(): string {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent
  const device = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'This device'
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : ''
  return browser ? `${device}, ${browser}` : device
}

// ─── what this browser remembers ───────────────────────────────────────────

const SIGNED_IN_HERE = 'talyvor.signed-in-here'
const PASSKEY_HERE = 'talyvor.passkey-here'

function flag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

function setFlag(key: string) {
  try {
    localStorage.setItem(key, '1')
  } catch {
    // private mode: the browser just will not remember
  }
}

/** Whether someone has signed in on this browser before: then the passkey is offered first. */
export const signedInHere = () => flag(SIGNED_IN_HERE)
export const rememberSignedInHere = () => setFlag(SIGNED_IN_HERE)
/** Whether a passkey was made on this browser: then "Sign in faster next time" is not asked again. */
export const passkeyHere = () => flag(PASSKEY_HERE)
export const rememberPasskeyHere = () => setFlag(PASSKEY_HERE)

export { passkeysSupported }

// ─── the passcode, held for the next key only ──────────────────────────────

let held: string | undefined

/** Holds the passcode the person just chose, in memory only, for the sign-up key step's one ceremony. Never stored. */
export function holdPasscode(p: string | undefined) {
  held = p
}

/** The held passcode, once: it is forgotten as it is taken. */
export function takePasscode(): string | undefined {
  const p = held
  held = undefined
  return p
}
