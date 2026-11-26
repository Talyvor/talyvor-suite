// B48.21 SELF-TEST — the stand-in Lens's crypto wallet of an agent, end to end (talyvor-lens B48.8, B48.9, B48.10 and B48.15),
// as agent-crypto-wallet reads and writes it, on the owner's session, for an agent whose smart account stub-spend-permissions.ts
// made (B48.38's desk, which also answers 503 for it with STUB_SMART_ACCOUNTS=off):
//   POST …/agents/{id}/wallet-moves/quote and …/{move}/confirm          a top-up by card through the Test ramp, posted once
//   POST …/agents/{id}/crypto-sends/challenge and …/crypto-sends        the owner's send, signed with the passkey, landed at once
//   GET  …/agents/{id}/crypto-sends                                     what the agent sent and was sent
//   POST and GET …/agents/{id}/crypto-requests(/{req})                  a request to be paid, matched to an exact deposit
//   POST …/agents/{id}/freeze and …/sweep                               the account frozen; the call that pays all it holds
//   GET  …/agents/{id}/wallet/activity                                  the agent's ledger, newest first
// A wallet is kept here from the first of these routes its owner calls (or the first send it is paid by); until then its crypto
// sends are B48.38's desk's, judged against the owner's spend permission, so that scenario's agents are answered as before. A send
// between two agents posts to both ledgers at once, as the chain indexer does in its own time. Its defects:
//   crypto-frozen-sends — a frozen agent's send still lands and moves its money
//   crypto-request-unmatched — a deposit is never matched, so a paid request stays open
//   crypto-sweep-short — the sweep's call pays 1 micro-USDC less than the account holds

import type { IncomingMessage, ServerResponse } from 'node:http'
import { createHash, createPublicKey, randomBytes, randomUUID, verify } from 'node:crypto'

interface Assertion { credential_id?: string; client_data_json?: string; authenticator_data?: string; signature?: string }
interface Line { entry_id: string; account_id: string; kind: string; amount_minor: number; balance_after_minor: number; at: string }
interface Account { address: string; credential_id: string; ws: string; frozen: boolean; lines: Line[] }
interface Send { id: string; network: string; token: string; amount_minor: number; to: string; agent_id: string; direction: string; status: string
  reason?: string; tx_hash?: string; created_at: string }
interface Request { id: string; agent_id: string; token: string; network: string; chain_id: number; asset: string; pay_to: string; amount_minor: number; memo: string
  expires_at: string; payer_address?: string; received_minor: number; created_at: string }

const NETWORK = 'base-sepolia'
const CHAIN_ID = 84532
const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e'
/** The Test ramp's rate: USDC per pound, and its fee, nothing. */
const GBP_USDC = 1.25
const hex = (n: number) => `0x${randomBytes(n).toString('hex')}`
const word = (s: string) => s.toLowerCase().replace(/^0x/, '').padStart(64, '0')

export class CryptoWalletDesk {
  /** The wallets kept here, by agent. */
  private readonly accounts = new Map<string, Account>()
  private readonly moves = new Map<string, { id: string; agent: string; sell_minor: number; buy_minor: number; status: string; entry_id?: string }>()
  private readonly sends = new Map<string, Send[]>()
  /** Each send asked for, by its Idempotency-Key: the challenge it is signed over, then the send. */
  private readonly sendKeys = new Map<string, { challenge: string; send?: Send }>()
  private readonly requests = new Map<string, Request>()

  private readonly json: (res: ServerResponse, status: number, body: unknown) => void
  private readonly body: <T>(req: IncomingMessage) => Promise<T>
  private readonly broken: (name: string) => boolean
  private readonly passkeys: (ws: string) => { credential_id: string; public_key: string }[]
  /** `agentID`'s smart account, as B48.38's desk made it. */
  private readonly smartAccount: (agentID: string) => { address: string; credential_id: string } | undefined
  /** The agent whose smart account is at an address. */
  private readonly agentAt: (address: string) => string | undefined
  /** The workspace an agent is in, while it is not archived. */
  private readonly wsOf: (agentID: string) => string | undefined

