// B30.127 — payments out to people and companies outside Talyvor (Lens B30.17), from an agent's own account, on Lens's API,
// once a run, on a workspace of its own. The owner opens the company's GBP account and puts £500.00 of test money in it, opens
// an agent's GBP account under it and gives the agent £300.00, saves an exact-match payee, and sets the agent's approval amount
// to 1,000 LXC with no other limit. On the agent's own key, from its account (account_id), the Test partner answers by amount:
// £20.00 completes; £20.13 fails and leaves the account whole; £20.14 completes and, read again (GET /v1/money/payments/{id}
// asks the partner), reads returned with its money back; £100.00, worth more than 1,000 LXC, is refused 403 naming an approval
// and moves nothing; the owner approves it, and the same request under the same key completes. Judged on the account's balance
// after every step and on its statement: it ends at what came in less £120.00.
//
// B30.135 — then an international payment (Lens B30.22), on the owner's key from the company's GBP account to a saved payee whose
// IBAN is in euros: paying it without a quote is refused 400 and moves nothing; POST /v1/money/payments/quote shows the partner's
// cost, Talyvor's fee — the plan's intl_payment_fee_minor for GBP as Lens's public fees state it (£5.00 on Studio, Nicolai's
// value) — the total that leaves the account, the rate and what arrives in EUR, and moves nothing; another amount at that quote is
// refused 409 and moves nothing; the payment at its quote completes with the quote's figures. Judged on the account's ledger: its
// balance falls by exactly the total, and the statement's new lines sum to minus the total.
//
// B30.148 — and on the payment's own entry (Lens B30.147, GET /v1/money/payments/{id}/entry): its postings sum to zero in GBP and
// in EUR and in no other currency, Lens's per-currency sums say the same, its revenue postings in GBP are exactly the quote's fee,
// and what posts in EUR is exactly what the quote said arrives.

import { randomBytes } from 'node:crypto'
import { fail } from './bank.ts'
import { RUN_SALT } from './oracles.ts'
import { type Fees, refusalOf } from './lens.ts'
import type { Scenario } from './scenarios.ts'
import { call, said } from './settings.ts'

const FUND_COMPANY_MINOR = 50_000
const FUND_AGENT_MINOR = 30_000
const APPROVAL_ABOVE_ULXC = 1_000_000_000
const PAID_MINOR = 2_000
const FAILED_MINOR = 2_013
const RETURNED_MINOR = 2_014
const ABOVE_MINOR = 10_000
const ABROAD_MINOR = 5_000
const CAPABILITIES = ['currency_accounts', 'payments_in', 'payments_out']
const gbp = (minor: number): string => `£${(minor / 100).toFixed(2)}`

/** A payment out as Lens answers it (economy.OutsidePayment). */
interface Payment { id: string; account_id: string; agent_id?: string; amount_minor: number; currency: string; reference: string; status: string; entry_id?: string }
interface Account { id: string; test_minor: number }
interface Statement { closing_minor?: number; lines: { entry_id?: string; line?: number; kind?: string; amount_minor: number }[] | null }
/** B30.135 — an international payment's quote as Lens answers it (economy.InternationalQuote). */
interface Quote { id: string; account_id: string; payee_id: string; amount_minor: number; currency: string; partner_cost_minor: number; fee_minor: number
  total_minor: number; arrives_minor: number; arrives_currency: string; rate: string; expires_at: string }
/** B30.148 — a payment's ledger entry as Lens answers it (economy.PaymentEntry). */
interface Entry { payment_id: string; entry_id: string; postings: { account_id: string; purpose: string; amount_minor: number; currency: string }[] | null
  sums: { currency: string; sum_minor: number }[] | null }

/**
 * B30.135 — Talyvor's fee for the first international payment of the month in GBP on `plan`, as Lens's public fees state it: none
 * while the plan's free ones last, else intl_payment_fee_minor less the plan's discount, rounded up (Lens's paymentFee).
 */
export function intlFeeMinor(fees: Fees, plan: string): number | string {
  const free = fees.intl_free_per_month?.[plan]
  const fee = fees.intl_payment_fee_minor?.GBP
  if (free === undefined || fee === undefined) return `Lens's public fees state no intl_free_per_month for the plan ${plan} or no intl_payment_fee_minor for GBP`
  return free !== 0 ? 0 : fee - Math.floor(fee * (fees.intl_discount_bps?.[plan] ?? 0) / 10_000)
}

