import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, CONSOLE_ROUTES, queryClient } from './App'
import { populatedBff } from './populatedBff'
import { CLAUDE_CONNECTOR_PATH, DOCUMENTATION_PATH } from './areas/documentation/content'

// B44.4: what every public page says, read from the rendered page a signed-out visitor gets. Positioning v2
// (23 Oct 2026) names words that never appear on a public page; this fails on any of them, on an old
// headline back in the title or an h1, on a missing line, and on any address but hello@. B46.1 (Nick, 24 Oct
// 2026): the site is in plain words, so the old status line and every disclaimer phrase now fail it too.

const PUBLIC_ROUTES = ['/marketing', '/pricing', '/signup', '/signin', DOCUMENTATION_PATH, CLAUDE_CONNECTOR_PATH, '/privacy', '/terms']
// The pages that name the product carry the line; /signin is a door with nothing to pitch.
const NAMES_THE_PRODUCT = new Set(['/marketing', '/pricing', '/signup', DOCUMENTATION_PATH, '/privacy', '/terms'])

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
]
const OLD_LINE = /^\s*(talyvor\s*—\s*)?money and markets for ai agents\.?\s*$/i

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
// way populatedBffCoverage proves it is, says none of the disclaimer phrases; "bank" alone is allowed.
const SIGNED_IN_FORBIDDEN: [string, RegExp][] = [
  ['banking', /banking/i],
  ['test money', /test money/i],
  ['test credits', /test credits/i],
  ['closed trial', /closed trial/i],
  ['licensed partner', /licensed partners?/i],
  ['illustration', /illustration/i],
  ['Coming soon', /coming soon/i],
  ['Nicolai Gaborac', /nicolai gaborac/i],
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
      vi.restoreAllMocks()
      cleanup()
      queryClient.clear()
    }
    expect(said).toEqual([])
  }, 20_000)
})
