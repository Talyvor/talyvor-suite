// B30.130 — invoices and pay links (Lens B30.20), on Lens's API, once a run, on two workspaces of its own.
//
// One test company's agent issues an invoice from its GBP account — two lines, VAT on one — and sends it, so Lens answers
// its number, reference, pay token and pay link with the total. The pay page behind the link is read with no credential:
// the invoice sent with the total due, no notice, no transfer to the Test partner's details (they reach no bank, B49.1),
// and none of the issuer's ids or the token on it. Another company's agent, with a GBP
// account of its own holding nothing, pays it through the link and must be refused 409 for want of money; the invoice
// must still read sent with the total due and no payment, and neither agent's account may have moved.
//
// B56.28 — then the payer's company puts the total into its GBP account and gives it to its agent, and the agent pays
// the invoice, twice (a retry). Lens charges the issuer its fee for accepting the payment once (B56.21): the issuer's
// agent account's statement holds the payment in and exactly one acceptance_fee line of merchant_a2a_fee_bps of the
// total, as Lens states the rate (GET /v1/public/fees), the invoice reads paid with that fee_minor on its one payment,
// and the issuer's agent account holds the total less the fee, the payer's nothing.
//
// B30.133 — the payer's agent is funded through payments in (Lens B30.15): a payment of the total, signed as the money
// layer's sandbox signs its webhooks (LENS_MONEY_SANDBOX_WEBHOOK_SECRET), arrives at the payer company's account at the
// partner quoting the agent account's payment reference, and must land in the agent's account, not the company's. Without
// the secret the payer's company puts the total in with test money and gives it to its agent, and the detail says so.
//
// B30.134 — the payer's agent's rules judge its invoice payment as a payment out (Lens B30.131). Funded, it is held to a
// monthly limit of £100.00 in pounds (Lens B61.12 judges money from a pounds account on the rules' pounds limits) and
// paying the £145.00 invoice through the link is refused 403 naming the monthly limit; the invoice must still read sent
// with the total due and no payment, the issuer's agent account 0 and the payer's the total. Raised to £200.00, it pays.

import { createHmac, randomBytes } from 'node:crypto'
import { fail } from './bank.ts'
import { BPS, percent } from './fees.ts'
import type { Answered, SyntheticUser, WorkspaceTerms } from './lens.ts'
import { said } from './routes.ts'
import type { Scenario } from './scenarios.ts'

/** A currency account as Lens answers it (economy.CurrencyAccount). */
interface Account { id: string; agent_id?: string; currency: string; purpose: string; balance_minor: number; test_minor: number; live_minor: number
  partner_account_ref?: string }
/** An invoice as its issuer reads it (economy.Invoice); the pay page shows it without the issuer's ids. */
interface Invoice { id: string; workspace_id?: string; agent_id?: string; account_id?: string; number: string; reference: string; pay_token?: string; pay_url?: string
  currency: string; subtotal_minor: number; vat_minor: number; total_minor: number; paid_minor: number; due_minor: number; status: string; payments?: InvoicePayment[] | null }
/** One payment of an invoice (economy.InvoicePayment): fee_minor is Talyvor's fee for accepting it (B56.21). */
export interface InvoicePayment { entry_id: string; method: string; amount_minor: number; fee_minor: number; returned_minor: number }
/** One posting on an account's statement (economy.MoneyStatementLine). */
export interface StatementLine { entry_id: string; kind: string; amount_minor: number; funding: string }
/** The public pay page (GET /v1/pay/{token}). */
interface PayPage { notice?: string; card: boolean; transfer?: { details: unknown; mode: string; reference: string }; invoice: Invoice }

const TERMS = '/v1/workspaces/{ws}/terms'
const LINES = [
  { description: 'Nightly research run', quantity: 2, unit_amount_minor: 5000, vat_rate_bps: 2000 },
  { description: 'Nightly report', quantity: 1, unit_amount_minor: 2500, vat_rate_bps: 0 },
]
/** 2 × £50.00 net + 20% VAT, and £25.00 with none. */
const SUBTOTAL = 12_500
const VAT = 2000
const TOTAL = SUBTOTAL + VAT
/** An agent account's payment reference (talyvor-lens economy.paymentReference). */
const PAYMENT_REFERENCE = /TLV[0-9A-F]{12}/
/** B30.133 — the money layer sandbox's webhook (talyvor-lens money.ServeWebhook) and the header it is signed in. */
const SANDBOX_WEBHOOK = '/v1/money/webhooks/sandbox'
const SANDBOX_SIGNATURE = 'Talyvor-Sandbox-Signature'
/** B30.134 — the payer's agent's monthly limit in pence: under the invoice's total, then over it. */
const UNDER_MINOR = 10_000
const OVER_MINOR = 20_000

