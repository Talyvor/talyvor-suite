// B41.12 — the bank-detail change lock (Lens B41.112), once a run, on a workspace of its own. On Lens's API the owner opens the
// company's GBP account, puts £3,000.00 of test money in it and saves a payee; through the web app's own BFF calls they
// register a passkey and sign "I called them", so its new-payee cooling-off is over, and £500.00 to it pays. Then the payee's
// account number is changed: with no passkey the change is refused and the payee keeps its old account; signed for other
// details than the ones sent it is refused too; signed over the new details it changes, the payee held for 24 hours with the
// notice to call them on a number the owner already knows. £500.00 to it now is refused naming the hold, and nothing moves:
// one payment to it is listed and the account still holds £2,500.00.

import { randomBytes } from 'node:crypto'
import { fail } from './bank.ts'
import { RUN_SALT } from './oracles.ts'
import { softPasskey } from './payees.ts'
import type { Scenario } from './scenarios.ts'
import { type Post, throughApp } from './security.ts'
import { call, said } from './settings.ts'

const FUND_MINOR = 300_000
const PAY_MINOR = 50_000
const DAY_MS = 86_400_000

interface Payee { id: string; name: string; account_number?: string; details_changed_at?: string; held_until?: string; notice?: string; cooling_off_until?: string }
interface Account { id: string; test_minor: number }
interface Payment { id: string; payee_id: string; amount_minor: number; status: string }

