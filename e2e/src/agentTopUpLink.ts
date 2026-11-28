// B17.562 — an agent asks its owner for a top-up through wallet_topup_link (talyvor-suite B48.46, on Lens B48.39, B48.43 and
// B48.8), and the owner's confirm on the agent's page (B48.44, B57.224) credits its wallet once. Once a run, on a workspace of
// its own.
//
// On Lens's API the owner registers a passkey, makes a crypto agent whose smart account that passkey owns, and issues it a key.
// The agent, on that key, through @modelcontextprotocol/sdk's Client over Streamable HTTP, calls the app's /mcp: it is offered
// wallet_topup_link, and asking for £20.00 by card answers Lens's quote and the link
// https://app.talyvor.com/agents/<id>?top_up=<move>, with nothing on the agent's ledger. The owner opens that link in the app:
// "Add money to <agent>" with Move £20.00, pressed twice, says Added. The agent's ledger (its wallet activity) holds the quoted
// USDC once, as the move's one entry; the move confirmed again from another tab, and the link opened again, credit nothing more.
//
// While Lens has agents' smart accounts or the ramp switched off (503), it is a SKIP, never a pass.

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { ACTION_TIMEOUT_MS, fail } from './bank.ts'
import type { Answered } from './lens.ts'
import { RUN_SALT } from './oracles.ts'
import { softPasskey } from './payees.ts'
import { said } from './routes.ts'
import { CannotTest, type Scenario, type ScenarioCtx } from './scenarios.ts'
import type { WalletLine } from './walletStatements.ts'

/** What the agent asks its owner to pay, in pence. */
const ASKED_PENCE = 2_000
/** How long the ledger is given to post the confirmed top-up. */
const POSTED_MS = 30_000

interface Move { id: string; agent_id: string; route: string; status: string; sell_minor: number; sell_currency: string; buy_minor: number; buy_currency: string; entry_id?: string }
interface TopUpLink { move?: Move; link?: string; confirm?: string }
interface ToolAnswer { isError?: boolean; content: { type: string; text?: string }[] }

const parsed = <T>(text: string): T | undefined => {
  try {
    return JSON.parse(text) as T
  } catch {
    return undefined
  }
}

export function agentTopUpLink(): Scenario {
  return {
    id: 'agent-topup-link',
    owner: 'talyvor-suite',
    own: true,
    agents: 1,
    feature: 'Agent Wallets',
    items: ['B48.46', 'B17.562'],
    title: "an agent asks its owner for a top-up through wallet_topup_link on the app's /mcp: Lens's quote and the link, nothing moved; " +
      'the owner opens the link on the agent\'s page and presses Move twice, and the USDC is on the agent\'s ledger once',
    run: async (ctx) => run(ctx),
  }
}

