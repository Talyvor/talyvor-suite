import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'
import { sameSitePath } from './Entry'
import { pressEverything } from '../../test/pressEverything'

// Entry.test.tsx — THE FRONT DOOR.
//
// B61.26 — /signin and /signup are now ONE door, the phone number (Door.tsx, Door.test.tsx): a known number signs in
// with its passcode, a new one chooses a passcode and goes on to sign-up's steps. What still differs is what a
// stranger is told on /signup (the access line), and what an already-signed-in person is told. The history below is
// why the words, and not the mechanism, are what these tests read.
//
// Sign up and sign in are ONE mechanism (the same door) and must not
// be one page. The person reading them wants opposite reassurances:
//
//   A STRANGER needs to know what this is, that they can start, and what they will have when
//   they finish. They have never heard of us; "You'll be sent to your organisation's identity
//   provider" tells them they need a company account, which is the single most effective way to
//   turn away someone who could have signed up in twenty seconds.
//
//   A RETURNING PERSON needs the shortest path back in. Explaining the product to them is
//   noise, and "create your workspace" is actively wrong — they have one.
//
// So: two pages, two sets of words, one destination. These tests assert the WORDS, because the
// words are the entire feature — the mechanism underneath was already built and already works.
//
// And they assert them against what the server says about the door (signup_open), never against
// a literal in the bundle. A page that hardcodes "closed trial, accounts set up by hand" keeps
// saying it after the trial opens, and a page that hardcodes "get started free" says it while
// the gate is still six addresses. Both are one deploy away at all times.
//
// ⚠ APOSTROPHES. The copy on these pages uses typographic ’ and a straight ' in a regex does
// NOT match it. The enterprise-SSO assertion below was written with `organisation'?s` and was
// VACUOUS: pasting the exact banned sentence back onto the page left the suite green. It was
// caught only by deliberately re-introducing the sentence and watching for a failure that never
// came. Every apostrophe in an assertion here is therefore a character class, and any new one
// must be positive-controlled the same way before it is believed.

type MeOverrides = {
  /** B57.49 — /api/pricing's labels (B56.9); omitted, /api/pricing is not answered. */
  labels?: Record<string, string>
  signup_open?: boolean
  authenticated?: boolean
  /** B61.26 — a new number's sign-up session */
  signup_unfinished?: boolean
  google_signin?: boolean
  /** Simulate an unreachable/failed probe: the page must claim NOTHING either way. */
  fail?: boolean
}

