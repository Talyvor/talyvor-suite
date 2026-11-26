// B48.21 — an agent's full crypto wallet end to end (talyvor-lens B48.2, B48.8, B48.9, B48.10, B48.15 and B48.49), on Lens's
// API, once a run, on a workspace of its own and a second user's.
//
// The owner registers a passkey and makes a crypto agent whose smart account that passkey owns. They top it up by card through
// the ramp: the move's USDC is on the agent's ledger once. They send 10 USDC, signed with the passkey, to another user's crypto
// agent: it lands, and the chain indexer posts it to both agents' ledgers. That agent asks for 4 USDC back from the first one's
// address: the open request carries the x402 requirement an x402 client is answered with (exact, its network, its address, the
// amount due); the owner pays it with a send of exactly that, and the request reads paid, with no x402 requirement left, and
// both ledgers move by 4. The owner freezes the first agent: a send then moves nothing, on its history or its ledger. And the
// sweep to the owner's own address is the call that pays everything the ledger holds there. Every balance is read from each
// agent's ledger (its wallet activity), never a status code. Paying a request over x402 itself waits for talyvor-lens B48.11.
//
// While Lens has agents' smart accounts, their crypto sends, the chain indexer or the ramp switched off (503), it is a SKIP,
// never a pass. The nightly never reaches a real network: Lens's sandbox networks only.

import { randomBytes } from 'node:crypto'
import { fail } from './bank.ts'
import type { Answered, SyntheticUser } from './lens.ts'
import { RUN_SALT } from './oracles.ts'
import { softPasskey } from './payees.ts'
import { said } from './routes.ts'
import { CannotTest, type Scenario, type ScenarioCtx } from './scenarios.ts'
import type { WalletLine } from './walletStatements.ts'

/** The network agents send on in the Sandbox (as Lens's crypto-send networks name it). */
export const NETWORK = 'base-sepolia'
/** USDC has 6 decimals: 1 USDC is 1,000,000 micro-USDC. */
const USDC = 1_000_000
/** What the owner pays by card for the top-up, in pence. */
const TOP_UP_PENCE = 5_000
const SENT = 10 * USDC
const ASKED = 4 * USDC
/** The owner's own address, the sweep's destination. */
export const OWNER_ADDRESS = '0x00000000000000000000000000000000000b4821'
/** How long the chain indexer may take to post a movement to the ledgers. */
const INDEXED_MS = 90_000
/** How long a refused send is given to show up on the ledger, were it to move anything after all. */
const REFUSED_MS = 5_000

interface Send { id: string; status: string; reason?: string; direction: string; to: string; amount_minor: number; tx_hash?: string }
interface Move { id: string; status: string; buy_minor: number; buy_currency: string; entry_id?: string }
export interface CryptoRequest { id: string; status: string; pay_to: string; network: string; asset: string; amount_minor: number; remaining_minor: number
  x402?: { x402Version?: number; accepts?: { scheme?: string; network?: string; maxAmountRequired?: string; payTo?: string; asset?: string }[] } }
export interface Sweep { account: string; network: string; to: string; call: string }

/** The ledger's balance for an agent's wallet: the newest line's balance after it (activity is newest first), 0 when it has none. */
export const ledgerBalance = (lines: readonly WalletLine[]) => lines[0]?.balance_after_minor ?? 0

/** The x402 requirement an open request answers with, judged against the request: undefined when it is right. */
export function x402Wrong(r: CryptoRequest): string | undefined {
  const a = r.x402?.accepts ?? []
  if (r.x402?.x402Version !== 1 || a.length !== 1) return `the open request must carry one x402 (version 1) requirement; it carries ${JSON.stringify(r.x402 ?? null).slice(0, 300)}`
  const [x] = a
  if (x.scheme !== 'exact' || x.network !== r.network || x.payTo?.toLowerCase() !== r.pay_to.toLowerCase() || x.asset?.toLowerCase() !== r.asset.toLowerCase() ||
    x.maxAmountRequired !== String(r.remaining_minor)) {
    return `the request's x402 requirement must be exact on ${r.network}, paying ${r.remaining_minor} of ${r.asset} to ${r.pay_to}; it is ${JSON.stringify(x).slice(0, 300)}`
  }
  return undefined
}

