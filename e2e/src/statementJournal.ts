// B28.56 — a statement period as a double-entry journal for Xero or QuickBooks. A person's agent is funded and has some
// taken back on Agent Wallets, then the person downloads its journal, and every agent's, for yesterday and today on the
// same screen. Lens's JSON statement for the same period is the oracle: the journal's debits equal its credits, every
// journal balances, each statement account is debited its in and credited its out, and the agent's closing is what
// Lens's book holds for it — the ledger, never a status code.

import { type AgentBankScreen, agentIn, bookOf, fail, lxcText, openAgent, withBank } from './bank.ts'
import type { Agent } from './lens.ts'
import type { Scenario, ScenarioCtx, Verdict } from './scenarios.ts'

/** An account's period on the JSON statement: what came in, what went out, and where it closed. */
export interface PeriodTotal { account: string; in_ulxc: number; out_ulxc: number; closing_ulxc: number }

const HEADER = 'journal_no,date,account,description,debit_lxc,credit_lxc,cost_centre,ref'

/** Lens's journal amount, LXC to the sixth decimal ("2.000000"), as µLXC; an empty cell is 0. */
export function journalULXC(cell: string): number | undefined {
  if (cell === '') return 0
  const m = /^(\d+)\.(\d{6})$/.exec(cell)
  return m === null ? undefined : Number(m[1]) * 1_000_000 + Number(m[2])
}

/** The CSV's rows, each a list of cells: quoted cells may hold commas, quotes and line breaks. */
export function csvRows(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted && c === '"' && text[i + 1] === '"') {
      cell += '"'
      i++
    } else if (c === '"') {
      quoted = !quoted
    } else if (quoted || (c !== ',' && c !== '\n' && c !== '\r')) {
      cell += c
    } else {
      row.push(cell)
      cell = ''
      if (c === ',') continue
      if (c === '\r' && text[i + 1] === '\n') i++
      rows.push(row)
      row = []
    }
  }
  if (cell !== '' || row.length > 0) rows.push([...row, cell])
  return rows
}

/**
 * The oracle: the file is the journal CSV; its debits equal its credits; each journal balances; each of the JSON
 * statement's accounts is debited its in_ulxc and credited its out_ulxc; each line names a cost centre where an agent
 * was in its entry; and where `held` is given, `account` closes at it in the JSON.
 */
export function statementJournalVerdict(
  file: { name: string; text: string },
  json: readonly PeriodTotal[],
  agent?: { account: string; held: number | undefined },
): { pass: boolean; detail: string } {
  const wrong: string[] = []
  const [head, ...lines] = csvRows(file.text)
  if (!file.name.endsWith('.csv') || head?.join(',') !== HEADER) {
    return { pass: false, detail: `${file.name} is not the journal: it opens ${JSON.stringify(file.text.slice(0, 80))}` }
  }
  let debit = 0
  let credit = 0
  const perJournal = new Map<string, number>()
  const perAccount = new Map<string, { debit: number; credit: number }>()
  for (const [no, , account, , d, c, centre] of lines) {
    const dr = journalULXC(d ?? '')
    const cr = journalULXC(c ?? '')
    if (dr === undefined || cr === undefined || (dr === 0) === (cr === 0)) {
      wrong.push(`${file.name}: journal ${no} line on ${account} debits ${JSON.stringify(d)} and credits ${JSON.stringify(c)}; one of them, in LXC to the sixth decimal`)
      continue
    }
    if (account.startsWith('agent:') && centre === '') wrong.push(`${file.name}: journal ${no} moves ${account} with no cost centre`)
    debit += dr
    credit += cr
    perJournal.set(no, (perJournal.get(no) ?? 0) + dr - cr)
    const a = perAccount.get(account) ?? { debit: 0, credit: 0 }
    perAccount.set(account, { debit: a.debit + dr, credit: a.credit + cr })
  }
  if (lines.length === 0) wrong.push(`${file.name} holds no journal lines`)
  if (debit !== credit) wrong.push(`${file.name} debits ${debit} µLXC and credits ${credit}`)
  for (const [no, sum] of perJournal) if (sum !== 0) wrong.push(`${file.name}: journal ${no} does not balance by ${sum} µLXC`)
  for (const a of json) {
    const got = perAccount.get(a.account) ?? { debit: 0, credit: 0 }
    if (got.debit !== a.in_ulxc) wrong.push(`${file.name} debits ${a.account} ${got.debit} µLXC; the JSON statement has ${a.in_ulxc} in`)
    if (got.credit !== a.out_ulxc) wrong.push(`${file.name} credits ${a.account} ${got.credit} µLXC; the JSON statement has ${a.out_ulxc} out`)
  }
  if (agent !== undefined) {
    const closing = json.find((a) => a.account === agent.account)?.closing_ulxc
    if (closing === undefined || closing !== agent.held) wrong.push(`the JSON statement closes ${agent.account} at ${closing ?? 'nothing'} µLXC; Lens's book holds ${agent.held ?? 'nothing'}`)
  }
  return wrong.length === 0
    ? { pass: true, detail: `${file.name}: ${perJournal.size} journal(s), debits ${debit} µLXC = credits ${credit}, each of ${json.length} account(s) debited its in and credited its out` }
    : { pass: false, detail: wrong.join('; ') }
}

