import { describe, expect, it } from 'vitest'
import { itemsFor } from '../src/filing.ts'
import type { ReportedRun } from '../src/report.ts'
import { FOOTER_LINKS, HEADER_LINKS, PRIVACY_RECORDS, PUBLIC_PAGES, type PageRead, type SiteRead, siteFaults, splitSentence } from '../src/siteTruth.ts'

const NONE = 'Cookies\nOur public pages set no advertising or analytics cookies, and send nothing to Meta.'
const BANNER = "Cookies\nOur public pages use one advertising cookie, Meta's, to measure our ads, and only if you accept it in the cookie banner."

const clean = (): SiteRead => ({
  signup: 'open',
  cardPayments: 'test',
  pages: PUBLIC_PAGES.map((path): PageRead => ({
    path, header: [...HEADER_LINKS], footer: [...FOOTER_LINKS.slice(0, 4), 'mailto:hello@talyvor.com'],
    text: path === '/marketing' ? 'No invitation needed. Get started' : path === '/privacy' ? PRIVACY_RECORDS.join(' ') : 'Plans and prices',
    emailBox: false, chooseButtons: [], cookieBanner: false,
  })),
  privacyCookies: NONE,
  facebook: [],
  noKey: [{ path: '/status.json', status: 200 }, { path: '/healthz', status: 200 }],
  links: [{ page: '/pricing', href: 'https://app.talyvor.com/plans', status: 200, notFound: false }],
})

const planted = (f: (r: SiteRead) => void) => {
  const r = clean()
  f(r)
  return siteFaults(r)
}
const at = (r: SiteRead, path: string) => r.pages.find((p) => p.path === path)!

