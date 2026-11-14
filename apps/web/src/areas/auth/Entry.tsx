import { Logo, cn } from '@talyvor/ui'
import { Button, pocketFocusRing } from '@talyvor/ui/pocket'
import { CompanyLine } from '../../components/CompanyLine'
import { ACCESS_LINE, useSignupProbe, type SignupState } from '../../lib/signupOpen'
import { useDocumentTitle } from '../../documentTitle'

// Entry.tsx — the two front doors: /signup for a stranger, /signin for someone coming back.
//
// ONE MECHANISM, TWO PAGES. Both actions go to /auth/login; the OIDC round-trip does not care
// which page you started on, and there is no "create account" API to call — the callback
// provisions a Lens workspace and bootstraps a Track one for any identity it has not seen
// before. So the difference between signing up and signing in is entirely a difference in what
// the reader needs to be told, which is exactly why it must not be one page:
//
//   A STRANGER needs to know what this is, that they may start, what happens when they click,
//   and what they will be holding afterwards. Everything before "Continue" is them deciding
//   whether to trust a redirect to a third party.
//
//   A RETURNING PERSON needs the shortest path back. Explaining the product is noise, and
//   "create your workspace" is wrong — they have one, with a balance and a ledger in it.
//
// WHAT THIS PAGE REFUSES TO SAY, and why:
//
//   "Your organisation's identity provider" — the old card's wording, and the reason this page
//   exists. It is correct for an enterprise SSO rollout and disastrous for someone arriving
//   from the internet: it tells them they need a company account and an IT department, when in
//   fact they need a Google login. Nobody complains about this; they leave.
//
//   The IdP's NAME. The deployment's issuer is configuration (OIDC_ISSUER) — Google for the
//   hosted trial, but Keycloak, Authentik, Dex or anything else for a self-hoster. "Continue
//   with Google" is a claim the bundle cannot check, and a self-hoster's users would read a
//   brand that has nothing to do with their login. So the copy describes the MECHANISM, which
//   is true of every issuer: an account you already have, and no new password.
//
//   Anything about who may enter — unless the server said. See lib/signupOpen.ts.
//
// B59.8 — /signup itself is SignUp.tsx: who the account is for, the kind of money, then a key. What it shares with
// /signin (the card, the access line, Privacy and Terms) is exported from here.
//
// B57.49 — BOTH PAGES ARE POCKET'S AUTH CARD (reference w-signup, w-signin): a white card on the cloud page with the
// logo's streams flowing into it from the left. The streams are the kit's own brand art, decorative.

/** The BFF's OIDC entry point. Both pages end here; nothing else in this file is a destination. */
function loginHref(returnTo?: string): string {
  return returnTo ? `/auth/login?return_to=${encodeURIComponent(returnTo)}` : '/auth/login'
}

/** A link inside the card's words: pocket.css's bold ink link. */
const cardLink = cn('font-semibold text-ink', pocketFocusRing)

/** Privacy and Terms, small and underlined, at the foot of each card. */
const footLink = cn('underline underline-offset-2 transition-colors duration-200 hover:text-ink', pocketFocusRing)

/** pocket.css .authart: the kit's streams (brand/logo/svg/talyvor-streams-on-*.svg), 440 wide, left of centre, the
 *  version for the nearest theme shown as the logo's are (theme.css --logo-on-light, --logo-on-dark). From 840px:
 *  on a phone the card fills the width and there is no left for the streams to flow in from. */
function Streams() {
  return (
    <div className="pointer-events-none absolute left-0 top-1/2 hidden select-none wide:block" style={{ transform: 'translateY(-47.46%)' }} aria-hidden="true">
      {(['light', 'dark'] as const).map((v) => (
        <img
          key={v}
          src={`/brand/logo/talyvor-streams-on-${v}.svg`}
          alt=""
          width={440}
          height={338}
          decoding="async"
          data-brand="streams"
          style={{ display: `var(--logo-on-${v})`, width: 440, height: 'auto' }}
        />
      ))}
    </div>
  )
}

/** The card every entry state is drawn in: pocket.css .authcard, white with its large shadow on the cloud page. */
export function AuthCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('relative z-10 grid w-full max-w-md justify-items-start gap-3.5 rounded-sheet bg-page p-8 shadow-pocket-lg', className)}>
      {children}
    </div>
  )
}

