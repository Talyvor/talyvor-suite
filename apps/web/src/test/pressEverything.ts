/**
 * B57.1 — pressEverything: render a route in the real <App />, press every button, link, tab, switch and
 * menu item on it, and report each one that does nothing. A press does something when it changes the
 * address, opens a dialog, shows a message (role status or alert), flips a switch or sends a request.
 * A disabled control is not pressed; it passes only when it says why in words beside it.
 *
 * Each control is pressed on a FRESH render, so what one press does cannot hide what the next does not.
 */
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { vi } from 'vitest'

import { App, queryClient } from '../App'
import { populatedBff, settleQueries } from '../populatedBff'
import { controlName, controlsOf, notPressed, pressState } from './pocketCheck'

export interface PressReport {
  /** how many controls were pressed */
  pressed: number
  /** one line per control that did nothing, or that is disabled without saying why */
  dead: string[]
}

/** The loop, for any `mount` that puts a fresh screen in the document. `requests` counts what was sent. */
export async function pressAll(mount: () => Promise<void>, requests: () => number): Promise<PressReport> {
  await mount()
  const names = controlsOf(document.body).map(controlName)
  cleanup()
  const report: PressReport = { pressed: 0, dead: [] }
  for (let i = 0; i < names.length; i++) {
    await mount()
    const el = controlsOf(document.body)[i]
    const why = el && controlName(el) === names[i] ? notPressed(el) : 'not there on a fresh render'
    if (why) {
      if (why === 'DISABLED WITHOUT SAYING WHY' || why === 'not there on a fresh render') report.dead.push(`${names[i]}: ${why.toLowerCase()}`)
      cleanup()
      continue
    }
    const before = pressState(document)
    const sent = requests()
    // A link the app does not take over is the browser's to follow, to a new address. jsdom cannot follow it, so the
    // click is read last, at the window, and stopped there.
    let followed = false
    const follow = (e: Event) => {
      const a = (e.target as Element).closest('a[href]') as HTMLAnchorElement | null
      if (e.defaultPrevented || !a || a.href === window.location.href) return
      followed = true
      e.preventDefault()
    }
    window.addEventListener('click', follow)
    fireEvent.click(el)
    window.removeEventListener('click', follow)
    report.pressed++
    if (followed) {
      cleanup()
      continue
    }
    try {
      await waitFor(
        () => {
          if (pressState(document) === before && requests() === sent) throw new Error('nothing happened')
        },
        { timeout: 1000 },
      )
    } catch {
      report.dead.push(`${names[i]}: does nothing`)
    }
    cleanup()
  }
  return report
}

/** pressEverything at `route`, answered by populatedBff (with `bodies` replacing any URL's answer). */
export async function pressEverything(route: string, bodies: Record<string, unknown> = {}): Promise<PressReport> {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  const { asked } = populatedBff((impl) => vi.spyOn(globalThis, 'fetch').mockImplementation(impl), bodies)
  return pressAll(
    async () => {
      queryClient.clear()
      window.history.pushState({}, '', route)
      render(createElement(App))
      await settleQueries(queryClient, waitFor)
    },
    () => asked.length,
  )
}
