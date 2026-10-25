// B40.27 SELF-TEST — the stand-in Lens's prepared payment requests (Lens B40.3), as payment-request-batch reads and writes them:
// POST /v1/money/payment-requests under an Idempotency-Key and GET …/{id}. Each item's payee comes from the saved payees
// (stub-payees.ts), a no-match one unconfirmed is blocked, and the rest are judged against the signed permission mandates
// (stub-permission-mandates.ts) as Lens's judgePaymentItems picks: one that allows is auto, else the closest one's reason.
// Nothing here moves money. Its defect:
//   payment-request-key-reused — the same Idempotency-Key with other arguments is taken as a new request

import type { IncomingMessage, ServerResponse } from 'node:http'
import { createHash, randomUUID } from 'node:crypto'

interface ItemIn { payee_id?: string; currency?: string; amount_minor?: number; reference?: string }
interface Item { position: number; payee_id: string; payee_name: string; currency: string; amount_minor: number; reference: string; decision: string; reason: string; rule?: string; mandate_id?: string }
interface Request { id: string; kind: string; status: string; client: string; canonical: string; payload_hash: string; approval_url: string; deep_link: string; items: Item[] }
type Judge = (ws: string, p: { client: string; payee_id: string; currency: string; amount_minor: number }) => { decision: string; rule: string; reason: string; mandate_id: string } | undefined

const PAYEE_DETAILS = ['sort_code', 'account_number', 'iban', 'bic', 'swift', 'routing_number', 'bank_account', 'bank_details', 'account_details', 'account_name']
const detailIn = (v: unknown): string => {
  if (Array.isArray(v)) return v.map(detailIn).find(Boolean) ?? ''
  if (v === null || typeof v !== 'object') return ''
  for (const [k, x] of Object.entries(v)) {
    const found = PAYEE_DETAILS.includes(k.toLowerCase()) ? k : detailIn(x)
    if (found !== '') return found
  }
  return ''
}

export class PaymentRequestDesk {
  private readonly requests = new Map<string, Request>()
  private readonly keys = new Map<string, { args: string; id: string }>()

  private readonly json: (res: ServerResponse, status: number, body: unknown) => void
  private readonly read: (req: IncomingMessage) => Promise<string>
  private readonly broken: (name: string) => boolean
  /** The workspace's saved payees (stub-payees.ts). */
  private readonly payees: (ws: string) => { id: string; name: string; needs_confirmation: boolean }[]
  /** A payment judged against the workspace's signed mandates (stub-permission-mandates.ts). */
  private readonly judge: Judge

  constructor(json: PaymentRequestDesk['json'], read: PaymentRequestDesk['read'], broken: PaymentRequestDesk['broken'], payees: PaymentRequestDesk['payees'], judge: Judge) {
    this.json = json
    this.read = read
    this.broken = broken
    this.payees = payees
    this.judge = judge
  }

  /** The payment-request routes, on workspace `ws`'s key: true when `path` was one of them. */
  async route(req: IncomingMessage, res: ServerResponse, ws: string, path: string): Promise<boolean> {
    if (!path.startsWith('/v1/money/payment-requests')) return false
    const one = /^\/v1\/money\/payment-requests\/([^/]+)$/.exec(path)
    if (one !== null && req.method === 'GET') {
      const r = this.requests.get(one[1])
      return (r === undefined || !r.canonical.includes(`"workspace_id":"${ws}"`) ? this.json(res, 404, { error: 'economy: no such payment request' }) : this.json(res, 200, r)), true
    }
    if (path !== '/v1/money/payment-requests' || req.method !== 'POST') return false
    const raw = await this.read(req)
    let body: { client?: string; items?: ItemIn[] }
    try { body = JSON.parse(raw) } catch { return this.json(res, 400, { error: 'economy: invalid payment request: the arguments are not JSON' }), true }
    const detail = detailIn(body)
    if (detail !== '') return this.json(res, 400, { error: `economy: invalid payment request: payee details supplied by the assistant (${detail}): pay a saved payee by its payee_id` }), true
    const key = String(req.headers['idempotency-key'] ?? '')
    if (key === '') return this.json(res, 400, { error: 'economy: invalid payment request: an Idempotency-Key is required' }), true
    const client = body.client ?? 'chat'
    const items = (body.items ?? []).map((i) => ({ payee_id: i.payee_id ?? '', listing_id: '', currency: (i.currency ?? '').toUpperCase(), amount_minor: i.amount_minor ?? 0, reference: i.reference ?? '' }))
    const args = JSON.stringify({ client, items })
    const seen = this.keys.get(`${ws}\n${key}`)
    if (seen !== undefined && seen.args === args) return this.json(res, 200, this.requests.get(seen.id)), true
    if (seen !== undefined && !this.broken('payment-request-key-reused')) {
      return this.json(res, 409, { error: 'economy: this Idempotency-Key was already used for a different request' }), true
    }
    const id = `preq_${randomUUID()}`
    const kind = items.length > 1 ? 'batch' : 'payment'
    const canonical = JSON.stringify({ version: '1', id, workspace_id: ws, kind, items })
    const judged: Item[] = items.map((it, i) => {
      const payee = this.payees(ws).find((p) => p.id === it.payee_id)
      const base = { position: i + 1, payee_id: it.payee_id, payee_name: payee?.name ?? '', currency: it.currency, amount_minor: it.amount_minor, reference: it.reference }
      if (payee === undefined) return { ...base, decision: 'blocked', reason: 'no saved payee of this workspace has this id', rule: 'payee' }
      if (payee.needs_confirmation) return { ...base, decision: 'blocked', rule: 'payee',
        reason: "this payee's name did not match its account: the owner confirms it with a passkey before the first payment" }
      const d = this.judge(ws, { client, ...it })
      if (d === undefined) return { ...base, decision: 'needs_approval', reason: 'no permission mandate the person signed covers this payment' }
      if (d.decision === 'allow') return { ...base, decision: 'auto', reason: 'inside the mandate', mandate_id: d.mandate_id }
      return { ...base, decision: 'needs_approval', reason: d.reason, rule: d.rule, mandate_id: d.mandate_id }
    })
    const r: Request = { id, kind, status: judged.every((i) => i.decision === 'auto') ? 'auto' : 'pending_approval', client, canonical,
      payload_hash: createHash('sha256').update(canonical).digest('hex'), approval_url: `https://app.talyvor.com/approve/${id}`, deep_link: `talyvor://approve/${id}`, items: judged }
    this.requests.set(id, r)
    this.keys.set(`${ws}\n${key}`, { args, id })
    return this.json(res, 201, r), true
  }
}
