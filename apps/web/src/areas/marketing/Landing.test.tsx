import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CONTACT_EMAIL, Landing } from './Landing'
import { COMPANY_CONTACT, COMPANY_LINE } from '../../company'

// Area-owned test. Kept from the scaffold contract: the landing renders with NO providers — no auth gate, no query
// client, no router — because it is a public page. B64.1: the page is version 4 (design/website-2026-11-17-v4,
// Nick approved 17 Nov 2026), so what is pinned here is that page's words and the rules FOR-V7.md section 3 keeps on.

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** What a visitor reads: the page without its <style>. */
function pageText(container: HTMLElement): string {
  const page = container.cloneNode(true) as HTMLElement
  page.querySelectorAll('style').forEach((s) => s.remove())
  return page.textContent ?? ''
}

describe('Landing', () => {
  it('renders standalone — no router, no providers — under version 4’s one headline', () => {
    render(<Landing />)
    const h1 = screen.getAllByRole('heading', { level: 1 })
    expect(h1).toHaveLength(1)
    expect(h1[0]).toHaveTextContent('Your AI agent wants your card.Give it its own.')
  })

  it('draws index.html section by section, each under its own heading', () => {
    render(<Landing />)
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Stop lending your agent your card.',
      'Agent money shouldn’t need a manual.',
      'One minute. The whole app.',
      'Press it. You’ll get it in ten seconds.',
      'Your shopping agent. Your company’s agent army.',
      'Claude does the legwork. You keep the final say.',
      'They built it for engineers. We built it for you.',
      'Start free. Seriously.',
      'Built. Running. Moving fast.',
      'Your move.',
    ])
  })

  it('says no LXC, never that Talyvor is or is not a bank, and none of the words FOR-V7.md keeps off the page', () => {
    const { container } = render(<Landing />)
    const text = pageText(container)
    expect(text).not.toMatch(/LXC/)
    expect(text).not.toMatch(/not a bank/i)
    expect(text).not.toMatch(/\bbank\b|licensed partners|coming soon|ChatGPT/i)
  })

  it('sends every Open your account and Open an account to /signup', () => {
    render(<Landing />)
    const ctas = screen.getAllByRole('link', { name: /open (your|an) account/i })
    expect(ctas).toHaveLength(4)
    for (const a of ctas) expect(a).toHaveAttribute('href', '/signup')
  })

  it('keeps the Sandbox label in the demo and the "Where we are" block, and says real money is next, not live', () => {
    const { container } = render(<Landing />)
    expect(within(container.querySelector<HTMLElement>('#try')!).getByText('Sandbox')).toBeInTheDocument()
    expect(screen.getByText('Sandbox today')).toBeInTheDocument()
    expect(screen.getByText('It switches on with our launch partner, and early users go first.')).toBeInTheDocument()
  })

  // B17.498 — the site-truth scenario reads every public page's banner and contentinfo for the site's one header and
  // footer (B51.1): these are the addresses it looks for.
  it('carries the site’s one header and one footer', () => {
    render(<Landing />)
    const hrefs = (el: HTMLElement) => within(el).getAllByRole('link').map((a) => a.getAttribute('href'))
    const header = hrefs(screen.getByRole('banner'))
    for (const h of ['/marketing', '/pricing', '/your-money', '/documentation', '/']) expect(header).toContain(h)
    const footer = hrefs(screen.getByRole('contentinfo'))
    for (const h of ['/pricing', '/your-money', '/documentation', '/privacy', '/terms', `mailto:${COMPANY_CONTACT}`]) expect(footer).toContain(h)
  })

  it('offers the company address and line, the policies, and the AI Agents Directory badge as they give it', () => {
    render(<Landing />)
    expect(CONTACT_EMAIL).toBe(COMPANY_CONTACT)
    expect(screen.getByText(CONTACT_EMAIL, { selector: 'p' })).toBeInTheDocument()
    const footer = screen.getByRole('contentinfo')
    expect(within(footer).getByText(COMPANY_LINE)).toBeInTheDocument()
    expect(within(footer).getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy')
    expect(within(footer).getByRole('link', { name: 'Terms' })).toHaveAttribute('href', '/terms')
    const badge = within(footer).getByRole('link', { name: 'Talyvor - Featured on AI Agents Directory' })
    expect(badge).toHaveAttribute('href', 'https://aiagentsdirectory.com/agent/talyvor')
    expect(badge).toHaveAttribute('target', '_blank')
    expect(badge).toHaveAttribute('rel', 'noopener')
    expect(badge).toHaveAttribute('title', 'Discover Talyvor on AI Agents Directory')
  })

  it('carries the AI Agents Directory snippet in the bytes their crawler reads, before any script runs', () => {
    // B64.6: the listing goes live when their crawler finds the snippet on talyvor.com, and a crawler reads
    // index.html and never runs the bundle, so the footer above is invisible to it.
    const doc = new DOMParser().parseFromString(readFileSync(resolve(__dirname, '../../../index.html'), 'utf8'), 'text/html')
    const noscript = doc.body.querySelector('noscript')
    expect(noscript, 'index.html has no <noscript> in its body').not.toBeNull()
    // A parser with scripting off reads <noscript> as markup; one with scripting on, as text. Accept either.
    const a = (noscript!.querySelector('a') ??
      new DOMParser().parseFromString(noscript!.textContent ?? '', 'text/html').querySelector('a'))!
    expect(a.getAttribute('href')).toBe('https://aiagentsdirectory.com/agent/talyvor')
    expect(a.getAttribute('target')).toBe('_blank')
    expect(a.getAttribute('rel')).toBe('noopener')
    expect(a.getAttribute('title')).toBe('Discover Talyvor on AI Agents Directory')
    const img = a.querySelector('img')!
    expect(img.getAttribute('src')).toBe('https://aiagentsdirectory.com/featured-badge.svg?v=2024')
    expect(img.getAttribute('alt')).toBe('Talyvor - Featured on AI Agents Directory')
    expect([img.getAttribute('width'), img.getAttribute('height')]).toEqual(['200', '50'])
  })

  // B64.11 — the header's logo is 150 px (128 and 120 on small screens) and the footer's 120 px, all under 240, so they
  // are the kit's small-logo PNGs on the night ground, the 240 px file at 1x and the 480 px file at 2x, never the SVG.
  it('shows the kit’s small-logo PNGs in the header and footer, 1x and 2x, never under 120 px', () => {
    const { container } = render(<Landing />)
    for (const img of [container.querySelector('.nav .logo img')!, container.querySelector('footer img')!]) {
      expect(img.getAttribute('src')).toBe('/brand/logo/talyvor-logo-small-on-dark-240.png')
      expect(img.getAttribute('srcset')).toBe('/brand/logo/talyvor-logo-small-on-dark-240.png 1x, /brand/logo/talyvor-logo-small-on-dark-480.png 2x')
      expect(img.getAttribute('alt')).toBe('Talyvor')
    }
    expect([...container.querySelectorAll('img')].filter((i) => /logo.*\.svg/.test(i.getAttribute('src') ?? ''))).toEqual([])
    const site = readFileSync(resolve(__dirname, './site.css'), 'utf8')
    const widths = [...site.matchAll(/\.tv4 (?:\.nav \.logo|footer) img \{[^}]*width: (\d+)px/g)].map((m) => Number(m[1]))
    expect(widths).toEqual([150, 128, 120, 120])
  })

  it('serves every film, poster and picture it names from the app’s own /site', () => {
    const { container } = render(<Landing />)
    const urls = [...container.querySelectorAll('video, img')].flatMap((el) =>
      ['src', 'poster', 'data-src', 'data-small'].map((a) => el.getAttribute(a)).filter((v): v is string => !!v),
    )
    expect(urls.length).toBeGreaterThanOrEqual(13)
    // B64.11: the logo is the app's own small-logo PNG from /brand/logo.
    const missing = urls.filter((u) => !/^\/(site|brand\/logo)\//.test(u) || !existsSync(resolve(__dirname, '../../../public', u.slice(1))))
    expect(missing).toEqual([])
  })

  // B64.5: index.html in the design folder loads both faces from Google Fonts; the page sets them from the app's own
  // files instead. What /marketing can request is index.html, the CSS main.tsx and the page pull in (site.css is read
  // from disk: its ?raw import arrives empty under vitest), and every address the rendered page names.
  it('sets its words in the app’s own Figtree and Bricolage Grotesque, and asks Google Fonts for nothing', () => {
    const { container } = render(<Landing />)
    const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf8')
    const theme = read('../../../../../packages/ui/src/theme.css')
    const site = read('./site.css')
    const requested = [
      read('../../../index.html'),
      theme,
      read('../../styles.css'),
      site,
      ...[...container.querySelectorAll('*')].flatMap((el) =>
        ['src', 'href', 'poster', 'srcset', 'data-src', 'data-small', 'style'].map((a) => el.getAttribute(a) ?? ''),
      ),
    ]
    expect(requested.filter((r) => /fonts\.(googleapis|gstatic)\.com/.test(r))).toEqual([])

    expect(site).toMatch(/--display: "Bricolage Grotesque", "Figtree",/)
    expect(site).toMatch(/--ui: "Figtree",/)
    for (const face of ['Bricolage Grotesque', 'Figtree']) {
      const files = [...theme.matchAll(/@font-face \{[^}]*font-family: '([^']+)'[^}]*url\('\.\/([^']+)'\)/g)]
        .filter((m) => m[1] === face)
        .map((m) => m[2])
      expect(files.length, face).toBeGreaterThan(0)
      expect(files.filter((f) => !existsSync(resolve(__dirname, '../../../../../packages/ui/src', f))), face).toEqual([])
    }
  })

  // B64.4 — the BFF caches /site for a year, so a file there is never changed under its name: its name carries the
  // first eight hex of its own sha256, and a new cut of a film is a new name. index.html preloads the hero's poster.
  it('names every file in /site by its own content, and preloads the poster the hero draws', () => {
    const dir = resolve(__dirname, '../../../public/site')
    const wrong = readdirSync(dir).filter((f) => {
      const m = /^[a-z0-9-]+\.([0-9a-f]{8})\.[a-z0-9]+$/.exec(f)
      return !m || createHash('sha256').update(readFileSync(resolve(dir, f))).digest('hex').slice(0, 8) !== m[1]
    })
    expect(wrong).toEqual([])
    const { container } = render(<Landing />)
    const poster = container.querySelector('.hero video.film')!.getAttribute('poster')!
    expect(readFileSync(resolve(__dirname, '../../../index.html'), 'utf8')).toContain(`l.href = '${poster}'`)
  })
})

