// B48.21 SELF-TEST — the stand-in Lens's crypto wallet of an agent, end to end (talyvor-lens B48.8, B48.9, B48.10 and B48.15),
// as agent-crypto-wallet reads and writes it, on the owner's session, for an agent whose smart account stub-spend-permissions.ts
// made (B48.38's desk, which also answers 503 for it with STUB_SMART_ACCOUNTS=off):
//   POST …/agents/{id}/wallet-moves/quote and …/{move}/confirm          a top-up by card through the Test ramp, posted once
//   POST …/agents/{id}/crypto-sends/challenge and …/crypto-sends        the owner's send, signed with the passkey, landed at once
//   GET  …/agents/{id}/crypto-sends                                     what the agent sent and was sent
//   POST and GET …/agents/{id}/crypto-requests(/{req})                  a request to be paid, matched to an exact deposit
//   POST …/agents/{id}/freeze and …/sweep                               the account frozen; the call that pays all it holds
//   GET  …/agents/{id}/wallet/activity                                  the agent's ledger, newest first
//   POST …/agents/{id}/crypto-sends/quote                               B17.561: the send before it is made, a new address named
//   POST …/agents/{id}/crypto-sends on the agent's own key              B17.561: to an address the workspace never paid, it waits
//   POST …/crypto-sends/{send}/approve(/challenge) and …/decline         B17.561: the owner's signed yes, or a test amount there
//                                                                       first; or their no, which sends nothing
//   wallet_topup_link on the agent's own key's /mcp (stub-bank.ts)    B17.562: a card top-up quoted for the owner, nothing moved
//   GET  …/agents/{id}/wallet-moves/{move}                              B17.562: that quote read back by id, as its link opens it
//   POST …/agents/{id}/wallet-moves/quote {route: wallet, from_agent_id}  B17.563: a move from another of the owner's agents in USDC,
//                                                                       posted once as one entry, minus on one and plus on the other
// Each wallet's ledger posts to the agent's USDC money account (stub-payees.ts), so the workspace's accounts hold what it holds.
//   GET  …/wallet/statement?month=&format=csv|json                      B17.563: every wallet's month in one statement (Lens B48.14)
// A wallet is kept here from the first of these routes its owner calls (or the first send it is paid by); until then its crypto
// sends are B48.38's desk's, judged against the owner's spend permission, so that scenario's agents are answered as before. A send
// between two agents posts to both ledgers at once, as the chain indexer does in its own time. Its defects:
//   crypto-frozen-sends — a frozen agent's send still lands and moves its money
//   crypto-request-unmatched — a deposit is never matched, so a paid request stays open
//   crypto-sweep-short — the sweep's call pays 1 micro-USDC less than the account holds
//   crypto-send-twice — Send pressed again under the same Idempotency-Key sends a second time (B17.561)
//   crypto-decline-sends — the owner's decline sends the agent's payment anyway (B17.561)
//   topup-link-moves-early — wallet_topup_link credits the wallet at the quote, before the owner confirms (B17.562)
//   topup-confirm-twice — a top-up confirmed again credits the wallet again (B17.562)
//   agents-move-one-sided — a move between two agents credits the one it goes to and takes nothing from the other (B17.563)
//   agents-move-twice — a move between two agents confirmed again moves the money again (B17.563)
//   wallets-statement-one-agent — every wallet's statement holds only the first agent's wallet (B17.563)

import type { IncomingMessage, ServerResponse } from 'node:http'
import { createHash, createPublicKey, randomBytes, randomUUID, verify } from 'node:crypto'

interface Assertion { credential_id?: string; client_data_json?: string; authenticator_data?: string; signature?: string }
interface Line { entry_id: string; account_id: string; kind: string; amount_minor: number; balance_after_minor: number; at: string }
/** `money` is the agent's USDC money account as GET /v1/money/accounts lists it (B17.563): its id names the ledger's lines. */
interface Account { address: string; credential_id: string; ws: string; frozen: boolean; lines: Line[]; money: { id: string; balance_minor: number; test_minor: number } }
interface Send { id: string; network: string; token: string; amount_minor: number; to: string; agent_id: string; direction: string; status: string
  reason?: string; tx_hash?: string; new_address?: boolean; requested_by?: string; created_at: string }
interface Request { id: string; agent_id: string; token: string; network: string; chain_id: number; asset: string; pay_to: string; amount_minor: number; memo: string
  expires_at: string; payer_address?: string; received_minor: number; created_at: string }

