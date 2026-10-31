// B45.3 — a first chat message in 10 seconds, on a desktop and on a 390 px phone, with labels. Once a run, on a workspace
// of its own: its owner opens /chat in a browser that has never been there (B45.1's first visit: Options and the
// statement closed), types a message and presses Enter, and the message must be in the conversation and sent within
// 10 seconds of landing. The send is answered inside the browser, so it costs nothing; that the server answers is every
// other chat scenario's job. Then axe checks the page for anything a screen reader would find unnamed.

import { createRequire } from 'node:module'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fail } from './bank.ts'
import { madeUpAnswer, type Scenario, type Verdict } from './scenarios.ts'

export const FIRST_MESSAGE_MS = 10_000
/** Every wait in a visit is bounded by what is left of FIRST_MESSAGE_MS, so a visit far longer than that means the run's
 *  own machine stalled, not the page (B17.312: on 31 Oct, swap 79% full, a 9.4 s fill returned after 951 s). Such a
 *  visit is made once more; two say nothing about Chat, so the scenario errors rather than fails. */
export const STALLED_MS = 4 * FIRST_MESSAGE_MS
export const stalled = (tookMs: number): boolean => tookMs > STALLED_MS
export const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900, phone: false },
  { name: 'phone', width: 390, height: 844, phone: true },
] as const
/** axe's rules for a control, image or region with no accessible name. */
export const LABEL_RULES = [
  'label', 'button-name', 'link-name', 'select-name', 'input-button-name', 'image-alt', 'svg-img-alt', 'role-img-alt',
  'aria-input-field-name', 'aria-toggle-field-name', 'aria-command-name', 'aria-dialog-name', 'aria-progressbar-name',
  'aria-meter-name', 'aria-tooltip-name', 'aria-treeitem-name', 'frame-title',
]

/** One first visit: how long from landing to the message sent, or why it never was; what axe found unnamed. */
export interface Landed {
  viewport: string
  ms?: number
  why?: string
  unlabelled: string[]
}

export function firstMessageVerdict(landed: readonly Landed[]): Verdict {
  const wrong: string[] = []
  for (const l of landed) {
    if (l.ms === undefined) wrong.push(`on the ${l.viewport}, no first message was sent: ${l.why ?? 'no reason recorded'}`)
    else if (l.ms > FIRST_MESSAGE_MS) wrong.push(`on the ${l.viewport}, the first message took ${l.ms} ms from landing, over ${FIRST_MESSAGE_MS}`)
    if (l.unlabelled.length > 0) wrong.push(`on the ${l.viewport}, axe finds unnamed: ${l.unlabelled.join('; ')}`)
  }
  if (wrong.length > 0) return fail(wrong.join('; '))
  return { pass: true, detail: `a first visit to /chat sent its first message in ${landed.map((l) => `${l.ms} ms on the ${l.viewport}`).join(' and ')}, and axe finds nothing unnamed` }
}

export function chatFirstMessage(): Scenario {
  return {
    id: 'chat-first-message',
    owner: 'talyvor-suite',
    own: true,
    items: ['B45.1', 'B45.3'],
    title: 'a new user lands on /chat and sends a first message within 10 seconds, at 1440 px and on a 390 px phone, and axe finds nothing unnamed',
    run: async (ctx) => {
      const browser = ctx.app.page.context().browser()
      if (browser === null) return fail('the run’s browser is gone')
      const appURL = new URL(ctx.app.page.url()).origin
      const cookies = await ctx.app.context.cookies()
      const axe = createRequire(import.meta.url).resolve('axe-core')
      const { dir, link } = ctx.env.shots
      await mkdir(dir, { recursive: true })
      const landed: Landed[] = []
      for (const v of VIEWPORTS) for (let visit = 1; ; visit++) {
        // The session only: no localStorage, so Chat opens as it does the first time. CSP bypassed for axe's script alone.
        const context = await browser.newContext({ viewport: { width: v.width, height: v.height }, isMobile: v.phone, hasTouch: v.phone, bypassCSP: true })
        const l: Landed = { viewport: `${v.name} (${v.width} px)`, unlabelled: [] }
        let took = 0
        try {
          await context.addCookies(cookies)
          const page = await context.newPage()
          const message = `Hello, first message from the ${v.name}`
          let sentBody = ''
          let wasSent = (): void => undefined
          const sent = new Promise<void>((resolve) => {
            wasSent = resolve
          })
          await page.route('**/api/ai/stream/**', async (route) => {
            sentBody = route.request().postData() ?? ''
            wasSent()
            const provider = new URL(route.request().url()).pathname.split('/')[4] ?? 'anthropic'
            await route.fulfill({ status: 200, contentType: 'text/event-stream', body: madeUpAnswer(provider, 'Hello.', false) })
          })
          const t0 = Date.now()
          const left = () => Math.max(1, FIRST_MESSAGE_MS - (Date.now() - t0))
          try {
            await page.goto(`${appURL}/chat`, { timeout: FIRST_MESSAGE_MS })
            const composer = page.getByLabel('Your message', { exact: true })
            await composer.fill(message, { timeout: left() })
            await composer.press('Enter', { timeout: left() })
            await Promise.race([sent, new Promise((_, no) => setTimeout(() => no(new Error('the message was never sent')), left()))])
            await page.locator('[data-testid="turn-user"]').filter({ hasText: message }).first().waitFor({ state: 'visible', timeout: left() })
            l.ms = Date.now() - t0
            if (!sentBody.includes(message)) {
              l.ms = undefined
              l.why = `the request sent does not carry the message typed: ${sentBody.slice(0, 200)}`
            }
          } catch (e) {
            l.why = `${(e as Error).message.split('\n')[0]} (${Date.now() - t0} ms after landing)`
          }
          took = Date.now() - t0
          ctx.evidence.push({ note: `the ${l.viewport}: ${l.ms === undefined ? l.why : `"${message}" sent and shown ${l.ms} ms after landing on /chat`}` })
          const file = `chat-first-message-${v.width}px-user${ctx.app.user.index}.png`
          await page.screenshot({ path: join(dir, file) }).catch(() => undefined)
          ctx.evidence.push({ note: `/chat after the first message, ${v.width} px`, shot: `${link}/${file}` })
          await page.addScriptTag({ path: axe })
          l.unlabelled = await page.evaluate(async (rules) => {
            const r = await (window as unknown as { axe: { run: (c: Document, o: object) => Promise<{ violations: { id: string; nodes: { target: string[] }[] }[] }> } })
              .axe.run(document, { runOnly: { type: 'rule', values: rules } })
            return r.violations.map((x) => `${x.id} at ${x.nodes.map((n) => n.target.join(' ')).join(', ')}`)
          }, LABEL_RULES)
        } finally {
          await context.close().catch(() => undefined)
        }
        if (!stalled(took)) {
          landed.push(l)
          break
        }
        const why = `visit ${visit} took ${took} ms though every wait in it was bounded by ${FIRST_MESSAGE_MS} ms: this machine stalled, not the page`
        ctx.evidence.push({ note: `the ${l.viewport}: ${why}` })
        if (visit === 2) throw new Error(`on the ${l.viewport}, ${why}, twice`)
      }
      return firstMessageVerdict(landed)
    },
  }
}
