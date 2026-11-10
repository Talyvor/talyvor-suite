// B30.126 SELF-TEST — the stand-in Lens's saved outside payees (Lens B30.16), as outside-payees reads and writes them:
// POST and GET /v1/money/payees, POST …/{id}/challenge and …/{id}/confirm. The Test partner answers by the name
// (TESTNOMATCH no match, TESTCLOSE a close match whose holder is the name without the word), TESTSANCTION is refused 403
// and not saved, and a close or no match is confirmed only by an assertion from one of the workspace's passkeys, signed
// over the payee's challenge (checked here as Lens's passkey.VerifyAssertion does).
// B30.109 — and the compliance desk the same scenario's money reaches: POST and GET /v1/money/accounts (Lens B30.13; a live
// account is refused naming currency_accounts' class RED), POST and GET /v1/money/payments (Lens B30.17; a payee held for
// review is refused on its case, live money is refused for want of any), and the compliance cases screening opens (Lens B30.6):
// a TESTSANCTION name is refused naming a blocked case, a TESTPENDING name is saved held on its own. Its defects:
//   payee-confirm-unsigned — a payee is confirmed with no assertion
//   compliance-live-paid   — a live payment on an uncleared capability is paid, and the account's live balance moves
// B30.130 — and an agent's account under the company's (Lens B30.13), its details and payment reference (GET
// /v1/money/accounts/{id}/details, Lens B30.14), the invoices it issues (POST and GET /v1/money/invoices, Lens B30.20), the pay
// page anyone with the link reads (GET /v1/pay/{token}) and another agent paying it from its account in the currency (POST
// /v1/pay/{token}/agent), which moves test money from the payer's account into the issuer's. Its defect:
//   invoice-paid-unmoved   — an agent's payment marks the invoice paid without asking what the payer holds or moving money
// B30.97 adds the pay page's card (POST /v1/pay/{token}/card: a checkout URL, served here as /stub-invoice-checkout/{token} with
// Stripe's field ids; the 4242 card posts what is due into the issuer's account and sends the browser back to the pay link with
// ?paid=card), and POST /v1/money/invoices/{id}/send and …/void. Its defect:
//   invoice-card-unposted  — a card payment marks the invoice paid and credits the issuer's account nothing
// B41.1 — and the bills inbox (POST and GET /v1/money/bills, Lens B41.101): a PDF's text lines read for the supplier (its first
// line), invoice number, amount due, due date and bank details, matched to a saved payee by its account number, else by its
// name (bank_details_differ when the invoice prints other details), or marked new_payee; the same document, or the same
// supplier's same invoice number, is one bill. Its defects:
//   bill-duplicated        — the same invoice uploaded again is stored as a second bill
//   bill-details-unflagged — B40.22: an invoice printing other bank details than its supplier's saved payee reads matched
// B30.96 — and the Pay screen's other desks: a payment names the account it pays from (account_id); mandates (POST and GET
// /v1/money/mandates, POST …/{id}/revoke, Lens B30.19: an outside business's grant answers its pull_key once); and bulk
// payouts (POST /v1/money/payouts as text/csv or JSON rows, GET …, GET …/{id}, POST …/{id}/approve, Lens B30.21): every row
// validated on upload — the payee saved and confirmed, the amount positive in a money currency, the company's account in
// the currency holding enough after the valid rows before it — and paid, once, on one approval.
// B46.12 — and the Test partner's refusal: a payment whose minor units end in 13 is refused and lists failed, its hold back in
// the account (Lens's payment_out_failed). Its defect:
//   refused-payment-held   — the refused payment's money stays out of the account
// B46.20 — and an agent's single-use cards (POST and GET /v1/money/cards, GET …/{id}, POST …/{id}/approve, Lens B46.10): a batch of
// up to ten, one per merchant, each capped, waits for the owner's one approval, which holds the caps' total out of the agent's
// account once (card_hold) and issues every card, active for 24 hours. Approved again it is answered as it stands. Its defect:
//   card-hold-twice        — approving an issued batch again holds its total again

// B41.11 — and a new payee's cooling-off (Lens B41.111): a payee reads cooling_off_until 24 hours after it is saved, and until
// then a payment of more than 1,000 to it is refused 409; POST …/{id}/called/challenge and …/{id}/called end it, only on an
// assertion by one of the workspace's passkeys over that challenge. Its defect:
//   cooling-off-skipped    — a payment of more than 1,000 to a payee saved moments ago is paid
// B41.12 — and a change of a payee's bank details (Lens B41.112): POST …/{id}/details/challenge issues a challenge for exactly
// the new details and …/{id}/details changes them only on an assertion by one of the workspace's passkeys over it; the payee
// then reads held_until 24 hours on and a notice, and until then every payment to it is refused 409. Its defect:
//   details-hold-skipped   — a payment to a payee whose bank details changed moments ago is paid
// B54.35 — and a person's payment is signed (Lens B54.33): once the workspace has a passkey, the owner's POST /v1/money/payments
// pays only with an assertion by one of them over POST /v1/money/payments/challenge's challenge for exactly that payment;
// unsigned or signed for another it is refused 403 and nothing moves. Its defect:
//   payment-unsigned-paid  — the owner's payment with no signature is paid in a workspace with a passkey
// B28.62 — and budgets with their limit-approach alerts (Lens B53.4, B28.335): PUT and GET /v1/money/budgets, spent from the
// payments out of the month (or the week from Monday, UTC) in the budget's currency and wallet; GET /v1/money/budgets/alerts
// raises each 50, 80 and 100% reached, once a period, and lists them newest first. Its defect:
//   limit-alert-twice      — an alert already raised in its period is raised again on every read
// B28.66 — and where alerts go (Lens B28.338): POST, GET and DELETE /v1/money/alerts/channels keep push, webhook (https; its
// whsec_ secret answered once) and slack channels and refuse email; GET /v1/money/alerts/deliveries queues one delivery per
// channel for each limit alert raised since the channel was added, and lists them newest first. The stub sends nothing, so
// every delivery reads queued. Its defect:
//   alert-delivery-once    — an alert is queued for the first channel only
// B41.39 — and a budget by category: PUT /v1/money/spending/merchants puts a merchant (here a payee's name) in a category, and a
// budget with a category spends only its category's payments; a payment with no correction is uncategorised. Its defect:
//   budget-category-ignored — a budget with a category spends every payment in its currency
// B53.14 — and a week of card spending with the Coach (Lens B53.3–B53.6, B53.18): POST /v1/synthetic/workspaces/{ws}/money/cards/{id}/charge
// charges a card at a merchant as the issuer does, with that merchant's MCC and country, approved only at the card's merchant, up to
// its cap and once, the rest of the cap back in the agent's account; GET /v1/money/spending lists it in the MCC's category and a
// budget spends it; GET /v1/money/spending/unusual finds a new merchant, a new country and a duplicate (same merchant and amount
// within 10 minutes); GET /v1/money/coach words each finding, each budget at 50% or more and the week, by template; POST
// /v1/money/coach/ask answers a loan, product or gambling question with the free-help pointers only. Its defect:
//   coach-validator-bypassed — the Coach's duplicate sentence says a figure that is not its fact's, and stands as the model's
// B53.8 — and payments out on those reads: GET /v1/money/spending lists them beside the card charges, each in its corrected category
// (else transfers, as Lens reads a payment to a payee), with each wallet's totals by category. Its defect:
//   spending-correction-ignored — a merchant's correction moves its budget but never the payment's category on /v1/money/spending
// B53.16 — and the month plan (Lens B53.15): PUT /v1/money/plan/income sets the payday; GET /v1/money/plan runs from today (UTC) to
// the day before it, with money now (the open accounts' test money), the bills due before then, the budgets left, the last seven
// days' pace and safe to spend per day, and Lens's uncovered and pace-short findings with the Coach's sentence; GET /v1/money/notices
// lists each finding once as a "plan" notice, as Lens's minute sweep raises it, and PUT /v1/money/notices/settings keeps the settings.
// Its defect:
//   plan-pace-ignored — the plan reads the money now against the payments due but never the pace, so a spree raises no finding
// B48.27 — and screening and the Travel Rule on an agent's USDC payments to addresses (Lens B48.7, with B48.31's test contract): a
// payee saved at an address (network base) reads check address and is confirmed with a passkey; test money goes into an agent's
// wallet; the agent's own key pays from its wallet in USDC (POST /v1/money/payments); the address the Test screening provider flags
// is refused 403, the one its Travel Rule provider names carries travel_rule sent, and more than 1,000 USDC in all to any other
// address answers 409 until POST …/{id}/address-proof carries the address's personal_sign of Lens's proof message. Each payment
// holds its amount on the wallet's ledger (payment_out_hold), read on GET /v1/workspaces/{ws}/agents/{id}/wallet/activity. Its defects:
//   address-unscreened     — a payment to the flagged address is paid
//   self-hosted-unproved   — more than 1,000 USDC to a self-hosted address is paid without the owner's proof

import type { IncomingMessage, ServerResponse } from 'node:http'
import { createHash, createPublicKey, randomBytes, randomUUID, verify } from 'node:crypto'
import { FLAGGED_ADDRESS, VASP_ADDRESS, proofMessage, signerOf } from '../src/screeningTravelRule.ts'

interface Payee { id: string; workspace_id: string; name: string; country: string; check: string; suggested_name?: string; checked_by: string
  needs_confirmation: boolean; confirmed_by?: string; created_at: string; cooling_off_until?: string; [k: string]: unknown }
interface Assertion { credential_id?: string; client_data_json?: string; authenticator_data?: string; signature?: string }
/** A compliance case as Lens's operator reads it (screening.Case). */
interface Case { id: string; workspace_id: string; kind: string; subject_kind: string; subject_id: string; name: string; outcome: string; status: string
  matches: unknown[]; provider: string; capability: string; opened_at: string }
/** A currency account (economy.CurrencyAccount). */
interface Account { id: string; workspace_id: string; agent_id?: string; parent_account_id?: string; currency: string; purpose: string; status: string
  name: string; balance_minor: number; test_minor: number; live_minor: number; created_at: string }
/** One line of an invoice and its VAT (economy.InvoiceLine). */
interface Line { description: string; quantity: number; unit_amount_minor: number; vat_rate_bps: number; net_minor: number; vat_minor: number }
/** An invoice as its issuer reads it (economy.Invoice). */
interface StubInvoice { id: string; workspace_id: string; agent_id: string; account_id: string; issuer: string; number: string; reference: string; pay_token: string
  pay_url: string; currency: string; customer_name: string; customer_email?: string; lines: Line[]; subtotal_minor: number; vat_minor: number; total_minor: number
  paid_minor: number; due_minor: number; due_date: string; remind_days_before: number; status: string; sent_at?: string; paid_at?: string; created_at: string
  payments: { entry_id: string; method: string; amount_minor: number; paid_at: string }[] }
/** A mandate (economy.Mandate). */
interface StubMandate { id: string; workspace_id: string; agent_id: string; account_id: string; currency: string; payee_workspace_id?: string; payee_business_id?: string
  payee_name: string; payee_id?: string; max_per_pull_minor: number; max_per_month_minor: number; pulled_this_month_minor: number; expires_at: string; status: string
  revoked_at?: string; created_at: string }
/** One row of a payout batch and the batch (economy.PayoutRow, economy.PayoutBatch). */
interface StubRow { line: number; payee_id: string; payee_name?: string; amount_minor: number; currency: string; reference: string; status: string; payment_id?: string; detail?: string }
interface StubBatch { id: string; workspace_id: string; funding: string; idempotency_key: string; status: string; rows: StubRow[]; rows_total: number; rows_valid: number
  rows_invalid: number; totals_minor: Record<string, number>; approved_by?: string; approved_at?: string; created_at: string; updated_at: string }
/** A payment out (economy.OutsidePayment). */
interface Payment { id: string; workspace_id: string; account_id: string; payee_id: string; payee_name: string; amount_minor: number; currency: string
  funding: string; reference: string; idempotency_key: string; status: string; created_at: string; address?: string; travel_rule?: Record<string, string> }
/** A card batch and its cards (economy.CardBatch, economy.MoneyCard). */
interface StubCard { id: string; line: number; merchant: string; cap_minor: number; currency: string; status: string; spent_minor: number; last4?: string; expires_at?: string }
interface StubCardBatch { id: string; workspace_id: string; agent_id: string; idempotency_key: string; purpose: string; currency: string; funding: string
  total_minor: number; status: string; cards: StubCard[]; approved_by?: string; approved_at?: string; created_at: string }

