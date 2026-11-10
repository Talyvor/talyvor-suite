// B51.4 — THE LIVE SITE AGAINST THE LIVE PRODUCT, EVERY NIGHT. Signed out and GET only, the public pages as a browser renders
// them, held to what the product itself answers: the sign-up state the BFF reports (/auth/me), card_payments in /api/pricing
// (once Lens serves it, B51.2) and Lens's /status.json rails. It fails on any disagreement:
//   /marketing shows an email box or "place opens" while sign-up is open;
//   /pricing shows "Top up any amount" or a Choose button while card_payments is there and not "live";
//   /pricing leaves out a plan's platform fee as /api/pricing serves it, or merges Services with Compute or sign-on with
//     audit export in one row (B56.2);
//   /pricing or /terms leaves out "Sellers earn 85% … from the first sale; Talyvor keeps 15%." at the served take, or any
//     public page offers a first-$1M or "100% of" tier (B56.4);
//   /terms, /privacy or /documentation puts investing on a public page, or Privacy leaves out a record Agent Wallets
//     keeps (B56.3);
//   a page draws Live for money /api/pricing's labels do not call live, or /marketing or /pricing draws no Live or
//     Sandbox while /api/pricing serves labels (B56.10);
//   a route under "No key needed" on /documentation answers 401 to a caller with no key;
//   Privacy's Cookies section disagrees with the pages: a cookie banner or a request to connect.facebook.net while it says
//     there are none, or no banner on any page while it describes one;
//   /your-money leaves out that LXC is not money, that a mandate needs the owner's signed say, or that Talyvor is not a
//     bank (B57.62);
//   a page Pocket has drawn (POCKET_PAGES) served in today's design (B57.63);
//   a public page without the shared header and footer (B51.1);
//   a link on a public page that answers 404, or lands on the app's not-found page.
// Where a link lands is read in this user's own signed-in tab, since a stranger is shown sign-in at every console address.

import type { BrowserContext, Page } from 'playwright'
import type { Scenario } from './scenarios.ts'
import { CannotTest } from './scenarios.ts'

export const PUBLIC_PAGES = ['/marketing', '/pricing', '/your-money', '/documentation', '/documentation/claude', '/privacy', '/terms'] as const

/** B51.1's one header and one footer, as B57.59 draws them in Pocket: the addresses each must link to. */
export const HEADER_LINKS = ['/marketing', '/pricing', '/your-money', '/documentation', '/']
export const FOOTER_LINKS = ['/pricing', '/your-money', '/documentation', '/privacy', '/terms', 'mailto:']

/** B57.61, B57.62 and B57.63: the public pages drawn in Pocket, which must say so (`data-design="pocket"`). */
export const POCKET_PAGES = ['/pricing', '/your-money', '/documentation', '/documentation/claude', '/privacy', '/terms']

/** The app's catch-all for an address it has no page at (apps/web App.tsx). */
export const NOT_FOUND = 'Nothing at this address'

/** B56.3: what no public page says while investing is not offered, and the records Privacy names. */
const INVESTING = /investing is simulated|simulated portfolio|simulated order|no order reaches a market/i
export const PRIVACY_RECORDS = ['Verification.', 'Saved payees.', 'Invoices.', 'Mandates.', 'Payout details.', 'Currency accounts.']

/** B57.62: what /your-money must say — that LXC is not money, that a mandate needs the owner's signed say (B55.24), and
 *  that Talyvor is not a bank. */
export const YOUR_MONEY_LINES = ['LXC is not money, not a deposit and not an investment', 'every mandate needs your signed say', 'Talyvor is not a bank.']

/** B56.4: the one split sentence, at the take /api/pricing serves. */
export const splitSentence = (takeBps: number) =>
  `Sellers earn ${formatBPS(10_000 - takeBps)} of every paid use, rental and purchase, from the first sale; Talyvor keeps ${formatBPS(takeBps)}.`
const FIRST_MILLION = /first \$1 ?m(illion)?\b|100% of/i
const formatBPS = (bps: number) => `${(bps / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}%`

const FACEBOOK = 'connect.facebook.net'
const SETTLE_MS = 20_000

export interface PageRead {
  path: string
  /** The hrefs in the page's banner and its contentinfo, as written. */
  header: string[]
  footer: string[]
  text: string
  emailBox: boolean
  chooseButtons: string[]
  cookieBanner: boolean
  /** B56.10 — each Live or Sandbox chip the page draws: its state and the capability keys it labels. */
  labels?: { state: string; key: string }[]
  /** B57.63 — the design the page's title is held to (apps/web pocketPending.ts): "pocket", "today", or "" with no title. */
  design?: string
}