  constructor(json: CryptoWalletDesk['json'], body: CryptoWalletDesk['body'], broken: CryptoWalletDesk['broken'], passkeys: CryptoWalletDesk['passkeys'],
    smartAccount: CryptoWalletDesk['smartAccount'], agentAt: CryptoWalletDesk['agentAt'], wsOf: CryptoWalletDesk['wsOf']) {
    this.json = json
    this.body = body
    this.broken = broken
    this.passkeys = passkeys
    this.smartAccount = smartAccount
    this.agentAt = agentAt
    this.wsOf = wsOf
  }

  /** `agentID`'s wallet, kept here from now on when `adopt` and it has a smart account. */
  private wallet(agentID: string, adopt: boolean): Account | undefined {
    const kept = this.accounts.get(agentID)
    if (kept !== undefined || !adopt) return kept
    const smart = this.smartAccount(agentID)
    const ws = this.wsOf(agentID)
    if (smart === undefined || ws === undefined) return undefined
    const a: Account = { address: smart.address, credential_id: smart.credential_id, ws, frozen: false, lines: [] }
    this.accounts.set(agentID, a)
    return a
  }

  /** The owner's routes under /v1/workspaces/{ws}: `rest` is the path after it. True when `rest` was one of them. */
  async route(req: IncomingMessage, res: ServerResponse, ws: string, rest: string): Promise<boolean> {
    const m = /^\/agents\/([^/]+)\/(wallet-moves\/quote|wallet-moves\/[^/]+\/confirm|crypto-sends(?:\/challenge)?|crypto-requests(?:\/[^/]+)?|freeze|sweep|wallet\/activity)$/.exec(rest)
    if (m === null) return false
    const [, agentID, what] = m
    const method = req.method ?? 'GET'
    // An agent with no smart account, or one whose crypto sends are still B48.38's desk's: answered elsewhere, as before.
    const acct = this.wallet(agentID, what !== 'crypto-sends')
    if (acct === undefined) return false
    if (acct.ws !== ws) return this.json(res, 404, { error: 'economy: no such agent in this workspace' }), true

    if (what === 'wallet/activity' && method === 'GET') return this.json(res, 200, { lines: [...acct.lines].reverse() }), true
    if (what === 'wallet-moves/quote' && method === 'POST') {
      const { route = '', amount_minor = 0, currency = '' } = await this.body<{ route?: string; amount_minor?: number; currency?: string }>(req)
      if (route !== 'card' || currency !== 'GBP' || !(amount_minor > 0)) return this.json(res, 400, { error: 'economy: wallet top-up or cash-out: the stub quotes a card top-up in GBP' }), true
      const mv = { id: `wmv_${randomUUID()}`, agent: agentID, sell_minor: amount_minor, buy_minor: Math.floor(amount_minor * GBP_USDC * 10_000), status: 'quoted' }
      this.moves.set(mv.id, mv)
      return this.json(res, 200, this.move(mv)), true
    }
    if (what.startsWith('wallet-moves/') && method === 'POST') {
      const mv = this.moves.get(what.split('/')[1])
      if (mv === undefined || mv.agent !== agentID) return this.json(res, 404, { error: 'economy: no such top-up or cash-out' }), true
      if (mv.status === 'quoted') {
        mv.status = 'posted'
        mv.entry_id = this.post(acct, 'wallet_top_up', mv.buy_minor)
      }
      return this.json(res, 200, this.move(mv)), true
    }
    if (what === 'crypto-sends/challenge' && method === 'POST') {
      const k = req.headers['idempotency-key']
      const b = await this.body<{ to?: string; network?: string; token?: string; amount_minor?: number }>(req)
      if (typeof k !== 'string' || k === '') return this.json(res, 400, { error: 'economy: invalid crypto send: an Idempotency-Key is required' }), true
      const challenge = randomBytes(32).toString('base64url')
      this.sendKeys.set(`${agentID} ${k}`, { challenge })
      return this.json(res, 200, { challenge, allow_credentials: [acct.credential_id], user_verification: 'required', quote: { ...b, token: 'USDC' } }), true
    }
    if (what === 'crypto-sends' && method === 'GET') return this.json(res, 200, { sends: [...(this.sends.get(agentID) ?? [])].reverse() }), true
    if (what === 'crypto-sends' && method === 'POST') return this.send(req, res, agentID, acct), true
    if (what === 'crypto-requests' && method === 'POST') {
      const b = await this.body<{ token?: string; network?: string; amount_minor?: number; memo?: string; expires_at?: string; payer_address?: string }>(req)
      if (b.network !== NETWORK || (b.token ?? 'USDC') !== 'USDC' || !((b.amount_minor ?? 0) > 0)) return this.json(res, 400, { error: `economy: invalid crypto request: network is ${NETWORK}, token USDC` }), true
      const r: Request = { id: `creq_${randomUUID()}`, agent_id: agentID, token: 'USDC', network: NETWORK, chain_id: CHAIN_ID, asset: USDC, pay_to: acct.address,
        amount_minor: b.amount_minor ?? 0, memo: b.memo ?? '', expires_at: b.expires_at ?? '', payer_address: b.payer_address, received_minor: 0, created_at: new Date().toISOString() }
      this.requests.set(r.id, r)
      return this.json(res, 201, this.request(r)), true
    }
    if (what.startsWith('crypto-requests') && method === 'GET') {
      const id = what.split('/')[1]
      if (id === undefined) return this.json(res, 200, { requests: [...this.requests.values()].filter((r) => r.agent_id === agentID).map((r) => this.request(r)) }), true
      const r = this.requests.get(id)
      if (r === undefined || r.agent_id !== agentID) return this.json(res, 404, { error: 'economy: no such crypto request' }), true
      return this.json(res, 200, this.request(r)), true
    }
    if (what === 'freeze' && method === 'POST') {
      acct.frozen = true
      return this.json(res, 200, { agent_id: agentID, frozen: true, frozen_at: new Date().toISOString() }), true
    }
    if (what === 'sweep' && method === 'POST') {
      const { network = '', to = '' } = await this.body<{ network?: string; to?: string }>(req)
      if (network !== NETWORK || !/^0x[0-9a-fA-F]{40}$/.test(to) || to.toLowerCase() === acct.address.toLowerCase()) {
        return this.json(res, 400, { error: "smartaccount: invalid: a sweep pays the person's own wallet" }), true
      }
      const held = this.balance(acct) - (this.broken('crypto-sweep-short') ? 1 : 0)
      if (held <= 0) return this.json(res, 400, { error: 'smartaccount: invalid: the account holds nothing to sweep' }), true
      // executeBatch((USDC, 0, transfer(to, held))): the transfer is in the call as its selector and its two words.
      const call = `0x34fcd5be${word('20')}${word('1')}${word('20')}${word(USDC)}${word('0')}${word('60')}${word('44')}a9059cbb${word(to)}${held.toString(16).padStart(64, '0')}${'0'.repeat(56)}`
      return this.json(res, 200, { agent_id: agentID, account: acct.address, network, to, call }), true
    }
    return false
  }

