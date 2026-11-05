// B45.31 SELF-TEST — the stand-in Lens's trust layer, as trust-layer reads it: an outside agent's payment request
// (POST /v1/a2a/agents/{id}/payment-requests, Lens B45.29) checked under Talyvor's money profile as Lens's agentsig does —
// the method, full URL, Content-Digest and Signature-Agent covered, at most 5 minutes, a nonce once, Ed25519 by a key in the
// agent's directory — and the AP2 key the owner's mandates are signed with (GET /.well-known/talyvor-ap2/jwks.json, Lens
// B45.28): an ES256 key made when the stub starts. The stub reads the directory of https://127.0.0.1:<port> over http, which
// Lens never would: the scenario signs as that only under --hook-tunnel none. No business is checked here, so a good
// signature is "signed". The approver agents themselves are the Bank's (stub-bank.ts). Its defects:
//   forged-signature-accepted — a signature is taken without checking it, so a forged one is "signed"
//   approver-over-limit       — an approver agent approves above its own limit (stub-bank.ts)

import { createHash, createPublicKey, generateKeyPairSync, type JsonWebKey, randomBytes, sign, verify } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

interface Trust { level: string; label: string; domain?: string; key_id?: string; profile: string }
type Outside = (agentID: string, asker: string, key: string, items: unknown[], trust: Trust) => { status: number; body: unknown }

const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url')
const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest()

/** The value of `key` in an RFC 8941 dictionary or parameter list `s` (quotes kept). */
const member = (s: string, key: string, sep: string) => s.split(sep).map((x) => x.trim()).find((x) => x.startsWith(`${key}=`))?.slice(key.length + 1)
const unquote = (s = '') => s.replace(/^"(.*)"$/, '$1')

export class TrustLayerDesk {
  private readonly ap2 = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  private readonly jwk: JsonWebKey & { kid: string }
  private readonly nonces = new Set<string>()

  private readonly json: (res: ServerResponse, status: number, body: unknown) => void
  private readonly read: (req: IncomingMessage) => Promise<string>
  private readonly broken: (name: string) => boolean
  private readonly outside: Outside

  constructor(json: TrustLayerDesk['json'], read: TrustLayerDesk['read'], broken: TrustLayerDesk['broken'], outside: Outside) {
    this.json = json
    this.read = read
    this.broken = broken
    this.outside = outside
    const { x, y } = this.ap2.publicKey.export({ format: 'jwk' })
    this.jwk = { kty: 'EC', crv: 'P-256', x, y, alg: 'ES256', use: 'sig', kid: b64u(sha256(`{"crv":"P-256","kty":"EC","x":"${x}","y":"${y}"}`)) }
  }

  /** An SD-JWT signed ES256 with the AP2 key: `plain` in the clear, each claim of `disclose` selectively disclosable. */
  mandate(plain: Record<string, unknown>, disclose: Record<string, unknown>): string {
    const disclosures = Object.entries(disclose).map(([k, v]) => b64u(JSON.stringify([b64u(randomBytes(16)), k, v])))
    const h = b64u(JSON.stringify({ alg: 'ES256', typ: 'dc+sd-jwt', kid: this.jwk.kid }))
    const p = b64u(JSON.stringify({ ...plain, _sd: disclosures.map((d) => b64u(sha256(d))).sort(), _sd_alg: 'sha-256' }))
    const s = b64u(sign('sha256', Buffer.from(`${h}.${p}`), { key: this.ap2.privateKey, dsaEncoding: 'ieee-p1363' }))
    return [`${h}.${p}.${s}`, ...disclosures].join('~') + '~'
  }

