// B17.563 — the owner's money in one place (talyvor-suite B48.19, on Lens B48.8 and B48.14), on Wallets, once a run, on a
// workspace of its own.
//
// On Lens's API the owner registers a passkey, makes two crypto agents whose smart accounts that passkey owns, tops the first
// up by card and issues it a key. Then in the app, on Wallets (/money/wallets): the first agent's USDC wallet is dragged onto
// the second's, 25 USDC typed, and Move pressed twice. The move is one money entry, −25 USDC on the first agent's ledger and
// +25 on the second's, summing to zero; confirmed again from another tab, nothing more moves. The first agent, on its own key,
// sends 5 USDC to a new address: it waits, and Wallets says "1 waiting for you."; Open Approvals, Review and Approve, signed by
// the browser's passkey, and the 5 USDC leaves its ledger once. Last, Statements' Download CSV for the run's own month holds both
// agents' wallets, the move on each, and each one's closing balance as its ledger holds it. Every balance is read from the
// ledger, never a status code.
//
// While Lens has agents' smart accounts, the ramp or crypto sends switched off (503), it is a SKIP, never a pass. The nightly
// never reaches a real network: Lens's sandbox networks only.

import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { ACTION_TIMEOUT_MS, fail } from './bank.ts'
import type { Answered } from './lens.ts'
import { RUN_SALT } from './oracles.ts'
import { softPasskey } from './payees.ts'
import { said } from './routes.ts'
import { CannotTest, type Scenario, type ScenarioCtx } from './scenarios.ts'
import { NETWORK } from './spendPermission.ts'
import type { WalletLine } from './walletStatements.ts'

/** USDC has 6 decimals: 1 USDC is 1,000,000 micro-USDC. */
const USDC = 1_000_000
const TOP_UP_PENCE = 5_000
const MOVED = 25 * USDC
const ASKED = 5 * USDC
const FRESH = '0x000000000000000000000000000000000000b563'
/** How long the ledger, and the chain indexer behind it, may take to post a movement. */
const POSTED_MS = 90_000

interface Move { id: string; agent_id: string; route: string; status: string; sell_minor: number; sell_currency: string; buy_minor: number; buy_currency: string; entry_id?: string }
interface CurrencyAccount { id: string; agent_id?: string; currency: string; purpose: string; status: string }
interface Send { id: string; status: string; direction: string; to: string; amount_minor: number }

/** RFC 4180 rows: quoted fields may hold commas, quotes and line breaks. */
export function csvRows(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const endField = () => {
    row.push(field)
    field = ''
  }
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') endField()
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      endField()
      rows.push(row)
      row = []
    } else field += c
  }
  if (field !== '' || row.length > 0) {
    endField()
    rows.push(row)
  }
  return rows
}

export function walletsTogether(): Scenario {
  return {
    id: 'wallets-together',
    owner: 'talyvor-suite',
    own: true,
    agents: 2,
    feature: 'Agent Wallets',
    items: ['B48.19', 'B17.563'],
    title: "the owner's money in one place, on Wallets: one agent's wallet dragged onto another's and 25 USDC moved with Move pressed twice " +
      'is one entry, −25 on one ledger and +25 on the other; an agent\'s send to a new address is "1 waiting for you.", approved on Approvals ' +
      "and sent once; and the month's CSV holds both agents' wallets",
    run: async (ctx) => run(ctx),
  }
}