describe('the site-truth oracle (B51.4)', () => {
  it('passes a site that agrees with the product', () => {
    expect(siteFaults(clean())).toEqual([])
  })

  // B56.2: the page prints each plan's served platform fee, and no merged fee or gate row.
  it('catches a platform fee /pricing leaves out and a merged Services or sign-on row', () => {
    const served = (r: SiteRead) => { r.platformFeeBps = { free: 600, team: 325, enterprise: 100 } }
    expect(planted((r) => { served(r); at(r, '/pricing').text += ' Free 6% · Team 3.25% · Enterprise agreed' })).toEqual([])
    expect(planted((r) => { served(r); at(r, '/pricing').text += ' Free 6% · Team 3% · Services and compute 4% · SSO and audit export' })).toEqual([
      "/pricing does not say team's platform fee is 3.25%, as /api/pricing serves it",
      '/pricing still shows one "Services and compute" row',
      '/pricing still shows one "SSO and audit export" row',
    ])
  })

  // B56.4: /pricing and /terms say the served split from the first sale, and no page offers a first-million tier.
  it('catches a split without "from the first sale" and a first-million tier', () => {
    const SPLIT = 'Sellers earn 85% of every paid use, rental and purchase, from the first sale; Talyvor keeps 15%.'
    expect(splitSentence(1500)).toBe(SPLIT)
    const served = (r: SiteRead) => { r.marketTakeBps = 1500 }
    expect(planted((r) => { served(r); at(r, '/pricing').text += ` ${SPLIT}`; at(r, '/terms').text += ` Sellers earn 85% of every paid use,\nrental and purchase, from the first sale; Talyvor keeps 15%.` })).toEqual([])
    expect(planted((r) => { served(r); at(r, '/pricing').text += ' Sellers earn 85%; Talyvor keeps 15%'; at(r, '/terms').text += ` ${SPLIT} 100% of a seller’s first $1M` })).toEqual([
      `/pricing does not say "${SPLIT}"`,
      '/terms offers a first-million tier',
    ])
  })

  // B56.3: no investing on the legal pages or the documentation, and Privacy names every wallet record.
  it('catches investing on a public page and a wallet record Privacy leaves out', () => {
    expect(planted((r) => {
      at(r, '/terms').text += ' Investing is simulated: simulated US dollars at real prices'
      at(r, '/privacy').text = at(r, '/privacy').text.replace('Mandates.', '')
    })).toEqual(['/privacy leaves out the "Mandates." record', '/terms puts investing on a public page'])
  })

  it('catches the waitlist on /marketing while sign-up is open, and only then', () => {
    expect(planted((r) => { at(r, '/marketing').emailBox = true; at(r, '/marketing').text += ' Your place opens soon' })).toEqual([
      '/marketing shows an email box while the BFF reports sign-up open',
      '/marketing says "place opens" while the BFF reports sign-up open',
    ])
    expect(planted((r) => { r.signup = 'closed'; at(r, '/marketing').emailBox = true })).toEqual([])
  })

  it('catches a top-up line or a Choose button on /pricing while card payments are not live, and waits for Lens to say', () => {
    const buy = (r: SiteRead) => { at(r, '/pricing').text += ' Top up any amount from $10.00'; at(r, '/pricing').chooseButtons = ['Choose Team'] }
    expect(planted(buy)).toEqual([
      '/pricing shows "Top up any amount" while card_payments is "test"',
      '/pricing shows Choose Team while card_payments is "test"',
    ])
    expect(planted((r) => { buy(r); r.cardPayments = 'live' })).toEqual([])
    expect(planted((r) => { buy(r); r.cardPayments = undefined })).toEqual([])
  })

  it('catches a "No key needed" route that answers 401', () => {
    expect(planted((r) => r.noKey.push({ path: '/v1/tokens/rates', status: 401 }))).toEqual([
      '/v1/tokens/rates, under "No key needed" on /documentation, answers 401 without a key',
    ])
  })

  it("catches Privacy's Cookies section disagreeing with the pages", () => {
    expect(planted((r) => { at(r, '/marketing').cookieBanner = true; r.facebook = ['/pricing'] })).toEqual([
      'Privacy says there are no cookies, and /marketing show a cookie banner',
      'Privacy says there are no cookies, and /pricing asked connect.facebook.net',
    ])
    expect(planted((r) => { r.privacyCookies = BANNER })).toEqual(['Privacy describes a cookie banner that no public page shows'])
    expect(planted((r) => { r.privacyCookies = BANNER; at(r, '/marketing').cookieBanner = true })).toEqual([])
  })

  it('catches a public page without the shared header or footer', () => {
    expect(planted((r) => { at(r, '/terms').header = ['/marketing', '/']; at(r, '/privacy').footer = [] })).toEqual([
      '/privacy lacks the shared footer (no link to /privacy, /terms, /pricing, /documentation, mailto:)',
      '/terms lacks the shared header (no link to /pricing, /documentation, /signup)',
    ])
  })

  it("catches a link that answers 404 or lands on the app's not-found page", () => {
    expect(planted((r) => r.links.push(
      { page: '/documentation', href: 'https://app.talyvor.com/brand/gone.svg', status: 404, notFound: false },
      { page: '/marketing', href: 'https://app.talyvor.com/earnings-old', status: 200, notFound: true },
    ))).toEqual([
      '/documentation links to https://app.talyvor.com/brand/gone.svg, which answers 404',
      "/marketing links to https://app.talyvor.com/earnings-old, which lands on the app's not-found page",
    ])
  })

  it('files a planted disagreement as a build item for talyvor-suite that night', () => {
    const detail = planted((r) => { at(r, '/marketing').emailBox = true }).join(' | ')
    const run: ReportedRun = {
      started_at: '2026-10-28T01:00:00.000Z', finished_at: '2026-10-28T01:20:00.000Z', app: 'https://app', lens: 'https://lens',
      users: 10, model: 'Claude Haiku 4.5', cap_usd: 5, spent_usd: 0, stopped_at_cap: false, counts: { PASS: 0, FAIL: 1, SKIP: 0, ERROR: 0 },
      outcomes: [{ scenario: 'site-truth', title: 'the public pages agree with the product', user: 2, workspace: 'ws2', status: 'FAIL', detail, evidence: [] }],
    }
    const f = itemsFor('# queue\n', run, 'docs/e2e/report-2026-10-28.md')
    expect(f.filed).toEqual([{ id: 'B17.1', scenario: 'site-truth', repo: 'talyvor-suite' }])
    expect(f.append).toContain('/marketing shows an email box while the BFF reports sign-up open')
    expect(f.append).toContain('\ne2e-scenario: site-truth\n')
  })
})
