// B53.8 — the Spending screen and Chat's category totals (Lens B53.3–B53.7), once a run, on a workspace of its own. On Lens's API
// the owner opens the company's GBP account with £200.00 of test money, saves two payees and sets a £100.00 monthly eating-out budget
// across every wallet. £10.00 to the first payee is the wallet's first payment; £25.00 to the second is a new merchant and lands in
// transfers, as a payment to a payee does, leaving the budget untouched. One correction puts that merchant in eating out: its payment
// moves there, the budget reads £25.00 spent and £75.00 left, Lens lists the payment as unusual and the Coach words it. In the app,
// Money → Spending shows the payment in eating out, the budget's £75.00 left and the Coach's own sentence, and Chat answers
// "How much did I spend on eating out this month?" with Lens's own eating-out total.

import { randomBytes } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fail } from './bank.ts'
import { RUN_SALT } from './oracles.ts'
import type { Scenario } from './scenarios.ts'
import { call, said } from './settings.ts'

const TIMEOUT_MS = 30_000
const BUDGET_MINOR = 10_000
const MEAL_MINOR = 2500

interface Payment { entry_id: string; merchant: string; amount_minor: number; currency: string; category: string; category_source: string }
interface Spending { payments: Payment[] | null; totals: { currency: string; by_category: Record<string, number> | null }[] | null }
interface Budget { id: string; spent_minor: number; left_minor: number }

