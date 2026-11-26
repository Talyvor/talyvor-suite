// B61.48 SELF-TEST — the stand-in Lens's launch areas that had no scenario: Instant transfer, Help and the account's kind.
//
// GET /v1/workspaces/{ws}/account answers a synthetic workspace as Lens makes one: business, hybrid (migration 0373).
//
// Instant transfer (Lens B59.14, B59.15), as instant-transfer-quote reads it:
//   POST …/money/instant-transfers/quote {send_minor, send_currency, receive_currency, to}   201, locked for 30 seconds: the fee
//        is LENS_FX_MARGIN_BPS (here 50) of what is sent above the plan's free part (here 200, free_minor), rounded up,
//        and the beneficiary gets what is left at a rate of 1
//   POST …/agents/{id}/money/instant-transfers {quote_id, to_account_id} and an Idempotency-Key   refused 403 field
//        may_instant_transfer without the agent's rule; a quote past its 30 seconds refused 409 "… expired … Ask for a new
//        one"; more than the agent's account holds refused 409; then judged as Lens judges it (B61.67): to an account the
//        agent never sent one to, or above its approval amount, it files the owner's approval and is refused 403 with
//        nothing moved, and once that approval is signed a send of the same goes through once. Sent, the agent's account is
//        down by what the quote sends and the beneficiary's up by what it delivers; the same key again answers the same
//        transfer and moves nothing
//   GET  …/money/instant-transfers/{id}   the transfer
//
// B56.29 — currency conversion (Lens B56.23), as currency-convert-margin reads it:
//   POST …/agents/{id}/money/convert/quote {sell_currency, buy_currency, sell_minor}   201: business_studio's margin (FX_MARGIN_BPS,
//        here 60, as the stub's public fees state it) on what is sold above what the month still converts free (FX_FREE_MINOR,
//        here 100000 a workspace in the currency sold), rounded up, and the rest bought at the Test partner's reference rate
//        (£1 = $1.25, €1 = $1.10), rounded down
//   POST …/agents/{id}/money/convert {quote_id} and an Idempotency-Key   one fx_conversion entry: the agent's account in the
//        currency sold down by sell_minor, its account in the currency bought up by buy_minor; more than it holds refused 409;
//        the same key again answers the same conversion and moves nothing
//   GET  /v1/money/accounts/{id}/statement   the lines the conversions posted to the account
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
//   instant-fee-on-free    — a quote charges its fee on the part that converts free too (B17.518)
//   request-kind-support   — every request is filed as support, a complaint too, so it gets no reference
//   instant-sent-twice     — the same Idempotency-Key again sends again
//   instant-not-credited   — the beneficiary's account is not credited
//   instant-above-sent     — a send above the agent's approval amount, to an account it sent to before, goes through
//   fx-absent              — no conversion routes, as a Lens before B56.23
//   fx-margin-dropped      — a conversion takes no margin, and the partner converts all of it
//   fx-margin-on-free      — the margin is taken on the part that converts free too
//   fx-converted-twice     — the same Idempotency-Key again is converted again, not answered with the conversion it made

import type { IncomingMessage, ServerResponse } from 'node:http'
import { randomBytes, randomUUID } from 'node:crypto'

const QUOTE_LIFE_MS = 30_000
const FEE_BPS = 50
/** What of each quote converts free under the plan, as Lens's B61.58 allowance leaves it: the fee is on the rest. */
const FREE_MINOR = 200

interface Quote { id: string; workspace_id: string; to: string; send_minor: number; send_currency: string; fee_bps: number; fee_minor: number; free_minor: number
  rate: string; receive_minor: number; receive_currency: string; arrives_in_seconds: boolean; expires_at: string; created_at: string }
interface Transfer { id: string; workspace_id: string; agent_id: string; quote_id: string; idempotency_key: string; funding: string; from_account_id: string
  to_account_id: string; send_minor: number; send_currency: string; fee_minor: number; receive_minor: number; receive_currency: string; rate: string
  status: string; created_at: string }
