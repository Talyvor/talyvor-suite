// B61.48 SELF-TEST — the stand-in Lens's launch areas that had no scenario: Instant transfer, Help and the account's kind.
//
// GET /v1/workspaces/{ws}/account answers a synthetic workspace as Lens makes one: business, hybrid (migration 0373).
//
// Instant transfer (Lens B59.14, B59.15), as instant-transfer-quote reads it:
//   POST …/money/instant-transfers/quote {send_minor, send_currency, receive_currency, to}   201, locked for 30 seconds: the fee
//        is LENS_FX_MARGIN_BPS (here 50) of what is sent, rounded up, and the beneficiary gets what is left at a rate of 1
//   POST …/agents/{id}/money/instant-transfers {quote_id, to_account_id, idempotency_key}   refused 403 field
//        may_instant_transfer without the agent's rule; a quote past its 30 seconds refused 409 "… expired … Ask for a new
//        one"; inside them, a send to an account the agent never sent one to files nothing here and is refused 403, waiting
//        for the owner's approval, as Lens does before any leg moves
//
// B61.51 — the company details (Lens B59.30): GET and PUT /v1/workspaces/{ws}/business {company_name, registration_number,
// country, people}, the PUT 400 without a name, a registration number and a country.
//
// Help (Lens B59.27): POST and GET /v1/workspaces/{ws}/requests {kind, message} — received; a complaint with its reference.
//
// Its defects:
//   instant-quote-long     — a quote is locked for 60 seconds, not 30
//   instant-quote-expired-sent — a send at a quote past its 30 seconds is not refused for it
//   instant-fee-dropped    — a quote shows no fee
//   request-kind-support   — every request is filed as support, a complaint too, so it gets no reference

import type { IncomingMessage, ServerResponse } from 'node:http'
import { randomBytes, randomUUID } from 'node:crypto'

const QUOTE_LIFE_MS = 30_000
const FEE_BPS = 50

interface Quote { id: string; workspace_id: string; to: string; send_minor: number; send_currency: string; fee_bps: number; fee_minor: number; rate: string
  receive_minor: number; receive_currency: string; arrives_in_seconds: boolean; expires_at: string; created_at: string }
interface FiledRequest { id: number; kind: string; state: string; reference: string; message: string; answer: string; filed_at: string; updated_at: string }

interface Company { company_name: string; registration_number: string; country: string; people: { name: string; role: string; share_bps: number }[] }

const KINDS = ['support', 'complaint', 'account_closure', 'data_export', 'data_deletion']
const FIATS = ['GBP', 'EUR', 'USD']

export class LaunchDesk {
  private readonly quotes = new Map<string, Quote>()
  private readonly requests = new Map<string, FiledRequest[]>()
  private readonly companies = new Map<string, Company>()
  private nextRequest = 1

  private readonly json: (res: ServerResponse, status: number, body: unknown) => void
  private readonly body: <T>(req: IncomingMessage) => Promise<T>
  private readonly broken: (name: string) => boolean
  /** Whether the workspace's agent has "Can use Instant transfer" on; undefined for no such agent. */
  private readonly mayInstant: (ws: string, agentID: string) => boolean | undefined

  constructor(json: LaunchDesk['json'], body: LaunchDesk['body'], broken: LaunchDesk['broken'], mayInstant: LaunchDesk['mayInstant']) {
    this.json = json
    this.body = body
    this.broken = broken
    this.mayInstant = mayInstant
  }

  /** One of the routes above, under /v1/workspaces/{ws}: `rest` is what follows it. False for any other. */
  async route(req: IncomingMessage, res: ServerResponse, ws: string, rest: string): Promise<boolean> {
    if (rest === '/account' && req.method === 'GET') {
      return this.json(res, 200, { workspace_id: ws, account_type: 'business', money_kind: 'hybrid', country: '', registration_number: '' }), true
    }
    if (rest === '/business' && (req.method === 'GET' || req.method === 'PUT')) return this.business(req, res, ws), true
    if (rest === '/requests') return this.request(req, res, ws), true
    if (rest === '/money/instant-transfers/quote' && req.method === 'POST') return this.quote(req, res, ws), true
    const m = /^\/agents\/([^/]+)\/money\/instant-transfers$/.exec(rest)
    if (m !== null && req.method === 'POST') return this.send(req, res, ws, m[1]), true
    return false
  }

  private async business(req: IncomingMessage, res: ServerResponse, ws: string): Promise<void> {
    const empty: Company = { company_name: '', registration_number: '', country: '', people: [] }
    if (req.method === 'GET') return this.json(res, 200, { workspace_id: ws, ...(this.companies.get(ws) ?? empty) })
    const b = await this.body<Partial<Company>>(req)
    const c: Company = { company_name: (b.company_name ?? '').trim(), registration_number: (b.registration_number ?? '').trim(),
      country: (b.country ?? '').trim().toUpperCase(), people: b.people ?? [] }
    if (c.company_name === '' || c.registration_number === '' || !/^[A-Z]{2}$/.test(c.country)) {
      return this.json(res, 400, { error: 'economy: the business details need the company name, its registration number and its country' })
    }
    this.companies.set(ws, c)
    this.json(res, 200, { workspace_id: ws, ...c })
  }

