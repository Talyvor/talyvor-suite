import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { App, queryClient } from './App'
import { PENDING_POLL_MS } from './areas/lens/WalletScreens'

// B28.7 — the navigation is wallet-first. B57.8 — and it is Pocket's rows, with no folding groups: the wallet's own
// screens, a rule, then the rest. Drives the real <App /> as an operator, which adds no row.

const ORDER = [
  'Home',
  'Approvals',
  'Agents',
  'Statements',
  'Pay',
  'Invoices',
  'Spending',
  'Chat',
  'Rooms',
  'Marketplace',
  'Scan',
  'Track and Docs',
  'Developers',
  'Billing',
  'Settings',
  'Privacy',
  'Terms',
]

const APPROVALS = [
  { id: 'apr_1', agent_id: 'agt_1', model: 'gpt-4o', amount_ulxc: 2_000_000, status: 'pending', created_at: '2026-10-04T10:00:00Z' },
  { id: 'apr_2', agent_id: 'agt_1', model: 'gpt-4o', amount_ulxc: 3_000_000, status: 'pending', created_at: '2026-10-04T11:00:00Z' },
  { id: 'apr_3', agent_id: 'agt_1', model: 'gpt-4o', amount_ulxc: 1_000_000, status: 'approved', created_at: '2026-10-03T09:00:00Z' },
]

function mockBff() {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input).split('?')[0]
    const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'oidc', authenticated: true, user: { sub: 's1', email: 'ng@example.com' }, operator: true })
    if (url === '/api/money/devices') return json({ devices: [] }) // B55.2: no phone key, so the web decides
    if (url === '/api/agents/approvals') return json({ approvals: APPROVALS })
    if (url === '/api/agents/passkeys') return json({ passkeys: [] })
    if (url === '/api/agents')
      return json({
        workspace_balance_ulxc: 0, allocated_ulxc: 0, unallocated_ulxc: 0, spent_ulxc: 0,
        agents: [{ id: 'agt_1', name: 'Researcher', balance_ulxc: 0, spent_ulxc: 0, keys: [], created_at: '2026-10-01T00:00:00Z' }],
      })
    return new Response('null', { status: 404 })
  })
}

async function sidebarAt(address: string): Promise<HTMLElement> {
  window.history.pushState({}, '', address)
  render(<App />)
  return screen.findByRole('navigation', { name: /sections/i })
}

afterEach(() => {
  cleanup()
  queryClient.clear()
  vi.restoreAllMocks()
})