/** One of the workspace's accounts in stub-payees.ts, which a send moves money out of and into. */
interface MoneyAccount { id: string; agent_id?: string; currency: string; purpose: string; balance_minor: number; test_minor: number }
/** What the bank's rules say of an agent's send worth `ulxc`: undefined lets it through, else its refusal (stub-bank.ts). */
type InstantJudge = (ws: string, agentID: string, ulxc: number, fingerprint: string, newPayee: boolean, memo: string) => { status: number; error: string } | undefined
interface FiledRequest { id: number; kind: string; state: string; reference: string; message: string; answer: string; filed_at: string; updated_at: string }

interface Company { company_name: string; registration_number: string; country: string; people: { name: string; role: string; share_bps: number }[] }

const KINDS = ['support', 'complaint', 'account_closure', 'data_export', 'data_deletion']
const FIATS = ['GBP', 'EUR', 'USD']
/** What a cent or a penny is worth in µLXC, as the stub's other payments count it. */
const ULXC_PER_MINOR = 10_000
/** B56.29 — business_studio's fx_margin_bps and fx_free_minor (talyvor-lens internal/fees), and the Test partner's USD per unit. */
const FX_MARGIN_BPS = 60
const FX_FREE_MINOR = 100_000
const USD_PER_UNIT: Record<string, number> = { GBP: 1.25, EUR: 1.1, USD: 1 }

interface Conversion { id: string; workspace_id: string; agent_id: string; from_account_id: string; to_account_id: string; sell_minor: number; sell_currency: string
  margin_bps: number; margin_minor: number; free_minor: number; buy_minor: number; buy_currency: string; reference_rate: string; rate: string; funding: string
  status: string; idempotency_key?: string; entry_id?: string; expires_at: string; created_at: string }
interface StatementLine { entry_id: string; line: number; at: string; kind: string; amount_minor: number; funding: string; state: string }

export class LaunchDesk {
  private readonly quotes = new Map<string, Quote>()
  private readonly requests = new Map<string, FiledRequest[]>()
  private readonly companies = new Map<string, Company>()
  private readonly transfers: Transfer[] = []
  private readonly conversions = new Map<string, Conversion>()
  /** What each workspace converted free this month, by the currency sold. */
  private readonly freeUsed = new Map<string, number>()
  private readonly statementLines = new Map<string, StatementLine[]>()
  private nextRequest = 1

  private readonly json: (res: ServerResponse, status: number, body: unknown) => void
  private readonly body: <T>(req: IncomingMessage) => Promise<T>
  private readonly broken: (name: string) => boolean
  /** Whether the workspace's agent has "Can use Instant transfer" on; undefined for no such agent. */
  private readonly mayInstant: (ws: string, agentID: string) => boolean | undefined
  /** B61.67 — the workspace's money accounts, and its agents' rules. */
  private readonly accounts: (ws: string) => MoneyAccount[]
  private readonly judge: InstantJudge

