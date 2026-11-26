// B48.38 SELF-TEST — the stand-in Lens's agents' smart accounts, the owner's spend permissions and the agents' crypto sends
// (talyvor-lens B48.2, B48.3, B48.9 and B48.37), as agent-crypto-spend-permission reads and writes them:
//   POST …/agents/{id}/smart-account/challenge and …/smart-account          the account, owned by one of the workspace's passkeys
//   POST …/agents/{id}/spend-permission/prepare, PUT and GET …/spend-permission  the permission, signed over the SHA-256 of its JSON
//   POST and GET …/agents/{id}/crypto-sends (the owner's or the agent's own key), POST …/crypto-sends/{id}/approve/challenge and
//   …/approve (the owner, signed with a passkey)
// A send is judged at the gate as Lens's smartaccount.Permission.Check judges it, against the latest permission signed and what
// the agent already paid in the token today; a send to an address the workspace never paid waits for the owner first. With
// STUB_SMART_ACCOUNTS=off every route answers 503, as a Lens whose smart accounts are not switched on. Its defect:
//   spend-allowance-forgets — the gate counts nothing already paid, so a payment over the day's allowance lands

import type { IncomingMessage, ServerResponse } from 'node:http'
import { createHash, createPublicKey, randomBytes, randomUUID, verify } from 'node:crypto'

interface Assertion { credential_id?: string; client_data_json?: string; authenticator_data?: string; signature?: string }
interface Limit { token: string; allowance: number; period: string; per_payment: number }
interface Permission { tokens: Limit[]; allowed: string[]; blocked: string[]; expires: string }
interface Terms { version: string; workspace_id: string; agent_id: string; account: string; number: number; permission: Permission }
interface Kept extends Terms { canonical: string; credential_id: string; signed_by: string; signed_at: string }
interface Send { id: string; network: string; token: string; token_address: string; amount_minor: number; to: string; to_kind: string; new_address: boolean
  agent_id: string; direction: string; status: string; reason?: string; requested_by: string; approved_by?: string; user_op_hash?: string; tx_hash?: string
  explorer_url?: string; created_at: string; updated_at: string }

const USDC = '0x036cbd53842c5426634e7929541ec2318f3dcf7e'
const NETWORK = 'base-sepolia'
const OFF = "economy: agents' smart accounts are not switched on"
const challengeOf = (s: string) => createHash('sha256').update(s).digest('base64url')
const isAddress = (a: string) => /^0x[0-9a-fA-F]{40}$/.test(a)
const hex = (n: number) => `0x${randomBytes(n).toString('hex')}`

export class SpendPermissionDesk {
  private readonly accounts = new Map<string, { address: string; credential_id: string }>()
  private readonly accountChallenges = new Map<string, string>()
  private readonly prepared = new Set<string>()
  private readonly permissions = new Map<string, Kept[]>()
  /** Each agent's sends, by its Idempotency-Key. */
  private readonly sends = new Map<string, Map<string, Send>>()
  private readonly approvalChallenges = new Map<string, string>()
  /** The addresses each workspace has paid. */
  private readonly paid = new Map<string, Set<string>>()

  private readonly json: (res: ServerResponse, status: number, body: unknown) => void
  private readonly body: <T>(req: IncomingMessage) => Promise<T>
  private readonly broken: (name: string) => boolean
  private readonly passkeys: (ws: string) => { credential_id: string; public_key: string }[]
  /** Whether `agentID` is an agent of workspace `ws` with a crypto wallet. */
  private readonly cryptoAgent: (ws: string, agentID: string) => boolean

  constructor(json: SpendPermissionDesk['json'], body: SpendPermissionDesk['body'], broken: SpendPermissionDesk['broken'],
    passkeys: SpendPermissionDesk['passkeys'], cryptoAgent: SpendPermissionDesk['cryptoAgent']) {
    this.json = json
    this.body = body
    this.broken = broken
    this.passkeys = passkeys
    this.cryptoAgent = cryptoAgent
  }

  /** B48.21 — `agentID`'s smart account made here, for the desk that keeps its wallet (stub-crypto-wallet.ts). */
  account(agentID: string): { address: string; credential_id: string } | undefined {
    return this.accounts.get(agentID)
  }

  /** B48.21 — the agent whose smart account is at `address`, if one was made here. */
  agentAt(address: string): string | undefined {
    return [...this.accounts.entries()].find(([, a]) => a.address.toLowerCase() === address.toLowerCase())?.[0]
  }

