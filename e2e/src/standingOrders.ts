// B30.132 — standing orders to outside payees (Lens B30.18), from an agent's own account, on Lens's API, once a run, on a
// workspace of its own. The owner opens the company's GBP account with test money in it, opens an agent's GBP account under
// it and gives the agent £100.00, saves an exact-match payee and sets up a weekly £20.00 standing order to it whose first run
// was an hour ago. Lens's minute ticker pays that tick as a payment out from the agent's account, under the tick's own key:
// its run reads paid and names the payment, the payment reads completed from the agent's account, and the account's
// statement holds that one tick's payment_out_hold. Then the owner skips the next tick: a skipped run a week on, the order
// next paying a week after that, and nothing moved. Then the owner cancels it. Judged on the account's balance and statement.

import { randomBytes } from 'node:crypto'
import { fail } from './bank.ts'
import { RUN_SALT } from './oracles.ts'
import type { Scenario } from './scenarios.ts'
import { call, said } from './settings.ts'

const FUND_COMPANY_MINOR = 30_000
const FUND_AGENT_MINOR = 10_000
const ORDER_MINOR = 2_000
const APPROVAL_ABOVE_ULXC = 1_000_000_000
const WEEK_MS = 7 * 86_400_000
const CAPABILITIES = ['currency_accounts', 'payments_in', 'payments_out']
const gbp = (minor: number): string => `£${(minor / 100).toFixed(2)}`

interface Schedule { id: string; to_payee_id?: string; amount_minor?: number; currency?: string; every: string; next_run_at: string; active: boolean }
interface Run { tick_at: string; outcome: string; payment_id?: string; detail?: string }
interface Payment { id: string; account_id: string; agent_id?: string; amount_minor: number; currency: string; reference: string; status: string; idempotency_key?: string }
interface Account { id: string; test_minor: number }
interface Statement { lines: { kind?: string; amount_minor: number; memo?: string }[] | null }