/** 32 bytes of `n`, as an ABI word in hex. */
const word = (n: bigint | string) => (typeof n === 'string' ? n.toLowerCase().replace(/^0x/, '') : n.toString(16)).padStart(64, '0')

/** The sweep's call judged: undefined when it pays `held` of the agent's account to the owner's own address. */
export function sweepWrong(s: Sweep, account: string, owner: string, held: number): string | undefined {
  if (s.account.toLowerCase() !== account.toLowerCase() || s.network !== NETWORK || s.to.toLowerCase() !== owner.toLowerCase()) {
    return `the sweep must be from the agent's account ${account} on ${NETWORK} to the owner's ${owner}; Lens answered ${JSON.stringify(s).slice(0, 300)}`
  }
  // The transfer inside the call: its selector, the owner's address and everything held, each an ABI word.
  const call = s.call.toLowerCase()
  if (!/^0x[0-9a-f]+$/.test(call) || !call.includes(`a9059cbb${word(owner)}${word(BigInt(held))}`)) {
    return `the sweep's call must transfer the ${held} the ledger holds to ${owner}; its call is ${s.call.slice(0, 200)}`
  }
  return undefined
}

export function agentCryptoWallet(): Scenario {
  return {
    id: 'agent-crypto-wallet',
    owner: 'talyvor-lens',
    own: true,
    agents: 1,
    feature: 'Agent Wallets',
    items: ['B48.8', 'B48.9', 'B48.10', 'B48.15', 'B48.21'],
    title: "an agent's crypto wallet end to end: topped up by card, 10 USDC sent to another user's agent, 4 asked back with its x402 " +
      'requirement and paid, a send after a freeze moves nothing, and the sweep pays the owner everything — each on both ledgers',
    run: async (ctx) => run(ctx),
  }
}

