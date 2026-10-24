// B47.2 — on /chat the suite's sidebar waits off to the left. Once a run, at 1440 px and on a 390 px phone: landing on /chat
// shows no suite sidebar, Menu opens it over the page without moving the chat, and Escape closes it; Home still shows the
// sidebar as before (beside the page from 840 px up, a drawer behind Menu below it).

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from 'playwright'
import { fail } from './bank.ts'
import { VIEWPORTS } from './chatFirstMessage.ts'
import type { Scenario, Verdict } from './scenarios.ts'

/** What one viewport showed, or why it could not be read. */
export interface SidebarSeen {
  viewport: string
  /** the sidebar is drawn beside the page on Home without asking: true from 840 px up */
  besidePage: boolean
  why?: string
  chatShown?: boolean
  opened?: boolean
  /** how far the chat moved, in px, when Menu opened the sidebar */
  moved?: number
  escClosed?: boolean
  homeShown?: boolean
}

export function chatSidebarVerdict(seen: readonly SidebarSeen[]): Verdict {
  const wrong: string[] = []
  for (const s of seen) {
    const on = `on the ${s.viewport}`
    if (s.why !== undefined) {
      wrong.push(`${on}: ${s.why}`)
      continue
    }
    if (s.chatShown) wrong.push(`${on}, /chat opened with the suite sidebar showing`)
    if (!s.opened) wrong.push(`${on}, Menu on /chat did not open the sidebar`)
    if (s.moved !== 0) wrong.push(`${on}, ${s.moved === undefined ? 'the chat could not be measured' : `the chat moved ${s.moved} px`} when the sidebar opened`)
    if (!s.escClosed) wrong.push(`${on}, Escape did not close the sidebar on /chat`)
    if (s.homeShown !== s.besidePage) wrong.push(`${on}, Home ${s.homeShown ? 'showed' : 'hid'} the sidebar, as before it ${s.besidePage ? 'showed' : 'hid'} it`)
  }
  if (wrong.length > 0) return fail(wrong.join('; '))
  return { pass: true, detail: `on ${seen.map((s) => s.viewport).join(' and ')}, /chat opens with no suite sidebar, Menu opens it without moving the chat, Escape closes it, and Home shows it as before` }
}

export function chatSidebar(): Scenario {
  return {
    id: 'chat-sidebar-hidden',
    owner: 'talyvor-suite',
    items: ['B47.2'],
    title: 'on /chat the suite sidebar is hidden until Menu opens it and Escape closes it, at 1440 px and on a 390 px phone; Home shows it as before',
    run: async (ctx) => {
      const browser = ctx.app.page.context().browser()
      if (browser === null) return fail('the run’s browser is gone')
      const appURL = new URL(ctx.app.page.url()).origin
      const cookies = await ctx.app.context.cookies()
      const { dir, link } = ctx.env.shots
      await mkdir(dir, { recursive: true })
      const seen: SidebarSeen[] = []
      for (const v of VIEWPORTS) {
        const context = await browser.newContext({ viewport: { width: v.width, height: v.height }, isMobile: v.phone, hasTouch: v.phone })
        const s: SidebarSeen = { viewport: `${v.name} (${v.width} px)`, besidePage: v.width >= 840 }
        const shot = async (page: Page, what: string) => {
          const file = `chat-sidebar-${what}-${v.width}px-user${ctx.app.user.index}.png`
          await page.screenshot({ path: join(dir, file) }).catch(() => undefined)
          ctx.evidence.push({ note: `${what.replace('-', ' ')}, ${v.width} px`, shot: `${link}/${file}` })
        }
        try {
          await context.addCookies(cookies)
          const page = await context.newPage()
          const aside = page.locator('aside[aria-label="Primary"]')
          const menu = page.getByRole('button', { name: 'Menu', exact: true })
          const main = page.locator('main')
          await page.goto(`${appURL}/chat`)
          await page.getByLabel('Your message', { exact: true }).waitFor({ state: 'visible' })
          s.chatShown = await aside.isVisible()
          await shot(page, 'chat-closed')
          const before = await main.boundingBox()
          await menu.click({ timeout: 3_000 })
          s.opened = await aside.waitFor({ state: 'visible', timeout: 3_000 }).then(() => true, () => false)
          const after = await main.boundingBox()
          s.moved = before && after ? Math.round(Math.abs(after.x - before.x) + Math.abs(after.width - before.width)) : undefined
          await shot(page, 'chat-open')
          await page.keyboard.press('Escape')
          s.escClosed = await aside.waitFor({ state: 'hidden', timeout: 3_000 }).then(() => true, () => false)
          await page.goto(`${appURL}/`)
          await page.locator('h1').first().waitFor({ state: 'visible' })
          s.homeShown = await aside.isVisible()
          await shot(page, 'home')
        } catch (e) {
          s.why = (e as Error).message.split('\n')[0]
        } finally {
          await context.close().catch(() => undefined)
        }
        ctx.evidence.push({ note: `the ${s.viewport}: ${s.why ?? `chat sidebar shown ${s.chatShown}, Menu opened ${s.opened}, chat moved ${s.moved} px, Escape closed ${s.escClosed}, Home sidebar shown ${s.homeShown}`}` })
        seen.push(s)
      }
      return chatSidebarVerdict(seen)
    },
  }
}
