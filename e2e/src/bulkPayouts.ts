// B30.136 — bulk payouts (Lens B30.21), on Lens's API, once a run, on a workspace of its own. The owner opens the company's GBP
// account and puts £1,000.00 of test money in it from the Test partner, saves three exact-match payees, and uploads a CSV of 50
// payouts (POST /v1/money/payouts, text/csv, the key as the Idempotency-Key header): 48 good ones, their amounts never ending 13,
// 14 or 15 (the Test partner's failed, returned and pending), one to a payee id that does not exist and one whose amount is "ten
// pounds". The batch must answer 48 valid and those two invalid with their reasons, and move nothing: the account's balance is
// where it was and its statement holds no payment out. Approved once, each valid row is paid: 48 payments out on the account's
// statement and its balance down by exactly the batch's total. Approved again, it pays nothing twice: still 48, the balance where
// the first approval left it.

import { randomBytes, randomUUID } from 'node:crypto'
import { fail } from './bank.ts'
import { RUN_SALT } from './oracles.ts'
import type { Scenario } from './scenarios.ts'
import { call, said } from './settings.ts'

const FUND_MINOR = 100_000
const GOOD_ROWS = 48
const CAPABILITIES = ['currency_accounts', 'payments_in', 'payments_out']
const gbp = (minor: number): string => `£${(minor / 100).toFixed(2)}`

/** A payout batch as Lens answers it (economy.PayoutBatch). */
interface Row { line: number; payee_id: string; amount_minor: number; currency: string; reference: string; status: string; payment_id?: string; detail?: string }
interface Batch { id: string; status: string; rows?: Row[] | null; rows_total: number; rows_valid: number; rows_invalid: number; totals_minor: Record<string, number> | null }
interface Account { id: string; test_minor: number }
interface Statement { lines: { entry_id?: string; line?: number; kind?: string; amount_minor: number }[] | null }

/** The 48 good rows' amounts: £10.00, £10.10, … £14.70 — every one ending 0, never 13, 14 or 15. */
export const goodAmountMinor = (n: number): number => 1_000 + 10 * n

