// B30.128 — mandates (Lens B30.19, B30.129), on Lens's API, once a run, on a workspace of its own. The owner opens the
// company's GBP account with £100.00 of test money in it, an agent's GBP account under it given £60.00 (B30.13, B30.15),
// saves an exact-match payee, and grants an outside business a mandate on the agent's account: £30.00 a pull and £50.00 a
// month, paid out to that payee. The business pulls with the key its grant answered once (X-Talyvor-Mandate-Key):
// £20.00 is 201, one entry with the agent's account −2000 and the mandate's hold account +2000, paid out to the payee as a
// completed payment, and the agent's account on GET /v1/money/accounts falls by 2000; the same pull again under the same
// idempotency key changes nothing; a second £20.00 is 201; a third is 403 naming the monthly maximum with the account
// unmoved; and once the owner revokes the mandate a pull is 409 with the account unmoved. Lens's record of the mandate
// then reads it revoked with £40.00 pulled this month.

import { randomBytes } from 'node:crypto'
import { fail } from './bank.ts'
import { RUN_SALT } from './oracles.ts'
import { refusalOf } from './lens.ts'
import type { Scenario } from './scenarios.ts'
import { call, said } from './settings.ts'

const FUND_COMPANY_MINOR = 10_000
const FUND_AGENT_MINOR = 6_000
const PER_PULL_MINOR = 3_000
const PER_MONTH_MINOR = 5_000
const PULL_MINOR = 2_000
const CAPABILITIES = ['currency_accounts', 'payments_in', 'payments_out']
const gbp = (minor: number): string => `£${(minor / 100).toFixed(2)}`

/** A mandate as Lens answers it (economy.Mandate); pull_key only on an outside business's grant. */
interface Mandate { id: string; account_id: string; hold_account_id?: string; status: string; pulled_this_month_minor: number; pull_key?: string }
/** One pull as Lens answers it (economy.MandatePull). */
interface Pull { mandate_id: string; amount_minor: number; pulled_this_month_minor: number; entry: { id: string; kind: string; postings: { account_id: string; amount_minor: number }[] | null }
  payment?: { status: string; partner_ref?: string; reference: string } }