  constructor(json: LaunchDesk['json'], body: LaunchDesk['body'], broken: LaunchDesk['broken'], mayInstant: LaunchDesk['mayInstant'],
    accounts: LaunchDesk['accounts'], judge: InstantJudge) {
    this.json = json
    this.body = body
    this.broken = broken
    this.mayInstant = mayInstant
    this.accounts = accounts
    this.judge = judge
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
    const fx = /^\/agents\/([^/]+)\/money\/convert(\/quote)?$/.exec(rest)
    if (fx !== null && req.method === 'POST' && !this.broken('fx-absent')) return (fx[2] ? this.convertQuote(req, res, ws, fx[1]) : this.convert(req, res, ws, fx[1])), true
    const t = /^\/money\/instant-transfers\/([^/]+)$/.exec(rest)
    if (t !== null && req.method === 'GET') {
      const found = this.transfers.find((x) => x.id === t[1] && x.workspace_id === ws)
      return (found === undefined ? this.json(res, 404, { error: `economy: no such money account: no Instant transfer "${t[1]}"` }) : this.json(res, 200, found)), true
    }
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
    const free = Math.min(minor, FREE_MINOR)
    const fee = this.broken('instant-fee-dropped') ? 0 : Math.ceil(((this.broken('instant-fee-on-free') ? minor : minor - free) * FEE_BPS) / 10_000)
    const now = Date.now()
    const q: Quote = { id: `itq_${randomUUID()}`, workspace_id: ws, to: b.to, send_minor: minor, send_currency: send, fee_bps: this.broken('instant-fee-dropped') ? 0 : FEE_BPS,
      fee_minor: fee, free_minor: free, rate: '1', receive_minor: minor - fee, receive_currency: receive, arrives_in_seconds: true,
      expires_at: new Date(now + (this.broken('instant-quote-long') ? 2 * QUOTE_LIFE_MS : QUOTE_LIFE_MS)).toISOString(), created_at: new Date(now).toISOString() }
    this.quotes.set(q.id, q)
    return this.json(res, 201, q)
  }

  private async send(req: IncomingMessage, res: ServerResponse, ws: string, agentID: string): Promise<void> {
    const b = await this.body<{ quote_id?: string; to_account_id?: string; idempotency_key?: string }>(req)
    const key = String(req.headers['idempotency-key'] ?? b.idempotency_key ?? '').trim()
    if (key === '') return this.json(res, 400, { error: 'economy: invalid Instant transfer: a send carries an idempotency key (the Idempotency-Key header, or idempotency_key), up to 200 characters' })
    const again = this.transfers.find((x) => x.workspace_id === ws && x.agent_id === agentID && x.idempotency_key === key)
    if (again !== undefined && !this.broken('instant-sent-twice')) return this.json(res, 200, again)
    const may = this.mayInstant(ws, agentID)
    if (may === undefined) return this.json(res, 404, { error: 'economy: no such agent in this workspace' })
    if (!may) return this.json(res, 403, { error: "economy: the agent's spending rules refuse this request: it may not use Instant transfer", code: 'agent_rule', field: 'may_instant_transfer' })
    const q = this.quotes.get(b.quote_id ?? '')
    if (q === undefined || q.workspace_id !== ws) return this.json(res, 404, { error: `economy: no such quote ${b.quote_id ?? ''}` })
    if (Date.parse(q.expires_at) <= Date.now() && !this.broken('instant-quote-expired-sent')) {
      return this.json(res, 409, { error: `economy: invalid quote: quote ${q.id} expired at ${q.expires_at.replace(/\.\d+Z$/, 'Z')}. Ask for a new one` })
    }
    if (again === undefined && this.transfers.some((x) => x.quote_id === q.id)) return this.json(res, 409, { error: `economy: invalid quote: quote ${q.id} has been sent already, under another key` })
    const mine = this.accounts(ws)
    const from = mine.find((a) => a.agent_id === agentID && a.currency === q.send_currency)
    if (from === undefined) return this.json(res, 404, { error: `economy: no such money account: the agent has no ${q.send_currency} account` })
    const to = mine.find((a) => a.id === b.to_account_id && (a.purpose === 'company' || a.purpose === 'agent'))
    if (to === undefined) return this.json(res, 404, { error: `economy: no such money account: no open Talyvor account "${b.to_account_id ?? ''}" to send to` })
    if (to.currency !== q.receive_currency) return this.json(res, 400, { error: `economy: invalid Instant transfer: the account holds ${to.currency} and the quote delivers ${q.receive_currency}` })
    if (from.test_minor < q.send_minor) {
      return this.json(res, 409, { error: `economy: not enough for this move: the account holds ${from.test_minor} of test money, and this transfer sends ${q.send_minor}` })
    }
    // An approval is for the transfer, not the quote: sent again after it, at a new quote, it finds it.
    const fingerprint = `instant\0${agentID}\0${from.id}\0${to.id}\0${q.send_minor}\0${q.send_currency}\0${q.receive_currency}\0test`
    const newPayee = !this.transfers.some((x) => x.agent_id === agentID && x.to_account_id === to.id && x.status === 'received')
    const refused = this.judge(ws, agentID, q.send_minor * ULXC_PER_MINOR, fingerprint, newPayee, `Instant transfer of ${q.send_minor} ${q.send_currency}`)
    if (refused !== undefined) return this.json(res, refused.status, { error: refused.error })
    from.test_minor -= q.send_minor
    from.balance_minor -= q.send_minor
    if (!this.broken('instant-not-credited')) {
      to.test_minor += q.receive_minor
      to.balance_minor += q.receive_minor
    }
    const sent: Transfer = { id: `itr_${randomUUID()}`, workspace_id: ws, agent_id: agentID, quote_id: q.id, idempotency_key: key, funding: 'test', from_account_id: from.id,
      to_account_id: to.id, send_minor: q.send_minor, send_currency: q.send_currency, fee_minor: q.fee_minor, receive_minor: q.receive_minor,
      receive_currency: q.receive_currency, rate: q.rate, status: 'received', created_at: new Date().toISOString() }
    this.transfers.push(sent)
    return this.json(res, 200, sent)
  }

