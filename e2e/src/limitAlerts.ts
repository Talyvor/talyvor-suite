// B28.62 — limit-approach alerts (Lens B28.335), once a run, on a workspace of its own. On Lens's API the owner opens the
// company's GBP account with £50.00 of test money, saves a payee, makes an agent and sets a £10.00 monthly budget on their own
// wallet. £8.00 paid out reaches 80% of it: the alerts list one 50% and one 80% alert for that budget, and none at 100%; read
// again, still exactly one of each, since an alert is raised once a period. In the app, the Agent Bank's Limit alerts card
// shows the 80% alert with £8.00 of £10.00 spent.

import { randomBytes } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fail } from './bank.ts'
import { RUN_SALT } from './oracles.ts'
import type { Scenario } from './scenarios.ts'
import { call, said } from './settings.ts'

const TIMEOUT_MS = 30_000
const BUDGET_MINOR = 1000
const PAID_MINOR = 800

interface Alert { id: string; kind: string; subject: string; percent: number; spent_minor: number; limit_minor: number; currency: string }

/** `screen` false leaves out the app's half, for the unit test on the stub Lens. */
export function limitAlerts({ screen = true }: { screen?: boolean } = {}): Scenario {
  return {
    id: 'limit-alerts',
    owner: 'talyvor-suite',
    own: true,
    items: ['B28.62', 'B28.335'],
    feature: 'Agent wallets',
    title: "limit-approach alerts: £8.00 paid against a £10.00 monthly budget raises one 50% and one 80% alert, still one each when read again, " +
      "and the Agent Bank's Limit alerts card shows the 80% one",
    run: async (ctx) => {
      const step = async <T>(method: string, path: string, body: unknown, note: string) => {
        const r = await call<T>(ctx, method, path, body)
        ctx.evidence.push({ note, answer: said(r) })
        return r
      }
      // 1. On Lens's API: the money, a payee, an agent and the budget.
      const terms = await step<{ terms: { capability: string; version: number; accepted?: unknown }[] | null }>('GET', '/v1/workspaces/{ws}/terms', undefined, 'the owner reads the terms')
      for (const t of (terms.value?.terms ?? []).filter((x) => ['currency_accounts', 'payments_in', 'payments_out'].includes(x.capability) && x.accepted == null)) {
        const ok = await step('POST', `/v1/workspaces/{ws}/terms/${t.capability}/accept`, { version: t.version }, `the owner accepts ${t.capability}'s terms`)
        if (ok.status !== 201) return fail(`accepting ${t.capability}'s terms answered ${said(ok)}`)
      }
      const account = await step<{ id: string }>('POST', '/v1/money/accounts', { currency: 'GBP' }, 'the company GBP account')
      if (account.status !== 201 || account.value === undefined) return fail(`opening the company GBP account answered ${said(account)}`)
      const funded = await step('POST', `/v1/money/accounts/${account.value.id}/test-money`, { amount_minor: 5000, idempotency_key: `e2e-${randomBytes(8).toString('hex')}` }, 'GBP 50.00 of test money in it')
      if (funded.status !== 201) return fail(`putting test money in the company GBP account answered ${said(funded)}`)
      const supplier = `Nightly Limit Stationers ${RUN_SALT}`
      const payee = await step<{ id: string }>('POST', '/v1/money/payees', { name: supplier, country: 'GB', sort_code: '040004', account_number: '24681357' }, `the payee ${supplier}`)
      if (payee.status !== 201 || payee.value === undefined) return fail(`saving ${supplier} answered ${said(payee)}`)
      const agent = await step<{ id: string }>('POST', '/v1/workspaces/{ws}/agents', { name: `Limit agent ${RUN_SALT}` }, 'the owner makes an agent')
      if (agent.status !== 201 || agent.value === undefined) return fail(`making an agent answered ${said(agent)}`)
      const budget = await step<{ id: string }>('PUT', '/v1/money/budgets', { agent_id: '', category: '', period: 'month', amount_minor: BUDGET_MINOR, currency: 'GBP', timezone: 'UTC' },
        'a GBP 10.00 monthly budget on the owner’s own wallet')
      if (budget.status !== 200 || budget.value === undefined) return fail(`setting the budget answered ${said(budget)}`)
      const paid = await step('POST', '/v1/money/payments', { account_id: account.value.id, payee_id: payee.value.id, amount_minor: PAID_MINOR, currency: 'GBP',
        reference: `Limit ${RUN_SALT}`, idempotency_key: `e2e-${randomBytes(8).toString('hex')}` }, `GBP 8.00 paid to ${supplier}`)
      if (paid.status !== 201) return fail(`paying ${supplier} GBP 8.00 of test money answered ${said(paid)}`)

      // 2. Crossing 80% writes one 80% alert, and reading again raises nothing new.
      const counts: string[] = []
      let eighty: Alert | undefined
      for (const read of ['first', 'second']) {
        const got = await step<{ alerts: Alert[] | null }>('GET', '/v1/money/budgets/alerts', undefined, `the alerts, read a ${read} time`)
        if (got.status !== 200) return fail(`reading the limit alerts answered ${said(got)}`)
        const mine = (got.value?.alerts ?? []).filter((a) => a.kind === 'budget' && a.subject === budget.value?.id)
        const at = (pct: number) => mine.filter((a) => a.percent === pct)
        if (at(50).length !== 1 || at(80).length !== 1 || at(100).length !== 0) {
          return fail(`GBP 8.00 of a GBP 10.00 budget must have raised exactly one 50% and one 80% alert and none at 100%; read a ${read} time, ` +
            `Lens lists ${at(50).length} at 50%, ${at(80).length} at 80% and ${at(100).length} at 100%: ${said(got)}`)
        }
        eighty = at(80)[0]
        if (eighty.spent_minor !== PAID_MINOR || eighty.limit_minor !== BUDGET_MINOR || eighty.currency !== 'GBP') {
          return fail(`the 80% alert must read 800 of 1000 GBP; it reads ${eighty.spent_minor} of ${eighty.limit_minor} ${eighty.currency}`)
        }
        counts.push(`${read} read: one at 50%, one at 80%`)
      }
      if (!screen || eighty === undefined) return { pass: true, detail: `GBP 8.00 of a GBP 10.00 monthly budget: ${counts.join('; ')}` }

      // 3. In the app: the Agent Bank's Limit alerts card shows it.
      const page = await ctx.app.tab('/agents')
      try {
        const row = page.locator(`[data-testid="limit-alert-${eighty.id}"]`)
        const shown = await row.waitFor({ timeout: TIMEOUT_MS }).then(async () => ((await row.textContent()) ?? '').replace(/\s+/g, ' '), () => '')
        ctx.evidence.push({ note: 'the Limit alerts row for the 80% alert', answer: shown })
        if (!shown.includes('80% of your own monthly budget') || !shown.includes('£8.00 of £10.00 spent')) {
          return fail(`the Agent Bank's Limit alerts card must show "80% of your own monthly budget" with "£8.00 of £10.00 spent"; its row reads "${shown.slice(0, 300)}"`)
        }
        await mkdir(ctx.env.outDir, { recursive: true })
        const viewport = page.viewportSize()
        for (const width of [1440, 390]) {
          const path = join(ctx.env.outDir, `limit-alerts-${width}px-user${ctx.app.user.index}.png`)
          await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
          await row.scrollIntoViewIfNeeded()
          await page.screenshot({ path })
          ctx.evidence.push({ note: `the Limit alerts card at ${width}px: ${path}` })
        }
        if (viewport !== null) await page.setViewportSize(viewport)
        return { pass: true, detail: `GBP 8.00 of a GBP 10.00 monthly budget: ${counts.join('; ')}; the Agent Bank shows "${shown.slice(0, 120)}"` }
      } finally {
        await page.close()
      }
    },
  }
}