/** A budget and the alert it raised (economy.SpendBudget, economy.SpendAlert). */
interface StubBudget { id: string; agent_id: string; category: string; period: string; amount_minor: number; currency: string; timezone: string }
/** A card charge the issuer made and Lens approved (economy card_charge, with B53.1's details). */
interface StubCharge { entry_id: string; agent_id: string; merchant: string; mcc: string; country: string; amount_minor: number; currency: string; created_at: string }
interface StubLimitAlert { id: string; kind: string; subject: string; agent_id?: string; category?: string; period: string; period_start: string; percent: number
  spent_minor: number; limit_minor: number; currency: string; created_at: string }
interface StubAlertChannel { id: string; kind: string; url: string; created_at: string }
interface StubAlertDelivery { id: string; channel_id: string; channel_kind: string; alert_kind: string; alert_id: string; title: string; body: string
  status: string; attempts: number; created_at: string }

const CURRENCIES = ['GBP', 'EUR', 'USD']
/** B53.14 — how the issuer reports a charge at each merchant (Lens issuerfake); any other is 5999 in GB. */
const ISSUER: Record<string, { mcc: string; country: string }> = { tesco: { mcc: '5411', country: 'GB' }, 'pret a manger': { mcc: '5814', country: 'GB' },
  'tfl travel': { mcc: '4111', country: 'GB' }, 'marriott lisbon': { mcc: '3509', country: 'PT' }, openai: { mcc: '5734', country: 'US' } }
/** An MCC's category (Lens economy mccCategory), for the codes ISSUER uses. */
const mccCategory = (mcc: string): string => ({ 5411: 'groceries', 5814: 'eating_out', 4111: 'transport', 5734: 'ai_software' } as Record<string, string>)[mcc] ??
  (mcc >= '3000' && mcc <= '3999' ? 'travel' : 'shopping')
/** Minor units as the Coach's facts carry them (Lens economy.FormatMinor): "24.00 GBP". */
const formatMinor = (minor: number, currency: string): string => `${(minor / 100).toFixed(2)} ${currency}`
const DECLINE = "I explain your own spending, but I can't recommend a product, credit, a loan, an investment or insurance, or tell you what to do " +
  'about debt. These services give free, impartial help.'
const HELP = { MoneyHelper: 'https://www.moneyhelper.org.uk', StepChange: 'https://www.stepchange.org', 'National Debtline': 'https://nationaldebtline.org',
  GamCare: 'https://www.gamcare.org.uk' } as Record<string, string>
// B41.12 — Lens's PayeeDetailsNotice, word for word.
const DETAILS_NOTICE = 'Call them on a number you already know — not one from the message that asked for the change — to check the new details are theirs.'
const HELD = 'screening: held — the name is close to one on a sanctions list, and waits for an operator to release it'
const PAYMENT_UNSIGNED = 'economy: this workspace signs its payments with a passkey or the phone app — sign this payment\'s challenge (POST /v1/money/payments/challenge)'

type OwnerPayment = { payee_id?: string; amount_minor?: number; currency?: string; funding?: string; reference?: string; idempotency_key?: string; account_id?: string }

/** B54.35 — the challenge's key: every field of the payment as asked (Lens's paymentPurpose), so a signature for it pays no other. */
/** B55.56 — a mandate grant as the owner signs it (Lens economy.MandateGrant), and the challenge key its signature answers. */
interface MandateGrant { account_id?: string; payee_workspace_id?: string; payee_business_id?: string; payee_id?: string; payee_name?: string
  max_per_pull_minor?: number; max_per_month_minor?: number; expires_at?: string }
const grantKey = (g: MandateGrant) => `mandate:${[g.account_id, g.payee_workspace_id, g.payee_business_id, g.payee_id, g.payee_name, g.max_per_pull_minor, g.max_per_month_minor, g.expires_at].map((x) => x ?? '').join('\0')}`
const MANDATE_UNSIGNED = 'economy: this workspace signs its mandates with a passkey or the phone app — sign this mandate\'s challenge (POST /v1/money/mandates/challenge)'
const paymentKey = (b: OwnerPayment) => `payment:${[b.account_id, b.payee_id, b.amount_minor, b.currency, b.funding, b.reference, b.idempotency_key].map((x) => x ?? '').join('\0')}`
/** Minor units as Lens prints them: "GBP 10.00". */
const money = (minor: number, currency: string): string => `${currency} ${(minor / 100).toFixed(2)}`

export class PayeeDesk {
  private readonly payees = new Map<string, Payee[]>()
  private readonly challenges = new Map<string, string>()
  private readonly accounts = new Map<string, Account[]>()
  private readonly testMoneyKeys = new Set<string>()
  private readonly payments = new Map<string, Payment[]>()
  /** B48.27 — each workspace's wallet ledger lines, newest first, and the addresses its owner proved they hold. */
  private readonly lines = new Map<string, { account_id: string; agent_id?: string; currency: string; kind: string; amount_minor: number; at: string }[]>()
  private readonly proved = new Set<string>()
  private readonly cases: Case[] = []
  /** B30.130 — each agent account's payment reference, by account id; and every invoice issued, found by its pay token. */
  private readonly references = new Map<string, string>()
  private readonly invoices: StubInvoice[] = []
  /** B30.96 — the mandates granted and the payout batches uploaded, by workspace. */
  private readonly mandates = new Map<string, StubMandate[]>()
  private readonly batches = new Map<string, StubBatch[]>()
  /** B41.1 — the bills each workspace received, each with the digest of its document. */
  private readonly bills = new Map<string, (Record<string, unknown> & { id: string; digest: string })[]>()
  /** B46.20 — the card batches each workspace's agents asked for. */
  private readonly cardBatches = new Map<string, StubCardBatch[]>()
  /** B28.62 — each workspace's budgets and the alerts they raised. */
  private readonly budgets = new Map<string, StubBudget[]>()
  private readonly limitAlerts = new Map<string, StubLimitAlert[]>()
  /** B28.66 — each workspace's alert channels and the deliveries queued to them. */
  private readonly alertChannels = new Map<string, StubAlertChannel[]>()
  private readonly alertDeliveries = new Map<string, StubAlertDelivery[]>()
  /** B41.39 — each workspace's merchant corrections, by the merchant's lower-cased name. */
  private readonly merchantCategories = new Map<string, Map<string, string>>()
  /** B53.14 — each workspace's card charges. */
  private readonly charges = new Map<string, StubCharge[]>()
  /** B53.16 — each workspace's payday and income, its notice settings and the plan notices raised, by subject. */
  private readonly incomes = new Map<string, { payday: number; amount_minor: number; currency: string; payer: string; set_at: string }>()
  private readonly noticeSettings = new Map<string, unknown>()
  private readonly planNotices = new Map<string, Map<string, Record<string, unknown>>>()

  private readonly json: (res: ServerResponse, status: number, body: unknown) => void
  private readonly body: <T>(req: IncomingMessage) => Promise<T>
  private readonly broken: (name: string) => boolean
  /** The workspace's registered passkeys, each with its SPKI, base64url. */
  private readonly passkeys: (ws: string) => { credential_id: string; public_key: string }[]

  /** B30.97 — the raw request body (the checkout's form), the stub's own address and the app's, where a pay link points. */
  private readonly read: (req: IncomingMessage) => Promise<string>
  private readonly base: string
  private readonly appURL: string

  constructor(json: PayeeDesk['json'], body: PayeeDesk['body'], broken: PayeeDesk['broken'], passkeys: PayeeDesk['passkeys'],
    where: { read: PayeeDesk['read']; base: string; appURL: string }) {
    this.json = json
    this.body = body
    this.broken = broken
    this.passkeys = passkeys
    this.read = where.read
    this.base = where.base
    this.appURL = where.appURL
  }

  /** B40.27 — workspace `ws`'s saved payees, as a payment request finds them. */
  payeesOf(ws: string): Payee[] {
    return this.payees.get(ws) ?? []
  }

  /** B41.2 — the bills `ws` received, for paying them as one request (stub-payment-requests.ts). */
  billsOf(ws: string): { id: string; supplier: string; invoice_number: string; amount_minor: number; currency: string; payee_id?: string; status: string; due_date: string }[] {
    return (this.bills.get(ws) ?? []) as unknown as ReturnType<PayeeDesk['billsOf']>
  }

  /** B48.1 — `agentID`'s open wallet in `asset` (the owner's for ''), opened now if it has none: an account in the ledger like any other. */
  wallet(ws: string, agentID: string, asset: string): Account {
    const accounts = this.accounts.get(ws) ?? []
    const open = accounts.find((a) => a.currency === asset && (a.agent_id ?? '') === agentID && a.purpose === (agentID === '' ? 'company' : 'agent') && a.status === 'open')
    if (open !== undefined) return open
    const a: Account = { id: `macc_${randomUUID()}`, workspace_id: ws, ...(agentID === '' ? {} : { agent_id: agentID }), currency: asset,
      purpose: agentID === '' ? 'company' : 'agent', status: 'open', name: `${asset} wallet`, balance_minor: 0, test_minor: 0, live_minor: 0, created_at: new Date().toISOString() }
    this.accounts.set(ws, [...accounts, a])
    return a
  }

  /** B30.109 — the compliance cases in `status` (every one for ''), newest first, as GET /v1/admin/screening lists them. */
  complianceCases(status: string): Case[] {
    return this.cases.filter((c) => status === '' || c.status === status).reverse()
  }

  private openCase(ws: string, subjectID: string, name: string, status: 'blocked' | 'held'): Case {
    const c: Case = { id: `cc_${randomUUID()}`, workspace_id: ws, kind: 'screening', subject_kind: 'payee', subject_id: subjectID, name,
      outcome: status === 'blocked' ? 'hit' : 'review', status, matches: [{ name, list: 'TEST', entry: 'TESTSANCTION', score_bps: status === 'blocked' ? 10_000 : 9_000 }],
      provider: 'test', capability: 'payments_out', opened_at: new Date().toISOString() }
    this.cases.push(c)
    return c
  }

  /** The payee, account and payment routes, on workspace `ws`'s key: true when `path` was one of them. */
  async route(req: IncomingMessage, res: ServerResponse, ws: string, path: string): Promise<boolean> {
    const list = this.payees.get(ws) ?? []
    if (path === '/v1/money/accounts' || path === '/v1/money/payments') return this.money(req, res, ws, path, list), true
    if (path === '/v1/money/payments/challenge' && req.method === 'POST') return this.paymentChallenge(req, res, ws), true
    const funded = /^\/v1\/money\/accounts\/([^/]+)\/test-money$/.exec(path)
    if (funded !== null && req.method === 'POST') return this.testMoney(req, res, ws, funded[1]), true
    if (await this.invoiceRoute(req, res, ws, path)) return true
    if (await this.mandateRoute(req, res, ws, path, list)) return true
    if (await this.payoutRoute(req, res, ws, path, list)) return true
    if (await this.billRoute(req, res, ws, path, list)) return true
    if (await this.cardRoute(req, res, ws, path, '')) return true
    if (await this.budgetRoute(req, res, ws, path)) return true
    if (await this.coachRoute(req, res, ws, path)) return true
    if (await this.planRoute(req, res, ws, path)) return true
    if (path === '/v1/money/payees' && req.method === 'GET') return this.json(res, 200, { payees: list }), true
    if (path === '/v1/money/payees' && req.method === 'POST') {
      const b = await this.body<Record<string, string>>(req)
      const name = (b.name ?? '').trim()
      if (name === '' || (b.country ?? '') === '') return this.json(res, 400, { error: 'economy: invalid payee: a payee has a name and a country' }), true
      if (/TESTSANCTION/i.test(name)) {
        const c = this.openCase(ws, `payee_${randomUUID()}`, name, 'blocked')
        return this.json(res, 403, { error: `screening: refused — the name is on a sanctions list (compliance case ${c.id})` }), true
      }
      const check = (b.address ?? '') !== '' ? 'address' : /TESTNOMATCH/i.test(name) ? 'no_match' : /TESTCLOSE/i.test(name) ? 'close_match' : 'exact_match'
      const p: Payee = { ...b, id: `payee_${randomUUID()}`, workspace_id: ws, name, country: b.country, check, checked_by: 'test',
        ...(check === 'close_match' ? { suggested_name: name.replace(/TESTCLOSE/gi, ' ').split(/\s+/).filter(Boolean).join(' ') } : {}),
        needs_confirmation: check !== 'exact_match', created_at: new Date().toISOString(), cooling_off_until: new Date(Date.now() + 86_400_000).toISOString() }
      if (/TESTPENDING/i.test(name)) p.screening = `${HELD} (compliance case ${this.openCase(ws, p.id, name, 'held').id})`
      this.payees.set(ws, [...list, p])
      return this.json(res, 201, p), true
    }
    const one = /^\/v1\/money\/payments\/([^/]+)$/.exec(path)
    if (one !== null && req.method === 'GET') {
      const p = (this.payments.get(ws) ?? []).find((x) => x.id === one[1])
      return p === undefined ? this.json(res, 404, { error: 'economy: no such payment' }) : this.json(res, 200, p), true
    }
    const proof = /^\/v1\/money\/payees\/([^/]+)\/address-proof$/.exec(path)
    if (proof !== null && req.method === 'POST') return this.addressProof(req, res, ws, list.find((x) => x.id === proof[1])), true
    const m = /^\/v1\/money\/payees\/([^/]+)\/(challenge|confirm|called\/challenge|called|details\/challenge|details)$/.exec(path)
    if (m === null || req.method !== 'POST') return false
    const p = list.find((x) => x.id === m[1])
    if (p === undefined) return this.json(res, 404, { error: 'economy: no such payee' }), true
    if (m[2].startsWith('called')) return this.called(req, res, ws, p, m[2] === 'called/challenge'), true
    if (m[2].startsWith('details')) return this.changeDetails(req, res, ws, p, m[2] === 'details/challenge'), true
    if (!p.needs_confirmation) return this.json(res, 409, { error: 'economy: this payee needs no confirmation' }), true
    if (m[2] === 'challenge') {
      const keys = this.passkeys(ws)
      if (keys.length === 0) return this.json(res, 409, { error: 'economy: a payee is confirmed with one of the workspace\'s passkeys, signing its challenge — register one first' }), true
      const c = randomBytes(32).toString('base64url')
      this.challenges.set(p.id, c)
      return this.json(res, 200, { challenge: c, allow_credentials: keys.map((k) => k.credential_id), user_verification: 'required' }), true
    }
    const { assertion } = await this.body<{ assertion?: Assertion }>(req)
    if (!this.broken('payee-confirm-unsigned')) {
      const refused = this.refused(ws, p.id, assertion)
      if (refused !== undefined) return this.json(res, 403, { error: refused }), true
    }
    this.challenges.delete(p.id)
    Object.assign(p, { needs_confirmation: false, confirmed_by: assertion?.credential_id ?? '', confirmed_at: new Date().toISOString() })
    return this.json(res, 200, p), true
  }

