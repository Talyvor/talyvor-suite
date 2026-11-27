// B17.515 — the low-balance alert (B28.61, on Lens B28.334), once a run, on a workspace of its own. On Lens's API the owner
// gives an agent's GBP account £20.00 from the company's: one agent_funding of 2000 on its statement. On the agent's page in
// the app the owner sets its Low balance alert to £25.00 and presses Save: the account reads Alert below £25.00, Below. Lens
// holds the threshold with the agent's £20.00 below it, and the alerts, read three times, list one for the agent's GBP
// balance in each UTC hour, £20.00 below £25.00, never one a read. Back on the agent's page, Latest alerts shows it.

import { randomBytes } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fail } from './bank.ts'
import { RUN_SALT } from './oracles.ts'
import type { Scenario } from './scenarios.ts'
import { call, said } from './settings.ts'

const TIMEOUT_MS = 30_000
const COMPANY_MINOR = 5000
const FUND_MINOR = 2000
const THRESHOLD_MINOR = 2500
const READS = 3
const CAPABILITIES = ['currency_accounts', 'payments_in', 'payments_out']

interface Account { id: string; test_minor: number }
interface Threshold { id: string; agent_id: string; currency: string; threshold_minor: number; balance_minor: number; has_account: boolean; below: boolean }
interface Alert { id: string; agent_id: string; currency: string; hour_start: string; balance_minor: number; threshold_minor: number }
interface Statement { lines: { kind: string; amount_minor: number }[] | null }

