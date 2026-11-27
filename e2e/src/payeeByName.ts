// B17.534 — pay a saved payee by name (Lens B28.346, the Lens side of B28.76), on Lens's API, once a run, on a workspace of its
// own. The owner opens the company's GBP account, puts £100.00 of test money in it and saves three exact-match payees: one with a
// name of its own, and two that share a name. £20.00 paid to the first by its payee_id completes; £20.00 paid to it by its name,
// in other case and spacing, completes to the same payee and writes the same ledger entry: the same postings on the same
// accounts, and the same lines on the account's statement. Paid by a part of that name, or by the name the other two share, Lens
// refuses 404 and 409 and nothing moves: no payment, no statement line, the balance unchanged. Judged on the account's ledger.

import { randomBytes } from 'node:crypto'
import { fail } from './bank.ts'
import { RUN_SALT } from './oracles.ts'
import type { Scenario } from './scenarios.ts'
import { call, said } from './settings.ts'

const FUND_MINOR = 10_000
const PAY_MINOR = 2_000
const CAPABILITIES = ['currency_accounts', 'payments_in', 'payments_out']
const gbp = (minor: number): string => `£${(minor / 100).toFixed(2)}`

interface Payment { id: string; payee_id: string; payee_name?: string; amount_minor: number; status: string }
interface Account { id: string; test_minor: number }
interface Line { entry_id?: string; kind?: string; amount_minor: number }
/** A payment's ledger entry as Lens answers it (economy.PaymentEntry, B30.147). */
interface Entry { entry_id: string; postings: { account_id: string; purpose: string; amount_minor: number; currency: string }[] | null }