describe('the navigation is wallet-first (B28.7)', () => {
  it('the sidebar is the logo, the workspace, then Home, Approvals, Agents, Statements, Pay, Invoices, Spending, Chat, Rooms, Marketplace; a rule; Scan, Track and Docs, Developers, Billing, Settings; Privacy and Terms at its foot', async () => {
    mockBff()
    const nav = await sidebarAt('/')
    await within(nav).findByRole('link', { name: /^Approvals 2/ })
    // The logo leads, to Home; then every row is a link, and nothing in the sidebar folds.
    const links = Array.from(nav.querySelectorAll<HTMLAnchorElement>('a[href]'))
    expect(links[0].getAttribute('aria-label')).toBe('Talyvor, Home')
    expect(links[0].getAttribute('href')).toBe('/')
    expect(links.slice(1).map((el) => (el.textContent ?? '').replace(/\d+ waiting$/, '').trim())).toEqual(ORDER)
    expect(nav.querySelectorAll('button[aria-expanded]')).toHaveLength(0)
    // The rule sits between Marketplace and Scan.
    const rule = nav.querySelector('[role="separator"]')!
    expect(rule.previousElementSibling?.textContent).toBe('Marketplace')
    expect(rule.nextElementSibling?.textContent).toBe('Scan')
  })

  it('the workspace’s name sits under the logo, never its id', async () => {
    mockBff()
    const lens = vi.mocked(globalThis.fetch).getMockImplementation()!
    vi.mocked(globalThis.fetch).mockImplementation(async (input, init) =>
      String(input).split('?')[0] === '/api/workspace/name' ? Response.json({ id: 'ws_1', name: 'Nick’s team' }) : lens(input, init),
    )
    const nav = await sidebarAt('/')
    expect((await within(nav).findByTestId('sidebar-workspace-name')).textContent).toBe('Nick’s team')
  })

  it('every link in the sidebar resolves to a page', async () => {
    mockBff()
    const nav = await sidebarAt('/')
    const hrefs = Array.from(nav.querySelectorAll<HTMLAnchorElement>('a[href]')).map((a) => a.getAttribute('href') ?? '')
    expect(hrefs.length).toBe(ORDER.length + 1)
    for (const href of hrefs) {
      cleanup()
      queryClient.clear()
      window.history.pushState({}, '', href)
      render(<App />)
      const h1 = await screen.findByRole('heading', { level: 1 })
      expect(h1.textContent, `${href} opened no page`).not.toBe('Not found')
      expect(screen.queryByText(/Nothing at this address/), `${href} fell to the catch-all`).toBeNull()
    }
    // Slow by nature: it renders the page behind every sidebar link in turn, so it grows with the console.
  }, 15_000)

  it('B28.45 — approving one takes the badge from 3 to 2 without a reload', async () => {
    const waiting = [...APPROVALS, { ...APPROVALS[0], id: 'apr_4', created_at: '2026-10-04T12:00:00Z' }]
    mockBff()
    const lens = vi.mocked(globalThis.fetch).getMockImplementation()!
    vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
      const url = String(input).split('?')[0]
      if (url === '/api/agents/approvals') return Response.json({ approvals: waiting })
      const decided = /^\/api\/agents\/approvals\/([^/]+)\/approve$/.exec(url)
      if (decided && init?.method === 'POST') {
        const i = waiting.findIndex((a) => a.id === decided[1])
        waiting[i] = { ...waiting[i], status: 'approved' }
        return Response.json(waiting[i])
      }
      return lens(input, init)
    })
    const nav = await sidebarAt('/approvals')
    await within(nav).findByRole('link', { name: 'Approvals 3 waiting' })
    const main = within(screen.getByRole('main'))
    // B57.17 — each opens its sheet with Review; the sheet approves it.
    await waitFor(() => expect(main.getAllByRole('link', { name: 'Review' })).toHaveLength(3))
    fireEvent.click(main.getAllByRole('link', { name: 'Review' })[0])
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }))
    await within(nav).findByRole('link', { name: 'Approvals 2 waiting' })
    await waitFor(() => expect(main.getAllByRole('link', { name: 'Review' })).toHaveLength(2))
  })

  it('B28.45 — an approval an agent files while the page is open reaches the badge on its own', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const waiting = [...APPROVALS]
      mockBff()
      const lens = vi.mocked(globalThis.fetch).getMockImplementation()!
      vi.mocked(globalThis.fetch).mockImplementation(async (input, init) =>
        String(input).split('?')[0] === '/api/agents/approvals' ? Response.json({ approvals: [...waiting] }) : lens(input, init),
      )
      const nav = await sidebarAt('/')
      await within(nav).findByRole('link', { name: 'Approvals 2 waiting' })
      waiting.push({ ...APPROVALS[0], id: 'apr_5', created_at: '2026-10-04T13:00:00Z' })
      await vi.advanceTimersByTimeAsync(PENDING_POLL_MS)
      await within(nav).findByRole('link', { name: 'Approvals 3 waiting' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('B17.322 — a read that fails mid-session keeps the badge and its polling; the next answer reaches it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const waiting = [...APPROVALS]
      let down = false
      mockBff()
      const lens = vi.mocked(globalThis.fetch).getMockImplementation()!
      vi.mocked(globalThis.fetch).mockImplementation(async (input, init) =>
        String(input).split('?')[0] !== '/api/agents/approvals'
          ? lens(input, init)
          : down
            ? new Response('busy', { status: 503 })
            : Response.json({ approvals: [...waiting] }),
      )
      const nav = await sidebarAt('/')
      await within(nav).findByRole('link', { name: 'Approvals 2 waiting' })
      down = true
      await vi.advanceTimersByTimeAsync(PENDING_POLL_MS + 5_000) // the poll and its one retry both fail
      expect(within(nav).getByRole('link', { name: 'Approvals 2 waiting' })).toBeTruthy()
      down = false
      waiting[0] = { ...waiting[0], status: 'approved' } // decided in another tab
      await vi.advanceTimersByTimeAsync(PENDING_POLL_MS)
      await within(nav).findByRole('link', { name: 'Approvals 1 waiting' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('Approvals carries the count waiting, and opens them', async () => {
    mockBff()
    const nav = await sidebarAt('/')
    const link = await within(nav).findByRole('link', { name: 'Approvals 2 waiting' })
    fireEvent.click(link)
    expect(window.location.pathname).toBe('/approvals')
    const main = within(screen.getByRole('main'))
    await waitFor(() => expect(main.getAllByRole('link', { name: 'Review' })).toHaveLength(2))
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Approvals')
  })
})
