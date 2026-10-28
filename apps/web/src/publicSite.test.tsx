import { cleanup, render, screen, within } from '@testing-library/react'
import { matchRoutes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App, CONSOLE_ROUTES, queryClient } from './App'
import { Landing } from './areas/marketing/Landing'
import lensRoutes from './areas/documentation/lens-routes.json'
import { COMPANY_CONTACT, COMPANY_NAME } from './company'

// B51.1 (Nick, 28 Oct 2026) — the site says what Talyvor does today, the same on every page: the waitlist only while
// sign-up is closed, one header and one footer on every public page, Privacy built from what the code does, and no
// link on a public page to an address the app doesn't serve or an anchor that isn't there.

const PUBLIC_PAGES = ['/marketing', '/pricing', '/documentation', '/documentation/claude', '/privacy', '/terms']

const PRICING = {
  usd_per_lxc: 0.1,
  min_usd_cents: 1000,
  max_usd_cents: 1_000_000,
  preset_usd_cents: [1000],
  plans: [{ id: 'plus', usd_cents: 2000, included_ulxc: 180_000_000 }],
  company_plans: [{ id: 'team', usd_cents: 5900 }],
  enterprise_from_usd_cents: 300000,
  plan_gates: {
    order: ['free', 'team', 'enterprise'],
    plans: Object.fromEntries(
      ['free', 'team', 'enterprise'].map((id) => [
        id,
        { agents: 3, seats: 1, own_provider_keys: 'none', live_money: id !== 'free', slack_teams_approvals: false, sso: false, audit_export: false, edge: false },
      ]),
    ),
  },
  fees: {
    market_take_bps: 1500,
    services_take_bps: 500,
    compute_take_bps: 500,
    lending_fee_bps: 100,
    platform_fee_bps: { free: 0, team: 0, enterprise: 0 },
    fx_margin_bps: { free: 0, team: 50, enterprise: 0 },
    intl_payment_fee_minor: { USD: 500 },
    merchant_fee_bps: 50,
    merchant_a2a_fee_bps: 50,
  },
}

/** A stranger's BFF. `signup` is what /auth/me reports: open, closed, or nothing (an older BFF). */
function stranger(signup: boolean | undefined = true) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'Content-Type': 'application/json' } })
    if (url.startsWith('/auth/me')) return json({ mode: 'oidc', authenticated: false, user: null, signup_open: signup })
    if (url.startsWith('/api/pricing')) return json(PRICING)
    return new Response('null', { status: 404 })
  })
}

async function at(path: string) {
  window.history.pushState({}, '', path)
  const view = render(<App />)
  await screen.findByRole('heading', { level: 1 })
  return view
}

beforeEach(() => queryClient.clear())
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  window.history.pushState({}, '', '/')
})

