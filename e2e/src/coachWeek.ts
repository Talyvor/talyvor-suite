// B53.14 — a week of spending with the Coach (Lens B53.3–B53.7), on Lens's API, once a run, on a workspace of its own. The owner
// funds an agent's GBP account with £200.00 (an invoice from it, paid by card, as agent-cards does) and sets a £50.00 monthly
// eating-out budget on that agent. Two batches of the agent's single-use cards, each approved once, are charged by the issuer
// at their merchants (Lens B53.18's synthetic charge, the issuer's details for each merchant: its MCC and country): Tesco,
// Pret A Manger and TfL Travel, then Pret A Manger again, Tesco again for the same amount, and Marriott Lisbon. Lens must put
// each payment in its category; the second Pret crosses £40 of the £50 budget and raises exactly one 80% alert, still one when
// read again; the second Tesco is a likely duplicate and Lisbon a new country, and the first Tesco is neither. Every sentence
// of the Coach's report must pass the Coach's own validator (each number one of its fact's, no product, no other merchant),
// read here again; and "which loan should I take" gets the free-help pointers and no product.

import { randomBytes } from 'node:crypto'
import { fail } from './bank.ts'
import type { Answered } from './lens.ts'
import { RUN_SALT } from './oracles.ts'
import { payInvoiceByCard } from './payScreen.ts'
import { said } from './routes.ts'
import { CannotTest, type Scenario, type ScenarioCtx } from './scenarios.ts'

interface Account { id: string; test_minor: number }
interface Card { id: string; merchant: string }
interface Batch { id: string; status: string; cards: Card[] | null }
interface Payment { entry_id: string; agent_id: string; merchant: string; mcc: string; country: string; category: string; amount_minor: number; currency: string }
interface Finding { rule: string; entry_id?: string; merchant?: string; country?: string; amount_minor?: number }
interface Alert { kind: string; subject: string; percent: number; spent_minor: number; limit_minor: number }
interface Fact { kind: string; merchant?: string; country?: string; category?: string; [k: string]: unknown }
interface Line { fact: Fact; sentence: string; source: string }
interface Help { name: string; url: string }

const CAPABILITIES = ['currency_accounts', 'payments_in', 'payments_out', 'agent_card']
const FUND_MINOR = 20_000
const BUDGET_MINOR = 5_000
const DAY_MS = 86_400_000
// The week, in the order the issuer charges it; each batch is one merchant a card, so the repeats are a second batch.
const WEEK = [
  [{ merchant: 'Tesco', minor: 2_400, category: 'groceries' }, { merchant: 'Pret A Manger', minor: 3_000, category: 'eating_out' },
    { merchant: 'TfL Travel', minor: 840, category: 'transport' }],
  [{ merchant: 'Pret A Manger', minor: 1_200, category: 'eating_out' }, { merchant: 'Tesco', minor: 2_400, category: 'groceries' },
    { merchant: 'Marriott Lisbon', minor: 9_000, category: 'travel' }],
]
const MERCHANTS = [...new Set(WEEK.flat().map((c) => c.merchant))]
const DEBT_HELP = ['StepChange', 'National Debtline', 'MoneyHelper']

// The Coach's validator (Lens internal/economy/coach.go coachValid), read again on what Lens answered.
const PRODUCT_WORDS = /\b(loans?|borrow\w*|credit|overdraft\w*|mortgages?|isas?|invest\w*|savings? accounts?|insurance|insure\w*|pensions?|stocks?|shares|crypto\w*|debts?|interest rates?|bank accounts?)\b/i
const NUMBER = /\d+(?:[.,]\d+)*/g

