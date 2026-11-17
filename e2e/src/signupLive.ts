// B64.2 — ONE SIGN-UP BY PHONE, END TO END, ON THE SITE THE OUTREACH SENDS PEOPLE TO. Before the new marketing page
// ships, this is run once against the live app and its lines go on the pull request:
//   pnpm --filter @talyvor/e2e signup-live --app https://app.talyvor.com
// It needs no key: it does what a visitor does.
//   1. The marketing page: every "Open your account" (and "Open an account") button goes to /signup on the app's origin.
//   2. /signup, signed out — where those buttons go — shows the door: the phone number field.
//   3. door-join, then door-passcode (door.ts), the testers' own scenarios: a number from the range kept for tests, the
//      Sandbox code read from the screen, a passcode chosen twice, sign-up's two steps, the session on the account it
//      opened; then the same number signs in again with its passcode.
// It exits 1 when anything fails. A founder's own sign-up by hand is recorded in the queue, never made here.

import { chromium, type Page } from 'playwright'
import { doorScenarios } from './door.ts'
import { CannotTest, type Evidence, type ScenarioCtx } from './scenarios.ts'

/** What the page's sign-up buttons say. */
export const SIGNUP_CTA = /^\s*Open (your|an) account\b/

/** The sign-up buttons on `page`, each with the address it goes to, resolved against the page. */
export async function signupCTAs(page: Page): Promise<{ text: string; href: string }[]> {
  return page.getByRole('link', { name: SIGNUP_CTA }).evaluateAll((links) =>
    links.map((a) => ({ text: (a.textContent ?? '').trim(), href: (a as HTMLAnchorElement).href })))
}

/** The buttons in `ctas` that do not go to /signup on `origin`, each as a line saying where it goes instead. */
export function strayCTAs(ctas: readonly { text: string; href: string }[], origin: string): string[] {
  return ctas.flatMap(({ text, href }) => {
    const u = new URL(href)
    return u.origin === origin && u.pathname === '/signup' ? [] : [`"${text}" goes to ${href}, not ${origin}/signup`]
  })
}

function argOf(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main(): Promise<number> {
  const app = (argOf('--app') ?? process.env.E2E_APP_URL ?? '').replace(/\/+$/, '')
  if (app === '') {
    console.error('signup-live: give the app, --app https://app.talyvor.com')
    return 2
  }
  const origin = new URL(app).origin
  let failed = false
  const line = (status: string, what: string) => {
    if (status === 'FAIL' || status === 'ERROR') failed = true
    console.log(`${status.padEnd(5)} ${what}`)
  }
  const browser = await chromium.launch()
  try {
    const visitor = await browser.newContext()
    const page = await visitor.newPage()

    await page.goto(`${origin}/marketing`, { waitUntil: 'networkidle' })
    const ctas = await signupCTAs(page)
    const stray = strayCTAs(ctas, origin)
    if (ctas.length === 0) line('NONE', `${page.url()} has no "Open your account" button`)
    else if (stray.length > 0) line('FAIL', `the marketing page's sign-up buttons: ${stray.join('; ')}`)
    else line('PASS', `all ${ctas.length} of the marketing page's sign-up buttons go to ${origin}/signup`)

    await page.goto(`${origin}/signup`, { waitUntil: 'domcontentloaded' })
    const field = await page.getByLabel('Your phone number').waitFor({ timeout: 30_000 }).then(() => true, () => false)
    line(field ? 'PASS' : 'FAIL', `signed out, ${origin}/signup lands on ${page.url()}${field ? ', the door asking for a phone number' : ' with no phone number field'}`)
    await visitor.close()

    // door.ts opens a door of its own from the user's browser and origin; a signed-out page on the app is all it reads.
    const host = await browser.newContext()
    const hostPage = await host.newPage()
    await hostPage.goto(`${origin}/signin`, { waitUntil: 'domcontentloaded' })
    const scenarios = doorScenarios().filter((s) => s.id === 'door-join' || s.id === 'door-passcode')
    for (const s of scenarios) {
      const evidence: Evidence[] = []
      const ctx = { app: { page: hostPage, context: host }, evidence } as unknown as ScenarioCtx
      try {
        const v = await s.run(ctx)
        line(v.pass ? 'PASS' : 'FAIL', `${s.id}: ${v.detail}`)
      } catch (e) {
        line(e instanceof CannotTest ? 'SKIP' : 'ERROR', `${s.id}: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`)
      }
      for (const ev of evidence) if (ev.note !== undefined) console.log(`      ${ev.note}`)
    }
    await host.close()
  } finally {
    await browser.close()
  }
  return failed ? 1 : 0
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(await main())