async function run(ctx: ScenarioCtx) {
  const { lens } = ctx.env
  const user = ctx.app.user
  const page = ctx.app.page
  const origin = new URL(page.url()).origin
  const off = (status: number, text: string, note: string) => {
    if (status === 503) throw new CannotTest(`${note}: Lens answered 503 (${text.slice(0, 200)}): agents' crypto wallets are not switched on in this Lens`)
  }
  const onLens = async <T>(method: string, path: string, body: object | undefined, note: string): Promise<Answered<T>> => {
    const got = await lens.act<T>(user, method, path, body)
    ctx.evidence.push({ note, answer: said(got) })
    off(got.status, got.ok ? '' : got.error, note)
    return got
  }
  const text = async (where: { textContent: () => Promise<string | null> }) => ((await where.textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ').trim().slice(0, 400)

  // 1. On Lens's API: the owner's passkey, two crypto agents with their smart accounts, the first topped up by card, and its key.
  const reg = await onLens<{ challenge: string; rp_id: string }>('POST', '/v1/workspaces/{ws}/agents/passkeys/challenge', {}, 'the owner asks to register a passkey')
  if (!reg.ok) return fail(`the passkey registration challenge was refused: ${said(reg)}`)
  const passkey = softPasskey(reg.value.rp_id)
  const registered = await onLens('POST', '/v1/workspaces/{ws}/agents/passkeys', passkey.register(reg.value.challenge, 'Nightly software passkey'), 'the owner registers a passkey')
  if (registered.status !== 201) return fail(`registering a passkey must answer 201; Lens answered ${said(registered)}`)
  const agent = async (name: string) => {
    const made = await onLens<{ id: string }>('POST', '/v1/workspaces/{ws}/agents', { name, wallet_kind: 'crypto' }, `the owner makes ${name}, a crypto agent`)
    if (made.status !== 201 || !made.ok) return `making a crypto agent must answer 201; Lens answered ${said(made)}`
    const base = `/v1/workspaces/{ws}/agents/${made.value.id}`
    const ch = await onLens<{ challenge: string }>('POST', `${base}/smart-account/challenge`, { credential_id: passkey.credentialID }, `${name}'s smart account's challenge`)
    if (!ch.ok) return `the smart account's challenge must answer 200; Lens answered ${said(ch)}`
    const account = await onLens<{ address: string }>('POST', `${base}/smart-account`, { credential_id: passkey.credentialID, assertion: passkey.assert(ch.value.challenge) },
      `the owner makes ${name}'s smart account with the passkey`)
    if (!account.ok) return `${name}'s smart account must answer 200; Lens answered ${said(account)}`
    return { id: made.value.id, name, base }
  }
  const a = await agent(`Wallet giver ${RUN_SALT}`)
  if (typeof a === 'string') return fail(a)
  const b = await agent(`Wallet taker ${RUN_SALT}`)
  if (typeof b === 'string') return fail(b)
  const quoteTopUp = await onLens<Move>('POST', `${a.base}/wallet-moves/quote`, { route: 'card', amount_minor: TOP_UP_PENCE, currency: 'GBP' }, `the owner asks to top ${a.name} up with £50.00 by card`)
  if (!quoteTopUp.ok || quoteTopUp.value.buy_currency !== 'USDC' || quoteTopUp.value.buy_minor < MOVED + ASKED) {
    return fail(`a £50.00 card top-up must be quoted in USDC, enough for this run; Lens answered ${said(quoteTopUp)}`)
  }
  const topped = await onLens<Move>('POST', `${a.base}/wallet-moves/${quoteTopUp.value.id}/confirm`, {}, 'the owner confirms the top-up')
  if (!topped.ok || topped.value.status !== 'posted') return fail(`the confirmed top-up must post; Lens answered ${said(topped)}`)
  const bought = topped.value.buy_minor
  const agentKey = await onLens<{ key: string }>('POST', `${a.base}/keys`, { name: 'wallets-together' }, `the owner issues ${a.name} a key`)
  if (!agentKey.ok) return fail(`issuing the agent a key was refused: ${said(agentKey)}`)

  // Each agent's ledger, newest first; and read until it holds `want`, as the ledger and the chain indexer post in their own time.
  const ledger = async (who: { name: string; base: string }, note: string): Promise<WalletLine[]> => {
    const got = await onLens<{ lines: WalletLine[] | null }>('GET', `${who.base}/wallet/activity`, undefined, `${who.name}'s ledger ${note}`)
    if (!got.ok) throw new Error(`reading ${who.name}'s ledger (${note}) was refused: ${said(got)}`)
    return got.value.lines ?? []
  }
  const holds = (lines: readonly WalletLine[]) => lines[0]?.balance_after_minor ?? 0
  const show = (lines: readonly WalletLine[]) => JSON.stringify(lines.slice(0, 5).map((l) => [l.kind, l.amount_minor, l.entry_id])).slice(0, 300)
  const settled = async (who: { name: string; base: string }, want: number, note: string): Promise<{ lines: WalletLine[]; wrong?: string }> => {
    const until = Date.now() + POSTED_MS
    for (;;) {
      const lines = await ledger(who, note)
      if (holds(lines) === want) return { lines }
      if (Date.now() > until) return { lines, wrong: `${note}: ${who.name}'s ledger must hold ${want}; it holds ${holds(lines)} after ${POSTED_MS / 1000}s: ${show(lines)}` }
      await new Promise((r) => setTimeout(r, 2_000))
    }
  }
  const start = await settled(a, bought, 'after the top-up')
  if (start.wrong !== undefined) return fail(start.wrong)

  // The two agents' USDC wallets, as Lens lists the workspace's accounts and Wallets draws them.
  const listed = await onLens<{ accounts: CurrencyAccount[] | null }>('GET', '/v1/money/accounts', undefined, "the workspace's accounts")
  if (!listed.ok) return fail(`listing the workspace's accounts was refused: ${said(listed)}`)
  const walletOf = (agentID: string) => (listed.value.accounts ?? []).find((x) => x.agent_id === agentID && x.currency === 'USDC' && x.purpose === 'agent' && x.status !== 'closed')
  const fromAccount = walletOf(a.id)
  const toAccount = walletOf(b.id)
  if (fromAccount === undefined || toAccount === undefined) {
    return fail(`both crypto agents' USDC wallets must be among the workspace's accounts; Lens lists ${JSON.stringify(listed.value.accounts ?? []).slice(0, 400)}`)
  }

  // 2. On Wallets: the first agent's wallet dragged onto the second's opens Move between agents from one to the other.
  const wallets = `${origin}/money/wallets`
  await page.goto(wallets)
  const fromRow = page.getByTestId(`wallets-agent-${fromAccount.id}`)
  const toRow = page.getByTestId(`wallets-agent-${toAccount.id}`)
  try {
    await fromRow.waitFor({ timeout: 15_000 })
    await toRow.waitFor({ timeout: 15_000 })
  } catch {
    return fail(`Wallets must draw both agents' USDC wallets; it reads ${await text(page.locator('main'))}`)
  }
  await fromRow.dragTo(toRow, { timeout: ACTION_TIMEOUT_MS })
  const dialog = page.getByRole('dialog').filter({ hasText: 'Move between agents' })
  try {
    await dialog.waitFor({ timeout: 10_000 })
  } catch {
    return fail(`dragging ${a.name}'s wallet onto ${b.name}'s must open Move between agents; the page reads ${await text(page.locator('main'))}`)
  }
  const from = await dialog.getByRole('combobox', { name: 'From', exact: true }).inputValue()
  const to = await dialog.getByRole('combobox', { name: 'To', exact: true }).inputValue()
  if (from !== fromAccount.id || to !== toAccount.id) return fail(`the drag must move from ${a.name}'s wallet to ${b.name}'s; Move between agents has From ${from} and To ${to}`)
  await dialog.getByRole('textbox', { name: 'Amount', exact: true }).fill('25')
  const quoted = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith(`/api/agents/${encodeURIComponent(b.id)}/wallet-moves/quote`), { timeout: 15_000 })
  await dialog.getByRole('button', { name: 'Continue' }).click()
  let move: Move
  try {
    const r = await quoted
    move = (await r.json()) as Move
    ctx.evidence.push({ note: 'Continue: the app asks Lens for the quote', answer: `${r.status()} ${JSON.stringify(move).slice(0, 400)}` })
    if (r.status() !== 200) return fail(`the quote for 25 USDC from ${a.name} to ${b.name} must answer 200; it answered ${r.status()} ${JSON.stringify(move).slice(0, 300)}`)
  } catch (e) {
    return fail(`Continue must ask for the move's quote; ${(e as Error).message.slice(0, 200)}; the dialog reads ${await text(dialog)}`)
  }
  if (move.status !== 'quoted' || move.route !== 'wallet' || move.agent_id !== b.id || move.sell_minor !== MOVED || move.sell_currency !== 'USDC' ||
    move.buy_minor !== MOVED || move.buy_currency !== 'USDC') {
    return fail(`the quote must be 25 USDC into ${b.name}'s wallet by route wallet; it is ${JSON.stringify(move).slice(0, 400)}`)
  }

  // 3. Move pressed twice: one entry, −25 on the first agent's ledger and +25 on the second's.
  const press = dialog.getByRole('button', { name: /^Move / })
  try {
    await press.waitFor({ timeout: 15_000 })
  } catch {
    return fail(`the quote must offer Move; the dialog reads ${await text(dialog)}`)
  }
  ctx.evidence.push({ note: 'the move reviewed', answer: await text(dialog) })
  await press.dblclick({ timeout: ACTION_TIMEOUT_MS })
  try {
    await dialog.waitFor({ state: 'hidden', timeout: 15_000 })
  } catch {
    return fail(`Move pressed twice must move the money and close; the dialog reads ${await text(dialog)}`)
  }
  const read = await onLens<Move>('GET', `${b.base}/wallet-moves/${move.id}`, undefined, 'the move after Move was pressed twice')
  if (!read.ok || read.value.status !== 'posted' || (read.value.entry_id ?? '') === '') return fail(`the move must be posted with its entry; Lens answered ${said(read)}`)
  const entry = read.value.entry_id ?? ''
  const movedOnce = async (note: string): Promise<string | undefined> => {
    const giver = await settled(a, bought - MOVED, note)
    if (giver.wrong !== undefined) return giver.wrong
    const taker = await settled(b, MOVED, note)
    if (taker.wrong !== undefined) return taker.wrong
    const out = giver.lines.filter((l) => l.entry_id === entry)
    const into = taker.lines.filter((l) => l.entry_id === entry)
    if (out.length !== 1 || into.length !== 1 || out[0].amount_minor !== -MOVED || into[0].amount_minor !== MOVED || taker.lines.length !== 1) {
      return `${note}: the move must be one entry ${entry}, ${-MOVED} on ${a.name}'s ledger and +${MOVED} on ${b.name}'s, summing to zero; ` +
        `${a.name}'s holds ${show(giver.lines)} and ${b.name}'s ${show(taker.lines)}`
    }
    return undefined
  }
  const wrong = await movedOnce('after Move was pressed twice')
  if (wrong !== undefined) return fail(wrong)
  const again = await page.request.fetch(`${origin}/api/agents/${encodeURIComponent(b.id)}/wallet-moves/${encodeURIComponent(move.id)}/confirm`, { method: 'POST', headers: { Origin: origin }, data: {} })
  ctx.evidence.push({ note: 'the owner confirms the move again from another tab', answer: `${again.status()} ${(await again.text().catch(() => '')).slice(0, 300)}` })
  const still = await movedOnce('after the move was confirmed again')
  if (still !== undefined) return fail(still)

  // 4. The first agent, on its own key, sends 5 USDC to a new address: it waits, and Wallets says so.
  const sendBody = { to: FRESH, network: NETWORK, token: 'USDC', amount_minor: ASKED }
  const sent = await lens.as(agentKey.value.key, 'POST', `${a.base.replace('{ws}', user.workspaceID)}/crypto-sends`, sendBody,
    { 'Idempotency-Key': `e2e-wt-${randomBytes(6).toString('hex')}` })
  ctx.evidence.push({ note: `${a.name} sends 5 USDC to a new address on its own key`, answer: `${sent.status} ${sent.text.slice(0, 400)}` })
  off(sent.status, sent.text, 'the agent sends 5 USDC to a new address')
  let waiting: Send | undefined
  try {
    waiting = JSON.parse(sent.text) as Send
  } catch { /* refused below */ }
  if (sent.status !== 202 || waiting?.status !== 'awaiting_owner') return fail(`the agent's send to a new address must wait for the owner (202 awaiting_owner); Lens answered ${sent.status} ${sent.text.slice(0, 300)}`)
  const sendID = waiting.id
  await page.goto(wallets)
  const count = page.getByTestId('wallets-approvals')
  try {
    await count.filter({ hasText: /^\s*1 waiting for you\./ }).waitFor({ timeout: 20_000 })
  } catch {
    return fail(`Wallets must say "1 waiting for you." with the agent's send waiting; it reads ${(await count.count()) > 0 ? await text(count) : 'no approvals line'}`)
  }
  ctx.evidence.push({ note: 'Wallets with the send waiting', answer: await text(count) })

  // 5. Open Approvals, Review and Approve: the browser's passkey (the owner's, in a virtual authenticator) signs, and it is sent once.
  const cdp = await ctx.app.context.newCDPSession(page)
  await cdp.send('WebAuthn.enable', { enableUI: false })
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  })
  await cdp.send('WebAuthn.addCredential', { authenticatorId, credential: { credentialId: Buffer.from(passkey.credentialID, 'base64url').toString('base64'),
    isResidentCredential: false, rpId: new URL(origin).hostname, privateKey: passkey.pkcs8, signCount: 1_000 } })
  await count.getByRole('link', { name: 'Open Approvals' }).click()
  const row = page.locator(`[data-crypto-send="${sendID}"]`)
  try {
    await row.waitFor({ timeout: 20_000 })
  } catch {
    return fail(`Open Approvals must show ${a.name}'s send to a new address; ${page.url()} reads ${await text(page.locator('main'))}`)
  }
  ctx.evidence.push({ note: 'Approvals: the send waiting', answer: await text(row) })
  await row.getByRole('button', { name: 'Review' }).click()
  await row.getByRole('button', { name: 'Approve', exact: true }).click()
  try {
    await row.waitFor({ state: 'detached', timeout: 20_000 })
  } catch {
    return fail(`Approve, signed by the passkey, must send it and take it off Approvals; the row reads ${await text(row)}`)
  }
  const history = await onLens<{ sends: Send[] | null }>('GET', `${a.base}/crypto-sends`, undefined, `${a.name}'s sends after Approve`)
  const landed = (history.ok ? history.value.sends ?? [] : []).find((s) => s.id === sendID)
  if (landed?.status !== 'landed') return fail(`the approved send must land; Lens has it as ${JSON.stringify(landed ?? null).slice(0, 300)}`)
  const left = bought - MOVED - ASKED
  const after = await settled(a, left, 'after Approve')
  if (after.wrong !== undefined) return fail(after.wrong)
  const sentLines = after.lines.filter((l) => l.amount_minor === -ASKED)
  if (sentLines.length !== 1 || after.lines.length !== start.lines.length + 2) {
    return fail(`the approved 5 USDC must leave ${a.name}'s ledger once; it holds ${show(after.lines)}`)
  }

  // 6. Statements: the run's own month as one CSV holds both agents' wallets, the move on each and each one's closing balance.
  const month = new Date().toISOString().slice(0, 7)
  await page.goto(wallets)
  const statements = page.getByTestId('wallets-statements')
  try {
    await statements.waitFor({ timeout: 15_000 })
  } catch {
    return fail(`Wallets must offer every wallet's statement; it reads ${await text(page.locator('main'))}`)
  }
  const shown = await statements.getByLabel('Month', { exact: true }).inputValue()
  if (shown !== month) return fail(`Statements must begin at this month, ${month}; it shows ${shown}`)
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 20_000 }), statements.getByRole('button', { name: 'Download CSV' }).click()])
  const file = download.suggestedFilename()
  const path = await download.path()
  const csv = await readFile(path, 'utf8')
  ctx.evidence.push({ note: `Download CSV: ${file}`, answer: csv.slice(0, 600) })
  if (file !== `wallets-statement-${month}.csv`) return fail(`the download must be wallets-statement-${month}.csv; it is ${file}`)
  const [head, ...rows] = csvRows(csv)
  const col = (name: string) => head?.indexOf(name) ?? -1
  const [cEntry, cAccount, cAgent, cKind, cAmount, cBalance] = ['entry_id', 'account_id', 'agent_id', 'kind', 'amount_minor', 'balance_after_minor'].map(col)
  if ([cEntry, cAccount, cAgent, cKind, cAmount, cBalance].some((i) => i < 0)) return fail(`the CSV's head must name its columns; it is ${JSON.stringify(head)}`)
  const closing = (account: string) => rows.filter((r) => r[cKind] === 'closing' && r[cAccount] === account).map((r) => Number(r[cBalance]))
  const moveRow = (account: string) => rows.filter((r) => r[cEntry] === entry && r[cAccount] === account).map((r) => Number(r[cAmount]))
  const mistakes: string[] = []
  for (const w of [{ ...a, account: fromAccount.id, held: left, amount: -MOVED }, { ...b, account: toAccount.id, held: MOVED, amount: MOVED }]) {
    if (!rows.some((r) => r[cAccount] === w.account && r[cAgent] === w.id)) mistakes.push(`${w.name}'s wallet ${w.account} is not in it`)
    const closed = JSON.stringify(closing(w.account))
    if (closed !== JSON.stringify([w.held])) mistakes.push(`${w.name}'s closing balance must be ${w.held}, as its ledger holds; it is ${closed}`)
    const moved = JSON.stringify(moveRow(w.account))
    if (moved !== JSON.stringify([w.amount])) mistakes.push(`the move's entry ${entry} must be ${w.amount} on ${w.name}'s wallet once; it is ${moved}`)
  }
  if (mistakes.length > 0) return fail(`the CSV for ${month}: ${mistakes.join('; ')}`)
  return {
    pass: true,
    detail: `${a.name}'s wallet dragged onto ${b.name}'s moved 25 USDC once though Move was pressed twice and confirmed again: entry ${entry}, ` +
      `${-MOVED} and +${MOVED}; the agent's 5 USDC to a new address read "1 waiting for you.", was approved on Approvals with the passkey and left once; ` +
      `${file} holds both wallets, the move on each, and closing balances ${left} and ${MOVED}`,
  }
}
