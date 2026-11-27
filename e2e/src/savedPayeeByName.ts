// B17.541 — saved payees paid by name through the web app (B28.76, the BFF side of Lens B28.346), once a run, on a workspace
// of its own. On Lens's API the owner opens the company's GBP account and puts £100.00 of test money in it; through the web
// app's own BFF calls they save two exact-match payees and register a passkey. £20.00 to the second payee by its payee_id,
// signed over its own challenge as web Pay sends it, completes; £20.00 to it by its name, in other case and spacing, signed
// the same way, completes to the same payee and writes the same ledger entry: the same postings on the same accounts and the
// same lines on the account's statement, the account down £40.00. Judged on the account's ledger.

import { randomBytes } from 'node:crypto'
import { fail } from './bank.ts'
import { RUN_SALT } from './oracles.ts'
import { softPasskey } from './payees.ts'
import type { Scenario } from './scenarios.ts'
import { type Post, throughApp } from './security.ts'
import { call, said } from './settings.ts'

const FUND_MINOR = 10_000
const PAY_MINOR = 2_000
const CAPABILITIES = ['currency_accounts', 'payments_in', 'payments_out']
const gbp = (minor: number): string => `£${(minor / 100).toFixed(2)}`

interface Payment { id: string; payee_id: string; amount_minor: number; status: string; error?: string }
interface Account { id: string; test_minor: number }
interface Line { entry_id?: string; kind?: string; amount_minor: number }
/** A payment's ledger entry as Lens answers it (economy.PaymentEntry, B30.147). */
interface Entry { entry_id: string; postings: { account_id: string; purpose: string; amount_minor: number; currency: string }[] | null }

