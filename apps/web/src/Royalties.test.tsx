import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { App, queryClient } from './App'
import { areaSource } from './lib/workspaceAreas'

// B28.10 — Earnings became Royalties, under Statements. Driven through the real <App /> so the
// sidebar, the route table and the old address are the ones a person meets.

function mockBff() {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    const body =
      url === '/auth/me'
        ? { mode: 'oidc', authenticated: true, user: { sub: 's', email: 'a@example.com' }, workspace_id: 'uabcdefghijklmnopqrstuvwxy', cache_poolable: true }
        : {}
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
  })
}

describe('Royalties sits under Statements', () => {
  beforeEach(() => {
    queryClient.clear()
    mockBff()
  })
  afterEach(() => {
    vi.restoreAllMocks()
    window.history.pushState({}, '', '/')
  })

  it('B57.8 — Royalties left the sidebar for Pocket’s rows; the Activity row stays marked on it (B61.3), and no Earnings', async () => {
    window.history.pushState({}, '', '/statements/royalties')
    render(<App />)
    const nav = await screen.findByRole('navigation', { name: /sections/i })
    const names = within(nav).getAllByRole('link').map((a) => a.textContent)
    expect(names).not.toContain('Royalties')
    expect(names).not.toContain('Earnings')
    expect(within(nav).getByRole('link', { name: 'Activity' })).toHaveAttribute('aria-current', 'page')
  })

  it('the old /earnings address lands on Royalties', async () => {
    window.history.pushState({}, '', '/earnings')
    render(<App />)
    expect(await screen.findByRole('heading', { level: 1, name: 'Royalties' })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/statements/royalties')
  })

  // B17.82 — the nightly opens /earnings cold and reads the page at the load event. One synchronous
  // render, outside act so no redirect or transition is flushed, is that first frame: a <Navigate>
  // drew an empty main there.
  it('the old /earnings address draws Royalties on its first render', () => {
    window.history.pushState({}, '', '/earnings')
    localStorage.setItem('talyvor.had-session', '1')
    const actEnv = (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false
    const host = document.body.appendChild(document.createElement('div'))
    const root = createRoot(host)
    try {
      flushSync(() => root.render(<App />))
      expect(host.querySelector('h1')?.textContent).toBe('Royalties')
      expect(host.querySelector('main h2')?.textContent).toBe('What your shared answers earned')
    } finally {
      flushSync(() => root.unmount())
      host.remove()
      localStorage.removeItem('talyvor.had-session')
      ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = actEnv
    }
  })

  // B17.489 — Royalties is behind its area, which draws nothing until the workspace's areas are read. The redirect
  // waits for that read, so a cold /earnings whose areas are slow (p95 4 s on the nightly) keeps Royalties drawn
  // rather than redirecting into an empty main before the load event.
  it('the old /earnings address keeps Royalties drawn while the areas are still being read', async () => {
    areaSource.initial = undefined
    let answer: ((areas: string[]) => void) | undefined
    areaSource.read = () => new Promise<string[]>((resolve) => (answer = resolve))
    const areasRead = () => queryClient.getQueryState(['workspace-areas'])?.status
    const heading = { level: 2, name: 'What your shared answers earned' } as const
    window.history.pushState({}, '', '/earnings')
    const { container } = render(<App />)
    const before = await screen.findByRole('heading', heading)
    // B17.547 — the areas are still being read: the read has started and has not answered.
    await waitFor(() => expect(answer).toBeDefined())
    expect(areasRead()).toBe('pending')
    await new Promise((r) => setTimeout(r, 50))
    expect(areasRead()).toBe('pending')
    expect(window.location.pathname).toBe('/earnings')
    expect(container.querySelector('main h2')?.textContent).toBe('What your shared answers earned')
    answer!(['gateway'])
    await waitFor(() => expect(areasRead()).toBe('success'))
    // The address moves before React draws its route, so the heading found then could be /earnings' own, about to
    // leave the page: wait for Royalties' own address to have drawn its heading, a new one.
    await waitFor(() => {
      expect(window.location.pathname).toBe('/statements/royalties')
      expect(screen.getByRole('heading', heading)).not.toBe(before)
    })
    expect(before).not.toBeInTheDocument()
    expect(screen.getByRole('heading', heading)).toBeInTheDocument()
  })
})
