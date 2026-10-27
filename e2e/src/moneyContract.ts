// B46.12 — the money layer's contract, end to end on the sandbox adapter (Lens B46.4, B46.8), on Lens's API, once a run, on a
// workspace of its own.
//
// A new agent has a wallet: Lens answers it with its account, holding nothing. The owner puts test money in the agent's GBP
// account (an invoice from it, paid by card, as batch-approval-pays-once does) and signs a mandate letting the agent's own key
// pay one saved payee up to £15.00 a payment. £20.00 prepared by that key waits for approval on limits.per_payment, and nothing
// moves. Approved once with the owner's passkey it is exactly one payment out and the account is down by £20.00; the same approval
// again answers 409 and moves nothing. £20.13, which the sandbox's partner refuses (minor units ending in 13), approved the same
// way leaves nothing half-done: no payment of it is anything but failed, and the account holds what it held before.

import { randomBytes } from 'node:crypto'
import { fail } from './bank.ts'
import type { Answered } from './lens.ts'
import { RUN_SALT } from './oracles.ts'
import { softPasskey } from './payees.ts'
import { payInvoiceByCard } from './payScreen.ts'
import { said } from './routes.ts'
import type { Scenario, ScenarioCtx } from './scenarios.ts'

interface Account { id: string; test_minor: number }
interface Payment { id: string; amount_minor: number; currency: string; reference: string; status: string }
interface Item { position: number; decision: string; rule?: string; payment_id?: string; pay_status?: string }
interface Request { id: string; status: string; items: Item[] | null }
interface Wallet { account_id: string; asset: string; balance_minor: number; mode: string }

const CAPABILITIES = ['currency_accounts', 'payments_in', 'payments_out']
const FUND_MINOR = 5_000
const LIMIT_MINOR = 1_500
const OVER_MINOR = 2_000
/** The sandbox's partner refuses an amount whose minor units end in 13 (Lens internal/money/sandbox.go). */
const REFUSED_MINOR = 2_013