export function savedPayeeByName(post: Post = throughApp): Scenario {
  return {
    id: 'pay-saved-payee-by-name',
    owner: 'talyvor-suite',
    own: true,
    feature: 'Agent Wallets',
    items: ['B28.76'],
    title: "a payee saved in the web app and paid there by its name, signed with the owner's passkey, completes to that payee and " +
      'writes the same ledger entry and statement lines as paying it by id',
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

      // 2. In the web app: two exact-match payees saved, and the owner's passkey.
      const name = `Nightly Saved By Name ${RUN_SALT} Ltd`
      const other = `Nightly Saved Other ${RUN_SALT} Ltd`
      const save = async (payeeName: string, number: string) => {
        const r = await bff<{ id?: string; needs_confirmation?: boolean; error?: string }>('/api/money/payees',
          { name: payeeName, country: 'GB', sort_code: '040004', account_number: number }, `the owner saves ${payeeName} in the web app`)
        if (r.status !== 201 || !r.value.id) return `saving the payee ${payeeName} in the web app must answer 201; it answered ${r.status} ${r.text.slice(0, 200)}`
        if (r.value.needs_confirmation) return `a payee whose name matches its account must not wait for confirmation; it was saved ${r.text.slice(0, 200)}`
        return { id: r.value.id }
      }
      const decoy = await save(other, '66554436')
      if (typeof decoy === 'string') return fail(decoy)
      const saved = await save(name, '66554437')
      if (typeof saved === 'string') return fail(saved)
      const payee = saved.id
      const reg = await bff<{ challenge: string; rp_id: string }>('/api/agents/passkeys/challenge', {}, 'the owner asks to register a passkey')
      if (reg.status !== 200 || !reg.value.challenge) return fail(`the passkey challenge answered ${reg.status} ${reg.text.slice(0, 200)}`)
      const pk = softPasskey(reg.value.rp_id)
      const enrolled = await bff('/api/agents/passkeys', pk.register(reg.value.challenge, 'Nightly saved payee by name'), 'the owner registers a passkey')
      if (enrolled.status !== 201) return fail(`registering the passkey answered ${enrolled.status} ${enrolled.text.slice(0, 200)}`)

      const holds = async (note: string): Promise<number | undefined> => {
        const r = await step<{ accounts: Account[] | null }>('GET', '/v1/money/accounts', undefined, note)
        return (r.value?.accounts ?? []).find((x) => x.id === account)?.test_minor
      }
      const lines = async (note: string): Promise<Line[]> => {
        const r = await step<{ lines: Line[] | null }>('GET', `/v1/money/accounts/${account}/statement`, undefined, note)
        return r.value?.lines ?? []
      }
      // B54.35: the workspace has a passkey, so each payment is signed over its own challenge, as web Pay sends it.
      const pay = async (to: object, note: string) => {
        const body = { ...to, account_id: account, amount_minor: PAY_MINOR, currency: 'GBP', reference: `By name ${RUN_SALT}`, idempotency_key: key() }
        const ch = await bff<{ challenge?: string }>('/api/money/payments/challenge', body, `${note}: its challenge`)
        return bff<Payment>('/api/money/payments', { ...body, assertion: pk.assert(ch.value.challenge ?? '') }, note)
      }
      // paid is a completed payment's entry and the statement lines it added: each as "purpose account amount currency" and "kind amount".
      const paid = async (how: string, to: object): Promise<{ postings: string; lines: string } | string> => {
        const before = await lines(`the statement before the payment ${how}`)
        const r = await pay(to, `the owner pays ${name} ${gbp(PAY_MINOR)} ${how} in the web app`)
        if (r.status !== 201 || r.value.status !== 'completed') return `${gbp(PAY_MINOR)} paid to ${name} ${how} in the web app must answer 201 completed; it answered ${r.status} ${r.text.slice(0, 200)}`
        if (r.value.payee_id !== payee) return `${gbp(PAY_MINOR)} paid to ${name} ${how} went to payee ${r.value.payee_id}, not ${payee}`
        const e = await step<Entry>('GET', `/v1/money/payments/${r.value.id}/entry`, undefined, `the owner reads the entry of the payment ${how}`)
        if (e.status !== 200 || e.value === undefined) return `the entry of the payment ${how} answered ${said(e)}`
        const after = await lines(`the statement after the payment ${how}`)
        const added = after.filter((l) => !before.some((b) => b.entry_id === l.entry_id && b.kind === l.kind && b.amount_minor === l.amount_minor))
        return {
          postings: (e.value.postings ?? []).map((p) => `${p.purpose} ${p.account_id} ${p.amount_minor} ${p.currency}`).sort().join('; '),
          lines: added.map((l) => `${l.kind} ${l.amount_minor}`).sort().join('; '),
        }
      }

      // 3. Paid by its id, then by its name in other case and spacing: the same payee, the same entry, the same statement lines.
      const start = await holds('the GBP account before any payment')
      if (start !== FUND_MINOR) return fail(`given ${gbp(FUND_MINOR)} of test money, the company's GBP account holds ${start === undefined ? 'nothing' : gbp(start)}`)
      const byID = await paid('by its payee_id', { payee_id: payee })
      if (typeof byID === 'string') return fail(byID)
      const spoken = `  ${name.toUpperCase().split(' ').join('  ')} `
      const byName = await paid(`by the name "${spoken}"`, { payee_name: spoken })
      if (typeof byName === 'string') return fail(byName)
      if (byID.lines === '' || byID.postings === '') return fail(`the payment by id left no ledger to compare: entry [${byID.postings}], statement lines [${byID.lines}]`)
      if (byName.postings !== byID.postings) return fail(`paid by name, the entry's postings are [${byName.postings}]; paid by id they are [${byID.postings}]: they must be the same`)
      if (byName.lines !== byID.lines) return fail(`paid by name, the statement gained [${byName.lines}]; paid by id it gained [${byID.lines}]: they must be the same`)
      const end = await holds('the GBP account after both payments')
      if (end !== start - 2 * PAY_MINOR) return fail(`two payments of ${gbp(PAY_MINOR)} must take ${gbp(2 * PAY_MINOR)}: ${gbp(start)} → ${end === undefined ? 'nothing' : gbp(end)}`)
      return {
        pass: true,
        detail: `${gbp(PAY_MINOR)} to ${name}, saved in the web app, by its id and by "${spoken}", each signed with the passkey, completed to ${payee} ` +
          `with the same entry [${byID.postings}] and statement lines [${byID.lines}], the account ${gbp(start)} → ${gbp(end)}`,
      }
    },
  }
}
