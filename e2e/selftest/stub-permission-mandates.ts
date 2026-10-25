// B40.26 SELF-TEST — the stand-in Lens's permission mandates (Lens B40.2), as permission-mandate reads and writes them:
// POST /v1/money/permission-mandates/prepare, POST and GET /v1/money/permission-mandates, POST …/{id}/evaluate and
// …/{id}/revoke. A mandate is kept only when it is the canonical JSON prepared, signed by one of the workspace's passkeys
// over its SHA-256 (checked here as Lens's passkey.VerifyAssertion does), and the evaluator follows Lens's
// EvaluatePermissionMandate for the rules the scenario reaches. Its defect:
//   mandate-voice-allowed — a payment asked for by voice inside the mandate is allowed without approval

import type { IncomingMessage, ServerResponse } from 'node:http'
import { createHash, createPublicKey, randomUUID, verify } from 'node:crypto'

interface Assertion { credential_id?: string; client_data_json?: string; authenticator_data?: string; signature?: string }
interface Terms { id: string; clients: string[]; scope: { payees: string[]; currencies: string[] }; limits: { per_payment?: Record<string, number>; per_day?: Record<string, number> } }
interface Kept { id: string; status: string; canonical: string; credential_id: string; revoked_at?: string }
interface Payment { client?: string; payee_id?: string; currency?: string; amount_minor?: number; spent_today_minor?: number }

const challengeOf = (canonical: string) => createHash('sha256').update(canonical).digest('base64url')

export class PermissionMandateDesk {
  private readonly prepared = new Set<string>()
  private readonly kept = new Map<string, Kept[]>()

  private readonly json: (res: ServerResponse, status: number, body: unknown) => void
  private readonly body: <T>(req: IncomingMessage) => Promise<T>
  private readonly broken: (name: string) => boolean
  /** The workspace's registered passkeys, each with its SPKI, base64url. */
  private readonly passkeys: (ws: string) => { credential_id: string; public_key: string }[]

  constructor(json: PermissionMandateDesk['json'], body: PermissionMandateDesk['body'], broken: PermissionMandateDesk['broken'], passkeys: PermissionMandateDesk['passkeys']) {
    this.json = json
    this.body = body
    this.broken = broken
    this.passkeys = passkeys
  }

  /** The permission-mandate routes, on workspace `ws`'s key: true when `path` was one of them. */
  async route(req: IncomingMessage, res: ServerResponse, ws: string, path: string): Promise<boolean> {
    if (!path.startsWith('/v1/money/permission-mandates')) return false
    const list = this.kept.get(ws) ?? []
    if (path === '/v1/money/permission-mandates' && req.method === 'GET') return this.json(res, 200, { mandates: list }), true
    if (path === '/v1/money/permission-mandates/prepare' && req.method === 'POST') {
      const t = await this.body<Record<string, unknown>>(req)
      if (this.passkeys(ws).length === 0) return this.json(res, 400, { error: 'economy: invalid permission mandate: register a passkey first' }), true
      const canonical = JSON.stringify({ version: '1', id: randomUUID(), workspace_id: ws, ...t })
      this.prepared.add(canonical)
      return this.json(res, 200, { canonical, challenge: challengeOf(canonical), allow_credentials: this.passkeys(ws).map((k) => k.credential_id), user_verification: 'required' }), true
    }
    if (path === '/v1/money/permission-mandates' && req.method === 'POST') {
      const { canonical = '', assertion } = await this.body<{ canonical?: string; assertion?: Assertion }>(req)
      const refused = !this.prepared.has(canonical) ? 'economy: invalid permission mandate: not a mandate Lens prepared' : this.refused(ws, challengeOf(canonical), assertion)
      if (refused !== undefined) return this.json(res, 400, { error: refused }), true
      this.prepared.delete(canonical)
      const m: Kept = { id: (JSON.parse(canonical) as Terms).id, status: 'active', canonical, credential_id: assertion?.credential_id ?? '' }
      this.kept.set(ws, [m, ...list])
      return this.json(res, 201, m), true
    }
    const r = /^\/v1\/money\/permission-mandates\/([^/]+)\/(evaluate|revoke)$/.exec(path)
    if (r === null || req.method !== 'POST') return false
    const m = list.find((x) => x.id === r[1])
    if (m === undefined) return this.json(res, 404, { error: 'economy: no such permission mandate' }), true
    if (r[2] === 'revoke') {
      m.revoked_at ??= new Date().toISOString()
      m.status = 'revoked'
      return this.json(res, 200, m), true
    }
    return this.json(res, 200, { ...this.evaluate(JSON.parse(m.canonical) as Terms, m.revoked_at, await this.body<Payment>(req)), mandate_id: m.id }), true
  }

