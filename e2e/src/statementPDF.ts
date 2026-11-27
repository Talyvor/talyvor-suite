// B28.55 — an agent's statement for any period as a PDF. A person's agent is funded and has some taken back on Agent
// Wallets, then the person downloads its statement, and every agent's, for yesterday and today as a PDF on the same
// screen. Lens's JSON statement for the same period is the oracle: each account's opening and closing balance in the PDF
// is the JSON's, and the agent's closing is what Lens's book holds for it — the ledger, never a status code.

import { type AgentBankScreen, agentIn, bookOf, fail, lxcText, openAgent, withBank } from './bank.ts'
import type { Agent } from './lens.ts'
import type { Scenario, ScenarioCtx, Verdict } from './scenarios.ts'

/** An account's opening and closing for the period, as the JSON statement gives them. */
export interface PeriodBalance { account: string; opening_ulxc: number; closing_ulxc: number }

/**
 * Lens's economy.LXCMoney (B61.16): µLXC as the dollars it is worth at the $0.10 peg and nothing else, to its last µLXC
 * below a cent, the thousands grouped — "$340.00", "$0.1649999", "-$0.0001234".
 */
export function dollarsCell(ulxc: number): string {
  if (ulxc < 0) return `-${dollarsCell(-ulxc)}`
  const digits = String(ulxc).padStart(8, '0')
  const whole = digits.slice(0, -7).replace(/\B(?=(\d{3})+$)/g, ',')
  const frac = digits.slice(-7).replace(/0+$/, '').padEnd(2, '0')
  return `$${whole}.${frac}`
}

/**
 * The PDF's opening and closing balances, in row order: each cell is one string the page shows, and an opening or
 * closing row is its date, its account, the word, then the balance. Lens's table PDF (B48.14) also draws the row's
 * empty WITH and AMOUNT cells as `()`; the page shows nothing there, so they are not read.
 */
export function pdfBalances(pdf: string): { opening: string[]; closing: string[] } {
  const cells = [...pdf.matchAll(/\(((?:[^()\\]|\\.)*)\) Tj/g)].map((m) => m[1].replace(/\\([()\\])/g, '$1')).filter((c) => c !== '')
  const out = { opening: [] as string[], closing: [] as string[] }
  for (let i = 0; i + 1 < cells.length; i++) {
    if (cells[i] === 'opening' || cells[i] === 'closing') out[cells[i] as 'opening' | 'closing'].push(cells[i + 1])
  }
  return out
}

/**
 * The oracle: the file is a PDF; it has one opening and one closing balance for each of the JSON statement's accounts,
 * in the JSON's order, each the JSON's figure; and where `held` is given, `account` closes at it in the JSON.
 */
export function statementPDFVerdict(
  file: { name: string; text: string },
  json: readonly PeriodBalance[],
  agent?: { account: string; held: number | undefined },
): { pass: boolean; detail: string } {
  const wrong: string[] = []
  if (!file.name.endsWith('.pdf') || !file.text.startsWith('%PDF-')) wrong.push(`${file.name} is not a PDF: it opens ${JSON.stringify(file.text.slice(0, 12))}`)
  const pdf = pdfBalances(file.text)
  if (pdf.opening.length !== json.length || pdf.closing.length !== json.length) {
    wrong.push(`${file.name} has ${pdf.opening.length} opening and ${pdf.closing.length} closing balance(s); the JSON statement has ${json.length} account(s)`)
  } else {
    json.forEach((a, i) => {
      if (pdf.opening[i] !== dollarsCell(a.opening_ulxc)) wrong.push(`${file.name} opens ${a.account} at ${pdf.opening[i]}; the JSON statement at ${dollarsCell(a.opening_ulxc)}`)
      if (pdf.closing[i] !== dollarsCell(a.closing_ulxc)) wrong.push(`${file.name} closes ${a.account} at ${pdf.closing[i]}; the JSON statement at ${dollarsCell(a.closing_ulxc)}`)
    })
  }
  if (agent !== undefined) {
    const closing = json.find((a) => a.account === agent.account)?.closing_ulxc
    if (closing === undefined || closing !== agent.held) wrong.push(`the JSON statement closes ${agent.account} at ${closing ?? 'nothing'} µLXC; Lens's book holds ${agent.held ?? 'nothing'}`)
  }
  return wrong.length === 0
    ? { pass: true, detail: `${file.name}: ${json.length} account(s), each opening and closing at the JSON statement's balance` }
    : { pass: false, detail: wrong.join('; ') }
}

const DAY_MS = 86_400_000
const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)

