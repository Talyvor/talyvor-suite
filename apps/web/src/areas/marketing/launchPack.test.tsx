import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Landing } from './Landing'
import { Pricing } from './Pricing'
import { SiteFooter, SiteHeader } from '../../components/SiteChrome'
import { Documentation } from '../documentation/Documentation'

// B59.5 — the public website shows the launch pack only (LAUNCH-PACK.md section 2): the nav, the home page, /pricing
// and the footer name no hidden area, link to none, and say nothing is coming soon. A hidden area simply isn't there.
// B59.37 — and so does /documentation, every guide, claim and Lens route group on it.

/** The hidden areas as a visitor would read them, and the old gateway's parts by their own words. */
const HIDDEN: Array<[string, RegExp]> = [
  ['the marketplace', /market\s?place|listing/i],
  ['Rooms', /\brooms?\b/i],
  ['Chat', /\bchat\b|hey taly/i],
  ['Track', /\btrack\b/i],
  ['Docs', /\bdocs\b/i],
  ['Code', /talyvor code/i],
  ['Edge', /\bedge\b|your own infrastructure/i],
  ['the desktop app', /desktop/i],
  ['Scan', /\bscan\b/i],
  ['Counter', /\bcounter\b/i],
  ['trading', /\btrad(e|es|ing)\b|broker/i],
  ['credit and lending', /credit line|\blend|\bloans?\b|borrow/i],
  ['interest and yield', /\binterest\b|\byield/i],
  ['prediction markets', /prediction/i],
  ['the old gateway', /gateway|\bpool(ed|ing)?\b|\bcache|routing|\btare\b|guardrail|stored answer/i],
  ['coming soon', /coming soon/i],
]

/** The hidden areas' addresses in the app. */
const HIDDEN_HREF = /^\/(marketplace|rooms|chat|track|docs|code|edge|scan|counter|features)(\/|$|#|\?)/

/** Every price card field a deployment can serve, so every plan row and fee row is drawn. */
const CARD = {
  usd_per_lxc: 0.1,
  plans: [{ id: 'plus', usd_cents: 2000, included_ulxc: 180_000_000 }],
  company_plans: [{ id: 'team', usd_cents: 5900 }],
  enterprise_from_usd_cents: 300000,
  card_payments: 'live',
  plan_gates: {
    order: ['free', 'team', 'enterprise'],
    plans: {
      free: { agents: 3, seats: 1, own_provider_keys: 'none', live_money: false, slack_teams_approvals: false, sso: false, audit_export: false, edge: false },
      team: { agents: 40, seats: 6, own_provider_keys: 'add_on', live_money: true, slack_teams_approvals: true, sso: false, audit_export: false, edge: false },
      enterprise: { agents: -1, seats: -1, own_provider_keys: 'included', live_money: true, slack_teams_approvals: true, sso: true, audit_export: true, edge: true },
    },
  },
  fees: {
    market_take_bps: 1500,
    services_take_bps: 400,
    compute_take_bps: 400,
    lending_fee_bps: 150,
    platform_fee_bps: { free: 600, team: 325, enterprise: 100 },
    fx_margin_bps: { free: 0, team: 60, enterprise: 15 },
    intl_payment_fee_minor: { USD: 800 },
    merchant_fee_bps: 80,
    merchant_a2a_fee_bps: 110,
  },
  labels: { buy_marketplace_listings: 'sandbox', loans_between_companies: 'sandbox' },
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

/** What a visitor reads on the page, without its <style> block, and where its links go. */
function read(container: HTMLElement) {
  const page = container.cloneNode(true) as HTMLElement
  page.querySelectorAll('style').forEach((s) => s.remove())
  // Each text node apart: textContent runs neighbours together ("Your moneyDocs"), which no word boundary sees.
  const walker = document.createTreeWalker(page, NodeFilter.SHOW_TEXT)
  const parts: string[] = []
  while (walker.nextNode()) parts.push(walker.currentNode.textContent ?? '')
  const text = parts.join(' ').replace(/\s+/g, ' ')
  const hrefs = [...page.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? '')
  return { text, hrefs }
}

/** Each hidden area the text names, with the words that name it. */
function named(text: string): string[] {
  return HIDDEN.flatMap(([area, re]) => {
    const m = text.match(re)
    return m ? [`${area}: "${m[0]}"`] : []
  })
}

describe('B59.5 — the public website shows the launch pack only', () => {
  it('the nav and the footer name and link to no hidden area', () => {
    const { container } = render(
      <>
        <SiteHeader />
        <SiteFooter />
      </>,
    )
    const { text, hrefs } = read(container)
    expect(named(text)).toEqual([])
    expect(hrefs.filter((h) => HIDDEN_HREF.test(h))).toEqual([])
  })

  it('the home page names and links to no hidden area', () => {
    const { container } = render(<Landing />)
    const { text, hrefs } = read(container)
    expect(named(text)).toEqual([])
    expect(hrefs.filter((h) => HIDDEN_HREF.test(h))).toEqual([])
  })

  it('/pricing names no hidden area in any plan row, fee row or sentence', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) =>
      String(input) === '/api/pricing'
        ? new Response(JSON.stringify(CARD), { status: 200, headers: { 'Content-Type': 'application/json' } })
        : new Response('null', { status: 404 }),
    )
    const { container } = render(<Pricing />)
    await screen.findByTestId('company-plan-enterprise')
    await screen.findByTestId('fees-money-features')
    const { text, hrefs } = read(container)
    expect(named(text)).toEqual([])
    expect(hrefs.filter((h) => HIDDEN_HREF.test(h))).toEqual([])
  })
})

describe('B59.37 — the public documentation shows the launch pack only', () => {
  it('/documentation names and links to no hidden area in any part card, guide, claim or route group', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) =>
      String(input) === '/api/pricing'
        ? new Response(JSON.stringify(CARD), { status: 200, headers: { 'Content-Type': 'application/json' } })
        : new Response('null', { status: 404 }),
    )
    const { container } = render(<Documentation />)
    await screen.findByRole('heading', { level: 1, name: 'Documentation' })
    // The licences table stays as it is: it names the repositories, not what the product offers.
    const page = container.cloneNode(true) as HTMLElement
    page.querySelector('#licences')?.remove()
    const { text, hrefs } = read(page)
    expect(named(text)).toEqual([])
    expect(hrefs.filter((h) => HIDDEN_HREF.test(h))).toEqual([])
  })
})