/** pocket.css .h-page in the card: the page's one h1, in the display face, under the logo. */
function CardHeading({ children }: { children: React.ReactNode }) {
  return <h1 className="mt-4 font-display text-title font-bold text-ink">{children}</h1>
}

/** The card's lead line under its heading. */
function Lead({ children }: { children: React.ReactNode }) {
  return <p className="text-reading text-ink-2">{children}</p>
}

/** The card's logo, which goes to the website. */
function CardLogo() {
  return (
    <a href="/marketing" aria-label="Talyvor website" className={cn('rounded-control', pocketFocusRing)}>
      <Logo width={144} />
    </a>
  )
}

/** The shell both entry pages share — pocket.css .authp: the card centred on the cloud page, the streams behind it.
 *  Public pages, so no Shell/sidebar — there is no workspace to navigate yet. */
export function EntryFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-cloud text-ink">
      <Streams />
      {/* B57.58 — no theme control here: Settings' Appearance is the one, and before you sign in the page follows the device. */}
      {/* `main`, NOT `div`: the page's words are in a landmark region (LandmarkCoverage.test.tsx measures it). */}
      <main className="relative z-10 flex flex-1 flex-col items-center justify-center px-gutter py-16 wide:px-10">
        <AuthCard>{children}</AuthCard>
        <CompanyLine className="mt-6 w-full max-w-md" />
      </main>
    </div>
  )
}

/** The card's last line on both pages. Linked on every entry surface: someone deciding whether to create an account
 *  must be able to read what the service does with their data BEFORE they do. Both routes are public for that reason. */
export function PrivacyTerms() {
  return (
    <p className="text-caption font-normal text-ink-3">
      <a href="/privacy" className={footLink}>Privacy</a>
      {' · '}
      <a href="/terms" className={footLink}>Terms</a>
    </p>
  )
}

/** The one line that says whether a stranger may actually start, DERIVED from the gate.
 *  `unknown` renders nothing: a promise we cannot verify is not printed. */
export function AccessLine({ state }: { state: SignupState }) {
  if (state === 'open') {
    return (
      <p data-access-line className="text-body text-ink-3">
        {ACCESS_LINE.open}
      </p>
    )
  }
  if (state === 'closed') {
    return (
      <p data-access-line className="text-body text-ink-3">
        {ACCESS_LINE.closed} If you’ve already been added, continue above. Otherwise join the waitlist below.
      </p>
    )
  }
  return null
}

/** Rendered instead of the pitch when the browser already has a session: a signed-in person
 *  asked to "create your workspace" is being told their account does not exist. */
export function AlreadyIn() {
  return (
    <>
      <CardLogo />
      <CardHeading>You’re signed in</CardHeading>
      <Lead>This browser already has a Talyvor session, so there is nothing to sign up for.</Lead>
      <Button asChild size="lg" className="w-full">
        <a href="/">Open the app</a>
      </Button>
    </>
  )
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
  useDocumentTitle(authenticated ? 'You’re signed in' : 'Sign in')
  if (authenticated) {
    return (
      <EntryFrame>
        <AlreadyIn />
      </EntryFrame>
    )
  }
  return (
    <EntryFrame>
      <SignInCard returnTo={returnTo} />
    </EntryFrame>
  )
}

/** The card's words on their own, so AuthGate can render the identical words in its own AuthCard without a second
 *  probe (it has already asked /auth/me — that is how it knows to show this at all). B56.19's email-first step is
 *  added here when it lands. */
export function SignInCard({ returnTo }: { returnTo?: string }) {
  return (
    <>
      <CardLogo />
      <CardHeading>Sign in to Talyvor</CardHeading>
      <Lead>
        Use the same account you signed up with. You’ll be taken there to confirm it’s you, and returned here. There is
        no password for Talyvor itself.
      </Lead>
      <Button asChild size="lg" className="w-full">
        <a href={loginHref(returnTo)}>Sign in</a>
      </Button>
      <p className="text-body text-ink-2">
        New to Talyvor?{' '}
        <a href="/signup" className={cardLink}>
          Create a workspace
        </a>
      </p>
      <PrivacyTerms />
    </>
  )
}