export function statementPDF(seed: number): Scenario {
  const funded = 2_000_000
  const takenBack = 350_001
  return {
    id: 'statement-pdf',
    owner: 'talyvor-suite',
    items: ['B28.55'],
    agents: 1,
    title: "an agent's statement, and every agent's, downloaded as a PDF on Agent Wallets opens and closes each account at the JSON statement's balance",
    run: (ctx) => withBank(ctx, async (bank): Promise<Verdict> => {
      const agent = await openAgent(ctx, bank, `Printed ${seed}`)
      if (typeof agent === 'string') return fail(agent)
      const fund = await bank.move(agent, funded, 'Fund')
      if (fund !== undefined) return fail(`funding ${agent.name} ${lxcText(funded)} LXC was refused: ${fund}`)
      const back = await bank.move(agent, takenBack, 'Take back')
      if (back !== undefined) return fail(`taking ${lxcText(takenBack)} LXC back from ${agent.name} was refused: ${back}`)

      // Yesterday and today, UTC: the agent was made today in any time zone, so the period holds every posting it has.
      const now = Date.now()
      const [from, through, to] = [utcDay(now - DAY_MS), utcDay(now), utcDay(now + DAY_MS)]
      const held = agentIn(await bookOf(ctx), agent.id)?.balance_ulxc
      const account = `agent:${agent.id}`
      const one = await downloaded(ctx, bank, agent, from, through, to)
      const mine = statementPDFVerdict(one.file, one.json, { account, held })
      if (!mine.pass) return mine
      if (held !== funded - takenBack) return fail(`${agent.name} was funded ${funded} µLXC and ${takenBack} taken back; Lens's book holds ${held ?? 'nothing'}`)
      const every = await downloaded(ctx, bank, undefined, from, through, to)
      const all = statementPDFVerdict(every.file, every.json, { account, held })
      return all.pass ? { pass: true, detail: `${mine.detail}; ${all.detail}` } : all
    }),
  }
}

/** The PDF the screen saves for [from, through], and Lens's JSON statement for the same period. */
async function downloaded(ctx: ScenarioCtx, bank: AgentBankScreen, agent: Agent | undefined, from: string, through: string, to: string) {
  const whose = agent === undefined ? 'every agent' : agent.name
  const file = await bank.statementPDF(agent, from, through)
  const json = await ctx.env.lens.agentPeriodBalances(ctx.app.user, agent?.id, from, to)
  ctx.evidence.push({ note: `${whose}'s statement from ${from} through ${through}: the PDF ${file.name} (${file.text.length} bytes) shows ${JSON.stringify(pdfBalances(file.text))}; the JSON ${JSON.stringify(json)}` })
  return { file, json }
}

/**
 * B28.328 — the same PDF on Lens alone, as the owner's own software downloads it: an agent made with Lens's API, funded
 * and some taken back, then its statement, and every agent wallet's, for yesterday and today with ?format=pdf, each held
 * to the JSON statement for the same period, and the agent's closing to what Lens's book holds for it.
 */
export function statementPDFLens(seed: number): Scenario {
  const funded = 2_000_000
  const takenBack = 350_001
  return {
    id: 'statement-pdf-lens',
    owner: 'talyvor-lens',
    items: ['B28.328'],
    agents: 1,
    feature: 'Statements',
    title: "an agent's statement, and every agent's, as a PDF from Lens opens and closes each account at the JSON statement's balance",
    run: async (ctx) => {
      const { lens } = ctx.env
      const user = ctx.app.user
      const agent = await lens.createAgent(user, `Printed on Lens ${seed}`)
      await lens.fundAgent(user, agent.id, funded)
      await lens.withdrawAgent(user, agent.id, takenBack)

      // Yesterday and today, UTC: the agent was made today in any time zone, so the period holds every posting it has.
      const now = Date.now()
      const [from, to] = [utcDay(now - DAY_MS), utcDay(now + DAY_MS)]
      const held = agentIn(await bookOf(ctx), agent.id)?.balance_ulxc
      if (held !== funded - takenBack) return fail(`${agent.name} was funded ${funded} µLXC and ${takenBack} taken back; Lens's book holds ${held ?? 'nothing'}`)
      const account = `agent:${agent.id}`
      const details: string[] = []
      for (const path of [`agents/${agent.id}/statement`, 'agents/statement']) {
        const got = await lens.as(user.token, 'GET', `/v1/workspaces/${user.workspaceID}/${path}?from=${from}&to=${to}&format=pdf`, undefined, { Accept: 'application/pdf' })
        const name = /filename="([^"]+)"/.exec(got.headers.get('Content-Disposition') ?? '')?.[1] ?? `(no file name: ${got.status} ${got.headers.get('Content-Type') ?? ''})`
        const json = await lens.agentPeriodBalances(user, path === 'agents/statement' ? undefined : agent.id, from, to)
        ctx.evidence.push({ note: `GET ${path}?format=pdf from ${from} to ${to}: ${got.status} ${name} (${got.text.length} bytes) shows ${JSON.stringify(pdfBalances(got.text))}; the JSON ${JSON.stringify(json)}` })
        const v = statementPDFVerdict({ name, text: got.text }, json, { account, held })
        if (!v.pass) return v
        details.push(v.detail)
      }
      return { pass: true, detail: details.join('; ') }
    },
  }
}
