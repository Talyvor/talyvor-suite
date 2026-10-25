// B40.29 — one approval pays a two-item batch once, and its record verifies (Lens B40.5), on Lens's API, once a run, on a
// workspace of its own.
//
// The owner accepts the money terms, opens the company's GBP account and an agent's, and puts test money in the agent's the one
// way there is today: an invoice from it, paid by card on its pay page (as pay-screen does). They register a phone's device key
// (platform "test"; where Lens refuses that platform, as production does, a software passkey signs instead) and save two payees.
// The agent's own key prepares a two-item batch, both items needing approval; the owner signs one approval for both. Then exactly
// two payments out post, each its item's payee, amount and own reference, and the agent's account is down by their total; the
// same approval again answers 409 and moves nothing; and the request's record verifies — Lens says so, its hash chain recomputes
// here entry by entry, and it holds one provider_call entry for each payment.

import { createHash, randomBytes } from 'node:crypto'
import { fail } from './bank.ts'
import { softDevice } from './deviceKeyApproval.ts'
import type { Answered } from './lens.ts'
import { RUN_SALT } from './oracles.ts'
import { softPasskey } from './payees.ts'
import { payInvoiceByCard } from './payScreen.ts'
import { said } from './routes.ts'
import type { Scenario, ScenarioCtx } from './scenarios.ts'

interface Account { id: string; currency: string; test_minor: number; live_minor: number }
interface Payment { id: string; payee_id: string; amount_minor: number; currency: string; reference: string; status: string }
interface Item { position: number; decision: string; payment_id?: string; pay_status?: string; pay_detail?: string }
interface Request { id: string; status: string; items: Item[] | null }
interface Entry { seq: number; kind: string; body: string; prev_hash: string; hash: string }

const CAPABILITIES = ['currency_accounts', 'payments_in', 'payments_out']
/** £50.00 in by card; £12.00 and £8.00 out on one approval. */
const FUND_MINOR = 5_000
const AMOUNTS = [1_200, 800]
const PAYEES = ['Nightly Batch Joinery Ltd', 'Nightly Batch Glazing Ltd']