function mockMe(o: MeOverrides = {}) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    if (url === '/auth/me') {
      if (o.fail) throw new Error('probe unreachable')
      return new Response(
        JSON.stringify({
          mode: 'oidc',
          authenticated: o.authenticated ?? false,
          user: o.authenticated ? { sub: 's', email: 'someone@example.com' } : null,
          ...(o.signup_open === undefined ? {} : { signup_open: o.signup_open }),
          ...(o.signup_unfinished ? { signup_unfinished: true } : {}),
          ...(o.google_signin ? { google_signin: true } : {}),
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }
    if (url === '/api/pricing' && o.labels) {
      return new Response(JSON.stringify({ min_usd_cents: 500, max_usd_cents: 50000, preset_usd_cents: [], labels: o.labels }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return new Response('null', { status: 404 })
  })
}

function at(path: string) {
  window.history.pushState({}, '', path)
  return render(<App />)
}

beforeEach(() => {
  queryClient.clear()
  window.history.pushState({}, '', '/')
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  window.history.pushState({}, '', '/')
})

// ─── the routes exist, and are PUBLIC ───────────────────────────────────────

describe('/signup and /signin are public routes', () => {
  it('/signup renders for someone with no session — it is not behind the gate', async () => {
    mockMe({ signup_open: true })
    at('/signup')
    // The gate's card would be the failure: a signup page you must already be signed in to
    // read is not a signup page.
    expect(await screen.findByRole('heading', { name: 'What’s your phone number?' })).toBeInTheDocument()
    expect(screen.queryByText(/this workspace requires authentication/i)).toBeNull()
  })

  it('/signin renders for someone with no session', async () => {
    mockMe({ signup_open: true })
    at('/signin')
    expect(await screen.findByRole('heading', { name: 'What’s your phone number?' })).toBeInTheDocument()
  })

  // B61.26 — one door: the number decides whether it signs in or joins, so both addresses ask the same question.
  it('they are ONE door: both ask for the phone number, and neither has a password field', async () => {
    for (const path of ['/signup', '/signin']) {
      mockMe({ signup_open: true })
      at(path)
      expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('What’s your phone number?')
      expect(screen.getByLabelText('Your phone number')).toHaveAttribute('type', 'tel')
      expect(document.querySelector('input[type="password"]')).toBeNull()
      cleanup()
      queryClient.clear()
      vi.restoreAllMocks()
    }
  })

  it('B61.29 — no Google under the door, even if /auth/me still says google_signin', async () => {
    mockMe({ signup_open: true, google_signin: true })
    at('/signin')
    await screen.findByRole('heading', { level: 1 })
    expect(screen.queryByRole('link', { name: 'Continue with Google' })).toBeNull()
  })
})

// ─── the words a stranger reads ─────────────────────────────────────────────

describe('the signup page is written for someone who has never heard of us', () => {
  it('does NOT use enterprise-SSO language', async () => {
    mockMe({ signup_open: true })
    at('/signup')
    await screen.findByRole('heading', { level: 1 })
    const text = document.body.textContent ?? ''
    // The exact sentence the old card used. A stranger from the internet reads
    // "your organisation's identity provider" as "you need a company account".
    // Both apostrophe forms, both spellings — see the apostrophe warning at the top.
    expect(text).not.toMatch(/organi[sz]ation[’']?s identity provider/i)
    expect(text).not.toMatch(/\bSSO\b/)
  })

  // B27.22 — sharing is on by default, so the page says so before Continue, and links to the
  // switch itself (Features.test.tsx: that address lands on the Answer sharing row's switch).
  it('says answers may be reused for other companies, and links to the sharing switch', async () => {
    // B61.26 — said on sign-up's first step, after the door and before the account is made.
    mockMe({ signup_open: true, authenticated: true, signup_unfinished: true })
    at('/signup')
    const sentence = await screen.findByText(/Answers you get may be reused/)
    expect(sentence).toHaveTextContent(
      'Answers you get may be reused to answer the same question for other companies. You can switch sharing off at any time in Features.',
    )
    expect(within(sentence).getByRole('link', { name: 'Features' })).toHaveAttribute('href', '/features#answer-sharing')
  })
})

// ─── the promise is DERIVED, never hardcoded ────────────────────────────────

describe('what the page promises tracks the actual gate', () => {
  // B44.4's status line ("Closed trial on test money…") is the product's status, the same in every state of the
  // gate, so these read the page without it: what they test is the access line the gate decides.
  const accessText = () => document.body.textContent ?? ''

  it('OPEN: says a stranger can start, with no invitation', async () => {
    mockMe({ signup_open: true })
    at('/signup')
    await screen.findByRole('heading', { level: 1 })
    const text = accessText()
    expect(text).toMatch(/no invitation|anyone can|open to anyone/i)
    expect(text).not.toMatch(/closed trial|invitation only|invite only|by hand/i)
  })

  it('CLOSED: does not write a cheque the gate will bounce', async () => {
    mockMe({ signup_open: false })
    at('/signup')
    await screen.findByRole('heading', { level: 1 })
    const text = accessText()
    // The refusal happens at OUR denied page and is explained there — but sending someone
    // into a refusal you could have predicted is still a page lying to a reader.
    expect(text).toMatch(/first companies in one at a time/i)
    expect(text).not.toMatch(/no invitation needed|anyone can start/i)
  })

  it('UNKNOWN (probe failed): claims NOTHING either way, and still offers the action', async () => {
    mockMe({ fail: true })
    at('/signup')
    await screen.findByRole('heading', { level: 1 })
    const text = accessText()
    // Absence of knowledge must render as absence of claim. Guessing "closed" turns away a
    // stranger who could have signed up; guessing "open" walks them into a refusal. Neither
    // sentence is available, so neither is printed.
    expect(text).not.toMatch(/no invitation needed|anyone can start/i)
    expect(text).not.toMatch(/closed trial|invitation only/i)
    expect(screen.getByRole('button', { name: /^continue$/i })).toBeInTheDocument()
  })

  it('a stranger on /signup reads the access line under the door', async () => {
    mockMe({ signup_open: true })
    at('/signup')
    await screen.findByRole('heading', { name: 'What’s your phone number?' })
    expect(document.querySelector('[data-access-line]')).toHaveTextContent('Open to anyone, no invitation needed.')
  })

  it('an OLDER BFF that does not report signup_open is treated as unknown, not as open', async () => {
    // signup_open omitted entirely. Silence must not manufacture a promise.
    //
    // ⚠ This named `docs_shared` as the field following the same rule until #59 deleted that
    // field — and the comparison had been the wrong way round even while it stood: an absent
    // docs_shared was treated as FALSE, whereas an absent signup_open is UNKNOWN, a third state
    // of its own (lib/signupOpen.ts). Both refuse to manufacture a claim from silence; they do
    // it differently, and only one of them still exists.
    mockMe({})
    at('/signup')
    await screen.findByRole('heading', { level: 1 })
    expect(document.body.textContent ?? '').not.toMatch(/no invitation needed|anyone can start/i)
  })
})

// ─── someone already signed in ──────────────────────────────────────────────

// B64.12 — "You're signed in, there is nothing to sign up for" was a dead end Nick reached from the website's "Open an
// account". With a session both doors go straight in: to returnTo when it is a path on this site, Home otherwise.
describe('an already-signed-in person goes straight in', () => {
  const landsAt = async (path: string, expected: string) => {
    mockMe({ signup_open: true, authenticated: true })
    at(path)
    await waitFor(() => expect(window.location.pathname + window.location.search).toBe(expected))
    expect(document.body.textContent ?? '').not.toMatch(/already has a Talyvor session|you[’']re signed in/i)
    cleanup()
    queryClient.clear()
    vi.restoreAllMocks()
  }

  it.each(['/signup', '/signin'])('%s opens Home', async (door) => {
    await landsAt(door, '/')
  })

  it.each(['/signup', '/signin'])('%s follows a returnTo on this site', async (door) => {
    await landsAt(`${door}?returnTo=${encodeURIComponent('/money?tab=cards')}`, '/money?tab=cards')
  })

  it.each(['https://evil.example', '//evil.example', '/\\evil.example', 'javascript:alert(1)', '/\t/evil.example'])(
    'a returnTo of %j opens Home',
    async (to) => {
      for (const door of ['/signup', '/signin']) await landsAt(`${door}?returnTo=${encodeURIComponent(to)}`, '/')
    },
  )

  it('sameSitePath keeps a path on this site and nothing else', () => {
    expect(sameSitePath('/agents/a1?x=1#y')).toBe('/agents/a1?x=1#y')
    for (const bad of [null, undefined, '', 'money', 'https://evil.example', '//evil.example', '/\\evil.example', '\\/evil.example', 'javascript:alert(1)', '/\n/evil.example']) {
      expect(sameSitePath(bad)).toBeNull()
    }
  })

  it('someone whose account opens on /signup is not sent Home: their step goes on to the key', async () => {
    // The join's session, on sign-up's steps; then the account opens and /auth/me answers a finished session while the
    // page is still /signup. Only someone who ARRIVED signed in goes straight in.
    mockMe({ signup_open: true, authenticated: true, signup_unfinished: true })
    at('/signup')
    await screen.findByText(/Answers you get may be reused/)
    vi.restoreAllMocks()
    mockMe({ signup_open: true, authenticated: true })
    await queryClient.refetchQueries({ queryKey: ['auth-me'] })
    await new Promise((r) => setTimeout(r, 50))
    expect(window.location.pathname).toBe('/signup')
  })

  it('signed out, both doors still show their form; the gate’s card stays in place on the page asked for', async () => {
    for (const path of ['/signup', '/signin', '/ledger']) {
      mockMe({ signup_open: true })
      at(path)
      expect(await screen.findByRole('button', { name: 'Continue' })).toBeInTheDocument()
      expect(window.location.pathname).toBe(path)
      cleanup()
      queryClient.clear()
      vi.restoreAllMocks()
    }
  })
})

// ─── B57.49: Pocket's auth card ─────────────────────────────────────────────

// B59.8: /signup is its own wide page now (SignUp.test.tsx).
describe('the sign-in page is Pocket’s auth card', () => {
  it('the streams behind a white card on the cloud page, the logo to the website, one ink action', async () => {
    for (const path of ['/signin', '/signup']) {
      mockMe({ signup_open: true })
      const { container } = at(path)
      const h1 = await screen.findByRole('heading', { level: 1 })
      // Held to Pocket's design rules, not today's.
      expect(h1.closest('[data-design]')).toHaveAttribute('data-design', 'pocket')
      expect(container.querySelector('.bg-cloud')).not.toBeNull()
      // The logo's streams, the kit's own files, one per theme, decorative and hidden from a screen reader.
      const streams = Array.from(container.querySelectorAll('img[data-brand="streams"]'))
      expect(streams.map((i) => i.getAttribute('src'))).toEqual(['/brand/logo/talyvor-streams-on-light.svg', '/brand/logo/talyvor-streams-on-dark.svg'])
      for (const img of streams) {
        expect(img).toHaveAttribute('alt', '')
        expect(img.closest('[aria-hidden="true"]')).not.toBeNull()
      }
      // B64.12 — the streams hang off the card, not the window. B64.13 — they meet it at its own vertical middle, so the
      // join follows the card as it grows or shrinks between steps: the art's meeting point (47.46% down) at 50% of the
      // card's box, the lines' ends (6.05 px short of the 440 px art's right edge) 2.4 px under the card's left edge, and
      // the bundles' square ends narrowed by the taper.
      const art = streams[0].closest('[data-anchor="card-middle"]') as HTMLElement
      expect(art).toHaveClass('absolute')
      expect(art).not.toHaveClass('right-full')
      expect(art.style.top).toBe('50%')
      expect(art.style.right).toBe('calc(100% - 8.45px)')
      expect(art.style.width).toBe('440px')
      expect(art.style.transform).toBe('translateY(-47.46%)')
      expect(art.style.maskImage).toMatch(/^url\("data:image\/svg\+xml,/)
      expect(art.parentElement!.querySelector(':scope > .shadow-pocket-lg')).toBe(h1.closest('.bg-page'))
      // One line system: from 840px the background's own lines across the top are not drawn.
      expect(container.querySelector('[data-background="streams"]')).toHaveClass('wide:[&_.pk-bg-streams]:hidden')
      // The company line is centred to the card's width.
      expect(screen.getByText(/TALYVOR LTD/)).toHaveClass('w-full', 'max-w-md', 'text-center')
      // The card: white, its large shadow, the sheet's corners; the kit's small logo in it, which goes to the website.
      const card = h1.closest('.bg-page')!
      expect(card).toHaveClass('shadow-pocket-lg', 'rounded-sheet')
      const logo = within(card as HTMLElement).getByRole('link', { name: 'Talyvor website' })
      expect(logo).toHaveAttribute('href', '/marketing')
      // B64.11 — 144 px is under 240: the kit's small-logo PNGs, 1x and 2x, never the SVG.
      expect(Array.from(logo.querySelectorAll('img[data-brand="logo"]')).map((i) => [i.getAttribute('srcset'), i.getAttribute('alt')])).toEqual([
        ['/brand/logo/talyvor-logo-small-on-light-240.png 1x, /brand/logo/talyvor-logo-small-on-light-480.png 2x', 'Talyvor'],
        ['/brand/logo/talyvor-logo-small-on-dark-240.png 1x, /brand/logo/talyvor-logo-small-on-dark-480.png 2x', 'Talyvor'],
      ])
      // No teal and no lake any more, and the page's one primary action is Pocket's ink pill.
      expect(container.querySelector('figure.tal-entry-photo, .bg-accent')).toBeNull()
      expect(container.querySelectorAll('.bg-primary')).toHaveLength(1)
      expect(screen.getByRole('button', { name: 'Continue' })).toHaveClass('bg-primary', 'rounded-pill')
      cleanup()
      queryClient.clear()
      vi.restoreAllMocks()
    }
  })
})

// ─── B57.1: every control on both pages does something ──────────────────────

describe('every control on both pages does something', () => {
  it.each(['/signup', '/signin'])('%s', async (route) => {
    // B61.26 — the door is one field and one button (Continue waits, saying why, until a number is typed); the rest
    // are the logo, Privacy and Terms.
    const report = await pressEverything(route, { '/auth/me': { mode: 'oidc', authenticated: false, user: null, signup_open: true } })
    expect(report.dead).toEqual([])
    // The logo, Privacy and Terms: three, since B61.29 took Google away.
    expect(report.pressed).toBeGreaterThanOrEqual(3)
  })
})

// ─── the returning person's page ────────────────────────────────────────────

describe('the sign-in page is written for someone who already has a workspace', () => {
  it('does not tell a returning person to create a workspace', async () => {
    mockMe({ signup_open: true })
    at('/signin')
    await screen.findByRole('heading', { level: 1 })
    expect(screen.queryByRole('heading', { name: /create your/i })).toBeNull()
  })
})