  /** B46.20 — the card routes, on the owner's key (`agentID` '') or on agent `agentID`'s own: true when `path` was one of them. */
  async cardRoute(req: IncomingMessage, res: ServerResponse, ws: string, path: string, agentID: string): Promise<boolean> {
    if (!path.startsWith('/v1/money/cards')) return false
    const batches = this.cardBatches.get(ws) ?? []
    const mine = batches.filter((b) => agentID === '' || b.agent_id === agentID)
    if (path === '/v1/money/cards' && req.method === 'GET') return this.json(res, 200, { batches: [...mine].reverse() }), true
    if (path === '/v1/money/cards' && req.method === 'POST') {
      const b = await this.body<{ agent_id?: string; purpose?: string; currency?: string; idempotency_key?: string; cards?: { merchant?: string; cap_minor?: number }[] }>(req)
      const key = String(req.headers['idempotency-key'] ?? b.idempotency_key ?? '').trim()
      const agent = agentID || (b.agent_id ?? '')
      const currency = (b.currency ?? '').toUpperCase()
      const cards = b.cards ?? []
      const bad = (msg: string) => (this.json(res, 400, { error: `economy: invalid card batch: ${msg}` }), true)
      if (agent === '') return bad("cards are an agent's: name the agent (agent_id), or ask with the agent's own key")
      if (!CURRENCIES.includes(currency)) return bad(`cards are in GBP, EUR or USD, not "${currency}"`)
      if (key === '') return bad('a batch carries an idempotency key (the Idempotency-Key header, or idempotency_key), up to 200 characters')
      if (cards.length === 0 || cards.length > 10) return bad(`a batch has from 1 to 10 cards, not ${cards.length}`)
      const merchants = cards.map((c) => (c.merchant ?? '').trim().toLowerCase())
      if (merchants.some((m) => m === '') || new Set(merchants).size !== merchants.length) return bad('one card per merchant, each named')
      if (cards.some((c) => !Number.isInteger(c.cap_minor) || (c.cap_minor ?? 0) <= 0)) return bad("a card's cap_minor is a positive number of pence or cents")
      const prior = batches.find((x) => x.idempotency_key === key)
      if (prior !== undefined) return this.json(res, 201, prior), true
      const now = new Date().toISOString()
      const batch: StubCardBatch = { id: `mcb_${randomUUID()}`, workspace_id: ws, agent_id: agent, idempotency_key: key, purpose: (b.purpose ?? '').trim(), currency,
        funding: 'test', total_minor: cards.reduce((n, c) => n + (c.cap_minor ?? 0), 0), status: 'awaiting_approval', created_at: now,
        cards: cards.map((c, i) => ({ id: `mcard_${randomUUID()}`, line: i + 1, merchant: (c.merchant ?? '').trim(), cap_minor: c.cap_minor ?? 0, currency, status: 'awaiting_approval', spent_minor: 0 })) }
      this.cardBatches.set(ws, [...batches, batch])
      return this.json(res, 201, batch), true
    }
    const m = /^\/v1\/money\/cards\/([^/]+)(\/approve)?$/.exec(path)
    const batch = m === null ? undefined : mine.find((x) => x.id === m[1])
    if (m === null) return false
    if (batch === undefined) return this.json(res, 404, { error: 'economy: no such card batch' }), true
    if (m[2] === undefined) return req.method === 'GET' ? (this.json(res, 200, batch), true) : false
    if (req.method !== 'POST') return false
    if (agentID !== '') return this.json(res, 403, { error: "only the workspace's owner or an admin approves an agent's cards" }), true
    if (batch.status === 'issued' && !this.broken('card-hold-twice')) return this.json(res, 200, batch), true
    const from = (this.accounts.get(ws) ?? []).find((a) => a.purpose === 'agent' && a.agent_id === batch.agent_id && a.currency === batch.currency && a.status === 'open')
    if (from === undefined) return this.json(res, 404, { error: `economy: no such money account: the agent has no ${batch.currency} account to pay from` }), true
    if (from.test_minor < batch.total_minor && batch.status !== 'issued') {
      return this.json(res, 402, { error: `economy: not enough money: the account holds ${money(from.test_minor, batch.currency)} of test money, and these cards are capped at ${money(batch.total_minor, batch.currency)} together` }), true
    }
    from.test_minor -= batch.total_minor // the card_hold
    from.balance_minor -= batch.total_minor
    const expires = new Date(Date.now() + 86_400_000).toISOString()
    for (const c of batch.cards) Object.assign(c, { status: 'active', last4: randomBytes(2).toString('hex'), expires_at: expires })
    Object.assign(batch, { status: 'issued', approved_by: 'owner', approved_at: new Date().toISOString() })
    return this.json(res, 200, batch), true
  }

