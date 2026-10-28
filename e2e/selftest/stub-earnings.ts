// B46.21 — earnings paid out on the money layer (Lens B46.11) in the stub Lens, as room-earnings-payout reads and writes them:
//
//   PUT  /v1/money/payout-details   {asset, holder, iban}: saved, verified by the Test partner, pending for a holder naming TESTPENDING
//   POST /v1/rooms/{id}/payouts     {amount_minor, currency} with an Idempotency-Key, the room's owner's: the room's split
//                                   (stub-rooms.ts roomSplit) held out of its wallet's account, each member paid once —
//                                   completed to verified details, held without them
//   GET  /v1/money/earnings-payouts the payouts the workspace made or was paid, newest first
//
// STUB_BREAK=room-payout-twice pays the same payout again as new payouts, past what the wallet holds — a defect room-earnings-payout must FAIL on.

import type { IncomingMessage, ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { roomSplit } from './stub-rooms.ts'

interface Details { workspace_id: string; asset: string; holder: string; iban: string; partner: string; status: string; updated_at: string }
interface Payout { id: string; workspace_id: string; agent_id: string; kind: string; source: string; agreement: string; recipient_workspace_id: string
  amount_minor: number; currency: string; funding: string; status: string; partner: string; partner_ref: string; detail: string; created_at: string }
/** The account a payout is held out of: PayeeDesk's, changed in place. */
interface Account { test_minor: number; balance_minor: number }

export class EarningsDesk {
  private readonly details = new Map<string, Details>()
  private readonly payouts: Payout[] = []

  private readonly json: (res: ServerResponse, status: number, body: unknown) => void
  private readonly body: <T>(req: IncomingMessage) => Promise<T>
  private readonly broken: (name: string) => boolean
  private readonly wallet: (ws: string, agentID: string, asset: string) => Account

  constructor(json: EarningsDesk['json'], body: EarningsDesk['body'], broken: EarningsDesk['broken'], wallet: EarningsDesk['wallet']) {
    this.json = json
    this.body = body
    this.broken = broken
    this.wallet = wallet
  }

  /** The earnings routes on workspace `ws`'s key: true when `path` was one of them. */
  async route(req: IncomingMessage, res: ServerResponse, ws: string, path: string): Promise<boolean> {
    if (path === '/v1/money/payout-details' && req.method === 'PUT') {
      const b = await this.body<{ asset?: string; holder?: string; iban?: string }>(req)
      const asset = (b.asset ?? '').toUpperCase()
      const holder = (b.holder ?? '').trim()
      const iban = (b.iban ?? '').replaceAll(' ', '').toUpperCase()
      if (holder === '' || !['GBP', 'EUR', 'USD'].includes(asset) || !/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) {
        return this.json(res, 400, { error: `economy: invalid payout details: ${asset} is paid to an IBAN` }), true
      }
      const d: Details = { workspace_id: ws, asset, holder, iban, partner: 'sandbox', status: holder.toUpperCase().includes('TESTPENDING') ? 'pending' : 'verified',
        updated_at: new Date().toISOString() }
      this.details.set(`${ws} ${asset}`, d)
      return this.json(res, 200, d), true
    }
    if (path === '/v1/money/earnings-payouts' && req.method === 'GET') {
      return this.json(res, 200, { payouts: this.payouts.filter((p) => p.workspace_id === ws || p.recipient_workspace_id === ws).reverse() }), true
    }
    const m = /^\/v1\/rooms\/([^/]+)\/payouts$/.exec(path)
    if (m === null || req.method !== 'POST') return false
    const key = String(req.headers['idempotency-key'] ?? '')
    if (key === '') return this.json(res, 400, { error: 'rooms: invalid request: a payout carries an Idempotency-Key of up to 128 characters' }), true
    const b = await this.body<{ amount_minor?: number; currency?: string }>(req)
    const currency = (b.currency ?? '').toUpperCase()
    const split = roomSplit(decodeURIComponent(m[1]), ws, b.amount_minor ?? 0)
    if ('error' in split) return this.json(res, split.status, { error: split.error }), true
    const source = `room:${decodeURIComponent(m[1])}:${key}`
    const from = this.wallet(ws, split.wallet, currency)
    const made = (to: string) => this.broken('room-payout-twice') ? undefined : this.payouts.find((p) => p.workspace_id === ws && p.source === source && p.recipient_workspace_id === to)
    const fresh = split.shares.filter((s) => s.minor > 0 && made(s.ws) === undefined)
    const total = fresh.reduce((n, s) => n + s.minor, 0)
    if (total > from.test_minor && !this.broken('room-payout-twice')) return this.json(res, 402, { error: `economy: the agent's account does not hold enough: ${from.test_minor} of ${total} minor` }), true
    const now = new Date().toISOString()
    const out = split.shares.filter((s) => s.minor > 0).map((s) => {
      const had = made(s.ws)
      if (had !== undefined) return had
      const verified = this.details.get(`${s.ws} ${currency}`)?.status === 'verified'
      const id = `mpo_${randomUUID()}`
      const p: Payout = { id, workspace_id: ws, agent_id: split.wallet, kind: 'room_split', source, agreement: split.agreement, recipient_workspace_id: s.ws,
        amount_minor: s.minor, currency, funding: 'test', status: verified ? 'completed' : 'held', partner: verified ? 'sandbox' : '', partner_ref: verified ? `sbx_${id}` : '',
        detail: verified ? '' : `held until ${s.ws} has verified ${currency} payout details`, created_at: now }
      from.test_minor -= s.minor
      from.balance_minor -= s.minor
      this.payouts.push(p)
      return p
    })
    return this.json(res, 200, { agreement: split.agreement, payouts: out }), true
  }
}
