// B17.561 — Send USDC from an agent's crypto wallet (talyvor-suite B48.36, on Lens B48.9 and B48.49), once a run, on a
// workspace of its own.
//
// On Lens's API the owner registers a passkey, makes a crypto agent whose smart account that passkey owns, signs it a spend
// permission and tops it up by card. Then, on the app's own routes, as the Send screen calls them: Lens quotes 10 USDC to a
// shop, a new address; the owner's Send, signed with the passkey under one Idempotency-Key, lands; Send pressed again under the
// same key answers that same send. The agent's history holds one send to the shop and its ledger one movement of 10 USDC. The
// agent, on its own key, sends 5 USDC to another new address: it waits for the owner and nothing moves. The owner sends a test
// amount of 1 USDC there first, signed: it lands and the agent's send still waits; their signed yes then sends the 5, and the
// ledger moves by each once. The agent's 3 USDC to a third new address, declined, is refused and moves nothing. Every balance
// is read from the agent's ledger (its wallet activity), never a status code.
//
// While Lens has agents' smart accounts or their crypto sends switched off (503), it is a SKIP, never a pass. The nightly never
// reaches a real network: Lens's sandbox networks only.

import { randomBytes } from 'node:crypto'
import { fail } from './bank.ts'
import type { Answered } from './lens.ts'
import { RUN_SALT } from './oracles.ts'
import { softPasskey } from './payees.ts'
import { said } from './routes.ts'
import { CannotTest, type Scenario, type ScenarioCtx } from './scenarios.ts'
import { BASE_SEPOLIA_USDC, NETWORK } from './spendPermission.ts'
import type { WalletLine } from './walletStatements.ts'

/** USDC has 6 decimals: 1 USDC is 1,000,000 micro-USDC. */
const USDC = 1_000_000
const TOP_UP_PENCE = 5_000
const SENT = 10 * USDC
const ASKED = 5 * USDC
const TEST = 1 * USDC
const DECLINED = 3 * USDC
const SHOP = '0x000000000000000000000000000000000000b561'
const FRESH = '0x000000000000000000000000000000000000b562'
const UNPAID = '0x000000000000000000000000000000000000b563'
/** How long the chain indexer may take to post a movement to the ledger. */
const INDEXED_MS = 90_000
/** How long a send that moved nothing is given to show up on the ledger, were it to move something after all. */
const QUIET_MS = 5_000

interface Send { id: string; status: string; reason?: string; direction: string; to: string; amount_minor: number; tx_hash?: string }
interface Quote { network: string; token: string; amount_minor: number; to: string; new_address: boolean; fee_paid_by: string }

/** One of the app's own routes (/api/…), as the signed-in owner's browser calls it. */
export type AppCall = (method: string, path: string, body?: object, headers?: Record<string, string>) => Promise<{ status: number; text: string }>

/** The app's routes from the owner's own browser session, with the app's Origin as every write carries it. */
const fromApp = (ctx: ScenarioCtx): AppCall => async (method, path, body, headers = {}) => {
  const origin = new URL(ctx.app.page.url()).origin
  const r = await ctx.app.page.request.fetch(`${origin}${path}`, { method, headers: { Origin: origin, ...headers }, ...(body === undefined ? {} : { data: body }) })
  return { status: r.status(), text: await r.text().catch(() => '') }
}

const parsed = <T>(text: string): T | undefined => {
  try {
    return JSON.parse(text) as T
  } catch {
    return undefined
  }
}

export function agentCryptoSend(app: (ctx: ScenarioCtx) => AppCall = fromApp): Scenario {
  return {
    id: 'agent-crypto-send',
    owner: 'talyvor-suite',
    own: true,
    agents: 1,
    feature: 'Agent Wallets',
    items: ['B48.36', 'B17.561'],
    title: "Send USDC from an agent's crypto wallet: quoted, sent and sent again under one key, it lands once on the agent's history " +
      'and its ledger; the agent\'s send to a new address waits, a test amount lands then the send, and a declined one moves nothing',
    run: async (ctx) => run(ctx, app(ctx)),
  }
}

