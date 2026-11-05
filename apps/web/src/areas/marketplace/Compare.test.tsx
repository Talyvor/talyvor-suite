import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'
import { volumePrice } from './Compare'

// B41.72 — three listings picked on Discover and compared side by side: every value in the table is one the mock BFF
// gave for that listing — its offers for the price at the buyer's volume and its licence, its trust read (B32.49 and
// B41.173's performance) for its rating, success rate, latency and evaluation.

const base = {
  workspace_id: 'ws_seller',
  kind: 'agent',
  description: '',
  visibility: 'public',
  latest_version: 1,
  created_at: '2026-09-01T09:00:00Z',
  updated_at: '2026-10-01T09:00:00Z',
  review_status: 'approved',
  price_per_use_ulxc: 0,
}

const LISTINGS: Record<string, Record<string, unknown>> = {
  lst_a: {
    ...base,
    id: 'lst_a',
    title: 'Translator',
    offers: [
      { kind: 'per_use', licence: 'personal', price_usd_micros: 10_000 },
      { kind: 'per_use', licence: 'commercial', price_usd_micros: 20_000 },
    ],
  },
  lst_b: {
    ...base,
    id: 'lst_b',
    title: 'Copywriter',
    offers: [{ kind: 'subscribe', licence: 'commercial', price_usd_micros: 9_000_000, period_days: 30, included_uses: 200 }],
  },
  lst_c: {
    ...base,
    id: 'lst_c',
    title: 'Contract checker',
    offers: [{ kind: 'buy', licence: 'enterprise', price_usd_micros: 500_000_000, seats: 10 }],
  },
}

const perf = (uses: number, failed: number, rate: number | null, ms: number | null) => ({
  days: 30,
  uses,
  failed,
  success_rate: rate,
  median_latency_ms: ms,
  cost_per_use_usd_micros: null,
})

const TRUSTS: Record<string, Record<string, unknown>> = {
  lst_a: { reviews: { count: 4, average: 4.25 }, eval: { version: 1, passed: 9, cases: 10, ran_at: '2026-10-03T09:00:00Z' }, performance: perf(100, 5, 0.95, 840) },
  lst_b: { reviews: { count: 1, average: 3 }, eval: null, performance: perf(40, 0, 1, 1200) },
  lst_c: { reviews: { count: 0, average: 0 }, eval: null, performance: perf(0, 0, null, null) },
}

function mockBff() {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = new URL(String(input), 'http://x')
    const json = (v: unknown, status = 200) =>
      new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (url.pathname === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url.pathname === '/api/marketplace/search')
      return json({
        listings: Object.values(LISTINGS).map((l) => ({ ...l, price_per_use_usd_micros: null, distinct_buyers_7d: 0, trending_score: 0 })),
        sort: 'trending',
        page: 1,
        total: 3,
        has_more: false,
      })
    const trust = /^\/api\/marketplace\/listings\/([^/]+)\/trust$/.exec(url.pathname)
    if (trust)
      return json({
        listing_id: trust[1],
        version: 1,
        publisher: { workspace_id: 'ws_seller', verified: true, payouts_enabled: true, upheld_claims_12_months: 0 },
        reviews: { stars: [0, 0, 0, 0, 0], recent: null, ...(TRUSTS[trust[1]].reviews as object) },
        claims: { open: 0, upheld: 0, attributed: 0, rejected: 0 },
        originals: null,
        remixes: 0,
        ...TRUSTS[trust[1]],
      })
    const one = /^\/api\/marketplace\/listings\/([^/]+)$/.exec(url.pathname)
    if (one && LISTINGS[one[1]]) return json(LISTINGS[one[1]])
    if (url.pathname.startsWith('/api/marketplace/')) return json({ listings: [], capabilities: [], collections: [], rooms: [] })
    return json({ error: 'not found' }, 404)
  })
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  queryClient.clear()
})

const cells = (row: string) => screen.getAllByTestId(`compare-${row}`).map((c) => c.textContent)

describe('B41.72 — compare listings side by side', () => {
  it('three listings picked on Discover show every value from their own records in one table', async () => {
    mockBff()
    window.history.pushState({}, '', '/marketplace')
    render(<App />)
    const grid = await screen.findByRole('list', { name: 'Listings' })
    for (const t of ['Translator', 'Copywriter', 'Contract checker'])
      fireEvent.click(within(grid).getByRole('button', { name: `Compare ${t}` }))
    fireEvent.click(screen.getByRole('link', { name: 'Compare side by side' }))

    const table = await screen.findByTestId('compare-table')
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'AgentTranslator',
      'AgentCopywriter',
      'AgentContract checker',
    ])
    fireEvent.change(screen.getByLabelText('Uses you expect'), { target: { value: '500' } })
    // 500 × $0.02 on the commercial per-use offer (the personal one never covers an agent); 3 × $9 subscriptions of 200.
    expect(cells('Price for 500 uses')).toEqual([
      '$10.00500 uses at its per-use price',
      '$27.003 30-day subscriptions of 200 uses each',
      'Enterprise licence only, priced by seat',
    ])
    expect(cells('Rating')).toEqual(['4.25 of 5 from 4 reviews', '3.00 of 5 from 1 review', 'No reviews yet'])
    expect(cells('Success rate')).toEqual([
      '95%5 of 100 uses failed in the last 30 days',
      '100%0 of 40 uses failed in the last 30 days',
      'No uses in the last 30 days',
    ])
    expect(cells('Latency')).toEqual(['840 ms median', '1,200 ms median', 'No answered uses yet'])
    expect(cells('Licence')).toEqual(['Personal · Commercial', 'Commercial', 'Enterprise'])
    expect(cells('Evaluation')).toEqual(['9 of 10 cases passed', 'Not evaluated', 'Not evaluated'])
  })

  it('prices a volume on the cheapest commercial offer, as Lens does', () => {
    const offers = [
      { kind: 'per_use' as const, licence: 'commercial' as const, price_usd_micros: 20_000 },
      { kind: 'buy' as const, licence: 'commercial' as const, price_usd_micros: 5_000_000 },
    ]
    expect(volumePrice(offers, 100)).toEqual({ total: 2_000_000, basis: '100 uses at its per-use price' })
    expect(volumePrice(offers, 1000)).toEqual({ total: 5_000_000, basis: 'one purchase covers every use' })
    expect(volumePrice([], 10)).toEqual({ total: 0, basis: 'free to use' })
  })
})
