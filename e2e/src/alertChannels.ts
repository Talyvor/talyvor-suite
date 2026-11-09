// B28.66 — where alerts go (Lens B28.338), once a run, on a workspace of its own. On Lens's API the owner adds two alert
// channels — push, and a signed webhook whose whsec_ secret comes back once — and is refused an email one, which needs an
// email integration not yet connected. Then, as limit-alerts does, £8.00 paid against a £10.00 monthly budget raises one 50%
// and one 80% alert. The deliveries hold exactly one per alert per channel — four — and the same four when read again. In the
// app, Agent Wallets' "Where alerts go" card lists both channels and each delivery.
//
// The webhook points at a .invalid host (RFC 2606): it can never resolve, so no alert leaves for anyone else's server, and its
// delivery reads failed after its tries. Slack is left out for the same reason: its url must be Slack's own. Queued, sent and
// failed are all a delivery queued; the scenario counts them, not whether they arrived.

import { randomBytes } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fail } from './bank.ts'
import { RUN_SALT } from './oracles.ts'
import type { Scenario } from './scenarios.ts'
import { call, said } from './settings.ts'

const TIMEOUT_MS = 30_000

interface Channel { id: string; kind: string; url?: string; secret?: string }
interface Alert { id: string; kind: string; subject: string; percent: number }
interface Delivery { id: string; channel_id: string; alert_id: string; status: string }

