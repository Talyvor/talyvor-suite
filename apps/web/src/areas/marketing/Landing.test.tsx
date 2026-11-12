import { cleanup, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CONTACT_EMAIL, Landing } from './Landing'
import { ON_ITS_WAY, POSITIONING_SENTENCES } from '../../positioning'
import { COMPANY_CONTACT } from '../../company'
import { BUILDING } from '../../labels/StatusLabel'
import { WALLETS } from '../../labels/capabilities'

// Area-owned test — replaces the deleted shared areas/scaffold.test.tsx (the
// deadlock: a shared test over per-area screens; see #7). The marketing tab
// owns this file with its screen. Kept from the scaffold contract: the landing
// renders with NO providers — no auth gate, no query client, no router —
// because it is a public page. Added on top: the page's honesty invariants
// (no unmeasured numbers) and the flagged contact wiring.

afterEach(cleanup)

describe('Landing', () => {
  it('renders standalone — no router, no providers — with exactly one Talyvor heading', () => {
    render(<Landing />)
    // One heading names the product; keeping it unique keeps every
    // getByRole('heading', { name: /talyvor/i }) consumer unambiguous.
    const headings = screen.getAllByRole('heading')
    expect(headings.filter((h) => /talyvor/i.test(h.textContent ?? ''))).toHaveLength(1)
  })

  it('keeps the single "Open the app" link pointing at the console', () => {
    render(<Landing />)
    expect(screen.getByRole('link', { name: /open the app/i })).toHaveAttribute('href', '/')
  })

  // B51.1: every public footer names the company's address, so the page offers it rather than saying there is no inbox.
  it('offers the company address and never says there is no inbox', () => {
    expect(CONTACT_EMAIL).toBe(COMPANY_CONTACT)
    render(<Landing />)
    const mailtos = screen.getAllByRole('link').filter((a) => a.getAttribute('href')?.startsWith('mailto:'))
    expect(mailtos.length).toBeGreaterThan(0)
    for (const a of mailtos) expect(a).toHaveAttribute('href', `mailto:${COMPANY_CONTACT}`)
    expect(screen.queryByText(/no inbox/)).toBeNull()
  })

  // B28.2: a percentage on this page would be an unmeasured claim. The one measured one, the pooled discount, left with
  // pooling (B59.5), so none is printed.
  it('prints no percentage', () => {
    const { container } = render(<Landing />)
    // The page's own <style> block (B29.4's photo scrim and crops) is CSS, not copy a visitor reads.
    const page = container.cloneNode(true) as HTMLElement
    page.querySelectorAll('style').forEach((s) => s.remove())
    const percents = new Set(page.textContent?.match(/\d+%/g) ?? [])
    expect([...percents]).toEqual([])
  })

  // ─────────────────────────────────────────────────────────────────────────
  // CHECKABLE CLAIMS. This page went live making four statements that source
  // does not support. Each assertion below names the string and the reason —
  // a test that only checked "the page renders" would pass on any wording.
  // ─────────────────────────────────────────────────────────────────────────

  // ⚠ THE REASON THIS ASSERTION USED TO CARRY IS FALSE, AND THIS ASSERTION COULD NOT HAVE TOLD
  // ANYONE. It read "Docs tags its own Lens calls by FEATURE (docs-ai-write / docs-ai-summarize)
  // and never by page, so no per-page attribution exists to report" — measured against
  // talyvor-docs `63b7ea6` that is no longer true (migration 0018's page_ai_spend_events ledger,
  // pages.own_ai_cost_usd, and cmd/docs/main.go's WithSpendBinder wiring; Landing.tsx carries the
  // three commands). The assertion below is an ABSENCE test on THIS page's text: it is green for
  // every possible state of the upstream, so no amount of drift over there can red it. That is not
  // a flaw to fix here — a claim guard's job is to hold the page — it is the reason the premise now
  // lives in deploy/decision-expiry.sh's uncheckable half, where a deployer is told to run it in a
  // talyvor-docs checkout. Read the register entry, not this comment, for the live premise.
  //
  // WHAT KEEPS THE SENTENCE OFF THE PAGE TODAY: the claim is the enumeration "an issue, a document
  // or a change" and the change half has no surface at all (the assertion two below), and
  // own_ai_cost_usd is a documented LOWER BOUND — docs-ai-ask and docs-search have no single page
  // and are excluded by design. Restoring the sentence is a claim decision, not a session's.
  it('does not claim a per-document cost, whose upstream number is a lower bound', () => {
    const { container } = render(<Landing />)
    expect(container.textContent ?? '').not.toMatch(/cost of (an issue, )?a document/i)
  })

  // ⚠ Code has no surface in this app at all — no route in App.tsx, no proxy in the BFF — so
  // there is no "cost of a change" a reader could go and look at.
  // The live wording is "the cost of an issue, a document or a change", so a literal
  // /cost of a change/ never appears and would pass without the page changing at all. The
  // assertion has to name the enumeration that actually makes the claim.
  it('does not claim a per-change cost, which has no surface', () => {
    const { container } = render(<Landing />)
    expect(container.textContent ?? '').not.toMatch(/a document or a change/i)
  })

  // ⚠ THE SHARPEST ONE: it named a channel nobody can connect to. deploy/Caddyfile publishes ONE
  // origin (app.talyvor.com → the BFF on :8787), the BFF registers no /mcp route, and Track and
  // Docs are not publicly routed. The MCP server exists in Track — it is simply not reachable by
  // any customer of the hosted product, so advertising it as a SURFACE is a promise the deployment
  // cannot keep.
  it('does not advertise MCP as a surface customers can reach', () => {
    const { container } = render(<Landing />)
    expect(container.textContent ?? '').not.toMatch(/\bMCP\b/)
  })

  // B28.2: the page leads with wallets, and the price-curve claim is gone — "toward zero" and
  // the "near-zero" ninety-day bill were a projected shape, and no ledger row supports either.
  it('leads with wallets, and makes no price-curve claim', () => {
    const { container } = render(<Landing />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('An account for every AI agent.')
    const text = container.textContent ?? ''
    // B59.5: wallets, then the close; Chat, the Marketplace and pooling are hidden areas.
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Talyvor checks the rules before the money moves.',
      'Give your first agent a wallet.',
    ])
    expect(text).not.toMatch(/toward zero|ninety\s+days|90 days|near-zero/i)
    // B44.4: the footer carries positioning v2's line.
    expect(text).toContain('Talyvor Ltd · the financial ecosystem for the AI agent economy')
  })

  // B44.4: the hero is positioning v2 as Nick wrote it — the two sentences and what is coming said as coming;
  // since B46.1 in passing, with no status line. Credit and trading are not offered, "accounts" is not the
  // word, and no loans.
  it('says the two sentences and what is on its way', () => {
    const { container } = render(<Landing />)
    const text = container.textContent ?? ''
    for (const s of POSITIONING_SENTENCES) expect(text).toContain(s)
    expect(text).toContain(ON_ITS_WAY)
    expect(text).not.toMatch(/Accounts, cards|accounts in currencies|loans between companies/i)
    expect(text).not.toMatch(/with credit and trading through licensed partners/i)
  })

  // B56.1: every line on the page is true today (Nick, 1 Nov 2026). Outside a limit Lens refuses, so only a payment
  // above the approval amount waits; an empty wallet refuses; Always allow and a mandate move money with no approval.
  // B59.5: Hey Taly and the credit line left with Chat and lending.
  it('says the true lines and none of the old ones', () => {
    const { container } = render(<Landing />)
    const text = container.textContent ?? ''
    expect(text).toContain('all within limits the owner sets, with any payment above the amount they choose waiting for one tap.')
    expect(ON_ITS_WAY).toBe('Next we’re building payments for everyone, not only businesses.')
    expect(text).toContain(
      'when the money runs out the next call is refused rather than billed to you.',
    )
    expect(text).toContain('A payment above the line you set waits for a person, unless you always allow that payee or a mandate covers it.')
    expect(text).not.toMatch(/anything outside waiting|Next we.re building Hey Taly|Nothing moves until someone approves it/)
  })

  // B58.17 (Nick, 10 Nov 2026): the hero is the agent accounts story, always with who owns the account, and the page
  // says nothing about running on your own infrastructure, which Talyvor does not offer.
  it('leads with an account for every AI agent, owned by you and run by your agent, and has no Sovereign tile', () => {
    const { container } = render(<Landing />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^An account for every AI agent\.$/)
    const hero = container.querySelector('#hero-heading')!.closest('section')!
    expect(hero.textContent).toContain('You own it. Your agent runs it.')
    const text = container.textContent ?? ''
    expect(text).not.toMatch(/the financial ecosystem for the AI agent economy\./i)
    expect(text).not.toMatch(/sovereign|own infrastructure/i)
  })

  it('writes positioning.ts with no em or en dash', () => {
    const src = readFileSync(resolve(__dirname, '../../positioning.ts'), 'utf8')
    expect(src).not.toMatch(/[\u2013\u2014]/)
  })

  // B29.4: the board's WEBSITE HERO. The pieces a visitor sees, each read from the DOM: the drawn
  // mark and wordmark (B51.1, the site header), the hero photograph with the 1200 version for phones and the
  // SAME srcset and sizes index.html preloads. The verb stack ROUTE · PROVE · REUSE · COMPOUND was retired with the
  // tagline on 5 Oct 2026 (B32.1): no verb sits on the photograph. B59.5: the band named Edge, the gateway and the
  // marketplace, so it is gone.
  it('draws the board: the mark and wordmark, the preloaded hero photo without the verbs', () => {
    const { container } = render(<Landing />)
    // B51.1: the site's one header, with the kit's logo (B57.6).
    const header = container.querySelector('header')!
    expect(header.querySelector('[data-brand="lockup"] img[data-brand="logo"]')).not.toBeNull()

    const photo = container.querySelector('figure img')!
    expect(photo.getAttribute('src')).toBe('/brand/photos/hero.jpg')
    const srcset = photo.getAttribute('srcset')!
    expect(srcset).toContain('/brand/photos/hero-1200.jpg 1200w')
    const html = readFileSync(resolve(__dirname, '../../../index.html'), 'utf8')
    expect(html, 'index.html must preload the srcset the page uses').toContain(srcset)
    expect(html, 'index.html must preload with the sizes the page uses').toContain(photo.getAttribute('sizes')!)

    const figure = container.querySelector('figure.tal-hero-photo')!
    expect(figure.querySelector('.tal-hero-scrim'), 'the scrim stays').not.toBeNull()
    expect(container.querySelector('.tal-verbs')).toBeNull()
    // Per text node: the page's textContent joins adjacent spans, so "Route" + "Prove" reads as one word.
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
    const words: string[] = []
    while (walker.nextNode()) words.push(...(walker.currentNode.textContent!.match(/\b(route|prove|reuse|compound)\b/gi) ?? []))
    expect(words, 'a retired verb shows as a word').toEqual([])

    // B58.16: brand-v4's teal section icons are gone with that kit
    expect(container.querySelectorAll('img[src^="/brand/svg/"]')).toHaveLength(0)
  })
})