export function paymentsOut(): Scenario {
  return {
    id: 'payments-out',
    owner: 'talyvor-lens',
    own: true,
    agents: 1,
    feature: 'Agent Wallets',
    items: ['B30.17', 'B30.127', 'B30.22', 'B30.135'],
    title: "payments out: from an agent's GBP account to a saved payee, £20.00 completes, £20.13 fails and £20.14 comes back returned, " +
      "each leaving the account whole; £100.00 above the agent's approval amount moves nothing until the owner approves it, then " +
      'the same request completes; the account ends at what came in less £120.00; then the company pays a euro IBAN only at a quote ' +
      "showing its fee and rate first, and the account falls by exactly the quote's total",
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

      const holds = async (note: string, id = from): Promise<number> => {
        const r = await step<{ accounts: Account[] | null }>('GET', '/v1/money/accounts', undefined, note)
        const a = (r.value?.accounts ?? []).find((x) => x.id === id)
        if (a === undefined) throw new Error(`the GBP account ${id} is not on the list: ${said(r)}`)
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
        const statement = async (id: string, note: string): Promise<Statement> => {
          const r = await step<Statement>('GET', `/v1/money/accounts/${id}/statement`, undefined, note)
          if (r.status !== 200 || r.value === undefined) throw new Error(`the statement of ${id} answered ${said(r)}`)
          return r.value
        }
        const st = await statement(from, `${agent.name}'s account's statement`)
        const lines = st.lines ?? []
        const sum = lines.reduce((n, l) => n + l.amount_minor, 0)
        if (sum !== end || (st.closing_minor !== undefined && st.closing_minor !== end) || !lines.some((l) => l.amount_minor === FUND_AGENT_MINOR)) {
          return fail(`${agent.name}'s statement must hold the ${gbp(FUND_AGENT_MINOR)} in and close on ${gbp(end)}; its lines ` +
            `${JSON.stringify(lines.map((l) => [l.kind, l.amount_minor]))} sum to ${gbp(sum)}${st.closing_minor === undefined ? '' : `, closing ${gbp(st.closing_minor)}`}`)
        }

        // 9. B30.135 — an international payment from the company's GBP account to a saved payee whose IBAN is in euros.
        const companyID = company.value.id
        const abroad = await step<{ id: string; needs_confirmation?: boolean }>('POST', '/v1/money/payees', { name: `Nightly Payments Abroad ${RUN_SALT} GmbH`,
          country: 'DE', iban: 'DE89370400440532013000', bic: 'COBADEFFXXX' }, 'the owner saves a payee whose account is in euros')
        if (abroad.status !== 201 || abroad.value === undefined) return fail(`saving a payee with an IBAN must answer 201; Lens answered ${said(abroad)}`)
        if (abroad.value.needs_confirmation) return fail(`a payee whose name matches its IBAN must not wait for confirmation; Lens saved ${abroad.text.slice(0, 200)}`)
        const plan = (await lens.workspacePlan(user)).plan
        const wantFee = intlFeeMinor(ctx.env.fees, plan)
        if (typeof wantFee === 'string') return fail(wantFee)
        const ownerPays = (body: Record<string, unknown>, note: string) => step<Payment & Partial<Quote> & { quote_id?: string; entry_id?: string }>('POST', '/v1/money/payments', { payee_id: abroad.value?.id,
          account_id: companyID, currency: 'GBP', funding: 'test', reference: `Nightly ${RUN_SALT} abroad`, idempotency_key: key(), ...body }, note)
        const before = await holds("the company's account before the payment abroad", companyID)
        const seenLines = new Set(((await statement(companyID, "the company's statement before the payment abroad")).lines ?? []).map((l) => `${l.entry_id}:${l.line}`))

        const bare = await ownerPays({ amount_minor: ABROAD_MINOR }, `the owner pays ${gbp(ABROAD_MINOR)} abroad with no quote`)
        const afterBare = await holds("the company's account after the payment abroad with no quote", companyID)
        if (bare.status !== 400 || !/quote/i.test(refusalOf(bare.text))) return fail(`a payment to a euro IBAN without a quote must be refused 400 naming the quote; Lens answered ${said(bare)}`)
        if (afterBare !== before) return fail(`the payment abroad refused for its missing quote moved money: ${gbp(before)} → ${gbp(afterBare)}`)

        // 10. The quote: the fee and the rate first, and nothing moves.
        const quoted = await step<Quote>('POST', '/v1/money/payments/quote', { payee_id: abroad.value.id, account_id: companyID, amount_minor: ABROAD_MINOR,
          currency: 'GBP', funding: 'test' }, `the owner asks what ${gbp(ABROAD_MINOR)} abroad costs`)
        if (quoted.status !== 201 || quoted.value === undefined) return fail(`quoting ${gbp(ABROAD_MINOR)} to a euro IBAN must answer 201; Lens answered ${said(quoted)}`)
        const q = quoted.value
        const wrongQuote: string[] = []
        if (q.fee_minor !== wantFee) wrongQuote.push(`its fee must be the plan ${plan}'s ${gbp(wantFee)} as Lens's public fees state it; it is ${gbp(q.fee_minor)}`)
        if (!(q.partner_cost_minor >= 0)) wrongQuote.push(`the partner's cost must be shown; it is ${q.partner_cost_minor}`)
        if (q.total_minor !== ABROAD_MINOR + q.partner_cost_minor + q.fee_minor) {
          wrongQuote.push(`its total must be ${gbp(ABROAD_MINOR)} + the partner's ${gbp(q.partner_cost_minor)} + the fee ${gbp(q.fee_minor)}; it is ${gbp(q.total_minor)}`)
        }
        if (q.arrives_currency !== 'EUR' || !(q.arrives_minor > 0) || !(Number(q.rate) > 0)) {
          wrongQuote.push(`it must show what arrives in EUR and the rate; it shows ${q.arrives_minor} ${q.arrives_currency} at "${q.rate}"`)
        }
        if (wrongQuote.length > 0) return fail(`the quote for ${gbp(ABROAD_MINOR)} abroad is wrong: ${wrongQuote.join('; ')} (${quoted.text.slice(0, 300)})`)
        const afterQuote = await holds("the company's account after the quote", companyID)
        if (afterQuote !== before) return fail(`a quote must move no money: ${gbp(before)} → ${gbp(afterQuote)}`)

        // 11. Another amount at that quote is refused 409, and nothing moves.
        const other = await ownerPays({ amount_minor: ABROAD_MINOR + 100, quote_id: q.id }, `the owner pays ${gbp(ABROAD_MINOR + 100)} at the quote for ${gbp(ABROAD_MINOR)}`)
        const afterOther = await holds("the company's account after the payment of another amount at the quote", companyID)
        if (other.status !== 409) return fail(`${gbp(ABROAD_MINOR + 100)} at a quote for ${gbp(ABROAD_MINOR)} must be refused 409; Lens answered ${said(other)}`)
        if (afterOther !== before) return fail(`the payment refused at another payment's quote moved money: ${gbp(before)} → ${gbp(afterOther)}`)

        // 12. At its quote it completes, with the quote's figures, and the account falls by exactly the total.
        const sent = await ownerPays({ amount_minor: ABROAD_MINOR, quote_id: q.id }, `the owner pays ${gbp(ABROAD_MINOR)} abroad at quote ${q.id}`)
        if (sent.status !== 201 || sent.value === undefined) return fail(`${gbp(ABROAD_MINOR)} at its quote must answer 201; Lens answered ${said(sent)}`)
        const p = sent.value.status === 'completed' ? sent.value : await readUntil(sent.value.id, 'completed', `the payment abroad read again`)
        if (p?.status !== 'completed') return fail(`the Test partner completes ${gbp(ABROAD_MINOR)} abroad; it reads ${p?.status}`)
        const s0 = sent.value
        if (s0.quote_id !== q.id || s0.fee_minor !== q.fee_minor || s0.partner_cost_minor !== q.partner_cost_minor || s0.arrives_minor !== q.arrives_minor ||
          s0.arrives_currency !== 'EUR' || s0.rate !== q.rate) {
          return fail(`the payment must keep its quote's figures — ${JSON.stringify([q.id, q.fee_minor, q.partner_cost_minor, q.arrives_minor, 'EUR', q.rate])}; it keeps ` +
            JSON.stringify([s0.quote_id, s0.fee_minor, s0.partner_cost_minor, s0.arrives_minor, s0.arrives_currency, s0.rate]))
        }
        const afterSent = await holds("the company's account after the payment abroad", companyID)
        if (afterSent !== before - q.total_minor) {
          return fail(`the payment abroad must take its quote's total ${gbp(q.total_minor)} from the account: ${gbp(before)} → ${gbp(afterSent)}, ${gbp(before - afterSent)} taken`)
        }
        const cs = await statement(companyID, "the company's statement after the payment abroad")
        const fresh = (cs.lines ?? []).filter((l) => !seenLines.has(`${l.entry_id}:${l.line}`))
        const freshSum = fresh.reduce((n, l) => n + l.amount_minor, 0)
        if (freshSum !== -q.total_minor || (cs.closing_minor !== undefined && cs.closing_minor !== afterSent)) {
          return fail(`the company's statement must show the payment abroad as −${gbp(q.total_minor)} and close on ${gbp(afterSent)}; its new lines ` +
            `${JSON.stringify(fresh.map((l) => [l.kind, l.amount_minor]))} sum to ${gbp(freshSum)}${cs.closing_minor === undefined ? '' : `, closing ${gbp(cs.closing_minor)}`}`)
        }

        // 13. B30.148 — its entry: zero in GBP and in EUR, the fee on Talyvor's revenue account, what arrives in EUR.
        const read = await step<Entry>('GET', `/v1/money/payments/${s0.id}/entry`, undefined, `the owner reads the payment abroad's ledger entry`)
        if (read.status !== 200 || read.value === undefined) return fail(`the completed payment abroad's entry must read 200; Lens answered ${said(read)}`)
        const e = read.value
        const postings = e.postings ?? []
        const entryOf = p.entry_id ?? s0.entry_id
        if (e.payment_id !== s0.id || e.entry_id === '' || (entryOf !== undefined && e.entry_id !== entryOf)) {
          return fail(`the entry must be payment ${s0.id}'s, entry ${entryOf ?? '(any)'}; it reads payment ${e.payment_id}, entry ${e.entry_id}`)
        }
        const sums = new Map<string, number>()
        for (const lp of postings) sums.set(lp.currency, (sums.get(lp.currency) ?? 0) + lp.amount_minor)
        const lensSums = new Map((e.sums ?? []).map((x) => [x.currency, x.sum_minor]))
        const revenue = postings.filter((lp) => lp.purpose === 'revenue' && lp.currency === 'GBP').reduce((n, lp) => n + lp.amount_minor, 0)
        const arrives = postings.filter((lp) => lp.currency === 'EUR' && lp.amount_minor > 0).reduce((n, lp) => n + lp.amount_minor, 0)
        const wrongEntry: string[] = []
        if ([...sums.keys()].sort().join() !== 'EUR,GBP' || sums.get('GBP') !== 0 || sums.get('EUR') !== 0) {
          wrongEntry.push(`its postings must sum to zero in GBP and in EUR and post no other currency; they sum to ${JSON.stringify(Object.fromEntries(sums))}`)
        }
        if (lensSums.size !== sums.size || [...sums].some(([c, n]) => lensSums.get(c) !== n)) {
          wrongEntry.push(`Lens's sums ${JSON.stringify(e.sums)} must be what its postings add up to, ${JSON.stringify(Object.fromEntries(sums))}`)
        }
        if (revenue !== q.fee_minor) wrongEntry.push(`Talyvor's revenue account must gain the fee ${gbp(q.fee_minor)}; it gains ${gbp(revenue)}`)
        if (arrives !== q.arrives_minor) wrongEntry.push(`it must post the ${(q.arrives_minor / 100).toFixed(2)} EUR that arrives; it posts ${(arrives / 100).toFixed(2)} EUR`)
        if (wrongEntry.length > 0) {
          return fail(`the payment abroad's entry is wrong: ${wrongEntry.join('; ')} (${JSON.stringify(postings.map((lp) => [lp.purpose, lp.amount_minor, lp.currency]))})`)
        }
        return {
          pass: true,
          detail: `from ${agent.name}'s GBP account: ${gbp(PAID_MINOR)} completed; ${gbp(FAILED_MINOR)} failed and ${gbp(RETURNED_MINOR)} read returned, ` +
            `each leaving it whole; ${gbp(ABOVE_MINOR)} above 1,000 LXC was refused 403 on approval ${asked.id} with nothing moved, then approved and ` +
            `paid under the same key; the account ended at ${gbp(end)}, its statement summing to it. Abroad: with no quote 400, ${gbp(ABROAD_MINOR)} quoted at ` +
            `a fee of ${gbp(q.fee_minor)} and the partner's ${gbp(q.partner_cost_minor)}, ${gbp(q.total_minor)} in all, ${(q.arrives_minor / 100).toFixed(2)} EUR ` +
            `arriving at ${q.rate}; another amount at the quote 409; at the quote it completed and the company's account fell by exactly ${gbp(q.total_minor)}; ` +
            `its entry's ${postings.length} postings sum to zero in GBP and in EUR, ${gbp(revenue)} to Talyvor's revenue and ${(arrives / 100).toFixed(2)} EUR arriving`,
        }
      } catch (e) {
        return fail((e as Error).message)
      }
    },
  }
}