  /** The caller's trust level under the money profile, or why its signature is refused. */
  private async check(req: IncomingMessage, body: string, url: string): Promise<Trust | { refused: string }> {
    const input = String(req.headers['signature-input'] ?? '')
    const signature = String(req.headers.signature ?? '')
    if (input === '' && signature === '') return { level: 'unverified', label: 'Unverified agent', profile: 'money' }
    const raw = input.replace(/^sig1=/, '')
    const params = raw.slice(raw.indexOf(')') + 1)
    const keyID = unquote(member(params, 'keyid', ';'))
    const nonce = unquote(member(params, 'nonce', ';'))
    const created = Number(member(params, 'created', ';'))
    const expires = Number(member(params, 'expires', ';'))
    const now = Date.now() / 1000
    if (unquote(member(params, 'tag', ';')) !== 'web-bot-auth' || keyID === '') return { refused: 'agent signature refused: no signature carries tag="web-bot-auth"' }
    if (!(expires > now) || expires - created > 300 || expires - now > 300) return { refused: 'agent signature refused: a money signature is valid for at most 5m0s' }
    if (nonce === '') return { refused: 'agent signature refused: a money signature carries a nonce' }
    const digest = String(req.headers['content-digest'] ?? '')
    if (unquote(member(digest, 'sha-256', ',')?.replace(/^:|:$/g, '')) !== sha256(body).toString('base64')) return { refused: 'agent signature refused: Content-Digest: the body does not match its digest' }
    const agent = unquote(String(req.headers['signature-agent'] ?? ''))
    const domain = URL.canParse(agent) ? new URL(agent).hostname : ''
    if (!agent.startsWith('https://') || domain === '') return { refused: `agent signature refused: Signature-Agent: "${agent}" is not an https URL on the default port` }
    const dir = await fetch(`${agent.replace(/^https:/, 'http:')}/.well-known/http-message-signatures-directory`).then((r) => r.json() as Promise<{ keys?: JsonWebKey[] }>, () => ({ keys: [] }))
    const jwk = (dir.keys ?? []).find((k) => b64u(sha256(`{"crv":"Ed25519","kty":"OKP","x":"${k.x}"}`)) === keyID)
    if (jwk === undefined) return { refused: `agent signature refused: key ${keyID} is not in ${domain}'s directory` }
    const base = `"@method": ${req.method}\n"@target-uri": ${url}\n"content-digest": ${digest}\n"signature-agent": ${req.headers['signature-agent']}\n"@signature-params": ${raw}`
    const sig = Buffer.from(unquote(signature.replace(/^sig1=/, '')).replace(/^:|:$/g, ''), 'base64')
    if (!this.broken('forged-signature-accepted') && !verify(null, Buffer.from(base), createPublicKey({ key: jwk, format: 'jwk' }), sig)) {
      return { refused: 'agent signature refused: the signature does not verify' }
    }
    if (this.nonces.has(`${keyID}\n${nonce}`)) return { refused: `agent signature refused: nonce "${nonce}" was already used` }
    this.nonces.add(`${keyID}\n${nonce}`)
    return { level: 'signed', label: `Signed by ${domain} (business not checked)`, domain, key_id: keyID, profile: 'money' }
  }

  /** The trust layer's public routes, on no credential: true when `path` was one of them. */
  async route(req: IncomingMessage, res: ServerResponse, path: string, base: string): Promise<boolean> {
    if (path === '/.well-known/talyvor-ap2/jwks.json' && req.method === 'GET') return this.json(res, 200, { keys: [this.jwk] }), true
    const m = /^\/v1\/a2a\/agents\/([^/]+)\/payment-requests$/.exec(path)
    if (m === null || req.method !== 'POST') return false
    const body = await this.read(req)
    const trust = await this.check(req, body, base + (req.url ?? path))
    if ('refused' in trust) return this.json(res, 401, { error: trust.refused }), true
    res.setHeader('Talyvor-Agent-Trust', trust.level)
    const key = String(req.headers['idempotency-key'] ?? '').trim()
    if (key === '') return this.json(res, 400, { error: 'an Idempotency-Key is required' }), true
    let items: unknown[]
    try { items = (JSON.parse(body) as { items?: unknown[] }).items ?? [] } catch { return this.json(res, 400, { error: 'body must be {"items": [{"payee_id", "currency", "amount_minor", "reference"}]}' }), true }
    const got = this.outside(m[1], trust.domain === undefined ? 'a2a:unverified' : `a2a:${trust.domain}`, key, items, trust)
    return this.json(res, got.status, got.body), true
  }
}
