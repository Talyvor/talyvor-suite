import { render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from './App'
import { cardOnItsPlane, primaryActions, statusWithoutWords, tangerineOffenders } from './pocketRules'
import { populatedBff, settleQueries } from './populatedBff'

// B29.12 — Features, Track, Docs, Developers, Billing, Settings and Operator in the brand, read off the populated
// fixture: at most one teal action per view, every card on the raised plane, and an eyebrow over each section.
// B57.3 — and Pocket's rules: one primary (ink) action, tangerine only for the brand and "your move", status
// colours always with words; a card is Pocket's once its route leaves pocketPending.ts.

async function at(address: string): Promise<HTMLElement> {
  window.history.pushState({}, '', address)
  render(<App />)
  await screen.findByRole('navigation', { name: /sections/i })
  await settleQueries(queryClient, waitFor)
  return document.querySelector('main') as HTMLElement
}

/** The primary (ink) actions, by Pocket's name and today's. */
const primaries = primaryActions

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  populatedBff((impl) => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(impl as never)
  })
})
afterEach(() => {
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

describe('the remaining signed-in screens in the brand', () => {
  const SCREENS = [
    '/features',
    '/track',
    '/track/board',
    '/track/cycles',
    '/track/projects',
    '/docs',
    '/setup',
    '/keys',
    '/billing',
    '/plans',
    '/overview',
    '/settings',
    '/members',
    '/operator',
  ]

  it.each(SCREENS)('%s: cards on raised, eyebrows, at most one teal action', async (address) => {
    const main = await at(address)
    expect(primaries(main).length, `the teal fill on ${address} is its one primary action`).toBeLessThanOrEqual(1)

    // A grid of tiles is one card whose hairlines are its gaps: the tiles carry the plane.
    const cards = Array.from(main.querySelectorAll('.rounded-card:not(.bg-rule), .rounded-card.bg-rule > *'))
    expect(cards.length, `no card rendered on ${address}`).toBeGreaterThan(0)
    for (const c of cards) expect(cardOnItsPlane(c), `a card on ${address} is not on its plane: ${c.className} ${c.textContent?.slice(0, 80)}`).toBe(true)
    expect(tangerineOffenders(main).map((e) => e.outerHTML), `tangerine on ${address} is only the brand and your move`).toEqual([])
    expect(statusWithoutWords(main).map((e) => e.outerHTML), `a status colour on ${address} without words`).toEqual([])

    // B57.55 — a page drawn in Pocket names itself with the kit's Eyebrow (pocket.css .eyebrow), not today's region label.
    // B57.44 — Members is the exception: the reference draws it with the crumb Settings › Members and no eyebrow.
    if (address === '/members') return
    const eyebrows = within(main).queryAllByTestId('region-label').length + main.querySelectorAll('.text-pocket-eyebrow').length
    expect(eyebrows, `${address} has no eyebrow`).toBeGreaterThan(0)
  })

  it('Settings shows the stored sharing choice on its switch, and its account under its eyebrow (B57.42)', async () => {
    // This workspace does not share its answers.
    vi.restoreAllMocks()
    queryClient.clear()
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    populatedBff(
      (impl) => {
        vi.spyOn(globalThis, 'fetch').mockImplementation(impl as never)
      },
      {
        '/auth/me': { mode: 'disabled', authenticated: false, user: null, cache_poolable: false },
      },
    )
    const main = await at('/settings')
    // B59.10 — the populated workspace is Business and Hybrid: its account, and its team.
    expect(Array.from(main.querySelectorAll('.text-pocket-eyebrow')).map((e) => e.textContent)).toEqual(['Account'])
    expect(within(main).getByTestId('settings-team')).toBeInTheDocument()
    const share = await within(main).findByRole('switch', { name: 'Share my answers' })
    expect(share).toHaveAttribute('aria-checked', 'false')
    // B57.42 — Documents you attach moved to Gateway features.
    expect(within(main).queryByText('Documents you attach')).toBeNull()
  })
})