  /** B28.62 — budget `b` of `ws` and how far its period has gone. */
  private budgetProgress(ws: string, b: StubBudget) {
    const now = new Date()
    const start = b.period === 'week'
      ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - ((now.getUTCDay() + 6) % 7)))
      : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    const end = b.period === 'week' ? new Date(start.getTime() + 7 * 86_400_000) : new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1))
    const accounts = this.accounts.get(ws) ?? []
    const categories = this.merchantCategories.get(ws)
    const inCategory = (p: Payment) => b.category === '' || this.broken('budget-category-ignored') ||
      categories?.get(p.payee_name.trim().toLowerCase()) === b.category
    const spent = (this.payments.get(ws) ?? []).filter((p) => p.status !== 'failed' && p.currency === b.currency && inCategory(p) &&
      (b.agent_id === 'all' || (accounts.find((a) => a.id === p.account_id)?.agent_id ?? '') === b.agent_id) &&
      Date.parse(p.created_at) >= start.getTime() && Date.parse(p.created_at) < end.getTime()).reduce((n, p) => n + p.amount_minor, 0) +
      this.spending(ws).filter((c) => c.kind === 'card_charge' && c.currency === b.currency && (b.category === '' || c.category === b.category) && (b.agent_id === 'all' || c.agent_id === b.agent_id) &&
        Date.parse(c.created_at) >= start.getTime() && Date.parse(c.created_at) < end.getTime()).reduce((n, c) => n + c.amount_minor, 0)
    return { ...b, period_start: start.toISOString(), period_end: end.toISOString(), spent_minor: spent, left_minor: b.amount_minor - spent,
      percent: Math.floor((spent * 100) / b.amount_minor) }
  }

  /** B28.62 — budgets (PUT and GET /v1/money/budgets) and the alerts they raise (GET /v1/money/budgets/alerts). */
  private async budgetRoute(req: IncomingMessage, res: ServerResponse, ws: string, path: string): Promise<boolean> {
    const budgets = this.budgets.get(ws) ?? []
    const progress = (b: StubBudget) => this.budgetProgress(ws, b)
    if (path === '/v1/money/spending/merchants' && req.method === 'PUT') {
      const m = await this.body<{ merchant?: string; category?: string }>(req)
      if (!m.merchant?.trim()) return this.json(res, 400, { error: 'economy: spending: name the merchant (at most 200 characters)' }), true
      const categories = this.merchantCategories.get(ws) ?? new Map<string, string>()
      categories.set(m.merchant.trim().toLowerCase(), m.category ?? '')
      this.merchantCategories.set(ws, categories)
      return this.json(res, 200, { merchant: m.merchant, category: m.category ?? '' }), true
    }
    if (path === '/v1/money/budgets' && req.method === 'GET') return this.json(res, 200, { budgets: budgets.map(progress) }), true
    if (path === '/v1/money/budgets' && req.method === 'PUT') {
      const b = await this.body<Partial<StubBudget>>(req)
      if (b.period !== 'week' && b.period !== 'month') return this.json(res, 400, { error: 'economy: spending: period must be week or month' }), true
      if (!Number.isInteger(b.amount_minor) || (b.amount_minor ?? 0) <= 0) return this.json(res, 400, { error: 'economy: spending: amount_minor must be above zero' }), true
      if (!/^[A-Z]{3}$/.test(b.currency ?? '')) return this.json(res, 400, { error: 'economy: spending: currency must be a currency code such as GBP' }), true
      const key = { agent_id: b.agent_id ?? '', category: b.category ?? '', period: b.period, currency: b.currency ?? '' }
      let got = budgets.find((x) => x.agent_id === key.agent_id && x.category === key.category && x.period === key.period && x.currency === key.currency)
      if (got === undefined) {
        got = { id: `bdg_${randomUUID()}`, ...key, amount_minor: 0, timezone: 'UTC' }
        this.budgets.set(ws, [...budgets, got])
      }
      Object.assign(got, { amount_minor: b.amount_minor, timezone: b.timezone || 'UTC' })
      return this.json(res, 200, progress(got)), true
    }
    // B41.20 — no payment here recurs three times in one run, so Lens finds no subscription; the view lists the rest.
    if (path === '/v1/money/spending/subscriptions' && req.method === 'GET') return this.json(res, 200, { subscriptions: [] }), true
    if (path === '/v1/money/budgets/alerts' && req.method === 'GET') {
      const alerts = this.limitAlerts.get(ws) ?? []
      for (const b of budgets.map(progress)) {
        for (const pct of [50, 80, 100]) {
          if (b.spent_minor * 100 < b.amount_minor * pct) break
          const raised = alerts.some((a) => a.subject === b.id && a.period_start === b.period_start && a.percent === pct)
          if (raised && !this.broken('limit-alert-twice')) continue
          alerts.push({ id: `sal_${randomUUID()}`, kind: 'budget', subject: b.id, ...(b.agent_id ? { agent_id: b.agent_id } : {}), ...(b.category ? { category: b.category } : {}),
            period: b.period, period_start: b.period_start, percent: pct, spent_minor: b.spent_minor, limit_minor: b.amount_minor, currency: b.currency,
            created_at: new Date().toISOString() })
        }
      }
      this.limitAlerts.set(ws, alerts)
      return this.json(res, 200, { alerts: [...alerts].reverse() }), true
    }
    return this.alertChannelRoute(req, res, ws, path)
  }

  /** B28.66 — where alerts go (POST, GET and DELETE /v1/money/alerts/channels) and what was queued to each (GET /v1/money/alerts/deliveries). */
  private async alertChannelRoute(req: IncomingMessage, res: ServerResponse, ws: string, path: string): Promise<boolean> {
    const channels = this.alertChannels.get(ws) ?? []
    if (path === '/v1/money/alerts/channels' && req.method === 'GET') return this.json(res, 200, { channels }), true
    if (path === '/v1/money/alerts/channels' && req.method === 'POST') {
      const c = await this.body<{ kind?: string; url?: string }>(req)
      const url = (c.url ?? '').trim()
      if (c.kind === 'email') return this.json(res, 400, { error: 'economy: alert channel: email alerts need an email integration, which is not connected yet' }), true
      if (c.kind === 'webhook' && !url.startsWith('https://')) return this.json(res, 400, { error: "economy: alert channel: a webhook's url must be https, on the public internet" }), true
      if (c.kind === 'slack' && !url.startsWith('https://hooks.slack.com/')) {
        return this.json(res, 400, { error: "economy: alert channel: a Slack channel's url is its incoming webhook, https://hooks.slack.com/…" }), true
      }
      if (c.kind !== 'push' && c.kind !== 'webhook' && c.kind !== 'slack') return this.json(res, 400, { error: 'economy: alert channel: kind must be push, webhook or slack' }), true
      const added: StubAlertChannel = { id: `ach_${randomUUID()}`, kind: c.kind, url: c.kind === 'push' ? '' : url, created_at: new Date().toISOString() }
      this.alertChannels.set(ws, [...channels, added])
      return this.json(res, 201, { ...added, ...(c.kind === 'webhook' ? { secret: `whsec_${randomUUID().replace(/-/g, '')}` } : {}) }), true
    }
    const one = /^\/v1\/money\/alerts\/channels\/([^/]+)$/.exec(path)
    if (one !== null && req.method === 'DELETE') {
      if (!channels.some((c) => c.id === one[1])) return this.json(res, 404, { error: 'economy: no such alert channel' }), true
      this.alertChannels.set(ws, channels.filter((c) => c.id !== one[1]))
      return this.json(res, 200, { deleted: one[1] }), true
    }
    if (path === '/v1/money/alerts/deliveries' && req.method === 'GET') {
      const deliveries = this.alertDeliveries.get(ws) ?? []
      const to = this.broken('alert-delivery-once') ? channels.slice(0, 1) : channels
      for (const c of to) {
        for (const a of this.limitAlerts.get(ws) ?? []) {
          if (a.created_at < c.created_at || deliveries.some((d) => d.channel_id === c.id && d.alert_id === a.id)) continue
          deliveries.push({ id: `adl_${randomUUID()}`, channel_id: c.id, channel_kind: c.kind, alert_kind: 'limit', alert_id: a.id,
            title: `${a.percent}% of a budget`, body: '', status: 'queued', attempts: 0, created_at: new Date().toISOString() })
        }
      }
      this.alertDeliveries.set(ws, deliveries)
      return this.json(res, 200, { deliveries: [...deliveries].reverse() }), true
    }
    return false
  }

  /** B53.14 — the workspace's card charges and (B53.8) payments out, oldest first, each in its category: the person's correction, else
   * its MCC's, else transfers for a payment to a payee. */
  private spending(ws: string): (StubCharge & { kind: string; category: string; category_source: string })[] {
    const corrected = this.merchantCategories.get(ws)
    const accounts = this.accounts.get(ws) ?? []
    const out = [...(this.payments.get(ws) ?? [])].reverse().filter((p) => p.status !== 'failed').map((p) => ({ entry_id: p.id, kind: 'payment_out',
      agent_id: accounts.find((a) => a.id === p.account_id)?.agent_id ?? '', merchant: p.payee_name, mcc: '', country: '', amount_minor: p.amount_minor,
      currency: p.currency, created_at: p.created_at }))
    return [...(this.charges.get(ws) ?? []).map((c) => ({ ...c, kind: 'card_charge' })), ...out]
      .sort((x, y) => Date.parse(x.created_at) - Date.parse(y.created_at))
      .map((c) => {
        const fixed = c.kind === 'payment_out' && this.broken('spending-correction-ignored') ? undefined : corrected?.get(c.merchant.trim().toLowerCase())
        if (fixed) return { ...c, category: fixed, category_source: 'correction' }
        return c.kind === 'card_charge' ? { ...c, category: mccCategory(c.mcc), category_source: 'card' } : { ...c, category: 'transfers', category_source: 'payee' }
      })
  }

  /** B53.14 — the issuer's charge at `merchant` on card `cardID` of `ws`, decided as Lens's AuthorizeCardCharge decides it. */
  chargeCard(ws: string, cardID: string, merchant: string, amount: number): [number, unknown] {
    const batch = (this.cardBatches.get(ws) ?? []).find((b) => b.cards.some((c) => c.id === cardID))
    const card = batch?.cards.find((c) => c.id === cardID)
    if (batch === undefined || card === undefined) return [404, { error: 'economy: no such card' }]
    if (!Number.isInteger(amount) || amount <= 0 || merchant.trim() === '') return [400, { error: 'body must be {"merchant", "amount_minor"} with amount_minor above zero' }]
    const d = ISSUER[merchant.trim().toLowerCase()] ?? { mcc: '5999', country: 'GB' }
    const reason = card.status === 'used' ? 'the card has been used: it pays once' : card.status !== 'active' ? 'the card is not active'
      : card.merchant.toLowerCase() !== merchant.trim().toLowerCase() ? `the card pays only ${card.merchant}`
        : amount > card.cap_minor ? "the charge is more than the card's cap" : ''
    const authorization = `iauth_synthetic_${randomBytes(8).toString('hex')}`
    if (reason !== '') return [200, { authorization_id: authorization, approved: false, reason, ...d, channel: 'online', wallet: 'none' }]
    Object.assign(card, { status: 'used', spent_minor: amount })
    const from = (this.accounts.get(ws) ?? []).find((a) => a.purpose === 'agent' && a.agent_id === batch.agent_id && a.currency === batch.currency)
    if (from !== undefined) {
      from.test_minor += card.cap_minor - amount
      from.balance_minor += card.cap_minor - amount
    }
    this.charges.set(ws, [...(this.charges.get(ws) ?? []), { entry_id: `me_${randomUUID()}`, agent_id: batch.agent_id, merchant: card.merchant, ...d,
      amount_minor: amount, currency: batch.currency, created_at: new Date().toISOString() }])
    return [200, { authorization_id: authorization, approved: true, reason: '', ...d, channel: 'online', wallet: 'none' }]
  }

  /** B53.14 — spending, what was unusual, and the Coach (Lens B53.3, B53.5, B53.6). */
  private async coachRoute(req: IncomingMessage, res: ServerResponse, ws: string, path: string): Promise<boolean> {
    const payments = this.spending(ws)
    if (path === '/v1/money/spending' && req.method === 'GET') {
      const totals = new Map<string, { agent_id?: string; currency: string; total_minor: number; by_category: Record<string, number>; by_tag: Record<string, number> }>()
      for (const p of payments) {
        const t = totals.get(`${p.agent_id}|${p.currency}`) ?? { ...(p.agent_id ? { agent_id: p.agent_id } : {}), currency: p.currency, total_minor: 0, by_category: {}, by_tag: {} }
        t.total_minor += p.amount_minor
        t.by_category[p.category] = (t.by_category[p.category] ?? 0) + p.amount_minor
        totals.set(`${p.agent_id}|${p.currency}`, t)
      }
      return this.json(res, 200, { payments: [...payments].reverse().map((p) => ({ ...p, tags: [] })), totals: [...totals.values()] }), true
    }
    const findings = () => {
      const out: Record<string, unknown>[] = []
      const seen = new Map<string, StubCharge[]>()
      for (const p of payments) {
        const before = seen.get(p.agent_id) ?? []
        const finding = (rule: string, more: object = {}) => out.push({ rule, entry_id: p.entry_id, agent_id: p.agent_id, merchant: p.merchant, mcc: p.mcc,
          category: p.category, country: p.country, amount_minor: p.amount_minor, currency: p.currency, at: p.created_at, ...more })
        if (before.length > 0 && !before.some((b) => b.merchant === p.merchant)) finding('new_merchant', { threshold_minor: 0 })
        if (before.length > 0 && p.country !== '' && !before.some((b) => b.country === p.country)) finding('new_country')
        const twin = [...before].reverse().find((b) => b.merchant === p.merchant && b.amount_minor === p.amount_minor && b.currency === p.currency)
        if (twin !== undefined && Date.parse(p.created_at) - Date.parse(twin.created_at) <= 600_000) {
          finding('duplicate', { duplicate_of: twin.entry_id, minutes_apart: Math.floor((Date.parse(p.created_at) - Date.parse(twin.created_at)) / 60_000) })
        }
        seen.set(p.agent_id, [...before, p])
      }
      return out
    }
    if (path === '/v1/money/spending/unusual' && req.method === 'GET') return this.json(res, 200, { findings: [...findings()].reverse() }), true
    if (path === '/v1/money/coach/ask' && req.method === 'POST') {
      const q = (await this.body<{ question?: string }>(req)).question ?? ''
      const help = (names: string[]) => names.map((name) => ({ name, url: HELP[name], for: 'free help' }))
      if (/\b(gambl\w*|bet|betting|casinos?)\b/i.test(q)) return this.json(res, 200, { text: `${DECLINE} You can also block gambling merchants on your card.`, help: help(['GamCare', 'MoneyHelper']) }), true
      if (/\b(debts?|loans?|borrow\w*|credit|overdraft\w*)\b/i.test(q)) return this.json(res, 200, { text: DECLINE, help: help(['StepChange', 'National Debtline', 'MoneyHelper']) }), true
      if (/\b(savings?|isas?|invest\w*|insurance|pensions?)\b/i.test(q)) return this.json(res, 200, { text: DECLINE, help: help(['MoneyHelper']) }), true
      return this.json(res, 200, { text: 'I explain your own spending: what you paid, how it compares with your budgets, and anything unusual.', help: [] }), true
    }
    if (path !== '/v1/money/coach' || req.method !== 'GET') return false
    const words = (c: string) => c.replaceAll('_', ' ')
    const line = (fact: Record<string, unknown>, sentence: string, source = 'template') => ({ fact, sentence, source })
    const lines = findings().map((f) => {
      const amount = formatMinor(f.amount_minor as number, f.currency as string)
      const fact = { kind: f.rule, agent: f.agent_id !== '', merchant: f.merchant, category: words(f.category as string), country: f.country, amount,
        ...(f.rule === 'duplicate' ? { minutes_apart: f.minutes_apart } : {}) }
      if (f.rule === 'new_country') return line(fact, `One of your agents paid ${amount} at ${f.merchant} in ${f.country}, a country not paid in before; if that wasn't you, you can freeze the card.`)
      if (f.rule !== 'duplicate') return line(fact, `One of your agents paid ${f.merchant} for the first time: ${amount}; if you don't recognise it, check it before it happens again.`)
      if (this.broken('coach-validator-bypassed')) {
        return line(fact, `One of your agents paid ${f.merchant} ${amount} twice, ${formatMinor(2 * (f.amount_minor as number), f.currency as string)} in all; ask the merchant to refund one.`, 'model')
      }
      return line(fact, `One of your agents paid ${f.merchant} ${amount} twice, ${f.minutes_apart} minutes apart; if you meant to pay once, ask the merchant to refund one.`)
    })
    const now = new Date()
    for (const b of (this.budgets.get(ws) ?? [])) {
      const spent = payments.filter((p) => p.currency === b.currency && (b.category === '' || p.category === b.category) && (b.agent_id === 'all' || p.agent_id === b.agent_id))
        .reduce((n, p) => n + p.amount_minor, 0)
      const percent = Math.floor((spent * 100) / b.amount_minor)
      if (percent < 50) continue
      const days = Math.ceil((Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1) - now.getTime()) / 86_400_000)
      const left = formatMinor(b.amount_minor - spent, b.currency)
      lines.push(line({ kind: 'budget', agent: b.agent_id !== '' && b.agent_id !== 'all', category: words(b.category), period: b.period, budget: formatMinor(b.amount_minor, b.currency),
        left, percent, days_left: days }, `One of your agents is at ${percent}% of its ${words(b.category)} budget with ${days} days left; ${left} is left to spend this month.`))
    }
    const total = payments.reduce((n, p) => n + p.amount_minor, 0)
    const review = total === 0 ? [] : [line({ kind: 'week', amount: formatMinor(total, 'GBP') }, `This week ${formatMinor(total, 'GBP')} went out; look over the biggest category first.`)]
    return this.json(res, 200, { lines, review }), true
  }

  /** B53.16 — the month plan (Lens B53.15) and the notices it raises. */
  private async planRoute(req: IncomingMessage, res: ServerResponse, ws: string, path: string): Promise<boolean> {
    if (path === '/v1/money/plan/income' && req.method === 'PUT') {
      const b = await this.body<{ payday?: number; amount_minor?: number; currency?: string; payer?: string }>(req)
      if (!Number.isInteger(b.payday) || (b.payday ?? 0) < 1 || (b.payday ?? 0) > 31) return this.json(res, 400, { error: 'economy: spending: payday must be a day of the month, 1 to 31' }), true
      if (!Number.isInteger(b.amount_minor) || (b.amount_minor ?? 0) <= 0) return this.json(res, 400, { error: 'economy: spending: amount_minor must be above zero' }), true
      if (!/^[A-Z]{3}$/.test(b.currency ?? '')) return this.json(res, 400, { error: 'economy: spending: currency must be a currency code such as GBP' }), true
      this.incomes.set(ws, { payday: b.payday ?? 0, amount_minor: b.amount_minor ?? 0, currency: b.currency ?? '', payer: (b.payer ?? '').trim(), set_at: new Date().toISOString() })
      return this.json(res, 200, this.plan(ws)), true
    }
    if (path === '/v1/money/plan' && req.method === 'GET') return this.json(res, 200, this.plan(ws)), true
    if (path === '/v1/money/notices/settings' && req.method === 'PUT') {
      const b = await this.body<Record<string, unknown>>(req)
      this.noticeSettings.set(ws, b)
      return this.json(res, 200, b), true
    }
    if (path !== '/v1/money/notices' || req.method !== 'GET') return false
    const raised = this.planNotices.get(ws) ?? new Map<string, Record<string, unknown>>()
    for (const f of this.plan(ws).findings) {
      const subject = `${f.kind}/${f.payment.source}:${f.payment.id}/${f.payment.due}`
      if (!raised.has(subject)) {
        raised.set(subject, { id: `ntc_${randomUUID()}`, kind: 'plan', title: 'Month plan', body: f.sentence, urgent: f.urgent, data: { finding: f }, status: 'sent',
          created_at: new Date().toISOString() })
      }
    }
    this.planNotices.set(ws, raised)
    const settings = this.noticeSettings.get(ws) ?? { timezone: 'UTC', quiet_from: '', quiet_until: '', off: [] }
    return this.json(res, 200, { settings, notices: [...raised.values()].reverse() }), true
  }

  /** B53.16 — `ws`'s month plan today, worked out as Lens's SpendPlan works it out, in UTC. */
  private plan(ws: string) {
    const date = (d: Date) => d.toISOString().slice(0, 10)
    const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' })
    const between = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000)
    const now = new Date()
    const today = date(now)
    const inc = this.incomes.get(ws)
    const accounts = (this.accounts.get(ws) ?? []).filter((a) => a.status === 'open' && (a.purpose === 'company' || a.purpose === 'agent'))
    const cur = inc?.currency ?? accounts[0]?.currency ?? 'GBP'
    const paydayIn = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, Math.min(d, new Date(Date.UTC(y, m + 1, 0)).getUTCDate())))
    let until = date(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)))
    let next: string | undefined
    if (inc !== undefined) {
      let n = paydayIn(now.getUTCFullYear(), now.getUTCMonth(), inc.payday)
      if (date(n) <= today) n = paydayIn(now.getUTCFullYear(), now.getUTCMonth() + 1, inc.payday)
      next = date(n)
      until = date(new Date(n.getTime() - 86_400_000))
    }
    const moneyNow = accounts.filter((a) => a.currency === cur).reduce((n, a) => n + a.test_minor, 0)
    const payments = (this.bills.get(ws) ?? []).filter((b) => b.status === 'due' && b.currency === cur && String(b.due_date) <= until)
      .map((b) => ({ source: 'bill', id: b.id, payee: String(b.supplier), amount_minor: Number(b.amount_minor), currency: cur,
        due: String(b.due_date) < today ? today : String(b.due_date), covered: false }))
      .sort((a, b) => a.due.localeCompare(b.due))
    let all = 0
    let overall = 0
    let categories = 0
    for (const b of (this.budgets.get(ws) ?? []).filter((x) => x.currency === cur).map((x) => this.budgetProgress(ws, x))) {
      const left = Math.max(b.left_minor, 0)
      if (b.category === '' && b.agent_id === 'all') all = Math.max(all, left)
      else if (b.category === '') overall += left
      else categories += left
    }
    const budgetsLeft = all > 0 ? all : overall > 0 ? overall : categories
    const weekFrom = Date.parse(`${today}T00:00:00Z`) - 6 * 86_400_000
    const pace = Math.floor(this.spending(ws).filter((p) => p.currency === cur && p.category !== 'bills' && p.category !== 'subscriptions' &&
      Date.parse(p.created_at) >= weekFrom).reduce((n, p) => n + p.amount_minor, 0) / 7)
    const findings: { kind: string; urgent: boolean; payment: (typeof payments)[number]; short_minor: number; pace_per_day_minor?: number; keep_to_per_day_minor?: number; sentence: string }[] = []
    let upcoming = 0
    let uncovered = false
    let paceShort = false
    payments.forEach((p, i) => {
      upcoming += p.amount_minor
      const dayTotal = upcoming + payments.slice(i + 1).filter((q) => q.due === p.due).reduce((n, q) => n + q.amount_minor, 0)
      p.covered = moneyNow - upcoming >= 0
      const days = between(today, p.due)
      const shown = { ...p }
      const amount = formatMinor(p.amount_minor, cur)
      if (!uncovered && !p.covered) {
        uncovered = true
        const short = Math.min(upcoming - moneyNow, p.amount_minor)
        findings.push({ kind: 'plan_uncovered', urgent: true, payment: shown, short_minor: short, sentence: `The ${amount} payment to ${p.payee} on ${day(p.due)} is short by ` +
          `${formatMinor(short, cur)} with the money you have now; add money or hold back other spending before then.` })
      }
      const after = moneyNow - dayTotal - (this.broken('plan-pace-ignored') ? 0 : pace) * days
      if (!uncovered && !paceShort && after < 0) {
        paceShort = true
        const short = Math.min(-after, p.amount_minor)
        const keep = Math.floor(Math.max(moneyNow - dayTotal, 0) / Math.max(days, 1))
        findings.push({ kind: 'plan_pace_short', urgent: true, payment: shown, short_minor: short, pace_per_day_minor: pace, keep_to_per_day_minor: keep,
          sentence: `At this pace, ${formatMinor(pace, cur)} a day, the ${amount} payment to ${p.payee} on ${day(p.due)} is short by ${formatMinor(short, cur)}; ` +
            `keeping to ${formatMinor(keep, cur)} a day until then covers it.` })
      }
    })
    const daysLeft = between(today, until) + 1
    const available = moneyNow - upcoming - budgetsLeft
    return { currency: cur, timezone: 'UTC', today, until, ...(next ? { next_income: next } : {}), days: daysLeft,
      income: inc ? { payday: inc.payday, amount_minor: inc.amount_minor, currency: inc.currency, ...(inc.payer ? { payer: inc.payer } : {}), confirmed: true, set_at: inc.set_at } : null,
      money_now_minor: moneyNow, upcoming_minor: upcoming, budgets_left_minor: budgetsLeft, available_minor: available,
      safe_per_day_minor: Math.floor(Math.max(available, 0) / daysLeft), pace_per_day_minor: pace, payments, findings }
  }

  /** B30.109 — the accounts and the payments out, each refusal as Lens words it; only compliance-live-paid moves money. */
  private async money(req: IncomingMessage, res: ServerResponse, ws: string, path: string, payees: Payee[]): Promise<void> {
    const accounts = this.accounts.get(ws) ?? []
    if (path === '/v1/money/accounts') {
      if (req.method !== 'POST') return this.json(res, 200, { accounts })
      const b = await this.body<{ currency?: string; agent_id?: string; funding?: string }>(req)
      const currency = (b.currency ?? '').toUpperCase()
      const agentID = b.agent_id ?? ''
      if (!CURRENCIES.includes(currency)) return this.json(res, 400, { error: `economy: invalid currency account: an account is in GBP, EUR or USD, not "${currency}"` })
      if (b.funding === 'live') return this.json(res, 403, { error: 'currency_accounts is class RED: it takes no real money until Talyvor records a clearance for it, and this would use real money' })
      if (accounts.some((a) => a.currency === currency && (a.agent_id ?? '') === agentID)) {
        return this.json(res, 409, { error: `economy: an account is already open: ${agentID === '' ? "the company's" : "the agent's"} ${currency} account` })
      }
      // B30.130 — an agent's account is a sub-account of its company's in the currency, reached by a payment reference (Lens B30.14).
      const company = accounts.find((a) => a.currency === currency && a.purpose === 'company')
      if (agentID !== '' && company === undefined) {
        return this.json(res, 409, { error: `economy: an agent's account is a sub-account of its company's: open the company's account in this currency first (${currency})` })
      }
      const a: Account = { id: `macc_${randomUUID()}`, workspace_id: ws, ...(agentID === '' ? {} : { agent_id: agentID, parent_account_id: company?.id }), currency,
        purpose: agentID === '' ? 'company' : 'agent', status: 'open', name: `${currency} account`, balance_minor: 0, test_minor: 0, live_minor: 0, created_at: new Date().toISOString() }
      if (agentID !== '') this.references.set(a.id, 'TLV' + randomBytes(6).toString('hex').toUpperCase())
      this.accounts.set(ws, [...accounts, a])
      return this.json(res, 201, a)
    }
    const payments = this.payments.get(ws) ?? []
    if (req.method !== 'POST') return this.json(res, 200, { payments })
    const b = await this.body<OwnerPayment & { assertion?: Assertion }>(req)
    if (this.passkeys(ws).length > 0 && !this.broken('payment-unsigned-paid')) {
      const refused = this.refused(ws, paymentKey(b), b.assertion)
      if (refused !== undefined) return this.json(res, 403, { error: b.assertion === undefined ? PAYMENT_UNSIGNED : refused })
    }
    const p = this.pay(ws, payees, b)
    if ('error' in p) return this.json(res, p.status, { error: p.error })
    return this.json(res, 201, p)
  }

  /** B54.35 — the challenge the owner's payment `b` is signed over, naming exactly it, and the passkeys that may sign it. */
  private async paymentChallenge(req: IncomingMessage, res: ServerResponse, ws: string): Promise<void> {
    const b = await this.body<OwnerPayment>(req)
    const c = randomBytes(32).toString('base64url')
    this.challenges.set(paymentKey(b), c)
    return this.json(res, 200, { challenge: c, allow_credentials: this.passkeys(ws).map((k) => k.credential_id), user_verification: 'required' })
  }

  /** B30.15 — POST /v1/money/accounts/{id}/test-money {amount_minor, idempotency_key}: test money into the account, once a key. */
  private async testMoney(req: IncomingMessage, res: ServerResponse, ws: string, id: string): Promise<void> {
    const b = await this.body<{ amount_minor?: number; idempotency_key?: string }>(req)
    const account = (this.accounts.get(ws) ?? []).find((a) => a.id === id)
    if (account === undefined) return this.json(res, 404, { error: 'economy: no such money account' })
    if (!b.idempotency_key || !Number.isInteger(b.amount_minor) || (b.amount_minor ?? 0) <= 0) return this.json(res, 400, { error: 'economy: test money is a positive amount_minor and an idempotency_key' })
    if (this.testMoneyKeys.has(`${ws}\n${b.idempotency_key}`)) return this.json(res, 200, account)
    this.testMoneyKeys.add(`${ws}\n${b.idempotency_key}`)
    account.test_minor += b.amount_minor ?? 0
    account.balance_minor += b.amount_minor ?? 0
    this.line(ws, account, 'payment_in', b.amount_minor ?? 0)
    return this.json(res, 201, account)
  }

  /** B48.27 — a line on `account`'s wallet ledger, as Lens's wallet activity reads its postings. */
  private line(ws: string, account: Account, kind: string, amount: number): void {
    this.lines.set(ws, [{ account_id: account.id, ...(account.agent_id === undefined ? {} : { agent_id: account.agent_id }), currency: account.currency, kind,
      amount_minor: amount, at: new Date().toISOString() }, ...(this.lines.get(ws) ?? [])])
  }

  /** B48.27 — GET …/agents/{id}/wallet/activity: `agentID`'s wallet lines, newest first. */
  walletActivity(ws: string, agentID: string): { lines: unknown[] } {
    return { lines: (this.lines.get(ws) ?? []).filter((l) => l.agent_id === agentID) }
  }

  /** B48.27 — POST /v1/money/payees/{id}/address-proof {signature}: the owner proves, once, that they hold the payee address's key. */
  private async addressProof(req: IncomingMessage, res: ServerResponse, ws: string, payee: Payee | undefined): Promise<void> {
    if (payee === undefined) return this.json(res, 404, { error: 'economy: no such payee' })
    const address = typeof payee.address === 'string' ? payee.address.toLowerCase() : ''
    if (address === '') return this.json(res, 400, { error: `economy: invalid payee: ${payee.name} is paid at a bank, not at an address` })
    const { signature } = await this.body<{ signature?: string }>(req)
    const msg = proofMessage(ws, address)
    if (signerOf(msg, signature ?? '') !== address) return this.json(res, 403, { error: `economy: the signature is not the payee's address signing its proof message: sign "${msg}"` })
    this.proved.add(`${ws}\n${address}`)
    return this.json(res, 200, { proved: true })
  }

  /** B48.27 — POST /v1/money/payments on agent `agentID`'s own key: paid from its wallet in the currency. */
  async agentPay(req: IncomingMessage, res: ServerResponse, ws: string, agentID: string): Promise<void> {
    const b = await this.body<{ payee_id?: string; amount_minor?: number; currency?: string; reference?: string; idempotency_key?: string }>(req)
    const key = String(req.headers['idempotency-key'] ?? b.idempotency_key ?? '')
    const p = this.pay(ws, this.payees.get(ws) ?? [], { ...b, idempotency_key: key, account_id: this.wallet(ws, agentID, (b.currency ?? '').toUpperCase()).id })
    return 'error' in p ? this.json(res, p.status, { error: p.error }) : this.json(res, 201, p)
  }

  /** B40.29 — one payment out of an approved request's item, from `agentID`'s account in its currency (the company's for ''). */
  payItem(ws: string, agentID: string, b: { payee_id: string; amount_minor: number; currency: string; reference: string; idempotency_key: string }): Payment | { status: number; error: string } {
    const account = (this.accounts.get(ws) ?? []).find((a) => a.currency === b.currency && (a.agent_id ?? '') === agentID)
    return this.pay(ws, this.payees.get(ws) ?? [], { ...b, account_id: account?.id ?? 'none' })
  }

  /** B30.17 — one payment out, as a payment or (B30.96) a payout row makes it: each refusal as Lens words it; only compliance-live-paid moves live money. */
  private pay(ws: string, payees: Payee[], b: { payee_id?: string; amount_minor?: number; currency?: string; funding?: string; reference?: string; idempotency_key?: string; account_id?: string }): Payment | { status: number; error: string } {
    const accounts = this.accounts.get(ws) ?? []
    const payments = this.payments.get(ws) ?? []
    const currency = (b.currency ?? '').toUpperCase()
    const funding = b.funding === 'live' ? 'live' : 'test'
    const amount = b.amount_minor ?? 0
    if (!b.payee_id || !b.idempotency_key || amount <= 0 || ![...CURRENCIES, 'USDC'].includes(currency)) {
      return { status: 400, error: 'economy: invalid payment: a payment names its payee, a positive amount_minor in GBP, EUR or USD and an idempotency key' }
    }
    const again = payments.find((p) => p.idempotency_key === b.idempotency_key)
    if (again !== undefined) return again
    // B30.96 — account_id names the account; else the company's in the currency (Lens's payingAccount).
    const account = accounts.find((a) => (b.account_id ? a.id === b.account_id : a.currency === currency && a.purpose === 'company'))
    if (account === undefined || account.currency !== currency) return { status: 404, error: `economy: no such money account: no ${currency} account to pay from — open one at /v1/money/accounts` }
    const payee = payees.find((x) => x.id === b.payee_id)
    if (payee === undefined) return { status: 404, error: 'economy: no such payee' }
    const address = typeof payee.address === 'string' ? payee.address.toLowerCase() : ''
    if ((currency === 'USDC') !== (address !== '')) return { status: 400, error: 'economy: invalid payment: USDC is paid to an address, and an address only in USDC' }
    if (payee.needs_confirmation) return { status: 409, error: `economy: the payee is not confirmed: ${payee.name}'s name was a ${payee.check.replace('_', ' ')} — confirm it with a passkey first` }
    const held = this.cases.find((c) => c.subject_id === payee.id && c.status === 'held')
    if (held !== undefined) return { status: 403, error: `${HELD} (compliance case ${held.id})` }
    const cooling = payee.cooling_off_until !== undefined && Date.parse(payee.cooling_off_until) > Date.now()
    if (cooling && amount > 100_000 && !this.broken('cooling-off-skipped')) {
      return { status: 409, error: `economy: a payment of more than 1,000 to a payee saved less than 24 hours ago waits until ${payee.cooling_off_until}, ` +
        `or until the owner confirms with a passkey that they called ${payee.name} on a number they already had` }
    }
    if (typeof payee.held_until === 'string' && Date.parse(payee.held_until) > Date.now() && !this.broken('details-hold-skipped')) {
      return { status: 409, error: `economy: this payee's bank details changed less than 24 hours ago, so payments to it are held until ${payee.held_until}. ${DETAILS_NOTICE}` }
    }
    let travelRule: Record<string, string> | undefined
    if (address !== '') {
      if (address === FLAGGED_ADDRESS && !this.broken('address-unscreened')) return { status: 403, error: `screening: refused — ${address} is flagged: mixer` }
      const paid = payments.filter((x) => x.address === address && x.status !== 'failed').reduce((n, x) => n + x.amount_minor, 0)
      if (address === VASP_ADDRESS) travelRule = { status: 'sent', vasp: 'Test Exchange', provider_ref: `trt_${randomUUID()}` }
      else if (paid + amount > 1_000_000000 && !this.proved.has(`${ws}\n${address}`) && !this.broken('self-hosted-unproved')) {
        const msg = proofMessage(ws, address)
        return { status: 409, error: `economy: more than 1,000 USDC in all to a self-hosted address waits until the owner proves, once, that they hold its key: ` +
          `sign "${msg}" with ${address}'s key (personal_sign) and POST the signature to /v1/money/payees/${payee.id}/address-proof` }
      } else travelRule = { status: 'self_hosted' }
    }
    const holds = funding === 'live' ? account.live_minor : account.test_minor
    if (holds < amount && !(funding === 'live' && this.broken('compliance-live-paid'))) {
      return { status: 409, error: `economy: insufficient funds: the account holds ${money(holds, currency)} of ${funding} money, and this payment is ${money(amount, currency)}` }
    }
    const refused = amount % 100 === 13
    if (!refused || this.broken('refused-payment-held')) {
      account[funding === 'live' ? 'live_minor' : 'test_minor'] -= amount
      account.balance_minor -= amount
      this.line(ws, account, 'payment_out_hold', -amount)
    }
    const p: Payment = { id: `mpay_${randomUUID()}`, workspace_id: ws, account_id: account.id, payee_id: payee.id, payee_name: payee.name, amount_minor: amount, currency,
      funding, reference: b.reference ?? '', idempotency_key: b.idempotency_key, status: refused ? 'failed' : 'completed', created_at: new Date().toISOString(),
      ...(address === '' ? {} : { address, travel_rule: travelRule }) }
    this.payments.set(ws, [p, ...payments])
    return p
  }

  /**
   * B30.96 — mandates on an agent's account (Lens B30.19): granted, listed, revoked. Pulls are not served here. B55.56: the
   * owner's grant comes as {grant, assertion} (or the grant alone) and, once the workspace has a passkey, is made only with
   * an assertion over POST /v1/money/mandates/challenge's challenge for exactly that grant; a requested mandate is approved
   * the same way, over its own challenge, or declined.
   */
  private async mandateRoute(req: IncomingMessage, res: ServerResponse, ws: string, path: string, payees: Payee[]): Promise<boolean> {
    const list = this.mandates.get(ws) ?? []
    if (path === '/v1/money/mandates' && req.method === 'GET') {
      const status = new URL(req.url ?? '/', 'http://stub').searchParams.get('status') ?? ''
      return this.json(res, 200, { granted: list.filter((m) => status === '' || m.status === status).map(({ workspace_id: _w, ...m }) => ({ workspace_id: ws, ...m })), received: [] }), true
    }
    const signed = (key: string, a: Assertion | undefined) => this.passkeys(ws).length === 0 ? undefined : a === undefined ? MANDATE_UNSIGNED : this.refused(ws, key, a)
    if (path === '/v1/money/mandates/challenge' && req.method === 'POST') {
      const b = await this.body<{ grant?: MandateGrant; mandate_id?: string }>(req)
      const c = randomBytes(32).toString('base64url')
      this.challenges.set(b.mandate_id ? `mandate-approve:${b.mandate_id}` : grantKey(b.grant ?? {}), c)
      return this.json(res, 200, { challenge: c, allow_credentials: this.passkeys(ws).map((k) => k.credential_id), user_verification: 'required' }), true
    }
    const decide = /^\/v1\/money\/mandates\/([^/]+)\/(approve|decline)$/.exec(path)
    if (decide !== null && req.method === 'POST') {
      const m = list.find((x) => x.id === decide[1])
      if (m === undefined) return this.json(res, 404, { error: 'economy: no such mandate' }), true
      if (m.status !== 'requested') return this.json(res, 409, { error: `economy: the mandate is ${m.status}, not requested` }), true
      if (decide[2] === 'approve') {
        const refused = signed(`mandate-approve:${m.id}`, (await this.body<{ assertion?: Assertion }>(req)).assertion)
        if (refused !== undefined) return this.json(res, 403, { error: refused }), true
      }
      m.status = decide[2] === 'approve' ? 'active' : 'declined'
      return this.json(res, 200, m), true
    }
    if (path === '/v1/money/mandates' && req.method === 'POST') {
      const raw = await this.body<MandateGrant & { grant?: MandateGrant; assertion?: Assertion }>(req)
      const g = raw.grant ?? raw
      const refused = signed(grantKey(g), raw.assertion)
      if (refused !== undefined) return this.json(res, 403, { error: refused }), true
      const bad = (msg: string) => this.json(res, 400, { error: `economy: invalid mandate: ${msg}` })
      const company = (g.payee_workspace_id ?? '').trim()
      const business = (g.payee_business_id ?? '').trim()
      if ((company === '') === (business === '')) return bad('name the payee: a Talyvor company by payee_workspace_id, or an outside business by payee_business_id'), true
      if (business !== '' && (g.payee_id ?? '') === '') return bad("an outside business's pulls are paid out to a saved payee: give payee_id"), true
      if (company === ws) return bad('an agent cannot grant its own company a mandate'), true
      const account = (this.accounts.get(ws) ?? []).find((a) => a.id === g.account_id && a.purpose === 'agent')
      if (account === undefined) return this.json(res, 404, { error: "economy: no such money account: a mandate is on an agent's account" }), true
      const pull = g.max_per_pull_minor ?? 0
      const month = g.max_per_month_minor ?? 0
      if (pull <= 0 || month <= 0 || month < pull) return bad('the maximum per pull and per month are positive, and the month is at least the pull'), true
      if (Number.isNaN(Date.parse(g.expires_at ?? '')) || Date.parse(g.expires_at ?? '') <= Date.now()) return bad('expires_at is a time still to come, RFC 3339'), true
      const payee = business === '' ? undefined : payees.find((p) => p.id === g.payee_id)
      if (business !== '' && payee === undefined) return this.json(res, 404, { error: 'economy: no such payee' }), true
      const m: StubMandate = { id: `mdt_${randomUUID()}`, workspace_id: ws, agent_id: account.agent_id ?? '', account_id: account.id, currency: account.currency,
        ...(company === '' ? { payee_business_id: business, payee_id: g.payee_id } : { payee_workspace_id: company }),
        payee_name: (g.payee_name ?? '').trim() || payee?.name || company, max_per_pull_minor: pull, max_per_month_minor: month, pulled_this_month_minor: 0,
        expires_at: new Date(g.expires_at ?? '').toISOString(), status: 'active', created_at: new Date().toISOString() }
      this.mandates.set(ws, [m, ...list])
      return this.json(res, 201, business === '' ? m : { ...m, pull_key: `tlvm_${randomBytes(16).toString('hex')}` }), true
    }
    const revoke = /^\/v1\/money\/mandates\/([^/]+)\/revoke$/.exec(path)
    if (revoke === null || req.method !== 'POST') return false
    const m = list.find((x) => x.id === revoke[1])
    if (m === undefined) return this.json(res, 404, { error: 'economy: no such mandate' }), true
    if (m.status !== 'active') return this.json(res, 409, { error: 'economy: the mandate is revoked' }), true
    Object.assign(m, { status: 'revoked', revoked_at: new Date().toISOString(), revoked_by: 'owner' })
    return this.json(res, 200, m), true
  }

  /** B41.1 — the bills inbox (Lens B41.101): an invoice read into one bill, matched to a saved payee or marked new_payee. */
  private async billRoute(req: IncomingMessage, res: ServerResponse, ws: string, path: string, payees: Payee[]): Promise<boolean> {
    const list = this.bills.get(ws) ?? []
    const shown = ({ digest: _, ...b }: (typeof list)[number]) => b
    if (path === '/v1/money/bills' && req.method === 'GET') return this.json(res, 200, { bills: list.map(shown) }), true
    if (path !== '/v1/money/bills' || req.method !== 'POST') return false
    // A photo arrives as its transcription, text/plain (Lens B41.101), its first line the supplier's.
    const text = (req.headers['content-type'] ?? '').startsWith('text/plain')
    if (!text && !(req.headers['content-type'] ?? '').startsWith('application/pdf')) return this.json(res, 415, { error: 'the stub reads PDF invoices and photo transcriptions only' }), true
    const doc = await this.read(req)
    const digest = createHash('sha256').update(doc).digest('hex')
    const lines = text ? doc.split(/\r?\n/) : [...doc.matchAll(/\((.*?)\) Tj/g)].map((m) => m[1].replace(/\\(.)/g, '$1'))
    const after = (label: RegExp) => lines.map((l) => label.exec(l)?.[1]?.trim()).find((v) => v !== undefined) ?? ''
    const supplier = (lines[0] ?? '').replace(/^From:\s*/i, '')
    const number = after(/^Invoice number:\s*(\S+)$/i).toUpperCase() // as Lens's money_bills.go reads it
    const had = list.find((b) => b.digest === digest || (number !== '' && b.invoice_number === number && String(b.supplier).toLowerCase() === supplier.toLowerCase()))
    if (had !== undefined && !this.broken('bill-duplicated')) return this.json(res, 200, shown(had)), true
    const amount = /^(GBP|EUR|USD) ([\d,]+)\.(\d{2})$/.exec(after(/^Total due:\s*(.+)$/i))
    const account = after(/^Account number:\s*(\d+)$/i)
    const byDetails = payees.find((p) => account !== '' && p.account_number === account)
    const payee = byDetails ?? payees.find((p) => supplier !== '' && p.name.toLowerCase() === supplier.toLowerCase())
    const match = payee === undefined ? 'new_payee' : byDetails !== undefined || account === '' || this.broken('bill-details-unflagged') ? 'matched' : 'bank_details_differ'
    const b = { id: `bill_${randomUUID()}`, workspace_id: ws, source: new URL(req.url ?? '/', 'http://stub').searchParams.get('source') || 'upload', supplier,
      invoice_number: number, amount_minor: amount ? Number(amount[2].replace(/,/g, '')) * 100 + Number(amount[3]) : 0, currency: amount?.[1] ?? '',
      due_date: after(/^Due date:\s*(\d{4}-\d{2}-\d{2})$/i), sort_code: after(/^Sort code:\s*([\d-]+)$/i).replace(/-/g, ''), account_number: account,
      ...(payee ? { payee_id: payee.id } : {}), payee_match: match, status: 'due', missing: [], created_at: new Date().toISOString(), digest }
    this.bills.set(ws, [...list, b])
    return this.json(res, 201, shown(b)), true
  }

  /** B30.96 — bulk payouts (Lens B30.21): a CSV or JSON rows validated row by row on upload, paid once on one approval. */
  private async payoutRoute(req: IncomingMessage, res: ServerResponse, ws: string, path: string, payees: Payee[]): Promise<boolean> {
    const list = this.batches.get(ws) ?? []
    const shown = (b: StubBatch, rows: boolean) => ({ ...b, rows: rows ? b.rows : undefined })
    if (path === '/v1/money/payouts' && req.method === 'GET') return this.json(res, 200, { payouts: list.map((b) => shown(b, false)) }), true
    if (path === '/v1/money/payouts' && req.method === 'POST') {
      let rows: StubRow[]
      let key = req.headers['idempotency-key']?.toString() ?? ''
      if ((req.headers['content-type'] ?? '').startsWith('text/csv')) {
        const lines = (await this.read(req)).split(/\r?\n/).filter((l) => l.trim() !== '')
        const head = (lines[0] ?? '').split(',').map((h) => h.trim().toLowerCase())
        const col = (name: string) => head.indexOf(name)
        if (lines.length < 2) return this.json(res, 400, { error: 'the CSV has a header row — payee_id,amount,currency,reference — and then a row per payment' }), true
        for (const want of ['payee_id', 'amount', 'currency']) {
          if (col(want) < 0 && !(want === 'payee_id' && col('payee') >= 0)) return this.json(res, 400, { error: `the CSV's header names payee_id, amount, currency and reference; "${want}" is missing` }), true
        }
        rows = lines.slice(1).map((l, i) => {
          const f = l.split(',').map((x) => x.trim())
          const at = (name: string) => (col(name) >= 0 ? (f[col(name)] ?? '') : '')
          const amount = at('amount')
          const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(amount)
          return { line: i + 2, payee_id: at('payee_id') || at('payee'), amount_minor: m === null ? 0 : Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0')),
            currency: at('currency').toUpperCase(), reference: at('reference'), status: 'valid',
            ...(m === null ? { detail: `amount "${amount}" is not a positive decimal amount with up to 2 decimal places, such as 12.34` } : {}) }
        })
      } else {
        const b = await this.body<{ rows?: Partial<StubRow>[]; idempotency_key?: string }>(req)
        key = key || (b.idempotency_key ?? '')
        rows = (b.rows ?? []).map((r, i) => ({ line: i + 1, payee_id: r.payee_id ?? '', amount_minor: r.amount_minor ?? 0, currency: (r.currency ?? '').toUpperCase(), reference: r.reference ?? '', status: 'valid' }))
      }
      if (key === '') return this.json(res, 400, { error: 'economy: invalid payout batch: a batch has an idempotency key' }), true
      const again = list.find((b) => b.idempotency_key === key)
      if (again !== undefined) return this.json(res, 201, shown(again, true)), true
      if (rows.length === 0 || rows.length > 1000) return this.json(res, 400, { error: 'economy: invalid payout batch: 1 to 1,000 rows' }), true
      const accounts = this.accounts.get(ws) ?? []
      const held: Record<string, number> = {}
      const totals: Record<string, number> = {}
      for (const r of rows) {
        const payee = payees.find((p) => p.id === r.payee_id)
        const account = accounts.find((a) => a.currency === r.currency && a.purpose === 'company' && a.status === 'open')
        held[r.currency] ??= account?.test_minor ?? 0
        if (r.detail !== undefined) r.status = 'invalid'
        else if (payee === undefined) Object.assign(r, { status: 'invalid', detail: 'no such payee' })
        else if (payee.needs_confirmation) Object.assign(r, { status: 'invalid', detail: `the payee is not confirmed: ${payee.name}'s name was a ${payee.check.replace('_', ' ')}` })
        else if (r.amount_minor <= 0 || !CURRENCIES.includes(r.currency)) Object.assign(r, { status: 'invalid', detail: 'a positive amount in GBP, EUR or USD' })
        else if (account === undefined) Object.assign(r, { status: 'invalid', detail: `no ${r.currency} account to pay from — open one at /v1/money/accounts` })
        else if (held[r.currency] < r.amount_minor) {
          Object.assign(r, { status: 'invalid', detail: `the account holds ${money(held[r.currency], r.currency)} of test money after the rows before this one, and this row is ${money(r.amount_minor, r.currency)}` })
        } else {
          r.payee_name = payee.name
          held[r.currency] -= r.amount_minor
          totals[r.currency] = (totals[r.currency] ?? 0) + r.amount_minor
        }
      }
      const now = new Date().toISOString()
      const valid = rows.filter((r) => r.status === 'valid').length
      const b: StubBatch = { id: `mpob_${randomUUID()}`, workspace_id: ws, funding: 'test', idempotency_key: key, status: 'awaiting_approval', rows, rows_total: rows.length,
        rows_valid: valid, rows_invalid: rows.length - valid, totals_minor: totals, created_at: now, updated_at: now }
      this.batches.set(ws, [b, ...list])
      return this.json(res, 201, shown(b, true)), true
    }
    const one = /^\/v1\/money\/payouts\/([^/]+)(\/approve)?$/.exec(path)
    if (one === null) return false
    const b = list.find((x) => x.id === one[1])
    if (b === undefined) return this.json(res, 404, { error: 'economy: no such payout batch' }), true
    if (one[2] === undefined) return req.method === 'GET' ? (this.json(res, 200, shown(b, true)), true) : false
    if (req.method !== 'POST') return false
    if (b.status === 'awaiting_approval') {
      const now = new Date().toISOString()
      for (const r of b.rows) {
        if (r.status !== 'valid') continue
        const p = this.pay(ws, payees, { payee_id: r.payee_id, amount_minor: r.amount_minor, currency: r.currency, reference: r.reference, idempotency_key: `payout:${b.id}:${r.line}` })
        if ('error' in p) Object.assign(r, { status: 'failed', detail: p.error })
        else Object.assign(r, { status: p.status, payment_id: p.id })
      }
      Object.assign(b, { status: 'approved', approved_by: 'owner', approved_at: now, updated_at: now })
    }
    return this.json(res, 200, shown(b, true)), true
  }

  /** Why `a` does not confirm payee `id`: undefined when it is a passkey's signature over the payee's challenge. */
  /** B41.11 — the owner's passkey says they called payee `p` on a number they already had: its cooling-off ends. */
  private async called(req: IncomingMessage, res: ServerResponse, ws: string, p: Payee, challenge: boolean): Promise<void> {
    const key = `called:${p.id}`
    if (challenge) {
      const keys = this.passkeys(ws)
      if (keys.length === 0) return this.json(res, 409, { error: 'economy: a payee is confirmed with one of the workspace\'s passkeys, signing its challenge — register one first' })
      const c = randomBytes(32).toString('base64url')
      this.challenges.set(key, c)
      return this.json(res, 200, { challenge: c, allow_credentials: keys.map((k) => k.credential_id), user_verification: 'required' })
    }
    const { assertion } = await this.body<{ assertion?: Assertion }>(req)
    const refused = this.refused(ws, key, assertion)
    if (refused !== undefined) return this.json(res, 403, { error: refused })
    this.challenges.delete(key)
    delete p.cooling_off_until
    Object.assign(p, { called_at: new Date().toISOString(), called_by: assertion?.credential_id ?? '' })
    return this.json(res, 200, p)
  }

  /** B41.12 — payee `p`'s bank details changed to the body's, signed over a challenge for exactly those: every payment held 24 hours. */
  private async changeDetails(req: IncomingMessage, res: ServerResponse, ws: string, p: Payee, challenge: boolean): Promise<void> {
    const b = await this.body<Record<string, unknown>>(req)
    const fields = ['sort_code', 'account_number', 'iban', 'bic', 'routing_number', 'network', 'address'] as const
    const next: Record<string, string> = { country: typeof b.country === 'string' && b.country !== '' ? b.country : p.country }
    for (const f of fields) next[f] = typeof b[f] === 'string' ? b[f] : ''
    const account = (x: Record<string, unknown>) => ['country', ...fields].map((f) => String(x[f] ?? '')).join('|')
    if (next.iban === '' && next.account_number === '' && next.address === '') return this.json(res, 400, { error: 'economy: invalid payee: a payee has one set of account details' })
    if (account(next) === account(p)) return this.json(res, 400, { error: 'economy: invalid payee: these are the payee\'s details already' })
    const key = `details:${p.id}:${account(next)}`
    if (challenge) {
      const keys = this.passkeys(ws)
      if (keys.length === 0) return this.json(res, 409, { error: 'economy: a payee is confirmed with one of the workspace\'s passkeys, signing its challenge — register one first' })
      const c = randomBytes(32).toString('base64url')
      this.challenges.set(key, c)
      return this.json(res, 200, { challenge: c, allow_credentials: keys.map((k) => k.credential_id), user_verification: 'required', notice: DETAILS_NOTICE })
    }
    const refused = this.refused(ws, key, b.assertion as Assertion | undefined)
    if (refused !== undefined) return this.json(res, 403, { error: refused })
    this.challenges.delete(key)
    const now = Date.now()
    Object.assign(p, next, { check: 'exact_match', checked_by: 'test', checked_at: new Date(now).toISOString(), needs_confirmation: false,
      details_changed_at: new Date(now).toISOString(), held_until: new Date(now + 86_400_000).toISOString(), notice: DETAILS_NOTICE })
    return this.json(res, 200, p)
  }

  private refused(ws: string, id: string, a: Assertion | undefined): string | undefined {
    if (a === undefined) return 'economy: a payee is confirmed with one of the workspace\'s passkeys, signing its challenge — register one first'
    const spki = this.passkeys(ws).find((k) => k.credential_id === a.credential_id)?.public_key
    if (!spki) return 'passkey: the passkey ceremony is not valid: not one of the workspace\'s passkeys'
    const cdj = Buffer.from(a.client_data_json ?? '', 'base64url')
    const ad = Buffer.from(a.authenticator_data ?? '', 'base64url')
    let cd: { type?: string; challenge?: string } = {}
    try { cd = JSON.parse(cdj.toString()) } catch { /* refused below */ }
    if (cd.type !== 'webauthn.get' || cd.challenge === undefined || cd.challenge !== this.challenges.get(id)) return 'passkey: the passkey ceremony is not valid: the assertion answers another challenge'
    if (ad.length < 37 || (ad[32] & 0x05) !== 0x05) return 'passkey: the passkey ceremony is not valid: the user was not verified'
    const key = createPublicKey({ key: Buffer.from(spki, 'base64url'), format: 'der', type: 'spki' })
    const signed = Buffer.concat([ad, createHash('sha256').update(cdj).digest()])
    if (!verify('sha256', signed, key, Buffer.from(a.signature ?? '', 'base64url'))) return 'passkey: the passkey ceremony is not valid: the signature does not verify'
    return undefined
  }
  /** B30.14 — what a payer pays into `a`: the Test partner's details reach no bank, so none (B49.1), and an agent account's payment reference. */
  private details(_ws: string, a: Account): { payment_reference?: string } & Record<string, unknown> {
    return { account_id: a.id, currency: a.currency, ...(a.purpose === 'agent' ? { payment_reference: this.references.get(a.id) } : {}), mode: 'TEST' }
  }

  /** An invoice as Lens answers it: payments only once there are any (omitempty). */
  private invoice(i: StubInvoice): object {
    return { ...i, payments: i.payments.length === 0 ? undefined : i.payments }
  }

  /** B30.130 — an account's details, the invoices and an agent's payment of one, on workspace `ws`'s key: true when `path` was one of them. */
  private async invoiceRoute(req: IncomingMessage, res: ServerResponse, ws: string, path: string): Promise<boolean> {
    const accounts = this.accounts.get(ws) ?? []
    const details = /^\/v1\/money\/accounts\/([^/]+)\/details$/.exec(path)
    if (details !== null && req.method === 'GET') {
      const a = accounts.find((x) => x.id === details[1])
      if (a === undefined) return this.json(res, 404, { error: 'economy: no such money account' }), true
      return this.json(res, 200, this.details(ws, a)), true
    }
    if (path === '/v1/money/invoices' && req.method === 'GET') return this.json(res, 200, { invoices: this.invoices.filter((i) => i.workspace_id === ws).map((i) => this.invoice(i)) }), true
    if (path === '/v1/money/invoices' && req.method === 'POST') {
      const b = await this.body<{ account_id?: string; customer_name?: string; customer_email?: string; lines?: Partial<Line>[]; due_date?: string; send?: boolean }>(req)
      const lines: Line[] = (b.lines ?? []).map((l) => {
        const net = (l.quantity ?? 0) * (l.unit_amount_minor ?? 0)
        return { description: l.description ?? '', quantity: l.quantity ?? 0, unit_amount_minor: l.unit_amount_minor ?? 0, vat_rate_bps: l.vat_rate_bps ?? 0, net_minor: net,
          vat_minor: Math.floor((net * (l.vat_rate_bps ?? 0) + 5000) / 10000) }
      })
      if ((b.customer_name ?? '') === '' || lines.length === 0 || !/^\d{4}-\d{2}-\d{2}$/.test(b.due_date ?? '') || lines.some((l) => l.quantity <= 0 || l.unit_amount_minor <= 0)) {
        return this.json(res, 400, { error: 'economy: invalid invoice: a customer, 1 to 100 lines above zero and a due date, YYYY-MM-DD' }), true
      }
      const account = accounts.find((a) => a.id === b.account_id && a.purpose === 'agent')
      if (account === undefined) return this.json(res, 404, { error: `economy: no such money account: no agent account ${b.account_id ?? ''} to be paid into` }), true
      const subtotal = lines.reduce((n, l) => n + l.net_minor, 0)
      const vat = lines.reduce((n, l) => n + l.vat_minor, 0)
      const now = new Date().toISOString()
      const token = randomBytes(24).toString('hex')
      const inv: StubInvoice = { id: `inv_${randomUUID()}`, workspace_id: ws, agent_id: account.agent_id ?? '', account_id: account.id, issuer: `${ws} Ltd`,
        number: `INV-${String(this.invoices.filter((i) => i.workspace_id === ws).length + 1).padStart(6, '0')}`, reference: randomBytes(6).toString('hex'),
        pay_token: token, pay_url: `${this.appURL}/pay/${token}`, currency: account.currency, customer_name: b.customer_name ?? '', customer_email: b.customer_email, lines,
        subtotal_minor: subtotal, vat_minor: vat, total_minor: subtotal + vat, paid_minor: 0, due_minor: subtotal + vat, due_date: b.due_date ?? '', remind_days_before: 0,
        status: b.send ? 'sent' : 'draft', ...(b.send ? { sent_at: now } : {}), created_at: now, payments: [] }
      this.invoices.push(inv)
      return this.json(res, 201, this.invoice(inv)), true
    }
    // B30.97 — a draft is sent (its pay link opens); a draft or sent one is voided.
    const move = /^\/v1\/money\/invoices\/([^/]+)\/(send|void)$/.exec(path)
    if (move !== null && req.method === 'POST') {
      const inv = this.invoices.find((i) => i.id === move[1] && i.workspace_id === ws)
      if (inv === undefined) return this.json(res, 404, { error: 'economy: no such invoice' }), true
      const now = new Date().toISOString()
      if (move[2] === 'send' && inv.status !== 'draft') return this.json(res, 409, { error: `economy: the invoice's state does not allow this: it is ${inv.status}` }), true
      if (move[2] === 'void' && (inv.status === 'paid' || inv.status === 'void')) return this.json(res, 409, { error: `economy: the invoice's state does not allow this: it is ${inv.status}` }), true
      Object.assign(inv, move[2] === 'send' ? { status: 'sent', sent_at: now } : { status: 'void', voided_at: now })
      return this.json(res, 200, this.invoice(inv)), true
    }
    const pay = /^\/v1\/pay\/([^/]+)\/agent$/.exec(path)
    if (pay === null || req.method !== 'POST') return false
    const inv = this.invoices.find((i) => i.pay_token === pay[1] && i.status !== 'draft')
    if (inv === undefined) return this.json(res, 404, { error: 'economy: no such invoice' }), true
    const { agent_id: agentID = '' } = await this.body<{ agent_id?: string }>(req)
    if (agentID === '') return this.json(res, 400, { error: 'agent_id names the agent that pays' }), true
    const from = accounts.find((a) => a.purpose === 'agent' && a.agent_id === agentID && a.currency === inv.currency && a.status === 'open')
    if (from === undefined) return this.json(res, 404, { error: `economy: no such money account: the agent has no open ${inv.currency} account to pay from` }), true
    if (inv.status === 'paid' || inv.status === 'void') return this.json(res, 409, { error: `economy: the invoice's state does not allow this: it is ${inv.status}` }), true
    // STUB_BREAK=invoice-paid-unmoved — the invoice is marked paid without asking what the payer holds, and no account moves.
    if (!this.broken('invoice-paid-unmoved')) {
      if (from.test_minor < inv.due_minor) {
        return this.json(res, 409, { error: `economy: the account does not hold enough to pay this invoice: it holds ${money(from.test_minor, inv.currency)} of test money, ` +
          `and ${money(inv.due_minor, inv.currency)} is due` }), true
      }
      const to = [...this.accounts.values()].flat().find((a) => a.id === inv.account_id)
      from.test_minor -= inv.due_minor
      from.balance_minor -= inv.due_minor
      if (to !== undefined) {
        to.test_minor += inv.due_minor
        to.balance_minor += inv.due_minor
      }
    }
    const now = new Date().toISOString()
    const entry = { id: `me_${randomUUID()}`, workspace_id: ws, kind: 'invoice_payment', funding: 'test', amount_minor: inv.due_minor, currency: inv.currency, created_at: now }
    inv.payments.push({ entry_id: entry.id, method: 'agent', amount_minor: inv.due_minor, paid_at: now })
    Object.assign(inv, { paid_minor: inv.total_minor, due_minor: 0, status: 'paid', paid_at: now })
    return this.json(res, 200, { invoice: this.invoice(inv), entry }), true
  }

  /** B30.20 — the pay page behind an invoice's link, read with no credential: the invoice without the issuer's ids, how to pay it.
   *  B30.97 — its card button (a checkout URL) and the stub's own checkout page, which pays what is due with the 4242 card. */
  async payPage(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> {
    const m = /^\/v1\/pay\/([^/]+)$/.exec(path)
    if (m !== null && req.method === 'GET') {
      const inv = this.invoices.find((i) => i.pay_token === m[1] && i.status !== 'draft')
      if (inv === undefined) return this.json(res, 404, { error: 'economy: no such invoice' }), true
      const { workspace_id: _w, agent_id: _a, account_id: _c, pay_token: _t, payments: _p, ...shown } = inv
      const payable = inv.status === 'sent' || inv.status === 'overdue'
      // The Test partner's details reach no bank, so the page offers no transfer (Lens B49.1).
      return this.json(res, 200, { card: payable, invoice: shown }), true
    }
    const card = /^\/v1\/pay\/([^/]+)\/card$/.exec(path)
    if (card !== null && req.method === 'POST') {
      const inv = this.invoices.find((i) => i.pay_token === card[1] && i.status !== 'draft')
      if (inv === undefined) return this.json(res, 404, { error: 'economy: no such invoice' }), true
      if ((inv.status !== 'sent' && inv.status !== 'overdue') || inv.due_minor <= 0) return this.json(res, 409, { error: `the invoice is ${inv.status}: nothing is due on it` }), true
      return this.json(res, 201, { url: `${this.base}/stub-invoice-checkout/${inv.pay_token}` }), true
    }
    const checkout = /^\/stub-invoice-checkout\/([^/]+)$/.exec(path)
    if (checkout === null) return false
    const inv = this.invoices.find((i) => i.pay_token === checkout[1])
    if (inv === undefined) return this.json(res, 404, { error: 'no such checkout' }), true
    if (req.method !== 'POST') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(`<!doctype html><html><head><title>Stub checkout</title></head><body><form method="post">
<h1>Pay invoice ${inv.number}</h1>
<label>Email <input id="email" name="email"></label>
<label>Card number <input id="cardNumber" name="card"></label>
<label>Expiry <input id="cardExpiry" name="expiry"></label>
<label>CVC <input id="cardCvc" name="cvc"></label>
<label>Name on card <input id="billingName" name="name"></label>
<button type="submit" data-testid="hosted-payment-submit-button">Pay</button>
</form></body></html>`)
      return true
    }
    const form = new URLSearchParams(await this.read(req))
    if ((form.get('card') ?? '').replace(/\s/g, '') !== '4242424242424242') {
      res.writeHead(402, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end('<!doctype html><p>Your card was declined.</p>')
      return true
    }
    if (inv.status === 'sent' || inv.status === 'overdue') {
      const now = new Date().toISOString()
      const to = (this.accounts.get(inv.workspace_id) ?? []).find((a) => a.id === inv.account_id)
      // STUB_BREAK=invoice-card-unposted — the invoice reads paid and the issuer's account is credited nothing.
      if (to !== undefined && !this.broken('invoice-card-unposted')) {
        to.test_minor += inv.due_minor
        to.balance_minor += inv.due_minor
      }
      inv.payments.push({ entry_id: `me_${randomUUID()}`, method: 'card', amount_minor: inv.due_minor, paid_at: now })
      Object.assign(inv, { paid_minor: inv.total_minor, due_minor: 0, status: 'paid', paid_at: now })
    }
    res.writeHead(303, { Location: `${inv.pay_url}?paid=card` })
    res.end()
    return true
  }
}