  /**
   * The routes under /v1/workspaces/{ws}: `rest` is the path after it, `agent` the agent whose own key asks ('' for the owner).
   * True when `rest` was one of them.
   */
  async route(req: IncomingMessage, res: ServerResponse, ws: string, rest: string, agent: string): Promise<boolean> {
    const m = /^\/agents\/([^/]+)\/(smart-account(?:\/challenge)?|spend-permission(?:\/prepare)?|crypto-sends(?:\/([^/]+)\/(approve(?:\/challenge)?))?)$/.exec(rest)
    if (m === null || m[1] === 'passkeys') return false
    const [, agentID, what, sendID, answer] = m
    const method = req.method ?? 'GET'
    if (agent !== '' && (agent !== agentID || !what.startsWith('crypto-sends') || answer !== undefined)) {
      return this.json(res, 403, { error: "only the agent's own key or the workspace's owner may send its money" }), true
    }
    if (process.env.STUB_SMART_ACCOUNTS === 'off') return this.json(res, 503, { error: OFF }), true
    if (!this.cryptoAgent(ws, agentID)) return this.json(res, 404, { error: 'economy: no such agent in this workspace' }), true
    const acct = this.accounts.get(agentID)

    if (what === 'smart-account/challenge' && method === 'POST') {
      const { credential_id = '' } = await this.body<{ credential_id?: string }>(req)
      if (!this.passkeys(ws).some((k) => k.credential_id === credential_id)) return this.json(res, 400, { error: "economy: the account's owner is one of the workspace's passkeys" }), true
      const c = randomBytes(32).toString('base64url')
      this.accountChallenges.set(agentID, c)
      return this.json(res, 200, { challenge: c, allow_credentials: [credential_id], user_verification: 'required' }), true
    }
    if (what === 'smart-account' && method === 'POST') {
      if (acct !== undefined) return this.json(res, 409, { error: 'economy: the agent already has a smart account' }), true
      const { credential_id = '', assertion } = await this.body<{ credential_id?: string; assertion?: Assertion }>(req)
      const refused = assertion?.credential_id !== credential_id ? 'economy: the account is made with its owner passkey\'s signature'
        : this.refused(ws, this.accountChallenges.get(agentID) ?? '', assertion)
      if (refused !== undefined) return this.json(res, 403, { error: refused }), true
      this.accountChallenges.delete(agentID)
      const a = { address: hex(20), credential_id }
      this.accounts.set(agentID, a)
      return this.json(res, 200, { agent_id: agentID, address: a.address, owners: [{ kind: 'passkey', credential_id }], created_at: new Date().toISOString() }), true
    }
    if (acct === undefined) return this.json(res, 404, { error: 'economy: the agent has no smart account' }), true
    const kept = this.permissions.get(agentID) ?? []

    if (what === 'spend-permission/prepare' && method === 'POST') {
      const p = await this.body<Partial<Permission>>(req)
      const permission: Permission = { tokens: p.tokens ?? [], allowed: (p.allowed ?? []).map((a) => a.toLowerCase()).sort(), blocked: (p.blocked ?? []).map((a) => a.toLowerCase()).sort(),
        expires: new Date(Math.floor(Date.parse(p.expires ?? '') / 1000) * 1000).toISOString() }
      const invalid = this.invalid(permission)
      if (invalid !== undefined) return this.json(res, 400, { error: `economy: invalid spend permission: smartaccount: invalid: ${invalid}` }), true
      const terms: Terms = { version: 'talyvor.spend_permission.v1', workspace_id: ws, agent_id: agentID, account: acct.address, number: kept.length + 1, permission }
      const canonical = JSON.stringify(terms)
      this.prepared.add(canonical)
      return this.json(res, 200, { canonical, challenge: challengeOf(canonical) }), true
    }
    if (what === 'spend-permission' && method === 'PUT') {
      const { canonical = '', assertion } = await this.body<{ canonical?: string; assertion?: Assertion }>(req)
      if (!this.prepared.has(canonical)) return this.json(res, 400, { error: 'economy: invalid spend permission: not in its canonical form, as prepare answered it' }), true
      const refused = assertion?.credential_id !== acct.credential_id ? 'economy: invalid spend permission: it is not signed: sign its challenge with the passkey that owns the agent\'s account'
        : this.refused(ws, challengeOf(canonical), assertion)
      if (refused !== undefined) return this.json(res, 403, { error: refused }), true
      const t = JSON.parse(canonical) as Terms
      if (t.number !== kept.length + 1) return this.json(res, 400, { error: `economy: invalid spend permission: it is number ${t.number} and the next is ${kept.length + 1}: prepare it again` }), true
      this.prepared.delete(canonical)
      const k: Kept = { ...t, canonical, credential_id: acct.credential_id, signed_by: 'owner', signed_at: new Date().toISOString() }
      this.permissions.set(agentID, [...kept, k])
      return this.json(res, 200, k), true
    }
    if (what === 'spend-permission' && method === 'GET') {
      const last = kept.at(-1)
      return last === undefined ? this.json(res, 404, { error: 'economy: the owner has signed no spend permission for this agent' }) : this.json(res, 200, last), true
    }

    const mine = this.sends.get(agentID) ?? new Map<string, Send>()
    this.sends.set(agentID, mine)
    if (what === 'crypto-sends' && method === 'GET') {
      return this.json(res, 200, { sends: [...mine.values()].sort((a, b) => b.created_at.localeCompare(a.created_at)) }), true
    }
    if (what === 'crypto-sends' && method === 'POST') {
      const key = String(req.headers['idempotency-key'] ?? '')
      const b = await this.body<{ to?: string; network?: string; token?: string; amount_minor?: number }>(req)
      const to = (b.to ?? '').toLowerCase()
      if (key === '' || key.length > 128) return this.json(res, 400, { error: 'economy: crypto send: an Idempotency-Key of at most 128 characters' }), true
      if (b.network !== NETWORK) return this.json(res, 400, { error: `economy: crypto send: agents do not send on "${b.network}" here` }), true
      if (b.token !== 'USDC' || !isAddress(to) || !Number.isInteger(b.amount_minor) || (b.amount_minor ?? 0) <= 0) {
        return this.json(res, 400, { error: 'economy: crypto send: a positive amount of USDC to a 0x address' }), true
      }
      const had = mine.get(key)
      if (had !== undefined) {
        if (had.to !== to || had.amount_minor !== b.amount_minor) return this.json(res, 409, { error: 'economy: that Idempotency-Key was used for another request' }), true
        return this.answer(res, had), true
      }
      const fresh = !(this.paid.get(ws)?.has(to) ?? false)
      const now = new Date().toISOString()
      const s: Send = { id: `csend_${randomUUID()}`, network: NETWORK, token: 'USDC', token_address: USDC, amount_minor: b.amount_minor ?? 0, to, to_kind: 'address',
        new_address: fresh, agent_id: agentID, direction: 'out', status: fresh && agent !== '' ? 'awaiting_owner' : 'sending',
        requested_by: agent === '' ? 'user:owner' : `agent:${agentID}`, created_at: now, updated_at: now }
      mine.set(key, s)
      if (s.status === 'sending') this.gate(ws, agentID, s)
      return this.answer(res, s), true
    }
    const s = [...mine.values()].find((x) => x.id === sendID)
    if (s === undefined) return this.json(res, 404, { error: 'economy: no such crypto send' }), true
    if (s.status !== 'awaiting_owner') return this.json(res, 400, { error: 'economy: crypto send: it is not waiting for the owner' }), true
    if (answer === 'approve/challenge' && method === 'POST') {
      const c = challengeOf(`talyvor.crypto_send_approval:${s.id}:${randomBytes(8).toString('hex')}`)
      this.approvalChallenges.set(s.id, c)
      return this.json(res, 200, { challenge: c, allow_credentials: this.passkeys(ws).map((k) => k.credential_id), user_verification: 'required' }), true
    }
    if (answer === 'approve' && method === 'POST') {
      const { assertion } = await this.body<{ assertion?: Assertion }>(req)
      const refused = assertion === undefined ? 'economy: the owner signs their yes to this send' : this.refused(ws, this.approvalChallenges.get(s.id) ?? '', assertion)
      if (refused !== undefined) return this.json(res, 403, { error: refused }), true
      this.approvalChallenges.delete(s.id)
      s.approved_by = 'user:owner'
      this.gate(ws, agentID, s)
      return this.answer(res, s), true
    }
    return false
  }

