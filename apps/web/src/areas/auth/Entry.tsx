import { cn } from '@talyvor/ui'
import { PageBackground, personalHues, pocketFocusRing } from '@talyvor/ui/pocket'
import { Navigate, useSearchParams } from 'react-router-dom'
import { CompanyLine } from '../../components/CompanyLine'
import { ACCESS_LINE, useSignupProbe, type SignupState } from '../../lib/signupOpen'
import { useDocumentTitle } from '../../documentTitle'
import { Door } from './Door'

// Entry.tsx — the two front doors: /signup for a stranger, /signin for someone coming back.
//
// ONE DOOR, TWO PAGES. Both pages draw the same door, the phone number (Door.tsx, B61.26): a known number signs in
// with its passcode, a new one chooses a passcode and goes on to sign-up's steps. Google sign-in is gone (B61.29). So
// the difference between signing up and signing in is entirely a difference in what the reader needs to be told,
// which is exactly why it must not be one page:
//
//   A STRANGER needs to know what this is, that they may start, what happens when they continue,
//   and what they will be holding afterwards.
//
//   A RETURNING PERSON needs the shortest path back. Explaining the product is noise, and
//   "create your workspace" is wrong — they have one, with a balance and a ledger in it.
//
// WHAT THIS PAGE REFUSES TO SAY, and why:
//
//   "Your organisation's identity provider" — the old card's wording. It is correct for an enterprise SSO rollout and
//   disastrous for someone arriving from the internet: it tells them they need a company account and an IT
//   department. Nobody complains about this; they leave.
//
//   Anything about who may enter — unless the server said. See lib/signupOpen.ts.
//
// B59.8 — /signup itself is SignUp.tsx: who the account is for, the kind of money, then a key. What it shares with
// /signin (the card, the access line, Privacy and Terms) is exported from here.
//
// B61.26 — THE DOOR IS THE PHONE NUMBER (Door.tsx), on /signin, on /signup and in AuthGate's card: a code, then the
// passcode for a known number or a new passcode and sign-up's steps for a new one. It is the only way in (B61.29).
//
// B57.49 — BOTH PAGES ARE POCKET'S AUTH CARD (reference w-signup, w-signin): a white card on the cloud page with the
// logo's streams flowing into it from the left. The streams are the kit's own brand art, decorative.

/** Privacy and Terms, small and underlined, at the foot of each card. */
const footLink = cn('underline underline-offset-2 transition-colors duration-200 hover:text-ink', pocketFocusRing)

/** pocket.css .authart: the kit's streams (brand/logo/svg/talyvor-streams-on-*.svg), 440 wide, the version for the nearest
 *  theme shown as the logo's are (theme.css --logo-on-light, --logo-on-dark). From 840px: on a phone the card fills the
 *  width and there is no left for the streams to flow in from.
 *  B64.12 — ANCHORED TO THE CARD, not the window: pinned to the window's left edge they ended in mid-air short of a
 *  laptop-width card and read as a cut-off logo.
 *  B64.13 — JOINED AT THE CARD'S MIDDLE (Nick, 23 Nov: "at the middle of the sign up/in box, and connected to the box").
 *  The meeting point (47.46% down the drawing) is at 50% of the card's own box, so it stays at the middle as the card
 *  grows or shrinks between steps. The lines end UNDER_CARD px beneath the card's left edge (the card is on top), so no
 *  background shows between them, and the mask narrows each bundle's flat, square end into the join, as the logo's
 *  arrow does. */
function Streams() {
  return (
    <div
      className="pointer-events-none absolute hidden select-none wide:block"
      // Its own width: hung off the card's left edge it has no room to shrink into, and the image's max-width: 100%
      // would fold it to nothing.
      style={{
        top: '50%',
        right: `calc(100% - ${(STREAMS_RIGHT_MARGIN + UNDER_CARD).toFixed(2)}px)`,
        width: STREAMS_WIDTH,
        transform: 'translateY(-47.46%)',
        maskImage: STREAMS_TAPER,
        WebkitMaskImage: STREAMS_TAPER,
        maskSize: '100% 100%',
        WebkitMaskSize: '100% 100%',
      }}
      aria-hidden="true"
      data-anchor="card-middle"
    >
      {(['light', 'dark'] as const).map((v) => (
        <img
          key={v}
          src={`/brand/logo/talyvor-streams-on-${v}.svg`}
          alt=""
          width={STREAMS_WIDTH}
          height={338}
          decoding="async"
          data-brand="streams"
          style={{ display: `var(--logo-on-${v})`, width: STREAMS_WIDTH, height: 'auto' }}
        />
      ))}
    </div>
  )
}

const STREAMS_WIDTH = 440

/** The drawing (viewBox 56 24 1164 944) ends its lines at x 1204, 16 units short of its right edge: 6.05 px at 440 wide.
 *  That margin was the gap between the streams and the card. */
const STREAMS_RIGHT_MARGIN = ((1220 - 1204) / 1164) * STREAMS_WIDTH

/** How far the lines run under the card: 2.4 px, so their round caps (half a stroke, at most 1.6 px) end inside 4. */
const UNDER_CARD = 2.4

/** In the drawing's own units: everything left of x 1040 as drawn, then a curve on each side that narrows the three
 *  bundles' ends (y 420 to 524) to y 452 to 492 at the card's edge, feathered so no line ends in a hard cut. Every
 *  bundle keeps lines in the join, so each one meets the card. */