export function batchApproval(fund: (ctx: ScenarioCtx, token: string) => Promise<string | undefined> = payInvoiceByCard): Scenario {
  return {
    id: 'batch-approval-pays-once',
    owner: 'talyvor-lens',
    own: true,
    agents: 1,
    feature: 'Agent Wallets',
    items: ['B40.29'],
    title: "an agent's two-item batch approved once with the phone's device key pays exactly two payments out, each with its own reference, " +
      "from the agent's card-funded GBP account, down by their total; the approval replayed answers 409 and moves nothing; the record verifies",
    run: async (ctx) => {
      const { lens } = ctx.env
      const user = ctx.app.user
      const call = async <T>(method: string, path: string, body: object | undefined, note: string): Promise<Answered<T>> => {
        const got = await lens.act<T>(user, method, path, body)
        ctx.evidence.push({ note, answer: said(got) })
        return got
      }

      // The terms, the company's GBP account, an agent and its GBP account.
      const terms = await call<{ terms: { capability: string; version: number; accepted?: unknown }[] | null }>('GET', '/v1/workspaces/{ws}/terms', undefined, 'the owner reads the terms')
      if (!terms.ok) return fail(`reading the workspace's terms answered ${said(terms)}`)
      for (const t of (terms.value.terms ?? []).filter((x) => CAPABILITIES.includes(x.capability) && x.accepted == null)) {
        const ok = await call('POST', `/v1/workspaces/{ws}/terms/${t.capability}/accept`, { version: t.version }, `the owner accepts ${t.capability}'s terms`)
        if (ok.status !== 201) return fail(`accepting ${t.capability}'s terms answered ${said(ok)}`)
      }
      const company = await call<Account>('POST', '/v1/money/accounts', { currency: 'GBP' }, "the owner opens the company's GBP account")
      if (company.status !== 201 || !company.ok) return fail(`opening the company's GBP account must answer 201; Lens answered ${said(company)}`)
      const agent = await lens.createAgent(user, `Batch payer ${RUN_SALT}`)
      const opened = await call<Account>('POST', '/v1/money/accounts', { currency: 'GBP', agent_id: agent.id }, `the owner opens ${agent.name}'s GBP account`)
      if (opened.status !== 201 || !opened.ok) return fail(`opening the agent's GBP account must answer 201; Lens answered ${said(opened)}`)
      const acct = opened.value.id
      const money = async (note: string) => {
        const accounts = await call<{ accounts: Account[] | null }>('GET', '/v1/money/accounts', undefined, `${note}: the accounts`)
        const payments = await call<{ payments: Payment[] | null }>('GET', '/v1/money/payments', undefined, `${note}: the payments out`)
        if (!accounts.ok || !payments.ok) throw new Error(`reading the money ${note} answered ${said(accounts)} and ${said(payments)}`)
        return { held: (accounts.value.accounts ?? []).find((a) => a.id === acct)?.test_minor ?? -1, payments: payments.value.payments ?? [] }
      }

      // Test money in: an invoice from the agent's account, paid by card.
      const invoice = await call<{ pay_url?: string }>('POST', '/v1/money/invoices', {
        account_id: acct, customer_name: `Batch funding ${RUN_SALT}`, lines: [{ description: 'Funding', quantity: 1, unit_amount_minor: FUND_MINOR, vat_rate_bps: 0 }],
        due_date: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10), send: true,
      }, `the owner sends a ${FUND_MINOR} minor invoice from the agent's account, to fund it`)
      const token = /\/pay\/([A-Za-z0-9_-]+)/.exec(invoice.ok ? invoice.value.pay_url ?? '' : '')?.[1] ?? ''
      if (invoice.status !== 201 || token === '') return fail(`issuing the funding invoice answered ${said(invoice)}`)
      const unpaid = await fund(ctx, token)
      if (unpaid !== undefined) return fail(unpaid)

      // What signs: the phone's device key, or a passkey where Lens refuses the "test" platform.
      const ch = await call<{ challenge: string }>('POST', '/v1/money/devices/challenge', {}, 'the owner asks to register a device key')
      if (!ch.ok) return fail(`the device registration challenge was refused: ${said(ch)}`)
      const phone = softDevice()
      const reg = await call<{ id: string }>('POST', '/v1/money/devices', phone.register(ch.value.challenge, 'Nightly batch phone'), 'the owner registers a P-256 device key as platform "test"')
      let sign: (challenge: string) => object
      let signer: string
      if (reg.status === 201 && reg.ok) {
        const device = reg.value.id
        sign = (c) => phone.assert(device, c)
        signer = `device key ${device}`
      } else if (reg.status === 400 && !reg.ok && reg.error.includes('test device keys are not accepted')) {
        const pk = await call<{ challenge: string; rp_id: string }>('POST', '/v1/workspaces/{ws}/agents/passkeys/challenge', {}, 'the owner asks to register a passkey instead')
        if (!pk.ok) return fail(`the passkey registration challenge was refused: ${said(pk)}`)
        const key = softPasskey(pk.value.rp_id)
        const made = await call('POST', '/v1/workspaces/{ws}/agents/passkeys', key.register(pk.value.challenge, 'Nightly batch passkey'), 'the owner registers a P-256 passkey')
        if (made.status !== 201) return fail(`registering a passkey must answer 201; Lens answered ${said(made)}`)
        sign = (c) => key.assert(c)
        signer = 'a passkey (this Lens refuses the "test" device platform)'
      } else {
        return fail(`registering a test device key must answer 201; Lens answered ${said(reg)}`)
      }

      // Two saved payees, and the agent's own key preparing a batch for both.
      const payees: string[] = []
      for (const name of PAYEES) {
        const p = await call<{ id: string }>('POST', '/v1/money/payees', { name, country: 'GB', sort_code: '040004', account_number: `3579246${payees.length}` }, `the owner saves ${name}`)
        if (p.status !== 201 || !p.ok) return fail(`saving ${name} must answer 201; Lens answered ${said(p)}`)
        payees.push(p.value.id)
      }
      const k = await lens.act<{ key: string }>(user, 'POST', `/v1/workspaces/{ws}/agents/${agent.id}/keys`, { name: 'batch-approval' })
      if (!k.ok) return fail(`issuing ${agent.name} a key was refused: ${said(k)}`)
      const run = randomBytes(3).toString('hex')
      const items = AMOUNTS.map((amount_minor, i) => ({ payee_id: payees[i], currency: 'GBP', amount_minor, reference: `BATCH-${i + 1} ${run}` }))
      const total = AMOUNTS.reduce((s, a) => s + a, 0)
      const prep = await lens.as(k.value.key, 'POST', '/v1/money/payment-requests', { items }, { 'Idempotency-Key': `e2e-batch-approval-${run}` })
      ctx.evidence.push({ note: `${agent.name}'s key prepares £12.00 and £8.00 to the two payees`, answer: `${prep.status} ${prep.text.slice(0, 600)}` })
      const req = prep.status === 201 ? JSON.parse(prep.text) as Request : undefined
      if (req === undefined || req.status !== 'pending_approval' || (req.items ?? []).filter((it) => it.decision === 'needs_approval').length !== 2) {
        return fail(`the agent's two-item batch must answer 201 pending_approval with both items needing approval; Lens answered ${prep.status} ${prep.text.slice(0, 300)}`)
      }

      // One approval for both.
      const wrong: string[] = []
      let before: Awaited<ReturnType<typeof money>>
      let after: typeof before
      let again: typeof before
      let approval: { statement: string; assertion: object }
      try {
        before = await money('before the approval')
        if (before.held !== FUND_MINOR) return fail(`the funding invoice was paid by card, but the agent's GBP account holds ${before.held} minor of test money, not ${FUND_MINOR}`)
        const toSign = await call<{ statement: string; challenge: string }>('POST', `/v1/money/payment-requests/${req.id}/approval`, { positions: [1, 2] }, 'the owner asks for the statement approving both')
        if (!toSign.ok) return fail(`the statement to approve both must answer 200; Lens answered ${said(toSign)}`)
        const named = ((JSON.parse(toSign.value.statement) as { items?: { reference: string }[] }).items ?? []).map((it) => it.reference)
        if (JSON.stringify(named) !== JSON.stringify(items.map((it) => it.reference))) return fail(`the statement names ${JSON.stringify(named)}, not both payments`)
        approval = { statement: toSign.value.statement, assertion: sign(toSign.value.challenge) }
        const approved = await call<Request>('POST', `/v1/money/payment-requests/${req.id}/approve`, approval, `the owner approves both, signed with ${signer}`)
        if (approved.status !== 200 || !approved.ok || approved.value.status !== 'approved') return fail(`approving both must answer 200 approved; Lens answered ${said(approved)}`)
        const unpaidItems = (approved.value.items ?? []).filter((it) => (it.payment_id ?? '') === '')
        if (unpaidItems.length > 0) wrong.push(`after the approval ${unpaidItems.length} of 2 items have no payment: ${unpaidItems.map((it) => `item ${it.position} ${it.pay_status} "${it.pay_detail}"`).join('; ')}`)

        // The money: exactly the two payments, each its own, and the account down by their total.
        after = await money('after the approval')
        const fresh = after.payments.filter((p) => !before.payments.some((b) => b.id === p.id))
        for (const [i, it] of items.entries()) {
          const p = fresh.filter((x) => x.reference === it.reference)
          const paidID = (approved.value.items ?? []).find((x) => x.position === i + 1)?.payment_id
          if (p.length !== 1 || p[0].id !== paidID || p[0].payee_id !== it.payee_id || p[0].amount_minor !== it.amount_minor || p[0].currency !== 'GBP') {
            wrong.push(`Lens lists ${p.length} payments referenced "${it.reference}" (${JSON.stringify(p)}), not item ${i + 1}'s one payment ${paidID} of ${it.amount_minor} GBP to ${PAYEES[i]}`)
          }
        }
        if (fresh.length !== 2) wrong.push(`the approval posted ${fresh.length} payments out, not 2`)
        if (after.held !== before.held - total) wrong.push(`the agent's GBP account went from ${before.held} to ${after.held} minor of test money, not down by ${total}`)

        // The same approval again: refused, and nothing more moves.
        const replay = await call('POST', `/v1/money/payment-requests/${req.id}/approve`, approval, 'the owner sends the same approval again')
        if (replay.status !== 409) wrong.push(`the replayed approval must answer 409; Lens answered ${said(replay)}`)
        again = await money('after the replayed approval')
      } catch (e) {
        return fail((e as Error).message)
      }
      if (again.payments.length !== after.payments.length || again.held !== after.held) {
        wrong.push(`the replayed approval moved money: ${after.payments.length} → ${again.payments.length} payments out, the account ${after.held} → ${again.held} minor`)
      }

      // The record: Lens says it verifies, it recomputes here, and it names each payment once.
      const record = await call<{ entries: Entry[] | null; verified: boolean; broken: string }>('GET', `/v1/money/payment-requests/${req.id}/record`, undefined, "the owner exports the request's record")
      if (!record.ok) return fail([...wrong, `the record must answer 200; Lens answered ${said(record)}`].join('; '))
      const entries = record.value.entries ?? []
      if (!record.value.verified) wrong.push(`Lens says the record does not verify: ${record.value.broken}`)
      let prev = ''
      for (const [i, e] of entries.entries()) {
        const hash = createHash('sha256').update(`${prev}\n${e.seq}\n${e.kind}\n${e.body}`).digest('hex')
        if (e.seq !== i + 1 || e.prev_hash !== prev || e.hash !== hash) {
          wrong.push(`the record's entry ${i + 1} (${e.kind}, seq ${e.seq}) does not chain: prev_hash ${e.prev_hash}, hash ${e.hash}, recomputed ${hash}`)
          break
        }
        prev = e.hash
      }
      const calls = entries.filter((e) => e.kind === 'provider_call').map((e) => (JSON.parse(e.body) as { payment_id?: string }).payment_id ?? '')
      const paidIDs = after.payments.filter((p) => items.some((it) => it.reference === p.reference)).map((p) => p.id)
      if (calls.length !== 2 || paidIDs.some((id) => !calls.includes(id))) wrong.push(`the record's provider_call entries name ${JSON.stringify(calls)}, not the two payments ${JSON.stringify(paidIDs)}`)
      if (!entries.some((e) => e.kind === 'signature')) wrong.push(`the record has no signature entry: ${JSON.stringify(entries.map((e) => e.kind))}`)
      if (wrong.length > 0) return fail(wrong.join('; '))

      return {
        pass: true,
        detail: `request ${req.id} prepared by ${agent.name}'s key, approved once with ${signer}: two payments out (${items.map((it) => it.reference).join(', ')}) ` +
          `from its card-funded account, ${before.held} → ${after.held} minor; the replay answered 409 and moved nothing; the record's ${entries.length} entries verify`,
      }
    },
  }
}
