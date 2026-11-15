// B61.48 — the Sandbox label (the launch version's 'sandbox-label' area), once a run. Every signed-in launch screen of the web app —
// every screen the app's router has, less the public pages, the screens of a hidden area and the ones a path needs an id for —
// is opened in turn: each carries the top bar's Sandbox label, no Live label anywhere on it, and no line that calls the money
// "test money" (LAUNCH-PACK.md section 4: "Sandbox label on every screen. Nothing in the copy says real money is live").
// The screens hidden from the launch version are read from the web app's own list (launch.ts hiddenPaths), never kept here.

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from 'playwright'
import { fail } from './bank.ts'
import type { Entry } from './coverage.ts'
import { hiddenPaths } from './launch.ts'
import type { Scenario } from './scenarios.ts'

const TIMEOUT_MS = 30_000
const REPO = join(dirname(fileURLToPath(import.meta.url)), '../..')

/** What one screen showed: its labels by state, the top bar's among them, and its words. */
export interface LabelShot {
  path: string
  /** data-status-label of every label on the screen, the top bar's included */
  labels: string[]
  /** the top bar's own label: its state, or "unknown" for "Status unknown", or "" for none */
  top: string
  text: string
}

/** The words that call Sandbox money "test money", in any case, or say that what moves is real. */
const NOT_SANDBOX = [/\btest[\s-]money\b/i, /\breal money (?:moves|is moving|is live)\b/i]

/** What is wrong with one screen: no Sandbox label on top, a Live label, or a line that calls the money test money. */
export function labelFaults(s: LabelShot): string[] {
  const faults: string[] = []
  if (s.top !== 'sandbox') faults.push(`${s.path} must carry the Sandbox label in its top bar; it carries ${s.top === '' ? 'none' : `"${s.top}"`}`)
  if (s.labels.includes('live')) faults.push(`${s.path} reads as live money: it carries a Live label`)
  for (const re of NOT_SANDBOX) {
    const m = re.exec(s.text)
    if (m !== null) faults.push(`${s.path} says "${s.text.slice(Math.max(0, m.index - 60), m.index + m[0].length + 60).trim()}"`)
  }
  return faults
}

/** The signed-in launch screens: the router's screens less public pages, hidden areas, catch-alls and paths with an id. */
export function launchScreens(screens: readonly Entry[], hidden: readonly string[]): string[] {
  const under = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`)
  return [...new Set(screens.filter((e) => e.public !== true && !e.path.includes(':') && !e.path.includes('*'))
    .map((e) => e.path)
    .filter((p) => !hidden.some((h) => under(p, h))))].sort()
}

async function shoot(page: Page, path: string): Promise<LabelShot> {
  // The top bar's label is drawn once Lens's capabilities answer: wait for it, or for "Status unknown", then read the screen.
  await page.locator('header [data-status-label], [data-testid="workspace-status-unknown"]').first().waitFor({ timeout: TIMEOUT_MS }).catch(() => undefined)
  return page.evaluate((p) => {
    const header = document.querySelector('header')
    const top = header?.querySelector('[data-status-label]')?.getAttribute('data-status-label')
      ?? (document.querySelector('[data-testid="workspace-status-unknown"]') ? 'unknown' : '')
    return {
      path: p,
      labels: Array.from(document.querySelectorAll('[data-status-label]'), (el) => el.getAttribute('data-status-label') ?? ''),
      top,
      text: (document.body.innerText ?? '').replace(/\s+/g, ' '),
    }
  }, path)
}

export function sandboxLabelEveryScreen(): Scenario {
  return {
    id: 'sandbox-label-every-screen',
    owner: 'talyvor-suite',
    items: ['B61.48'],
    feature: 'Sandbox label',
    title: 'the Sandbox label: every signed-in launch screen carries it in the top bar, none carries a Live label, and none calls the money "test money"',
    run: async (ctx) => {
      const hidden = await hiddenPaths(REPO, 'none')
      if (hidden.screens.length === 0) return fail(`the web app's list of hidden screens (apps/web/src/lib/workspaceAreas.tsx) read as empty under ${REPO}`)
      const paths = launchScreens(ctx.env.inventory.screens, hidden.screens)
      if (paths.length === 0) return fail('the router lists no signed-in launch screen')
      const faults: string[] = []
      const page = await ctx.app.tab(paths[0])
      try {
        for (const path of paths) {
          if (page.url() !== new URL(path, page.url()).href) await page.goto(new URL(path, page.url()).href)
          const shot = await shoot(page, path)
          ctx.evidence.push({ note: `${path}: the top bar's label and every label on it`, answer: `top "${shot.top}"; ${shot.labels.join(', ') || 'no labels'}` })
          faults.push(...labelFaults(shot))
        }
      } finally {
        await page.close()
      }
      return faults.length > 0 ? fail(faults.join('; ')) : { pass: true, detail: `${paths.length} signed-in launch screens, each with the Sandbox label on top, none Live and none calling it test money` }
    },
  }
}