export interface SiteRead {
  signup: 'open' | 'closed' | 'unknown'
  /** /api/pricing's card_payments; undefined while Lens does not serve it. */
  cardPayments: string | undefined
  /** /api/pricing's fees.platform_fee_bps by plan; undefined while it serves no fees. */
  platformFeeBps?: Record<string, number>
  /** /api/pricing's fees.market_take_bps; undefined while it serves no fees. */
  marketTakeBps?: number
  /** /api/pricing's labels (B56.10); undefined while it serves none. */
  labels?: Record<string, string>
  pages: PageRead[]
  /** The text of Privacy's Cookies section; '' when there is none. */
  privacyCookies: string
  /** The public pages that asked connect.facebook.net for anything. */
  facebook: string[]
  /** Each GET route under "No key needed", asked of Lens with no key. */
  noKey: { path: string; status: number }[]
  /** Each link on a public page: its status, and whether it landed on the not-found page. */
  links: { page: string; href: string; status: number; notFound: boolean }[]
}

const hasLink = (hrefs: string[], want: string) => hrefs.some((h) => (want === 'mailto:' ? h.startsWith(want) : h === want))

/** The oracle: every way the site disagrees with the product, one line each. */
export function siteFaults(r: SiteRead): string[] {
  const wrong: string[] = []
  const page = (p: string) => r.pages.find((x) => x.path === p)

  for (const p of PUBLIC_PAGES) {
    const seen = page(p)
    if (seen === undefined) { wrong.push(`${p} was not read`); continue }
    const header = HEADER_LINKS.filter((h) => !hasLink(seen.header, h))
    const footer = FOOTER_LINKS.filter((h) => !hasLink(seen.footer, h))
    if (header.length > 0) wrong.push(`${p} lacks the shared header (no link to ${header.join(', ')})`)
    if (footer.length > 0) wrong.push(`${p} lacks the shared footer (no link to ${footer.join(', ')})`)
  }

  const marketing = page('/marketing')
  if (marketing !== undefined && r.signup === 'open') {
    if (marketing.emailBox) wrong.push('/marketing shows an email box while the BFF reports sign-up open')
    if (/place opens/i.test(marketing.text)) wrong.push('/marketing says "place opens" while the BFF reports sign-up open')
  }

  const pricing = page('/pricing')
  if (pricing !== undefined && r.cardPayments !== undefined && r.cardPayments !== 'live') {
    if (/Top up any amount/i.test(pricing.text)) wrong.push(`/pricing shows "Top up any amount" while card_payments is "${r.cardPayments}"`)
    if (pricing.chooseButtons.length > 0) wrong.push(`/pricing shows ${pricing.chooseButtons.join(', ')} while card_payments is "${r.cardPayments}"`)
  }

  if (pricing !== undefined) {
    // Enterprise's fee is agreed per contract, so the page says "agreed" in place of its served figure.
    for (const [id, bps] of Object.entries(r.platformFeeBps ?? {})) {
      if (id === 'enterprise') continue
      const rate = formatBPS(bps)
      if (!new RegExp(`\\b${id}\\s+${rate.replace('.', '\\.')}`, 'i').test(pricing.text)) wrong.push(`/pricing does not say ${id}'s platform fee is ${rate}, as /api/pricing serves it`)
    }
    for (const merged of ['Services and compute', 'SSO and audit export']) {
      if (pricing.text.toLowerCase().includes(merged.toLowerCase())) wrong.push(`/pricing still shows one "${merged}" row`)
    }
  }

  for (const p of r.pages) {
    const text = p.text.replace(/\s+/g, ' ')
    if (r.marketTakeBps !== undefined && ['/pricing', '/terms'].includes(p.path) && !text.includes(splitSentence(r.marketTakeBps)))
      wrong.push(`${p.path} does not say "${splitSentence(r.marketTakeBps)}"`)
    if (FIRST_MILLION.test(text)) wrong.push(`${p.path} offers a first-million tier`)
    if (['/terms', '/privacy', '/documentation'].includes(p.path) && INVESTING.test(p.text)) wrong.push(`${p.path} puts investing on a public page`)
    if (p.path === '/privacy') for (const name of PRIVACY_RECORDS) if (!p.text.includes(name)) wrong.push(`/privacy leaves out the "${name}" record`)
    if (p.path === '/your-money') for (const line of YOUR_MONEY_LINES) if (!text.includes(line)) wrong.push(`/your-money leaves out "${line}"`)
    if (p.design !== undefined && POCKET_PAGES.includes(p.path) && p.design !== 'pocket') wrong.push(`${p.path} is not drawn in Pocket`)
  }

  // B56.10: a chip says Live only where Lens says live for every capability it labels, and the money pages carry labels.
  for (const p of r.pages) {
    for (const l of p.labels ?? []) {
      if (l.state === 'live' && l.key.split(' ').some((k) => r.labels?.[k] !== 'live'))
        wrong.push(`${p.path} draws Live for ${l.key} while /api/pricing does not label it live`)
    }
    if (r.labels !== undefined && ['/marketing', '/pricing'].includes(p.path) && (p.labels ?? []).length === 0)
      wrong.push(`${p.path} draws no Live or Sandbox while /api/pricing serves labels`)
  }

  for (const n of r.noKey) if (n.status === 401) wrong.push(`${n.path}, under "No key needed" on /documentation, answers 401 without a key`)

  const saysNone = /no advertising or analytics cookies/i.test(r.privacyCookies)
  const saysBanner = /cookie banner/i.test(r.privacyCookies)
  const banners = r.pages.filter((p) => p.cookieBanner).map((p) => p.path)
  if (r.privacyCookies === '') wrong.push('/privacy has no Cookies section')
  else if (saysNone) {
    if (banners.length > 0) wrong.push(`Privacy says there are no cookies, and ${banners.join(', ')} show a cookie banner`)
    if (r.facebook.length > 0) wrong.push(`Privacy says there are no cookies, and ${r.facebook.join(', ')} asked ${FACEBOOK}`)
  } else if (saysBanner && banners.length === 0) wrong.push('Privacy describes a cookie banner that no public page shows')
  else if (!saysBanner) wrong.push(`Privacy's Cookies section says neither that there are none nor that a banner asks: "${r.privacyCookies.slice(0, 120)}"`)

  for (const l of r.links) {
    if (l.status === 404) wrong.push(`${l.page} links to ${l.href}, which answers 404`)
    else if (l.notFound) wrong.push(`${l.page} links to ${l.href}, which lands on the app's not-found page`)
  }
  return wrong
}