  private async request(req: IncomingMessage, res: ServerResponse, ws: string): Promise<void> {
    const mine = this.requests.get(ws) ?? []
    if (req.method === 'GET') return this.json(res, 200, { requests: [...mine].reverse() })
    if (req.method !== 'POST') return this.json(res, 405, { error: 'method not allowed' })
    const b = await this.body<{ kind?: string; message?: string }>(req)
    const kind = this.broken('request-kind-support') ? 'support' : (b.kind ?? '')
    if (!KINDS.includes(kind)) return this.json(res, 400, { error: `support: a request is one of ${KINDS.join(', ')}, not "${kind}"` })
    const message = (b.message ?? '').trim()
    if ((kind === 'support' || kind === 'complaint') && message === '') return this.json(res, 400, { error: 'support: say what it is about' })
    const at = new Date().toISOString()
    const code = () => randomBytes(3).toString('hex').toUpperCase().slice(0, 4)
    const r: FiledRequest = { id: this.nextRequest++, kind, state: 'received', reference: kind === 'complaint' ? `C-${code()}-${code()}` : '', message, answer: '',
      filed_at: at, updated_at: at }
    this.requests.set(ws, [...mine, r])
    return this.json(res, 201, r)
  }

  private async quote(req: IncomingMessage, res: ServerResponse, ws: string): Promise<void> {
    const b = await this.body<{ send_minor?: number; send_currency?: string; receive_currency?: string; to?: string }>(req)
    const send = (b.send_currency ?? '').toUpperCase()
    const receive = (b.receive_currency ?? '').toUpperCase()
    if (!FIATS.includes(send)) return this.json(res, 400, { error: `economy: invalid Instant transfer: an Instant transfer sends GBP, EUR or USD, not "${send}"` })
    if (!FIATS.includes(receive) && receive !== 'USDC') return this.json(res, 400, { error: `economy: invalid Instant transfer: an Instant transfer delivers GBP, EUR, USD or USDC, not "${receive}"` })
    if (!Number.isInteger(b.send_minor) || (b.send_minor ?? 0) <= 0) return this.json(res, 400, { error: 'economy: invalid Instant transfer: send_minor is a positive number of pence or cents' })
    if (b.to !== 'talyvor_account') return this.json(res, 400, { error: `economy: invalid Instant transfer: the stand-in quotes to a talyvor_account only, not "${b.to}"` })
    const minor = b.send_minor ?? 0
    const fee = this.broken('instant-fee-dropped') ? 0 : Math.ceil((minor * FEE_BPS) / 10_000)
    const now = Date.now()
    const q: Quote = { id: `itq_${randomUUID()}`, workspace_id: ws, to: b.to, send_minor: minor, send_currency: send, fee_bps: this.broken('instant-fee-dropped') ? 0 : FEE_BPS,
      fee_minor: fee, rate: '1', receive_minor: minor - fee, receive_currency: receive, arrives_in_seconds: true,
      expires_at: new Date(now + (this.broken('instant-quote-long') ? 2 * QUOTE_LIFE_MS : QUOTE_LIFE_MS)).toISOString(), created_at: new Date(now).toISOString() }
    this.quotes.set(q.id, q)
    return this.json(res, 201, q)
  }

  private async send(req: IncomingMessage, res: ServerResponse, ws: string, agentID: string): Promise<void> {
    const b = await this.body<{ quote_id?: string; to_account_id?: string }>(req)
    const may = this.mayInstant(ws, agentID)
    if (may === undefined) return this.json(res, 404, { error: 'economy: no such agent in this workspace' })
    if (!may) return this.json(res, 403, { error: "economy: the agent's spending rules refuse this request: it may not use Instant transfer", code: 'agent_rule', field: 'may_instant_transfer' })
    const q = this.quotes.get(b.quote_id ?? '')
    if (q === undefined || q.workspace_id !== ws) return this.json(res, 404, { error: `economy: no such quote ${b.quote_id ?? ''}` })
    if (Date.parse(q.expires_at) <= Date.now() && !this.broken('instant-quote-expired-sent')) {
      return this.json(res, 409, { error: `economy: invalid quote: quote ${q.id} expired at ${q.expires_at.replace(/\.\d+Z$/, 'Z')}. Ask for a new one` })
    }
    return this.json(res, 403, { error: `economy: this Instant transfer to an account the agent has never sent one to waits for the workspace owner's approval before it is sent again` })
  }
}
