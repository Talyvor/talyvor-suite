// B30.127 — payments out to people and companies outside Talyvor (Lens B30.17), from an agent's own account, on Lens's API,
// once a run, on a workspace of its own. The owner opens the company's GBP account and puts £500.00 of test money in it, opens
// an agent's GBP account under it and gives the agent £300.00, saves an exact-match payee, and sets the agent's approval amount
// to 1,000 LXC with no other limit. On the agent's own key, from its account (account_id), the Test partner answers by amount:
// £20.00 completes; £20.13 fails and leaves the account whole; £20.14 completes and, read again (GET /v1/money/payments/{id}
// asks the partner), reads returned with its money back; £100.00, worth more than 1,000 LXC, is refused 403 naming an approval
// and moves nothing; the owner approves it, and the same request under the same key completes. Judged on the account's balance
// after every step and on its statement: it ends at what came in less £120.00.

import { randomBytes } from 'node:crypto'
import { fail } from './bank.ts'
import { RUN_SALT } from './oracles.ts'
import { refusalOf } from './lens.ts'
import type { Scenario } from './scenarios.ts'
import { call, said } from './settings.ts'

const FUND_COMPANY_MINOR = 50_000
const FUND_AGENT_MINOR = 30_000
const APPROVAL_ABOVE_ULXC = 1_000_000_000
const PAID_MINOR = 2_000
const FAILED_MINOR = 2_013
const RETURNED_MINOR = 2_014
const ABOVE_MINOR = 10_000
const CAPABILITIES = ['currency_accounts', 'payments_in', 'payments_out']
const gbp = (minor: number): string => `£${(minor / 100).toFixed(2)}`

/** A payment out as Lens answers it (economy.OutsidePayment). */
interface Payment { id: string; account_id: string; agent_id?: string; amount_minor: number; currency: string; reference: string; status: string }
interface Account { id: string; test_minor: number }
interface Statement { closing_minor?: number; lines: { kind?: string; amount_minor: number }[] | null }