async function run(ctx: ScenarioCtx) {
  const { lens } = ctx.env
  const owner = ctx.app.user
  const call = async <T>(user: SyntheticUser, method: string, path: string, body: object | undefined, note: string, headers: Record<string, string> = {}): Promise<Answered<T>> => {
    const got = await lens.act<T>(user, method, path, body, headers)
    ctx.evidence.push({ note, answer: said(got) })
    if (got.status === 503) throw new CannotTest(`${note}: Lens answered 503 (${got.ok ? '' : got.error.slice(0, 200)}): agents' crypto wallets are not switched on in this Lens`)
    return got
  }
  const key = () => `e2e-cw-${randomBytes(6).toString('hex')}`

  // A user's passkey, a crypto agent and its smart account owned by that passkey.
  const wallet = async (user: SyntheticUser, name: string) => {
    const reg = await call<{ challenge: string; rp_id: string }>(user, 'POST', '/v1/workspaces/{ws}/agents/passkeys/challenge', {}, `${name}'s owner asks to register a passkey`)
    if (!reg.ok) return `the passkey registration challenge was refused: ${said(reg)}`
    const passkey = softPasskey(reg.value.rp_id)
    const registered = await call(user, 'POST', '/v1/workspaces/{ws}/agents/passkeys', passkey.register(reg.value.challenge, 'Nightly software passkey'), `${name}'s owner registers a passkey`)
    if (registered.status !== 201) return `registering a passkey must answer 201; Lens answered ${said(registered)}`
    const made = await call<{ id: string }>(user, 'POST', '/v1/workspaces/{ws}/agents', { name: `${name} ${RUN_SALT}`, wallet_kind: 'crypto' }, `the owner makes the crypto agent ${name}`)
    if (made.status !== 201 || !made.ok) return `making a crypto agent must answer 201; Lens answered ${said(made)}`
    const base = `/v1/workspaces/{ws}/agents/${made.value.id}`
    const ach = await call<{ challenge: string }>(user, 'POST', `${base}/smart-account/challenge`, { credential_id: passkey.credentialID }, `${name}'s smart account's challenge`)
    if (!ach.ok) return `the smart account's challenge must answer 200; Lens answered ${said(ach)}`
    const account = await call<{ address: string }>(user, 'POST', `${base}/smart-account`, { credential_id: passkey.credentialID, assertion: passkey.assert(ach.value.challenge) },
      `the owner makes ${name}'s smart account with the passkey`)
    if (!account.ok || !/^0x[0-9a-fA-F]{40}$/.test(account.value.address)) return `the agent's smart account must answer 200 with its address; Lens answered ${said(account)}`
    return { user, name, id: made.value.id, base, passkey, address: account.value.address }
  }
  type Wallet = Exclude<Awaited<ReturnType<typeof wallet>>, string>

  const ledger = async (w: Wallet, note: string) => {
    const got = await call<{ lines: WalletLine[] | null }>(w.user, 'GET', `${w.base}/wallet/activity`, undefined, note)
    return got.ok ? got.value.lines ?? [] : undefined
  }
  // The chain indexer posts a movement in its own time: read the ledger until it holds `want`, or the time is up.
  const settled = async (w: Wallet, want: number, note: string): Promise<string | undefined> => {
    const until = Date.now() + INDEXED_MS
    for (;;) {
      const lines = await ledger(w, note)
      if (lines === undefined) return `reading ${w.name}'s ledger was refused (evidence)`
      if (ledgerBalance(lines) === want) return undefined
      if (Date.now() > until) return `${note}: ${w.name}'s ledger must hold ${want}; it holds ${ledgerBalance(lines)} after ${INDEXED_MS / 1000}s`
      await new Promise((r) => setTimeout(r, 3_000))
    }
  }
  // The owner's own send, signed with their passkey over its challenge (B48.49).
  const send = async (from: Wallet, to: string, amount: number, note: string) => {
    const body = { to, network: NETWORK, token: 'USDC', amount_minor: amount }
    const k = key()
    const ch = await call<{ challenge: string }>(from.user, 'POST', `${from.base}/crypto-sends/challenge`, body, `the challenge for ${note}`, { 'Idempotency-Key': k })
    if (!ch.ok) return { status: ch.status, text: ch.error }
    const r = await call<Send>(from.user, 'POST', `${from.base}/crypto-sends`, { ...body, assertion: from.passkey.assert(ch.value.challenge) }, note, { 'Idempotency-Key': k })
    return r.ok ? { status: r.status, send: r.value, text: JSON.stringify(r.value) } : { status: r.status, text: r.error }
  }

  // 1. The owner's crypto agent, and another user's.
  const payer = await wallet(owner, 'Crypto payer')
  if (typeof payer === 'string') return fail(payer)
  const [other] = await lens.createUsers(1)
  const payee = await wallet(other, 'Crypto payee')
  if (typeof payee === 'string') return fail(payee)

  // 2. A top-up by card through the ramp: quoted, confirmed once, and its USDC on the agent's ledger once.
  const quote = await call<Move>(owner, 'POST', `${payer.base}/wallet-moves/quote`, { route: 'card', amount_minor: TOP_UP_PENCE, currency: 'GBP' }, 'the owner asks to top the agent up with £50.00 by card')
  if (!quote.ok || quote.value.buy_currency !== 'USDC' || quote.value.buy_minor < SENT + ASKED + USDC) return fail(`a £50.00 card top-up must be quoted in USDC, enough for this run; Lens answered ${said(quote)}`)
  const topped = await call<Move>(owner, 'POST', `${payer.base}/wallet-moves/${quote.value.id}/confirm`, {}, 'the owner confirms the top-up')
  if (!topped.ok || topped.value.status !== 'posted' || topped.value.buy_minor !== quote.value.buy_minor) return fail(`the confirmed top-up must post its quoted ${quote.value.buy_minor}; Lens answered ${said(topped)}`)
  const bought = topped.value.buy_minor
  const unposted = await settled(payer, bought, 'the top-up posted')
  if (unposted !== undefined) return fail(unposted)
  const lines = await ledger(payer, "the agent's ledger after the top-up")
  if ((lines ?? []).filter((l) => l.entry_id === topped.value.entry_id).length !== 1) return fail(`the top-up must be on the agent's ledger once, as entry ${topped.value.entry_id}; it holds ${JSON.stringify(lines).slice(0, 300)}`)

  // 3. 10 USDC to the other user's agent, signed with the passkey: it lands, and both ledgers move by it.
  const sent = await send(payer, payee.address, SENT, "the owner sends 10 USDC to the other user's agent")
  if (sent.status !== 200 || sent.send?.status !== 'landed' || (sent.send.tx_hash ?? '') === '') return fail(`the owner's signed 10 USDC send must land with its transaction (200 landed); Lens answered ${sent.status} ${sent.text.slice(0, 300)}`)
  for (const [w, want] of [[payer, bought - SENT], [payee, SENT]] as const) {
    const wrong = await settled(w, want, 'the 10 USDC indexed')
    if (wrong !== undefined) return fail(wrong)
  }

  // 4. The other agent asks for 4 USDC back from the payer's address; the open request carries its x402 requirement; paid, it is paid.
  const asked = await call<CryptoRequest>(other, 'POST', `${payee.base}/crypto-requests`, { token: 'USDC', network: NETWORK, amount_minor: ASKED, memo: `Change ${RUN_SALT}`,
    expires_at: new Date(Date.now() + 3600_000).toISOString(), payer_address: payer.address }, 'the other agent asks the payer for 4 USDC', { 'Idempotency-Key': key() })
  if (asked.status !== 201 || !asked.ok || asked.value.status !== 'open' || asked.value.pay_to.toLowerCase() !== payee.address.toLowerCase()) {
    return fail(`a request for 4 USDC into the other agent's wallet must answer 201 open, paid to its address; Lens answered ${said(asked)}`)
  }
  const x402 = x402Wrong(asked.value)
  if (x402 !== undefined) return fail(x402)
  const paid = await send(payer, asked.value.pay_to, ASKED, 'the owner pays the request: 4 USDC to its address')
  if (paid.status !== 200 || paid.send?.status !== 'landed') return fail(`paying the request must land (200 landed); Lens answered ${paid.status} ${paid.text.slice(0, 300)}`)
  for (const [w, want] of [[payer, bought - SENT - ASKED], [payee, SENT + ASKED]] as const) {
    const wrong = await settled(w, want, 'the 4 USDC indexed')
    if (wrong !== undefined) return fail(wrong)
  }
  const closed = await call<CryptoRequest>(other, 'GET', `${payee.base}/crypto-requests/${asked.value.id}`, undefined, 'the other agent reads its request again')
  if (!closed.ok || closed.value.status !== 'paid' || closed.value.remaining_minor !== 0 || closed.value.x402 !== undefined) {
    return fail(`the request paid in full must read paid, nothing remaining and no x402 requirement; Lens answered ${said(closed)}`)
  }

  // 5. The owner freezes the payer: a send then moves nothing.
  const held = bought - SENT - ASKED
  const frozen = await call(owner, 'POST', `${payer.base}/freeze`, {}, 'the owner freezes the payer')
  if (!frozen.ok) return fail(`freezing the agent must answer 200; Lens answered ${said(frozen)}`)
  const stopped = await send(payer, payee.address, USDC, 'the owner sends 1 USDC from the frozen agent')
  if (stopped.status < 400 || stopped.send?.status === 'landed') return fail(`a send from a frozen agent must be refused; Lens answered ${stopped.status} ${stopped.text.slice(0, 300)}`)
  await new Promise((r) => setTimeout(r, REFUSED_MS))
  const after = await ledger(payer, "the frozen agent's ledger")
  if (after === undefined || ledgerBalance(after) !== held) return fail(`a refused send must move nothing: the frozen agent's ledger must still hold ${held}; it holds ${after === undefined ? 'nothing it could read' : ledgerBalance(after)}`)
  const history = await call<{ sends: Send[] | null }>(owner, 'GET', `${payer.base}/crypto-sends`, undefined, "the payer's crypto history")
  const landed = (history.ok ? history.value.sends ?? [] : []).filter((s) => s.direction === 'out' && s.status === 'landed')
  if (!history.ok || landed.length !== 2) return fail(`the payer's history must hold the two sends that landed and no more; it holds ${history.ok ? landed.length : said(history)}`)

  // 6. The sweep to the owner's own address: the call that pays everything the ledger holds.
  const sweep = await call<Sweep>(owner, 'POST', `${payer.base}/sweep`, { network: NETWORK, to: OWNER_ADDRESS }, "the owner sweeps the payer to their own address")
  if (!sweep.ok) return fail(`the sweep must answer 200 with its call; Lens answered ${said(sweep)}`)
  const swept = sweepWrong(sweep.value, payer.address, OWNER_ADDRESS, held)
  if (swept !== undefined) return fail(swept)
  return { pass: true, detail: `topped up ${bought} by card; 10 USDC landed (${sent.send.tx_hash}) and 4 USDC paid the request, its x402 requirement right, on both ledgers; ` +
    `the frozen agent's send moved nothing, and the sweep pays its ${held} to the owner` }
}