// B64.4 — each loop is fetched whole and plays from a blob, so it never stalls mid-film: hero, phone, robot, one at a
// time, the 720 cut below 768 px. A fetch that fails falls back to the file's own URL.
describe('the loops', () => {
  const loops = (c: HTMLElement) => [...c.querySelectorAll<HTMLVideoElement>('video[data-loop]')]
  const withBlobs = () => {
    let n = 0
    Object.assign(URL, { createObjectURL: vi.fn(() => `blob:loop-${++n}`), revokeObjectURL: vi.fn() })
  }
  afterEach(() => {
    vi.unstubAllGlobals()
    delete (URL as { createObjectURL?: unknown }).createObjectURL
    delete (URL as { revokeObjectURL?: unknown }).revokeObjectURL
  })

  it('fetches each in full, in page order, one at a time, and plays it from a blob (720 on a phone)', async () => {
    const fetched: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (u: string) => (u.startsWith('/site/') && fetched.push(u), new Response('film'))))
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q }))
    withBlobs()
    const { container } = render(<Landing />)
    const [hero, phone, robot] = loops(container)
    await vi.waitFor(() => expect(hero.getAttribute('src')).toBe('blob:loop-1'))
    expect(fetched).toEqual([hero.dataset.small])
    act(() => void hero.dispatchEvent(new Event('canplaythrough')))
    await vi.waitFor(() => expect(phone.getAttribute('src')).toBe('blob:loop-2'))
    expect(fetched).toEqual([hero.dataset.small, phone.dataset.src])
    act(() => void phone.dispatchEvent(new Event('canplaythrough')))
    await vi.waitFor(() => expect(robot.getAttribute('src')).toBe('blob:loop-3'))
    expect(fetched).toEqual([hero.dataset.small, phone.dataset.src, robot.dataset.small])
    expect(hero.dataset.small).toMatch(/-720\.[0-9a-f]{8}\.mp4$/)
  })

  it('falls back to the file URL when the fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })))
    withBlobs()
    const { container } = render(<Landing />)
    const [hero] = loops(container)
    await vi.waitFor(() => expect(hero.getAttribute('src')).toBe(hero.dataset.src))
    expect(hero.dataset.src).toMatch(/-1080\.[0-9a-f]{8}\.mp4$/)
  })
})