  /** B56.29 — GET /v1/money/accounts/{id}/statement on `ws`'s key: the lines its conversions posted. False for any other route. */
  moneyRoute(req: IncomingMessage, res: ServerResponse, ws: string, path: string): boolean {
    const m = /^\/v1\/money\/accounts\/([^/]+)\/statement$/.exec(path)
    if (m === null || req.method !== 'GET' || this.broken('fx-absent')) return false
    const a = this.accounts(ws).find((x) => x.id === m[1])
    if (a === undefined) return this.json(res, 404, { error: 'economy: no such money account' }), true
    return this.json(res, 200, { workspace_id: ws, account_id: a.id, agent_id: a.agent_id ?? '', currency: a.currency, lines: this.statementLines.get(a.id) ?? [] }), true
  }

  private async convertQuote(req: IncomingMessage, res: ServerResponse, ws: string, agentID: string): Promise<void> {
    const b = await this.body<{ sell_currency?: string; buy_currency?: string; sell_minor?: number }>(req)
    const sellCur = (b.sell_currency ?? '').toUpperCase()
    const buyCur = (b.buy_currency ?? '').toUpperCase()
    if (!FIATS.includes(sellCur) || !FIATS.includes(buyCur) || sellCur === buyCur) {
      return this.json(res, 400, { error: `economy: invalid conversion: a conversion sells one of GBP, EUR or USD for another, not "${sellCur}" for "${buyCur}"` })
    }
    const sell = b.sell_minor ?? 0
    if (!Number.isInteger(sell) || sell <= 0) return this.json(res, 400, { error: 'economy: invalid conversion: sell_minor is a positive number of pence or cents' })
    const mine = this.accounts(ws)
    const from = mine.find((a) => a.agent_id === agentID && a.purpose === 'agent' && a.currency === sellCur)
    const to = mine.find((a) => a.agent_id === agentID && a.purpose === 'agent' && a.currency === buyCur)
    if (from === undefined || to === undefined) {
      return this.json(res, 404, { error: `economy: no such money account: the agent has no open ${from === undefined ? sellCur : buyCur} account to convert with` })
    }
    const free = Math.min(sell, Math.max(0, FX_FREE_MINOR - (this.freeUsed.get(`${ws}\n${sellCur}`) ?? 0)))
    const margin = this.broken('fx-margin-dropped') ? 0 : Math.ceil(((this.broken('fx-margin-on-free') ? sell : sell - free) * FX_MARGIN_BPS) / 10_000)
    const rate = USD_PER_UNIT[sellCur] / USD_PER_UNIT[buyCur]
    const buy = Math.floor((sell - margin) * rate)
    const now = Date.now()
    const c: Conversion = { id: `mfx_${randomUUID()}`, workspace_id: ws, agent_id: agentID, from_account_id: from.id, to_account_id: to.id, sell_minor: sell,
      sell_currency: sellCur, margin_bps: FX_MARGIN_BPS, margin_minor: margin, free_minor: free, buy_minor: buy, buy_currency: buyCur, reference_rate: rate.toFixed(8),
      rate: (buy / sell).toFixed(8), funding: 'test', status: 'quoted', expires_at: new Date(now + QUOTE_LIFE_MS).toISOString(), created_at: new Date(now).toISOString() }
    this.conversions.set(c.id, c)
    return this.json(res, 201, c)
  }

