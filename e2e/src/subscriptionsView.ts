// B41.20 — the Subscriptions view (/money/subscriptions), once a run, on a workspace of its own. On Lens's API the owner
// accepts the terms of payments out, saves a payee, makes an agent and sets up a £12.00 monthly standing order to the payee,
// first paid in ten days; a seller publishes a listing with a $5.00 monthly subscription and the owner subscribes. Lens
// must hold the standing order active and monthly, the licence active and renewing about 30 days on, and the subscription as
// one line on the owner's marketplace bill. In the app, both are rows of the Subscriptions view, each with its next charge,
// its monthly cost and its reminder three days before. Screenshots at 1440 and 390.

import { randomBytes, randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fail } from './bank.ts'
import type { Listing, MarketLicence, MarketOffer } from './lens.ts'
import { RUN_SALT } from './oracles.ts'
import { CannotTest, type Scenario } from './scenarios.ts'
import { call, said } from './settings.ts'

const TIMEOUT_MS = 30_000
const DAY_MS = 86_400_000
const ORDER_MINOR = 1200
const SUB_USD_MICROS = 5_000_000
const ULXC_PER_USD_MICRO = 10

interface Schedule { id: string; from_agent_id: string; to_payee_id?: string; amount_minor?: number; currency?: string; every: string; next_run_at: string; active: boolean }

/** The view's own date: "14 Nov 2026", in UTC. */
const day = (ms: number) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

