import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, CONSOLE_ROUTES, queryClient } from './App'
import { populatedBff } from './populatedBff'
import { CLAUDE_CONNECTOR_PATH, DOCUMENTATION_PATH } from './areas/documentation/content'

// B44.4: what every public page says, read from the rendered page a signed-out visitor gets. Positioning v2
// (23 Oct 2026) names words that never appear on a public page; this fails on any of them, on an old
// headline back in the title or an h1, on a missing line, and on any address but hello@. B46.1 (Nick, 24 Oct
// 2026): the site is in plain words, so the old status line and every disclaimer phrase now fail it too.
// B56.9 (Nick, 1 Nov 2026: "yes to labels") reverses B46.1 for StatusLabel alone: Live, Sandbox and Building may
// be drawn by it and by nothing else, and every disclaimer phrase below still fails.

const PUBLIC_ROUTES = ['/marketing', '/pricing', '/your-money', '/signup', '/signin', DOCUMENTATION_PATH, CLAUDE_CONNECTOR_PATH, '/privacy', '/terms']
// The pages that name the product carry the line; /signin is a door with nothing to pitch.
const NAMES_THE_PRODUCT = new Set(['/marketing', '/pricing', '/your-money', '/signup', DOCUMENTATION_PATH, '/privacy', '/terms'])

const FORBIDDEN: [string, RegExp][] = [
  ['MIXT', /\bmixt\b/i],
  ['mixtet', /mixtet/i],
  ['Moldovagaz', /moldovagaz/i],
  ['banking', /banking/i],
  ['agent bank', /agent bank/i],
  ['closed trial', /closed trial/i],
  ['test money', /test money/i],
  ['US first', /\bUS first\b/i],
  ['then the UK and the EU', /then the UK and the EU/i],
  ['licensed partner', /licensed partners?/i],
  ['illustration', /illustration/i],
  ['Coming soon', /coming soon/i],
  ['Nicolai Gaborac', /nicolai gaborac/i],
  // B56.4 (Nick, 1 Nov 2026): 85% from the first sale, so no first-million tier.
  ['first $1M', /first \$1 ?m(illion)?\b/i],
  ['100% of', /100% of/i],
]
const OLD_LINE = /^\s*(talyvor\s*—\s*)?money and markets for ai agents\.?\s*$/i

/** B56.9 — each Live, Sandbox or Building drawn as a chip (a pill) that StatusLabel did not draw. A word in a table
 *  cell or a select's option is not a label. */
function labelsOutsideStatusLabel(container: HTMLElement): string[] {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  const stray: string[] = []
  while (walker.nextNode()) {
    const node = walker.currentNode
    const word = node.textContent!.trim()
    const el = node.parentElement
    if (/^(live|sandbox|building)$/i.test(word) && el?.closest('.rounded-pill, .rounded-full') && !el.closest('[data-status-label]'))
      stray.push(word)
  }
  return stray
}

function signedOut() {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    const json = (b: unknown) =>
      new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } })
    if (url.startsWith('/auth/me')) return json({ mode: 'oidc', authenticated: false, user: null, signup_open: false })
    if (url.startsWith('/api/pricing'))
      return json({ usd_per_lxc: 0.1, min_usd_cents: 1000, max_usd_cents: 1_000_000, preset_usd_cents: [1000] })
    return new Response('null', { status: 404 })
  })
}

afterEach(() => {
  vi.restoreAllMocks()
  queryClient.clear()
  window.history.pushState({}, '', '/')
})

describe('every public page speaks positioning v2', () => {
  it.each(PUBLIC_ROUTES)('%s', async (path) => {
    signedOut()
    window.history.pushState({}, '', path)
    const { container } = render(<App />)
    const h1 = await screen.findByRole('heading', { level: 1 })
    const text = container.textContent ?? ''

    for (const [word, re] of FORBIDDEN) expect(text, `${path} says "${word}"`).not.toMatch(re)
    expect(labelsOutsideStatusLabel(container), `${path} draws a label outside StatusLabel`).toEqual([])
    expect(document.title, `${path}'s title is the old line`).not.toMatch(OLD_LINE)
    expect(h1.textContent, `${path}'s h1 is the old line`).not.toMatch(OLD_LINE)

    if (NAMES_THE_PRODUCT.has(path))
      expect(text, `${path} does not carry the line`).toMatch(/the financial ecosystem for the AI agent economy/i)

    // Per text node: textContent joins neighbours, so an address runs into the next word.
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
    const shown: string[] = []
    while (walker.nextNode()) shown.push(...(walker.currentNode.textContent!.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g) ?? []))
    shown.push(
      ...[...container.querySelectorAll('a[href^="mailto:"]')].map((a) => a.getAttribute('href')!.slice(7)),
    )
    for (const address of shown) expect(address, `${path} shows ${address}`).toBe('hello@talyvor.com')
  })
})

// B46.2 (Nick, 24 Oct 2026): the app drops the disclosure layer too. Every signed-in address, populated the
// way populatedBffCoverage proves it is, says none of the disclaimer phrases; "bank" alone is allowed. B56.9
// reverses it for StatusLabel alone, as on the public pages.
const SIGNED_IN_FORBIDDEN: [string, RegExp][] = [
  ['banking', /banking/i],
  ['test money', /test money/i],
  ['test credits', /test credits/i],
  ['closed trial', /closed trial/i],
  ['licensed partner', /licensed partners?/i],
  ['illustration', /illustration/i],
  ['Coming soon', /coming soon/i],
  ['Nicolai Gaborac', /nicolai gaborac/i],
  // B46.14: B46.2's sign-up sentence, "…aren’t real money yet", is not said anywhere either.
  ['real money yet', /real money yet|first money partner/i],
  ['first $1M', /first \$1 ?m(illion)?\b/i],
  // B56.4: budgets alert at "100% of" a limit, so signed in the phrase is refused only about a seller or a sale.
  ['100% of', /100% of[^.]*\b(sellers?|sales?|first)\b/i],
]

describe('no signed-in address carries a disclaimer label', () => {
  it('every console address', async () => {
    const said: string[] = []
    for (const r of CONSOLE_ROUTES) {
      const address = r.path.replace(/\/\*$/, '') || '/'
      populatedBff((impl) => {
        vi.spyOn(globalThis, 'fetch').mockImplementation(impl as never)
      })
      window.history.pushState({}, '', address)
      const { container } = render(<App />)
      await screen.findByRole('navigation', { name: /sections/i })
      await new Promise((done) => setTimeout(done, 80))
      const text = container.textContent ?? ''
      for (const [word, re] of SIGNED_IN_FORBIDDEN) if (re.test(text)) said.push(`${address} says "${word}"`)
      for (const word of labelsOutsideStatusLabel(container)) said.push(`${address} draws ${word} outside StatusLabel`)
      vi.restoreAllMocks()
      cleanup()
      queryClient.clear()
    }
    expect(said).toEqual([])
  }, 20_000)
})
