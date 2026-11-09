// B48.29 — a month on an agent's wallet, read back as its history, its statement and the tax export (Lens B48.14), on Lens's
// API, once a run, on a workspace of its own. A payment in: Treasury's GBP account is funded by an invoice paid by card. A move
// to the agent: Treasury pays an invoice from Spender's GBP account. A card charge: Spender's single-use card, approved once,
// is charged by the issuer. Then the owner reads Spender's and Treasury's activity, each one's statement as JSON, CSV and PDF,
// and the tax export. Each closing balance must be the ledger's balance for that account (GET /v1/money/accounts), never a
// status code; Spender's must be the move less the charge; the newest activity line must carry the same balance; and a month
// with no token on a chain has nothing for the accountant to cost.

import { randomBytes } from 'node:crypto'
import { fail } from './bank.ts'
import type { Answered } from './lens.ts'
import { RUN_SALT } from './oracles.ts'
import { payInvoiceByCard } from './payScreen.ts'
import { said } from './routes.ts'
import type { Scenario, ScenarioCtx } from './scenarios.ts'

/** A currency account as Lens lists it (economy.CurrencyAccount): what the ledger holds for it, test and live apart. */
interface Account { id: string; test_minor: number; live_minor: number }
/** One posting on a wallet's account (economy.WalletLine). */
export interface WalletLine { entry_id: string; account_id: string; kind: string; amount_minor: number; balance_after_minor: number }
/** One account over a statement's month (economy.WalletAccount). */
export interface WalletAccount { account_id: string; opening_minor: number; in_minor: number; out_minor: number; closing_minor: number }
/** The accountant's export (economy.TaxExport). */
export interface TaxExport { currency: string; disposals: unknown[] | null; unpriced: unknown[] | null; proceeds_minor: number; cost_basis_minor: number; gain_minor: number }

/** One agent's month as the owner reads it back. */
export interface AgentMonth {
  name: string
  /** Its GBP account. */
  account: string
  /** Lines its account must carry, each once: a kind and, where it is known here, its amount. */
  made: { kind: string; amount_minor?: number }[]
  /** Its closing balance, where it is known here. */
  closing?: number
  statement: { accounts: WalletAccount[] | null; lines: WalletLine[] | null }
  csv: string
  pdf: string
  /** Its activity, newest first. */
  activity: WalletLine[]
}

const CAPABILITIES = ['currency_accounts', 'payments_in', 'payments_out', 'agent_card']
const FUND_MINOR = 10_000
const MOVE_MINOR = 5_000
const CAP_MINOR = 3_000
const SPEND_MINOR = 1_234
const MERCHANT = 'Northwind Cloud Hosting'
const DAY_MS = 86_400_000

/** Lens's economy.FormatMinor for a two-place currency. */
const formatMinor = (minor: number, currency: string) => `${minor < 0 ? '-' : ''}${(Math.abs(minor) / 100).toFixed(2)} ${currency}`

/** The CSV statement's closing rows: account id → closing balance. Closing rows carry no memo, so a plain split reads them. */
export function csvClosings(csv: string): Map<string, number> {
  const out = new Map<string, number>()
  for (const row of csv.split(/\r?\n/)) {
    const f = row.split(',')
    if (f.length === 13 && f[6] === 'closing') out.set(f[3], Number(f[12]))
  }
  return out
}

/**
 * The oracle: every account on each agent's statement closes at the ledger's balance for it — in the JSON, the CSV and the
 * PDF — and adds up (opening + in − out); each line made is on it once; a closing known here is that figure; the newest
 * activity line on the account carries the ledger's balance; and the tax export has no disposal, no unpriced movement
 * and no gain, as a month with no token on a chain must.
 */