export function payeeByName(): Scenario {
  return {
    id: 'pay-payee-by-name',
    owner: 'talyvor-lens',
    own: true,
    feature: 'Agent Wallets',
    items: ['B28.346'],
    title: 'a saved payee paid by its name, in any case and spacing, completes to that payee and writes the same ledger entry and ' +
      'statement lines as paying it by id; a part of its name is 404 and a name two payees share 409, each moving nothing',
    run: async (ctx) => {
      const step = async <T>(method: string, path: string, body: unknown, note: string) => {
        const r = await call<T>(ctx, method, path, body)
        ctx.evidence.push({ note, answer: said(r) })
        return r
      }
      const key = () => `e2e-${randomBytes(8).toString('hex')}`

      // 1. The terms, and the company's GBP account with £100.00 of test money in it.
      const terms = await step<{ terms: { capability: string; version: number; accepted?: unknown }[] | null }>('GET', '/v1/workspaces/{ws}/terms', undefined, 'the owner reads the terms')
      for (const t of (terms.value?.terms ?? []).filter((x) => CAPABILITIES.includes(x.capability) && x.accepted == null)) {
        const ok = await step('POST', `/v1/workspaces/{ws}/terms/${t.capability}/accept`, { version: t.version }, `the owner accepts ${t.capability}'s terms`)
        if (ok.status !== 201) return fail(`accepting ${t.capability}'s terms answered ${said(ok)}`)
      }
      const opened = await step<{ id: string }>('POST', '/v1/money/accounts', { currency: 'GBP' }, "the company's GBP account")
      if (opened.status !== 201 || opened.value === undefined) return fail(`opening the company's GBP account on test money must answer 201; Lens answered ${said(opened)}`)
      const account = opened.value.id
      const topped = await step('POST', `/v1/money/accounts/${account}/test-money`, { amount_minor: FUND_MINOR, idempotency_key: key() },
        `${gbp(FUND_MINOR)} of test money comes into the company's GBP account`)
      if (topped.status !== 201) return fail(`${gbp(FUND_MINOR)} of test money into the company's GBP account answered ${said(topped)}`)

      // 2. Three exact-match payees: one with a name of its own, two sharing one.
      const name = `Nightly Paid By Name ${RUN_SALT} Ltd`
      const shared = `Nightly Shared Name ${RUN_SALT} Ltd`
      const save = async (payeeName: string, number: string, note: string) => {
        const r = await step<{ id: string; needs_confirmation?: boolean }>('POST', '/v1/money/payees', { name: payeeName, country: 'GB', sort_code: '040004', account_number: number }, note)
        if (r.status !== 201 || r.value === undefined) throw new Error(`saving the payee ${payeeName} must answer 201; Lens answered ${said(r)}`)
        if (r.value.needs_confirmation) throw new Error(`a payee whose name matches its account must not wait for confirmation; Lens saved ${r.text.slice(0, 200)}`)
        return r.value.id
      }
      let payee = ''
      const holds = async (note: string): Promise<number> => {
        const r = await step<{ accounts: Account[] | null }>('GET', '/v1/money/accounts', undefined, note)
        const a = (r.value?.accounts ?? []).find((x) => x.id === account)
        if (a === undefined) throw new Error(`the GBP account ${account} is not on the list: ${said(r)}`)
        return a.test_minor
      }
      const lines = async (note: string): Promise<Line[]> => {
        const r = await step<{ lines: Line[] | null }>('GET', `/v1/money/accounts/${account}/statement`, undefined, note)
        if (r.status !== 200) throw new Error(`the GBP account's statement answered ${said(r)}`)
        return r.value?.lines ?? []
      }
      const payments = async (note: string): Promise<Payment[]> => {
        const r = await step<{ payments: Payment[] | null }>('GET', '/v1/money/payments', undefined, note)
        if (r.status !== 200) throw new Error(`the list of payments answered ${said(r)}`)
        return r.value?.payments ?? []
      }
      const pay = (to: object, note: string) => step<Payment>('POST', '/v1/money/payments',
        { ...to, account_id: account, amount_minor: PAY_MINOR, currency: 'GBP', reference: 'Nightly by name', idempotency_key: key() }, note)
      // paid is a completed payment's entry and the statement lines it added: each as "purpose account amount currency" and "kind amount".
      const paid = async (r: Awaited<ReturnType<typeof pay>>, before: Line[], how: string): Promise<{ postings: string; lines: string } | string> => {
        if (r.status !== 201 || r.value?.status !== 'completed') return `${gbp(PAY_MINOR)} paid to ${name} ${how} must answer 201 completed; Lens answered ${said(r)}`
        if (r.value.payee_id !== payee) return `${gbp(PAY_MINOR)} paid to ${name} ${how} went to payee ${r.value.payee_id}, not ${payee}`
        const e = await step<Entry>('GET', `/v1/money/payments/${r.value.id}/entry`, undefined, `the owner reads the entry of the payment ${how}`)
        if (e.status !== 200 || e.value === undefined) return `the entry of the payment ${how} answered ${said(e)}`
        const after = await lines(`the GBP account's statement after the payment ${how}`)
        const added = after.filter((l) => !before.some((b) => b.entry_id === l.entry_id && b.kind === l.kind && b.amount_minor === l.amount_minor))
        return {
          postings: (e.value.postings ?? []).map((p) => `${p.purpose} ${p.account_id} ${p.amount_minor} ${p.currency}`).sort().join('; '),
          lines: added.map((l) => `${l.kind} ${l.amount_minor}`).sort().join('; '),
        }
      }

      try {
        payee = await save(name, '66554433', `the owner saves ${name}`)
        await save(shared, '66554434', `the owner saves ${shared}`)
        await save(shared, '66554435', `the owner saves a second payee called ${shared}`)

        // 3. Paid by its id, then by its name in other case and spacing: the same payee, the same entry, the same statement lines.
        const start = await holds('the GBP account before any payment')
        if (start !== FUND_MINOR) return fail(`given ${gbp(FUND_MINOR)} of test money, the company's GBP account holds ${gbp(start)}`)
        const beforeID = await lines('the statement before the payment by id')
        const byID = await paid(await pay({ payee_id: payee }, `the owner pays ${name} ${gbp(PAY_MINOR)} by its payee_id`), beforeID, 'by id')
        if (typeof byID === 'string') return fail(byID)
        const spoken = `  ${name.toLowerCase().split(' ').join('   ')} `
        const beforeName = await lines('the statement before the payment by name')
        const byName = await paid(await pay({ payee_name: spoken }, `the owner pays "${spoken}" ${gbp(PAY_MINOR)} by name`), beforeName, 'by name')
        if (typeof byName === 'string') return fail(byName)
        if (byID.lines === '' || byID.postings === '') return fail(`the payment by id left no ledger to compare: entry [${byID.postings}], statement lines [${byID.lines}]`)
        if (byName.postings !== byID.postings) return fail(`paid by name, the entry's postings are [${byName.postings}]; paid by id they are [${byID.postings}]: they must be the same`)
        if (byName.lines !== byID.lines) return fail(`paid by name, the statement gained [${byName.lines}]; paid by id it gained [${byID.lines}]: they must be the same`)
        const twice = await holds('the GBP account after both payments')
        if (twice !== start - 2 * PAY_MINOR) return fail(`two payments of ${gbp(PAY_MINOR)} must take ${gbp(2 * PAY_MINOR)}: ${gbp(start)} → ${gbp(twice)}`)

        // 4. A part of the name, and the name two payees share: refused, and nothing moves.
        const linesBefore = (await lines('the statement before the refused payments')).length
        const paymentsBefore = (await payments('the payments before the refused ones')).length
        const part = name.split(' ').slice(0, 3).join(' ')
        const partly = await pay({ payee_name: part }, `the owner pays "${part}", a part of a payee's name`)
        if (partly.status !== 404) return fail(`paying "${part}", a part of ${name}, must be refused 404; Lens answered ${said(partly)}`)
        const both = await pay({ payee_name: shared }, `the owner pays ${shared}, a name two payees share`)
        if (both.status !== 409) return fail(`paying ${shared}, a name two saved payees share, must be refused 409; Lens answered ${said(both)}`)
        const end = await holds('the GBP account after the refused payments')
        const linesAfter = (await lines('the statement after the refused payments')).length
        const paymentsAfter = (await payments('the payments after the refused ones')).length
        if (end !== twice || linesAfter !== linesBefore || paymentsAfter !== paymentsBefore) {
          return fail(`the refused payments by name moved something: the account ${gbp(twice)} → ${gbp(end)}, statement lines ${linesBefore} → ${linesAfter}, payments ${paymentsBefore} → ${paymentsAfter}`)
        }
        return {
          pass: true,
          detail: `${gbp(PAY_MINOR)} to ${name} by its id and by "${spoken}" each completed to ${payee} with the same entry [${byID.postings}] and statement lines ` +
            `[${byID.lines}], the account ${gbp(start)} → ${gbp(twice)}; "${part}" was refused 404 and ${shared} 409, nothing moved`,
        }
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e))
      }
    },
  }
}