export function bulkPayouts(): Scenario {
  return {
    id: 'bulk-payouts',
    owner: 'talyvor-lens',
    own: true,
    feature: 'Agent Wallets',
    items: ['B30.21', 'B30.136'],
    title: 'bulk payouts: a CSV of 50 payouts from the company\'s GBP account reads 48 valid and two invalid with their reasons — an ' +
      'unknown payee and an amount of "ten pounds" — and moves nothing; approved once, 48 payments out leave the account, its ' +
      'balance down by exactly the total; approved again, nothing is paid twice',
    run: async (ctx) => {
      const user = ctx.app.user
      const step = async <T>(method: string, path: string, body: unknown, note: string) => {
        const r = await call<T>(ctx, method, path, body)
        ctx.evidence.push({ note, answer: said(r) })
        return r
      }
      const key = () => `e2e-${randomBytes(8).toString('hex')}`

      // 1. The terms, and the company's GBP account with £1,000.00 of test money in it.
      const terms = await step<{ terms: { capability: string; version: number; accepted?: unknown }[] | null }>('GET', '/v1/workspaces/{ws}/terms', undefined, 'the owner reads the terms')
      for (const t of (terms.value?.terms ?? []).filter((x) => CAPABILITIES.includes(x.capability) && x.accepted == null)) {
        const ok = await step('POST', `/v1/workspaces/{ws}/terms/${t.capability}/accept`, { version: t.version }, `the owner accepts ${t.capability}'s terms`)
        if (ok.status !== 201) return fail(`accepting ${t.capability}'s terms answered ${said(ok)}`)
      }
      const company = await step<{ id: string }>('POST', '/v1/money/accounts', { currency: 'GBP' }, "the company's GBP account")
      if (company.status !== 201 || company.value === undefined) return fail(`opening the company's GBP account on test money must answer 201; Lens answered ${said(company)}`)
      const from = company.value.id
      const topped = await step('POST', `/v1/money/accounts/${from}/test-money`, { amount_minor: FUND_MINOR, idempotency_key: key() },
        `${gbp(FUND_MINOR)} of test money comes into the company's GBP account`)
      if (topped.status !== 201) return fail(`${gbp(FUND_MINOR)} of test money into the company's GBP account answered ${said(topped)}`)

      // 2. Three exact-match payees.
      const payees: string[] = []
      for (const [n, account] of ['11223301', '11223302', '11223303'].entries()) {
        const saved = await step<{ id: string; needs_confirmation?: boolean }>('POST', '/v1/money/payees', { name: `Nightly Payouts ${RUN_SALT} ${n + 1} Ltd`,
          country: 'GB', sort_code: '040004', account_number: account }, `the owner saves payee ${n + 1}`)
        if (saved.status !== 201 || saved.value === undefined) return fail(`saving payee ${n + 1} must answer 201; Lens answered ${said(saved)}`)
        if (saved.value.needs_confirmation) return fail(`a payee whose name matches its account must not wait for confirmation; Lens saved ${saved.text.slice(0, 200)}`)
        payees.push(saved.value.id)
      }

      const holds = async (note: string): Promise<number> => {
        const r = await step<{ accounts: Account[] | null }>('GET', '/v1/money/accounts', undefined, note)
        const a = (r.value?.accounts ?? []).find((x) => x.id === from)
        if (a === undefined) throw new Error(`the GBP account ${from} is not on the list: ${said(r)}`)
        return a.test_minor
      }
      const statement = async (note: string) => {
        const r = await step<Statement>('GET', `/v1/money/accounts/${from}/statement`, undefined, note)
        if (r.status !== 200 || r.value === undefined) throw new Error(`the statement of ${from} answered ${said(r)}`)
        return r.value.lines ?? []
      }

      try {
        const before = await holds("the company's account before the upload")
        if (before !== FUND_MINOR) return fail(`given ${gbp(FUND_MINOR)} of test money, the company's GBP account holds ${gbp(before)}`)
        const seen = new Set((await statement("the company's statement before the upload")).map((l) => `${l.entry_id}:${l.line}`))
        /** The payments out on the statement since the upload: Lens holds each one's amount off the account as it is made. */
        const paidOut = async (note: string) => (await statement(note)).filter((l) => !seen.has(`${l.entry_id}:${l.line}`) && /^payment_out/.test(l.kind ?? '') && l.amount_minor < 0)

        // 3. The CSV: 48 good rows across the three payees, an unknown payee at row 17 and "ten pounds" at row 34.
        const unknownRef = `Nightly ${RUN_SALT} unknown payee`
        const wordsRef = `Nightly ${RUN_SALT} ten pounds`
        const rows: string[] = []
        let total = 0
        for (let n = 0; n < GOOD_ROWS; n++) {
          if (n === 16) rows.push(`payee_${randomUUID()},12.00,GBP,${unknownRef}`)
          if (n === 32) rows.push(`${payees[0]},ten pounds,GBP,${wordsRef}`)
          const minor = goodAmountMinor(n)
          total += minor
          rows.push(`${payees[n % payees.length]},${(minor / 100).toFixed(2)},GBP,Nightly ${RUN_SALT} payout ${n + 1}`)
        }
        const csv = ['payee_id,amount,currency,reference', ...rows].join('\n') + '\n'
        const uploaded = await ctx.env.lens.asText(user.token, 'POST', '/v1/money/payouts?funding=test', csv, 'text/csv', { 'Idempotency-Key': key() })
        ctx.evidence.push({ note: `the owner uploads a CSV of ${rows.length} payouts`, answer: `${uploaded.status} ${uploaded.text.slice(0, 400)}` })
        let batch: Batch | undefined
        try {
          batch = uploaded.status === 201 ? JSON.parse(uploaded.text) as Batch : undefined
        } catch {
          batch = undefined
        }
        if (batch === undefined) return fail(`uploading a CSV of ${rows.length} payouts must answer 201 with the batch; Lens answered ${uploaded.status} ${uploaded.text.slice(0, 300)}`)
        const got = batch.rows ?? []
        const byRef = (ref: string) => got.find((r) => r.reference === ref)
        const unknown = byRef(unknownRef)
        const words = byRef(wordsRef)
        const wrong: string[] = []
        if (batch.status !== 'awaiting_approval') wrong.push(`it must await approval; it is ${batch.status}`)
        if (batch.rows_total !== 50 || batch.rows_valid !== GOOD_ROWS || batch.rows_invalid !== 2) {
          wrong.push(`it must count 50 rows, ${GOOD_ROWS} valid and 2 invalid; it counts ${batch.rows_total}, ${batch.rows_valid} and ${batch.rows_invalid}`)
        }
        if ((batch.totals_minor?.GBP ?? 0) !== total) wrong.push(`its total must be the good rows' ${gbp(total)}; it is ${JSON.stringify(batch.totals_minor)}`)
        if (unknown?.status !== 'invalid' || !/payee/i.test(unknown.detail ?? '')) wrong.push(`the row to an unknown payee must be invalid naming the payee; it reads ${JSON.stringify(unknown)}`)
        if (words?.status !== 'invalid' || !/ten pounds/.test(words.detail ?? '')) wrong.push(`the row of "ten pounds" must be invalid naming its amount; it reads ${JSON.stringify(words)}`)
        const valid = got.filter((r) => r.status === 'valid')
        if (valid.length !== GOOD_ROWS) wrong.push(`${GOOD_ROWS} rows must read valid; ${valid.length} do`)
        if (wrong.length > 0) return fail(`the uploaded batch is wrong: ${wrong.join('; ')}`)

        // 4. Nothing moved: the balance is where it was, and the statement holds no payment out.
        const afterUpload = await holds("the company's account after the upload")
        const earlyOut = await paidOut("the company's statement after the upload")
        if (afterUpload !== before || earlyOut.length !== 0) {
          return fail(`an upload awaiting approval moved money: the account ${gbp(before)} → ${gbp(afterUpload)}, with ${earlyOut.length} payments out on its statement`)
        }

        // 5. Approved once: each valid row paid, 48 payments out, the balance down by exactly the total.
        const approved = await step<Batch>('POST', `/v1/money/payouts/${batch.id}/approve`, {}, `the owner approves batch ${batch.id}`)
        if (approved.status !== 200 || approved.value === undefined) return fail(`the owner's approval of batch ${batch.id} must answer 200; Lens answered ${said(approved)}`)
        const paid = (approved.value.rows ?? []).filter((r) => r.payment_id !== undefined && r.payment_id !== '')
        if (paid.length !== GOOD_ROWS || new Set(paid.map((r) => r.payment_id)).size !== GOOD_ROWS) {
          return fail(`approved, each of the ${GOOD_ROWS} valid rows must be its own payment out; ${paid.length} rows name ${new Set(paid.map((r) => r.payment_id)).size} payments`)
        }
        const afterFirst = await holds("the company's account after the approval")
        const firstOut = await paidOut("the company's statement after the approval")
        const firstSum = firstOut.reduce((n, l) => n + l.amount_minor, 0)
        if (afterFirst !== before - total || firstOut.length !== GOOD_ROWS || firstSum !== -total) {
          return fail(`approved once, ${GOOD_ROWS} payments out of ${gbp(total)} in all must leave the account: ${gbp(before)} → ${gbp(afterFirst)}, ` +
            `with ${firstOut.length} payments out on its statement summing to ${gbp(-firstSum)}`)
        }

        // 6. Approved again: nothing is paid twice.
        const again = await step<Batch>('POST', `/v1/money/payouts/${batch.id}/approve`, {}, `the owner approves batch ${batch.id} again`)
        const afterAgain = await holds("the company's account after the second approval")
        const againOut = await paidOut("the company's statement after the second approval")
        if (afterAgain !== afterFirst || againOut.length !== GOOD_ROWS) {
          return fail(`approving batch ${batch.id} again paid rows twice: the account ${gbp(afterFirst)} → ${gbp(afterAgain)}, with ${againOut.length} payments out on its ` +
            `statement where the first approval left ${GOOD_ROWS} (the second approval answered ${said(again)})`)
        }
        return {
          pass: true,
          detail: `a CSV of 50 payouts read ${GOOD_ROWS} valid and 2 invalid — the unknown payee ("${unknown?.detail}") and "ten pounds" ("${words?.detail}") — ` +
            `and moved nothing; approved once, ${GOOD_ROWS} payments out took ${gbp(total)} from the company's account, ${gbp(before)} → ${gbp(afterFirst)}; ` +
            `approved again, still ${GOOD_ROWS} and ${gbp(afterAgain)}`,
        }
      } catch (e) {
        return fail((e as Error).message)
      }
    },
  }
}
