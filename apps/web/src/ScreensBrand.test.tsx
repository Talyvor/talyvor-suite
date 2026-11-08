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

    expect(within(main).queryAllByTestId('region-label').length, `${address} has no eyebrow`).toBeGreaterThan(0)
  })

  it('Settings names each section with an eyebrow and shows the stored choice on the accent tint', async () => {
    // This workspace does not share its answers and converts its documents.
    vi.restoreAllMocks()
    queryClient.clear()
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    populatedBff(
      (impl) => {
        vi.spyOn(globalThis, 'fetch').mockImplementation(impl as never)
      },
      {
        '/auth/me': { mode: 'disabled', authenticated: false, user: null, cache_poolable: false },
        '/api/distill': { converted: 12, vision_ocr: 3, days: 30, distill_policy: 'always' },
      },
    )
    const main = await at('/settings')
    const eyebrows = within(main).getAllByTestId('region-label').map((l) => l.textContent)
    expect(eyebrows).toEqual(['00Sharing', '01Documents', '02Provider keys'])

    const keep = await within(main).findByRole('button', { name: 'Do not share my answers' })
    expect(keep).toHaveAttribute('aria-pressed', 'true')
    expect(keep.className).toContain('aria-pressed:bg-accent-tint')
    expect(within(main).getByRole('button', { name: 'Share my answers' })).toHaveAttribute('aria-pressed', 'false')
    expect(within(main).getByRole('button', { name: 'Convert my documents' })).toHaveAttribute('aria-pressed', 'true')
  })
})