  private async send(req: IncomingMessage, res: ServerResponse, agentID: string, acct: Account): Promise<void> {
    const k = req.headers['idempotency-key']
    const b = await this.body<{ to?: string; network?: string; token?: string; amount_minor?: number; assertion?: Assertion }>(req)
    const asked = typeof k === 'string' ? this.sendKeys.get(`${agentID} ${k}`) : undefined
    if (asked?.send !== undefined) return this.json(res, asked.send.status === 'landed' ? 200 : 403, asked.send)
    const refused = asked === undefined ? "economy: this workspace signs the owner's crypto sends with a passkey or the phone app" : this.refused(acct.ws, asked.challenge, b.assertion)
    if (refused !== undefined) return this.json(res, 403, { error: refused })
    const amount = b.amount_minor ?? 0
    const to = (b.to ?? '').toLowerCase()
    if (b.network !== NETWORK || b.token !== 'USDC' || !(amount > 0) || !/^0x[0-9a-f]{40}$/.test(to)) return this.json(res, 400, { error: 'economy: invalid crypto send' })
    const s: Send = { id: `csnd_${randomUUID()}`, network: NETWORK, token: 'USDC', amount_minor: amount, to, agent_id: agentID, direction: 'out', status: 'landed', created_at: new Date().toISOString() }
    if (acct.frozen && !this.broken('crypto-frozen-sends')) Object.assign(s, { status: 'refused', reason: 'smartaccount: the account is frozen' })
    else if (this.balance(acct) < amount) Object.assign(s, { status: 'refused', reason: 'the account does not hold that much USDC' })
    else {
      s.tx_hash = hex(32)
      this.post(acct, 'crypto_send_out', -amount)
      const toAgent = this.agentAt(to)
      const dest = toAgent === undefined ? undefined : this.wallet(toAgent, true)
      if (toAgent !== undefined && dest !== undefined) {
        this.post(dest, 'crypto_send_in', amount)
        this.sends.set(toAgent, [...(this.sends.get(toAgent) ?? []), { ...s, id: `csnd_${randomUUID()}`, agent_id: toAgent, direction: 'in' }])
        const open = [...this.requests.values()].find((r) => r.agent_id === toAgent && r.received_minor === 0 && r.amount_minor === amount &&
          (r.payer_address ?? acct.address).toLowerCase() === acct.address.toLowerCase())
        if (open !== undefined && !this.broken('crypto-request-unmatched')) open.received_minor = amount
      }
    }
    this.sends.set(agentID, [...(this.sends.get(agentID) ?? []), s])
    this.sendKeys.set(`${agentID} ${k}`, { challenge: asked?.challenge ?? '', send: s })
    return this.json(res, s.status === 'landed' ? 200 : 403, s)
  }

