// B30.107 — accounts, payments and FX end to end (Lens B30.13, B30.15, B30.17, B30.29), on Lens's API, once a run, on a
// workspace of its own, judged on the ledger's postings at every step, never on a status code alone.
//
// money-accounts: the owner opens the company's GBP and EUR accounts and one agent's GBP account under them, and takes the EUR
// account the new agent already holds (Lens opens it with the agent), each at zero. £50.00 of test money comes into the
// company's GBP account through the payments-in path (POST …/test-money posts it as Lens's ReceivePayment does a partner's
// notification): one payment_in line. The owner saves a payee and pays it £20.00 from
// that account: the payment completes, and the account carries one payment_out_hold line of the amount and its fee, completed.
// The owner gives the agent £10.00 (agent_funding, −£10.00 on the company's account and +£10.00 on the agent's), and the agent
// converts it to EUR at its quote: one fx_conversion entry, −£10.00 on its GBP account and +what the quote buys on its EUR one.
// Then every account's statement holds exactly the lines made, opening + in − out = closing, and the closing is what the
// account holds: a posting missing at any step FAILs it.

import { randomBytes } from 'node:crypto'
import { fail } from './bank.ts'
import type { Scenario, ScenarioCtx } from './scenarios.ts'
import { call, said } from './settings.ts'

const RECEIVED_MINOR = 5000
const PAID_MINOR = 2000
const GIVEN_MINOR = 1000
const PAYEE = { name: 'Nightly Accounts Supplier Ltd', country: 'GB', sort_code: '040004', account_number: '44556677' }

interface Account { id: string; currency: string; purpose: string; status?: string; agent_id?: string; balance_minor: number; test_minor: number; live_minor: number }
interface Payment { id: string; status: string; amount_minor: number; fee_minor?: number; account_id: string }
interface Line { entry_id: string; kind: string; amount_minor: number; state?: string }
interface Statement { opening_minor: number; in_minor: number; out_minor: number; closing_minor: number; lines: Line[] | null }

/** What one account's statement must hold: its lines' kinds and amounts, in the order they were posted. */
export interface Expected { name: string; id: string; lines: { kind: string; amount_minor: number }[] }

/** What is wrong with `st`, the statement of `want`'s account that holds `holds`: a line missing, extra or wrong, or totals that do not add up. */
export function statementFaults(want: Expected, st: Statement, holds: number): string[] {
  const lines = st.lines ?? []
  const faults: string[] = []
  const got = lines.map((l) => `${l.kind} ${l.amount_minor}`)
  const wanted = want.lines.map((l) => `${l.kind} ${l.amount_minor}`)
  if (got.join(', ') !== wanted.join(', ')) faults.push(`${want.name}'s statement must hold [${wanted.join(', ')}]; it holds [${got.join(', ')}]`)
  const sum = want.lines.reduce((n, l) => n + l.amount_minor, 0)
  if (st.opening_minor + st.in_minor - st.out_minor !== st.closing_minor) {
    faults.push(`${want.name}'s statement must add up: opening ${st.opening_minor} + in ${st.in_minor} − out ${st.out_minor} is not its closing ${st.closing_minor}`)
  }
  if (st.closing_minor !== st.opening_minor + sum || holds !== st.opening_minor + sum) {
    faults.push(`${want.name} must close on ${st.opening_minor + sum}, what its postings add up to; its statement closes on ${st.closing_minor} and it holds ${holds}`)
  }
  return faults
}

