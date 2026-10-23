// B44.1 — talyvor.com's waitlist. Once a run, a stranger (a browser with no session) types an address into the waitlist on
// /marketing and must read "You’re on the list."; the same address again, and a bot that fills the hidden honeypot, must add
// no row. The rows are read back from Lens on the operator read key (B44.6) — never judged by a status code — and the BFF's
// CSV must refuse the stranger with 401. Every address is on the testers' domain, which the operator's CSV leaves out.

import { fail } from './bank.ts'
import { RUN_SALT } from './oracles.ts'
import { CannotTest, type Scenario, type Verdict } from './scenarios.ts'

const TIMEOUT_MS = 20_000
const JOINED = 'You’re on the list.'
/** The testers' address domain: apps/bff/waitlist.go's testersWaitlistDomain leaves it out of the operator's CSV. */
export const TESTERS_DOMAIN = '@e2e.talyvor.test'

/** What the stranger saw, and the rows Lens holds for the two addresses the run used. */
export interface Seen {
  said: string[]
  probeRows: number
  botRows: number
  csvStatus: number
}

export function waitlistVerdict(seen: Seen): Verdict {
  const wrong: string[] = []
  for (const [i, s] of seen.said.entries()) if (s !== JOINED) wrong.push(`join ${i + 1} on /marketing read "${s}", not "${JOINED}"`)
  if (seen.probeRows !== 1) wrong.push(`Lens holds ${seen.probeRows} rows for the address joined twice, not 1`)
  if (seen.botRows !== 0) wrong.push(`Lens holds ${seen.botRows} rows for the honeypot's address, not 0`)
  if (seen.csvStatus !== 401) wrong.push(`GET /api/waitlist answered a stranger ${seen.csvStatus}, not 401`)
  if (wrong.length > 0) return fail(wrong.join('; '))
  return { pass: true, detail: `a stranger joined on /marketing twice and read "${JOINED}" both times; Lens holds one row for it, none for the honeypot, and the CSV refuses the stranger 401` }
}

export function waitlistJoin(): Scenario {
  return {
    id: 'waitlist-join',
    owner: 'talyvor-suite',
    items: ['B44.1'],
    feature: 'Marketing',
    title: 'a stranger joins the waitlist on /marketing: one row for the address joined twice, none for the honeypot, and the CSV is the operator’s only',
    run: async (ctx) => {
      const { lens, operatorReadKey } = ctx.env
      if (operatorReadKey === '') throw new CannotTest('the rows are read on LENS_OPERATOR_READ_KEY, which this run was not given')
      const browser = ctx.app.page.context().browser()
      if (browser === null) return fail('the run’s browser is gone')
      const probe = `probe-${RUN_SALT}-${Date.now().toString(36)}${TESTERS_DOMAIN}`
      const bot = `bot-${RUN_SALT}-${Date.now().toString(36)}${TESTERS_DOMAIN}`
      const appURL = new URL(ctx.app.page.url()).origin
      const stranger = await browser.newContext()
      const said: string[] = []
      let csvStatus = 0
      try {
        const page = await stranger.newPage()
        for (const typed of [probe, `  ${probe.toUpperCase()} `]) {
          await page.goto(`${appURL}/marketing?utm_source=e2e`)
          await page.getByLabel('Email address').first().fill(typed)
          await page.getByRole('button', { name: 'Join the waitlist' }).first().click()
          const status = page.getByRole('status').filter({ hasText: JOINED })
          await status.first().waitFor({ timeout: TIMEOUT_MS }).catch(() => undefined)
          said.push(((await page.getByRole('status').first().textContent().catch(() => '')) ?? '').trim())
          ctx.evidence.push({ note: `a stranger types "${typed}" into the waitlist on /marketing`, answer: said[said.length - 1] })
        }
        const honeypot = await page.evaluate(async (email) => {
          const r = await fetch('/api/waitlist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, website: 'http://spam.example' }) })
          return r.status
        }, bot)
        ctx.evidence.push({ note: `a bot posts ${bot} with the honeypot filled`, answer: String(honeypot) })
        csvStatus = await page.evaluate(async () => (await fetch('/api/waitlist')).status)
        ctx.evidence.push({ note: 'the stranger asks GET /api/waitlist', answer: String(csvStatus) })
      } finally {
        await stranger.close().catch(() => undefined)
      }
      const read = await lens.as(operatorReadKey, 'GET', '/v1/admin/waitlist')
      if (read.status !== 200) return fail(`GET /v1/admin/waitlist on the operator read key answered ${read.status} ${read.text.slice(0, 200)}`)
      const rows = (JSON.parse(read.text) as { signups: { email: string }[] }).signups
      const count = (e: string) => rows.filter((r) => r.email === e).length
      ctx.evidence.push({ note: 'Lens’s waitlist rows for the two addresses', answer: `${probe}: ${count(probe)}, ${bot}: ${count(bot)}` })
      return waitlistVerdict({ said, probeRows: count(probe), botRows: count(bot), csvStatus })
    },
  }
}
