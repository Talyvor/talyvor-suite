import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, render, screen, within } from '@testing-library/react'
import { matchRoutes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App, CONSOLE_ROUTES, queryClient } from '../../App'
import { Landing } from '../marketing/Landing'
import { pressEverything } from '../../test/pressEverything'
import { CLAUDE_CONNECTOR_PATH, DOCUMENTATION_PATH, LICENCES } from './content'

// B27.31 — /documentation opens signed out, and every link on it reaches a screen the app mounts.
//
// ⚠ MOUNTED, NOT MERELY RENDERED. Track and Marketplace end in a `*` that draws their index, so
// /marketplace/no-such-screen renders Browse and a render-based check would pass it. The routes
// below are read from what the app DECLARES — App.tsx's public <Route>s, CONSOLE_ROUTES, and each
// area's own <Route>s with their catch-alls left out — so a link to a screen that was removed or
// renamed fails here. The Lens routes the page lists are checked against Lens's source by
// scripts/lens-routes.mjs in CI, which this repository cannot do from a unit test.

const SRC = resolve(import.meta.dirname, '../..')
const source = (rel: string) => readFileSync(resolve(SRC, rel), 'utf8')

/** Each console route that hands the rest of the path to an area router, and that router's file. */
const AREA_ROUTERS: Record<string, string> = {
  '/marketplace/*': 'areas/marketplace/Marketplace.tsx',
  '/rooms/*': 'areas/rooms/Rooms.tsx',
  '/track/*': 'areas/track/TrackArea.tsx',
  '/docs/*': 'areas/docs/DocsArea.tsx',
}

function mountedRoutes(): Array<{ path: string }> {
  const routes: string[] = []
  // The public routes sit outside the gate in App(); `/*` is the gate itself, not a screen.
  for (const m of source('App.tsx').matchAll(/<Route path="(\/[^"]*)"/g)) {
    if (m[1] !== '/*') routes.push(m[1])
  }
  routes.push(DOCUMENTATION_PATH, CLAUDE_CONNECTOR_PATH)
  for (const { path } of CONSOLE_ROUTES) {
    if (!path.endsWith('/*')) {
      routes.push(path)
      continue
    }
    const file = AREA_ROUTERS[path]
    if (!file) throw new Error(`${path} hands off to an area router this test does not know — add it to AREA_ROUTERS`)
    const base = path.slice(0, -2)
    const area = source(file)
    if (/<Route index /.test(area)) routes.push(base)
    for (const m of area.matchAll(/<Route path="([^"*]+)"/g)) routes.push(`${base}/${m[1]}`)
  }
  return routes.map((path) => ({ path }))
}

const MOUNTED = mountedRoutes()
const mounts = (pathname: string) => matchRoutes(MOUNTED, pathname) !== null