/** `waitMs` is how long the scenario waits for Lens's minute ticker to run the order's first tick. */
export function standingOrders({ waitMs = 150_000, pollMs = 5_000 }: { waitMs?: number; pollMs?: number } = {}): Scenario {
  return {
    id: 'standing-orders',
    owner: 'talyvor-lens',
    own: true,
    agents: 1,
    feature: 'Agent Wallets',
    items: ['B30.18', 'B30.132'],
    title: "standing orders: a weekly £20.00 order from an agent's GBP account to a saved payee pays its due tick once, as a payment " +
      'out on the ledger; a skipped tick moves nothing and the order next pays a week on; then it is cancelled',
    run: async (ctx) => {
      const { lens } = ctx.env
      const user = ctx.app.user
      const step = async <T>(method: string, path: string, body: unknown, note: string) => {
        const r = await call<T>(ctx, method, path, body)
        ctx.evidence.push({ note, answer: said(r) })
        return r
      }
      const key = () => `e2e-${randomBytes(8).toString('hex')}`

      // 1. The terms, the company's GBP account with test money in it, and the agent's GBP account under it.
      const terms = await step<{ terms: { capability: string; version: number; accepted?: unknown }[] | null }>('GET', '/v1/workspaces/{ws}/terms', undefined, 'the owner reads the terms')
      for (const t of (terms.value?.terms ?? []).filter((x) => CAPABILITIES.includes(x.capability) && x.accepted == null)) {
        const ok = await step('POST', `/v1/workspaces/{ws}/terms/${t.capability}/accept`, { version: t.version }, `the owner accepts ${t.capability}'s terms`)
        if (ok.status !== 201) return fail(`accepting ${t.capability}'s terms answered ${said(ok)}`)
      }
      const company = await step<{ id: string }>('POST', '/v1/money/accounts', { currency: 'GBP' }, "the company's GBP account")
      if (company.status !== 201 || company.value === undefined) return fail(`opening the company's GBP account on test money must answer 201; Lens answered ${said(company)}`)
      const topped = await step('POST', `/v1/money/accounts/${company.value.id}/test-money`, { amount_minor: FUND_COMPANY_MINOR, idempotency_key: key() },
        `${gbp(FUND_COMPANY_MINOR)} of test money comes into the company's GBP account`)
      if (topped.status !== 201) return fail(`${gbp(FUND_COMPANY_MINOR)} of test money into the company's GBP account answered ${said(topped)}`)
      const agent = await lens.createAgent(user, `Standing orders ${RUN_SALT}`)
      const opened = await step<{ id: string }>('POST', '/v1/money/accounts', { currency: 'GBP', agent_id: agent.id }, `${agent.name}'s GBP account`)
      if (opened.status !== 201 || opened.value === undefined) return fail(`opening ${agent.name}'s GBP account must answer 201; Lens answered ${said(opened)}`)
      const from = opened.value.id
      const given = await step('POST', `/v1/money/accounts/${from}/funding`, { direction: 'to_agent', amount_minor: FUND_AGENT_MINOR, idempotency_key: key() },
        `the owner gives ${agent.name} ${gbp(FUND_AGENT_MINOR)} from the company's GBP account`)
      if (given.status !== 201) return fail(`giving ${agent.name} ${gbp(FUND_AGENT_MINOR)} answered ${said(given)}`)

      // 2. An exact-match payee, and the agent's rules: no limit, the owner asked only above 1,000 LXC (£20.00 is 250).
      const payee = await step<{ id: string; needs_confirmation?: boolean }>('POST', '/v1/money/payees', { name: `Nightly Standing Orders ${RUN_SALT} Ltd`,
        country: 'GB', sort_code: '040004', account_number: '55667788' }, 'the owner saves a payee')
      if (payee.status !== 201 || payee.value === undefined) return fail(`saving a payee must answer 201; Lens answered ${said(payee)}`)
      if (payee.value.needs_confirmation) return fail(`a payee whose name matches its account must not wait for confirmation; Lens saved ${payee.text.slice(0, 200)}`)
      const rules = await step('PUT', `/v1/workspaces/{ws}/agents/${agent.id}/rules`, { ...await lens.agentRules(user, agent.id), max_per_request_ulxc: 0,
        hourly_limit_ulxc: 0, daily_limit_ulxc: 0, weekly_limit_ulxc: 0, monthly_limit_ulxc: 0, approval_above_ulxc: APPROVAL_ABOVE_ULXC },
      `${agent.name} asks the owner above 1,000 LXC, with no other limit`)
      if (rules.status !== 200) return fail(`setting ${agent.name}'s rules answered ${said(rules)}`)

      const holds = async (note: string): Promise<number> => {
        const r = await step<{ accounts: Account[] | null }>('GET', '/v1/money/accounts', undefined, note)
        const a = (r.value?.accounts ?? []).find((x) => x.id === from)
        if (a === undefined) throw new Error(`${agent.name}'s GBP account ${from} is not on the list: ${said(r)}`)
        return a.test_minor
      }
      const memo = `Nightly order ${RUN_SALT}`
      /** The account's statement lines that are this order's payments out. */
      const held = async (note: string) => {
        const st = await step<Statement>('GET', `/v1/money/accounts/${from}/statement`, undefined, note)
        if (st.status !== 200) throw new Error(`${agent.name}'s account's statement answered ${said(st)}`)
        return (st.value?.lines ?? []).filter((l) => l.kind === 'payment_out_hold')
      }

      try {
        const start = await holds(`${agent.name}'s account before the order`)
        if (start !== FUND_AGENT_MINOR) return fail(`given ${gbp(FUND_AGENT_MINOR)} from the company's account, ${agent.name}'s GBP account holds ${gbp(start)}`)

        // 3. A weekly £20.00 standing order to the payee, its first run an hour ago, so the next minute's tick is due.
        const first = new Date(Date.now() - 3_600_000)
        first.setUTCSeconds(0, 0)
        const made = await step<Schedule>('POST', `/v1/workspaces/{ws}/agents/${agent.id}/schedules`, { to_payee_id: payee.value.id, amount_minor: ORDER_MINOR,
          currency: 'GBP', memo, every: 'week', first_run_at: first.toISOString() }, `a weekly ${gbp(ORDER_MINOR)} standing order, first due ${first.toISOString()}`)
        if (made.status !== 201 || made.value === undefined) return fail(`setting up the standing order must answer 201; Lens answered ${said(made)}`)
        const sid = made.value.id

        // 4. Lens's minute ticker runs that tick: a paid run naming a payment out.
        const runsOf = async (note: string): Promise<Run[]> => {
          const r = await step<{ runs: Run[] | null }>('GET', `/v1/workspaces/{ws}/agents/schedules/${sid}/runs`, undefined, note)
          if (r.status !== 200) throw new Error(`the order's runs answered ${said(r)}`)
          return r.value?.runs ?? []
        }
        let runs: Run[] = []
        for (let waited = 0; ; waited += pollMs) {
          runs = await runsOf(`the order's runs after ${Math.round(waited / 1000)} s`)
          if (runs.length > 0 || waited >= waitMs) break
          await new Promise((r) => setTimeout(r, pollMs))
        }
        if (runs.length === 0) return fail(`the order's first tick was due ${first.toISOString()} and Lens's minute ticker ran nothing in ${Math.round(waitMs / 1000)} s`)
        const ticks = runs.filter((r) => Date.parse(r.tick_at) === first.getTime())
        if (runs.length !== 1 || ticks.length !== 1 || ticks[0].outcome !== 'paid' || !ticks[0].payment_id) {
          return fail(`the one due tick, ${first.toISOString()}, must run once, paid, naming its payment; the order's runs are ${JSON.stringify(runs).slice(0, 400)}`)
        }
        const run = ticks[0]

        // 5. The payment it names: a money payment out of the agent's account, under the tick's own key.
        const pay = await step<Payment>('GET', `/v1/money/payments/${run.payment_id}`, undefined, `the payment the tick names, ${run.payment_id}`)
        if (pay.status !== 200 || pay.value === undefined) return fail(`the paid tick names payment ${run.payment_id}, and Lens has no such payment: ${said(pay)}`)
        const p = pay.value
        if (p.account_id !== from || p.amount_minor !== ORDER_MINOR || p.currency !== 'GBP' || p.status !== 'completed' || run.detail !== p.status) {
          return fail(`the tick's payment must be ${gbp(ORDER_MINOR)} completed from ${agent.name}'s account ${from}, its run's detail its status; ` +
            `it is ${JSON.stringify(p).slice(0, 300)} and the run says "${run.detail}"`)
        }
        const tickKey = `schedule:${sid}:${first.toISOString().replace('.000Z', 'Z')}`
        if (p.idempotency_key !== undefined && p.idempotency_key !== tickKey) return fail(`the tick's payment must be made under the tick's key ${tickKey}; it carries ${p.idempotency_key}`)
        const listed = await step<{ payments: Payment[] | null }>('GET', `/v1/money/payments?agent_id=${encodeURIComponent(agent.id)}`, undefined, `${agent.name}'s payments out`)
        const mine = (listed.value?.payments ?? []).filter((x) => x.reference === memo)
        if (mine.length !== 1 || mine[0].id !== p.id) return fail(`one tick must make one payment out; ${agent.name}'s payments with the order's reference are ${JSON.stringify(mine).slice(0, 400)}`)

        // 6. On the ledger: the tick's payment_out_hold left the agent's account once, and the account fell by it once.
        const afterTick = await holds(`${agent.name}'s account after the tick`)
        const lines = await held(`${agent.name}'s account's statement after the tick`)
        if (lines.length !== 1 || lines[0].amount_minor !== -ORDER_MINOR) {
          return fail(`the tick must hold ${gbp(ORDER_MINOR)} out of ${agent.name}'s account once; its statement's payment_out_hold lines are ${JSON.stringify(lines)}`)
        }
        if (afterTick !== start - ORDER_MINOR) return fail(`the paid tick must take ${gbp(ORDER_MINOR)} from the account once: ${gbp(start)} → ${gbp(afterTick)}`)

        // 7. The owner skips the next tick: a skipped run a week on, the order next paying a week after it, nothing moved.
        const listedOrder = (await lens.schedules(user)).find((s) => s.id === sid)
        const next = first.getTime() + WEEK_MS
        if (listedOrder === undefined || !listedOrder.active || Date.parse(listedOrder.next_run_at) !== next) {
          return fail(`paid, the order must next run a week on, ${new Date(next).toISOString()}; Lens lists ${JSON.stringify(listedOrder ?? null)}`)
        }
        const skipped = await step<Schedule>('POST', `/v1/workspaces/{ws}/agents/schedules/${sid}/skip`, {}, 'the owner skips the next tick')
        if (skipped.status !== 200 || skipped.value === undefined) return fail(`skipping the next tick answered ${said(skipped)}`)
        if (Date.parse(skipped.value.next_run_at) !== next + WEEK_MS) {
          return fail(`skipped, the order must next run a week after the skipped tick, ${new Date(next + WEEK_MS).toISOString()}; it reads ${skipped.value.next_run_at}`)
        }
        const afterSkip = await runsOf("the order's runs after the skip")
        const skip = afterSkip.find((r) => r.outcome === 'skipped')
        if (afterSkip.length !== 2 || skip === undefined || Date.parse(skip.tick_at) !== next || skip.payment_id) {
          return fail(`the skip must be one skipped run for the tick a week on, ${new Date(next).toISOString()}, paying nothing; the runs are ${JSON.stringify(afterSkip).slice(0, 400)}`)
        }
        const afterSkipped = await holds(`${agent.name}'s account after the skip`)
        const linesSkipped = await held(`${agent.name}'s account's statement after the skip`)
        if (afterSkipped !== afterTick || linesSkipped.length !== 1) {
          return fail(`a skipped tick must move nothing: the account went ${gbp(afterTick)} → ${gbp(afterSkipped)}, with ${linesSkipped.length} payment_out_hold lines`)
        }

        // 8. The owner cancels it.
        const cancelled = await step('DELETE', `/v1/workspaces/{ws}/agents/schedules/${sid}`, undefined, 'the owner cancels the order')
        if (cancelled.status !== 200) return fail(`cancelling the order answered ${said(cancelled)}`)
        const gone = (await lens.schedules(user)).find((s) => s.id === sid)
        if (gone?.active !== false) return fail(`cancelled, the order must read inactive; Lens lists ${JSON.stringify(gone ?? null)}`)
        const end = await holds(`${agent.name}'s account at the end`)
        if (end !== start - ORDER_MINOR) return fail(`${agent.name}'s account must end at ${gbp(start - ORDER_MINOR)}, one tick paid; it holds ${gbp(end)}`)
        return {
          pass: true,
          detail: `a weekly ${gbp(ORDER_MINOR)} order from ${agent.name}'s GBP account paid its due tick once, as completed payment ${p.id} with one ` +
            `payment_out_hold on the account; the skipped tick a week on moved nothing and the order next pays ${skipped.value.next_run_at}; ` +
            `cancelled, it reads inactive and the account holds ${gbp(end)}`,
        }
      } catch (e) {
        return fail((e as Error).message)
      }
    },
  }
}