  private async convert(req: IncomingMessage, res: ServerResponse, ws: string, agentID: string): Promise<void> {
    const b = await this.body<{ quote_id?: string; idempotency_key?: string }>(req)
    const key = String(req.headers['idempotency-key'] ?? b.idempotency_key ?? '').trim()
    if (key === '') return this.json(res, 400, { error: 'economy: invalid conversion: a conversion carries an idempotency key (the Idempotency-Key header, or idempotency_key), up to 200 characters' })
    const prior = [...this.conversions.values()].find((x) => x.workspace_id === ws && x.idempotency_key === key)
    if (prior !== undefined && !this.broken('fx-converted-twice')) {
      return prior.id === b.quote_id && prior.agent_id === agentID ? this.json(res, 200, prior) : this.json(res, 409, { error: 'economy: idempotency key reused for another movement' })
    }
    const c = this.conversions.get(b.quote_id ?? '')
    if (c === undefined || c.workspace_id !== ws || c.agent_id !== agentID) return this.json(res, 404, { error: `economy: invalid quote: no such quote ${b.quote_id ?? ''}` })
    if (c.status === 'converted' && !this.broken('fx-converted-twice')) return this.json(res, 409, { error: `economy: invalid quote: quote ${c.id} has converted already, under another key` })
    if (Date.parse(c.expires_at) <= Date.now()) return this.json(res, 409, { error: `economy: invalid quote: quote ${c.id} expired at ${c.expires_at.replace(/\.\d+Z$/, 'Z')}. Ask for a new one` })
    const mine = this.accounts(ws)
    const from = mine.find((a) => a.id === c.from_account_id)
    const to = mine.find((a) => a.id === c.to_account_id)
    if (from === undefined || to === undefined) return this.json(res, 404, { error: 'economy: no such money account' })
    if (from.test_minor < c.sell_minor) {
      return this.json(res, 409, { error: `economy: not enough for this move: the account holds ${from.test_minor} of test money, and this conversion sells ${c.sell_minor}` })
    }
    from.test_minor -= c.sell_minor
    from.balance_minor -= c.sell_minor
    to.test_minor += c.buy_minor
    to.balance_minor += c.buy_minor
    const freeKey = `${ws}\n${c.sell_currency}`
    this.freeUsed.set(freeKey, (this.freeUsed.get(freeKey) ?? 0) + c.free_minor)
    const entry = `ment_${randomUUID()}`
    const at = new Date().toISOString()
    for (const [account, amount, line] of [[from.id, -c.sell_minor, 0], [to.id, c.buy_minor, 3]] as const) {
      this.statementLines.set(account, [...(this.statementLines.get(account) ?? []), { entry_id: entry, line, at, kind: 'fx_conversion', amount_minor: amount, funding: 'test', state: 'completed' }])
    }
    Object.assign(c, { status: 'converted', idempotency_key: key, entry_id: entry })
    return this.json(res, 200, c)
  }
}