  /** Talyvor's gate before the agent's key signs `s`: inside the latest permission, it lands; outside it, refused with Lens's reason. */
  private gate(ws: string, agentID: string, s: Send): void {
    s.updated_at = new Date().toISOString()
    const last = (this.permissions.get(agentID) ?? []).at(-1)
    const reason = last === undefined ? "smartaccount: outside the owner's permission: economy: the owner has signed no spend permission for this agent"
      : this.check(last.permission, s, this.spentToday(agentID, s.token_address))
    if (reason !== undefined) {
      Object.assign(s, { status: 'refused', reason })
      return
    }
    Object.assign(s, { status: 'landed', user_op_hash: hex(32), tx_hash: hex(32) })
    s.explorer_url = `https://sepolia.basescan.org/tx/${s.tx_hash}`
    const paid = this.paid.get(ws) ?? new Set<string>()
    this.paid.set(ws, paid.add(s.to))
  }

  /** smartaccount.Permission.Check: why `s` is outside `p` with `spent` already paid in its token this period, or undefined. */
  private check(p: Permission, s: Send, spent: number): string | undefined {
    const refuse = (why: string) => `smartaccount: outside the owner's permission: ${why}`
    if (Date.now() >= Date.parse(p.expires)) return refuse(`it ended at ${p.expires.replace('.000Z', 'Z')}`)
    if (p.blocked.includes(s.to)) return refuse(`${s.to} is blocked`)
    if (p.allowed.length > 0 && !p.allowed.includes(s.to)) return refuse(`${s.to} is not one of the counterparties allowed`)
    const l = p.tokens.find((t) => t.token.toLowerCase() === s.token_address)
    if (l === undefined) return refuse(`it does not allow paying in ${s.token_address}`)
    if (s.amount_minor > l.per_payment) return refuse(`${s.amount_minor} is over the cap of ${l.per_payment} on one payment`)
    if (s.amount_minor + spent > l.allowance) return refuse(`${s.amount_minor} with ${spent} already paid this ${l.period} is over the allowance of ${l.allowance}`)
    return undefined
  }

