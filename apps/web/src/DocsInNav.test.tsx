import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { App } from './App'

// Docs IS IN THE NAV, and this INVERTS the test that used to pin it out.
//
// ⚠ THE TEST WAS NOT DELETED TO MAKE A BUILD PASS. It pinned a real state — Docs served one PINNED
// workspace shared by every signed-in person, so listing it under "Products" told a trial user it
// was theirs and the gap only appeared after they had put something in it. That removal comment
// named its own reopening condition: Docs gets Track's per-identity bootstrap. The condition has
// been MET (apps/bff docsWorkspaceFor; talyvor-track bf60842 + talyvor-docs c970329 broke the
// cold-start deadlock), so the pin flips to the new state rather than disappearing — the history of
// why it was ever out stays readable right here.

function mockBff() {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    if (url === '/auth/me') {
      return new Response(JSON.stringify({ mode: 'disabled', authenticated: false, user: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return new Response('null', { status: 404 })
  })
}

describe('Docs is offered in the Products nav', () => {
  beforeEach(() => {
    mockBff()
    window.history.pushState({}, '', '/')
  })
  afterEach(() => {
    vi.restoreAllMocks()
    window.localStorage.clear()
  })

  it('B57.8 — the sidebar’s one row for both is Track and Docs, and it opens Track', async () => {
    render(<App />)
    const nav = await screen.findByRole('navigation', { name: /sections/i })
    fireEvent.click(within(nav).getByRole('link', { name: 'Track and Docs' }))
    expect(window.location.pathname).toBe('/track')
  })

  it('Track links Docs, so Docs is two clicks from anywhere', async () => {
    window.history.pushState({}, '', '/track')
    render(<App />)
    const track = await screen.findByRole('navigation', { name: 'Track' })
    fireEvent.click(within(track).getByRole('link', { name: 'Docs' }))
    expect(window.location.pathname).toBe('/docs')
    // The row stays marked on Docs, which it holds too.
    const nav = screen.getByRole('navigation', { name: /sections/i })
    expect(within(nav).getByRole('link', { name: 'Track and Docs' })).toHaveAttribute('aria-current', 'page')
  })
})