/** B30.133 — the Talyvor-Sandbox-Signature of `body` at `seconds`, as talyvor-lens money.SignSandbox makes it. */
export function signSandbox(secret: string, body: string, seconds = Math.floor(Date.now() / 1000)): string {
  return `t=${seconds},v1=${createHmac('sha256', secret).update(`${seconds}.${body}`).digest('hex')}`
}

/** Talyvor's fee for accepting a payment of `amountMinor` from an account at `bps`, as Lens charges it (economy.partOf):
 * to the nearest minor unit, a half up, and never more than the payment. */
export function acceptanceFeeOf(amountMinor: number, bps: number): number {
  return Math.min(Math.floor((amountMinor * bps + BPS / 2) / BPS), amountMinor)
}

/** B56.28 — what is wrong with an invoice of `total` paid once from another company's agent account, charged at `bps`:
 * the issuer's statement holds the payment in and exactly one acceptance_fee line of the fee (none if the fee is 0), the
 * invoice reads paid with one agent payment carrying that fee_minor, and the accounts hold the total less the fee and
 * nothing. Empty when all is right. */
export function acceptanceFeeFaults(o: { total: number; bps: number | undefined; invoice: Invoice | undefined; issuerLines: StatementLine[]
  issuerHolds: number | undefined; payerHolds: number | undefined }): string[] {
  if (o.bps === undefined) return ['Lens states no merchant_a2a_fee_bps in GET /v1/public/fees, so the fee for accepting a payment from an account cannot be judged']
  const fee = acceptanceFeeOf(o.total, o.bps)
  const faults: string[] = []
  const paidIn = o.issuerLines.filter((l) => l.kind === 'invoice_payment')
  if (paidIn.length !== 1 || paidIn[0].amount_minor !== o.total) {
    faults.push(`the issuer's agent account's statement holds one invoice_payment of +${o.total}; it holds ${JSON.stringify(paidIn)}`)
  }
  const fees = o.issuerLines.filter((l) => l.kind === 'acceptance_fee')
  const want = fee > 0 ? [-fee] : []
  if (JSON.stringify(fees.map((l) => l.amount_minor)) !== JSON.stringify(want)) {
    faults.push(`the issuer's agent account's statement holds ${fee > 0 ? `exactly one acceptance_fee line of -${fee} (${percent(o.bps)} of ${o.total})` : 'no acceptance_fee line (the fee is 0)'}; ` +
      `it holds ${fees.length === 0 ? 'none' : JSON.stringify(fees)}`)
  }
  if (fees.some((l) => l.funding !== 'test')) faults.push(`a Sandbox payment's fee is Sandbox money; it was ${JSON.stringify(fees.map((l) => l.funding))}`)
  const inv = o.invoice
  const payments = inv?.payments ?? []
  if (inv === undefined || inv.status !== 'paid' || inv.paid_minor !== o.total || inv.due_minor !== 0) {
    faults.push(`the invoice reads paid with ${o.total} paid and 0 due; it reads ${JSON.stringify(inv).slice(0, 300)}`)
  }
  if (payments.length !== 1 || payments[0].method !== 'agent' || payments[0].amount_minor !== o.total || payments[0].fee_minor !== fee) {
    faults.push(`the invoice shows one agent payment of ${o.total} with fee_minor ${fee}; it shows ${JSON.stringify(payments)}`)
  }
  if (o.issuerHolds !== o.total - fee) faults.push(`the issuer's agent account holds the total less the fee, ${o.total - fee}; it holds ${o.issuerHolds}`)
  if (o.payerHolds !== 0) faults.push(`the payer's agent account paid all it held and holds 0; it holds ${o.payerHolds}`)
  return faults
}