  /** What `agentID` paid in `token` since the start of today (UTC); nothing with STUB_BREAK=spend-allowance-forgets. */
  private spentToday(agentID: string, token: string): number {
    if (this.broken('spend-allowance-forgets')) return 0
    const day = new Date().toISOString().slice(0, 10)
    return [...(this.sends.get(agentID)?.values() ?? [])].filter((s) => s.status === 'landed' && s.token_address === token && s.updated_at.startsWith(day))
      .reduce((n, s) => n + s.amount_minor, 0)
  }

  /** smartaccount.Permission.Validate, for what the scenario signs. */
  private invalid(p: Permission): string | undefined {
    if (Number.isNaN(Date.parse(p.expires)) || Date.parse(p.expires) <= Date.now()) return 'it ends after now'
    const seen = new Set<string>()
    for (const l of p.tokens) {
      if (!isAddress(l.token)) return `"${l.token}" is not a token's address`
      if (seen.has(l.token.toLowerCase())) return `${l.token} is limited twice`
      seen.add(l.token.toLowerCase())
      if (!['day', 'week', 'month'].includes(l.period)) return `an allowance runs per day, week or month, not "${l.period}"`
      if (!(l.allowance > 0 && l.per_payment > 0 && l.per_payment <= l.allowance)) return `${l.token}: the allowance and the cap on one payment are positive, the cap no more than the allowance`
    }
    for (const a of [...p.allowed, ...p.blocked]) if (!isAddress(a)) return `"${a}" is not an address`
    if (p.allowed.some((a) => p.blocked.includes(a))) return 'a counterparty is both allowed and blocked'
    return undefined
  }

  private answer(res: ServerResponse, s: Send): void {
    this.json(res, s.status === 'landed' ? 200 : s.status === 'refused' ? 403 : s.status === 'failed' ? 502 : 202, s)
  }

  /** Lens's passkey.VerifyAssertion, for one of `ws`'s passkeys over `challenge`. */
  private refused(ws: string, challenge: string, a: Assertion | undefined): string | undefined {
    if (a === undefined) return 'passkey: the passkey ceremony is not valid: no assertion'
    const spki = this.passkeys(ws).find((k) => k.credential_id === a.credential_id)?.public_key
    if (!spki) return 'passkey: the passkey ceremony is not valid: not one of the workspace\'s passkeys'
    const cdj = Buffer.from(a.client_data_json ?? '', 'base64url')
    const ad = Buffer.from(a.authenticator_data ?? '', 'base64url')
    let cd: { type?: string; challenge?: string } = {}
    try { cd = JSON.parse(cdj.toString()) } catch { /* refused below */ }
    if (cd.type !== 'webauthn.get' || challenge === '' || cd.challenge !== challenge) return 'passkey: the passkey ceremony is not valid: the assertion answers another challenge'
    if (ad.length < 37 || (ad[32] & 0x05) !== 0x05) return 'passkey: the passkey ceremony is not valid: the user was not verified'
    const key = createPublicKey({ key: Buffer.from(spki, 'base64url'), format: 'der', type: 'spki' })
    if (!verify('sha256', Buffer.concat([ad, createHash('sha256').update(cdj).digest()]), key, Buffer.from(a.signature ?? '', 'base64url'))) {
      return 'passkey: the passkey ceremony is not valid: the signature does not verify'
    }
    return undefined
  }
}
