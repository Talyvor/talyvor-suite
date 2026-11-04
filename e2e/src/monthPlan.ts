// B53.16 — the month plan on Money → Spending and Chat's "How much can I spend today?" (Lens B53.15), once a run, on a workspace of
// its own. On Lens's API the owner opens the company's GBP account with £1,500.00 of test money, keeps notices in UTC, sets a £100.00
// monthly eating-out budget and a payday 25 days from today, and adds two bills: £30.00 to a phone company in 5 days and £700.00 of
// rent in 10. The plan then runs 25 days and safe to spend is (£1,500.00 − £730.00 − £100.00) ÷ 25 = £26.80 a day, both bills
// covered. A spree of four £100.00 payments today puts the pace at £57.14 a day, which leaves the rent short by £201.40: Lens raises
// the pace-short finding with the Coach's sentence and a "plan" notice, once. In the app, Money → Spending shows the safe-per-day,
// the rent-short sentence and its adjustments (keep to £37.00 a day; move the eating-out budget's £100.00), and Chat answers
// "How much can I spend today?" with Lens's own figure, never the model's.

import { randomBytes } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fail } from './bank.ts'
import { RUN_SALT } from './oracles.ts'
import type { Scenario } from './scenarios.ts'
import { call, said } from './settings.ts'

const TIMEOUT_MS = 30_000
/** Lens's notice sweep runs every minute (B53.7). */
const NOTICE_WAIT_MS = 150_000
const DAY_MS = 86_400_000
const FUNDS_MINOR = 150_000
const BUDGET_MINOR = 10_000
const PHONE_MINOR = 3000
const RENT_MINOR = 70_000
const SPREE_MINOR = 10_000
const SPREE_TIMES = 4

interface PlanPayment { source: string; id: string; payee: string; amount_minor: number; due: string; covered: boolean }
interface PlanFinding { kind: string; urgent: boolean; payment?: PlanPayment; short_minor?: number; pace_per_day_minor?: number; keep_to_per_day_minor?: number; sentence: string }
interface Plan { currency: string; today: string; until: string; next_income?: string; days: number; money_now_minor: number; upcoming_minor: number
  budgets_left_minor: number; safe_per_day_minor: number; pace_per_day_minor: number; payments: PlanPayment[] | null; findings: PlanFinding[] | null }

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10)
const gbp = (minor: number) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(minor / 100)
/** "2026-11-29" → "29 Nov", as the app writes a plan's date. */
const shortDay = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })

/** `screen` false leaves out the app's half, for the unit test on the stub Lens. */
export function monthPlan({ screen = true }: { screen?: boolean } = {}): Scenario {
  return {
    id: 'month-plan',
    owner: 'talyvor-suite',
    own: true,
    items: ['B53.16'],
    feature: 'Agent wallets',
    title: 'month plan: a payday and two bills give safe to spend per day, a spree leaves the rent short with its notice and adjustments, ' +
      "Money → Spending shows them and Chat's answer to \"How much can I spend today?\" is Lens's",
    run: async (ctx) => {
      const step = async <T>(method: string, path: string, body: unknown, note: string) => {
        const r = await call<T>(ctx, method, path, body)
        ctx.evidence.push({ note, answer: said(r) })
        return r
      }
      // 1. On Lens's API: the money, notices in UTC, the budget and the payday.
      const terms = await step<{ terms: { capability: string; version: number; accepted?: unknown }[] | null }>('GET', '/v1/workspaces/{ws}/terms', undefined, 'the owner reads the terms')
      for (const t of (terms.value?.terms ?? []).filter((x) => ['currency_accounts', 'payments_in', 'payments_out'].includes(x.capability) && x.accepted == null)) {
        const ok = await step('POST', `/v1/workspaces/{ws}/terms/${t.capability}/accept`, { version: t.version }, `the owner accepts ${t.capability}'s terms`)
        if (ok.status !== 201) return fail(`accepting ${t.capability}'s terms answered ${said(ok)}`)
      }
      const account = await step<{ id: string }>('POST', '/v1/money/accounts', { currency: 'GBP' }, 'the company GBP account')
      if (account.status !== 201 || account.value === undefined) return fail(`opening the company GBP account answered ${said(account)}`)
      const funded = await step('POST', `/v1/money/accounts/${account.value.id}/test-money`, { amount_minor: FUNDS_MINOR, idempotency_key: `e2e-${randomBytes(8).toString('hex')}` }, 'GBP 1,500.00 of test money in it')
      if (funded.status !== 201) return fail(`putting test money in the company GBP account answered ${said(funded)}`)
      const tz = await step('PUT', '/v1/money/notices/settings', { timezone: 'UTC', quiet_from: '', quiet_until: '', off: [] }, 'notices in UTC, no quiet hours')
      if (tz.status !== 200) return fail(`keeping notices in UTC answered ${said(tz)}`)
      const budget = await step<{ id: string }>('PUT', '/v1/money/budgets', { agent_id: 'all', category: 'eating_out', period: 'month', amount_minor: BUDGET_MINOR,
        currency: 'GBP', timezone: 'UTC' }, 'a GBP 100.00 monthly eating-out budget across every wallet')
      if (budget.status !== 200 || budget.value === undefined) return fail(`setting the budget answered ${said(budget)}`)
      const now = Date.now()
      const payday = iso(now + 25 * DAY_MS)
      const income = await step('PUT', '/v1/money/plan/income', { payday: Number(payday.slice(8)), amount_minor: 250_000, currency: 'GBP', payer: '' }, `payday on ${payday}`)
      if (income.status !== 200) return fail(`setting the payday answered ${said(income)}`)

      // 2. Two bills, as the bills inbox reads a photo of each.
      const landlord = `Nightly Landlord ${RUN_SALT}`
      const bill = async (supplier: string, minor: number, days: number, number: string) => {
        const added = await ctx.env.lens.raw(ctx.app.user.token, 'POST', '/v1/money/bills?source=photo', [`From: ${supplier}`, 'INVOICE', `Invoice number: ${number}`,
          `Due date: ${iso(now + days * DAY_MS)}`, `Total due: GBP ${(minor / 100).toFixed(2)}`].join('\n'), 'text/plain')
        ctx.evidence.push({ note: `a bill from ${supplier}`, answer: `${added.status} ${added.text.slice(0, 300)}` })
        return added.status === 201 ? (JSON.parse(added.text) as { id: string }).id : fail(`adding the bill from ${supplier} must answer 201; Lens answered ${added.status} ${added.text.slice(0, 200)}`)
      }
      const phoneID = await bill(`Nightly Phone Co ${RUN_SALT}`, PHONE_MINOR, 5, `PH-${RUN_SALT}`)
      if (typeof phoneID !== 'string') return phoneID
      const rentID = await bill(landlord, RENT_MINOR, 10, `RENT-${RUN_SALT}`)
      if (typeof rentID !== 'string') return rentID
      const read = async (when: string) => {
        const r = await step<Plan>('GET', '/v1/money/plan', undefined, `the month plan, ${when}`)
        return r.status === 200 && r.value !== undefined ? r.value : fail(`reading the month plan ${when} answered ${said(r)}`)
      }

      // 3. Before the spree: 25 days, both bills covered, and safe to spend is what is left over the days.
      const before = await read('before the spree')
      if ('pass' in before) return before
      const bills = (p: Plan) => (p.payments ?? []).filter((x) => x.source === 'bill' && (x.id === phoneID || x.id === rentID))
      const safeBefore = Math.floor((FUNDS_MINOR - PHONE_MINOR - RENT_MINOR - BUDGET_MINOR) / 25)
      if (before.next_income !== payday || before.days !== 25) return fail(`with payday on ${payday} the plan must run 25 days to it; Lens reads ${before.days} days to ${before.next_income}`)
      if (bills(before).length !== 2 || !bills(before).every((x) => x.covered)) return fail(`both bills must be listed and covered; Lens lists ${JSON.stringify(before.payments).slice(0, 300)}`)
      if (before.money_now_minor !== FUNDS_MINOR || before.budgets_left_minor !== BUDGET_MINOR || before.safe_per_day_minor !== safeBefore) {
        return fail(`safe to spend must be (${FUNDS_MINOR} − ${PHONE_MINOR + RENT_MINOR} − ${BUDGET_MINOR}) ÷ 25 = ${safeBefore} a day; Lens reads ${before.safe_per_day_minor} ` +
          `from ${before.money_now_minor} now, ${before.upcoming_minor} upcoming and ${before.budgets_left_minor} of budgets`)
      }
      if ((before.findings ?? []).length !== 0) return fail(`before the spree the plan is on track; Lens finds ${JSON.stringify(before.findings).slice(0, 300)}`)

      // 4. The spree: four payments today to a new payee.
      const shop = `Nightly Spree Outfitters ${RUN_SALT}`
      const shopID = await step<{ id: string }>('POST', '/v1/money/payees', { name: shop, country: 'GB', sort_code: '040004', account_number: '55667788' }, `the payee ${shop}`)
      if (shopID.status !== 201 || shopID.value === undefined) return fail(`saving ${shop} answered ${said(shopID)}`)
      for (let i = 0; i < SPREE_TIMES; i++) {
        const paid = await step('POST', '/v1/money/payments', { account_id: account.value.id, payee_id: shopID.value.id, amount_minor: SPREE_MINOR, currency: 'GBP',
          reference: `Spree ${RUN_SALT}`, idempotency_key: `e2e-${randomBytes(8).toString('hex')}` }, `GBP 100.00 paid to ${shop}`)
        if (paid.status !== 201) return fail(`paying ${shop} GBP 100.00 of test money answered ${said(paid)}`)
      }

      // 5. After it: the pace leaves the rent short, once, with the Coach's sentence.
      const after = await read('after the spree')
      if ('pass' in after) return after
      const money = FUNDS_MINOR - SPREE_TIMES * SPREE_MINOR
      const pace = Math.floor((SPREE_TIMES * SPREE_MINOR) / 7)
      const short = Math.min(-(money - PHONE_MINOR - RENT_MINOR - pace * 10), RENT_MINOR)
      const keepTo = Math.floor((money - PHONE_MINOR - RENT_MINOR) / 10)
      const safeAfter = Math.floor(Math.max(money - PHONE_MINOR - RENT_MINOR - BUDGET_MINOR, 0) / 25)
      if (after.money_now_minor !== money || after.pace_per_day_minor !== pace || after.safe_per_day_minor !== safeAfter) {
        return fail(`after GBP 400.00 spent today the plan must read ${money} now, ${pace} a day and ${safeAfter} safe a day; Lens reads ${after.money_now_minor}, ` +
          `${after.pace_per_day_minor} and ${after.safe_per_day_minor}`)
      }
      const rentShort = (after.findings ?? []).find((f) => f.kind === 'plan_pace_short' && f.payment?.id === rentID)
      if (rentShort === undefined) return fail(`at ${pace} a day the GBP 700.00 rent on day 10 must be short by ${short}: Lens's plan must raise plan_pace_short on it; it finds ${JSON.stringify(after.findings).slice(0, 400)}`)
      if (!rentShort.urgent || rentShort.short_minor !== short || rentShort.keep_to_per_day_minor !== keepTo || rentShort.sentence === '') {
        return fail(`the rent-short finding must be urgent, short by ${short}, keep to ${keepTo} a day and carry the Coach's sentence; Lens reads ${JSON.stringify(rentShort).slice(0, 400)}`)
      }
      const until = Date.now() + NOTICE_WAIT_MS
      let notices: { kind: string; body: string }[] = []
      while (Date.now() < until) {
        const n = await call<{ notices: { kind: string; body: string }[] | null }>(ctx, 'GET', '/v1/money/notices', undefined)
        notices = (n.value?.notices ?? []).filter((x) => x.kind === 'plan' && x.body === rentShort.sentence)
        if (notices.length > 0) break
        await new Promise((r) => setTimeout(r, 5000))
      }
      ctx.evidence.push({ note: 'the plan notices', answer: JSON.stringify(notices).slice(0, 400) })
      if (notices.length !== 1) return fail(`the rent-short finding must arrive as one "plan" notice within ${NOTICE_WAIT_MS / 1000}s; Lens lists ${notices.length}`)
      const detail = `payday in 25 days and GBP 730.00 of bills: GBP ${(safeBefore / 100).toFixed(2)} a day; after a GBP 400.00 spree the rent is short by ` +
        `GBP ${(short / 100).toFixed(2)}, one notice: "${rentShort.sentence}"`
      if (!screen) return { pass: true, detail }

      // 6. In the app: Money → Spending shows the safe-per-day, the rent-short sentence and its adjustments.
      const page = await ctx.app.tab('/money/spending')
      try {
        const shown = async (testid: string) => {
          const row = page.locator(`[data-testid="${testid}"]`).first()
          return row.waitFor({ timeout: TIMEOUT_MS }).then(async () => ((await row.textContent()) ?? '').replace(/\s+/g, ' ').trim(), () => '')
        }
        const safe = await shown('plan-safe-per-day')
        const finding = await shown('plan-finding-plan_pace_short')
        const keep = await shown('plan-adjust-keep-to')
        const move = await shown(`plan-adjust-budget-${budget.value.id}`)
        ctx.evidence.push({ note: 'Money → Spending, the month plan', answer: `safe "${safe}"; finding "${finding}"; keep to "${keep}"; budget "${move}"` })
        const wantSafe = `${gbp(safeAfter)} a day until payday, ${shortDay(payday)}`
        if (safe !== wantSafe) return fail(`Money → Spending must read "${wantSafe}"; it reads "${safe}"`)
        if (!finding.includes(rentShort.sentence)) return fail(`Money → Spending must show the Coach's "${rentShort.sentence}"; the finding reads "${finding.slice(0, 300)}"`)
        if (keep !== `Spend at most ${gbp(keepTo)} a day until ${shortDay(rentShort.payment?.due ?? '')}.`) return fail(`the rent-short finding must offer keeping to ${gbp(keepTo)} a day; it reads "${keep}"`)
        if (!move.startsWith(`Move ${gbp(BUDGET_MINOR)} out of the eating out budget.`)) return fail(`the rent-short finding must offer moving the eating-out budget's ${gbp(BUDGET_MINOR)}; it reads "${move}"`)
        await mkdir(ctx.env.outDir, { recursive: true })
        const viewport = page.viewportSize()
        for (const width of [1440, 390]) {
          const path = join(ctx.env.outDir, `month-plan-${width}px-user${ctx.app.user.index}.png`)
          await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
          await page.screenshot({ path })
          ctx.evidence.push({ note: `Money → Spending at ${width}px: ${path}` })
        }
        if (viewport !== null) await page.setViewportSize(viewport)
      } finally {
        await page.close()
      }

      // 7. In Chat: safe to spend today is Lens's, and the question never reaches the model.
      const chat = await ctx.app.tab('/chat')
      try {
        const question = 'How much can I spend today?'
        await chat.locator('#chat-message').fill(question)
        await chat.locator('#chat-message').press('Enter')
        const answer = chat.getByTestId('chat-plan').filter({ hasText: question }).getByTestId('chat-plan-answer')
        const text = await answer.waitFor({ timeout: TIMEOUT_MS }).then(async () => (await answer.innerText()).trim(), () => '')
        ctx.evidence.push({ note: `Chat: "${question}"`, answer: text })
        if ((await chat.getByTestId('turn-user').filter({ hasText: question }).count()) > 0) return fail('the plan question was sent to the model')
        const want = `You can spend ${gbp(safeAfter)} today, and each day until payday on ${shortDay(payday)}.`
        if (text !== want) return fail(`Lens's plan has ${safeAfter} GBP minor units safe a day, so Chat must answer "${want}"; it answered "${text}"`)
        return { pass: true, detail: `${detail}; Money → Spending shows it with its adjustments and Chat answers "${text}"` }
      } finally {
        await chat.close()
      }
    },
  }
}