function mockSignedOut() {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    if (String(input).startsWith('/auth/me')) {
      return new Response(JSON.stringify({ mode: 'oidc', authenticated: false, user: null, signup_open: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return new Response('null', { status: 404 })
  })
}

beforeEach(() => {
  queryClient.clear()
  window.history.pushState({}, '', '/')
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  window.history.pushState({}, '', '/')
})

describe('/documentation', () => {
  it('opens signed out, outside the sign-in gate', async () => {
    mockSignedOut()
    window.history.pushState({}, '', DOCUMENTATION_PATH)
    render(<App />)
    expect(await screen.findByRole('heading', { level: 1, name: 'Documentation' })).toBeInTheDocument()
    const contents = screen.getByRole('navigation', { name: 'On this page' })
    for (const name of ['Lens API', 'Chat', 'Docs', 'Track', 'Agent Wallets', 'Marketplace', 'Talyvor Code', 'Licences']) {
      expect(within(contents).getByRole('link', { name })).toHaveAttribute('href', expect.stringMatching(/^#/))
    }
  })

  it('is wallet-first: getting started funds an agent, and Agent Wallets leads the guides and the routes (B28.15)', async () => {
    mockSignedOut()
    window.history.pushState({}, '', DOCUMENTATION_PATH)
    const { container } = render(<App />)
    await screen.findByRole('heading', { level: 1, name: 'Documentation' })
    const steps = within(container.querySelector<HTMLElement>('#start')!).getAllByRole('link').map((a) => a.textContent)
    expect(steps).toEqual([
      'Sign up',
      'Agent Wallets: Create agent',
      'Agent Wallets: Fund',
      'Agent Wallets: Issue a key',
      'Setup',
      'Agent Wallets: Statement',
      'Talyvor in Claude',
    ])
    const contents = within(screen.getByRole('navigation', { name: 'On this page' })).getAllByRole('link')
    expect(contents.slice(0, 2).map((a) => a.textContent)).toEqual(['Start here', 'Agent Wallets'])
    expect([...container.querySelectorAll('main > section[id]')].slice(0, 2).map((s) => s.id)).toEqual(['start', 'wallets'])
    const groups = [...container.querySelectorAll('#lens details')]
    expect(groups[0].id).toBe('lens-wallets')
    expect(within(groups[0] as HTMLElement).getByText('/v1/workspaces/{wsID}/agents/{agentID}/statement')).toBeInTheDocument()
  })

  it('links only to screens the app mounts', async () => {
    // The resolver is not vacuous: an invented screen, and one an area's catch-all would draw, fail.
    expect(mounts('/no-such-screen')).toBe(false)
    expect(mounts('/marketplace/no-such-screen')).toBe(false)

    mockSignedOut()
    window.history.pushState({}, '', DOCUMENTATION_PATH)
    const { container } = render(<App />)
    await screen.findByRole('heading', { level: 1, name: 'Documentation' })
    const hrefs = [...container.querySelectorAll('a[href]')].map((a) => a.getAttribute('href') ?? '')
    const internal = hrefs.filter((h) => !/^(https?:\/\/|mailto:)/.test(h))
    expect(internal.length).toBeGreaterThan(30)
    const broken = internal.filter((h) =>
      h.startsWith('#') ? container.querySelector(h) === null : !mounts(h.split('#')[0]),
    )
    expect(broken).toEqual([])
  })

  // B57.63 — the reference's s-docs: a card for each part of Talyvor, each opening its guide on the page, then the
  // Claude connector; the page is held to Pocket's rules.
  it('opens on a card for each part of Talyvor and one for the Claude connector (B57.63)', async () => {
    mockSignedOut()
    window.history.pushState({}, '', DOCUMENTATION_PATH)
    const { container } = render(<App />)
    await screen.findByRole('heading', { level: 1, name: 'Documentation' })
    expect(screen.getByText('How each part of Talyvor works, and every route of its API.')).toBeInTheDocument()
    const parts = within(screen.getByRole('list', { name: 'Parts of Talyvor' })).getAllByRole('link')
    expect(parts.map((a) => [a.querySelector('b')?.textContent, a.getAttribute('href')])).toEqual([
      ['Agent Wallets', '#wallets'],
      ['Chat', '#chat'],
      ['Marketplace', '#marketplace'],
      ['Docs', '#docs'],
      ['Track', '#track'],
      ['Talyvor Code', '#code'],
    ])
    expect(screen.getByRole('link', { name: 'The Claude connector' })).toHaveAttribute('href', CLAUDE_CONNECTOR_PATH)
    expect(container.querySelector('main')?.closest('[data-design]')?.getAttribute('data-design')).toBe('pocket')
  })

  it('every control on the page does something', async () => {
    const report = await pressEverything(DOCUMENTATION_PATH)
    expect(report.dead).toEqual([])
    expect(report.pressed).toBeGreaterThan(20)
  }, 120_000)

  it('names the suite’s licence exactly as its LICENSE file does', () => {
    const first = readFileSync(resolve(SRC, '../../../LICENSE'), 'utf8').split('\n')[0].trim()
    expect(LICENCES.find((l) => l.repo === 'talyvor-suite')?.licence).toBe(first)
  })

  it('is linked from the site’s header and footer', () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('null', { status: 404 }))
    render(<Landing />)
    for (const region of [screen.getByRole('banner'), screen.getByRole('contentinfo')]) {
      expect(within(region).getByRole('link', { name: 'Docs' })).toHaveAttribute('href', DOCUMENTATION_PATH)
    }
  })

  // B56.3 — it says only what the code does: past a limit is refused, above the approval amount
  // waits; and investing, which is not offered, is on no public page, the route list included.
  it('says what a spending rule does, and puts no investing on the page', async () => {
    mockSignedOut()
    window.history.pushState({}, '', DOCUMENTATION_PATH)
    const { container } = render(<App />)
    await screen.findByRole('heading', { level: 1, name: 'Documentation' })
    expect(
      screen.getByText(
        'Set its spending rules: a payment past a limit is refused, and one above the approval amount waits in your approvals inbox, approved with a passkey once you have one.',
      ),
    ).toBeInTheDocument()
    expect(container.querySelector('main')).not.toHaveTextContent(
      /investing is simulated|simulated portfolio|simulated order|no order reaches a market/i,
    )
  })
})

// B56.10 — each claim that moves money carries Lens's label, and payouts in money say Building in words from the registry.
describe('/documentation labels', () => {
  it('labels the money claims as /api/pricing serves them, and says payouts in money are building', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } })
      if (String(input).startsWith('/auth/me')) return json({ mode: 'oidc', authenticated: false, user: null, signup_open: true })
      if (String(input) === '/api/pricing')
        return json({ min_usd_cents: 1000, max_usd_cents: 1_000_000, preset_usd_cents: [1000], labels: {
          move_between_own_agents: 'live', pay_another_owner: 'sandbox', escrow: 'live', loans_between_companies: 'live',
          buy_marketplace_listings: 'sandbox', rent_and_subscribe_listings: 'sandbox',
        } })
      return new Response('null', { status: 404 })
    })
    window.history.pushState({}, '', DOCUMENTATION_PATH)
    render(<App />)
    const claim = async (text: string) => (await screen.findByText(text, { exact: false })).closest('li')!
    const chip = (li: Element) => [...li.querySelectorAll('[data-status-key]')].map((c) => c.textContent)
    await vi.waitFor(async () => expect(chip(await claim('Create an agent, fund its wallet'))).toEqual(['Live']))
    expect(chip(await claim('Agents pay each other'))).toEqual(['Sandbox'])
    expect(chip(await claim('See what you owe for the listings'))).toEqual(['Sandbox'])
    const payouts = await claim('See what your listings earned')
    expect(payouts.textContent).toContain('Paying earnings out in money is building; until then they are taken as Talyvor credits.')
    expect(chip(payouts)).toEqual(['Building'])
    expect(chip(await claim('Read and download each wallet'))).toEqual([]) // statements carry no chip
  })
})