const NETWORK = 'base-sepolia'
const CHAIN_ID = 84532
const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e'
/** The Test ramp's rate: USDC per pound, and its fee, nothing. */
const GBP_USDC = 1.25
const hex = (n: number) => `0x${randomBytes(n).toString('hex')}`
const word = (s: string) => s.toLowerCase().replace(/^0x/, '').padStart(64, '0')
/** How long a quote's price is held. */
const QUOTE_MS = 15 * 60_000

interface Move { id: string; agent: string; sell_minor: number; buy_minor: number; status: string; entry_id?: string; created_at: string; expires_at: string
  /** B17.563 — route wallet: the owner's other agent it comes from, in USDC; otherwise a card top-up in GBP. */
  from?: string }

export class CryptoWalletDesk {
  /** The wallets kept here, by agent. */
  private readonly accounts = new Map<string, Account>()
  private readonly moves = new Map<string, Move>()
  private readonly sends = new Map<string, Send[]>()
  /** Each send asked for, by its Idempotency-Key: the challenge it is signed over, then the send. */
  private readonly sendKeys = new Map<string, { challenge: string; send?: Send }>()
  private readonly requests = new Map<string, Request>()
  /** B17.561 — the addresses each workspace has paid, and what each answer to a waiting send is signed over. */
  private readonly paid = new Map<string, Set<string>>()
  private readonly answerChallenges = new Map<string, string>()

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
  /** B17.563 — the agent's USDC money account in `ws`, opened when it has none. */
  private readonly moneyAccount: (ws: string, agentID: string) => Account['money']

  constructor(json: CryptoWalletDesk['json'], body: CryptoWalletDesk['body'], broken: CryptoWalletDesk['broken'], passkeys: CryptoWalletDesk['passkeys'],
    smartAccount: CryptoWalletDesk['smartAccount'], agentAt: CryptoWalletDesk['agentAt'], wsOf: CryptoWalletDesk['wsOf'], moneyAccount: CryptoWalletDesk['moneyAccount']) {
    this.json = json
    this.body = body
    this.broken = broken
    this.passkeys = passkeys
    this.smartAccount = smartAccount
    this.agentAt = agentAt
    this.wsOf = wsOf
    this.moneyAccount = moneyAccount
  }

  /** `agentID`'s wallet, kept here from now on when `adopt` and it has a smart account. */
  private wallet(agentID: string, adopt: boolean): Account | undefined {
    const kept = this.accounts.get(agentID)
    if (kept !== undefined || !adopt) return kept
    const smart = this.smartAccount(agentID)
    const ws = this.wsOf(agentID)
    if (smart === undefined || ws === undefined) return undefined
    const a: Account = { address: smart.address, credential_id: smart.credential_id, ws, frozen: false, lines: [], money: this.moneyAccount(ws, agentID) }
    this.accounts.set(agentID, a)
    return a
  }