export function invoicePayLink(): Scenario {
  return {
    id: 'invoice-pay-link',
    owner: 'talyvor-lens',
    own: true,
    feature: 'Agent Wallets',
    items: ['B30.20', 'B56.21', 'B56.28', 'B30.133', 'B30.134'],
    title: 'invoices and pay links: an agent issues and sends a GBP invoice with VAT; its pay page reads with no credential, ' +
      "with no notice and no transfer to the Test partner's details, naming no issuer id; another company's unfunded agent is refused 409 and nothing moves; " +
      'funded through a payment in quoting its payment reference, it is refused 403 over its monthly limit and nothing moves; ' +
      'under a higher limit it pays, and the issuer is charged its fee for accepting the payment once, on its statement and on the payment',
    run: async (ctx) => {
      const { lens, fees } = ctx.env
      const [issuer, payer] = await lens.createUsers(2)
      const call = async <T>(user: SyntheticUser, method: string, path: string, body: object | undefined, note: string): Promise<Answered<T>> => {
        const got = await lens.act<T>(user, method, path, body)
        ctx.evidence.push({ note, answer: said(got) })
        return got
      }
      /** The company's GBP account, then one of its agents' under it: the agent, its account and the company's. */
      const openAgentAccount = async (user: SyntheticUser, who: string, agentName: string): Promise<{ agent: string; account: Account; company: Account } | string> => {
        const terms = await call<{ terms: WorkspaceTerms[] | null }>(user, 'GET', TERMS, undefined, `${who} reads the workspace's terms`)
        if (!terms.ok) return `reading ${who} workspace's terms was refused: ${said(terms)}`
        for (const t of terms.value.terms ?? []) {
          if (!['currency_accounts', 'account_details', 'payments_in'].includes(t.capability) || t.accepted != null) continue
          const accepted = await call(user, 'POST', `${TERMS}/${t.capability}/accept`, { version: t.version }, `${who} accepts version ${t.version} of ${t.capability}' terms`)
          if (accepted.status !== 201) return `accepting ${t.capability}' terms must answer 201; Lens answered ${said(accepted)}`
        }
        const company = await call<Account>(user, 'POST', '/v1/money/accounts', { currency: 'GBP' }, `${who} opens the company's GBP account on test money`)
        if (company.status !== 201 || !company.ok) return `opening a company GBP account must answer 201; Lens answered ${said(company)}`
        const agent = await lens.createAgent(user, agentName)
        ctx.evidence.push({ note: `${who} creates the agent ${agentName}`, answer: agent.id })
        const opened = await call<Account>(user, 'POST', '/v1/money/accounts', { currency: 'GBP', agent_id: agent.id }, `${who} opens the agent's GBP account`)
        if (opened.status !== 201 || !opened.ok) return `opening an agent's GBP account must answer 201; Lens answered ${said(opened)}`
        if (opened.value.purpose !== 'agent' || opened.value.agent_id !== agent.id || opened.value.test_minor !== 0) {
          return `an agent's account is purpose agent, the agent's own, holding 0; Lens opened ${JSON.stringify(opened.value)}`
        }
        return { agent: agent.id, account: opened.value, company: company.value }
      }

      // The issuer: its agent's account, its payment reference, and the invoice, sent.
      const issuing = await openAgentAccount(issuer, 'the issuer', 'Nightly invoicing agent')
      if (typeof issuing === 'string') return fail(issuing)
      const details = await call<{ payment_reference?: string; mode: string }>(issuer, 'GET', `/v1/money/accounts/${issuing.account.id}/details`, undefined,
        "the issuer reads the agent account's details")
      if (!details.ok) return fail(`reading the agent account's details was refused: ${said(details)}`)
      if (details.value.mode !== 'TEST' || !PAYMENT_REFERENCE.test(details.value.payment_reference ?? '')) {
        return fail(`an agent account's details are mode TEST with a TLV payment reference; Lens answered ${said(details)}`)
      }
      const due = new Date(Date.now() + 7 * 86_400e3).toISOString().slice(0, 10)
      const issued = await call<Invoice>(issuer, 'POST', '/v1/money/invoices', { account_id: issuing.account.id, customer_name: 'Nightly Payer Ltd',
        customer_email: 'payer@nightly.test', lines: LINES, due_date: due, send: true }, 'the issuer issues and sends an invoice from the agent\'s GBP account')
      if (issued.status !== 201 || !issued.ok) return fail(`issuing an invoice must answer 201; Lens answered ${said(issued)}`)
      const inv = issued.value
      if (inv.status !== 'sent' || inv.currency !== 'GBP' || inv.subtotal_minor !== SUBTOTAL || inv.vat_minor !== VAT || inv.total_minor !== TOTAL || inv.due_minor !== TOTAL) {
        return fail(`a sent GBP invoice of 2 × £50.00 at 20% VAT and £25.00 is sent, subtotal ${SUBTOTAL}, VAT ${VAT}, total and due ${TOTAL}; Lens issued ${said(issued)}`)
      }
      if (inv.number === '' || inv.reference === '' || (inv.pay_token ?? '') === '' || !(inv.pay_url ?? '').endsWith(`/pay/${inv.pay_token}`)) {
        return fail(`an invoice has a number, a reference, a pay token and a pay link ending /pay/<token>; Lens issued ${said(issued)}`)
      }
      const token = inv.pay_token ?? ''

      // The pay page, with no credential.
      const page = await lens.as('', 'GET', `/v1/pay/${token}`)
      ctx.evidence.push({ note: 'the pay link is opened with no credential', answer: `${page.status} ${page.text.slice(0, 400)}` })
      if (page.status !== 200) return fail(`the pay page must answer 200 to anyone with the link; Lens answered ${page.status}: ${page.text.slice(0, 200)}`)
      const pay = JSON.parse(page.text) as PayPage
      if (pay.notice !== undefined) return fail(`the pay page carries no notice (B49.1); it says ${JSON.stringify(pay.notice)}`)
      if (pay.invoice?.number !== inv.number || pay.invoice.status !== 'sent' || pay.invoice.due_minor !== TOTAL) {
        return fail(`the pay page shows invoice ${inv.number} sent with ${TOTAL} due; it shows ${JSON.stringify(pay.invoice).slice(0, 300)}`)
      }
      const leaked = ['workspace_id', 'agent_id', 'account_id', 'pay_token'].filter((k) => k in pay.invoice)
      if (leaked.length > 0) return fail(`the pay page must name none of the issuer's ids or the token; it carries ${leaked.join(', ')}`)
      // The Test partner's details reach no bank, so the page offers no transfer to them (B49.1).
      if (pay.transfer !== undefined) return fail(`the pay page offers no transfer to the Test partner's details; it offers ${JSON.stringify(pay.transfer)}`)

      // Another company's agent, holding nothing, pays through the link.
      const paying = await openAgentAccount(payer, 'the payer', 'Nightly paying agent')
      if (typeof paying === 'string') return fail(paying)
      const paid = await call<{ invoice: Invoice }>(payer, 'POST', `/v1/pay/${token}/agent`, { agent_id: paying.agent }, "the payer's agent pays the invoice from its empty GBP account")
      if (paid.status !== 409 || paid.ok) return fail(`paying an invoice from an account holding 0 must be refused 409; Lens answered ${said(paid)}`)
      if (!/hold/.test(paid.error)) return fail(`the refusal must say what the account holds; Lens said ${JSON.stringify(paid.error)}`)

      // Nothing moved: the invoice still sent and unpaid, the issuer's agent account at 0 and the payer's at what it held.
      const unmoved = async (refusal: string, payerHolds: number): Promise<string | undefined> => {
        const invoices = await call<{ invoices: Invoice[] | null }>(issuer, 'GET', '/v1/money/invoices', undefined, `the issuer lists its invoices after ${refusal}`)
        if (!invoices.ok) return `listing the issuer's invoices was refused: ${said(invoices)}`
        const after = (invoices.value.invoices ?? []).find((x) => x.id === inv.id)
        if (after === undefined || after.status !== 'sent' || after.paid_minor !== 0 || after.due_minor !== TOTAL || (after.payments ?? []).length !== 0) {
          return `after ${refusal} the invoice is still sent with ${TOTAL} due and no payment; it reads ${JSON.stringify(after).slice(0, 300)}`
        }
        for (const [user, who, account, holds] of [[issuer, 'the issuer', issuing.account, 0], [payer, 'the payer', paying.account, payerHolds]] as const) {
          const accounts = await call<{ accounts: Account[] | null }>(user, 'GET', '/v1/money/accounts', undefined, `${who} lists the accounts after ${refusal}`)
          if (!accounts.ok) return `listing ${who}'s accounts was refused: ${said(accounts)}`
          const a = (accounts.value.accounts ?? []).find((x) => x.id === account.id)
          if (a === undefined || a.test_minor !== holds || a.live_minor !== 0 || a.balance_minor !== holds) {
            return `after ${refusal}, ${who}'s agent account must still hold ${holds} test and 0 live; it reads ${JSON.stringify(a)}`
          }
        }
        return undefined
      }
      const unpaid = await unmoved('a refused payment', 0)
      if (unpaid !== undefined) return fail(unpaid)

      // B30.133 — the payer's agent is funded through payments in, quoting its payment reference; without the sandbox's
      // webhook secret, B56.28's way: the payer's company puts the total in and gives it to its agent.
      const secret = ctx.env.moneyWebhookSecret ?? ''
      let funded: string
      if (secret !== '') {
        const quoted = await call<{ payment_reference?: string }>(payer, 'GET', `/v1/money/accounts/${paying.account.id}/details`, undefined,
          "the payer reads its agent account's details")
        const reference = quoted.ok ? quoted.value.payment_reference ?? '' : ''
        if (!PAYMENT_REFERENCE.test(reference)) return fail(`the payer's agent account's details carry a TLV payment reference; Lens answered ${said(quoted)}`)
        const at = paying.company.partner_account_ref ?? ''
        if (at === '') return fail(`a company's GBP account names its account at the partner (partner_account_ref); Lens opened ${JSON.stringify(paying.company)}`)
        const id = randomBytes(8).toString('hex')
        const body = JSON.stringify({ id: `e2e-evt-${id}`, to: at, amount: { amount_minor: TOTAL, asset: 'GBP' }, partner_ref: `e2e-pay-${id}`,
          payer: 'Nightly Payer Ltd', reference: `Funding ${reference}` })
        const got = await lens.webhook(SANDBOX_WEBHOOK, body, signSandbox(secret, body), SANDBOX_SIGNATURE)
        ctx.evidence.push({ note: `a payment in of ${TOTAL} minor arrives at the payer company's account quoting its agent's payment reference`, answer: `${got.status} ${got.text}` })
        if (got.status !== 200) return fail(`a signed payment in to the payer company's account must answer 200; Lens answered ${got.status}: ${got.text}`)
        const accounts = await call<{ accounts: Account[] | null }>(payer, 'GET', '/v1/money/accounts', undefined, 'the payer lists the accounts once the payment is in')
        const list = accounts.ok ? accounts.value.accounts ?? [] : []
        const agentHolds = list.find((x) => x.id === paying.account.id)?.test_minor
        const companyHolds = list.find((x) => x.id === paying.company.id)?.test_minor
        if (agentHolds !== TOTAL || companyHolds !== 0) {
          return fail(`a payment in quoting an agent account's payment reference lands in that agent's account: the agent's must hold ${TOTAL} and the company's 0; ` +
            `they hold ${agentHolds} and ${companyHolds}`)
        }
        funded = `funded with £145.00 through a payment in quoting its payment reference`
      } else {
        const topped = await call(payer, 'POST', `/v1/money/accounts/${paying.company.id}/test-money`, { amount_minor: TOTAL, idempotency_key: `e2e-${randomBytes(8).toString('hex')}` },
          `the payer puts ${TOTAL} minor of Sandbox money in the company's GBP account`)
        if (topped.status !== 201) return fail(`putting ${TOTAL} minor in the payer's company GBP account must answer 201; Lens answered ${said(topped)}`)
        const given = await call(payer, 'POST', `/v1/money/accounts/${paying.account.id}/funding`, { direction: 'to_agent', amount_minor: TOTAL, idempotency_key: `e2e-${randomBytes(8).toString('hex')}` },
          `the payer gives its agent ${TOTAL} minor from the company's account`)
        if (given.status !== 201) return fail(`giving the payer's agent ${TOTAL} minor must answer 201; Lens answered ${said(given)}`)
        funded = 'funded with £145.00 of test money (LENS_MONEY_SANDBOX_WEBHOOK_SECRET not given, so not through a payment in)'
      }

      // B30.134 — funded, the payer's agent is held to a monthly limit under the invoice: refused 403 naming it, nothing moves.
      const rulesPath = `/v1/workspaces/{ws}/agents/${paying.agent}/rules`
      const rules = await lens.agentRules(payer, paying.agent)
      const limited = await call(payer, 'PUT', rulesPath, { ...rules, currency: 'GBP', monthly_limit_minor: UNDER_MINOR },
        `the payer limits its agent to ${UNDER_MINOR} pence a month, under the invoice's ${TOTAL}`)
      if (!limited.ok) return fail(`a monthly limit of £100.00 on the payer's agent was refused: ${said(limited)}`)
      const over = await call<{ invoice: Invoice }>(payer, 'POST', `/v1/pay/${token}/agent`, { agent_id: paying.agent },
        "the payer's agent pays the invoice over its monthly limit")
      if (over.status !== 403 || over.ok || !/monthly/.test(over.error)) {
        return fail(`an invoice of £145.00 over the payer's agent's monthly limit of £100.00 must be refused 403 naming the limit; Lens answered ${said(over)}`)
      }
      const kept = await unmoved('a payment its rules refused', TOTAL)
      if (kept !== undefined) return fail(kept)
      const raised = await call(payer, 'PUT', rulesPath, { ...rules, currency: 'GBP', monthly_limit_minor: OVER_MINOR },
        `the payer raises its agent's monthly limit to ${OVER_MINOR} pence`)
      if (!raised.ok) return fail(`a monthly limit of £200.00 on the payer's agent was refused: ${said(raised)}`)

      for (const attempt of ['pays the invoice', 'pays it again, a retry']) {
        const ok = await call<{ invoice: Invoice }>(payer, 'POST', `/v1/pay/${token}/agent`, { agent_id: paying.agent }, `the payer's agent ${attempt}`)
        if (ok.status !== 200 || !ok.ok) return fail(`the payer's agent holding ${TOTAL} ${attempt}: Lens must answer 200; it answered ${said(ok)}`)
      }
      const listed = await call<{ invoices: Invoice[] | null }>(issuer, 'GET', '/v1/money/invoices', undefined, 'the issuer lists its invoices once paid')
      if (!listed.ok) return fail(`listing the issuer's invoices was refused: ${said(listed)}`)
      const now = new Date()
      const day = (d: Date) => d.toISOString().slice(0, 10)
      const period = `from=${day(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)))}&to=${day(new Date(now.getTime() + 86_400e3))}`
      const statement = await call<{ lines: StatementLine[] | null }>(issuer, 'GET', `/v1/money/accounts/${issuing.account.id}/statement?${period}`, undefined,
        "the issuer reads its agent account's statement for this month")
      if (!statement.ok) return fail(`reading the issuer's agent account's statement was refused: ${said(statement)}`)
      const holds = async (user: SyntheticUser, who: string, id: string): Promise<number | undefined> => {
        const accounts = await call<{ accounts: Account[] | null }>(user, 'GET', '/v1/money/accounts', undefined, `${who} lists the accounts once paid`)
        const a = accounts.ok ? (accounts.value.accounts ?? []).find((x) => x.id === id) : undefined
        return a === undefined ? undefined : a.test_minor + a.live_minor
      }
      const bps = fees.merchant_a2a_fee_bps
      const faults = acceptanceFeeFaults({ total: TOTAL, bps, invoice: (listed.value.invoices ?? []).find((x) => x.id === inv.id),
        issuerLines: statement.value.lines ?? [], issuerHolds: await holds(issuer, 'the issuer', issuing.account.id), payerHolds: await holds(payer, 'the payer', paying.account.id) })
      if (faults.length > 0) return fail(faults.join('; '))
      const fee = acceptanceFeeOf(TOTAL, bps ?? 0)

      return {
        pass: true,
        detail: "a GBP invoice of £145.00 (two lines, 20% VAT on one) issued from the agent's account and sent, with a number, a reference and a pay link; " +
          "its pay page read with no credential, with no notice and no transfer to the Test partner's details, naming no issuer id; " +
          "another company's agent holding £0.00 refused 409; the invoice still sent with £145.00 due and no payment, both agents' accounts still 0; " +
          `${funded}; under a monthly limit of £100.00 refused 403 naming it, nothing moved; ` +
          `the limit raised to £200.00, the agent paid it twice and was taken once; the issuer charged one acceptance_fee of ${fee} minor (${percent(bps ?? 0)}), ` +
          `shown as the payment's fee_minor, its agent account holding ${TOTAL - fee}`,
      }
    },
  }
}