/** `screen` false leaves out the app's half, for the unit test on the stub Lens. */
export function spendingScreen({ screen = true }: { screen?: boolean } = {}): Scenario {
  return {
    id: 'spending-screen',
    owner: 'talyvor-suite',
    own: true,
    items: ['B53.8'],
    feature: 'Agent wallets',
    title: "spending: a corrected payment moves into eating out and its budget, Lens lists it as unusual with the Coach's sentence, " +
      "Money → Spending shows all three and Chat's eating-out total is Lens's",
    run: async (ctx) => {
      const step = async <T>(method: string, path: string, body: unknown, note: string) => {
        const r = await call<T>(ctx, method, path, body)
        ctx.evidence.push({ note, answer: said(r) })
        return r
      }
      // 1. On Lens's API: the money, two payees and the eating-out budget.
      const terms = await step<{ terms: { capability: string; version: number; accepted?: unknown }[] | null }>('GET', '/v1/workspaces/{ws}/terms', undefined, 'the owner reads the terms')
      for (const t of (terms.value?.terms ?? []).filter((x) => ['currency_accounts', 'payments_in', 'payments_out'].includes(x.capability) && x.accepted == null)) {
        const ok = await step('POST', `/v1/workspaces/{ws}/terms/${t.capability}/accept`, { version: t.version }, `the owner accepts ${t.capability}'s terms`)
        if (ok.status !== 201) return fail(`accepting ${t.capability}'s terms answered ${said(ok)}`)
      }
      const account = await step<{ id: string }>('POST', '/v1/money/accounts', { currency: 'GBP' }, 'the company GBP account')
      if (account.status !== 201 || account.value === undefined) return fail(`opening the company GBP account answered ${said(account)}`)
      const funded = await step('POST', `/v1/money/accounts/${account.value.id}/test-money`, { amount_minor: 20_000, idempotency_key: `e2e-${randomBytes(8).toString('hex')}` }, 'GBP 200.00 of test money in it')
      if (funded.status !== 201) return fail(`putting test money in the company GBP account answered ${said(funded)}`)
      const payee = async (name: string, account_number: string) => {
        const p = await step<{ id: string }>('POST', '/v1/money/payees', { name, country: 'GB', sort_code: '040004', account_number }, `the payee ${name}`)
        return p.status === 201 && p.value !== undefined ? p.value.id : fail(`saving ${name} answered ${said(p)}`)
      }
      const usual = `Nightly Kettle Stores ${RUN_SALT}`
      const meal = `Nightly Halvorsen Kitchen ${RUN_SALT}`
      const usualID = await payee(usual, '11223344')
      if (typeof usualID !== 'string') return usualID
      const mealID = await payee(meal, '44332211')
      if (typeof mealID !== 'string') return mealID
      const budget = await step<{ id: string }>('PUT', '/v1/money/budgets', { agent_id: 'all', category: 'eating_out', period: 'month', amount_minor: BUDGET_MINOR,
        currency: 'GBP', timezone: 'UTC' }, 'a GBP 100.00 monthly eating-out budget across every wallet')
      if (budget.status !== 200 || budget.value === undefined) return fail(`setting the budget answered ${said(budget)}`)
      const budgetID = budget.value.id
      for (const [id, to, minor] of [[usualID, usual, 1000], [mealID, meal, MEAL_MINOR]] as const) {
        const paid = await step('POST', '/v1/money/payments', { account_id: account.value.id, payee_id: id, amount_minor: minor, currency: 'GBP',
          reference: `Spending ${RUN_SALT}`, idempotency_key: `e2e-${randomBytes(8).toString('hex')}` }, `GBP ${(minor / 100).toFixed(2)} paid to ${to}`)
        if (paid.status !== 201) return fail(`paying ${to} GBP ${(minor / 100).toFixed(2)} of test money answered ${said(paid)}`)
      }
      const read = async (when: string) => {
        const s = await step<Spending>('GET', '/v1/money/spending', undefined, `the month's spending, ${when}`)
        const b = await step<{ budgets: Budget[] | null }>('GET', '/v1/money/budgets', undefined, `the budgets, ${when}`)
        return { said: said(s), payment: (s.value?.payments ?? []).find((p) => p.merchant === meal), totals: s.value?.totals ?? [],
          budget: (b.value?.budgets ?? []).find((x) => x.id === budgetID) }
      }

      // 2. Before the correction: the payment is the payee's, and the eating-out budget is untouched.
      const before = await read('before the correction')
      if (before.payment === undefined) return fail(`Lens's spending does not list the GBP 25.00 paid to ${meal}: ${before.said}`)
      if (before.payment.category === 'eating_out' || before.budget?.spent_minor !== 0) {
        return fail(`before any correction the payment to ${meal} must not be eating out and the budget must read 0 spent; it reads ${before.payment.category} and ${before.budget?.spent_minor}`)
      }

      // 3. One correction: the payment moves into eating out and spends the budget.
      const corrected = await step('PUT', '/v1/money/spending/merchants', { merchant: meal, category: 'eating_out' }, `${meal} put in eating out`)
      if (corrected.status !== 200) return fail(`putting ${meal} in eating out answered ${said(corrected)}`)
      const after = await read('after the correction')
      if (after.payment?.category !== 'eating_out' || after.payment.category_source !== 'correction') {
        return fail(`after the correction the payment to ${meal} must read eating out, from the correction; Lens reads ${after.payment?.category} from ${after.payment?.category_source}: ${after.said}`)
      }
      if (after.budget?.spent_minor !== MEAL_MINOR || after.budget.left_minor !== BUDGET_MINOR - MEAL_MINOR) {
        return fail(`the eating-out budget must read GBP 25.00 spent and GBP 75.00 left; it reads ${after.budget?.spent_minor} spent and ${after.budget?.left_minor} left`)
      }
      const eatingOut = after.totals.filter((t) => t.currency === 'GBP').reduce((n, t) => n + (t.by_category?.eating_out ?? 0), 0)

      // 4. Unusual: the payment is a new merchant, and the Coach words it.
      const unusual = await step<{ findings: { rule: string; entry_id?: string }[] | null }>('GET', '/v1/money/spending/unusual', undefined, 'what was unusual this month')
      if (!(unusual.value?.findings ?? []).some((f) => f.rule === 'new_merchant' && f.entry_id === after.payment?.entry_id)) {
        return fail(`the first payment to ${meal}, after one to ${usual}, must be listed as a new merchant; Lens answers ${said(unusual)}`)
      }
      const coach = await step<{ lines: { fact: { kind: string; merchant?: string }; sentence: string }[] | null }>('GET', '/v1/money/coach', undefined, "the Coach's sentences")
      const sentence = (coach.value?.lines ?? []).find((l) => l.fact.kind === 'new_merchant' && l.fact.merchant === meal)?.sentence ?? ''
      if (sentence === '') return fail(`the Coach must word the new merchant ${meal}; Lens answers ${said(coach)}`)
      const detail = `GBP 25.00 to ${meal} moved into eating out by one correction, GBP 75.00 of the GBP 100.00 budget left, listed as a new merchant with the Coach's "${sentence}"`
      if (!screen) return { pass: true, detail }

      // 5. In the app: Money → Spending shows the category, the budget left and the Coach's sentence.
      const page = await ctx.app.tab('/money/spending')
      try {
        const shown = async (testid: string) => {
          const row = page.locator(`[data-testid="${testid}"]`)
          return row.waitFor({ timeout: TIMEOUT_MS }).then(async () => ((await row.textContent()) ?? '').replace(/\s+/g, ' '), () => '')
        }
        const category = await page.getByLabel(`Category of ${meal}`).inputValue({ timeout: TIMEOUT_MS }).catch(() => '')
        const budgetRow = await shown(`spending-budget-${budgetID}`)
        const unusualRow = await shown(`spending-unusual-${after.payment.entry_id}`)
        ctx.evidence.push({ note: 'Money → Spending', answer: `category ${category}; budget "${budgetRow}"; unusual "${unusualRow}"` })
        if (category !== 'eating_out') return fail(`Money → Spending must show the payment to ${meal} in eating out; its category reads "${category}"`)
        if (!budgetRow.includes('£75.00 left')) return fail(`Money → Spending must show £75.00 left on the eating-out budget; its row reads "${budgetRow.slice(0, 300)}"`)
        if (!unusualRow.includes(sentence)) return fail(`Money → Spending must show the Coach's "${sentence}" on the unusual payment; its row reads "${unusualRow.slice(0, 300)}"`)
        await mkdir(ctx.env.outDir, { recursive: true })
        const viewport = page.viewportSize()
        for (const width of [1440, 390]) {
          const path = join(ctx.env.outDir, `spending-screen-${width}px-user${ctx.app.user.index}.png`)
          await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
          await page.screenshot({ path })
          ctx.evidence.push({ note: `Money → Spending at ${width}px: ${path}` })
        }
        if (viewport !== null) await page.setViewportSize(viewport)
      } finally {
        await page.close()
      }

      // 6. In Chat: the eating-out total is Lens's, and the question never reaches the model.
      const chat = await ctx.app.tab('/chat')
      try {
        const question = 'How much did I spend on eating out this month?'
        await chat.locator('#chat-message').fill(question)
        await chat.locator('#chat-message').press('Enter')
        const answer = chat.getByTestId('chat-spend').filter({ hasText: question }).getByTestId('chat-spend-answer')
        const text = await answer.waitFor({ timeout: TIMEOUT_MS }).then(async () => (await answer.innerText()).trim(), () => '')
        ctx.evidence.push({ note: `Chat: "${question}"`, answer: text })
        if ((await chat.getByTestId('turn-user').filter({ hasText: question }).count()) > 0) return fail('the spending question was sent to the model')
        const want = `You spent ${new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(eatingOut / 100)} on eating out this month.`
        if (text !== want) return fail(`Lens's eating-out total this month is ${eatingOut} GBP minor units, so Chat must answer "${want}"; it answered "${text}"`)
        return { pass: true, detail: `${detail}; Money → Spending shows all three and Chat answers "${text}"` }
      } finally {
        await chat.close()
      }
    },
  }
}