describe('Try Penny', () => {
  it('pays inside the rules on its own, asks above the line, and lands what you approve on the statement', () => {
    vi.useFakeTimers()
    const { container } = render(<Landing />)
    const tryIt = container.querySelector<HTMLElement>('#try')!
    fireEvent.click(within(tryIt).getByRole('button', { name: /Acme Hosting/ }))
    expect(within(tryIt).getByText('Paid on its own')).toBeInTheDocument()

    fireEvent.click(within(tryIt).getByRole('button', { name: /Northwind Data/ }))
    const sheet = screen.getByRole('dialog', { hidden: true })
    expect(sheet).toHaveClass('on')
    expect(within(sheet).getByText('Above your $50 line')).toBeInTheDocument()
    expect(document.documentElement.style.overflowY).toBe('hidden')

    fireEvent.click(within(sheet).getByRole('button', { name: 'Approve with Face ID' }))
    act(() => void vi.runAllTimers())
    expect(sheet).not.toHaveClass('on')
    expect(document.documentElement.style.overflowY).toBe('')
    expect(within(tryIt).getByText('You approved')).toBeInTheDocument()
    expect(within(tryIt).getByText('$186.00')).toBeInTheDocument()

    fireEvent.click(within(tryIt).getByRole('button', { name: /Brightline Leads/ }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(sheet).not.toHaveClass('on')
    expect(within(tryIt).getByText('You declined')).toBeInTheDocument()
  })
})

describe('Smooth, and kept that way (B64.7)', () => {
  it('locks page scroll under the approval sheet and gives back the page’s own no-sideways-scroll rule when it closes', () => {
    const { container } = render(<Landing />)
    const html = document.documentElement
    expect(html.style.overflowX).toBe('clip')
    fireEvent.click(within(container.querySelector<HTMLElement>('#try')!).getByRole('button', { name: /Brightline Leads/ }))
    expect(html.style.overflowY).toBe('hidden')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByRole('dialog', { hidden: true })).not.toHaveClass('on')
    expect(html.style.overflowY).toBe('')
    expect(html.style.overflowX).toBe('clip')
  })

  it('stops every film the moment reduced motion is switched on, back on its first frame, and runs the loops again when it is off', async () => {
    let reduce = false
    const listeners = new Set<() => void>()
    vi.stubGlobal('matchMedia', (q: string) => ({
      get matches() {
        return q.includes('reduced-motion') ? reduce : false
      },
      media: q,
      addEventListener: (_: string, f: () => void) => q.includes('reduced-motion') && listeners.add(f),
      removeEventListener: (_: string, f: () => void) => listeners.delete(f),
    }))
    const playing = new Set<HTMLMediaElement>()
    vi.spyOn(HTMLMediaElement.prototype, 'readyState', 'get').mockReturnValue(4)
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) {
      playing.add(this)
      return Promise.resolve()
    })
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (this: HTMLMediaElement) {
      playing.delete(this)
    })
    const { container } = render(<Landing />)
    const loops = [...container.querySelectorAll('video[data-loop]')]
    expect(loops).toHaveLength(3)
    await act(async () => {})
    expect(loops.filter((v) => playing.has(v as HTMLMediaElement))).toHaveLength(3)

    const how = container.querySelector<HTMLVideoElement>('#howvid')!
    playing.add(how)
    loops.forEach((v) => ((v as HTMLMediaElement).currentTime = 2))
    reduce = true
    act(() => listeners.forEach((f) => f()))
    expect(playing.size).toBe(0)
    expect(loops.map((v) => (v as HTMLMediaElement).currentTime)).toEqual([0, 0, 0])

    reduce = false
    act(() => listeners.forEach((f) => f()))
    expect(loops.filter((v) => playing.has(v as HTMLMediaElement))).toHaveLength(3)
    vi.unstubAllGlobals()
  })
})