/** One public page, read as a stranger's browser renders it. */
async function readPage(page: Page, origin: string, path: string): Promise<PageRead> {
  await page.goto(origin + path)
  await page.getByRole('heading', { level: 1 }).first().waitFor({ timeout: SETTLE_MS }).catch(() => undefined)
  await page.waitForLoadState('networkidle', { timeout: SETTLE_MS }).catch(() => undefined)
  const hrefs = (role: 'banner' | 'contentinfo') => page.getByRole(role).first().locator('a[href]')
    .evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? '')).catch(() => [] as string[])
  return {
    path,
    header: await hrefs('banner'),
    footer: await hrefs('contentinfo'),
    text: await page.evaluate(() => document.body.innerText),
    emailBox: await page.locator('input[type="email"]').count() > 0 || await page.getByLabel('Email address').count() > 0,
    chooseButtons: (await page.getByRole('link', { name: /^Choose\b/ }).or(page.getByRole('button', { name: /^Choose\b/ })).allInnerTexts()).map((t) => t.trim()),
    cookieBanner: await page.getByRole('dialog', { name: 'Cookies' }).isVisible(),
    labels: await page.locator('[data-status-key][data-status-label="live"], [data-status-key][data-status-label="sandbox"]')
      .evaluateAll((els) => els.map((el) => ({ state: el.getAttribute('data-status-label') ?? '', key: el.getAttribute('data-status-key') ?? '' }))),
    design: await page.evaluate(() => document.querySelector('h1')?.closest('[data-design]')?.getAttribute('data-design') ?? ''),
  }
}

/** Every link on the public pages, as unique absolute addresses with the first page that carries each. */
async function linksOf(page: Page, origin: string, paths: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (const path of paths) {
    await page.goto(origin + path)
    await page.waitForLoadState('networkidle', { timeout: SETTLE_MS }).catch(() => undefined)
    for (const href of await page.locator('a[href]').evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href))) {
      if (!/^https?:/.test(href)) continue // mailto:, tel:
      const url = new URL(href)
      url.hash = ''
      if (!out.has(url.href)) out.set(url.href, path)
    }
  }
  return out
}