async function run(ctx: ScenarioCtx, api: AppCall) {
  const { lens } = ctx.env
  const user = ctx.app.user
  const off = (status: number, text: string, note: string) => {
    if (status === 503) throw new CannotTest(`${note}: Lens answered 503 (${text.slice(0, 200)}): agents' crypto wallets are not switched on in this Lens`)
  }
  const onLens = async <T>(method: string, path: string, body: object | undefined, note: string): Promise<Answered<T>> => {
    const got = await lens.act<T>(user, method, path, body)
    ctx.evidence.push({ note, answer: said(got) })
    off(got.status, got.ok ? '' : got.error, note)
    return got
  }
  const onApp = async <T>(method: string, path: string, body: object | undefined, note: string, headers?: Record<string, string>) => {
    const r = await api(method, path, body, headers)
    ctx.evidence.push({ note, answer: `${r.status} ${r.text.slice(0, 400)}` })
    off(r.status, r.text, note)
    return { status: r.status, text: r.text, value: parsed<T>(r.text) }
  }
  const key = () => `e2e-cs-${randomBytes(6).toString('hex')}`

  // 1. On Lens's API: the owner's passkey, a crypto agent, its smart account, its key, a spend permission, and a top-up by card.
  const reg = await onLens<{ challenge: string; rp_id: string }>('POST', '/v1/workspaces/{ws}/agents/passkeys/challenge', {}, 'the owner asks to register a passkey')
  if (!reg.ok) return fail(`the passkey registration challenge was refused: ${said(reg)}`)
  const passkey = softPasskey(reg.value.rp_id)
  const registered = await onLens('POST', '/v1/workspaces/{ws}/agents/passkeys', passkey.register(reg.value.challenge, 'Nightly software passkey'), 'the owner registers a passkey')
  if (registered.status !== 201) return fail(`registering a passkey must answer 201; Lens answered ${said(registered)}`)
  const made = await onLens<{ id: string }>('POST', '/v1/workspaces/{ws}/agents', { name: `Crypto sender ${RUN_SALT}`, wallet_kind: 'crypto' }, 'the owner makes a crypto agent')
  if (made.status !== 201 || !made.ok) return fail(`making a crypto agent must answer 201; Lens answered ${said(made)}`)
  const agentID = made.value.id
  const base = `/v1/workspaces/{ws}/agents/${agentID}`
  const ach = await onLens<{ challenge: string }>('POST', `${base}/smart-account/challenge`, { credential_id: passkey.credentialID }, "the smart account's challenge")
  if (!ach.ok) return fail(`the smart account's challenge must answer 200; Lens answered ${said(ach)}`)
  const account = await onLens<{ address: string }>('POST', `${base}/smart-account`, { credential_id: passkey.credentialID, assertion: passkey.assert(ach.value.challenge) },
    "the owner makes the agent's smart account with the passkey")
  if (!account.ok || !/^0x[0-9a-fA-F]{40}$/.test(account.value.address)) return fail(`the agent's smart account must answer 200 with its address; Lens answered ${said(account)}`)
  const agentKey = await onLens<{ key: string }>('POST', `${base}/keys`, { name: 'crypto-send' }, 'the owner issues the agent a key')
  if (!agentKey.ok) return fail(`issuing the agent a key was refused: ${said(agentKey)}`)
  const limit = { token: BASE_SEPOLIA_USDC, allowance: 25 * USDC, period: 'day', per_payment: 20 * USDC }
  const prep = await onLens<{ canonical: string; challenge: string }>('POST', `${base}/spend-permission/prepare`,
    { tokens: [limit], allowed: [], blocked: [], expires: new Date(Date.now() + 3600_000).toISOString() }, 'the owner prepares a spend permission of 25 USDC a day')
  if (!prep.ok) return fail(`preparing the spend permission must answer 200; Lens answered ${said(prep)}`)
  const granted = await onLens('PUT', `${base}/spend-permission`, { canonical: prep.value.canonical, assertion: passkey.assert(prep.value.challenge) }, 'the owner signs it with the passkey')
  if (!granted.ok) return fail(`signing the spend permission must answer 200; Lens answered ${said(granted)}`)
  const quoteMove = await onLens<{ id: string; buy_minor: number; buy_currency: string }>('POST', `${base}/wallet-moves/quote`, { route: 'card', amount_minor: TOP_UP_PENCE, currency: 'GBP' },
    'the owner asks to top the agent up with £50.00 by card')
  if (!quoteMove.ok || quoteMove.value.buy_currency !== 'USDC' || quoteMove.value.buy_minor < SENT + TEST + ASKED + DECLINED) {
    return fail(`a £50.00 card top-up must be quoted in USDC, enough for this run; Lens answered ${said(quoteMove)}`)
  }
  const topped = await onLens<{ status: string; buy_minor: number }>('POST', `${base}/wallet-moves/${quoteMove.value.id}/confirm`, {}, 'the owner confirms the top-up')
  if (!topped.ok || topped.value.status !== 'posted') return fail(`the confirmed top-up must post; Lens answered ${said(topped)}`)
  const bought = topped.value.buy_minor

  // The agent's ledger, newest first; and read until it holds `want`, as the chain indexer posts in its own time.
  const ledger = async (note: string): Promise<WalletLine[]> => {
    const got = await onLens<{ lines: WalletLine[] | null }>('GET', `${base}/wallet/activity`, undefined, note)
    if (!got.ok) throw new Error(`reading the agent's ledger (${note}) was refused: ${said(got)}`)
    return got.value.lines ?? []
  }
  const holds = (lines: readonly WalletLine[]) => lines[0]?.balance_after_minor ?? 0
  const settled = async (want: number, note: string): Promise<{ lines: WalletLine[]; wrong?: string }> => {
    const until = Date.now() + INDEXED_MS
    for (;;) {
      const lines = await ledger(note)
      if (holds(lines) === want) return { lines }
      if (Date.now() > until) return { lines, wrong: `${note}: the agent's ledger must hold ${want}; it holds ${holds(lines)} after ${INDEXED_MS / 1000}s` }
      await new Promise((r) => setTimeout(r, 3_000))
    }
  }
  // Once the ledger holds `want`, a quiet while, then exactly `moved` new lines since `before`, and still `want`.
  const movedOnce = async (before: readonly WalletLine[], want: number, moved: number, note: string): Promise<string | undefined> => {
    const s = await settled(want, note)
    if (s.wrong !== undefined) return s.wrong
    await new Promise((r) => setTimeout(r, QUIET_MS))
    const after = await ledger(`${note}, a moment later`)
    if (holds(after) !== want || after.length - before.length !== moved) {
      return `${note}: the agent's ledger must hold ${want} with ${moved} new line(s); it holds ${holds(after)} with ${after.length - before.length}: ${JSON.stringify(after.slice(0, 4)).slice(0, 300)}`
    }
    return undefined
  }
  const start = await settled(bought, 'the top-up posted')
  if (start.wrong !== undefined) return fail(start.wrong)

  const app = `/api/agents/${encodeURIComponent(agentID)}/crypto-sends`
  const history = async (note: string): Promise<Send[]> => {
    const r = await onApp<{ sends: Send[] | null }>('GET', app, undefined, note)
    if (r.status !== 200 || r.value === undefined) throw new Error(`the agent's history (${note}) answered ${r.status} ${r.text.slice(0, 200)}`)
    return r.value.sends ?? []
  }

  // 2. On the app: Lens's quote, the owner's Send signed with the passkey, and Send pressed again under the same key. The app
  // answers Lens's 503 as 502, so whether crypto sends are on is asked of Lens itself first (a quote: nothing moves).
  const body = { to: SHOP, network: NETWORK, token: 'USDC', amount_minor: SENT }
  await onLens('POST', `${base}/crypto-sends/quote`, body, "Lens's own quote, to see crypto sends are on")
  const quote = await onApp<Quote>('POST', `${app}/quote`, body, 'the owner asks the app for a quote: 10 USDC to the shop')
  const q = quote.value
  if (quote.status !== 200 || q === undefined || q.amount_minor !== SENT || q.to.toLowerCase() !== SHOP || q.network !== NETWORK || q.new_address !== true || (q.fee_paid_by ?? '') === '') {
    return fail(`the quote for 10 USDC to the shop must answer 200 with the amount, the address, the network, who pays the fee, and that it is a new address; the app answered ${quote.status} ${quote.text.slice(0, 300)}`)
  }
  const k = key()
  const press = async (note: string) => {
    const ch = await onApp<{ challenge: string }>('POST', `${app}/challenge`, body, `the challenge for ${note}`, { 'Idempotency-Key': k })
    if (ch.status !== 200 || ch.value === undefined) return ch
    return onApp<Send>('POST', app, { ...body, assertion: passkey.assert(ch.value.challenge) }, note, { 'Idempotency-Key': k })
  }
  const first = await press('the owner presses Send: 10 USDC to the shop')
  const sent = first.value as Send | undefined
  if (first.status !== 200 || sent?.status !== 'landed' || (sent.tx_hash ?? '') === '') {
    return fail(`the owner's signed 10 USDC to the shop must land with its transaction (200 landed); the app answered ${first.status} ${first.text.slice(0, 300)}`)
  }
  const again = await press('the owner presses Send again under the same Idempotency-Key')
  if (again.status !== 200 || (again.value as Send | undefined)?.id !== sent.id) {
    return fail(`Send pressed again under the same key must answer the same landed send ${sent.id}; the app answered ${again.status} ${again.text.slice(0, 300)}`)
  }
  const toShop = (await history("the agent's history after Send, twice")).filter((s) => s.direction === 'out' && s.to.toLowerCase() === SHOP)
  if (toShop.length !== 1 || toShop[0].id !== sent.id) return fail(`Send pressed twice under one key must be one send to the shop on the agent's history; it holds ${toShop.length}: ${JSON.stringify(toShop).slice(0, 300)}`)
  const once = await movedOnce(start.lines, bought - SENT, 1, '10 USDC sent once')
  if (once !== undefined) return fail(once)

  // 3. The agent, on its own key, sends 5 USDC to a new address: it waits for the owner, and nothing moves.
  const asAgent = async (to: string, amount: number, note: string) => {
    const r = await lens.as(agentKey.value.key, 'POST', `${base.replace('{ws}', user.workspaceID)}/crypto-sends`, { to, network: NETWORK, token: 'USDC', amount_minor: amount },
      { 'Idempotency-Key': key() })
    ctx.evidence.push({ note, answer: `${r.status} ${r.text.slice(0, 400)}` })
    off(r.status, r.text, note)
    return { status: r.status, text: r.text, send: parsed<Send>(r.text) }
  }
  const before = await ledger('the ledger before the agent asks')
  const asked = await asAgent(FRESH, ASKED, 'the agent sends 5 USDC to a new address on its own key')
  if (asked.status !== 202 || asked.send?.status !== 'awaiting_owner') return fail(`the agent's send to a new address must wait for the owner (202 awaiting_owner); Lens answered ${asked.status} ${asked.text.slice(0, 300)}`)
  const waiting = asked.send
  const still = await movedOnce(before, bought - SENT, 0, 'the agent\'s send waits')
  if (still !== undefined) return fail(still)

  // 4. The owner sends a test amount there first, signed: it lands, and the agent's send still waits. Then their yes sends it.
  const yes = async (test: number, note: string) => {
    const b = test > 0 ? { test_amount_minor: test } : {}
    const ch = await onApp<{ challenge: string }>('POST', `${app}/${encodeURIComponent(waiting.id)}/approve/challenge`, b, `the challenge for ${note}`)
    if (ch.status !== 200 || ch.value === undefined) return ch
    return onApp<Send>('POST', `${app}/${encodeURIComponent(waiting.id)}/approve`, { ...b, assertion: passkey.assert(ch.value.challenge) }, note)
  }
  const tested = await yes(TEST, 'the owner sends a test amount of 1 USDC first')
  const t = tested.value as Send | undefined
  if (tested.status !== 200 || t?.status !== 'landed' || t.amount_minor !== TEST || t.to.toLowerCase() !== FRESH || t.id === waiting.id) {
    return fail(`a signed test amount of 1 USDC must land as its own send to the same address (200 landed); the app answered ${tested.status} ${tested.text.slice(0, 300)}`)
  }
  const pending = (await history("the agent's history after the test amount")).find((s) => s.id === waiting.id)
  if (pending?.status !== 'awaiting_owner') return fail(`after the test amount the agent's 5 USDC must still wait for the owner; it is ${JSON.stringify(pending ?? null).slice(0, 300)}`)
  const testedOnce = await movedOnce(before, bought - SENT - TEST, 1, 'the test amount sent once')
  if (testedOnce !== undefined) return fail(testedOnce)
  const approved = await yes(0, "the owner approves the agent's 5 USDC")
  const a = approved.value as Send | undefined
  if (approved.status !== 200 || a?.status !== 'landed' || a.id !== waiting.id || (a.tx_hash ?? '') === '') {
    return fail(`the owner's signed yes must send the agent's 5 USDC and it must land (200 landed); the app answered ${approved.status} ${approved.text.slice(0, 300)}`)
  }
  const approvedOnce = await movedOnce(before, bought - SENT - TEST - ASKED, 2, 'the test amount, then the send')
  if (approvedOnce !== undefined) return fail(approvedOnce)

  // 5. The agent's 3 USDC to a third new address, declined by the owner: refused, and nothing moves.
  const third = await asAgent(UNPAID, DECLINED, 'the agent sends 3 USDC to another new address on its own key')
  if (third.status !== 202 || third.send?.status !== 'awaiting_owner') return fail(`the agent's send to another new address must wait for the owner (202 awaiting_owner); Lens answered ${third.status} ${third.text.slice(0, 300)}`)
  const lastLines = await ledger('the ledger before the owner declines')
  // The app answers a refusal with its sentence alone: the send's own status is read from the history below.
  const declined = await onApp('POST', `${app}/${encodeURIComponent(third.send.id)}/decline`, undefined, "the owner declines the agent's 3 USDC")
  if (declined.status !== 403) return fail(`a declined send must be refused (403); the app answered ${declined.status} ${declined.text.slice(0, 300)}`)
  const held = bought - SENT - TEST - ASKED
  const nothing = await movedOnce(lastLines, held, 0, 'the declined send')
  if (nothing !== undefined) return fail(nothing)
  const out = (await history("the agent's history at the end")).filter((s) => s.direction === 'out')
  const landed = out.filter((s) => s.status === 'landed').map((s) => s.amount_minor).sort((x, y) => x - y)
  if (JSON.stringify(landed) !== JSON.stringify([TEST, ASKED, SENT]) || out.find((s) => s.id === third.send?.id)?.status !== 'refused') {
    return fail(`the agent's history must hold three sends landed (1, 5 and 10 USDC) and the declined one refused; it holds ${JSON.stringify(out.map((s) => [s.amount_minor, s.status]))}`)
  }
  return { pass: true, detail: `10 USDC landed once (${sent.tx_hash}) though Send was pressed twice; the agent's 5 USDC to a new address waited, 1 USDC went first, ` +
    `then the 5 landed; the declined 3 moved nothing; the ledger holds ${held}` }
}
