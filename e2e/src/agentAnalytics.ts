// B28.53 — one agent's spend by day, model and destination. A person's agent is funded, pays another of the
// workspace's agents, asks one question with its own key and has credits taken back, on Agent Wallets as a person does
// it. The ledger is Lens's: the agent's own postings, and its statement's out for the period. Lens's analytics for the
// same period put every posting out in one bucket, so the buckets sum to the statement's out and to the postings
// themselves; the payment is under the other agent, the take-back under the workspace, the question under its model.
// Then Agent Wallets' Spend by day, model and destination: the same Out, the other agent by name, the model by its id.

import type { AgentLine, AgentSpendAnalytics } from './lens.ts'
import { type AnalyticsShown, agentAsks, fail, lxcText, openAgent, withBank } from './bank.ts'
import type { Scenario } from './scenarios.ts'

/** A figure as the card draws it ("0.75 LXC", or beside the person's currency) → µLXC; NaN when it has none. */
export const shownULXC = (text: string): number => Math.round(Number(/([\d,.]+)\s*LXC/.exec(text)?.[1]?.replace(/,/g, '') ?? 'NaN') * 1e6)

/**
 * The oracle: the buckets' out sums to the analytics' out, to the statement's out for the agent and to the agent's own
 * postings out; the payment is a bucket under agent:<to>, the take-back under workspace, the question's postings under
 * the model its ledger lines name; and the screen shows the same Out, the paid agent by name and that model.
 */
export function agentAnalyticsVerdict(
  a: AgentSpendAnalytics,
  statementOut: number | undefined,
  lines: readonly AgentLine[],
  made: { paidTo: { id: string; name: string }; paid: number; takenBack: number },
  shown: AnalyticsShown,
): { pass: boolean; detail: string } {
  const wrong: string[] = []
  const buckets = a.buckets ?? []
  const sum = buckets.reduce((s, b) => s + b.out_ulxc, 0)
  const ledgerOut = lines.reduce((s, l) => s + (l.amount_ulxc < 0 ? -l.amount_ulxc : 0), 0)
  if (sum !== a.out_ulxc) wrong.push(`the buckets sum to ${sum} µLXC, the analytics say out ${a.out_ulxc}`)
  if (statementOut !== sum) wrong.push(`the buckets sum to ${sum} µLXC, the agent's statement says out ${statementOut ?? 'nothing'}`)
  if (ledgerOut !== sum) wrong.push(`the buckets sum to ${sum} µLXC, the agent's own postings out to ${ledgerOut}`)
  if (a.spent_ulxc !== a.out_ulxc - a.returned_ulxc) wrong.push(`spent ${a.spent_ulxc} is not out ${a.out_ulxc} less returned ${a.returned_ulxc}`)

  const under = (destination: string) => buckets.filter((b) => b.destination === destination).reduce((s, b) => s + b.out_ulxc, 0)
  if (under(`agent:${made.paidTo.id}`) !== made.paid) wrong.push(`${under(`agent:${made.paidTo.id}`)} µLXC is under ${made.paidTo.name}, want the ${made.paid} paid`)
  if (under('workspace') !== made.takenBack) wrong.push(`${under('workspace')} µLXC is under the workspace, want the ${made.takenBack} taken back`)
  const model = lines.find((l) => l.amount_ulxc < 0 && l.model)?.model
  if (model === undefined) wrong.push("no posting out on the agent's ledger names a model")
  else if (!buckets.some((b) => b.model === model && b.out_ulxc > 0)) wrong.push(`no bucket is under ${model}, the model the question's postings name`)

  if (shownULXC(shown.out) !== sum) wrong.push(`the card shows Out "${shown.out}", want ${lxcText(sum)} LXC`)
  if (!shown.destinations.some((d) => d.startsWith(made.paidTo.name))) wrong.push(`By destination does not name ${made.paidTo.name}: ${JSON.stringify(shown.destinations)}`)
  if (shown.destinations.some((d) => d.includes('agent:'))) wrong.push(`By destination shows an account id: ${JSON.stringify(shown.destinations)}`)
  if (model !== undefined && !shown.models.some((m) => m.startsWith(model))) wrong.push(`By model does not name ${model}: ${JSON.stringify(shown.models)}`)
  if (shown.days.length === 0) wrong.push('By day shows no day')

  return wrong.length === 0
    ? { pass: true, detail: `${buckets.length} bucket(s) sum to ${lxcText(sum)} LXC out, the statement's out and the agent's postings out; ${made.paidTo.name}, the workspace and ${model} each hold theirs, and the card shows the same` }
    : { pass: false, detail: wrong.join('; ') }
}

export function agentAnalytics(seed: number): Scenario {
  const paid = 500_000
  const takenBack = 250_000
  return {
    id: 'agent-analytics',
    owner: 'talyvor-suite',
    items: ['B28.53'],
    agents: 2,
    title: "one agent's spend by day, model and destination sums to its statement's out, and Agent Wallets shows it by the other agent's name and the model's",
    run: (ctx) => withBank(ctx, async (bank) => {
      const { env, app } = ctx
      const north = await openAgent(ctx, bank, `Analysed ${seed}`)
      if (typeof north === 'string') return fail(north)
      const south = await openAgent(ctx, bank, `Paid ${seed}`)
      if (typeof south === 'string') return fail(south)
      const funded = await bank.move(north, 3_000_000, 'Fund')
      if (funded !== undefined) return fail(`funding ${north.name} was refused: ${funded}`)
      const said = await bank.pay(north, south, paid, `analytics ${seed}`)
      if (!/^Paid/.test(said)) return fail(`paying ${south.name} was refused: "${said}"`)
      const key = await bank.issueKey(north)
      const asked = await agentAsks(ctx, key, 'What is 17 + 25? Answer with the number only.', `${north.name} asks with its own key`)
      if (!asked.ok) return fail(`${north.name}'s question was refused: ${asked.status} ${asked.error}`)
      const back = await bank.move(north, takenBack, 'Take back')
      if (back !== undefined) return fail(`taking ${lxcText(takenBack)} LXC back was refused: ${back}`)

      // From yesterday, UTC: the agent was made today in any time zone, so the period holds every posting it has.
      const from = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
      const a = await env.lens.agentAnalytics(app.user, north.id, from)
      const totals = await env.lens.agentPeriodTotals(app.user, north.id, from)
      const lines = await env.lens.agentLines(app.user, north.id)
      ctx.evidence.push({ note: `${north.name}'s analytics from ${from}: out ${a.out_ulxc}, returned ${a.returned_ulxc}, buckets ${JSON.stringify(a.buckets)}` })
      ctx.evidence.push({ note: `${north.name}'s statement from ${from}: ${JSON.stringify(totals)}; its postings: ${JSON.stringify(lines.map((l) => ({ kind: l.kind, amount_ulxc: l.amount_ulxc, counterparty: l.counterparty, model: l.model })))}` })
      const shown = await bank.analyticsShown(north)
      if (typeof shown === 'string') return fail(shown)
      ctx.evidence.push({ note: `${north.name}'s Spend by day, model and destination: ${JSON.stringify(shown)}` })
      const statementOut = totals.find((x) => x.account === `agent:${north.id}`)?.out_ulxc
      return agentAnalyticsVerdict(a, statementOut, lines, { paidTo: south, paid, takenBack }, shown)
    }),
  }
}