export function payeeDetailsLock(post: Post = throughApp): Scenario {
  return {
    id: 'payee-details-lock',
    owner: 'talyvor-suite',
    own: true,
    items: ['B41.12'],
    feature: 'Agent wallets',
    title: 'changing a payee\'s account number is refused without a passkey and with one signed for other details; signed, it ' +
      'changes and a payment to it within 24 hours is held and nothing moves: the payee, the payments and the account',
    run: async (ctx) => {
      const step = async <T>(method: string, path: string, body: unknown, note: string) => {
        const r = await call<T>(ctx, method, path, body)
        ctx.evidence.push({ note, answer: said(r) })
        return r
      }
      const bff = async <T>(path: string, body: unknown, note: string): Promise<{ status: number; value: T; text: string }> => {
        const { status, text } = await post(ctx, path, body)
        ctx.evidence.push({ note, answer: `${status} ${text.slice(0, 300)}` })
        let value = {} as T
        try { value = JSON.parse(text) as T } catch { /* a refusal's body is shown in the evidence */ }
        return { status, value, text }
      }
      const key = () => `e2e-${randomBytes(8).toString('hex')}`

      // A funded company GBP account and a payee whose cooling-off the owner ended.
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
      const supplier = `Nightly Details Joinery ${RUN_SALT}`
      const saved = await step<Payee>('POST', '/v1/money/payees', { name: supplier, country: 'GB', sort_code: '040004', account_number: '13572468' }, `the payee ${supplier}`)
      if (saved.status !== 201 || saved.value === undefined) return fail(`saving ${supplier} answered ${said(saved)}`)
      const payee = saved.value
      const reg = await bff<{ challenge: string; rp_id: string }>('/api/agents/passkeys/challenge', {}, 'the owner asks to register a passkey')
      if (reg.status !== 200 || !reg.value.challenge) return fail(`the passkey challenge answered ${reg.status}`)
      const pk = softPasskey(reg.value.rp_id)
      const enrolled = await bff('/api/agents/passkeys', pk.register(reg.value.challenge, 'Nightly details lock'), 'the owner registers a passkey')
      if (enrolled.status !== 201) return fail(`registering the passkey answered ${enrolled.status}`)
      if (payee.cooling_off_until) {
        const ch = await bff<{ challenge: string }>(`/api/money/payees/${payee.id}/called/challenge`, {}, `${supplier}'s "I called them" challenge`)
        const called = await bff(`/api/money/payees/${payee.id}/called`, { assertion: pk.assert(ch.value.challenge) }, `"I called ${supplier}", signed`)
        if (called.status !== 200) return fail(`ending ${supplier}'s cooling-off answered ${called.status}`)
      }

      const ledger = async (note: string) => {
        const a = await step<{ accounts: Account[] | null }>('GET', '/v1/money/accounts', undefined, `the account ${note}`)
        const p = await step<{ payments: Payment[] | null }>('GET', '/v1/money/payments', undefined, `the payments ${note}`)
        const y = await step<{ payees: Payee[] | null }>('GET', '/v1/money/payees', undefined, `the payees ${note}`)
        return { holds: (a.value?.accounts ?? []).find((x) => x.id === acct)?.test_minor, paid: (p.value?.payments ?? []).filter((x) => x.payee_id === payee.id),
          payee: (y.value?.payees ?? []).find((x) => x.id === payee.id) }
      }
      const pay = (note: string) => step<Payment>('POST', '/v1/money/payments', { account_id: acct, payee_id: payee.id, amount_minor: PAY_MINOR, currency: 'GBP',
        reference: `Details ${RUN_SALT}`, idempotency_key: key() }, note)

      const before = await pay(`GBP 500.00 to ${supplier}, before any change`)
      if (before.status !== 201) return fail(`GBP 500.00 to ${supplier} before any change answered ${said(before)}`)

      // The change: unsigned, refused; signed for other details, refused; signed for these, made and held.
      const details = { country: 'GB', sort_code: '400000', account_number: '86429753' }
      const unsigned = await bff(`/api/money/payees/${payee.id}/details`, details, `${supplier}'s new account number, unsigned`)
      if (unsigned.status < 400 || unsigned.status >= 500) return fail(`a change of ${supplier}'s account number with no passkey must be refused; it answered ${unsigned.status}`)
      const kept = await ledger('after the unsigned change')
      if (kept.payee?.account_number !== '13572468' || kept.payee.held_until) {
        return fail(`after a refused change ${supplier}'s account number is ${kept.payee?.account_number ?? 'absent'} and held_until ${kept.payee?.held_until ?? 'absent'}, not 13572468 and none`)
      }
      const other = await bff<{ challenge: string }>(`/api/money/payees/${payee.id}/details/challenge`, { ...details, account_number: '11112222' }, 'a challenge for other details')
      const swapped = await bff(`/api/money/payees/${payee.id}/details`, { ...details, assertion: pk.assert(other.value.challenge) }, 'the change, signed for other details')
      if (swapped.status !== 403) return fail(`a change signed for other details than the ones sent must be refused 403; it answered ${swapped.status}`)
      const ch = await bff<{ challenge: string; notice?: string }>(`/api/money/payees/${payee.id}/details/challenge`, details, `${supplier}'s details challenge`)
      if (ch.status !== 200 || !ch.value.challenge || !/a number you already know/.test(ch.value.notice ?? '')) {
        return fail(`the details challenge must answer 200 with the notice to call them on a number you already know; it answered ${ch.status} ${ch.text.slice(0, 200)}`)
      }
      const changed = await bff<Payee>(`/api/money/payees/${payee.id}/details`, { ...details, assertion: pk.assert(ch.value.challenge) }, `${supplier}'s new account number, signed`)
      // Timed by Lens's own clock: production's runs ahead of the runner's, so held_until reads a little over 24 hours on (B17.355).
      const changedAt = Date.parse(changed.value.details_changed_at ?? '')
      const heldFor = Date.parse(changed.value.held_until ?? '') - changedAt
      if (changed.status !== 200 || changed.value.account_number !== '86429753' || heldFor !== DAY_MS || !(Math.abs(changedAt - Date.now()) < 3_600_000) ||
        !/a number you already know/.test(changed.value.notice ?? '')) {
        return fail(`the change signed with the passkey must answer 200 with the new account, held_until 24 hours on and the notice; it answered ${changed.status} ${changed.text.slice(0, 300)}`)
      }

      // A payment within 24 hours of the change: held, and nothing moves.
      const during = await pay(`GBP 500.00 to ${supplier}, moments after its details changed`)
      if (during.status !== 409 || !/24 hours/.test(during.error)) return fail(`a payment to ${supplier} moments after its bank details changed must be refused 409 for the hold; Lens answered ${said(during)}`)
      const after = await ledger('after the held payment')
      if (after.holds !== FUND_MINOR - PAY_MINOR || after.paid.length !== 1) {
        return fail(`after the held payment the account holds ${after.holds} minor and ${after.paid.length} payments to ${supplier} are listed, not ${FUND_MINOR - PAY_MINOR} and one`)
      }
      return { pass: true, detail: `${supplier}'s account number change was refused unsigned (${unsigned.status}) and signed for other details (403); signed, it changed and ` +
        `a payment within 24 hours was held (409) and nothing moved, the account ${FUND_MINOR - PAY_MINOR} minor` }
    },
  }
}
