// B41.11 — new-payee cooling-off (Lens B41.111), once a run, on a workspace of its own. On Lens's API the owner opens the
// company's GBP account, puts £3,000.00 of test money in it and saves a payee: it reads cooling off for 24 hours from when it
// was saved. A £2,000.00 payment to it is refused naming the wait, and nothing moves: no payment to it is listed and the
// account still holds £3,000.00. Through the web app's own BFF calls the owner registers a passkey; "I called them" with no
// signature is refused and the payee still cools off; signed over its challenge, the cooling-off ends, and the same £2,000.00
// pays once: the payment listed on its way or completed and the account £2,000.00 down.

import { randomBytes } from 'node:crypto'
import { fail } from './bank.ts'
import { RUN_SALT } from './oracles.ts'
import { softPasskey } from './payees.ts'
import type { Scenario } from './scenarios.ts'
import { type Post, throughApp } from './security.ts'
import { call, said } from './settings.ts'

const FUND_MINOR = 300_000
const PAY_MINOR = 200_000
const DAY_MS = 86_400_000

interface Payee { id: string; name: string; created_at: string; cooling_off_until?: string; called_at?: string }
interface Account { id: string; test_minor: number }
interface Payment { id: string; payee_id: string; amount_minor: number; status: string }

export function payeeCoolingOff(post: Post = throughApp): Scenario {
  return {
    id: 'payee-cooling-off',
    owner: 'talyvor-suite',
    own: true,
    items: ['B41.11'],
    feature: 'Agent wallets',
    title: 'a £2,000.00 first payment to a payee saved moments ago is refused for its 24-hour cooling-off and nothing moves; "I called ' +
      'them" unsigned is refused, signed with a passkey it ends the wait and the payment lands once: the payment and the account',
    run: async (ctx) => {
      const step = async <T>(method: string, path: string, body: unknown, note: string) => {
        const r = await call<T>(ctx, method, path, body)
        ctx.evidence.push({ note, answer: said(r) })
        return r
      }
      const bff = async <T>(path: string, body: unknown, note: string): Promise<{ status: number; value: T }> => {
        const { status, text } = await post(ctx, path, body)
        ctx.evidence.push({ note, answer: `${status} ${text.slice(0, 300)}` })
        let value = {} as T
        try { value = JSON.parse(text) as T } catch { /* a refusal's body is shown in the evidence */ }
        return { status, value }
      }
      const key = () => `e2e-${randomBytes(8).toString('hex')}`

      // A funded company GBP account and a payee saved now.
      const terms = await step<{ terms: { capability: string; version: number; accepted?: unknown }[] | null }>('GET', '/v1/workspaces/{ws}/terms', undefined, 'the owner reads the terms')
      for (const t of (terms.value?.terms ?? []).filter((x) => ['currency_accounts', 'payments_in', 'payments_out'].includes(x.capability) && x.accepted == null)) {
        const ok = await step('POST', `/v1/workspaces/{ws}/terms/${t.capability}/accept`, { version: t.version }, `the owner accepts ${t.capability}'s terms`)
        if (ok.status !== 201) return fail(`accepting ${t.capability}'s terms answered ${said(ok)}`)
      }
      const opened = await step<Account>('POST', '/v1/money/accounts', { currency: 'GBP' }, 'the company GBP account')
      if (opened.status !== 201 || opened.value === undefined) return fail(`opening the company GBP account answered ${said(opened)}`)
      const acct = opened.value.id
      const funded = await step('POST', `/v1/money/accounts/${acct}/test-money`, { amount_minor: FUND_MINOR, idempotency_key: key() }, 'GBP 3,000.00 of test money in it')
      if (funded.status !== 201) return fail(`putting test money in the company GBP account answered ${said(funded)}`)
      const supplier = `Nightly Cooling Joinery ${RUN_SALT}`
      const saved = await step<Payee>('POST', '/v1/money/payees', { name: supplier, country: 'GB', sort_code: '040004', account_number: '24681357' }, `the payee ${supplier}, saved now`)
      if (saved.status !== 201 || saved.value === undefined) return fail(`saving ${supplier} answered ${said(saved)}`)
      const payee = saved.value
      const until = Date.parse(payee.cooling_off_until ?? '') - Date.parse(payee.created_at)
      if (Math.abs(until - DAY_MS) > 60_000) return fail(`${supplier}, saved now, must cool off for 24 hours from when it was saved; Lens answered cooling_off_until ${payee.cooling_off_until ?? 'absent'}`)

      const ledger = async (note: string) => {
        const a = await step<{ accounts: Account[] | null }>('GET', '/v1/money/accounts', undefined, `the account ${note}`)
        const p = await step<{ payments: Payment[] | null }>('GET', '/v1/money/payments', undefined, `the payments ${note}`)
        return { holds: (a.value?.accounts ?? []).find((x) => x.id === acct)?.test_minor, paid: (p.value?.payments ?? []).filter((x) => x.payee_id === payee.id) }
      }
      const pay = (note: string) => step<Payment>('POST', '/v1/money/payments', { account_id: acct, payee_id: payee.id, amount_minor: PAY_MINOR, currency: 'GBP',
        reference: `Cooling ${RUN_SALT}`, idempotency_key: key() }, note)

      // £2,000.00 now: refused for the cooling-off, and nothing moves.
      const early = await pay(`GBP 2,000.00 to ${supplier}, saved moments ago`)
      if (early.status !== 409 || !/24 hours/.test(early.error)) return fail(`a GBP 2,000.00 payment to a payee saved moments ago must be refused 409 for its cooling-off; Lens answered ${said(early)}`)
      const held = await ledger('after the refused payment')
      if (held.holds !== FUND_MINOR || held.paid.length > 0) {
        return fail(`after the refused payment the account holds ${held.holds} minor and ${held.paid.length} payments to ${supplier} are listed, not ${FUND_MINOR} and none`)
      }

      // "I called them": unsigned, refused; signed with the owner's passkey, the cooling-off ends.
      const reg = await bff<{ challenge: string; rp_id: string }>('/api/agents/passkeys/challenge', {}, 'the owner asks to register a passkey')
      if (reg.status !== 200 || !reg.value.challenge) return fail(`the passkey challenge answered ${reg.status}`)
      const pk = softPasskey(reg.value.rp_id)
      const enrolled = await bff('/api/agents/passkeys', pk.register(reg.value.challenge, 'Nightly cooling-off'), 'the owner registers a passkey')
      if (enrolled.status !== 201) return fail(`registering the passkey answered ${enrolled.status}`)
      const unsigned = await bff<Payee>(`/api/money/payees/${payee.id}/called`, {}, `"I called ${supplier}", unsigned`)
      if (unsigned.status < 400 || unsigned.status >= 500) return fail(`"I called them" with no signature must be refused; it answered ${unsigned.status}`)
      const still = (await step<{ payees: Payee[] | null }>('GET', '/v1/money/payees', undefined, 'the payees after the unsigned call')).value?.payees?.find((p) => p.id === payee.id)
      if (!still?.cooling_off_until) return fail(`after an unsigned "I called them" ${supplier} no longer cools off`)
      const ch = await bff<{ challenge: string }>(`/api/money/payees/${payee.id}/called/challenge`, {}, `${supplier}'s "I called them" challenge`)
      if (ch.status !== 200 || !ch.value.challenge) return fail(`the "I called them" challenge answered ${ch.status}`)
      const signed = await bff<Payee>(`/api/money/payees/${payee.id}/called`, { assertion: pk.assert(ch.value.challenge) }, `"I called ${supplier}", signed`)
      if (signed.status !== 200 || !signed.value.called_at || signed.value.cooling_off_until) {
        return fail(`"I called them" signed with the passkey must end the cooling-off; it answered ${signed.status} called_at ${signed.value.called_at ?? 'absent'}, cooling_off_until ${signed.value.cooling_off_until ?? 'absent'}`)
      }

      // The same £2,000.00 now pays, once.
      const paid = await pay(`GBP 2,000.00 to ${supplier}, once the owner called them`)
      if (paid.status !== 201) return fail(`once the owner confirmed they called ${supplier}, the GBP 2,000.00 payment answered ${said(paid)}`)
      const after = await ledger('after the payment')
      const landed = after.paid.length === 1 && after.paid[0].amount_minor === PAY_MINOR && ['pending', 'sent', 'completed'].includes(after.paid[0].status)
      if (after.holds !== FUND_MINOR - PAY_MINOR || !landed) {
        return fail(`after the payment the account holds ${after.holds} minor and the payments to ${supplier} are ${JSON.stringify(after.paid.map((p) => [p.amount_minor, p.status]))}, ` +
          `not ${FUND_MINOR - PAY_MINOR} and one of ${PAY_MINOR} on its way or completed`)
      }
      return { pass: true, detail: `the GBP 2,000.00 payment to ${supplier}, saved moments ago, was refused for its 24-hour cooling-off and nothing moved; ` +
        `"I called them" unsigned was refused (${unsigned.status}); signed, the wait ended and the payment landed once, the account ${FUND_MINOR - PAY_MINOR} minor` }
    },
  }
}
