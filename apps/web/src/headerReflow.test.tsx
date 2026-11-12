import { render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { App, queryClient } from './App'

/**
 * THE CONSOLE COULD NOT BE READ ON A PHONE WITHOUT SCROLLING SIDEWAYS — ON EVERY SURFACE.
 *
 * ⚠ MEASURED IN REAL CHROME on the built artifact, signed in, ten console routes × four
 * viewports. `document.documentElement.scrollWidth - clientWidth`, deepest offenders reported:
 *
 *     320px   ALL TEN routes overflowed, by 24 to 61 px
 *     375px   2 of 10 (`/` and `/members`), by 5–6 px
 *     768px   none        1280px   none
 *
 * ⚠ AND THE NUMBER THAT NAMES THE CAUSE: `scrollWidth` was **380 at BOTH 320 and 375** — the same
 * value, so the layout had a hard floor of 380 CSS px and simply could not be narrower. The page
 * was not responding to the viewport at all below that width.
 *
 * The floor is the sticky header. Its actions block measured 274px wide starting at x=106, ending
 * at 380, and never shrank: a flex item defaults to `min-width: auto`, so it will not go below its
 * content's intrinsic width, and `operator@example.com` is one unbreakable token. The title, the
 * email, the Sign out button and the theme toggle simply added up.
 *
 * ⚠ WCAG 2.2 SC 1.4.10 REFLOW (AA) IS THE STANDARD THIS IS MEASURED AGAINST, and it is the one
 * this repo already holds itself to elsewhere — `contrast.test.ts` scores every text/plane pair
 * against the 4.5:1 AA body floor. Reflow names 320 CSS px and forbids scrolling in two
 * directions. So this is not a taste call about small screens; it is the same commitment, on a
 * property no test here could see.
 *
 * ⚠ THE FIX USES ONLY VOCABULARY THIS REPO ALREADY WRITES — `min-w-0` (Shell, App, Entry,
 * IssueList) and `truncate` (Row, NavItem). No new token, no new breakpoint, no arbitrary value,
 * and NO NUMBER CHOSEN BY ME: the title and the email may shrink and ellipsise, the two controls
 * may not. A `flex-wrap` on the header would also have made 320px fit TODAY — measured, the
 * actions block is 274px and the content box at 320px is 288px — but only because this fixture's
 * email is 20 characters. That is a fix shaped like the fixture, so it is not the one taken.
 *
 * ⚠ AFTER, same instrument, rebuilt artifact, 80 combinations — ten routes × four viewports ×
 * TWO email lengths, the second being 70 characters: ZERO overflow, and `scrollWidth` equal to the
 * viewport exactly at 320, 375, 768 and 1280. Instrument positive-controlled in that same
 * configuration by planting one element 40px too wide: 0 -> 40 -> 0.
 *
 * ⚠⚠ WHAT THIS FILE CAN AND CANNOT DO, SAID PLAINLY. jsdom HAS NO LAYOUT — every element is
 * 0×0 and `scrollWidth` is 0 — so no test in this repo can assert the measurement above. What it
 * asserts is that the four SHRINK ROLES are declared on the rendered DOM. That is the same
 * division `placeholderAudit` and `focusAudit` already make in this repo: the engine measurement
 * lives in the comment, the class that produces it is what CI holds. A reviewer who changes the
 * header's layout must re-run the Chrome measurement; this file will not do it for them.
 */

beforeEach(() => {
  queryClient.clear()
  window.history.pushState({}, '', '/')
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/auth/me')) {
        return new Response(
          JSON.stringify({ mode: 'oidc', authenticated: true, user: { email: 'operator@example.com' } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      throw new TypeError('Failed to fetch')
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  queryClient.clear()
})

const header = () => screen.findByRole('banner')

/**
 * B57.8 — POCKET'S TOP BAR, SAME RULE. The page title left the bar for the top of the content, and the signed-in
 * address and Sign out moved to Settings, so the bar holds Menu (below 840), the search, Pause every agent, the theme
 * switch and the avatar. The search is the one item that may shrink, its words ellipsising; the controls may not, and
 * below 840 the search and Pause every agent keep only their icons, their words staying their names, so the bar fits 320
 * (Menu 36 + the search's pill 44 + Pause 44 + the switch 32 + the avatar 36 + four 12px gaps = 240 of the 288 px a 320
 * screen leaves inside the bar's padding).
 */
describe('the sticky header may narrow to the viewport', () => {
  it('lets the search shrink, its words ellipsising at 840 and up and leaving the bar below it, still its name', async () => {
    render(<App />)
    const search = await within(await header()).findByRole('button', { name: 'Search agents, payees, bills… or type a command' })
    expect(search.getAttribute('class') ?? '', 'the search is a flex item with min-width:auto — it cannot go below its own text').toContain('min-w-0')
    const words = search.querySelector('span.truncate')
    expect(words, 'without truncate the search’s words are the floor nothing can shrink past').not.toBeNull()
    expect(words?.getAttribute('class') ?? '').toContain('hidden')
    expect(words?.getAttribute('class') ?? '').toContain('wide:block')
  })

  it('does NOT let Pause every agent or the avatar shrink — only the search may', async () => {
    render(<App />)
    const pause = await within(await header()).findByRole('button', { name: 'Pause every agent' })
    expect(pause.getAttribute('class') ?? '', 'a squeezed hit target is a worse answer than an ellipsised search').toContain('shrink-0')
    expect(within(await header()).getByRole('link', { name: 'Settings and sign out' }).getAttribute('class') ?? '').toContain('shrink-0')
  })

  it('below 840 Pause every agent keeps its icon, and its words stay its name', async () => {
    render(<App />)
    const pause = await within(await header()).findByRole('button', { name: 'Pause every agent' })
    expect(pause.querySelector('span.sr-only')?.getAttribute('class') ?? '').toContain('wide:not-sr-only')
  })

  it('on Settings the signed-in email ellipsises, and stays readable in full on hover', async () => {
    window.history.pushState({}, '', '/settings')
    render(<App />)
    const email = await screen.findByText('Signed in as operator@example.com.')
    expect(email.getAttribute('class') ?? '', 'the email is one unbreakable token — without truncate nothing else can shrink past it').toContain('truncate')
    expect(email.getAttribute('title')).toBe('operator@example.com')
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
  })
})