/** `screen` false leaves out the app's half, for the unit test on the stub Lens. */
export function subscriptionsView({ screen = true }: { screen?: boolean } = {}): Scenario {
  return {
    id: 'subscriptions-view',
    owner: 'talyvor-suite',
    own: true,
    items: ['B41.20', 'B41.120'],
    feature: 'Agent wallets',
    title: 'the Subscriptions view: a £12.00 monthly standing order and a $5.00 monthly listing subscription each show their next charge, ' +
      'monthly cost and a reminder three days before',
    run: async (ctx) => {
      const { env } = ctx
      const step = async <T>(method: string, path: string, body: unknown, note: string) => {
        const r = await call<T>(ctx, method, path, body)
        ctx.evidence.push({ note, answer: said(r) })
        return r
      }
      // 1. A monthly standing order, from an agent to a saved payee.
      const terms = await step<{ terms: { capability: string; version: number; accepted?: unknown }[] | null }>('GET', '/v1/workspaces/{ws}/terms', undefined, 'the owner reads the terms')
      for (const t of (terms.value?.terms ?? []).filter((x) => ['currency_accounts', 'payments_out'].includes(x.capability) && x.accepted == null)) {
        const ok = await step('POST', `/v1/workspaces/{ws}/terms/${t.capability}/accept`, { version: t.version }, `the owner accepts ${t.capability}'s terms`)
        if (ok.status !== 201) return fail(`accepting ${t.capability}'s terms answered ${said(ok)}`)
      }
      const landlord = `Nightly Office Rent ${RUN_SALT}`
      const payee = await step<{ id: string }>('POST', '/v1/money/payees', { name: landlord, country: 'GB', sort_code: '040004', account_number: '13572468' }, `the payee ${landlord}`)
      if (payee.status !== 201 || payee.value === undefined) return fail(`saving ${landlord} answered ${said(payee)}`)
      const agent = await step<{ id: string }>('POST', '/v1/workspaces/{ws}/agents', { name: `Subscriptions agent ${RUN_SALT}` }, 'the owner makes an agent')
      if (agent.status !== 201 || agent.value === undefined) return fail(`making an agent answered ${said(agent)}`)
      const first = new Date(Date.now() + 10 * DAY_MS)
      first.setUTCHours(9, 0, 0, 0)
      const made = await step<Schedule>('POST', `/v1/workspaces/{ws}/agents/${agent.value.id}/schedules`, { to_agent_id: '', to_listing_id: '', to_payee_id: payee.value.id,
        amount_ulxc: 0, amount_minor: ORDER_MINOR, currency: 'GBP', memo: `Rent ${RUN_SALT}`, every: 'month', first_run_at: first.toISOString() }, 'a GBP 12.00 monthly standing order')
      if (made.status !== 201 || made.value === undefined) return fail(`setting up the standing order answered ${said(made)}`)

      // 2. A listing's monthly subscription, bought from a seller of the scenario's own.
      const [seller] = await env.lens.createUsers(1)
      const offers: MarketOffer[] = [{ kind: 'subscribe', licence: 'personal', price_usd_micros: SUB_USD_MICROS, period_days: 30 }]
      const pub = await env.lens.act<Listing>(seller, 'POST', '/v1/workspaces/{ws}/marketplace/listings', { kind: 'prompt', title: `Monthly brief ${RUN_SALT}`,
        description: '', visibility: 'public', artifact: { template: 'Summarise {{topic}}.', model: env.catalog?.[0]?.id ?? '' }, changelog: '', offers })
      ctx.evidence.push({ note: 'the seller publishes a listing with a $5.00 monthly subscription', answer: JSON.stringify(pub) })
      if (!pub.ok) return fail(`publishing the listing was refused: ${pub.status} ${pub.error}`)
      if (pub.value.review_status !== 'approved') {
        if (!env.lens.canModerate) throw new CannotTest(`the listing was ${pub.value.review_status}, and approving it needs a moderator key: LENS_MODERATOR_KEY`)
        const ok = await env.lens.moderate(pub.value.id, 'approve')
        if (!ok.ok) return fail(`approving the held listing ${pub.value.id}: ${ok.status} ${ok.error}`)
      }
      const read = await env.lens.act<{ offers: MarketOffer[] | null }>(ctx.app.user, 'GET', `/v1/marketplace/listings/${pub.value.id}`)
      const offer = read.ok ? (read.value.offers ?? []).find((o) => o.kind === 'subscribe') : undefined
      if (offer?.id === undefined) return fail(`the owner cannot see the listing's subscription offer: ${JSON.stringify(read)}`)
      const sub = await env.lens.act<MarketLicence>(ctx.app.user, 'POST', `/v1/workspaces/{ws}/marketplace/listings/${pub.value.id}/licences`, { offer_id: offer.id },
        { 'Idempotency-Key': randomUUID() })
      ctx.evidence.push({ note: 'the owner subscribes, monthly', answer: JSON.stringify(sub) })
      if (!sub.ok || sub.status !== 201) return fail(`subscribing answered ${sub.status}: ${sub.ok ? JSON.stringify(sub.value) : sub.error}`)

      // 3. Lens's own record: the standing order, the renewing licence and its line on the bill.
      const schedules = await step<{ schedules: Schedule[] | null }>('GET', '/v1/workspaces/{ws}/agents/schedules', undefined, 'Lens’s record of the agents’ schedules')
      const order = (schedules.value?.schedules ?? []).find((s) => s.id === made.value?.id)
      if (order === undefined || !order.active || order.every !== 'month' || order.amount_minor !== ORDER_MINOR || order.to_payee_id !== payee.value.id) {
        return fail(`Lens must hold the standing order active, GBP 12.00 a month to ${payee.value.id}; it lists ${JSON.stringify(order ?? null)}`)
      }
      const held = await env.lens.act<{ licences: MarketLicence[] | null }>(ctx.app.user, 'GET', '/v1/workspaces/{ws}/marketplace/licences')
      ctx.evidence.push({ note: 'the owner’s licences', answer: JSON.stringify(held) })
      const lic = held.ok ? (held.value.licences ?? []).find((l) => l.id === sub.value.id) : undefined
      if (lic === undefined || lic.status !== 'active' || !lic.auto_renew || lic.ends_at === null) {
        return fail(`the monthly subscription must read active and renewing, with a date it renews; Lens lists ${JSON.stringify(lic ?? null)}`)
      }
      const renews = Date.parse(lic.ends_at)
      if (Math.abs(renews - Date.parse(lic.starts_at) - 30 * DAY_MS) > 60_000) return fail(`a 30-day subscription must renew 30 days after it starts; it runs ${lic.starts_at} to ${lic.ends_at}`)
      const lines = ((await env.lens.marketBill(ctx.app.user)).lines ?? []).filter((l) => l.listing_id === pub.value.id)
      ctx.evidence.push({ note: 'the owner’s marketplace bill, this listing’s lines', answer: JSON.stringify(lines) })
      if (lines.length !== 1 || lines[0].price_ulxc !== SUB_USD_MICROS * ULXC_PER_USD_MICRO) {
        return fail(`the subscription must be one line of ${SUB_USD_MICROS * ULXC_PER_USD_MICRO} µLXC on the bill; it has ${JSON.stringify(lines)}`)
      }
      const recorded = `the standing order next pays ${order.next_run_at}, the subscription renews ${lic.ends_at}, billed once`
      if (!screen) return { pass: true, detail: recorded }

      // 4. In the app: both rows, each with its next charge, monthly cost and reminder.
      const page = await ctx.app.tab('/money/subscriptions')
      try {
        const want: [string, number, string][] = [
          [`so-${order.id}`, Date.parse(order.next_run_at), '£12.00 a month'],
          [`lic-${lic.id}`, renews, '$5.00 a month'],
        ]
        const shown: string[] = []
        for (const [id, next, monthly] of want) {
          const row = page.getByTestId(`subscription-${id}`)
          const text = await row.waitFor({ timeout: TIMEOUT_MS }).then(async () => ((await row.textContent()) ?? '').replace(/\s+/g, ' '), () => '')
          ctx.evidence.push({ note: `the Subscriptions row ${id}`, answer: text })
          for (const part of [`Next charge ${day(next)}`, monthly, `Reminder ${day(next - 3 * DAY_MS)}`]) {
            if (!text.includes(part)) return fail(`the Subscriptions row ${id} must read "${part}"; it reads "${text.slice(0, 300)}"`)
          }
          shown.push(text.slice(0, 120))
        }
        await mkdir(ctx.env.outDir, { recursive: true })
        const viewport = page.viewportSize()
        for (const width of [1440, 390]) {
          const path = join(ctx.env.outDir, `subscriptions-${width}px-user${ctx.app.user.index}-${randomBytes(3).toString('hex')}.png`)
          await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
          await page.screenshot({ path, fullPage: true })
          ctx.evidence.push({ note: `the Subscriptions view at ${width}px: ${path}` })
        }
        if (viewport !== null) await page.setViewportSize(viewport)
        return { pass: true, detail: `${recorded}; the view shows "${shown.join('" and "')}"` }
      } finally {
        await page.close()
      }
    },
  }
}