export function walletStatementsVerdict(ledger: ReadonlyMap<string, number>, months: readonly AgentMonth[], tax: TaxExport): { pass: boolean; detail: string } {
  const wrong: string[] = []
  for (const m of months) {
    const accounts = m.statement.accounts ?? []
    const lines = m.statement.lines ?? []
    if (!accounts.some((a) => a.account_id === m.account)) wrong.push(`${m.name}'s statement has no line for its GBP account ${m.account}`)
    const csv = csvClosings(m.csv)
    for (const a of accounts) {
      const held = ledger.get(a.account_id)
      if (held === undefined) { wrong.push(`${m.name}'s statement closes ${a.account_id}, an account the ledger does not list`); continue }
      if (a.closing_minor !== held) wrong.push(`${m.name}'s statement closes ${a.account_id} at ${a.closing_minor}; the ledger holds ${held}`)
      if (a.opening_minor + a.in_minor - a.out_minor !== a.closing_minor) {
        wrong.push(`${m.name}'s ${a.account_id} opens at ${a.opening_minor}, takes in ${a.in_minor} and pays out ${a.out_minor}, which is not its closing ${a.closing_minor}`)
      }
      if (csv.get(a.account_id) !== held) wrong.push(`${m.name}'s CSV statement closes ${a.account_id} at ${csv.get(a.account_id) ?? 'nothing'}; the ledger holds ${held}`)
    }
    const held = ledger.get(m.account)
    if (held !== undefined) {
      if (m.closing !== undefined && held !== m.closing) wrong.push(`the ledger holds ${held} on ${m.name}'s GBP account, not the ${m.closing} its month adds up to`)
      if (!m.pdf.startsWith('%PDF-')) wrong.push(`${m.name}'s PDF statement is not a PDF: ${JSON.stringify(m.pdf.slice(0, 40))}`)
      else if (!m.pdf.includes(`closing ${formatMinor(held, 'GBP')}`)) wrong.push(`${m.name}'s PDF statement does not close its GBP account at ${formatMinor(held, 'GBP')}`)
      const newest = m.activity.find((l) => l.account_id === m.account)
      if (newest?.balance_after_minor !== held) wrong.push(`${m.name}'s newest activity line leaves ${newest?.balance_after_minor ?? 'nothing'}; the ledger holds ${held}`)
    }
    for (const want of m.made) {
      const n = lines.filter((l) => l.account_id === m.account && l.kind === want.kind && (want.amount_minor === undefined || l.amount_minor === want.amount_minor)).length
      if (n !== 1) wrong.push(`${m.name}'s statement has ${n} ${want.kind} line(s)${want.amount_minor === undefined ? '' : ` of ${want.amount_minor}`}, want one`)
    }
    const listed = new Set(m.activity.filter((l) => l.account_id === m.account).map((l) => l.entry_id))
    const missing = lines.filter((l) => l.account_id === m.account && !listed.has(l.entry_id)).map((l) => l.kind)
    if (missing.length > 0) wrong.push(`${m.name}'s activity leaves out what its statement lists: ${missing.join(', ')}`)
  }
  if (tax.currency === '' || (tax.disposals ?? []).length > 0 || (tax.unpriced ?? []).length > 0 || tax.proceeds_minor !== 0 || tax.cost_basis_minor !== 0 || tax.gain_minor !== 0) {
    wrong.push(`with no token on a chain the tax export has nothing to cost; Lens exports ${JSON.stringify(tax).slice(0, 300)}`)
  }
  return wrong.length === 0
    ? { pass: true, detail: `${months.map((m) => `${m.name} closes at ${formatMinor(ledger.get(m.account) ?? 0, 'GBP')} in JSON, CSV, PDF and its newest activity, as the ledger`).join('; ')}; the tax export, in ${tax.currency}, has nothing to cost` }
    : { pass: false, detail: wrong.join('; ') }
}