// B56.10 — Live or Sandbox on the money sections as /api/pricing serves Lens's labels, and Building only from the registry.
describe('Landing labels', () => {
  afterEach(() => vi.restoreAllMocks())

  function serveLabels(labels: Record<string, string> | undefined) {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) =>
      String(input) === '/api/pricing'
        ? new Response(JSON.stringify({ min_usd_cents: 1000, max_usd_cents: 1_000_000, preset_usd_cents: [1000], labels }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        : new Response('null', { status: 404 }),
    )
  }

  const chip = (container: HTMLElement, key: string) => container.querySelector(`[data-status-key="${key}"]`)?.textContent

  it('draws Wallets as Lens labels it: Live only when every capability is live', async () => {
    serveLabels({ ...Object.fromEntries(WALLETS.map((k) => [k, 'live'])), payments_out: 'sandbox' })
    const { container } = render(<Landing />)
    await vi.waitFor(() => expect(chip(container, WALLETS.join(' '))).toBe('Sandbox'))
    expect(container.querySelector(`#wallets [data-status-key="${WALLETS.join(' ')}"]`)).not.toBeNull()
  })

  it('draws no Live or Sandbox while Lens serves no labels', async () => {
    serveLabels(undefined)
    const { container } = render(<Landing />)
    await screen.findByTestId('labels-meaning')
    await new Promise((done) => setTimeout(done, 20))
    expect(container.querySelectorAll('[data-status-key][data-status-label="live"], [data-status-key][data-status-label="sandbox"]')).toHaveLength(0)
  })

  // B56.15 — the currency accounts' statements shipped, so the band and card 04 are true as written and carry no Building.
  it('carries Building from building.json only on what is on its way', () => {
    const { container } = render(<Landing />)
    const building = [...container.querySelectorAll('[data-status-key][data-status-label="building"]')].map((el) => el.getAttribute('data-status-key'))
    expect(building).toEqual(['payments_for_everyone'])
    for (const key of building) expect(BUILDING.some((e) => e.key === key), key!).toBe(true)
    expect(screen.queryByText('Statements for dollar, pound, euro and USDC accounts')).toBeNull()
    expect(screen.getByText(ON_ITS_WAY).querySelector('[data-status-label="building"]')).not.toBeNull()
  })

  it('says what the labels mean', () => {
    render(<Landing />)
    const block = screen.getByTestId('labels-meaning')
    for (const line of ['Moves real money.', 'Works. No real money moves.', 'In our build queue. Not shipped yet.'])
      expect(block.textContent).toContain(line)
  })
})
