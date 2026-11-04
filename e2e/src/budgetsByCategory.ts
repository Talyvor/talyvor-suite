// B41.39 — budgets by category (Lens B41.139), once a run, on a workspace of its own. On Lens's API the owner opens the
// company's GBP account with £200.00 of test money, saves two payees and puts the first in AI and software, then sets a £100.00
// monthly AI and software budget across every wallet. £30.00 to the other payee is not software and counts for nothing; £70.00
// to the software one reaches 50% and raises no 80% alert; the next £15.00 crosses £80 and raises exactly one 80% alert, still
// one when read again, and the budget reads £85.00 spent, 85%. In the app, Money → Budgets shows the category's progress and
// the alerts at 50% and 80%.

import { randomBytes } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fail } from './bank.ts'
import { RUN_SALT } from './oracles.ts'
import type { Scenario } from './scenarios.ts'
import { call, said } from './settings.ts'

const TIMEOUT_MS = 30_000
const BUDGET_MINOR = 10_000

interface Alert { id: string; kind: string; subject: string; percent: number; spent_minor: number; limit_minor: number; currency: string }
interface Budget { id: string; category: string; spent_minor: number; percent: number }

/** `screen` false leaves out the app's half, for the unit test on the stub Lens. */
export function budgetsByCategory({ screen = true }: { screen?: boolean } = {}): Scenario {
  return {
    id: 'budgets-by-category',
    owner: 'talyvor-suite',
    own: true,
    items: ['B41.39', 'B41.139'],
    feature: 'Agent wallets',
    title: 'budgets by category: with a £100.00 AI and software budget, the payment that crosses £80 raises one 80% alert, another ' +
      "category's payment counts for nothing, and Money → Budgets shows the category's progress",
    run: async (ctx) => {
      const step = async <T>(method: string, path: string, body: unknown, note: string) => {
        const r = await call<T>(ctx, method, path, body)
        ctx.evidence.push({ note, answer: said(r) })
        return r
      }
      // 1. On Lens's API: the money, two payees, the software one corrected into its category, and the budget.
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
      const software = `Nightly Seats Software ${RUN_SALT}`
      const stationer = `Nightly Paper Stationers ${RUN_SALT}`
      const softwareID = await payee(software, '13572468')
      if (typeof softwareID !== 'string') return softwareID
      const stationerID = await payee(stationer, '24681357')
      if (typeof stationerID !== 'string') return stationerID
      const corrected = await step('PUT', '/v1/money/spending/merchants', { merchant: software, category: 'ai_software' }, `${software} put in AI and software`)
      if (corrected.status !== 200) return fail(`putting ${software} in AI and software answered ${said(corrected)}`)
      const budget = await step<{ id: string }>('PUT', '/v1/money/budgets', { agent_id: 'all', category: 'ai_software', period: 'month', amount_minor: BUDGET_MINOR,
        currency: 'GBP', timezone: 'UTC' }, 'a GBP 100.00 monthly AI and software budget across every wallet')
      if (budget.status !== 200 || budget.value === undefined) return fail(`setting the budget answered ${said(budget)}`)
      const budgetID = budget.value.id
      const pay = async (payeeID: string, to: string, minor: number) => {
        const paid = await step('POST', '/v1/money/payments', { account_id: account.value?.id, payee_id: payeeID, amount_minor: minor, currency: 'GBP',
          reference: `Budget ${RUN_SALT}`, idempotency_key: `e2e-${randomBytes(8).toString('hex')}` }, `GBP ${(minor / 100).toFixed(2)} paid to ${to}`)
        return paid.status === 201 ? null : fail(`paying ${to} GBP ${(minor / 100).toFixed(2)} of test money answered ${said(paid)}`)
      }
      const alerts = async (read: string) => {
        const got = await step<{ alerts: Alert[] | null }>('GET', '/v1/money/budgets/alerts', undefined, `the alerts, ${read}`)
        if (got.status !== 200) return fail(`reading the limit alerts answered ${said(got)}`)
        const mine = (got.value?.alerts ?? []).filter((a) => a.kind === 'budget' && a.subject === budgetID)
        return { at: (pct: number) => mine.filter((a) => a.percent === pct), said: said(got) }
      }

      // 2. £30.00 elsewhere and £70.00 on software: 50% of the budget, no 80% alert yet.
      for (const [id, to, minor] of [[stationerID, stationer, 3000], [softwareID, software, 7000]] as const) {
        const refused = await pay(id, to, minor)
        if (refused !== null) return refused
      }
      const before = await alerts('after GBP 70.00 of software and GBP 30.00 of stationery')
      if ('pass' in before) return before
      if (before.at(50).length !== 1 || before.at(80).length !== 0) {
        return fail(`GBP 70.00 of software against a GBP 100.00 software budget must have raised one 50% alert and no 80% one — the GBP 30.00 of ` +
          `stationery is another category; Lens lists ${before.at(50).length} at 50% and ${before.at(80).length} at 80%: ${before.said}`)
      }

      // 3. £15.00 more on software crosses £80: exactly one 80% alert, and reading again raises nothing new.
      const refused = await pay(softwareID, software, 1500)
      if (refused !== null) return refused
      let eighty: Alert | undefined
      for (const read of ['read a first time', 'read a second time']) {
        const after = await alerts(`after the GBP 15.00 that crosses GBP 80.00, ${read}`)
        if ('pass' in after) return after
        if (after.at(50).length !== 1 || after.at(80).length !== 1 || after.at(100).length !== 0) {
          return fail(`the payment that crosses GBP 80.00 of a GBP 100.00 software budget must leave exactly one 50% and one 80% alert and none at 100%; ` +
            `${read}, Lens lists ${after.at(50).length} at 50%, ${after.at(80).length} at 80% and ${after.at(100).length} at 100%: ${after.said}`)
        }
        eighty = after.at(80)[0]
      }
      if (eighty?.spent_minor !== 8500 || eighty.limit_minor !== BUDGET_MINOR) {
        return fail(`the 80% alert must read 8500 of 10000 GBP; it reads ${eighty?.spent_minor} of ${eighty?.limit_minor} ${eighty?.currency}`)
      }
      const list = await step<{ budgets: Budget[] | null }>('GET', '/v1/money/budgets', undefined, 'the budgets')
      const mine = (list.value?.budgets ?? []).find((b) => b.id === budgetID)
      if (list.status !== 200 || mine?.spent_minor !== 8500 || mine.percent !== 85) {
        return fail(`the software budget must read GBP 85.00 spent, 85%; Lens answers ${said(list)}`)
      }
      const detail = 'GBP 85.00 of a GBP 100.00 AI and software budget, GBP 30.00 of stationery not counted: one 50% alert, one 80% alert raised by the payment that crossed GBP 80.00, still one when read again'
      if (!screen) return { pass: true, detail }

      // 4. In the app: Money → Budgets shows the category's progress and its alerts.
      const page = await ctx.app.tab('/money/budgets')
      try {
        const row = page.locator(`[data-testid="budget-${budgetID}"]`)
        const shown = await row.waitFor({ timeout: TIMEOUT_MS }).then(async () => ((await row.textContent()) ?? '').replace(/\s+/g, ' '), () => '')
        ctx.evidence.push({ note: 'the Budgets row for the software budget', answer: shown })
        for (const want of ['AI and software · Every wallet', '£85.00 of £100.00 this month', '£15.00 left', 'Alerted at 50%, 80%', '85%']) {
          if (!shown.includes(want)) return fail(`Money → Budgets must show "${want}" on the software budget; its row reads "${shown.slice(0, 300)}"`)
        }
        await mkdir(ctx.env.outDir, { recursive: true })
        const viewport = page.viewportSize()
        for (const width of [1440, 390]) {
          const path = join(ctx.env.outDir, `budgets-by-category-${width}px-user${ctx.app.user.index}.png`)
          await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
          await row.scrollIntoViewIfNeeded()
          await page.screenshot({ path })
          ctx.evidence.push({ note: `Money → Budgets at ${width}px: ${path}` })
        }
        if (viewport !== null) await page.setViewportSize(viewport)
        return { pass: true, detail: `${detail}; Money → Budgets shows "${shown.slice(0, 160)}"` }
      } finally {
        await page.close()
      }
    },
  }
}
