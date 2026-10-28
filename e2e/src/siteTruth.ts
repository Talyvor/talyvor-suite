// B51.4 — THE LIVE SITE AGAINST THE LIVE PRODUCT, EVERY NIGHT. Signed out and GET only, the public pages as a browser renders
// them, held to what the product itself answers: the sign-up state the BFF reports (/auth/me), card_payments in /api/pricing
// (once Lens serves it, B51.2) and Lens's /status.json rails. It fails on any disagreement:
//   /marketing shows an email box or "place opens" while sign-up is open;
//   /pricing shows "Top up any amount" or a Choose button while card_payments is there and not "live";
//   a route under "No key needed" on /documentation answers 401 to a caller with no key;
//   Privacy's Cookies section disagrees with the pages: a cookie banner or a request to connect.facebook.net while it says
//     there are none, or no banner on any page while it describes one;
//   a public page without the shared header and footer (B51.1);
//   a link on a public page that answers 404, or lands on the app's not-found page.
// Where a link lands is read in this user's own signed-in tab, since a stranger is shown sign-in at every console address.

import type { BrowserContext, Page } from 'playwright'
import type { Scenario } from './scenarios.ts'
import { CannotTest } from './scenarios.ts'

export const PUBLIC_PAGES = ['/marketing', '/pricing', '/documentation', '/documentation/claude', '/privacy', '/terms'] as const

/** B51.1's one header and one footer: the addresses each must link to. */
export const HEADER_LINKS = ['/marketing', '/pricing', '/documentation', '/', '/signup']
export const FOOTER_LINKS = ['/privacy', '/terms', '/pricing', '/documentation', 'mailto:']

/** The app's catch-all for an address it has no page at (apps/web App.tsx). */
export const NOT_FOUND = 'Nothing at this address'

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
}

export interface SiteRead {
  signup: 'open' | 'closed' | 'unknown'
  /** /api/pricing's card_payments; undefined while Lens does not serve it. */
  cardPayments: string | undefined
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
    items: ['B51.1', 'B51.4'],
    title: 'the public pages, read signed out, agree with the product: no waitlist while sign-up is open, no top-up or Choose while card payments are not live, ' +
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
        const cardPayments = ((await priced.json().catch(() => null)) as { card_payments?: string } | null)?.card_payments
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

        const wrong = siteFaults({ signup, cardPayments, pages, privacyCookies, facebook: [...facebook], noKey, links })
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
