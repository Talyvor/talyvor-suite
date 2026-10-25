// B40.27 SELF-TEST — the stand-in Lens's prepared payment requests (Lens B40.3), as payment-request-batch reads and writes them:
// POST /v1/money/payment-requests under an Idempotency-Key and GET …/{id}. Each item's payee comes from the saved payees
// (stub-payees.ts), a no-match one unconfirmed is blocked, and the rest are judged against the signed permission mandates
// (stub-permission-mandates.ts) as Lens's judgePaymentItems picks: one that allows is auto, else the closest one's reason.
// Nothing here moves money. Its defect:
//   payment-request-key-reused — the same Idempotency-Key with other arguments is taken as a new request
// B40.29 — and one approval for a batch (Lens B40.5): an agent's own key prepares and reads its requests; the owner's POST
// …/{id}/approval answers the statement and its challenge, POST …/{id}/approve takes it signed by a device key or a passkey and
// pays each approved item once from the preparer's account, and GET …/{id}/record is the request's hash-chained record. Its defect:
//   batch-approval-replay-pays — the same approval sent again is taken, and pays every item again
// B41.2 — and pay all due (Lens B41.102): POST /v1/money/bills/pay {bill_ids} prepares the bills named, or every bill due no
// live request holds, as one request whose items are the bills — paid to their saved payee at their amount, their invoice
// number the reference — blocked when the bill was paid, is in another live request or has no saved payee; once paid, a
// bill reads paid. Its defect:
//   bill-paid-twice            — a bill already paid, or in another live request, is prepared again needing approval

import type { IncomingMessage, ServerResponse } from 'node:http'
import { createHash, randomUUID } from 'node:crypto'