export function moneyAccounts(): Scenario {
  return {
    id: 'money-accounts',
    owner: 'talyvor-lens',
    own: true,
    agents: 1,
    items: ['B30.107', 'B30.13', 'B30.15', 'B30.17', 'B30.29'],
    feature: 'Agent Wallets',
    title: 'accounts, payments and FX: the company and an agent open GBP and EUR accounts at zero, £50.00 comes in, £20.00 pays a saved payee, ' +
      '£10.00 goes to the agent and converts to EUR, and every statement holds exactly those postings',
    run: async (ctx: ScenarioCtx) => {
      const { lens } = ctx.env
      const user = ctx.app.user
      const salt = randomBytes(6).toString('hex')
      const step = async <T>(method: string, path: string, body: unknown, note: string) => {
        const r = await call<T>(ctx, method, path, body)
        ctx.evidence.push({ note, answer: said(r) })
        return r
      }
      const accounts = async (note: string): Promise<Account[]> => {
        const r = await step<{ accounts: Account[] | null }>('GET', '/v1/money/accounts', undefined, note)
        if (r.status !== 200) throw new Error(`listing the accounts answered ${said(r)}`)
        return r.value?.accounts ?? []
      }
      const holds = async (id: string, note: string): Promise<number> => {
        const a = (await accounts(note)).find((x) => x.id === id)
        if (a === undefined) throw new Error(`account ${id} is not on the list`)
        return a.test_minor
      }
      const statement = async (id: string, note: string): Promise<Statement> => {
        const r = await step<Statement>('GET', `/v1/money/accounts/${id}/statement`, undefined, note)
        if (r.status !== 200 || r.value === undefined) throw new Error(`the statement of ${id} answered ${said(r)}`)
        return r.value
      }

      try {
        // 1. The terms, then the company's GBP and EUR accounts and the agent's under them, each at zero.
        const terms = await step<{ terms: { capability: string; version: number; accepted?: unknown }[] | null }>('GET', '/v1/workspaces/{ws}/terms', undefined, 'the owner reads the terms')
        for (const t of (terms.value?.terms ?? []).filter((x) => x.accepted == null)) {
          const ok = await step('POST', `/v1/workspaces/{ws}/terms/${t.capability}/accept`, { version: t.version }, `the owner accepts ${t.capability}'s terms`)
          if (ok.status !== 201) return fail(`accepting ${t.capability}'s terms answered ${said(ok)}`)
        }
        const agent = await lens.createAgent(user, `Accounts ${salt}`)
        const company: Record<string, string> = {}
        const own: Record<string, string> = {}
        // A new agent in a Hybrid workspace already holds its EUR account: Lens opens the wallets of its kind as it creates it (B59.6, B48.1).
        const held = (await accounts(`${agent.name}'s accounts as it was created`)).filter((a) => a.agent_id === agent.id && a.purpose === 'agent' && a.status === 'open')
        for (const [whose, ids, extra] of [["the company's", company, {}], [`${agent.name}'s`, own, { agent_id: agent.id }]] as const) {
          for (const currency of ['GBP', 'EUR']) {
            const has = 'agent_id' in extra ? held.find((a) => a.currency === currency) : undefined
            if (has !== undefined) {
              ids[currency] = has.id
              continue
            }
            const opened = await step<Account>('POST', '/v1/money/accounts', { currency, ...extra }, `${whose} ${currency} account`)
            if (opened.status !== 201 || opened.value === undefined) return fail(`opening ${whose} ${currency} account on test money must answer 201; Lens answered ${said(opened)}`)
            ids[currency] = opened.value.id
          }
        }
        const opened = await accounts('the accounts as they opened')
        for (const id of [...Object.values(company), ...Object.values(own)]) {
          const a = opened.find((x) => x.id === id)
          if (a === undefined || a.test_minor !== 0 || a.live_minor !== 0 || a.balance_minor !== 0) return fail(`each account opens at zero; ${id} reads ${JSON.stringify(a)}`)
        }

        // 2. £50.00 comes into the company's GBP account: one payment_in posting.
        const received = await step('POST', `/v1/money/accounts/${company.GBP}/test-money`, { amount_minor: RECEIVED_MINOR, idempotency_key: `e2e-${salt}-in` },
          `£50.00 of test money comes into the company's GBP account`)
        if (received.status !== 201) return fail(`a test payment into the company's GBP account must answer 201; Lens answered ${said(received)}`)
        const afterIn = await holds(company.GBP, 'the company\'s GBP account after the payment in')
        if (afterIn !== RECEIVED_MINOR) return fail(`after £50.00 came in, the company's GBP account must hold ${RECEIVED_MINOR}; it holds ${afterIn}`)

        // 3. A saved payee paid £20.00 from it: completed, and held off the account with its fee.
        const payee = await step<{ id: string; needs_confirmation?: boolean }>('POST', '/v1/money/payees', PAYEE, 'the owner saves a payee')
        if (payee.status !== 201 || payee.value === undefined) return fail(`saving a payee must answer 201; Lens answered ${said(payee)}`)
        if (payee.value.needs_confirmation) return fail(`a payee whose name matches its account must not wait for confirmation; Lens saved ${payee.text.slice(0, 200)}`)
        const paid = await step<Payment>('POST', '/v1/money/payments', { payee_id: payee.value.id, account_id: company.GBP, amount_minor: PAID_MINOR, currency: 'GBP',
          reference: 'Nightly accounts', idempotency_key: `e2e-${salt}-out` }, 'the owner pays the payee £20.00 from the company\'s GBP account')
        if (paid.status !== 201 || paid.value === undefined) return fail(`paying a saved payee £20.00 of test money must answer 201; Lens answered ${said(paid)}`)
        let payment = paid.value
        if (payment.status !== 'completed') {
          const read = await step<Payment>('GET', `/v1/money/payments/${payment.id}`, undefined, 'the payment read again')
          if (read.value !== undefined) payment = read.value
        }
        if (payment.status !== 'completed') return fail(`a £20.00 payment to a saved payee completes at the Test partner; it reads ${payment.status}`)
        const debit = PAID_MINOR + (payment.fee_minor ?? 0)

        // 4. £10.00 to the agent, converted to EUR at its quote.
        const rules = await step('PUT', `/v1/workspaces/{ws}/agents/${agent.id}/rules`, { ...await lens.agentRules(user, agent.id), max_per_request_ulxc: 0,
          hourly_limit_ulxc: 0, daily_limit_ulxc: 0, weekly_limit_ulxc: 0, monthly_limit_ulxc: 0, approval_above_ulxc: 0 }, `${agent.name}'s money limits cleared`)
        if (rules.status !== 200) return fail(`clearing ${agent.name}'s money limits answered ${said(rules)}`)
        const given = await step('POST', `/v1/money/accounts/${own.GBP}/funding`, { direction: 'to_agent', amount_minor: GIVEN_MINOR, idempotency_key: `e2e-${salt}-give` },
          `the owner gives ${agent.name} £10.00 from the company's GBP account`)
        if (given.status !== 201) return fail(`giving ${agent.name} £10.00 answered ${said(given)}`)
        const base = `/v1/workspaces/{ws}/agents/${agent.id}/money/convert`
        const quoted = await step<{ id: string; buy_minor: number; buy_currency: string }>('POST', `${base}/quote`, { sell_currency: 'GBP', buy_currency: 'EUR', sell_minor: GIVEN_MINOR },
          `${agent.name} quotes £10.00 to EUR`)
        if (quoted.status !== 201 || quoted.value === undefined) return fail(`a quote of £10.00 to EUR must answer 201; Lens answered ${said(quoted)}`)
        const q = quoted.value
        if (!(q.buy_minor > 0) || q.buy_currency !== 'EUR') return fail(`the quote must buy some EUR; it buys ${q.buy_minor} ${q.buy_currency}`)
        const converted = await lens.as(user.token, 'POST', base.replace('{ws}', user.workspaceID), { quote_id: q.id }, { 'Idempotency-Key': `e2e-${salt}-fx` })
        ctx.evidence.push({ note: `${agent.name} converts at the quote`, answer: `${converted.status} ${converted.text.slice(0, 300)}` })
        const conversion = converted.status === 200 ? JSON.parse(converted.text) as { status: string; entry_id?: string } : undefined
        if (conversion?.status !== 'converted' || !conversion.entry_id) return fail(`converting at quote ${q.id} must answer the conversion, converted, with its entry; Lens answered ${converted.status} ${converted.text.slice(0, 200)}`)

        // 5. Every statement holds exactly the postings made, adds up, and closes on what its account holds.
        const want: Expected[] = [
          { name: "the company's GBP account", id: company.GBP, lines: [{ kind: 'payment_in', amount_minor: RECEIVED_MINOR }, { kind: 'payment_out_hold', amount_minor: -debit },
            { kind: 'agent_funding', amount_minor: -GIVEN_MINOR }] },
          { name: "the company's EUR account", id: company.EUR, lines: [] },
          { name: `${agent.name}'s GBP account`, id: own.GBP, lines: [{ kind: 'agent_funding', amount_minor: GIVEN_MINOR }, { kind: 'fx_conversion', amount_minor: -GIVEN_MINOR }] },
          { name: `${agent.name}'s EUR account`, id: own.EUR, lines: [{ kind: 'fx_conversion', amount_minor: q.buy_minor }] },
        ]
        const end = await accounts('the accounts at the end')
        const faults: string[] = []
        for (const w of want) {
          const st = await statement(w.id, `${w.name}'s statement`)
          faults.push(...statementFaults(w, st, end.find((a) => a.id === w.id)?.test_minor ?? Number.NaN))
          const hold = (st.lines ?? []).find((l) => l.kind === 'payment_out_hold')
          if (hold !== undefined && hold.state !== undefined && hold.state !== 'completed') faults.push(`the payment's hold line must read completed; it reads ${hold.state}`)
          const fx = (st.lines ?? []).find((l) => l.kind === 'fx_conversion')
          if (fx !== undefined && fx.entry_id !== conversion.entry_id) faults.push(`${w.name}'s fx_conversion line must be entry ${conversion.entry_id}; it is ${fx.entry_id}`)
        }
        if (faults.length > 0) return fail(faults.join('; '))
        return {
          pass: true,
          detail: `the company's GBP and EUR accounts and ${agent.name}'s opened at zero; £50.00 came in as payment_in; £20.00 to a saved payee completed, ${debit} held off ` +
            `the account; £10.00 to ${agent.name} converted to ${q.buy_minor} EUR cents in entry ${conversion.entry_id}; all four statements hold exactly those postings and ` +
            `close on what their accounts hold: GBP ${RECEIVED_MINOR - debit - GIVEN_MINOR}, EUR 0, agent GBP 0, agent EUR ${q.buy_minor}`,
        }
      } catch (e) {
        return fail((e as Error).message)
      }
    },
  }
}