/** `screen` false sets the threshold on Lens's API and leaves out the app, for the unit test on the stub Lens. */
export function lowBalanceAlert({ screen = true }: { screen?: boolean } = {}): Scenario {
  return {
    id: 'low-balance-alert',
    owner: 'talyvor-suite',
    own: true,
    agents: 1,
    items: ['B28.61', 'B28.334'],
    feature: 'Agent wallets',
    title: "a low-balance alert: an agent holding £20.00 with its alert set to £25.00 on its page reads Below, and Lens's alerts, " +
      'read three times, list one an hour, never one a read; Latest alerts on the page shows it',
    run: async (ctx) => {
      const { lens } = ctx.env
      const user = ctx.app.user
      const key = () => `e2e-${randomBytes(8).toString('hex')}`
      const step = async <T>(method: string, path: string, body: unknown, note: string) => {
        const r = await call<T>(ctx, method, path, body)
        ctx.evidence.push({ note, answer: said(r) })
        return r
      }

      // 1. On Lens's API: the agent's GBP account given £20.00 from the company's, one agent_funding on its statement.
      const terms = await step<{ terms: { capability: string; version: number; accepted?: unknown }[] | null }>('GET', '/v1/workspaces/{ws}/terms', undefined, 'the owner reads the terms')
      for (const t of (terms.value?.terms ?? []).filter((x) => CAPABILITIES.includes(x.capability) && x.accepted == null)) {
        const ok = await step('POST', `/v1/workspaces/{ws}/terms/${t.capability}/accept`, { version: t.version }, `the owner accepts ${t.capability}'s terms`)
        if (ok.status !== 201) return fail(`accepting ${t.capability}'s terms answered ${said(ok)}`)
      }
      const company = await step<Account>('POST', '/v1/money/accounts', { currency: 'GBP' }, "the company's GBP account")
      if (company.status !== 201 || company.value === undefined) return fail(`opening the company's GBP account answered ${said(company)}`)
      const topped = await step('POST', `/v1/money/accounts/${company.value.id}/test-money`, { amount_minor: COMPANY_MINOR, idempotency_key: key() }, "GBP 50.00 into the company's account")
      if (topped.status !== 201) return fail(`GBP 50.00 into the company's account answered ${said(topped)}`)
      const agent = await lens.createAgent(user, `Low balance agent ${RUN_SALT}`)
      const opened = await step<Account>('POST', '/v1/money/accounts', { currency: 'GBP', agent_id: agent.id }, `${agent.name}'s GBP account`)
      if (opened.status !== 201 || opened.value === undefined) return fail(`opening ${agent.name}'s GBP account answered ${said(opened)}`)
      const acct = opened.value.id
      const given = await step('POST', `/v1/money/accounts/${acct}/funding`, { direction: 'to_agent', amount_minor: FUND_MINOR, idempotency_key: key() }, `${agent.name}'s account is given GBP 20.00`)
      if (given.status !== 201) return fail(`giving ${agent.name}'s account GBP 20.00 answered ${said(given)}`)
      const st = await step<Statement>('GET', `/v1/money/accounts/${acct}/statement`, undefined, `${agent.name}'s statement`)
      const funding = (st.value?.lines ?? []).filter((l) => l.kind === 'agent_funding').map((l) => l.amount_minor)
      if (st.status !== 200 || funding.length !== 1 || funding[0] !== FUND_MINOR) {
        return fail(`${agent.name}'s statement must hold one agent_funding of ${FUND_MINOR}; it holds ${JSON.stringify(funding)}: ${said(st)}`)
      }

      // 2. The alert set to £25.00: on the agent's page in the app, or on Lens's API without it.
      const page = screen ? await ctx.app.tab(`/agents/${encodeURIComponent(agent.id)}`) : undefined
      try {
        if (page !== undefined) {
          const row = page.getByTestId('agent-page-low-balance').getByTestId('low-balance-GBP')
          await row.getByRole('textbox', { name: 'Low balance amount, GBP' }).fill('25.00', { timeout: TIMEOUT_MS })
          await row.getByRole('button', { name: 'Save', exact: true }).click()
          const saved = await row.getByText('Below', { exact: true }).waitFor({ timeout: TIMEOUT_MS }).then(() => true, () => false)
          const shown = ((await row.textContent()) ?? '').replace(/\s+/g, ' ')
          ctx.evidence.push({ note: "the agent's GBP account on its Low balance alert card, saved", answer: shown })
          if (!saved || !shown.includes('Alert below £25.00')) {
            return fail(`saved at 25.00, the agent's GBP account must read "Alert below £25.00" with Below, since it holds £20.00; it reads "${shown.slice(0, 300)}"`)
          }
        } else {
          const set = await step('PUT', '/v1/money/low-balance', { agent_id: agent.id, currency: 'GBP', threshold_minor: THRESHOLD_MINOR }, 'the alert set to GBP 25.00')
          if (set.status !== 200) return fail(`setting the low-balance alert answered ${said(set)}`)
        }
        const held = await step<{ thresholds: Threshold[] | null }>('GET', '/v1/money/low-balance', undefined, "Lens's low-balance thresholds")
        const mine = (held.value?.thresholds ?? []).filter((t) => t.agent_id === agent.id && t.currency === 'GBP')
        const t = mine[0]
        if (held.status !== 200 || mine.length !== 1 || t.threshold_minor !== THRESHOLD_MINOR || t.balance_minor !== FUND_MINOR || !t.has_account || !t.below) {
          return fail(`Lens must hold one GBP threshold of ${THRESHOLD_MINOR} for ${agent.name}, its ${FUND_MINOR} below it; it holds ${JSON.stringify(mine)}`)
        }

        // 3. Read again and again, the alerts are one an hour, not one a read.
        let alerts: Alert[] = []
        for (let read = 1; read <= READS; read++) {
          const got = await step<{ alerts: Alert[] | null }>('GET', '/v1/money/low-balance/alerts', undefined, `the low-balance alerts, read ${read} of ${READS}`)
          if (got.status !== 200) return fail(`reading the low-balance alerts answered ${said(got)}`)
          alerts = (got.value?.alerts ?? []).filter((a) => a.agent_id === agent.id && a.currency === 'GBP')
        }
        const hours = new Set(alerts.map((a) => a.hour_start))
        if (alerts.length === 0 || alerts.length !== hours.size || hours.size > 2) {
          return fail(`£20.00 below a £25.00 threshold, read ${READS} times, must raise one alert for each hour it was read in; Lens lists ${alerts.length} ` +
            `in ${hours.size} hour(s): ${JSON.stringify(alerts)}`)
        }
        const latest = alerts[0]
        if (alerts.some((a) => a.balance_minor !== FUND_MINOR || a.threshold_minor !== THRESHOLD_MINOR)) {
          return fail(`each alert must read ${FUND_MINOR} below ${THRESHOLD_MINOR}; Lens lists ${JSON.stringify(alerts)}`)
        }
        const counted = `read ${READS} times, one alert for each of the ${hours.size} hour(s) it was read in, ${FUND_MINOR} below ${THRESHOLD_MINOR}`
        if (page === undefined) return { pass: true, detail: `GBP 20.00 against a GBP 25.00 low-balance alert: ${counted}` }

        // 4. Back on the agent's page, Latest alerts shows it.
        await page.reload()
        const shown = page.getByTestId(`low-balance-alert-${latest.id}`)
        const text = await shown.waitFor({ timeout: TIMEOUT_MS }).then(async () => ((await shown.textContent()) ?? '').replace(/\s+/g, ' '), () => '')
        ctx.evidence.push({ note: "the alert on the agent's Latest alerts", answer: text })
        if (!text.includes('£20.00, below £25.00')) {
          return fail(`the agent's page must list the alert under Latest alerts as "£20.00, below £25.00"; its row reads "${text.slice(0, 300)}"`)
        }
        await mkdir(ctx.env.outDir, { recursive: true })
        const viewport = page.viewportSize()
        for (const width of [1440, 390]) {
          const path = join(ctx.env.outDir, `low-balance-alert-${width}px-user${user.index}.png`)
          await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
          await page.getByTestId('agent-page-low-balance').scrollIntoViewIfNeeded()
          await page.screenshot({ path })
          ctx.evidence.push({ note: `the Low balance alert card at ${width}px: ${path}` })
        }
        if (viewport !== null) await page.setViewportSize(viewport)
        return { pass: true, detail: `GBP 20.00 against a GBP 25.00 low-balance alert set on the agent's page: ${counted}; Latest alerts reads "${text.slice(0, 120)}"` }
      } finally {
        await page?.close()
      }
    },
  }
}