/** `screen` false leaves out the app's half, for the unit test on the stub Lens. */
export function alertChannels({ screen = true }: { screen?: boolean } = {}): Scenario {
  return {
    id: 'alert-channels',
    owner: 'talyvor-suite',
    own: true,
    items: ['B28.66', 'B28.338'],
    feature: 'Agent wallets',
    title: 'alert channels: with push and a signed webhook added and email refused, the 50% and 80% alerts of a budget queue one delivery ' +
      "per channel — four, the same four when read again — and Agent Wallets' Where alerts go card lists them",
    run: async (ctx) => {
      const step = async <T>(method: string, path: string, body: unknown, note: string) => {
        const r = await call<T>(ctx, method, path, body)
        ctx.evidence.push({ note, answer: said(r) })
        return r
      }
      // 1. The channels: push and a webhook are kept, the webhook's secret answered once; email is refused, not faked.
      const push = await step<Channel>('POST', '/v1/money/alerts/channels', { kind: 'push' }, 'the owner adds push')
      if (push.status !== 201 || push.value === undefined) return fail(`adding a push channel answered ${said(push)}`)
      const hook = await step<Channel>('POST', '/v1/money/alerts/channels', { kind: 'webhook', url: `https://alerts-${RUN_SALT}.talyvor-e2e.invalid/hook` },
        'the owner adds a webhook')
      if (hook.status !== 201 || hook.value === undefined) return fail(`adding a webhook channel answered ${said(hook)}`)
      if (!hook.value.secret?.startsWith('whsec_')) return fail(`a webhook channel must come back with its whsec_ signing secret, once; it came back ${said(hook)}`)
      const email = await step('POST', '/v1/money/alerts/channels', { kind: 'email', url: '' }, 'the owner tries email')
      if (email.status !== 400) return fail(`email alerts need an email integration that is not connected, so adding one must be refused 400; it answered ${said(email)}`)
      const listed = await step<{ channels: Channel[] | null }>('GET', '/v1/money/alerts/channels', undefined, 'the channels')
      const kept = (listed.value?.channels ?? []).map((c) => c.id).sort()
      const ids = [push.value.id, hook.value.id].sort()
      if (kept.join() !== ids.join()) return fail(`the channels must be exactly push and the webhook (${ids.join(', ')}); Lens lists ${said(listed)}`)
      if ((listed.value?.channels ?? []).some((c) => c.secret)) return fail(`the channel list must never carry a secret; it reads ${said(listed)}`)

      // 2. On Lens's API: the money, a payee and a £10.00 budget, £8.00 of it paid: the 50% and 80% alerts.
      const terms = await step<{ terms: { capability: string; version: number; accepted?: unknown }[] | null }>('GET', '/v1/workspaces/{ws}/terms', undefined, 'the owner reads the terms')
      for (const t of (terms.value?.terms ?? []).filter((x) => ['currency_accounts', 'payments_in', 'payments_out'].includes(x.capability) && x.accepted == null)) {
        const ok = await step('POST', `/v1/workspaces/{ws}/terms/${t.capability}/accept`, { version: t.version }, `the owner accepts ${t.capability}'s terms`)
        if (ok.status !== 201) return fail(`accepting ${t.capability}'s terms answered ${said(ok)}`)
      }
      const account = await step<{ id: string }>('POST', '/v1/money/accounts', { currency: 'GBP' }, 'the company GBP account')
      if (account.status !== 201 || account.value === undefined) return fail(`opening the company GBP account answered ${said(account)}`)
      const funded = await step('POST', `/v1/money/accounts/${account.value.id}/test-money`, { amount_minor: 5000, idempotency_key: `e2e-${randomBytes(8).toString('hex')}` }, 'GBP 50.00 in it')
      if (funded.status !== 201) return fail(`funding the company GBP account answered ${said(funded)}`)
      const supplier = `Nightly Alert Stationers ${RUN_SALT}`
      const payee = await step<{ id: string }>('POST', '/v1/money/payees', { name: supplier, country: 'GB', sort_code: '040004', account_number: '24681357' }, `the payee ${supplier}`)
      if (payee.status !== 201 || payee.value === undefined) return fail(`saving ${supplier} answered ${said(payee)}`)
      const budget = await step<{ id: string }>('PUT', '/v1/money/budgets', { agent_id: '', category: '', period: 'month', amount_minor: 1000, currency: 'GBP', timezone: 'UTC' },
        'a GBP 10.00 monthly budget on the owner’s own wallet')
      if (budget.status !== 200 || budget.value === undefined) return fail(`setting the budget answered ${said(budget)}`)
      const paid = await step('POST', '/v1/money/payments', { account_id: account.value.id, payee_id: payee.value.id, amount_minor: 800, currency: 'GBP',
        reference: `Alert ${RUN_SALT}`, idempotency_key: `e2e-${randomBytes(8).toString('hex')}` }, `GBP 8.00 paid to ${supplier}`)
      if (paid.status !== 201) return fail(`paying ${supplier} GBP 8.00 answered ${said(paid)}`)
      const alerts = await step<{ alerts: Alert[] | null }>('GET', '/v1/money/budgets/alerts', undefined, 'the limit alerts')
      const raised = (alerts.value?.alerts ?? []).filter((a) => a.kind === 'budget' && a.subject === budget.value?.id).map((a) => a.id)
      if (raised.length !== 2) return fail(`GBP 8.00 of a GBP 10.00 budget must raise the 50% and the 80% alert; Lens lists ${said(alerts)}`)

      // 3. One delivery per alert per channel, and no more on a second read.
      let mine: Delivery[] = []
      const reads: string[] = []
      for (const read of ['first', 'second']) {
        const got = await step<{ deliveries: Delivery[] | null }>('GET', '/v1/money/alerts/deliveries', undefined, `the deliveries, read a ${read} time`)
        if (got.status !== 200) return fail(`reading the alert deliveries answered ${said(got)}`)
        const now = (got.value?.deliveries ?? []).filter((d) => raised.includes(d.alert_id))
        for (const a of raised) {
          for (const c of ids) {
            const n = now.filter((d) => d.alert_id === a && d.channel_id === c).length
            if (n !== 1) return fail(`alert ${a} must be queued exactly once to channel ${c}; read a ${read} time, Lens lists it ${n} times: ${said(got)}`)
          }
        }
        if (read === 'second' && now.map((d) => d.id).sort().join() !== mine.map((d) => d.id).sort().join()) {
          return fail(`reading the deliveries again must list the same four; the first read had ${mine.map((d) => d.id).join(', ')}, the second ${now.map((d) => d.id).join(', ')}`)
        }
        mine = now
        reads.push(`${read} read: ${now.length} deliveries (${now.map((d) => d.status).sort().join(', ')})`)
      }
      const detail = `2 alerts × 2 channels: ${reads.join('; ')}; email refused`
      if (!screen) return { pass: true, detail }

      // 4. In the app: Agent Wallets' Where alerts go card lists both channels and each delivery.
      const page = await ctx.app.tab('/agents')
      try {
        const card = page.locator('[data-testid="alert-channels"]')
        for (const id of [...ids.map((c) => `alert-channel-${c}`), ...mine.map((d) => `alert-delivery-${d.id}`)]) {
          const row = card.locator(`[data-testid="${id}"]`)
          if (!(await row.waitFor({ timeout: TIMEOUT_MS }).then(() => true, () => false))) return fail(`Agent Wallets' Where alerts go card must show ${id}; it does not`)
        }
        const shown = ((await card.textContent()) ?? '').replace(/\s+/g, ' ')
        ctx.evidence.push({ note: 'the Where alerts go card', answer: shown.slice(0, 600) })
        if (!shown.includes('Push to your phones and browsers') || !shown.includes('Webhook, signed')) {
          return fail(`the Where alerts go card must name push and the signed webhook; it reads "${shown.slice(0, 300)}"`)
        }
        await mkdir(ctx.env.outDir, { recursive: true })
        const viewport = page.viewportSize()
        for (const width of [1440, 390]) {
          const path = join(ctx.env.outDir, `alert-channels-${width}px-user${ctx.app.user.index}.png`)
          await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
          await card.scrollIntoViewIfNeeded()
          await page.screenshot({ path })
          ctx.evidence.push({ note: `the Where alerts go card at ${width}px: ${path}` })
        }
        if (viewport !== null) await page.setViewportSize(viewport)
        return { pass: true, detail: `${detail}; Agent Wallets lists both channels and all four` }
      } finally {
        await page.close()
      }
    },
  }
}