describe('the waitlist on /marketing follows the sign-up state', () => {
  it('open: Get started is the way in — no email box and no "place opens"', async () => {
    stranger(true)
    render(<Landing />)
    expect(await screen.findByText(/No invitation needed/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Email address')).toBeNull()
    expect(document.body.textContent).not.toMatch(/place opens|Join the waitlist/)
    expect(screen.getAllByRole('link', { name: 'Get started' })[0]).toHaveAttribute('href', '/signup')
  })

  it('closed: the email box and the closed sentence', async () => {
    stranger(false)
    render(<Landing />)
    expect(await screen.findByText(/letting the first companies in one at a time/)).toBeInTheDocument()
    expect(screen.getByLabelText('Email address')).toBeInTheDocument()
    expect(screen.getByText(/place opens/)).toBeInTheDocument()
  })

  it('unknown: neither', async () => {
    stranger(undefined)
    render(<Landing />)
    await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())
    expect(screen.queryByLabelText('Email address')).toBeNull()
    expect(document.body.textContent).not.toMatch(/place opens|No invitation needed|one at a time/)
  })
})

const linksOf = (el: HTMLElement) =>
  within(el)
    .getAllByRole('link')
    .map((a) => `${a.textContent?.trim()} ${a.getAttribute('href')}`)

describe.each(PUBLIC_PAGES)('%s', (path) => {
  it('wears the one header and the one footer', async () => {
    stranger()
    await at(path)
    const header = screen.getAllByRole('banner')[0] // the legal pages' title block is a <header> in main too
    expect(header.textContent).not.toMatch(/suite/i)
    expect(linksOf(header)).toEqual([
      ' /marketing',
      'Pricing /pricing',
      'Documentation /documentation',
      'Open the app /',
      'Get started /signup',
    ])
    expect(within(header).getByRole('button', { name: /theme|dark|light/i })).toBeInTheDocument()

    const footer = screen.getByRole('contentinfo')
    expect(linksOf(footer)).toEqual([
      'Privacy /privacy',
      'Terms /terms',
      'Pricing /pricing',
      'Documentation /documentation',
      `${COMPANY_CONTACT} mailto:${COMPANY_CONTACT}`,
    ])
    expect(within(footer).getByText(new RegExp(COMPANY_NAME))).toBeInTheDocument()
  })
})

// Internal addresses the app serves outside CONSOLE_ROUTES: the public pages and the BFF's own.
const SERVED_OUTSIDE_CONSOLE = [...PUBLIC_PAGES, '/signup', '/signin']
const BFF_PREFIXES = ['/api/', '/auth/', '/brand/']

describe('every link on every public page goes somewhere real', () => {
  it('names an address the app serves, and an anchor on the page it points at', async () => {
    const ids = new Map<string, Set<string>>()
    const links: Array<{ page: string; href: string }> = []
    for (const page of PUBLIC_PAGES) {
      stranger()
      const { container, unmount } = await at(page)
      ids.set(page, new Set([...container.querySelectorAll('[id]')].map((e) => e.id)))
      for (const a of container.querySelectorAll('a[href]')) links.push({ page, href: a.getAttribute('href')! })
      unmount()
      queryClient.clear()
      vi.restoreAllMocks()
    }

    const bad: string[] = []
    for (const { page, href } of links) {
      if (/^(https?:|mailto:)/.test(href)) continue
      const url = new URL(href, `http://x${page}`)
      const path = url.pathname
      // An in-app link, /documentation's included, must name a route in CONSOLE_ROUTES.
      const served =
        matchRoutes(CONSOLE_ROUTES as never, path) !== null ||
        SERVED_OUTSIDE_CONSOLE.includes(path) ||
        BFF_PREFIXES.some((p) => path.startsWith(p))
      if (!served) bad.push(`${page}: ${href} — not served`)
      // shortcut: an anchor into a signed-in screen isn't checked, since a stranger can't render it.
      const target = path.startsWith('/marketing') ? '/marketing' : path
      if (url.hash && ids.has(target) && !ids.get(target)!.has(decodeURIComponent(url.hash.slice(1)))) {
        bad.push(`${page}: ${href} — no such anchor`)
      }
    }
    expect(links.length).toBeGreaterThan(50)
    expect(bad).toEqual([])
  })
})

describe('/documentation lists only what Lens serves without a key under "No key needed"', () => {
  it('puts /v1/tokens/rates and /v1/economy/stats with the routes that take a key', () => {
    const publicGroup = lensRoutes.groups.find((g) => g.id === 'public')!
    expect(publicGroup.about).toBe('No key needed.')
    const paths = publicGroup.routes.map((r) => r.path)
    expect(paths).not.toContain('/v1/tokens/rates')
    expect(paths).not.toContain('/v1/economy/stats')
    const keyed = lensRoutes.groups.filter((g) => g.id !== 'public').flatMap((g) => g.routes.map((r) => r.path))
    expect(keyed).toEqual(expect.arrayContaining(['/v1/tokens/rates', '/v1/economy/stats']))
  })
})

describe('/privacy says what the code does', () => {
  const section = (title: string) => screen.getByRole('heading', { level: 2, name: title }).closest('section')!

  it('names its controller without saying it names none, and is dated the day it changed', async () => {
    stranger()
    await at('/privacy')
    expect(document.body.textContent).toContain(`${COMPANY_NAME} (company number`)
    expect(document.body.textContent).not.toMatch(/does not identify a data controller/)
    expect(screen.getAllByText(/legal review/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText('28 October 2026').length).toBeGreaterThan(0)
  })

  it('the waitlist: past tense while sign-up is open, the current words while closed', async () => {
    stranger(true)
    const { unmount } = await at('/privacy')
    expect(await within(section('The waitlist')).findByText(/Before sign-up opened, people could leave an email/)).toBeInTheDocument()
    unmount()
    queryClient.clear()
    vi.restoreAllMocks()
    stranger(false)
    await at('/privacy')
    expect(within(section('The waitlist')).getByText(/If you join the waitlist we store your email address/)).toBeInTheDocument()
  })

  it('cookies: with the pixel off, none and nothing to Meta', async () => {
    stranger()
    await at('/privacy')
    expect(section('Cookies').textContent).toBe(
      'CookiesOur public pages set no advertising or analytics cookies, and send nothing to Meta.',
    )
    expect(section('What leaves this system').textContent).not.toMatch(/Meta/)
  })

  it('lists every outside service the code sends data to, and keeps "no analytics" to the app', async () => {
    stranger()
    await at('/privacy')
    const leaves = section('What leaves this system').textContent!
    for (const who of ['The AI provider', 'OpenAI', 'Anthropic', 'A vision model', 'Google', 'Stripe', 'The card partner', 'push service', 'Other Talyvor workspaces']) {
      expect(leaves).toContain(who)
    }
    expect(leaves).toContain('no session recording inside the app.')
    expect(leaves).not.toContain('in this application')
    expect(section('What Agent Wallets stores').textContent).toMatch(/single-use, locked to one merchant and capped/)
  })
})