export function paymentsOut(): Scenario {
  return {
    id: 'payments-out',
    owner: 'talyvor-lens',
    own: true,
    agents: 1,
    feature: 'Agent Wallets',
    items: ['B30.17', 'B30.127'],
    title: "payments out: from an agent's GBP account to a saved payee, £20.00 completes, £20.13 fails and £20.14 comes back returned, " +
      "each leaving the account whole; £100.00 above the agent's approval amount moves nothing until the owner approves it, then " +
      'the same request completes; the account ends at what came in less £120.00',
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
      const agent = await lens.createAgent(user, `Payments out ${RUN_SALT}`)
      const opened = await step<{ id: string }>('POST', '/v1/money/accounts', { currency: 'GBP', agent_id: agent.id }, `${agent.name}'s GBP account`)
      if (opened.status !== 201 || opened.value === undefined) return fail(`opening ${agent.name}'s GBP account must answer 201; Lens answered ${said(opened)}`)
      const from = opened.value.id
      const given = await step('POST', `/v1/money/accounts/${from}/funding`, { direction: 'to_agent', amount_minor: FUND_AGENT_MINOR, idempotency_key: key() },
        `the owner gives ${agent.name} ${gbp(FUND_AGENT_MINOR)} from the company's GBP account`)
      if (given.status !== 201) return fail(`giving ${agent.name} ${gbp(FUND_AGENT_MINOR)} answered ${said(given)}`)

      // 2. An exact-match payee, the agent's approval amount at 1,000 LXC and no other limit, and the agent's own key.
      const payee = await step<{ id: string; needs_confirmation?: boolean }>('POST', '/v1/money/payees', { name: `Nightly Payments Out ${RUN_SALT} Ltd`,
        country: 'GB', sort_code: '040004', account_number: '77889900' }, 'the owner saves a payee')
      if (payee.status !== 201 || payee.value === undefined) return fail(`saving a payee must answer 201; Lens answered ${said(payee)}`)
      if (payee.value.needs_confirmation) return fail(`a payee whose name matches its account must not wait for confirmation; Lens saved ${payee.text.slice(0, 200)}`)
      const rules = await step('PUT', `/v1/workspaces/{ws}/agents/${agent.id}/rules`, { ...await lens.agentRules(user, agent.id), max_per_request_ulxc: 0,
        hourly_limit_ulxc: 0, daily_limit_ulxc: 0, weekly_limit_ulxc: 0, monthly_limit_ulxc: 0, approval_above_ulxc: APPROVAL_ABOVE_ULXC },
      `${agent.name} asks the owner above 1,000 LXC, with no other limit`)
      if (rules.status !== 200) return fail(`setting ${agent.name}'s approval amount to 1,000 LXC answered ${said(rules)}`)
      const issued = await step<{ key: string }>('POST', `/v1/workspaces/{ws}/agents/${agent.id}/keys`, { name: 'payments-out' }, `${agent.name}'s own key`)
      if (issued.status >= 300 || issued.value?.key === undefined) return fail(`issuing ${agent.name} a key answered ${said(issued)}`)
      const agentKey = issued.value.key

      const holds = async (note: string): Promise<number> => {
        const r = await step<{ accounts: Account[] | null }>('GET', '/v1/money/accounts', undefined, note)
        const a = (r.value?.accounts ?? []).find((x) => x.id === from)
        if (a === undefined) throw new Error(`${agent.name}'s GBP account ${from} is not on the list: ${said(r)}`)
        return a.test_minor
      }
      /** The agent pays the payee `minor` from its account, on its own key. */
      const pay = async (minor: number, reference: string, idempotency: string, note: string) => {
        const r = await lens.as(agentKey, 'POST', '/v1/money/payments', { payee_id: payee.value?.id, account_id: from, amount_minor: minor, currency: 'GBP',
          reference, idempotency_key: idempotency })
        ctx.evidence.push({ note, answer: `${r.status} ${r.text.slice(0, 400)}` })
        let value: Payment | undefined
        try {
          value = r.status < 300 ? JSON.parse(r.text) as Payment : undefined
        } catch {
          value = undefined
        }
        return { status: r.status, value, error: r.status < 300 ? '' : refusalOf(r.text) }
      }
      /** Payment `id` read until it reads `want` (each read asks the partner), at most three times. */
      const readUntil = async (id: string, want: string, note: string): Promise<Payment | undefined> => {
        let last: Payment | undefined
        for (let n = 1; n <= 3 && last?.status !== want; n++) {
          last = (await step<Payment>('GET', `/v1/money/payments/${id}`, undefined, `${note} (read ${n})`)).value
        }
        return last
      }
      /** The agent's payments out with `reference`. */
      const listed = async (reference: string, note: string): Promise<Payment[]> => {
        const r = await step<{ payments: Payment[] | null }>('GET', `/v1/money/payments?agent_id=${encodeURIComponent(agent.id)}`, undefined, note)
        if (r.status !== 200) throw new Error(`listing ${agent.name}'s payments out answered ${said(r)}`)
        return (r.value?.payments ?? []).filter((p) => p.reference === reference)
      }

      try {
        const start = await holds(`${agent.name}'s account before any payment`)
        if (start !== FUND_AGENT_MINOR) return fail(`given ${gbp(FUND_AGENT_MINOR)} from the company's account, ${agent.name}'s GBP account holds ${gbp(start)}`)

        // 3. £20.00 completes, and leaves the account.
        const ref1 = `Nightly ${RUN_SALT} 1`
        const first = await pay(PAID_MINOR, ref1, key(), `${agent.name} pays ${gbp(PAID_MINOR)}`)
        if (first.status !== 201 || first.value === undefined) return fail(`${agent.name}'s ${gbp(PAID_MINOR)} to a saved payee must answer 201; Lens answered ${first.status} "${first.error}"`)
        const done = first.value.status === 'completed' ? first.value : await readUntil(first.value.id, 'completed', `the ${gbp(PAID_MINOR)} payment read again`)
        if (done?.status !== 'completed') return fail(`the Test partner completes a ${gbp(PAID_MINOR)} payment; it reads ${done?.status}`)
        const afterFirst = await holds(`${agent.name}'s account after ${gbp(PAID_MINOR)}`)
        if (afterFirst !== start - PAID_MINOR) return fail(`${gbp(PAID_MINOR)} paid out must leave the account: ${gbp(start)} → ${gbp(afterFirst)}`)

        // 4. £20.13 fails at the Test partner: no payment of it is anything but failed, and the account is whole.
        const ref2 = `Nightly ${RUN_SALT} 2`
        await pay(FAILED_MINOR, ref2, key(), `${agent.name} pays ${gbp(FAILED_MINOR)}, which the Test partner refuses`)
        const failed = await listed(ref2, `${agent.name}'s payments of ${gbp(FAILED_MINOR)}`)
        const afterFailed = await holds(`${agent.name}'s account after ${gbp(FAILED_MINOR)}`)
        if (failed.some((p) => p.status !== 'failed')) return fail(`the ${gbp(FAILED_MINOR)} the Test partner refuses must read failed; it reads ${JSON.stringify(failed).slice(0, 300)}`)
        if (afterFailed !== afterFirst) return fail(`the failed ${gbp(FAILED_MINOR)} must leave the account whole: ${gbp(afterFirst)} → ${gbp(afterFailed)}`)

        // 5. £20.14 completes, then reads returned, with its money back.
        const ref3 = `Nightly ${RUN_SALT} 3`
        const third = await pay(RETURNED_MINOR, ref3, key(), `${agent.name} pays ${gbp(RETURNED_MINOR)}, which the Test partner returns`)
        if (third.status !== 201 || third.value === undefined) return fail(`${agent.name}'s ${gbp(RETURNED_MINOR)} must answer 201; Lens answered ${third.status} "${third.error}"`)
        const returned = await readUntil(third.value.id, 'returned', `the ${gbp(RETURNED_MINOR)} payment read again`)
        if (returned?.status !== 'returned') return fail(`the Test partner returns a ${gbp(RETURNED_MINOR)} payment; read again it reads ${returned?.status}`)
        const afterReturned = await holds(`${agent.name}'s account after ${gbp(RETURNED_MINOR)} came back`)
        if (afterReturned !== afterFailed) return fail(`the returned ${gbp(RETURNED_MINOR)} must leave the account whole: ${gbp(afterFailed)} → ${gbp(afterReturned)}`)

        // 6. £100.00, above the approval amount: refused 403 naming an approval, and nothing moves.
        const ref4 = `Nightly ${RUN_SALT} 4`
        const aboveKey = key()
        const seen = new Set((await lens.agentApprovals(user)).map((a) => a.id))
        const refused = await pay(ABOVE_MINOR, ref4, aboveKey, `${agent.name} pays ${gbp(ABOVE_MINOR)}, above its 1,000 LXC approval amount`)
        const asked = (await lens.agentApprovals(user)).find((a) => a.agent_id === agent.id && a.status === 'pending' && !seen.has(a.id))
        const afterRefused = await holds(`${agent.name}'s account after ${gbp(ABOVE_MINOR)} was refused`)
        const early = await listed(ref4, `${agent.name}'s payments of ${gbp(ABOVE_MINOR)} before the approval`)
        if (refused.status !== 403 || !/approv/i.test(refused.error) || asked === undefined) {
          return fail(`${gbp(ABOVE_MINOR)} above ${agent.name}'s 1,000 LXC approval amount must be refused 403 naming an approval, and file a pending one; ` +
            `Lens answered ${refused.status} "${refused.error}"${asked === undefined ? ' and filed no pending approval' : ''}`)
        }
        if (afterRefused !== afterReturned) return fail(`${gbp(ABOVE_MINOR)} waiting for its approval moved money: ${gbp(afterReturned)} → ${gbp(afterRefused)}`)
        if (early.length !== 0) return fail(`${gbp(ABOVE_MINOR)} waiting for its approval must make no payment; Lens lists ${JSON.stringify(early).slice(0, 300)}`)
        if (asked.amount_ulxc <= APPROVAL_ABOVE_ULXC) return fail(`approval ${asked.id} must be for what ${gbp(ABOVE_MINOR)} is worth, above 1,000 LXC; it is for ${asked.amount_ulxc} µLXC`)

        // 7. The owner approves it, and the same request under the same key completes.
        const approved = await step('POST', `/v1/workspaces/{ws}/agents/approvals/${asked.id}/approve`, {}, `the owner approves ${asked.id}`)
        if (approved.status !== 200) return fail(`the owner's approval of ${asked.id} answered ${said(approved)}`)
        const again = await pay(ABOVE_MINOR, ref4, aboveKey, `${agent.name} asks again for ${gbp(ABOVE_MINOR)}, under the same key, approved`)
        if (again.status !== 201 || again.value === undefined) return fail(`approved, the same ${gbp(ABOVE_MINOR)} under the same key must answer 201; Lens answered ${again.status} "${again.error}"`)
        const paid = again.value.status === 'completed' ? again.value : await readUntil(again.value.id, 'completed', `the approved ${gbp(ABOVE_MINOR)} read again`)
        if (paid?.status !== 'completed') return fail(`the approved ${gbp(ABOVE_MINOR)} must complete at the Test partner; it reads ${paid?.status}`)

        // 8. The account ends at what came in less £120.00, on its balance and on its statement.
        const end = FUND_AGENT_MINOR - PAID_MINOR - ABOVE_MINOR
        const last = await holds(`${agent.name}'s account at the end`)
        if (last !== end) return fail(`${agent.name}'s account must end at ${gbp(FUND_AGENT_MINOR)} less ${gbp(PAID_MINOR + ABOVE_MINOR)}, ${gbp(end)}; it holds ${gbp(last)}`)
        const st = await step<Statement>('GET', `/v1/money/accounts/${from}/statement`, undefined, `${agent.name}'s account's statement`)
        if (st.status !== 200 || st.value === undefined) return fail(`${agent.name}'s account's statement answered ${said(st)}`)
        const lines = st.value.lines ?? []
        const sum = lines.reduce((n, l) => n + l.amount_minor, 0)
        if (sum !== end || (st.value.closing_minor !== undefined && st.value.closing_minor !== end) || !lines.some((l) => l.amount_minor === FUND_AGENT_MINOR)) {
          return fail(`${agent.name}'s statement must hold the ${gbp(FUND_AGENT_MINOR)} in and close on ${gbp(end)}; its lines ` +
            `${JSON.stringify(lines.map((l) => [l.kind, l.amount_minor]))} sum to ${gbp(sum)}${st.value.closing_minor === undefined ? '' : `, closing ${gbp(st.value.closing_minor)}`}`)
        }
        return {
          pass: true,
          detail: `from ${agent.name}'s GBP account: ${gbp(PAID_MINOR)} completed; ${gbp(FAILED_MINOR)} failed and ${gbp(RETURNED_MINOR)} read returned, ` +
            `each leaving it whole; ${gbp(ABOVE_MINOR)} above 1,000 LXC was refused 403 on approval ${asked.id} with nothing moved, then approved and ` +
            `paid under the same key; the account ended at ${gbp(end)}, its statement summing to it`,
        }
      } catch (e) {
        return fail((e as Error).message)
      }
    },
  }
}