export function moneyLayerContract(fund: (ctx: ScenarioCtx, token: string) => Promise<string | undefined> = payInvoiceByCard): Scenario {
  return {
    id: 'money-layer-contract',
    owner: 'talyvor-lens',
    own: true,
    agents: 1,
    feature: 'Agent Wallets',
    items: ['B46.12'],
    title: "the money layer on the sandbox: a new agent has a wallet; £20.00 over its £15.00 mandate waits for approval with nothing moved; " +
      'approved once it is one payment out, the account down by £20.00, and the replay 409 moves nothing; a payment the partner refuses ' +
      'leaves nothing half-done',
    run: async (ctx) => {
      const { lens } = ctx.env
      const user = ctx.app.user
      const call = async <T>(method: string, path: string, body: object | undefined, note: string): Promise<Answered<T>> => {
        const got = await lens.act<T>(user, method, path, body)
        ctx.evidence.push({ note, answer: said(got) })
        return got
      }

      const terms = await call<{ terms: { capability: string; version: number; accepted?: unknown }[] | null }>('GET', '/v1/workspaces/{ws}/terms', undefined, 'the owner reads the terms')
      if (!terms.ok) return fail(`reading the workspace's terms answered ${said(terms)}`)
      for (const t of (terms.value.terms ?? []).filter((x) => CAPABILITIES.includes(x.capability) && x.accepted == null)) {
        const ok = await call('POST', `/v1/workspaces/{ws}/terms/${t.capability}/accept`, { version: t.version }, `the owner accepts ${t.capability}'s terms`)
        if (ok.status !== 201) return fail(`accepting ${t.capability}'s terms answered ${said(ok)}`)
      }
      const company = await call<Account>('POST', '/v1/money/accounts', { currency: 'GBP' }, "the owner opens the company's GBP account")
      if (company.status !== 201 || !company.ok) return fail(`opening the company's GBP account must answer 201; Lens answered ${said(company)}`)

      // 1. A new agent gets a wallet.
      const agent = await lens.createAgent(user, `Contract payer ${RUN_SALT}`)
      const wallet = await call<Wallet>('GET', `/v1/workspaces/{ws}/agents/${agent.id}/wallet`, undefined, "the new agent's wallet")
      if (wallet.status !== 200 || !wallet.ok) return fail(`a new agent's wallet must answer 200; Lens answered ${said(wallet)}`)
      const w = wallet.value
      if (!w.account_id || w.balance_minor !== 0 || !['TEST', 'LIVE'].includes(w.mode)) {
        return fail(`a new agent's wallet must have an account, hold nothing and say TEST or LIVE; Lens answered ${JSON.stringify(w)}`)
      }

      // The agent's GBP account, funded by card.
      const opened = await call<Account>('POST', '/v1/money/accounts', { currency: 'GBP', agent_id: agent.id }, `the owner opens ${agent.name}'s GBP account`)
      if (opened.status !== 201 || !opened.ok) return fail(`opening the agent's GBP account must answer 201; Lens answered ${said(opened)}`)
      const acct = opened.value.id
      const money = async (note: string) => {
        const accounts = await call<{ accounts: Account[] | null }>('GET', '/v1/money/accounts', undefined, `${note}: the accounts`)
        const payments = await call<{ payments: Payment[] | null }>('GET', '/v1/money/payments', undefined, `${note}: the payments out`)
        if (!accounts.ok || !payments.ok) throw new Error(`reading the money ${note} answered ${said(accounts)} and ${said(payments)}`)
        return { held: (accounts.value.accounts ?? []).find((a) => a.id === acct)?.test_minor ?? -1, payments: payments.value.payments ?? [] }
      }
      const invoice = await call<{ pay_url?: string }>('POST', '/v1/money/invoices', {
        account_id: acct, customer_name: `Contract funding ${RUN_SALT}`, lines: [{ description: 'Funding', quantity: 1, unit_amount_minor: FUND_MINOR, vat_rate_bps: 0 }],
        due_date: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10), send: true,
      }, `the owner sends a ${FUND_MINOR} minor invoice from the agent's account, to fund it`)
      const token = /\/pay\/([A-Za-z0-9_-]+)/.exec(invoice.ok ? invoice.value.pay_url ?? '' : '')?.[1] ?? ''
      if (invoice.status !== 201 || token === '') return fail(`issuing the funding invoice answered ${said(invoice)}`)
      const unpaid = await fund(ctx, token)
      if (unpaid !== undefined) return fail(unpaid)

      // The owner's passkey, a payee, the agent's key, and a mandate letting that key pay the payee up to £15.00 a payment.
      const pk = await call<{ challenge: string; rp_id: string }>('POST', '/v1/workspaces/{ws}/agents/passkeys/challenge', {}, 'the owner asks to register a passkey')
      if (!pk.ok) return fail(`the passkey registration challenge was refused: ${said(pk)}`)
      const key = softPasskey(pk.value.rp_id)
      const reg = await call('POST', '/v1/workspaces/{ws}/agents/passkeys', key.register(pk.value.challenge, 'Nightly contract passkey'), 'the owner registers a P-256 passkey')
      if (reg.status !== 201) return fail(`registering a passkey must answer 201; Lens answered ${said(reg)}`)
      const saved = await call<{ id: string }>('POST', '/v1/money/payees', { name: 'Nightly Contract Joinery Ltd', country: 'GB', sort_code: '040004', account_number: '35792461' }, 'the owner saves a payee')
      if (saved.status !== 201 || !saved.ok) return fail(`saving a payee must answer 201; Lens answered ${said(saved)}`)
      const payee = saved.value.id
      const k = await lens.act<{ key: string; id: string }>(user, 'POST', `/v1/workspaces/{ws}/agents/${agent.id}/keys`, { name: 'money-contract' })
      if (!k.ok) return fail(`issuing ${agent.name} a key was refused: ${said(k)}`)
      const prep = await call<{ canonical: string; challenge: string }>('POST', '/v1/money/permission-mandates/prepare', {
        principal: { type: 'person', name: 'Nightly Person' }, agent_id: agent.id, clients: [`key:${k.value.id}`], scope: { payees: [payee], currencies: ['GBP'] },
        limits: { per_payment: { GBP: LIMIT_MINOR } }, new_payee: { policy: 'always_ask' }, expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      }, "the owner prepares a mandate: the agent's key may pay the payee up to £15.00 a payment")
      if (!prep.ok) return fail(`preparing the mandate must answer 200; Lens answered ${said(prep)}`)
      const signed = await call<{ status: string }>('POST', '/v1/money/permission-mandates', { canonical: prep.value.canonical, assertion: key.assert(prep.value.challenge) }, 'the owner signs the mandate')
      if (signed.status !== 201 || !signed.ok || signed.value.status !== 'active') return fail(`the signed mandate must answer 201 active; Lens answered ${said(signed)}`)

      const prepare = async (minor: number) => {
        const run = randomBytes(3).toString('hex')
        const reference = `CONTRACT-${minor} ${run}`
        const r = await lens.as(k.value.key, 'POST', '/v1/money/payment-requests', { items: [{ payee_id: payee, currency: 'GBP', amount_minor: minor, reference }] },
          { 'Idempotency-Key': `e2e-money-contract-${run}` })
        ctx.evidence.push({ note: `${agent.name}'s key prepares ${minor} minor to the payee`, answer: `${r.status} ${r.text.slice(0, 600)}` })
        const req = r.status === 201 ? JSON.parse(r.text) as Request : undefined
        const item = req?.items?.[0]
        const waits = req?.status === 'pending_approval' && item?.decision === 'needs_approval' && item.rule === 'limits.per_payment'
        return { reference, req: waits ? req : undefined, said: `${r.status} ${r.text.slice(0, 300)}` }
      }
      const approve = async (id: string, note: string) => {
        const toSign = await call<{ statement: string; challenge: string }>('POST', `/v1/money/payment-requests/${id}/approval`, { positions: [1] }, `${note}: the statement`)
        if (!toSign.ok) throw new Error(`the statement to approve must answer 200; Lens answered ${said(toSign)}`)
        const approval = { statement: toSign.value.statement, assertion: key.assert(toSign.value.challenge) }
        return { approval, approved: await call<Request>('POST', `/v1/money/payment-requests/${id}/approve`, approval, note) }
      }
      const of = (m: { payments: Payment[] }, reference: string) => m.payments.filter((p) => p.reference === reference)

      const wrong: string[] = []
      try {
        // 2. Over the limit: waits for approval, and nothing moves.
        const over = await prepare(OVER_MINOR)
        if (over.req === undefined) return fail(`£20.00 over the £15.00 mandate must answer 201 pending_approval, needing approval on limits.per_payment; Lens answered ${over.said}`)
        const before = await money('before the approval')
        if (before.held !== FUND_MINOR) return fail(`the funding invoice was paid by card, but the agent's GBP account holds ${before.held} minor, not ${FUND_MINOR}`)
        if (of(before, over.reference).length !== 0) return fail(`before approval the ledger already holds a payment of the £20.00: ${JSON.stringify(of(before, over.reference))}`)

        // 3. Approved once: exactly one payment out, and a replay moves nothing.
        const { approval, approved } = await approve(over.req.id, 'the owner approves the £20.00 with the passkey')
        if (approved.status !== 200 || !approved.ok || approved.value.status !== 'approved') return fail(`approving the £20.00 must answer 200 approved; Lens answered ${said(approved)}`)
        const paidID = approved.value.items?.[0]?.payment_id ?? ''
        const after = await money('after the approval')
        const paid = of(after, over.reference)
        if (paid.length !== 1 || paid[0].id !== paidID || paid[0].amount_minor !== OVER_MINOR || paid[0].currency !== 'GBP' || paid[0].status === 'failed') {
          wrong.push(`the approval must post exactly one ${OVER_MINOR} GBP payment, ${paidID || 'the item’s'}; Lens lists ${JSON.stringify(paid)}`)
        }
        if (after.held !== FUND_MINOR - OVER_MINOR) wrong.push(`the agent's account went from ${FUND_MINOR} to ${after.held} minor, not down by ${OVER_MINOR}`)
        const replay = await call('POST', `/v1/money/payment-requests/${over.req.id}/approve`, approval, 'the owner sends the same approval again')
        if (replay.status !== 409) wrong.push(`the replayed approval must answer 409; Lens answered ${said(replay)}`)
        const again = await money('after the replayed approval')
        if (again.payments.length !== after.payments.length || again.held !== after.held) {
          wrong.push(`the replayed approval moved money: ${after.payments.length} → ${again.payments.length} payments out, the account ${after.held} → ${again.held} minor`)
        }

        // 4. The partner refuses: nothing half-done.
        const refused = await prepare(REFUSED_MINOR)
        if (refused.req === undefined) return fail([...wrong, `£20.13 must answer 201 pending_approval on limits.per_payment; Lens answered ${refused.said}`].join('; '))
        await approve(refused.req.id, "the owner approves the £20.13 the sandbox's partner refuses")
        const last = await money('after the refused payment')
        const live = of(last, refused.reference).filter((p) => p.status !== 'failed')
        if (live.length > 0) wrong.push(`the refused £20.13 is half-done: ${JSON.stringify(live)}`)
        if (last.held !== again.held) wrong.push(`after the partner refused £20.13 the agent's account holds ${last.held} minor, not the ${again.held} it held before`)
        if (wrong.length > 0) return fail(wrong.join('; '))
        return {
          pass: true,
          detail: `${agent.name}'s wallet ${w.account_id} (${w.asset}, ${w.mode}) held 0; £20.00 waited on limits.per_payment, approved once it was payment ${paidID}, ` +
            `${FUND_MINOR} → ${after.held} minor, the replay 409 moved nothing; the refused £20.13 left ${of(last, refused.reference).length} failed payment(s) and the account at ${last.held}`,
        }
      } catch (e) {
        return fail([...wrong, (e as Error).message].join('; '))
      }
    },
  }
}
