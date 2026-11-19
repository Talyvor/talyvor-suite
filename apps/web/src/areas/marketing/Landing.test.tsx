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

  it('serves every film, poster and picture it names from the app’s own /site', () => {
    const { container } = render(<Landing />)
    const urls = [...container.querySelectorAll('video, img')].flatMap((el) =>
      ['src', 'poster', 'data-src', 'data-small'].map((a) => el.getAttribute(a)).filter((v): v is string => !!v),
    )
    expect(urls.length).toBeGreaterThanOrEqual(13)
    const missing = urls.filter((u) => !u.startsWith('/site/') || !existsSync(resolve(__dirname, '../../../public', u.slice(1))))
    expect(missing).toEqual([])
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
    expect(document.documentElement.style.overflow).toBe('hidden')

    fireEvent.click(within(sheet).getByRole('button', { name: 'Approve with Face ID' }))
    act(() => void vi.runAllTimers())
    expect(sheet).not.toHaveClass('on')
    expect(document.documentElement.style.overflow).toBe('')
    expect(within(tryIt).getByText('You approved')).toBeInTheDocument()
    expect(within(tryIt).getByText('$186.00')).toBeInTheDocument()

    fireEvent.click(within(tryIt).getByRole('button', { name: /Brightline Leads/ }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(sheet).not.toHaveClass('on')
    expect(within(tryIt).getByText('You declined')).toBeInTheDocument()
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

  it('types no price into the page source', () => {
    const source = readFileSync(resolve(__dirname, 'Landing.tsx'), 'utf8')
    expect(source).not.toMatch(/\b(3|7|8|9)\.99\b/)
    expect(source).not.toMatch(/\b(usd|gbp|eur)\s*:\s*\d/)
  })
})