export function walletStatements(fund: (ctx: ScenarioCtx, token: string) => Promise<string | undefined> = payInvoiceByCard): Scenario {
  return {
    id: 'wallet-statements',
    owner: 'talyvor-lens',
    own: true,
    agents: 2,
    feature: 'Agent Wallets',
    items: ['B48.14', 'B48.29'],
    title: "a month on an agent's wallet — a payment in, a move to the agent, a card charge — read back as activity, a statement in JSON, CSV and PDF " +
      'and the tax export: every closing balance is the ledger\'s, and a month with no token on a chain has nothing to cost',
    run: async (ctx) => {
      const { lens } = ctx.env
      const user = ctx.app.user
      const call = async <T>(method: string, path: string, body: object | undefined, note: string): Promise<Answered<T>> => {
        const got = await lens.act<T>(user, method, path, body)
        ctx.evidence.push({ note, answer: said(got) })
        return got
      }
      const invoice = async (account: string, customer: string, minor: number): Promise<string> => {
        const sent = await call<{ pay_token?: string }>('POST', '/v1/money/invoices', { account_id: account, customer_name: customer,
          lines: [{ description: 'Wallet statements', quantity: 1, unit_amount_minor: minor, vat_rate_bps: 0 }],
          due_date: new Date(Date.now() + 30 * DAY_MS).toISOString().slice(0, 10), send: true }, `an invoice of ${minor} minor to ${customer}`)
        return sent.status === 201 && sent.ok ? sent.value.pay_token ?? '' : ''
      }

      // 1. The terms, the company's GBP account, and two agents with GBP accounts of their own.
      const terms = await call<{ terms: { capability: string; version: number; accepted?: unknown }[] | null }>('GET', '/v1/workspaces/{ws}/terms', undefined, 'the owner reads the terms')
      if (!terms.ok) return fail(`reading the workspace's terms answered ${said(terms)}`)
      for (const t of (terms.value.terms ?? []).filter((x) => CAPABILITIES.includes(x.capability) && x.accepted == null)) {
        const ok = await call('POST', `/v1/workspaces/{ws}/terms/${t.capability}/accept`, { version: t.version }, `the owner accepts ${t.capability}'s terms`)
        if (ok.status !== 201) return fail(`accepting ${t.capability}'s terms answered ${said(ok)}`)
      }
      const company = await call<Account>('POST', '/v1/money/accounts', { currency: 'GBP' }, "the owner opens the company's GBP account")
      if (company.status !== 201) return fail(`opening the company's GBP account must answer 201; Lens answered ${said(company)}`)
      const open = async (name: string) => {
        const agent = await lens.createAgent(user, `${name} ${RUN_SALT}`)
        const opened = await call<Account>('POST', '/v1/money/accounts', { currency: 'GBP', agent_id: agent.id }, `the owner opens ${agent.name}'s GBP account`)
        return opened.status === 201 && opened.ok ? { ...agent, account: opened.value.id } : `opening ${agent.name}'s GBP account must answer 201; Lens answered ${said(opened)}`
      }
      const treasury = await open('Treasury')
      if (typeof treasury === 'string') return fail(treasury)
      const spender = await open('Spender')
      if (typeof spender === 'string') return fail(spender)

      // 2. A payment in: Treasury's invoice paid by card.
      const funding = await invoice(treasury.account, `Wallet statements funding ${RUN_SALT}`, FUND_MINOR)
      if (funding === '') return fail("issuing Treasury's funding invoice failed")
      const unpaid = await fund(ctx, funding)
      if (unpaid !== undefined) return fail(unpaid)

      // 3. A move to the agent: Treasury pays Spender's invoice from its account.
      const owed = await invoice(spender.account, treasury.name, MOVE_MINOR)
      if (owed === '') return fail("issuing Spender's invoice to Treasury failed")
      const moved = await call('POST', `/v1/pay/${owed}/agent`, { agent_id: treasury.id }, `${treasury.name} pays ${spender.name}'s invoice of ${MOVE_MINOR} minor`)
      if (!moved.ok) return fail(`${treasury.name} paying ${spender.name}'s invoice from an account holding ${FUND_MINOR} must be done; Lens answered ${said(moved)}`)

      // 4. A card charge: Spender's single-use card, approved once, charged by the issuer.
      const asked = await call<{ id: string }>('POST', '/v1/money/cards', { agent_id: spender.id, purpose: 'Wallet statements', currency: 'GBP',
        idempotency_key: `e2e-wallet-statements-${randomBytes(4).toString('hex')}`, cards: [{ merchant: MERCHANT, cap_minor: CAP_MINOR }] }, `the owner asks for ${spender.name}'s card`)
      if (asked.status !== 201 || !asked.ok) return fail(`asking for ${spender.name}'s card answered ${said(asked)}`)
      const approved = await call<{ status: string; cards: { id: string }[] | null }>('POST', `/v1/money/cards/${asked.value.id}/approve`, {}, 'the owner approves it once')
      const card = approved.ok ? approved.value.cards?.[0] : undefined
      if (!approved.ok || approved.value.status !== 'issued' || card === undefined) return fail(`approving the card must answer issued; Lens answered ${said(approved)}`)
      const charged = await lens.chargeTestCard(user, card.id, { merchant: MERCHANT, amount_minor: SPEND_MINOR })
      ctx.evidence.push({ note: `the issuer charges ${SPEND_MINOR} minor at ${MERCHANT}`, answer: said(charged) })
      if (!charged.ok || !charged.value.approved) return fail(`a ${SPEND_MINOR} minor charge on a card capped at ${CAP_MINOR} must be approved; Lens answered ${said(charged)}`)

      // 5. Read back: the ledger, each agent's activity and statement in three formats, and the tax export.
      const accounts = await call<{ accounts: Account[] | null }>('GET', '/v1/money/accounts', undefined, "the ledger's balances")
      if (!accounts.ok) return fail(`listing the accounts answered ${said(accounts)}`)
      const ledger = new Map((accounts.value.accounts ?? []).map((a) => [a.id, a.test_minor + a.live_minor]))
      const read = async (path: string, note: string) => {
        const got = await lens.as(user.token, 'GET', path.replace('{ws}', user.workspaceID))
        ctx.evidence.push({ note, answer: `${got.status} ${got.text.slice(0, 600)}` })
        return got.status === 200 ? got.text : undefined
      }
      const months: AgentMonth[] = []
      for (const [a, made, closing] of [
        [treasury, [{ kind: 'invoice_card' }, { kind: 'invoice_payment', amount_minor: -MOVE_MINOR }], undefined],
        [spender, [{ kind: 'invoice_payment', amount_minor: MOVE_MINOR }, { kind: 'card_hold', amount_minor: -CAP_MINOR }, { kind: 'card_charge', amount_minor: CAP_MINOR - SPEND_MINOR }], MOVE_MINOR - SPEND_MINOR],
      ] as const) {
        const base = `/v1/workspaces/{ws}/agents/${a.id}/wallet`
        const json = await read(`${base}/statement`, `${a.name}'s statement`)
        const csv = await read(`${base}/statement?format=csv`, `${a.name}'s statement as CSV`)
        const pdf = await read(`${base}/statement?format=pdf`, `${a.name}'s statement as PDF`)
        const activity = await read(`${base}/activity`, `${a.name}'s activity`)
        if (json === undefined || csv === undefined || pdf === undefined || activity === undefined) return fail(`the owner could not read ${a.name}'s statement or activity (evidence)`)
        months.push({ name: a.name, account: a.account, made: [...made], closing, statement: JSON.parse(json), csv, pdf, activity: (JSON.parse(activity) as { lines: WalletLine[] | null }).lines ?? [] })
      }
      const tax = await read('/v1/workspaces/{ws}/wallet/tax', 'the tax export')
      if (tax === undefined) return fail('the owner could not read the tax export (evidence)')
      return walletStatementsVerdict(ledger, months, JSON.parse(tax) as TaxExport)
    },
  }
}