export function siteTruth(): Scenario {
  return {
    id: 'site-truth',
    owner: 'talyvor-suite',
    feature: 'Public site',
    items: ['B51.1', 'B51.4', 'B56.2', 'B56.3', 'B56.4', 'B56.10'],
    title: 'the public pages, read signed out, agree with the product: no waitlist while sign-up is open, no top-up or Choose while card payments are not live, each plan\'s served platform fee on /pricing, the 85/15 split from the first sale on /pricing and /terms, Live only where Lens labels the money live, no investing and every wallet record on the legal pages, ' +
      '"No key needed" routes answer without a key, Privacy\'s Cookies section matches the pages, the shared header and footer, and no link to a 404 or the not-found page',
    run: async (ctx) => {
      const browser = ctx.app.context.browser()
      if (browser === null) throw new CannotTest('no browser to open a signed-out context in')
      const origin = new URL(ctx.app.page.url()).origin
      const stranger: BrowserContext = await browser.newContext()
      const facebook = new Set<string>()
      let at = ''
      stranger.on('request', (req) => { if (new URL(req.url()).hostname === FACEBOOK) facebook.add(at) })
      try {
        const me = await stranger.request.get(`${origin}/auth/me`)
        const meBody = (await me.json().catch(() => null)) as { signup_open?: boolean | null } | null
        const signup = typeof meBody?.signup_open === 'boolean' ? (meBody.signup_open ? 'open' : 'closed') : 'unknown'
        const priced = await stranger.request.get(`${origin}/api/pricing`)
        const served = (await priced.json().catch(() => null)) as { card_payments?: string; fees?: { platform_fee_bps?: Record<string, number>; market_take_bps?: number }; labels?: Record<string, string> } | null
        const cardPayments = served?.card_payments
        const platformFeeBps = served?.fees?.platform_fee_bps
        const marketTakeBps = served?.fees?.market_take_bps
        const labels = served?.labels
        ctx.evidence.push({ note: `/auth/me ${me.status()}: sign-up ${signup}; /api/pricing ${priced.status()}: card_payments ${cardPayments ?? 'not served yet (B51.2)'}` })

        const page = await stranger.newPage()
        const pages: PageRead[] = []
        for (const path of PUBLIC_PAGES) {
          at = path
          pages.push(await readPage(page, origin, path))
        }
        await page.goto(origin + '/privacy')
        const privacyCookies = await page.getByRole('heading', { level: 2, name: 'Cookies' }).locator('xpath=ancestor::section[1]')
          .innerText({ timeout: SETTLE_MS }).catch(() => '')

        await page.goto(origin + '/documentation')
        const listed = await page.locator('#lens-public tbody tr').evaluateAll((rows) =>
          rows.map((tr) => Array.from(tr.querySelectorAll('td')).map((td) => td.textContent?.trim() ?? '')))
        const noKey: SiteRead['noKey'] = []
        for (const [method, path] of listed) {
          if (method !== 'GET' || path.includes('{')) continue
          const got = await ctx.env.lens.as('', 'GET', path)
          noKey.push({ path, status: got.status })
        }
        ctx.evidence.push({ note: `"No key needed": ${noKey.map((n) => `${n.path} ${n.status}`).join(', ') || 'no routes listed'}` })

        const status = await ctx.env.lens.as('', 'GET', '/status.json')
        let rails: { name: string; mode: string; status: string }[] = []
        try { rails = (JSON.parse(status.text) as { rails?: typeof rails | null }).rails ?? [] } catch { /* not JSON: the evidence says so */ }
        ctx.evidence.push({ note: `/status.json ${status.status} rails: ${rails.map((r) => `${r.name} ${r.mode} ${r.status}`).join(', ') || 'none'}` })

        // Every link: GET from outside, then an address of the app's own opened in this user's tab, where the not-found page shows.
        const links: SiteRead['links'] = []
        const own = await ctx.app.context.newPage()
        try {
          for (const [href, from] of await linksOf(page, origin, PUBLIC_PAGES)) {
            const got = await stranger.request.get(href, { timeout: SETTLE_MS, maxRedirects: 5 }).catch(() => undefined)
            let notFound = false
            const url = new URL(href)
            if (url.origin === origin && !/^\/(api|auth|brand)\//.test(url.pathname)) {
              await own.goto(href)
              await own.waitForLoadState('networkidle', { timeout: SETTLE_MS }).catch(() => undefined)
              notFound = (await own.evaluate(() => document.body.innerText)).includes(NOT_FOUND)
            }
            links.push({ page: from, href, status: got?.status() ?? 0, notFound })
          }
        } finally {
          await own.close()
        }
        const unreached = links.filter((l) => l.status === 0).map((l) => l.href)
        ctx.evidence.push({ note: `${links.length} links followed${unreached.length > 0 ? `; no answer from ${unreached.join(', ')}` : ''}` })

        const wrong = siteFaults({ signup, cardPayments, platformFeeBps, marketTakeBps, labels, pages, privacyCookies, facebook: [...facebook], noKey, links })
        return wrong.length === 0
          ? { pass: true, detail: `${PUBLIC_PAGES.length} public pages agree with the product (sign-up ${signup}, card_payments ${cardPayments ?? 'not served'}); ` +
              `${noKey.length} "No key needed" routes answer without a key; ${links.length} links land` }
          : { pass: false, detail: wrong.join(' | ') }
      } finally {
        await stranger.close()
      }
    },
  }
}