  /** B40.27 — `p` judged against `ws`'s active mandates as Lens's judgePaymentItems picks: the first that allows, else the closest. */
  judge(ws: string, p: Payment): { decision: string; rule: string; reason: string; mandate_id: string } | undefined {
    let closest: { decision: string; rule: string; reason: string; mandate_id: string } | undefined
    for (const m of (this.kept.get(ws) ?? []).filter((x) => x.status === 'active')) {
      const d = { ...this.evaluate(JSON.parse(m.canonical) as Terms, m.revoked_at, p), mandate_id: m.id }
      if (d.decision === 'allow') return d
      if (closest === undefined || (closest.decision === 'block' && d.decision === 'needs_approval')) closest = d
    }
    return closest
  }

  private evaluate(t: Terms, revokedAt: string | undefined, p: Payment): { decision: string; rule: string; reason: string } {
    const cur = (p.currency ?? '').toUpperCase()
    const amount = p.amount_minor ?? 0
    const d = (decision: string, rule: string, reason: string) => ({ decision, rule, reason })
    if (revokedAt !== undefined) return d('block', 'revoked_at', `the mandate was revoked at ${revokedAt}`)
    if (!t.clients.includes(p.client ?? '')) return d('block', 'clients', `the mandate does not let "${p.client}" act on it`)
    if (!t.scope.currencies.includes(cur)) return d('block', 'scope.currencies', `the mandate does not pay in "${p.currency}"`)
    if (!t.scope.payees.includes(p.payee_id ?? '')) return d('block', 'scope', 'the payee, its category, the seller or the room is not one the mandate pays')
    const perPayment = t.limits.per_payment?.[cur]
    if (perPayment !== undefined && amount > perPayment) return d('needs_approval', 'limits.per_payment', `${amount} is over the mandate's ${perPayment} ${cur} a payment`)
    const perDay = t.limits.per_day?.[cur]
    if (perDay !== undefined && (p.spent_today_minor ?? 0) + amount > perDay) return d('needs_approval', 'limits.per_day', `over the mandate's ${perDay} ${cur} a day`)
    if (p.client === 'voice' && !this.broken('mandate-voice-allowed')) return d('needs_approval', 'clients.voice', 'a payment asked for by voice always needs approval')
    return d('allow', '', 'inside the mandate')
  }

  private refused(ws: string, challenge: string, a: Assertion | undefined): string | undefined {
    if (a === undefined) return 'economy: invalid permission mandate: a mandate is signed with a passkey'
    const spki = this.passkeys(ws).find((k) => k.credential_id === a.credential_id)?.public_key
    if (!spki) return 'passkey: the passkey ceremony is not valid: not one of the workspace\'s passkeys'
    const cdj = Buffer.from(a.client_data_json ?? '', 'base64url')
    const ad = Buffer.from(a.authenticator_data ?? '', 'base64url')
    let cd: { type?: string; challenge?: string } = {}
    try { cd = JSON.parse(cdj.toString()) } catch { /* refused below */ }
    if (cd.type !== 'webauthn.get' || cd.challenge !== challenge) return 'passkey: the passkey ceremony is not valid: the assertion answers another challenge'
    if (ad.length < 37 || (ad[32] & 0x05) !== 0x05) return 'passkey: the passkey ceremony is not valid: the user was not verified'
    const key = createPublicKey({ key: Buffer.from(spki, 'base64url'), format: 'der', type: 'spki' })
    if (!verify('sha256', Buffer.concat([ad, createHash('sha256').update(cdj).digest()]), key, Buffer.from(a.signature ?? '', 'base64url'))) {
      return 'passkey: the passkey ceremony is not valid: the signature does not verify'
    }
    return undefined
  }
}
