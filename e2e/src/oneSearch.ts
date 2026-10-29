// B41.7 — one search box for everything, once a run, on a workspace of its own. A supplier is saved as a payee, sends a bill and
// is paid £10.00 of test money from the company's GBP account; in the app, / opens the search, the supplier's name lists its
// payee, its payment and its bill under their own headings (Lens B41.107), and each result opens its own screen on its own row.

import { randomBytes } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fail } from './bank.ts'
import { RUN_SALT } from './oracles.ts'
import type { Scenario } from './scenarios.ts'
import { call, said } from './settings.ts'

const TIMEOUT_MS = 30_000
const PAID_MINOR = 1000

export function oneSearch(): Scenario {
  return {
    id: 'one-search',
    owner: 'talyvor-suite',
    own: true,
    items: ['B41.7'],
    feature: 'Agent wallets',
    title: "one search box: / opens it, a supplier's name lists its payee, its payment and its bill under their own headings, and each " +
      'result opens its own screen on its own row',
    run: async (ctx) => {
      const step = async <T>(method: string, path: string, body: unknown, note: string) => {
        const r = await call<T>(ctx, method, path, body)
        ctx.evidence.push({ note, answer: said(r) })
        return r
      }
      // 1. On Lens's API: a supplier saved as a payee, its bill, and a payment to it.
      const terms = await step<{ terms: { capability: string; version: number; accepted?: unknown }[] | null }>('GET', '/v1/workspaces/{ws}/terms', undefined, 'the owner reads the terms')
      for (const t of (terms.value?.terms ?? []).filter((x) => ['currency_accounts', 'payments_out'].includes(x.capability) && x.accepted == null)) {
        const ok = await step('POST', `/v1/workspaces/{ws}/terms/${t.capability}/accept`, { version: t.version }, `the owner accepts ${t.capability}'s terms`)
        if (ok.status !== 201) return fail(`accepting ${t.capability}'s terms answered ${said(ok)}`)
      }
      const account = await step<{ id: string }>('POST', '/v1/money/accounts', { currency: 'GBP' }, 'the company GBP account')
      if (account.status !== 201 || account.value === undefined) return fail(`opening the company GBP account answered ${said(account)}`)
      const funded = await step('POST', `/v1/money/accounts/${account.value.id}/test-money`, { amount_minor: 5000, idempotency_key: `e2e-${randomBytes(8).toString('hex')}` }, 'GBP 50.00 of test money in it')
      if (funded.status !== 201) return fail(`putting test money in the company GBP account answered ${said(funded)}`)
      const supplier = `Nightly Search Joinery ${RUN_SALT}`
      const payee = await step<{ id: string }>('POST', '/v1/money/payees', { name: supplier, country: 'GB', sort_code: '040004', account_number: '13572468' }, `the payee ${supplier}`)
      if (payee.status !== 201 || payee.value === undefined) return fail(`saving ${supplier} answered ${said(payee)}`)
      const added = await ctx.env.lens.raw(ctx.app.user.token, 'POST', '/v1/money/bills?source=photo', [`From: ${supplier}`, 'INVOICE', `Invoice number: SRCH-${RUN_SALT}`,
        `Due date: ${new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10)}`, 'Total due: GBP 42.00', 'Sort code: 04-00-04', 'Account number: 13572468'].join('\n'), 'text/plain')
      ctx.evidence.push({ note: `a bill from ${supplier}`, answer: `${added.status} ${added.text.slice(0, 300)}` })
      if (added.status !== 201) return fail(`adding the bill must answer 201; Lens answered ${added.status} ${added.text.slice(0, 200)}`)
      const bill = JSON.parse(added.text) as { id: string }
      const paid = await step<{ id: string }>('POST', '/v1/money/payments', { account_id: account.value.id, payee_id: payee.value.id, amount_minor: PAID_MINOR, currency: 'GBP',
        reference: `Search ${RUN_SALT}`, idempotency_key: `e2e-${randomBytes(8).toString('hex')}` }, `GBP 10.00 paid to ${supplier}`)
      if (paid.status !== 201 || paid.value === undefined) return fail(`paying ${supplier} GBP 10.00 of test money answered ${said(paid)}`)
      const found = { payee: payee.value.id, payment: paid.value.id, bill: bill.id }

      // 2. In the app: / opens the one search, and the supplier's name finds all three, each under its heading.
      const page = await ctx.app.tab('/')
      try {
        const palette = page.getByRole('dialog', { name: 'Command palette' })
        const box = palette.getByRole('combobox', { name: 'Search, or type a command' })
        const option = (kind: string, id: string) => palette.getByRole('group', { name: `${kind[0].toUpperCase()}${kind.slice(1)}s` }).locator(`[role="option"][id$="-${kind}:${id}"]`)
        const search = async () => {
          await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
          await page.keyboard.press('Slash')
          await box.fill(supplier, { timeout: TIMEOUT_MS })
          for (const [kind, id] of Object.entries(found)) await option(kind, id).waitFor({ timeout: TIMEOUT_MS })
        }
        try {
          await search()
        } catch (e) {
          const shown = ((await palette.textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ')
          return fail(`searching "${supplier}" must list its payee, its payment and its bill: ${(e as Error).message.split('\n')[0]}; the search shows "${shown.slice(0, 400)}"`)
        }
        await mkdir(ctx.env.outDir, { recursive: true })
        const viewport = page.viewportSize()
        for (const width of [1440, 390]) {
          const path = join(ctx.env.outDir, `one-search-${width}px-user${ctx.app.user.index}.png`)
          await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
          await page.screenshot({ path })
          ctx.evidence.push({ note: `the search for "${supplier}" at ${width}px: ${path}` })
        }
        if (viewport !== null) await page.setViewportSize(viewport)

        // 3. Each result opens its own screen, on its own row.
        const opened: string[] = []
        for (const [kind, id] of Object.entries(found)) {
          if (!(await palette.isVisible())) await search()
          await option(kind, id).click({ timeout: TIMEOUT_MS })
          const row = page.locator(`[data-testid="${kind}-${id}"]`)
          const linked = await row.and(page.locator('[data-linked="true"]')).waitFor({ timeout: TIMEOUT_MS }).then(() => true, () => false)
          const at = new URL(page.url())
          ctx.evidence.push({ note: `the ${kind} result opened ${at.pathname}${at.hash}, its row marked=${linked}` })
          if (at.pathname !== '/money/pay' || at.hash !== `#${kind}-${id}` || !linked) {
            return fail(`the ${kind} result must open /money/pay#${kind}-${id} with its row marked; it opened ${at.pathname}${at.hash}, row marked=${linked}`)
          }
          opened.push(`${kind} ${at.pathname}${at.hash}`)
        }
        return { pass: true, detail: `"${supplier}" listed its payee, its payment and its bill under their headings; each opened its own row: ${opened.join(', ')}` }
      } finally {
        await page.close()
      }
    },
  }
}
