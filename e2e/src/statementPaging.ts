// B28.51 — an agent's statement is searched, filtered and paged past its newest 100 lines. A person's agent is funded
// 105 times and has credits taken back twice, on Lens as the workspace's owner, so its statement is 107 lines. The
// ledger is Lens's statement for the agent: exactly those lines, newest first, each of its kind and amount. Then
// Agent Wallets' Statement: 100 rows, then Show older lines puts the other 7 below them in Lens's order, every line
// once; then the filter Taken back leaves only the two withdrawals.

import type { AgentLine } from './lens.ts'
import { type StatementRow, fail, openAgent, withBank } from './bank.ts'
import type { Scenario } from './scenarios.ts'

/** How many lines the Statement shows before Show older lines (apps/web STATEMENT_PAGE_LINES). */
export const PAGE_LINES = 100

/** The words Agent Wallets gives the two kinds this scenario makes. */
export const WORDS: Record<string, string> = { fund: 'Funded by the workspace', withdraw: 'Taken back by the workspace' }

/**
 * The oracle: Lens's statement holds exactly `made` (kind and amount, oldest first) newest first; the Statement's first
 * page is its newest PAGE_LINES lines; after Show older lines it is every line once, page 1 on top, in Lens's order and
 * in each kind's words; and filtered to withdrawals it shows only those.
 */
export function statementPagingVerdict(
  made: ReadonlyArray<{ kind: string; amount_ulxc: number }>,
  lines: readonly AgentLine[],
  shown: { first: readonly StatementRow[]; all: readonly StatementRow[]; filtered: readonly StatementRow[] },
): { pass: boolean; detail: string } {
  const wrong: string[] = []
  const newest = [...made].reverse()
  if (lines.length !== made.length) wrong.push(`Lens's statement has ${lines.length} line(s), want the ${made.length} made`)
  newest.forEach((m, i) => {
    const l = lines[i]
    if (l !== undefined && (l.kind !== m.kind || l.amount_ulxc !== m.amount_ulxc))
      wrong.push(`Lens's line ${i + 1} from the newest is ${l.kind} ${l.amount_ulxc}, want ${m.kind} ${m.amount_ulxc}`)
  })

  const { first, all, filtered } = shown
  if (first.length !== PAGE_LINES) wrong.push(`the Statement's first page shows ${first.length} row(s), want ${PAGE_LINES}`)
  if (all.length !== lines.length) wrong.push(`after Show older lines the Statement shows ${all.length} row(s) for Lens's ${lines.length}`)
  if (first.some((r, i) => all[i]?.balance !== r.balance)) wrong.push('after Show older lines the first page is no longer on top')
  const balances = all.map((r) => r.balance)
  if (new Set(balances).size !== balances.length) wrong.push(`a line is shown twice: balances ${balances.join(', ')}`)
  lines.forEach((l, i) => {
    const row = all[i]
    if (row !== undefined && row.what !== WORDS[l.kind]) wrong.push(`row ${i + 1} reads "${row.what}" for Lens's ${l.kind} line`)
    const sign = l.amount_ulxc > 0 ? '+' : '−'
    if (row !== undefined && !row.amount.startsWith(sign)) wrong.push(`row ${i + 1} is drawn "${row.amount}", not signed ${sign}`)
  })

  const taken = lines.filter((l) => l.kind === 'withdraw')
  if (filtered.length !== taken.length) wrong.push(`filtered to Taken back the Statement shows ${filtered.length} row(s), want Lens's ${taken.length}`)
  const other = filtered.filter((r) => r.what !== WORDS.withdraw)
  if (other.length > 0) wrong.push(`filtered to Taken back it still shows ${other.map((r) => `"${r.what}"`).join(', ')}`)

  return wrong.length === 0
    ? { pass: true, detail: `Lens's statement holds the ${lines.length} lines made; the Statement shows ${first.length}, then all ${all.length} in Lens's order, and ${filtered.length} filtered to Taken back` }
    : { pass: false, detail: wrong.join('; ') }
}

export function statementPaging(seed: number): Scenario {
  const funds = 105
  const each = 10_000
  return {
    id: 'statement-paging',
    owner: 'talyvor-suite',
    items: ['B28.51'],
    agents: 1,
    title: "an agent with 107 statement lines: its Statement on Agent Wallets shows the newest 100, Show older lines puts the rest below them in Lens's order, and the filter Taken back leaves only the withdrawals",
    run: (ctx) => withBank(ctx, async (bank) => {
      const { env, app } = ctx
      const name = `Paged ${seed}`
      const a = await openAgent(ctx, bank, name)
      if (typeof a === 'string') return fail(a)
      const made: { kind: string; amount_ulxc: number }[] = []
      for (let i = 0; i < funds; i++) {
        await env.lens.fundAgent(app.user, a.id, each)
        made.push({ kind: 'fund', amount_ulxc: each })
      }
      // Two withdrawals of different amounts, so no balance on the statement repeats.
      for (const back of [3_000, 4_000]) {
        await env.lens.withdrawAgent(app.user, a.id, back)
        made.push({ kind: 'withdraw', amount_ulxc: -back })
      }
      const lines = await env.lens.agentLines(app.user, a.id)
      ctx.evidence.push({ note: `${name}'s statement on Lens: ${lines.length} line(s), newest ${JSON.stringify(lines.slice(0, 3).map((l) => ({ kind: l.kind, amount_ulxc: l.amount_ulxc, balance_after_ulxc: l.balance_after_ulxc })))}` })
      const shown = await bank.statementPaged(a, 'Taken back')
      if (typeof shown === 'string') return fail(shown)
      ctx.evidence.push({ note: `${name}'s Statement on Agent Wallets: ${shown.first.length} row(s), ${shown.all.length} after Show older lines, ${shown.filtered.length} filtered to Taken back: ${JSON.stringify(shown.filtered)}` })
      return statementPagingVerdict(made, lines, shown)
    }),
  }
}