  /**
   * The routes under /v1/workspaces/{ws}: `rest` is the path after it, `agent` the agent whose own key asks ('' for the owner).
   * True when `rest` was one of them.
   */
  async route(req: IncomingMessage, res: ServerResponse, ws: string, rest: string, agent = ''): Promise<boolean> {
    if (rest === '/wallet/statement' && agent === '' && (req.method ?? 'GET') === 'GET') return this.statement(req, res, ws)
    const m = /^\/agents\/([^/]+)\/(wallet-moves\/quote|wallet-moves\/[^/]+(?:\/confirm)?|crypto-sends(?:\/challenge|\/quote|\/[^/]+\/(?:approve(?:\/challenge)?|decline))?|crypto-requests(?:\/[^/]+)?|freeze|sweep|wallet\/activity)$/.exec(rest)
    if (m === null) return false
    const [, agentID, what] = m
    const method = req.method ?? 'GET'
    // An agent with no smart account, or one whose crypto sends are still B48.38's desk's: answered elsewhere, as before.
    const acct = this.wallet(agentID, agent === '' && (!what.startsWith('crypto-sends') || what === 'crypto-sends/challenge'))
    if (acct === undefined) return false
    if (acct.ws !== ws) return this.json(res, 404, { error: 'economy: no such agent in this workspace' }), true
    if (agent !== '' && (agent !== agentID || !['crypto-sends', 'crypto-sends/quote'].includes(what))) {
      return this.json(res, 403, { error: "only the agent's own key or the workspace's owner may send its money" }), true
    }
    if (what === 'crypto-sends/quote' && method === 'POST') {
      const b = await this.body<{ to?: string; network?: string; token?: string; amount_minor?: number }>(req)
      const to = (b.to ?? '').toLowerCase()
      if (b.network !== NETWORK || b.token !== 'USDC' || !((b.amount_minor ?? 0) > 0) || !/^0x[0-9a-f]{40}$/.test(to)) return this.json(res, 400, { error: 'economy: invalid crypto send' }), true
      return this.json(res, 200, { network: NETWORK, token: 'USDC', token_address: USDC, amount_minor: b.amount_minor, to, to_kind: this.agentAt(to) === undefined ? 'address' : 'agent',
        new_address: !this.paidBy(ws).has(to), max_fee_wei: '0', fee_paid_by: 'workspace_gas_budget', arrival_seconds: 2 }), true
    }
    if (agent !== '' && what === 'crypto-sends' && method === 'POST') return this.agentSend(req, res, agentID, acct), true
    const answer = /^crypto-sends\/([^/]+)\/(approve\/challenge|approve|decline)$/.exec(what)
    if (answer !== null && method === 'POST') return this.answer(req, res, agentID, acct, answer[1], answer[2]), true

    if (what === 'wallet/activity' && method === 'GET') return this.json(res, 200, { lines: [...acct.lines].reverse() }), true
    if (what === 'wallet-moves/quote' && method === 'POST') {
      const b = await this.body<{ route?: string; amount_minor?: number; currency?: string; from_agent_id?: string }>(req)
      const q = b.route === 'wallet' ? this.quoteBetween(agentID, acct, b) : this.quote(agentID, b)
      return (typeof q === 'string' ? this.json(res, 400, { error: q }) : this.json(res, 200, this.move(q))), true
    }
    if (what.startsWith('wallet-moves/') && (method === 'POST') === what.endsWith('/confirm')) {
      const mv = this.moves.get(what.split('/')[1])
      if (mv === undefined || mv.agent !== agentID) return this.json(res, 404, { error: 'economy: no such top-up or cash-out' }), true
      if (method === 'GET') return this.json(res, 200, this.move(mv)), true
      if (mv.from !== undefined) return this.confirmBetween(res, mv, acct), true
      if (mv.status === 'quoted' || this.broken('topup-confirm-twice')) {
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
      // A send its key already began stays that send, however often its challenge is asked for again (B17.561).
      const began = this.broken('crypto-send-twice') ? undefined : this.sendKeys.get(`${agentID} ${k}`)?.send
      this.sendKeys.set(`${agentID} ${k}`, { challenge, send: began })
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
    const s: Send = { id: `csnd_${randomUUID()}`, network: NETWORK, token: 'USDC', amount_minor: amount, to, agent_id: agentID, direction: 'out', status: 'landed',
      requested_by: 'user:owner', created_at: new Date().toISOString() }
    this.land(acct, s)
    this.sends.set(agentID, [...(this.sends.get(agentID) ?? []), s])
    this.sendKeys.set(`${agentID} ${k}`, { challenge: asked?.challenge ?? '', send: s })
    return this.json(res, s.status === 'landed' ? 200 : 403, s)
  }

  /** B17.561 — the agent's own send, once per Idempotency-Key: to an address the workspace never paid, it waits for the owner. */
  private async agentSend(req: IncomingMessage, res: ServerResponse, agentID: string, acct: Account): Promise<void> {
    const k = req.headers['idempotency-key']
    const b = await this.body<{ to?: string; network?: string; token?: string; amount_minor?: number }>(req)
    const amount = b.amount_minor ?? 0
    const to = (b.to ?? '').toLowerCase()
    if (typeof k !== 'string' || k === '') return this.json(res, 400, { error: 'economy: invalid crypto send: an Idempotency-Key is required' })
    if (b.network !== NETWORK || b.token !== 'USDC' || !(amount > 0) || !/^0x[0-9a-f]{40}$/.test(to)) return this.json(res, 400, { error: 'economy: invalid crypto send' })
    const had = this.sendKeys.get(`agent ${agentID} ${k}`)?.send
    if (had !== undefined) {
      if (had.to !== to || had.amount_minor !== amount) return this.json(res, 409, { error: 'economy: that Idempotency-Key was used for another request' })
      return this.json(res, this.code(had), had)
    }
    const s: Send = { id: `csnd_${randomUUID()}`, network: NETWORK, token: 'USDC', amount_minor: amount, to, agent_id: agentID, direction: 'out', status: 'awaiting_owner',
      new_address: true, requested_by: `agent:${agentID}`, created_at: new Date().toISOString() }
    if (this.paidBy(acct.ws).has(to)) Object.assign(s, { status: 'landed', new_address: false })
    if (s.status === 'landed') this.land(acct, s)
    this.sends.set(agentID, [...(this.sends.get(agentID) ?? []), s])
    this.sendKeys.set(`agent ${agentID} ${k}`, { challenge: '', send: s })
    return this.json(res, this.code(s), s)
  }

  /** B17.561 — the owner's answer to a send waiting for them: its challenge, a signed yes (or a test amount there first), or a no. */
  private async answer(req: IncomingMessage, res: ServerResponse, agentID: string, acct: Account, sendID: string, what: string): Promise<void> {
    const s = (this.sends.get(agentID) ?? []).find((x) => x.id === sendID && x.direction === 'out')
    if (s === undefined) return this.json(res, 404, { error: 'economy: no such crypto send' })
    if (s.status !== 'awaiting_owner') return this.json(res, 400, { error: `economy: invalid crypto send: this send is ${s.status}, not waiting for you` })
    if (what === 'decline') {
      if (this.broken('crypto-decline-sends')) this.land(acct, s)
      else Object.assign(s, { status: 'refused', reason: 'the owner declined it' })
      return this.json(res, this.code(s), s)
    }
    const { test_amount_minor: test = 0, assertion } = await this.body<{ test_amount_minor?: number; assertion?: Assertion }>(req)
    if (test < 0 || test >= s.amount_minor) return this.json(res, 400, { error: 'economy: invalid crypto send: a test amount is less than the send' })
    if (what === 'approve/challenge') {
      const challenge = randomBytes(32).toString('base64url')
      this.answerChallenges.set(`${s.id} ${test}`, challenge)
      return this.json(res, 200, { challenge, allow_credentials: [acct.credential_id], user_verification: 'required' })
    }
    const refused = this.refused(acct.ws, this.answerChallenges.get(`${s.id} ${test}`) ?? '', assertion)
    if (refused !== undefined) return this.json(res, 403, { error: refused })
    this.answerChallenges.delete(`${s.id} ${test}`)
    if (test > 0) {
      // The test amount is the owner's own send to the same address; the agent's send keeps waiting.
      const t: Send = { id: `csnd_${randomUUID()}`, network: NETWORK, token: 'USDC', amount_minor: test, to: s.to, agent_id: agentID, direction: 'out', status: 'landed',
        requested_by: 'user:owner', created_at: new Date().toISOString() }
      this.land(acct, t)
      this.sends.set(agentID, [...(this.sends.get(agentID) ?? []), t])
      return this.json(res, this.code(t), t)
    }
    this.land(acct, s)
    return this.json(res, this.code(s), s)
  }

  private code(s: Send): number {
    return s.status === 'landed' ? 200 : s.status === 'refused' ? 403 : 202
  }

  private paidBy(ws: string): Set<string> {
    const paid = this.paid.get(ws) ?? new Set<string>()
    this.paid.set(ws, paid)
    return paid
  }

  /** `s` sent from `acct`: refused while it is frozen or holds too little, otherwise landed and posted to both ledgers. */
  private land(acct: Account, s: Send): void {
    const amount = s.amount_minor
    const to = s.to
    s.status = 'landed'
    if (acct.frozen && !this.broken('crypto-frozen-sends')) Object.assign(s, { status: 'refused', reason: 'smartaccount: the account is frozen' })
    else if (this.balance(acct) < amount) Object.assign(s, { status: 'refused', reason: 'the account does not hold that much USDC' })
    else {
      s.tx_hash = hex(32)
      this.paidBy(acct.ws).add(to)
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
  }

  private balance(a: Account): number {
    return a.lines.at(-1)?.balance_after_minor ?? 0
  }

  private post(a: Account, kind: string, amount: number, entry = `ent_${randomUUID()}`): string {
    const held = this.balance(a) + amount
    a.lines.push({ entry_id: entry, account_id: a.money.id, kind, amount_minor: amount, balance_after_minor: held, at: new Date().toISOString() })
    a.money.balance_minor = a.money.test_minor = held
    return entry
  }

  private move(mv: Move) {
    const between = mv.from !== undefined
    return { id: mv.id, agent_id: mv.agent, route: between ? 'wallet' : 'card', sell_minor: mv.sell_minor, sell_currency: between ? 'USDC' : 'GBP', fee_minor: 0,
      buy_minor: mv.buy_minor, buy_currency: 'USDC', rate: between ? '1' : String(GBP_USDC), partner: 'test', funding: 'test', status: mv.status, entry_id: mv.entry_id,
      ...(between ? { from_agent_id: mv.from } : {}), created_at: mv.created_at, expires_at: mv.expires_at }
  }

  /**
   * B17.563 — Lens B48.8's route wallet: `amount_minor` USDC from `from_agent_id`'s wallet to `agentID`'s, both the owner's agents in
   * one workspace, quoted at 1:1 with no fee; or why it is refused.
   */
  private quoteBetween(agentID: string, to: Account, b: { amount_minor?: number; currency?: string; from_agent_id?: string }): Move | string {
    const { amount_minor = 0, currency = '', from_agent_id: fromID = '' } = b
    if (currency.toUpperCase() !== 'USDC' || !(amount_minor > 0)) return 'economy: wallet move: the stub moves USDC between two agents\' wallets, a positive amount'
    const from = fromID === '' ? undefined : this.wallet(fromID, true)
    if (from === undefined || from.ws !== to.ws) return `economy: wallet move: agent ${fromID || '(none)'} has no USDC wallet in this workspace`
    if (fromID === agentID) return 'economy: wallet move: money moves from one wallet to another'
    const now = Date.now()
    const mv: Move = { id: `wmv_${randomUUID()}`, agent: agentID, from: fromID, sell_minor: amount_minor, buy_minor: amount_minor, status: 'quoted',
      created_at: new Date(now).toISOString(), expires_at: new Date(now + QUOTE_MS).toISOString() }
    this.moves.set(mv.id, mv)
    return mv
  }

  /** B17.563 — a move between two agents confirmed: one entry, minus on the wallet it comes from and plus on `to`, once. */
  private confirmBetween(res: ServerResponse, mv: Move, to: Account): void {
    const from = this.wallet(mv.from ?? '', false)
    if (from === undefined) return this.json(res, 404, { error: 'economy: no such top-up or cash-out' })
    if (mv.status === 'quoted' || this.broken('agents-move-twice')) {
      if (this.balance(from) < mv.sell_minor) return this.json(res, 400, { error: 'economy: wallet move: the wallet it comes from holds less than that' })
      const entry = `ent_${randomUUID()}`
      if (!this.broken('agents-move-one-sided')) this.post(from, 'wallet_wallet', -mv.sell_minor, entry)
      this.post(to, 'wallet_wallet', mv.buy_minor, entry)
      Object.assign(mv, { status: 'posted', entry_id: entry })
    }
    return this.json(res, 200, this.move(mv))
  }

  /**
   * B17.563 — GET /v1/workspaces/{ws}/wallet/statement?month=YYYY-MM&format=json|csv (Lens B48.14): every wallet's month, each
   * account's opening balance, its lines in the month, and its closing balance; the CSV's 13 columns as walletStatementCSV writes them.
   */
  private statement(req: IncomingMessage, res: ServerResponse, ws: string): true {
    const q = new URL(req.url ?? '/', 'http://stub').searchParams
    const month = q.get('month') || new Date().toISOString().slice(0, 7)
    const format = q.get('format') || 'json'
    if (!/^\d{4}-\d{2}$/.test(month)) return this.json(res, 400, { error: 'month must be YYYY-MM' }), true
    if (format !== 'json' && format !== 'csv') return this.json(res, 400, { error: 'the stub writes every wallet\'s statement as json or csv' }), true
    const from = new Date(`${month}-01T00:00:00Z`)
    const to = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1))
    const kept = [...this.accounts].filter(([, a]) => a.ws === ws).slice(0, this.broken('wallets-statement-one-agent') ? 1 : undefined)
    const accounts = kept.map(([agentID, a]) => {
      const before = a.lines.filter((l) => new Date(l.at) < from)
      const during = a.lines.filter((l) => new Date(l.at) >= from && new Date(l.at) < to)
      const opening = before.at(-1)?.balance_after_minor ?? 0
      const sum = (pick: (n: number) => boolean) => during.reduce((t, l) => t + (pick(l.amount_minor) ? l.amount_minor : 0), 0)
      return { agentID, account_id: a.money.id, agent_id: agentID, currency: 'USDC', account_name: `chain:${a.address}`, opening_minor: opening,
        in_minor: sum((n) => n > 0), out_minor: -sum((n) => n < 0), closing_minor: during.at(-1)?.balance_after_minor ?? opening, during }
    })
    const lines = accounts.flatMap((a) => a.during.map((l) => ({ ...l, line: 1, agent_id: a.agent_id, currency: 'USDC', funding: 'test', counterparty: '', ref: '', memo: '' })))
      .sort((x, y) => x.at.localeCompare(y.at))
    if (format === 'json') {
      return this.json(res, 200, { workspace_id: ws, from: from.toISOString(), to: to.toISOString(),
        accounts: accounts.map(({ agentID: _, during: __, ...a }) => a), lines }), true
    }
    const rows = [['entry_id', 'line', 'at', 'account_id', 'agent_id', 'currency', 'kind', 'amount_minor', 'funding', 'counterparty', 'ref', 'memo', 'balance_after_minor'],
      ...accounts.map((a) => ['', '', from.toISOString(), a.account_id, a.agent_id, 'USDC', 'opening', '', '', '', '', '', String(a.opening_minor)]),
      ...lines.map((l) => [l.entry_id, String(l.line), l.at, l.account_id, l.agent_id, 'USDC', l.kind, String(l.amount_minor), l.funding, '', '', '', String(l.balance_after_minor)]),
      ...accounts.map((a) => ['', '', to.toISOString(), a.account_id, a.agent_id, 'USDC', 'closing', '', '', '', '', '', String(a.closing_minor)])]
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="wallet-statement-${month}.csv"` })
    res.end(rows.map((r) => r.join(',')).join('\n') + '\n')
    return true
  }

  /** A card top-up of `agentID`'s wallet quoted, as B48.8's QuoteWalletMove makes one; or why it is refused. */
  private quote(agentID: string, b: { route?: string; amount_minor?: number; currency?: string }): Move | string {
    const { route = '', amount_minor = 0, currency = '' } = b
    if (route !== 'card' || currency !== 'GBP' || !(amount_minor > 0)) return 'economy: wallet top-up or cash-out: the stub quotes a card top-up in GBP'
    const now = Date.now()
    const mv: Move = { id: `wmv_${randomUUID()}`, agent: agentID, sell_minor: amount_minor, buy_minor: Math.floor(amount_minor * GBP_USDC * 10_000), status: 'quoted',
      created_at: new Date(now).toISOString(), expires_at: new Date(now + QUOTE_MS).toISOString() }
    this.moves.set(mv.id, mv)
    return mv
  }

  /**
   * B17.562 — Lens's wallet_topup_link (B48.39, internal/mcp/agent_wallet_tools.go) on the agent's own key, in workspace `ws`:
   * the top-up quoted as the owner's quote route quotes it, its link and its confirm route; nothing moves. Or why it is refused.
   */
  topUpLink(ws: string, agentID: string, a: Record<string, unknown>): { ok: true; body: object } | { ok: false; error: string } {
    const acct = this.wallet(agentID, true)
    if (acct === undefined || acct.ws !== ws) return { ok: false, error: 'economy: the agent has no USDC wallet' }
    const method = typeof a.method === 'string' && a.method !== '' ? a.method : 'card'
    if (method !== 'card' && method !== 'bank_transfer') return { ok: false, error: 'method is card or bank_transfer' }
    const q = this.quote(agentID, { route: method, amount_minor: Number(a.amount_minor ?? 0), currency: String(a.currency ?? '') })
    if (typeof q === 'string') return { ok: false, error: q }
    if (this.broken('topup-link-moves-early')) {
      q.status = 'posted'
      q.entry_id = this.post(acct, 'wallet_top_up', q.buy_minor)
    }
    return { ok: true, body: { move: this.move(q), link: `https://app.talyvor.com/agents/${agentID}?top_up=${q.id}`,
      confirm: `/v1/workspaces/${ws}/agents/${agentID}/wallet-moves/${q.id}/confirm`,
      message: 'Send your owner this link. They see what they pay, the fee and the USDC it buys, and confirm it before the quote expires. Nothing has moved.' } }
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