async function run(ctx: ScenarioCtx) {
  const { lens } = ctx.env
  const user = ctx.app.user
  const page = ctx.app.page
  const origin = new URL(page.url()).origin
  const onLens = async <T>(method: string, path: string, body: object | undefined, note: string): Promise<Answered<T>> => {
    const got = await lens.act<T>(user, method, path, body)
    ctx.evidence.push({ note, answer: said(got) })
    if (got.status === 503) throw new CannotTest(`${note}: Lens answered 503 (${got.ok ? '' : got.error.slice(0, 200)}): agents' crypto wallets are not switched on in this Lens`)
    return got
  }

  // 1. On Lens's API: the owner's passkey, a crypto agent, its smart account and its own key.
  const reg = await onLens<{ challenge: string; rp_id: string }>('POST', '/v1/workspaces/{ws}/agents/passkeys/challenge', {}, 'the owner asks to register a passkey')
  if (!reg.ok) return fail(`the passkey registration challenge was refused: ${said(reg)}`)
  const passkey = softPasskey(reg.value.rp_id)
  const registered = await onLens('POST', '/v1/workspaces/{ws}/agents/passkeys', passkey.register(reg.value.challenge, 'Nightly software passkey'), 'the owner registers a passkey')
  if (registered.status !== 201) return fail(`registering a passkey must answer 201; Lens answered ${said(registered)}`)
  const name = `Top-up asker ${RUN_SALT}`
  const made = await onLens<{ id: string }>('POST', '/v1/workspaces/{ws}/agents', { name, wallet_kind: 'crypto' }, 'the owner makes a crypto agent')
  if (made.status !== 201 || !made.ok) return fail(`making a crypto agent must answer 201; Lens answered ${said(made)}`)
  const agentID = made.value.id
  const base = `/v1/workspaces/{ws}/agents/${agentID}`
  const ach = await onLens<{ challenge: string }>('POST', `${base}/smart-account/challenge`, { credential_id: passkey.credentialID }, "the smart account's challenge")
  if (!ach.ok) return fail(`the smart account's challenge must answer 200; Lens answered ${said(ach)}`)
  const account = await onLens<{ address: string }>('POST', `${base}/smart-account`, { credential_id: passkey.credentialID, assertion: passkey.assert(ach.value.challenge) },
    "the owner makes the agent's smart account with the passkey")
  if (!account.ok) return fail(`the agent's smart account must answer 200; Lens answered ${said(account)}`)
  const agentKey = await onLens<{ key: string }>('POST', `${base}/keys`, { name: 'top-up-link' }, 'the owner issues the agent a key')
  if (!agentKey.ok) return fail(`issuing the agent a key was refused: ${said(agentKey)}`)

  // The agent's ledger, newest first: what it holds, and the lines of one entry.
  const ledger = async (note: string): Promise<WalletLine[]> => {
    const got = await onLens<{ lines: WalletLine[] | null }>('GET', `${base}/wallet/activity`, undefined, note)
    if (!got.ok) throw new Error(`reading the agent's ledger (${note}) was refused: ${said(got)}`)
    return got.value.lines ?? []
  }
  const holds = (lines: readonly WalletLine[]) => lines[0]?.balance_after_minor ?? 0
  const show = (lines: readonly WalletLine[]) => JSON.stringify(lines.map((l) => [l.kind, l.amount_minor, l.entry_id])).slice(0, 300)

  // 2. The agent, on its own key, over the MCP SDK to the app's /mcp: offered wallet_topup_link, it asks for £20.00 by card.
  const client = new Client({ name: 'talyvor-e2e-agent', version: '1.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL('/mcp', origin), { requestInit: { headers: { Authorization: `Bearer ${agentKey.value.key}` } } }))
  let asked: TopUpLink | undefined
  try {
    const { tools } = await client.listTools()
    ctx.evidence.push({ note: "the tools the app's /mcp offers the agent's key", answer: tools.map((t) => t.name).join(', ') })
    if (!tools.some((t) => t.name === 'wallet_topup_link')) return fail(`the app's /mcp must offer the agent's key wallet_topup_link; it offers ${tools.map((t) => t.name).join(', ') || 'nothing'}`)
    const args = { amount_minor: ASKED_PENCE, currency: 'GBP', method: 'card' }
    const r = await client.callTool({ name: 'wallet_topup_link', arguments: args }) as ToolAnswer
    const text = r.content.map((c) => c.text ?? '').join(' ')
    ctx.evidence.push({ note: `the agent calls wallet_topup_link ${JSON.stringify(args)}`, answer: text.slice(0, 600) })
    if (/turned off|not configured|switched off/i.test(text) && r.isError === true) throw new CannotTest(`wallet_topup_link answered ${text.slice(0, 200)}: topping up an agent's wallet is not switched on in this Lens`)
    asked = r.isError === true ? undefined : parsed<TopUpLink>(text)
    if (asked === undefined) return fail(`wallet_topup_link must answer Lens's quote and the owner's link; it answered ${text.slice(0, 300)}`)
  } finally {
    await client.close()
  }
  const before = await ledger('the agent\'s ledger after it asked')
  if (before.length > 0) return fail(`nothing may move until the owner confirms; after the agent asked, its ledger holds ${holds(before)}: ${show(before)}`)
  const move = asked.move
  if (move === undefined || move.status !== 'quoted' || move.agent_id !== agentID || move.sell_minor !== ASKED_PENCE || move.sell_currency !== 'GBP' ||
    move.buy_currency !== 'USDC' || !(move.buy_minor > 0)) {
    return fail(`wallet_topup_link must quote the £20.00 card top-up of the agent's USDC wallet; it answered ${JSON.stringify(asked).slice(0, 400)}`)
  }
  const want = `https://app.talyvor.com/agents/${agentID}?top_up=${move.id}`
  if (asked.link !== want) return fail(`wallet_topup_link's link must be ${want}; it is ${asked.link}`)

  // 3. The owner opens the link in the app and presses Move twice: Added.
  const link = new URL(asked.link)
  await page.goto(`${origin}${link.pathname}${link.search}`)
  const card = page.getByTestId('agent-top-up-link')
  try {
    await card.getByRole('heading', { name: `Add money to ${name}` }).waitFor({ timeout: 15_000 })
  } catch {
    return fail(`the link must open "Add money to ${name}" on the agent's page; the page reads ${(await page.locator('main').textContent().catch(() => ''))?.slice(0, 300)}`)
  }
  const press = card.getByRole('button', { name: /^Move / })
  try {
    await press.waitFor({ timeout: 15_000 })
  } catch {
    return fail(`the link's quote must offer Move; the card reads ${(await card.textContent())?.slice(0, 300)}`)
  }
  ctx.evidence.push({ note: 'the owner opens the link', answer: (await card.textContent())?.slice(0, 400) ?? '' })
  await press.dblclick({ timeout: ACTION_TIMEOUT_MS })
  const added = card.getByText(/Added: .* is in .*wallet/)
  try {
    await added.waitFor({ timeout: 15_000 })
  } catch {
    return fail(`Move pressed twice must say the money is added; the card reads ${(await card.textContent())?.slice(0, 300)}`)
  }
  ctx.evidence.push({ note: 'the owner presses Move twice', answer: (await card.textContent())?.slice(0, 400) ?? '' })

  // 4. The ledger holds the quoted USDC once, as the move's one entry.
  const read = await onLens<Move>('GET', `${base}/wallet-moves/${move.id}`, undefined, 'the move after the owner confirmed it')
  if (!read.ok || read.value.status !== 'posted' || (read.value.entry_id ?? '') === '' || read.value.buy_minor !== move.buy_minor) {
    return fail(`the confirmed top-up must be posted with its entry, at the quoted ${move.buy_minor}; Lens answered ${said(read)}`)
  }
  const entry = read.value.entry_id
  const once = async (note: string): Promise<string | undefined> => {
    const until = Date.now() + POSTED_MS
    for (;;) {
      const lines = await ledger(note)
      const ours = lines.filter((l) => l.entry_id === entry)
      if (holds(lines) === move.buy_minor && lines.length === 1 && ours.length === 1 && ours[0].amount_minor === move.buy_minor) return undefined
      if (holds(lines) > move.buy_minor || ours.length > 1 || Date.now() > until) {
        return `${note}: the agent's ledger must hold the quoted ${move.buy_minor} once, as entry ${entry}; it holds ${holds(lines)}: ${show(lines)}`
      }
      await new Promise((r) => setTimeout(r, 2_000))
    }
  }
  const wrong = await once('the agent\'s ledger after Move was pressed twice')
  if (wrong !== undefined) return fail(wrong)

  // 5. Confirmed again from another tab, and the link opened again: nothing more moves, and the link says it is added.
  const again = await page.request.fetch(`${origin}/api/agents/${agentID}/wallet-moves/${move.id}/confirm`, { method: 'POST', headers: { Origin: origin }, data: {} })
  ctx.evidence.push({ note: 'the owner confirms the move again from another tab', answer: `${again.status()} ${(await again.text().catch(() => '')).slice(0, 300)}` })
  await page.goto(`${origin}${link.pathname}${link.search}`)
  try {
    await added.waitFor({ timeout: 15_000 })
  } catch {
    return fail(`the link opened again must say the money is added; the card reads ${(await card.textContent().catch(() => ''))?.slice(0, 300)}`)
  }
  if (await press.count() > 0) return fail('the link opened again must not offer Move a second time')
  const still = await once('the agent\'s ledger after the move was confirmed again')
  if (still !== undefined) return fail(still)
  return {
    pass: true,
    detail: `wallet_topup_link on the app's /mcp quoted £20.00 for ${move.buy_minor} USDC minor with the link, nothing moved; Move pressed twice ` +
      `added it once (entry ${entry}), and confirming again or reopening the link moved nothing more`,
  }
}
