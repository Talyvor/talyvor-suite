import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from './App'
import { DOCUMENTATION_PATH } from './areas/documentation/content'
import { STATUS_LINE } from './positioning'

// B44.4: what every public page says, read from the rendered page a signed-out visitor gets. Positioning v2
// (23 Oct 2026) names words that never appear on a public page; this fails on any of them, on an old
// headline back in the title or an h1, on a missing line or status line, and on any address but hello@.

const PUBLIC_ROUTES = ['/marketing', '/pricing', '/signup', '/signin', DOCUMENTATION_PATH, '/privacy', '/terms']
// The pages that name the product carry the line; /signin is a door with nothing to pitch.
const NAMES_THE_PRODUCT = new Set(['/marketing', '/pricing', '/signup', DOCUMENTATION_PATH, '/privacy', '/terms'])

const FORBIDDEN: [string, RegExp][] = [
  ['MIXT', /\bmixt\b/i],
  ['mixtet', /mixtet/i],
  ['Moldovagaz', /moldovagaz/i],
  ['banking', /banking/i],
  ['agent bank', /agent bank/i],
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

    expect(text, `${path} has no status line`).toContain(STATUS_LINE)
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