/** Why `l`'s sentence may not stand for its fact, or '' when it may. */
export function coachInvalid(l: Line, merchants: string[]): string {
  const { sentence, fact } = l
  if (sentence === '' || sentence.length > 240 || /[\r\n]/.test(sentence)) return 'it is empty, longer than 240 characters or more than one line'
  if (PRODUCT_WORDS.test(sentence)) return `it names a product: "${PRODUCT_WORDS.exec(sentence)?.[0]}"`
  let s = sentence.toLowerCase()
  if ((fact.merchant ?? '').length >= 3) s = s.replaceAll((fact.merchant ?? '').toLowerCase(), 'merchant')
  const figures = JSON.stringify({ ...fact, merchant: undefined, country: undefined, category: undefined })
  const allowed = new Set((figures.match(NUMBER) ?? []).map((n) => n.replaceAll(',', '')))
  const stray = (s.match(NUMBER) ?? []).find((n) => !allowed.has(n.replaceAll(',', '')))
  if (stray !== undefined) return `it says ${stray}, which is not one of its fact's figures ${figures}`
  const other = merchants.find((m) => s.includes(m.toLowerCase()))
  return other === undefined ? '' : `it names ${other}, a merchant that is not its fact's`
}

export function coachWeek(fund: (ctx: ScenarioCtx, token: string) => Promise<string | undefined> = payInvoiceByCard): Scenario {
  return {
    id: 'coach-week',
    owner: 'talyvor-lens',
    own: true,
    agents: 1,
    feature: 'Agent Wallets',
    items: ['B53.14'],
    title: 'a week of spending with the Coach: six card payments land in their categories, a £50.00 eating-out budget crossing 80% alerts ' +
      'once, a duplicate and a new country are unusual, every Coach sentence passes its validator, and a loan question gets the free-help pointers',
    run: async (ctx) => {
      const { lens } = ctx.env
      const user = ctx.app.user
      const call = async <T>(method: string, path: string, body: object | undefined, note: string): Promise<Answered<T>> => {
        const got = await lens.act<T>(user, method, path, body)
        ctx.evidence.push({ note, answer: said(got) })
        return got
      }

      // 1. The agent's GBP account, funded by card, and its eating-out budget.
      const terms = await call<{ terms: { capability: string; version: number; accepted?: unknown }[] | null }>('GET', '/v1/workspaces/{ws}/terms', undefined, 'the owner reads the terms')
      if (!terms.ok) return fail(`reading the workspace's terms answered ${said(terms)}`)
      for (const t of (terms.value.terms ?? []).filter((x) => CAPABILITIES.includes(x.capability) && x.accepted == null)) {
        const ok = await call('POST', `/v1/workspaces/{ws}/terms/${t.capability}/accept`, { version: t.version }, `the owner accepts ${t.capability}'s terms`)
        if (ok.status !== 201) return fail(`accepting ${t.capability}'s terms answered ${said(ok)}`)
      }
      const company = await call<Account>('POST', '/v1/money/accounts', { currency: 'GBP' }, "the owner opens the company's GBP account")
      if (company.status !== 201) return fail(`opening the company's GBP account must answer 201; Lens answered ${said(company)}`)
      const agent = await lens.createAgent(user, `Coach week ${RUN_SALT}`)
      const opened = await call<Account>('POST', '/v1/money/accounts', { currency: 'GBP', agent_id: agent.id }, `the owner opens ${agent.name}'s GBP account`)
      if (opened.status !== 201 || !opened.ok) return fail(`opening the agent's GBP account must answer 201; Lens answered ${said(opened)}`)
      const invoice = await call<{ pay_url?: string }>('POST', '/v1/money/invoices', {
        account_id: opened.value.id, customer_name: `Coach week funding ${RUN_SALT}`, lines: [{ description: 'Funding', quantity: 1, unit_amount_minor: FUND_MINOR, vat_rate_bps: 0 }],
        due_date: new Date(Date.now() + 30 * DAY_MS).toISOString().slice(0, 10), send: true,
      }, `the owner sends a ${FUND_MINOR} minor invoice from the agent's account, to fund it`)
      const token = /\/pay\/([A-Za-z0-9_-]+)/.exec(invoice.ok ? invoice.value.pay_url ?? '' : '')?.[1] ?? ''
      if (invoice.status !== 201 || token === '') return fail(`issuing the funding invoice answered ${said(invoice)}`)
      const unpaid = await fund(ctx, token)
      if (unpaid !== undefined) return fail(unpaid)
      const budget = await call<{ id: string }>('PUT', '/v1/money/budgets', { agent_id: agent.id, category: 'eating_out', period: 'month', amount_minor: BUDGET_MINOR,
        currency: 'GBP', timezone: 'UTC' }, `a GBP 50.00 monthly eating-out budget on ${agent.name}`)
      if (budget.status !== 200 || !budget.ok) return fail(`setting the eating-out budget answered ${said(budget)}`)

      // 2. The week: each batch of cards approved once, then each card charged by the issuer at its merchant.
      const charged: { merchant: string; minor: number; category: string; authorization: string }[] = []
      for (const [n, batch] of WEEK.entries()) {
        const asked = await call<Batch>('POST', '/v1/money/cards', { agent_id: agent.id, purpose: `Coach week ${n + 1}`, currency: 'GBP',
          idempotency_key: `e2e-coach-week-${n}-${randomBytes(4).toString('hex')}`, cards: batch.map((c) => ({ merchant: c.merchant, cap_minor: c.minor })) },
        `the owner asks for ${agent.name}'s cards, batch ${n + 1}`)
        if (asked.status !== 201 || !asked.ok) return fail(`asking for batch ${n + 1} of cards answered ${said(asked)}`)
        const approved = await call<Batch>('POST', `/v1/money/cards/${asked.value.id}/approve`, {}, `the owner approves batch ${n + 1} once`)
        if (approved.status !== 200 || !approved.ok || approved.value.status !== 'issued') return fail(`approving batch ${n + 1} must answer 200 issued; Lens answered ${said(approved)}`)
        for (const c of batch) {
          const card = (approved.value.cards ?? []).find((x) => x.merchant === c.merchant)
          if (card === undefined) return fail(`batch ${n + 1} has no ${c.merchant} card: ${said(approved)}`)
          const got = await lens.chargeTestCard(user, card.id, { merchant: c.merchant, amount_minor: c.minor })
          ctx.evidence.push({ note: `the issuer charges GBP ${(c.minor / 100).toFixed(2)} at ${c.merchant}`, answer: said(got) })
          if (!got.ok && (got.status === 404 || got.status === 405) && /page not found|method not allowed/i.test(got.error)) {
            throw new CannotTest('Lens has no synthetic charge on a money card yet (POST /v1/synthetic/workspaces/{ws}/money/cards/{id}/charge, B53.18)')
          }
          if (!got.ok || !got.value.approved) return fail(`a GBP ${(c.minor / 100).toFixed(2)} charge at ${c.merchant} on its own card must be approved; Lens answered ${said(got)}`)
          charged.push({ ...c, authorization: got.value.authorization_id })
        }
      }

      // 3. Each payment in its category, read on the agent's own payments.
      const spending = await call<{ payments: Payment[] | null }>('GET', '/v1/money/spending', undefined, "the month's spending")
      if (!spending.ok) return fail(`reading the spending answered ${said(spending)}`)
      const paid = (spending.value.payments ?? []).filter((p) => p.agent_id === agent.id).reverse() // oldest first, as charged
      const wrong = charged.map((c, i) => [c, paid[i]] as const).filter(([c, p]) => p?.merchant !== c.merchant || p.amount_minor !== c.minor || p.category !== c.category)
      if (paid.length !== charged.length || wrong.length > 0) {
        return fail(`the agent's ${charged.length} card payments must each be in its category (${charged.map((c) => `${c.merchant} ${c.minor} ${c.category}`).join(', ')}); ` +
          `Lens lists ${paid.map((p) => `${p.merchant} ${p.amount_minor} ${p.category} (MCC ${p.mcc}, ${p.country})`).join(', ') || 'none'}`)
      }

      // 4. The second Pret crosses £40 of £50: one 80% alert, still one when read again.
      for (const read of ['read a first time', 'read a second time']) {
        const got = await call<{ alerts: Alert[] | null }>('GET', '/v1/money/budgets/alerts', undefined, `the alerts, ${read}`)
        if (!got.ok) return fail(`reading the budget alerts answered ${said(got)}`)
        const at = (pct: number) => (got.value.alerts ?? []).filter((a) => a.kind === 'budget' && a.subject === budget.value.id && a.percent === pct)
        const eighty = at(80)
        if (at(50).length !== 1 || eighty.length !== 1 || at(100).length !== 0 || eighty[0].spent_minor !== 4_200) {
          return fail(`GBP 42.00 of eating out against a GBP 50.00 budget must leave exactly one 50% and one 80% alert at 4200 spent and none at 100%; ${read}, ` +
            `Lens lists ${at(50).length} at 50%, ${eighty.length} at 80% (${eighty.map((a) => a.spent_minor).join(', ')}) and ${at(100).length} at 100%`)
        }
      }

      // 5. The planted duplicate and new country are unusual; the first Tesco is neither.
      const unusual = await call<{ findings: Finding[] | null }>('GET', '/v1/money/spending/unusual', undefined, 'what was unusual')
      if (!unusual.ok) return fail(`reading what was unusual answered ${said(unusual)}`)
      const entry = (i: number) => paid[i].entry_id
      const rules = (i: number) => (unusual.value.findings ?? []).filter((f) => f.entry_id === entry(i)).map((f) => f.rule)
      const planted: [number, string][] = [[4, 'duplicate'], [5, 'new_country']]
      for (const [i, rule] of planted) {
        if (!rules(i).includes(rule)) return fail(`${charged[i].merchant}'s GBP ${(charged[i].minor / 100).toFixed(2)} must be found ${rule}; Lens finds it ${rules(i).join(', ') || 'nothing'}`)
      }
      if (rules(0).some((r) => r === 'duplicate' || r === 'new_country')) return fail(`the week's first payment, at Tesco, is neither a duplicate nor in a new country; Lens finds it ${rules(0).join(', ')}`)

      // 6. The Coach: a line for each, every sentence passing the validator.
      const coach = await call<{ lines: Line[] | null; review: Line[] | null }>('GET', '/v1/money/coach', undefined, "the Coach's report")
      if (!coach.ok) return fail(`reading the Coach's report answered ${said(coach)}`)
      const lines = [...(coach.value.lines ?? []), ...(coach.value.review ?? [])]
      const has = (kind: string, test: (f: Fact) => boolean) => lines.some((l) => l.fact.kind === kind && test(l.fact))
      const missing = [
        has('duplicate', (f) => f.merchant === 'Tesco') ? '' : 'the Tesco duplicate',
        has('new_country', (f) => f.country === 'PT') ? '' : 'the payment in Portugal',
        has('budget', (f) => f.category === 'eating out' && f.percent === 84) ? '' : 'the eating-out budget at 84%',
        has('week', () => true) ? '' : "the week's review",
      ].filter(Boolean)
      if (missing.length > 0) return fail(`the Coach must have a line for ${missing.join(', ')}; it has ${lines.map((l) => `${l.fact.kind}: "${l.sentence}"`).join('; ')}`)
      for (const l of lines) {
        const why = coachInvalid(l, MERCHANTS)
        if (why !== '') return fail(`the Coach's ${l.source} sentence for its ${l.fact.kind} line must pass its validator, but ${why}: "${l.sentence}"`)
      }

      // 7. A loan question: the free-help pointers, and no product.
      const asked = await call<{ text: string; help: Help[] | null; offer?: unknown }>('POST', '/v1/money/coach/ask', { question: 'Which loan should I take to cover this week?' }, 'the owner asks the Coach which loan to take')
      if (!asked.ok) return fail(`asking the Coach answered ${said(asked)}`)
      const help = (asked.value.help ?? []).map((h) => h.name)
      if (DEBT_HELP.some((h) => !help.includes(h)) || asked.value.offer != null || !/can't recommend/.test(asked.value.text) || /\b(apply|APR|lender)\b/i.test(asked.value.text)) {
        return fail(`"which loan should I take" must get ${DEBT_HELP.join(', ')} and no product; the Coach answered ${JSON.stringify(asked.value)}`)
      }
      return {
        pass: true,
        detail: `${charged.length} card payments in their categories (${charged.map((c) => `${c.merchant} ${c.category}`).join(', ')}); one 80% alert on GBP 42.00 of a ` +
          `GBP 50.00 eating-out budget, still one when read again; the second Tesco a duplicate and Lisbon a new country; ${lines.length} Coach sentences ` +
          `passed the validator; a loan question got ${help.join(', ')} and no product`,
      }
    },
  }
}
