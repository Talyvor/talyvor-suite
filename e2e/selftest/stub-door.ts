// B61.28 SELF-TEST — the stand-in Lens's front door (talyvor-lens B61.22 to B61.24, cmd/lens phone_signin_routes.go), as
// the BFF's door (apps/bff phone_signin.go) calls it on the provision secret: a code by text, always the Sandbox sender
// here, so the code comes back for the screen; a ticket for a right code; a person for the ticket and its passcode; the
// passcode at the phone's lock; a passkey kept as the person's sign-in key, and a sign-in with it, its signature checked
// over the challenge as Lens's passkey.VerifyAssertion does.
//
// Lens's rules, as the door scenarios meet them: one text to a number every 30 seconds; five wrong codes end a check;
// a passcode is six digits, not one repeated, not a run, not the number's end; wrong passcodes count each way in (with
// a ticket, at the lock) and from the fifth every try that way waits 15 minutes, the right one too.

import { createHash, createPublicKey, randomBytes, randomInt, verify } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

type Json = (res: ServerResponse, status: number, body: unknown, headers?: Record<string, string>) => void

const TEXT_GAP_MS = 30_000
const CODE_LIFE_MS = 10 * 60_000
const TICKET_LIFE_MS = 5 * 60_000
const MAX_WRONG_CODES = 5
const WAIT_AFTER = 5
const WAIT_MS = 15 * 60_000

interface Count { wrong: number; lastWrong: number }
interface Person {
  id: string
  identity: string
  phone: string
  passcode: string
  ways: Record<'ticket' | 'lock', Count>
}

const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d+Z$/, 'Z')
const token = () => randomBytes(18).toString('base64url')

/** cmd/lens phone_signin_routes.go's weak passcode words. */
function weak(passcode: string, phone: string): string | undefined {
  if (!/^\d{6}$/.test(passcode)) return 'A passcode is 6 digits.'
  if (new Set(passcode).size === 1) return 'Choose a passcode that is not one digit repeated.'
  const steps = [...passcode].slice(1).map((d, i) => Number(d) - Number(passcode[i]))
  if (steps.every((s) => s === 1) || steps.every((s) => s === -1)) return 'Choose a passcode that is not a run like 123456 or 654321.'
  if (phone.endsWith(passcode)) return 'Choose a passcode that is not the end of your phone number.'
  return undefined
}

export class StubDoor {
  private readonly codes = new Map<string, { code: string; wrong: number; expires: number }>()
  /** When each number was last sent a text: the 30-second gap outlives the code. */
  private readonly texted = new Map<string, number>()
  private readonly tickets = new Map<string, { phone: string; expires: number }>()
  private readonly people = new Map<string, Person>()
  private readonly byPhone = new Map<string, string>()
  private readonly keys = new Map<string, { personID: string; spki: Buffer }>()
  private readonly challenges = new Map<string, { personID: string; expires: number }>()

  private readonly secret: string
  private readonly rpID: string
  private readonly json: Json

  constructor(secret: string, rpID: string, json: Json) {
    this.secret = secret
    this.rpID = rpID
    this.json = json
  }