  private balance(a: Account): number {
    return a.lines.at(-1)?.balance_after_minor ?? 0
  }

  private post(a: Account, kind: string, amount: number): string {
    const entry = `ent_${randomUUID()}`
    a.lines.push({ entry_id: entry, account_id: `acc_usdc_${a.address.slice(2, 10)}`, kind, amount_minor: amount, balance_after_minor: this.balance(a) + amount, at: new Date().toISOString() })
    return entry
  }

  private move(mv: { id: string; agent: string; sell_minor: number; buy_minor: number; status: string; entry_id?: string }) {
    return { id: mv.id, agent_id: mv.agent, route: 'card', sell_minor: mv.sell_minor, sell_currency: 'GBP', fee_minor: 0, buy_minor: mv.buy_minor, buy_currency: 'USDC',
      rate: String(GBP_USDC), partner: 'test', funding: 'test', status: mv.status, entry_id: mv.entry_id }
  }

  /** A request as Lens's CryptoRequest.fill answers it: where it stands, and its x402 requirement while something is due. */
  private request(r: Request) {
    const remaining = Math.max(0, r.amount_minor - r.received_minor)
    const status = remaining === 0 ? 'paid' : r.received_minor > 0 ? 'partial' : 'open'
    const link = `https://app.talyvor.com/pay/crypto/${r.id}`
    return { ...r, status, remaining_minor: remaining, overpaid_minor: 0, late_minor: 0, link,
      uri: `ethereum:${r.asset}@${r.chain_id}/transfer?address=${r.pay_to}&uint256=${remaining}`,
      x402: remaining === 0 ? undefined : { x402Version: 1, accepts: [{ scheme: 'exact', network: r.network, maxAmountRequired: String(remaining), resource: link,
        description: r.memo, mimeType: 'application/json', payTo: r.pay_to, maxTimeoutSeconds: 3600, asset: r.asset, extra: { name: 'USDC', version: '2' } }] } }
  }

  private refused(ws: string, challenge: string, a: Assertion | undefined): string | undefined {
    if (a === undefined) return 'passkey: the passkey ceremony is not valid: no assertion'
    const spki = this.passkeys(ws).find((k) => k.credential_id === a.credential_id)?.public_key
    if (!spki) return "passkey: the passkey ceremony is not valid: not one of the workspace's passkeys"
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
