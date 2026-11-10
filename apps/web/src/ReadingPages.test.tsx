import { render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from './App'
import { COMPANY_NAME } from './company'

// B29.13 — /documentation, /privacy, /terms and a published board are reading pages in the brand:
// the drawn logo in a header, an eyebrow over the title and the teal rule under it, the prose in the
// 32rem column that holds about 65 characters a line (measured in Chrome; jsdom cannot lay text
// out, so the column's class is what is pinned here), and the footer with the mark and company line.

const TOKEN = 'tok_abcdefghijklmnop'

function strangerAt(path: string) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'oidc', authenticated: false, user: null })
    if (url === `/api/public/boards/${TOKEN}`) {
      return json({ workspace: 'Acme', project: 'Website', truncated: false, issues: [] })
    }
    return new Response('null', { status: 401 })
  })
  window.history.pushState({}, '', path)
  return render(<App />)
}

beforeEach(() => queryClient.clear())
afterEach(() => {
  vi.restoreAllMocks()
  window.history.pushState({}, '', '/')
})

/** The site's header and footer, as every public page has them (B57.59). */
function chrome() {
  // The site's header comes first; testing-library also counts the legal pages' title <header> in
  // main as a banner, which a browser does not.
  const header = screen.getAllByRole('banner')[0]
  expect(header.querySelector('[data-brand="lockup"] img[src="/brand/logo/talyvor-logo-small-on-light.svg"]')).not.toBeNull()
  expect(within(header).getByRole('link', { name: 'Open the app' })).toHaveAttribute('href', '/')

  const footer = screen.getByRole('contentinfo')
  expect(footer.querySelector('[data-brand="lockup"] img[src="/brand/logo/talyvor-logo-small-on-light.svg"]')).not.toBeNull() // B57.59: Pocket's footer opens with the logo
  expect(within(footer).getByText(new RegExp(COMPANY_NAME))).toBeInTheDocument()
  expect(within(footer).getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy')
}

describe.each([[`/board/${TOKEN}`, 'Acme · Website', 'Read-only board']])('%s', (path, title, eyebrow) => {
  it('reads in the brand: logo header, eyebrow, teal rule, a 65-character column and the footer', async () => {
    strangerAt(path)
    const h1 = await screen.findByRole('heading', { level: 1, name: title })

    const main = screen.getByRole('main')
    const above = within(main).getAllByText(eyebrow).find((el) => el.compareDocumentPosition(h1) & Node.DOCUMENT_POSITION_FOLLOWING)
    expect(above?.className).toContain('text-eyebrow')
    expect(h1.parentElement?.querySelector('.bg-accent.w-8.h-0\\.5')).not.toBeNull()
    expect(main.querySelector('.max-w-lg.text-reading')).not.toBeNull()
    chrome()
  })
})

// B57.63 — /documentation, /privacy and /terms are drawn in Pocket (design/pocket s-docs, s-privacy, s-terms): the
// title in the display face, Pocket's eyebrow over it where the reference has one, no teal rule, and the legal prose
// in the narrow column.
describe.each([
  ['/documentation', 'Documentation', null],
  ['/privacy', 'Privacy', 'Talyvor'],
  ['/terms', 'Terms', 'Talyvor'],
])('%s', (path, title, eyebrow) => {
  it('reads in Pocket: logo header, Pocket’s eyebrow and title, the narrow column and the footer', async () => {
    strangerAt(path)
    const h1 = await screen.findByRole('heading', { level: 1, name: title })
    expect(h1.className).toContain('font-display')
    expect(h1.closest('[data-design]')?.getAttribute('data-design')).toBe('pocket')

    const main = screen.getByRole('main')
    if (eyebrow) {
      const above = within(main).getAllByText(eyebrow).find((el) => el.compareDocumentPosition(h1) & Node.DOCUMENT_POSITION_FOLLOWING)
      expect(above?.className).toContain('text-pocket-eyebrow')
      expect(main.querySelector('.max-w-2xl.text-reading')).not.toBeNull()
    }
    expect(main.querySelector('.bg-accent.w-8')).toBeNull()
    chrome()
  })
})