  /** Answers one of the door's routes; false for any other path. */
  async route(req: IncomingMessage, res: ServerResponse, p: string, read: (req: IncomingMessage) => Promise<string>): Promise<boolean> {
    if (!p.startsWith('/v1/auth/phone/') && !p.startsWith('/v1/auth/passkey/') && !p.startsWith('/v1/auth/passcode/')) return false
    if (req.method !== 'POST') return false
    if (this.secret === '' || req.headers['x-gateway-auth'] !== this.secret) {
      this.json(res, 401, { error: 'provisioning credentials required' })
      return true
    }
    const body = JSON.parse((await read(req)) || '{}') as Record<string, unknown>
    const s = (k: string) => (typeof body[k] === 'string' ? (body[k] as string).trim() : '')
    const now = Date.now()
    const refuse = (status: number, reason: string, error: string, extra: Record<string, string> = {}, headers: Record<string, string> = {}) => {
      this.json(res, status, { error, reason, ...extra }, headers)
      return true
    }
    const ok = (out: unknown) => {
      this.json(res, 200, out)
      return true
    }

    switch (p) {
      case '/v1/auth/phone/start': {
        const phone = s('phone')
        if (!/^\+\d{8,15}$/.test(phone)) return refuse(400, 'phone', 'That is not a phone number in a country.')
        const last = this.texted.get(phone)
        if (last !== undefined && now - last < TEXT_GAP_MS) {
          const at = last + TEXT_GAP_MS
          return refuse(429, 'limited', `Too many codes asked for. Try again at ${iso(at)}.`, { retry_at: iso(at) },
            { 'Retry-After': String(Math.max(1, Math.ceil((at - now) / 1000))) })
        }
        const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
        this.codes.set(phone, { code, wrong: 0, expires: now + CODE_LIFE_MS })
        this.texted.set(phone, now)
        return ok({ expires_at: iso(now + CODE_LIFE_MS), sender: 'sandbox', sandbox_code: code })
      }
      case '/v1/auth/phone/finish': {
        const phone = s('phone')
        const c = this.codes.get(phone)
        if (c === undefined || c.expires <= now) return refuse(400, 'code_ended', 'That code has ended. Ask for a new one.')
        if (c.code !== s('code')) {
          c.wrong++
          if (c.wrong >= MAX_WRONG_CODES) this.codes.delete(phone)
          return refuse(400, 'wrong_code', 'That code is not right. Check the text and try again.')
        }
        this.codes.delete(phone)
        const ticket = token()
        this.tickets.set(ticket, { phone, expires: now + TICKET_LIFE_MS })
        return ok({ ticket, expires_at: iso(now + TICKET_LIFE_MS), has_person: this.byPhone.has(phone), sandbox: true })
      }
      case '/v1/auth/phone/person': {
        const t = this.tickets.get(s('ticket'))
        if (t === undefined || t.expires <= now) return refuse(400, 'ticket_ended', 'That confirmation has ended. Confirm the number again.')
        const known = this.byPhone.get(t.phone)
        if (known !== undefined) {
          const person = this.people.get(known)!
          if (!this.tryPasscode(res, person, 'ticket', s('passcode'), now)) return true
          this.tickets.delete(s('ticket'))
          return ok({ person: { id: person.id, identity: person.identity }, created: false })
        }
        const passcode = s('passcode')
        if (passcode === '') return refuse(400, 'passcode_needed', 'Enter your passcode.')
        const why = weak(passcode, t.phone)
        if (why !== undefined) return refuse(400, 'weak_passcode', why)
        const id = `per_${token().slice(0, 12)}`
        const person: Person = { id, identity: s('identity') || `person:${id}`, phone: t.phone, passcode,
          ways: { ticket: { wrong: 0, lastWrong: 0 }, lock: { wrong: 0, lastWrong: 0 } } }
        this.people.set(id, person)
        this.byPhone.set(t.phone, id)
        this.tickets.delete(s('ticket'))
        return ok({ person: { id, identity: person.identity }, created: true })
      }
      case '/v1/auth/passcode/check': {
        const person = this.people.get(s('person_id'))
        if (person === undefined) return refuse(404, 'no_passcode', 'No passcode is set.')
        if (this.tryPasscode(res, person, 'lock', s('passcode'), now)) this.json(res, 200, { ok: true })
        return true
      }
      case '/v1/auth/passkey/register/challenge': {
        const person = this.people.get(s('person_id'))
        if (person === undefined) return refuse(404, 'no_person', 'No such person.')
        const challenge = token()
        this.challenges.set(challenge, { personID: person.id, expires: now + TICKET_LIFE_MS })
        return ok({ challenge, rp_id: this.rpID, user_handle: Buffer.from(person.id).toString('base64url') })
      }
      case '/v1/auth/passkey/register': {
        const person = this.people.get(s('person_id'))
        const key = body.passkey as Record<string, string> | undefined
        if (person === undefined || key === undefined) return refuse(400, 'no_key', 'Send the passkey.')
        if (!this.tryPasscode(res, person, 'lock', s('passcode'), now)) return true
        const made = JSON.parse(Buffer.from(key.client_data_json ?? '', 'base64url').toString('utf8') || '{}') as { type?: string; challenge?: string }
        const asked = this.challenges.get(made.challenge ?? '')
        if (made.type !== 'webauthn.create' || asked === undefined || asked.personID !== person.id) return refuse(400, 'no_key', 'That passkey answers no challenge.')
        this.challenges.delete(made.challenge!)
        this.keys.set(key.credential_id, { personID: person.id, spki: Buffer.from(key.public_key, 'base64url') })
        return ok({ key: { id: key.credential_id, name: s('name') } })
      }
      case '/v1/auth/passkey/challenge': {
        const challenge = token()
        this.challenges.set(challenge, { personID: s('person_id'), expires: now + TICKET_LIFE_MS })
        return ok({ challenge, rp_id: this.rpID })
      }
      case '/v1/auth/passkey/finish': {
        const key = this.keys.get(s('credential_id'))
        const clientData = Buffer.from(s('client_data_json'), 'base64url')
        const got = JSON.parse(clientData.toString('utf8') || '{}') as { type?: string; challenge?: string }
        const asked = this.challenges.get(got.challenge ?? '')
        const signed = key !== undefined && got.type === 'webauthn.get' && asked !== undefined && asked.expires > now &&
          (asked.personID === '' || asked.personID === key.personID) &&
          verify('sha256', Buffer.concat([Buffer.from(s('authenticator_data'), 'base64url'), createHash('sha256').update(clientData).digest()]),
            createPublicKey({ key: key.spki, format: 'der', type: 'spki' }), Buffer.from(s('signature'), 'base64url'))
        if (!signed) return refuse(401, 'no_key', 'That passkey is not one Talyvor knows. Use your phone number.')
        this.challenges.delete(got.challenge!)
        const person = this.people.get(key.personID)!
        return ok({ person: { id: person.id, identity: person.identity }, ticket: token(), expires_at: iso(now + TICKET_LIFE_MS), phone_check_due: false })
      }
    }
    return false
  }

  /** The passcode tried one way, its refusal written; true when it is right. */
  private tryPasscode(res: ServerResponse, person: Person, way: 'ticket' | 'lock', passcode: string, now: number): boolean {
    const c = person.ways[way]
    const refused = (status: number, body: Record<string, string>, headers: Record<string, string> = {}) => {
      this.json(res, status, body, headers)
      return false
    }
    const wait = (at: number) => refused(429, { error: `Too many wrong passcodes. Try again at ${iso(at)}.`, reason: 'passcode_wait', retry_at: iso(at) },
      { 'Retry-After': String(Math.max(1, Math.ceil((at - now) / 1000))) })
    if (c.wrong >= WAIT_AFTER && c.lastWrong + WAIT_MS > now) return wait(c.lastWrong + WAIT_MS)
    if (passcode === '') return refused(400, { error: 'Enter your passcode.', reason: 'passcode_needed' })
    if (passcode === person.passcode) {
      c.wrong = 0
      return true
    }
    c.wrong++
    c.lastWrong = now
    if (c.wrong >= WAIT_AFTER) return wait(now + WAIT_MS)
    return refused(400, { error: 'That passcode is not right.', reason: 'wrong_passcode' })
  }
}