interface ItemIn { payee_id?: string; currency?: string; amount_minor?: number; reference?: string }
interface Item { bill_id?: string; position: number; payee_id: string; payee_name: string; currency: string; amount_minor: number; reference: string; decision: string; reason: string; rule?: string; mandate_id?: string; payment_id?: string; pay_status?: string; pay_detail?: string }
interface Request { id: string; kind: string; status: string; client: string; agent_id?: string; canonical: string; payload_hash: string; approval_url: string; deep_link: string; items: Item[] }
interface Entry { seq: number; kind: string; body: string; prev_hash: string; hash: string }
interface Assertion { credential_id?: string; device_id?: string; challenge?: string; signature?: string }
type Paid = { id: string } | { status: number; error: string }
type StubBill = { id: string; supplier: string; invoice_number: string; amount_minor: number; currency: string; payee_id?: string; status: string; due_date: string }
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
  private readonly statements = new Map<string, { statement: string; challenge: string }>()
  private readonly records = new Map<string, Entry[]>()

  private readonly json: (res: ServerResponse, status: number, body: unknown) => void
  private readonly read: (req: IncomingMessage) => Promise<string>
  private readonly broken: (name: string) => boolean
  /** The workspace's saved payees (stub-payees.ts). */
  private readonly payees: (ws: string) => { id: string; name: string; needs_confirmation: boolean }[]
  /** A payment judged against the workspace's signed mandates (stub-permission-mandates.ts). */
  private readonly judge: Judge
  /** B40.29 — why `a` is not a signature over `challenge` by one of `ws`'s device keys or passkeys, or undefined. */
  private readonly refused: (ws: string, a: Assertion | undefined, challenge: string) => string | undefined
  /** B40.29 — one payment out from the agent's account in the currency (the company's for ''), as stub-payees.ts pays. */
  private readonly pay: (ws: string, agentID: string, b: { payee_id: string; amount_minor: number; currency: string; reference: string; idempotency_key: string }) => Paid
  /** B41.2 — the workspace's bills (stub-payees.ts); a bill paid here is marked paid on it. */
  private readonly bills: (ws: string) => StubBill[]

  constructor(json: PaymentRequestDesk['json'], read: PaymentRequestDesk['read'], broken: PaymentRequestDesk['broken'], payees: PaymentRequestDesk['payees'], judge: Judge,
    refused: PaymentRequestDesk['refused'], pay: PaymentRequestDesk['pay'], bills: PaymentRequestDesk['bills']) {
    this.bills = bills
    this.json = json
    this.read = read
    this.broken = broken
    this.payees = payees
    this.judge = judge
    this.refused = refused
    this.pay = pay
  }

  private audit(id: string, kind: string, body: Record<string, unknown>): void {
    const chain = this.records.get(id) ?? []
    const prev = chain.at(-1)?.hash ?? ''
    const seq = chain.length + 1
    const b = JSON.stringify({ ...body, at: new Date().toISOString() })
    this.records.set(id, [...chain, { seq, kind, body: b, prev_hash: prev, hash: createHash('sha256').update(`${prev}\n${seq}\n${kind}\n${b}`).digest('hex') }])
  }

  /** B40.29 — the statement, approve and record routes of request `id`, on `ws`'s key (`agentID` an agent's own key's). */
  private async approval(req: IncomingMessage, res: ServerResponse, ws: string, agentID: string, id: string, action: string): Promise<boolean> {
    const r = this.requests.get(id)
    if (r === undefined || !r.canonical.includes(`"workspace_id":"${ws}"`) || (agentID !== '' && r.agent_id !== agentID)) return this.json(res, 404, { error: 'economy: no such payment request' }), true
    if (action === 'record' && req.method === 'GET') return this.json(res, 200, { request_id: id, entries: this.records.get(id) ?? [], verified: true, broken: '' }), true
    if (req.method !== 'POST') return false
    if (agentID !== '') return this.json(res, 403, { error: "only the workspace's owner or an admin approves a payment request" }), true
    if (action === 'approval') {
      const { positions = [] } = JSON.parse((await this.read(req)) || '{}') as { positions?: number[] }
      const items = (r.items ?? []).filter((it) => it.decision === 'needs_approval' && (positions.length === 0 || positions.includes(it.position)))
      if (items.length === 0) return this.json(res, 400, { error: 'economy: invalid payment request: no item of this request needs approval' }), true
      const statement = JSON.stringify({ version: '1', request_id: id, payload_hash: r.payload_hash, items: items.map(({ position, payee_id, payee_name, currency, amount_minor, reference }) =>
        ({ position, payee_id, payee_name, currency, amount_minor, reference })), expires_at: new Date(Date.now() + 15 * 60_000).toISOString() })
      const challenge = createHash('sha256').update(statement).digest('base64url')
      this.statements.set(id, { statement, challenge })
      return this.json(res, 200, { statement, challenge, allow_credentials: [], user_verification: 'required' }), true
    }
    if (action !== 'approve') return false
    const replay = r.status === 'approved'
    if (replay && !this.broken('batch-approval-replay-pays')) return this.json(res, 409, { error: 'economy: this payment request was already approved: nothing is paid again' }), true
    const b = JSON.parse((await this.read(req)) || '{}') as { statement?: string; assertion?: Assertion }
    const prepared = this.statements.get(id)
    if (prepared === undefined || b.statement !== prepared.statement) return this.json(res, 400, { error: "economy: invalid payment request: the statement is not this request's, as prepared for signing" }), true
    const refused = this.refused(ws, b.assertion, prepared.challenge)
    if (refused !== undefined) return this.json(res, 403, { error: refused }), true
    r.status = 'approved'
    this.audit(id, 'signature', { device_id: b.assertion?.device_id ?? '', credential_id: b.assertion?.credential_id ?? '' })
    const approved = (JSON.parse(prepared.statement) as { items: Item[] }).items
    for (const it of r.items ?? []) {
      if (!approved.some((a) => a.position === it.position)) continue
      // STUB_BREAK=batch-approval-replay-pays — a replay pays again, under a key of its own.
      const key = `${id}:${it.position}${replay ? `:${randomUUID()}` : ''}`
      const p = this.pay(ws, r.agent_id ?? '', { payee_id: it.payee_id, amount_minor: it.amount_minor, currency: it.currency, reference: it.reference, idempotency_key: key })
      Object.assign(it, 'id' in p ? { payment_id: p.id, pay_status: 'completed' } : { pay_status: 'failed', pay_detail: p.error })
      const bill = 'id' in p && it.bill_id !== undefined ? this.bills(ws).find((x) => x.id === it.bill_id) : undefined
      if (bill !== undefined) bill.status = 'paid'
      this.audit(id, 'provider_call', { position: it.position, authority: 'approval', idempotency_key: key, ...('id' in p ? { payment_id: p.id } : { error: p.error }) })
    }
    return this.json(res, 200, r), true
  }

  /** The payment-request routes, on workspace `ws`'s key (B40.29: `agentID` its agent's own key's): true when `path` was one of them. */
  async route(req: IncomingMessage, res: ServerResponse, ws: string, path: string, agentID = ''): Promise<boolean> {
    if (path === '/v1/money/bills/pay' && req.method === 'POST' && agentID === '') return this.billsPay(req, res, ws), true
    if (!path.startsWith('/v1/money/payment-requests')) return false
    const act = /^\/v1\/money\/payment-requests\/([^/]+)\/(approval|approve|record)$/.exec(path)
    if (act !== null) return this.approval(req, res, ws, agentID, act[1], act[2])
    const one = /^\/v1\/money\/payment-requests\/([^/]+)$/.exec(path)
    if (one !== null && req.method === 'GET') {
      const r = this.requests.get(one[1])
      return (r === undefined || !r.canonical.includes(`"workspace_id":"${ws}"`) || (agentID !== '' && r.agent_id !== agentID) ? this.json(res, 404, { error: 'economy: no such payment request' }) : this.json(res, 200, r)), true
    }
    if (path !== '/v1/money/payment-requests' || req.method !== 'POST') return false
    const raw = await this.read(req)
    let body: { client?: string; items?: ItemIn[] }
    try { body = JSON.parse(raw) } catch { return this.json(res, 400, { error: 'economy: invalid payment request: the arguments are not JSON' }), true }
    const detail = detailIn(body)
    if (detail !== '') return this.json(res, 400, { error: `economy: invalid payment request: payee details supplied by the assistant (${detail}): pay a saved payee by its payee_id` }), true
    const key = String(req.headers['idempotency-key'] ?? '')
    if (key === '') return this.json(res, 400, { error: 'economy: invalid payment request: an Idempotency-Key is required' }), true
    const client = agentID !== '' ? `key:${agentID}` : body.client ?? 'chat'
    const items = (body.items ?? []).map((i) => ({ payee_id: i.payee_id ?? '', listing_id: '', currency: (i.currency ?? '').toUpperCase(), amount_minor: i.amount_minor ?? 0, reference: i.reference ?? '' }))
    const args = JSON.stringify({ client, items })
    const seen = this.keys.get(`${ws}\n${key}`)
    if (seen !== undefined && seen.args === args) return this.json(res, 200, this.requests.get(seen.id)), true
    if (seen !== undefined && !this.broken('payment-request-key-reused')) {
      return this.json(res, 409, { error: 'economy: this Idempotency-Key was already used for a different request' }), true
    }
    return this.create(res, ws, key, args, client, agentID, items)
  }

  /** B41.2 — POST /v1/money/bills/pay: the bills named, or each bill due no live request holds, as one request of bill items. */
  private async billsPay(req: IncomingMessage, res: ServerResponse, ws: string): Promise<void> {
    const key = String(req.headers['idempotency-key'] ?? '')
    if (key === '') return this.json(res, 400, { error: 'economy: invalid payment request: an Idempotency-Key is required' })
    const body = JSON.parse((await this.read(req)) || '{}') as { client?: string; bill_ids?: string[] }
    const client = body.client ?? 'chat'
    const bills = this.bills(ws)
    const taken = (id: string) => [...this.requests.values()].find((r) => r.status !== 'cancelled' && r.canonical.includes(`"workspace_id":"${ws}"`) &&
      (r.items ?? []).some((it) => it.bill_id === id && it.decision !== 'blocked' && it.pay_status !== 'failed'))
    const ids = body.bill_ids ?? bills.filter((b) => b.status === 'due' && taken(b.id) === undefined).map((b) => b.id)
    if (ids.length === 0) return this.json(res, 400, { error: 'economy: invalid payment request: no bill is due' })
    const items: Parameters<PaymentRequestDesk['create']>[6] = []
    for (const id of ids) {
      const b = bills.find((x) => x.id === id)
      if (b === undefined) return this.json(res, 400, { error: `economy: invalid payment request: item ${items.length + 1}: no bill of this workspace has the id "${id}"` })
      const held = taken(b.id)
      // STUB_BREAK=bill-paid-twice — a paid or held bill is prepared again as if due.
      const blocked = this.broken('bill-paid-twice') ? undefined : b.status === 'paid' ? 'the bill was paid already'
        : held !== undefined ? `the bill is in payment request ${held.id} already: approve or cancel that one` : !b.payee_id ? 'the supplier is not a saved payee yet: save it as a payee first' : undefined
      items.push({ bill_id: b.id, payee_id: b.payee_id ?? '', listing_id: '', currency: b.currency, amount_minor: b.amount_minor, reference: b.invoice_number || b.supplier, blocked })
    }
    const args = JSON.stringify({ client, bills: ids })
    const seen = this.keys.get(`${ws}\n${key}`)
    if (seen !== undefined && seen.args === args) return this.json(res, 200, this.requests.get(seen.id))
    if (seen !== undefined) return this.json(res, 409, { error: 'economy: this Idempotency-Key was already used for a different request' })
    this.create(res, ws, key, args, client, '', items)
  }

  /** One request of `items`, each judged as Lens's judgePaymentItems does, kept under `key` for `args`. */
  private create(res: ServerResponse, ws: string, key: string, args: string, client: string, agentID: string,
    items: { payee_id: string; listing_id: string; currency: string; amount_minor: number; reference: string; bill_id?: string; blocked?: string }[]): true {
    const id = `preq_${randomUUID()}`
    const kind = items.length > 1 ? 'batch' : 'payment'
    const canonical = JSON.stringify({ version: '1', id, workspace_id: ws, kind, items: items.map(({ blocked: _, ...it }) => it) })
    const judged: Item[] = items.map((it, i) => {
      const payee = this.payees(ws).find((p) => p.id === it.payee_id)
      const base = { position: i + 1, payee_id: it.payee_id, payee_name: payee?.name ?? '', currency: it.currency, amount_minor: it.amount_minor, reference: it.reference,
        ...(it.bill_id === undefined ? {} : { bill_id: it.bill_id }) }
      if (it.blocked !== undefined) return { ...base, decision: 'blocked', reason: it.blocked, rule: 'bill' }
      if (payee === undefined) return { ...base, decision: 'blocked', reason: 'no saved payee of this workspace has this id', rule: 'payee' }
      if (payee.needs_confirmation) return { ...base, decision: 'blocked', rule: 'payee',
        reason: "this payee's name did not match its account: the owner confirms it with a passkey before the first payment" }
      const d = this.judge(ws, { client, ...it })
      if (d === undefined) return { ...base, decision: 'needs_approval', reason: 'no permission mandate the person signed covers this payment' }
      if (d.decision === 'allow') return { ...base, decision: 'auto', reason: 'inside the mandate', mandate_id: d.mandate_id }
      return { ...base, decision: 'needs_approval', reason: d.reason, rule: d.rule, mandate_id: d.mandate_id }
    })
    const r: Request = { id, kind, status: judged.every((i) => i.decision === 'auto') ? 'auto' : 'pending_approval', client, ...(agentID === '' ? {} : { agent_id: agentID }), canonical,
      payload_hash: createHash('sha256').update(canonical).digest('hex'), approval_url: `https://app.talyvor.com/approve/${id}`, deep_link: `talyvor://approve/${id}`, items: judged }
    this.requests.set(id, r)
    this.keys.set(`${ws}\n${key}`, { args, id })
    this.audit(id, 'request', { client, agent_id: agentID, payload_hash: r.payload_hash })
    return this.json(res, 201, r), true
  }
}
