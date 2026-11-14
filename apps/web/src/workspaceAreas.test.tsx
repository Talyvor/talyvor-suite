import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from './App'
import { areaSource, readWorkspaceAreas } from './lib/workspaceAreas'

// B59.2 — a hidden area is not there. A workspace has an area only once the operator switches it on in Lens; until
// then the console draws no nav row, Home card, command palette entry or Settings entry for it, and its address goes
// to Home. These read the areas from the BFF, as the console does, rather than the open-everything test default.

/**
 * What each hidden area draws in the console when it is on: its addresses, its Home card and a page title, and whether
 * it has a sidebar row (B57.8 — Docs is reached from Track and Settings, and the gateway's features from Developers).
 */
const AREAS = [
  { area: 'chat', paths: ['/chat'], card: null, page: 'Prompts', row: true },
  { area: 'rooms', paths: ['/rooms'], card: null, page: 'Rooms', row: true },
  { area: 'marketplace', paths: ['/marketplace'], card: null, page: 'Marketplace', row: true },
  { area: 'track', paths: ['/track'], card: null, page: 'Track', row: true },
  { area: 'docs', paths: ['/docs', '/settings/webhooks', '/settings/email-branding'], card: null, page: 'Webhooks', row: false },
  { area: 'scan', paths: ['/scan/reports', '/scan/agents', '/scan/track-record'], card: null, page: 'Scan reports', row: true },
  { area: 'gateway', paths: ['/features'], card: null, page: 'Gateway features', row: false },
] as const

const inArea = (href: string, paths: readonly string[]) =>
  paths.some((p) => href === p || href.startsWith(`${p}/`) || href.startsWith(`${p}?`))

/** A BFF whose workspace has exactly `on`; every other read answers 404, as a fresh workspace's would fail soft. */
function mockBff(on: string[]) {
  areaSource.read = readWorkspaceAreas
  areaSource.initial = undefined
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    const json = (v: unknown) =>
      new Response(JSON.stringify(v), { status: 200, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/workspace/areas') return json({ areas: on })
    return new Response('null', { status: 404 })
  })
}

async function openApp(path: string) {
  window.history.pushState({}, '', path)
  render(<App />)
  const nav = await screen.findByRole('navigation', { name: /sections/i })
  // Wait for the areas read, when the console makes one, to answer before reading what it drew.
  await waitFor(() => expect(queryClient.getQueryState(['workspace-areas'])?.status).not.toBe('pending'))
  return nav
}

const navHrefs = (nav: HTMLElement) => within(nav).queryAllByRole('link').map((a) => a.getAttribute('href') ?? '')

function paletteOptions(): string[] {
  fireEvent.click(screen.getByRole('button', { name: 'Search agents, payees, bills… or type a command' }))
  const options = within(screen.getByRole('listbox', { name: 'Commands' }))
    .queryAllByRole('option')
    .map((o) => o.textContent ?? '')
  fireEvent.keyDown(document, { key: 'Escape' })
  return options
}

afterEach(() => {
  cleanup()
  queryClient.clear()
  vi.restoreAllMocks()
  window.history.pushState({}, '', '/')
  window.localStorage.clear()
})

describe('a hidden area is not there (B59.2)', () => {
  for (const a of AREAS) {
    it(`${a.area}: no nav row, Home card or palette page by default, and its address goes to Home`, async () => {
      mockBff([])
      const nav = await openApp('/')
      expect(navHrefs(nav).filter((h) => inArea(h, a.paths))).toEqual([])
      if (a.card !== null) expect(screen.queryByTestId(a.card)).toBeNull()
      expect(paletteOptions()).not.toContain(a.page)
      cleanup()
      queryClient.clear()

      await openApp(a.paths[0])
      await waitFor(() => expect(window.location.pathname).toBe('/'))
    })

    it(`${a.area}: all of it is there once Lens lists the area`, async () => {
      mockBff([a.area])
      const nav = await openApp('/')
      if (a.row) expect(navHrefs(nav).filter((h) => inArea(h, a.paths)).length).toBeGreaterThan(0)
      if (a.card !== null) expect(screen.getByTestId(a.card)).toBeTruthy()
      expect(paletteOptions()).toContain(a.page)
      cleanup()
      queryClient.clear()

      await openApp(a.paths[0])
      expect(window.location.pathname).toBe(a.paths[0])
    })
  }

  it('chat: no Taly button and no chat actions in the palette by default; both are there with Chat', async () => {
    mockBff([])
    await openApp('/agents')
    expect(screen.queryByRole('button', { name: 'Ask Taly' })).toBeNull()
    expect(paletteOptions().some((o) => o.includes('New chat'))).toBe(false)
    cleanup()
    queryClient.clear()

    mockBff(['chat'])
    await openApp('/agents')
    expect(await screen.findByRole('button', { name: 'Ask Taly' })).toBeTruthy()
    expect(paletteOptions().some((o) => o.includes('New chat'))).toBe(true)
  })

  it('gateway: Settings carries no shared-answers entry by default, and document conversion is never on Settings (B57.42)', async () => {
    mockBff([])
    await openApp('/settings')
    expect(await screen.findByText('Your provider keys')).toBeTruthy()
    expect(screen.queryByText('Shared answers')).toBeNull()
    expect(screen.queryByText('Documents you attach')).toBeNull()
    cleanup()
    queryClient.clear()

    mockBff(['gateway'])
    await openApp('/settings')
    expect(await screen.findByText('Shared answers')).toBeTruthy()
    expect(screen.queryByText('Documents you attach')).toBeNull()
  })
})