export function moneyMandates(): Scenario {
  return {
    id: 'money-mandates',
    owner: 'talyvor-lens',
    own: true,
    agents: 1,
    feature: 'Agent Wallets',
    items: ['B30.19', 'B30.129', 'B30.128'],
    title: "mandates: an outside business pulls £20.00 twice on its key from an agent's GBP account, each one entry into the " +
      "mandate's hold paid out to the saved payee; a retry changes nothing; a third pull over the £50.00 monthly maximum is " +
      'refused 403 and, once the owner revokes the mandate, a pull is refused 409, the account unmoved by either',
    run: async (ctx) => {
      const { lens } = ctx.env
      const user = ctx.app.user
      const step = async <T>(method: string, path: string, body: unknown, note: string) => {
        const r = await call<T>(ctx, method, path, body)
        ctx.evidence.push({ note, answer: said(r) })
        return r
      }
      const key = () => `e2e-${randomBytes(8).toString('hex')}`

      // 1. The terms, the company's GBP account with test money in it, and the agent's GBP account under it, funded.
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
      const agent = await lens.createAgent(user, `Mandates ${RUN_SALT}`)
      const opened = await step<{ id: string }>('POST', '/v1/money/accounts', { currency: 'GBP', agent_id: agent.id }, `${agent.name}'s GBP account`)
      if (opened.status !== 201 || opened.value === undefined) return fail(`opening ${agent.name}'s GBP account must answer 201; Lens answered ${said(opened)}`)
      const from = opened.value.id
      const given = await step('POST', `/v1/money/accounts/${from}/funding`, { direction: 'to_agent', amount_minor: FUND_AGENT_MINOR, idempotency_key: key() },
        `the owner gives ${agent.name} ${gbp(FUND_AGENT_MINOR)} from the company's GBP account`)
      if (given.status !== 201) return fail(`giving ${agent.name} ${gbp(FUND_AGENT_MINOR)} answered ${said(given)}`)
      // A pull is judged by the agent's rules too (Lens B30.131): no limit of its own, so only the mandate's maxima refuse it.
      const rules = await step('PUT', `/v1/workspaces/{ws}/agents/${agent.id}/rules`, { ...await lens.agentRules(user, agent.id), max_per_request_ulxc: 0,
        hourly_limit_ulxc: 0, daily_limit_ulxc: 0, weekly_limit_ulxc: 0, monthly_limit_ulxc: 0 }, `${agent.name} has no spending limit of its own`)
      if (rules.status !== 200) return fail(`clearing ${agent.name}'s spending limits answered ${said(rules)}`)

      // 2. The saved payee the business's pulls are paid out to, and the mandate: £30.00 a pull, £50.00 a month.
      const payee = await step<{ id: string; needs_confirmation?: boolean }>('POST', '/v1/money/payees', { name: `Nightly Mandates ${RUN_SALT} Ltd`,
        country: 'GB', sort_code: '040004', account_number: '55667788' }, 'the owner saves the business as a payee')
      if (payee.status !== 201 || payee.value === undefined) return fail(`saving a payee must answer 201; Lens answered ${said(payee)}`)
      if (payee.value.needs_confirmation) return fail(`a payee whose name matches its account must not wait for confirmation; Lens saved ${payee.text.slice(0, 200)}`)
      const grant = { account_id: from, payee_business_id: `nightly-mandates-${RUN_SALT}`, payee_id: payee.value.id, payee_name: `Nightly Mandates ${RUN_SALT} Ltd`,
        max_per_pull_minor: PER_PULL_MINOR, max_per_month_minor: PER_MONTH_MINOR, expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString() }
      const granted = await step<Mandate>('POST', '/v1/money/mandates', { grant }, `the owner grants the business ${gbp(PER_PULL_MINOR)} a pull and ${gbp(PER_MONTH_MINOR)} a month`)
      if (granted.status !== 201 || granted.value === undefined) return fail(`granting an outside business a mandate must answer 201; Lens answered ${said(granted)}`)
      const m = granted.value
      if (!m.pull_key || !m.hold_account_id) return fail(`a grant to an outside business answers its pull_key once and its hold account; Lens answered ${granted.text.slice(0, 300)}`)
      const pullKey = m.pull_key

      const holds = async (note: string): Promise<number> => {
        const r = await step<{ accounts: { id: string; test_minor: number }[] | null }>('GET', '/v1/money/accounts', undefined, note)
        const a = (r.value?.accounts ?? []).find((x) => x.id === from)
        if (a === undefined) throw new Error(`${agent.name}'s GBP account ${from} is not on the list: ${said(r)}`)
        return a.test_minor
      }
      /** The business pulls `minor` on its mandate's key, with no workspace credential. */
      const pull = async (minor: number, idempotency: string, note: string) => {
        const r = await lens.as('', 'POST', `/v1/money/mandates/${m.id}/pull`, { amount_minor: minor, idempotency_key: idempotency, funding: 'test', memo: `Nightly ${RUN_SALT}` },
          { 'X-Talyvor-Mandate-Key': pullKey })
        ctx.evidence.push({ note, answer: `${r.status} ${r.text.slice(0, 400)}` })
        let value: Pull | undefined
        try {
          value = r.status < 300 ? JSON.parse(r.text) as Pull : undefined
        } catch {
          value = undefined
        }
        return { status: r.status, value, error: r.status < 300 ? '' : refusalOf(r.text) }
      }
      /** What is wrong with a £20.00 pull's entry and payment: empty when it moved the agent's account into the hold and paid it out. */
      const wrongPull = (p: Pull): string[] => {
        const postings = (p.entry?.postings ?? []).map((x) => `${x.account_id}:${x.amount_minor}`).sort()
        const want = [`${from}:${-PULL_MINOR}`, `${m.hold_account_id}:${PULL_MINOR}`].sort()
        const wrong: string[] = []
        if (JSON.stringify(postings) !== JSON.stringify(want)) wrong.push(`its entry must post the agent's account −${PULL_MINOR} and the hold +${PULL_MINOR}; it posts ${JSON.stringify(postings)}`)
        if (p.payment?.status !== 'completed' || !p.payment.partner_ref) wrong.push(`it must be paid out to the saved payee, completed with the partner's reference; its payment reads ${JSON.stringify(p.payment)}`)
        return wrong
      }

      try {
        const start = await holds(`${agent.name}'s account before any pull`)
        if (start !== FUND_AGENT_MINOR) return fail(`given ${gbp(FUND_AGENT_MINOR)} from the company's account, ${agent.name}'s GBP account holds ${gbp(start)}`)

        // 3. £20.00 is pulled: one entry into the hold, paid out, and the agent's account falls by 2000.
        const firstKey = key()
        const first = await pull(PULL_MINOR, firstKey, `the business pulls ${gbp(PULL_MINOR)}`)
        if (first.status !== 201 || first.value === undefined) return fail(`a ${gbp(PULL_MINOR)} pull within both maxima must answer 201; Lens answered ${first.status} "${first.error}"`)
        const firstWrong = wrongPull(first.value)
        if (firstWrong.length > 0) return fail(`the ${gbp(PULL_MINOR)} pull is wrong: ${firstWrong.join('; ')}`)
        const afterFirst = await holds(`${agent.name}'s account after the first pull`)
        if (afterFirst !== start - PULL_MINOR) return fail(`a ${gbp(PULL_MINOR)} pull must take ${PULL_MINOR} from ${agent.name}'s account: ${start} → ${afterFirst}`)

        // 4. The same pull again, under the same idempotency key, changes nothing.
        const retry = await pull(PULL_MINOR, firstKey, `the business sends the same pull again, under the same key`)
        const afterRetry = await holds(`${agent.name}'s account after the retry`)
        if (retry.status >= 300 || retry.value?.entry?.id !== first.value.entry.id) {
          return fail(`a retry under the same idempotency key must answer the same pull, entry ${first.value.entry.id}; Lens answered ${retry.status} ${retry.value?.entry?.id ?? `"${retry.error}"`}`)
        }
        if (afterRetry !== afterFirst) return fail(`a retry under the same idempotency key moved money: ${afterFirst} → ${afterRetry}`)

        // 5. A second £20.00 fits under £50.00 a month.
        const second = await pull(PULL_MINOR, key(), `the business pulls a second ${gbp(PULL_MINOR)}`)
        if (second.status !== 201 || second.value === undefined) return fail(`a second ${gbp(PULL_MINOR)}, ${gbp(2 * PULL_MINOR)} this month under ${gbp(PER_MONTH_MINOR)}, must answer 201; Lens answered ${second.status} "${second.error}"`)
        const secondWrong = wrongPull(second.value)
        if (secondWrong.length > 0) return fail(`the second ${gbp(PULL_MINOR)} pull is wrong: ${secondWrong.join('; ')}`)
        const afterSecond = await holds(`${agent.name}'s account after the second pull`)
        if (afterSecond !== afterFirst - PULL_MINOR) return fail(`the second ${gbp(PULL_MINOR)} pull must take ${PULL_MINOR} from ${agent.name}'s account: ${afterFirst} → ${afterSecond}`)

        // 6. A third would take the month to £60.00: refused 403 naming the monthly maximum, and nothing moves.
        const third = await pull(PULL_MINOR, key(), `the business pulls a third ${gbp(PULL_MINOR)}, over ${gbp(PER_MONTH_MINOR)} this month`)
        const afterThird = await holds(`${agent.name}'s account after the third pull`)
        if (third.status !== 403 || !/per month|monthly/i.test(third.error)) {
          return fail(`a third ${gbp(PULL_MINOR)}, ${gbp(3 * PULL_MINOR)} this month over the ${gbp(PER_MONTH_MINOR)} maximum, must be refused 403 naming the monthly maximum; ` +
            `Lens answered ${third.status} "${third.error}"`)
        }
        if (afterThird !== afterSecond) return fail(`the pull refused over the monthly maximum moved money: ${afterSecond} → ${afterThird}`)

        // 7. The owner revokes the mandate: a pull is refused 409, and nothing moves.
        const revoked = await step('POST', `/v1/money/mandates/${m.id}/revoke`, {}, 'the owner revokes the mandate')
        if (revoked.status !== 200) return fail(`the owner's revoke of mandate ${m.id} answered ${said(revoked)}`)
        const late = await pull(500, key(), 'the business pulls £5.00 after the revoke')
        const afterLate = await holds(`${agent.name}'s account after the pull on the revoked mandate`)
        if (late.status !== 409) return fail(`a pull on a revoked mandate must be refused 409; Lens answered ${late.status} "${late.error}"`)
        if (afterLate !== afterSecond) return fail(`the pull refused on the revoked mandate moved money: ${afterSecond} → ${afterLate}`)

        // 8. Lens's record: revoked, £40.00 pulled this month.
        const listed = await step<{ granted: Mandate[] | null }>('GET', '/v1/money/mandates', undefined, "Lens's record of the mandate")
        const rec = (listed.value?.granted ?? []).find((x) => x.id === m.id)
        if (rec?.status !== 'revoked' || rec.pulled_this_month_minor !== 2 * PULL_MINOR) {
          return fail(`Lens must record the mandate revoked with ${2 * PULL_MINOR} pulled this month; it reads ${rec === undefined ? 'no such mandate' : `${rec.status}, ${rec.pulled_this_month_minor}`}`)
        }
        return {
          pass: true,
          detail: `on its key the business pulled ${gbp(PULL_MINOR)} twice from ${agent.name}'s GBP account, each one entry into the mandate's hold paid out to ` +
            `the saved payee, the account ${start} → ${afterFirst} → ${afterSecond}; the retry under the same key answered the same entry and moved nothing; ` +
            `a third ${gbp(PULL_MINOR)} over the ${gbp(PER_MONTH_MINOR)} monthly maximum was refused 403 and, revoked, a pull 409, the account still ${afterLate}; ` +
            `Lens records it revoked with ${gbp(2 * PULL_MINOR)} pulled this month`,
        }
      } catch (e) {
        return fail((e as Error).message)
      }
    },
  }
}