const STREAMS_TAPER = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="56 24 1164 944" preserveAspectRatio="none">' +
    '<filter id="f" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="5"/></filter>' +
    '<path filter="url(#f)" d="M0 0H1040C1130 0 1150 448 1260 452V492C1150 492 1130 1000 1040 1000H0Z"/></svg>',
)}")`

/** The card every entry state is drawn in: pocket.css .authcard, white with its large shadow on the cloud page. */
export function AuthCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('relative z-10 grid w-full max-w-md justify-items-start gap-3.5 rounded-sheet bg-page p-8 shadow-pocket-lg', className)}>
      {children}
    </div>
  )
}

/** The shell both entry pages share — pocket.css .authp: the card centred on the cloud page, the streams behind it.
 *  Public pages, so no Shell/sidebar — there is no workspace to navigate yet. */
export function EntryFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-cloud text-ink">
      {/* B61.70 — the moving background, as behind every page, in a Personal account's colours. */}
      {/* B64.12 — one line system: from 840px the kit's streams flow into the card, so the background's own lines across
          the top are not drawn there. On a phone (no kit streams) they stay. */}
      <PageBackground hues={personalHues} className="wide:[&_.pk-bg-streams]:hidden" />
      {/* B57.58 — no theme control here: Settings' Appearance is the one, and before you sign in the page follows the device. */}
      {/* `main`, NOT `div`: the page's words are in a landmark region (LandmarkCoverage.test.tsx measures it). */}
      <main className="relative z-10 flex flex-1 flex-col items-center justify-center px-gutter py-16 wide:px-10">
        <div className="relative w-full max-w-md">
          <Streams />
          <AuthCard>{children}</AuthCard>
        </div>
        {/* B64.12 — centred to the card's width, as the card is. */}
        <CompanyLine onBackground className="mt-6 w-full max-w-md text-center" />
      </main>
    </div>
  )
}

/** The card's last line on both pages. Linked on every entry surface: someone deciding whether to create an account
 *  must be able to read what the service does with their data BEFORE they do. Both routes are public for that reason.
 *  B61.98 — sign-up shows it straight on the background, so there it is pk-on-bg. */
export function PrivacyTerms({ onBackground = false }: { onBackground?: boolean }) {
  return (
    <p className={cn('text-caption font-normal', onBackground ? 'pk-on-bg' : 'text-ink-3')}>
      <a href="/privacy" className={footLink}>Privacy</a>
      {' · '}
      <a href="/terms" className={footLink}>Terms</a>
    </p>
  )
}

/** The one line that says whether a stranger may actually start, DERIVED from the gate.
 *  `unknown` renders nothing: a promise we cannot verify is not printed. */
export function AccessLine({ state, onBackground = false }: { state: SignupState; onBackground?: boolean }) {
  const tone = cn('text-body', onBackground ? 'pk-on-bg' : 'text-ink-3')
  if (state === 'open') {
    return (
      <p data-access-line className={tone}>
        {ACCESS_LINE.open}
      </p>
    )
  }
  if (state === 'closed') {
    return (
      <p data-access-line className={tone}>
        {ACCESS_LINE.closed} If you’ve already been added, continue above. Otherwise join the waitlist below.
      </p>
    )
  }
  return null
}

/** B64.12 — where `returnTo` may send someone: a path on this site only. One leading "/", never "//" (another host),
 *  never a backslash (browsers read "/\\evil" as "//evil"), never a control character (a tab or newline is dropped from
 *  a URL, so "/\t/evil" is "//evil"). A path has no scheme, so "javascript:" and "https:" are refused by the first
 *  rule. Anything else is null, and the caller opens Home. */
export function sameSitePath(to: string | null | undefined): string | null {
  if (!to || !to.startsWith('/') || to.startsWith('//') || to.includes('\\')) return null
  if (/[\u0000-\u001f\u007f]/.test(to)) return null
  return to
}

/** The `returnTo` this page was opened with (or the BFF's `return_to`, or PayInvoice's `next`), when it is a path on this site. */
export function useReturnTo(): string | undefined {
  const [params] = useSearchParams()
  return sameSitePath(params.get('returnTo') ?? params.get('return_to') ?? params.get('next')) ?? undefined
}

// ─── /signin, and the gate's in-place card ──────────────────────────────────

/**
 * The returning person's page. Also rendered IN PLACE by AuthGate when a session is missing or
 * expired — same words, because the reader is the same person in both cases, and `returnTo`
 * carries them back to whatever they were trying to reach.
 *
 * It deliberately says nothing about what Talyvor is. Someone signing in knows.
 */
export function SignIn({ returnTo }: { returnTo?: string } = {}) {
  const { authenticated } = useSignupProbe()
  const fromUrl = useReturnTo()
  // B61.29 — /signin?return_to= is where the BFF sends a signed-out person (an assistant's Connect page among them).
  returnTo ??= fromUrl
  useDocumentTitle('Sign in')
  // B64.12 — someone with a session goes straight in, to a same-site returnTo or Home, with no page between: "You're
  // signed in, there is nothing to sign up for" was a dead end. A second account opens from the account switcher (B61.9).
  if (authenticated) return <Navigate to={returnTo ?? '/'} replace />
  return (
    <EntryFrame>
      <SignInCard returnTo={returnTo} />
    </EntryFrame>
  )
}

/** The card's words on their own, so AuthGate can render the identical door in its own AuthCard. B61.26 — the door is
 *  the phone number (Door.tsx), the only way in (B61.29). */
export function SignInCard({ returnTo, foot }: { returnTo?: string; foot?: React.ReactNode }) {
  return (
    <>
      <Door returnTo={returnTo} foot={foot} />
      <PrivacyTerms />
    </>
  )
}