const DAY_MS = 86_400_000
const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)

export function statementJournal(seed: number): Scenario {
  const funded = 3_000_000
  const takenBack = 1_250_001
  return {
    id: 'statement-journal',
    owner: 'talyvor-suite',
    items: ['B28.56'],
    agents: 1,
    title: "an agent's journal, and every agent's, downloaded for Xero or QuickBooks on Agent Wallets: debits equal credits equal the statement's totals",
    run: (ctx) => withBank(ctx, async (bank): Promise<Verdict> => {
      const agent = await openAgent(ctx, bank, `Booked ${seed}`)
      if (typeof agent === 'string') return fail(agent)
      const fund = await bank.move(agent, funded, 'Fund')
      if (fund !== undefined) return fail(`funding ${agent.name} ${lxcText(funded)} LXC was refused: ${fund}`)
      const back = await bank.move(agent, takenBack, 'Take back')
      if (back !== undefined) return fail(`taking ${lxcText(takenBack)} LXC back from ${agent.name} was refused: ${back}`)

      // Yesterday and today, UTC: the agent was made today in any time zone, so the period holds every posting it has.
      const now = Date.now()
      const [from, through, to] = [utcDay(now - DAY_MS), utcDay(now), utcDay(now + DAY_MS)]
      const held = agentIn(await bookOf(ctx), agent.id)?.balance_ulxc
      if (held !== funded - takenBack) return fail(`${agent.name} was funded ${funded} µLXC and ${takenBack} taken back; Lens's book holds ${held ?? 'nothing'}`)
      const account = `agent:${agent.id}`
      const one = await downloaded(ctx, bank, agent, from, through, to)
      const mine = statementJournalVerdict(one.file, one.json, { account, held })
      if (!mine.pass) return mine
      const every = await downloaded(ctx, bank, undefined, from, through, to)
      const all = statementJournalVerdict(every.file, every.json, { account, held })
      return all.pass ? { pass: true, detail: `${mine.detail}; ${all.detail}` } : all
    }),
  }
}

/** The journal the screen saves for [from, through], and Lens's JSON statement for the same period. */
async function downloaded(ctx: ScenarioCtx, bank: AgentBankScreen, agent: Agent | undefined, from: string, through: string, to: string) {
  const whose = agent === undefined ? 'every agent' : agent.name
  const file = await bank.statementJournal(agent, from, through)
  const json = await ctx.env.lens.agentPeriodInOut(ctx.app.user, agent?.id, from, to)
  ctx.evidence.push({ note: `${whose}'s journal from ${from} through ${through}: ${file.name} ${JSON.stringify(file.text.slice(0, 2000))}; the JSON ${JSON.stringify(json)}` })
  return { file, json }
}