describe('Pricing on the page', () => {
  // B64.3: the plans are Lens's two ladders, read through GET /api/pricing as /pricing reads them, so the two pages
  // cannot drift. Every figure here differs from Nick's 15 Nov plans: only a page that follows the plan table prints them.
  const ladders = {
    currencies: ['GBP', 'EUR', 'USD'],
    stablecoin_priced_in: 'USD',
    personal: [
      { id: 'personal_solo', name: 'Solo', price_minor: { GBP: 0, EUR: 0, USD: 0 }, agents: 4, people: 1 },
      { id: 'personal_crew', name: 'Crew', price_minor: { GBP: 412, EUR: 433, USD: 455 }, agents: 11, people: 1 },
      { id: 'personal_fleet', name: 'Fleet', price_minor: { GBP: 812, EUR: 913, USD: 1014 }, agents: 27, people: 1 },
    ],
    business: [
      { id: 'business_studio', name: 'Studio', price_minor: { GBP: 1100, EUR: 1150, USD: 1200 }, agents: 4, people: 2 },
      { id: 'business_company', name: 'Company', price_minor: { GBP: 3600, EUR: 3600, USD: 3600 }, agents: 26, people: 6 },
      { id: 'business_group', name: 'Group', price_minor: { GBP: 12600, EUR: 12700, USD: 12800 }, agents: -1, people: 24 },
      { id: 'business_custom', name: 'Custom', price_minor: null, by_contract: true, agents: -1, people: -1 },
    ],
  }
  function serve(labels?: Record<string, string>) {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (String(input) !== '/api/pricing') return new Response('null', { status: 404 })
      return new Response(JSON.stringify({ min_usd_cents: 0, max_usd_cents: 0, preset_usd_cents: [], ladders, labels }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
  }
  const cards = (container: HTMLElement) =>
    [...container.querySelectorAll('#plans .pc')].map((c) => [...c.childNodes].map((n) => n.textContent).join(' | '))

  it('draws the plan table it is served, in three currencies with dollars first', async () => {
    serve()
    const { container } = render(<Landing />)
    await waitFor(() => expect(container.querySelectorAll('#plans .pc')).toHaveLength(3))
    const currency = within(screen.getByRole('group', { name: 'Currency' })).getAllByRole('button')
    expect(currency.map((b) => b.textContent)).toEqual(['$', '£', '€'])
    expect(currency[0]).toHaveAttribute('aria-pressed', 'true')
    expect(cards(container)).toEqual([
      'Solo | Free | 4 agentsYour own accountA card for every agent',
      'Crew | $4.55 a month | 11 agentsEverything in Solo',
      'Fleet | $10.14 a month | 27 agentsEverything in Crew',
    ])
    fireEvent.click(screen.getByRole('button', { name: '£' }))
    expect(cards(container)[2]).toBe('Fleet | £8.12 a month | 27 agentsEverything in Crew')
    fireEvent.click(screen.getByRole('button', { name: '€' }))
    expect(cards(container)[1]).toBe('Crew | €4.33 a month | 11 agentsEverything in Solo')
    fireEvent.click(screen.getByRole('button', { name: 'For companies' }))
    expect(cards(container)).toEqual([
      'Studio | €11.50 a month | 4 agents2 peopleA statement for every agent',
      'Company | €36 a month | 26 agents6 peopleEverything in Studio',
      'Group | €127 a month | Unlimited agents24 peopleEverything in Company',
      `Custom | Let’s talk | Built with youBy contract${CONTACT_EMAIL}`,
    ])
  })

  it('says every plan costs nothing only while spending on Talyvor is Sandbox', async () => {
    const line = 'While you’re in Sandbox, every plan costs nothing.'
    serve({ spend_on_talyvor: 'sandbox' })
    const sandbox = render(<Landing />)
    await waitFor(() => expect(sandbox.container.querySelectorAll('#plans .pc')).toHaveLength(3))
    expect(sandbox.container.querySelector('.price .lede')).toHaveTextContent(
      `Three plans for people, three for companies, and one we build with you. ${line}`,
    )
    cleanup()
    vi.restoreAllMocks()
    serve({ spend_on_talyvor: 'live' })
    const live = render(<Landing />)
    await waitFor(() => expect(live.container.querySelectorAll('#plans .pc')).toHaveLength(3))
    expect(live.container.querySelector('.price .lede')).toHaveTextContent(
      /^Three plans for people, three for companies, and one we build with you\.$/,
    )
  })

  it('labels the plans Live or Sandbox as Lens labels spending on Talyvor, and not at all while it serves no label', async () => {
    serve({ spend_on_talyvor: 'sandbox' })
    const sandbox = render(<Landing />)
    await waitFor(() => expect(sandbox.container.querySelector('#pricing [data-status-label]')).not.toBeNull())
    const chip = sandbox.container.querySelector('#pricing [data-status-label]')!
    expect(chip).toHaveAttribute('data-status-label', 'sandbox')
    expect(chip).toHaveAttribute('data-status-key', 'spend_on_talyvor')
    expect(chip).toHaveTextContent('Sandbox')
    cleanup()
    vi.restoreAllMocks()
    serve()
    const none = render(<Landing />)
    await waitFor(() => expect(none.container.querySelectorAll('#plans .pc')).toHaveLength(3))
    expect(none.container.querySelector('[data-status-label]')).toBeNull()
  })

  it('types no price into the page source', () => {
    const source = readFileSync(resolve(__dirname, 'Landing.tsx'), 'utf8')
    expect(source).not.toMatch(/\b(3|7|8|9)\.99\b/)
    expect(source).not.toMatch(/\b(usd|gbp|eur)\s*:\s*\d/)
  })
})

describe('Orange boxes', () => {
  // B64.9: the box's own line-height pushes its line down, so the g, y, p and comma above never dip under it.
  // scripts/pillcheck.mjs measures that at 14 widths on the built page; this keeps the rule it measured.
  it('keeps line-height 1.4 on .pill', () => {
    const css = readFileSync(resolve(__dirname, 'site.css'), 'utf8')
    expect(css).toMatch(/\.tv4 \.pill \{[^}]*line-height: 1\.4;/)
  })
})

describe('The logo', () => {
  // B17.497 — the brand-visual scenario counts a logo only as svg[data-brand] or img[data-brand="logo"] drawing a
  // logo file; the nav and the footer draw the kit's small logo (B64.11), so both carry the attribute.
  it('marks the nav and footer logo as the brand logo, a file that is served', () => {
    const { container } = render(<Landing />)
    const logos = Array.from(container.querySelectorAll<HTMLImageElement>('img[data-brand="logo"]'))
    expect(logos.map((i) => i.closest('nav, footer')?.tagName)).toEqual(['NAV', 'FOOTER'])
    for (const img of logos) {
      const path = new URL(img.src, 'https://talyvor.com').pathname
      expect(path).toMatch(/^\/brand\/logo\/talyvor-logo-small-on-dark-240\.png$/)
      expect(existsSync(resolve(__dirname, '../../../public', path.slice(1)))).toBe(true)
    }
  })
})
