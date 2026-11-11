import { Button, inlineLink } from '@talyvor/ui'
import { useSignupProbe } from '../../lib/signupOpen'
import { useDocumentTitle } from '../../documentTitle'
import { PublicFooter, PublicHeader } from '../../components/SiteChrome'
import { COMPANY_CONTACT } from '../../company'
import { Waitlist } from '../../components/Waitlist'
import { ON_ITS_WAY, POSITIONING_LINE, POSITIONING_SENTENCES } from '../../positioning'
import { LabelsMeaning, StatusLabel } from '../../labels/StatusLabel'
import { WALLETS } from '../../labels/capabilities'
import { usePricing } from './pricingApi'

// The marketing landing (/marketing, OUTSIDE the AuthGate — see App.tsx). It must render with no
// session, no router context, and no providers: Landing.test.tsx renders <Landing /> bare, so
// nothing here may touch react-router or react-query. Every internal destination is a plain anchor
// for that reason, and Journey.test.tsx drives the real router to each published href to prove it
// ARRIVES at a real screen rather than merely existing.
//
// ── DESIGN STANCE ────────────────────────────────────────────────────────────────────────────────
//
// The brand board's WEBSITE HERO tile (brand-v4 BRAND.md, "The marketing page"; B29.4): the drawn
// mark and wordmark in the site header (B51.1: every public page shares it), an eyebrow over every headline, one teal rule per section, raised
// panels with a 1px line border instead of shadows, the four brand icons, and every money figure in
// IBM Plex Mono with tabular figures. The hero photograph bleeds off the right edge behind a gradient
// from the canvas; on a phone it moves under the text. The
// copy is unchanged — only the look moved. Display sizes are still the preset's; anything the
// preset has no token for (the photo, the scrim) lives in the page's own <style> block,
// on the theme's variables, so the tokens stay the one source of colour.
//
// The one thing a visitor should remember is the PRODUCT: every AI agent gets a wallet, and the
// rules on it are enforced before the model call or the payment, not reconciled afterwards.
// B59.5: the page names only the launch pack. Chat, the Marketplace, Rooms, pooling and the gateway are hidden areas
// (LAUNCH-PACK.md section 2), so they have no section, band or sentence here.
//
// ── COPY STANCE ──────────────────────────────────────────────────────────────────────────────────
//
// The page prints no figure: there is no projected curve and no "toward zero", because a shape drawn from a claim is
// not a measurement.

// ── THE CONTACT ADDRESS ──────────────────────────────────────────────────────────────────────────
//
// This page used to hardcode hello@talyvor.com as its only call to action, under a comment saying
// the alias did not route yet. It shipped anyway: a buyer's first action went nowhere, and no gate
// could catch it because a comment cannot be executed. The address is now CONFIGURATION, and its
// absence was a state the page rendered. B51.1 (Nick, 28 Oct 2026): every public footer names the
// company's address (company.ts), so unset now means that address, not "no inbox yet" beside it.
//
// ⚠ IT IS A BUILD-TIME VARIABLE. Vite inlines import.meta.env when the bundle is compiled, so
// setting VITE_CONTACT_EMAIL on the running container does nothing at all — the value has to be
// present in the environment of the `pnpm build` that produces the assets. See deploy/README.
export const CONTACT_EMAIL: string = import.meta.env.VITE_CONTACT_EMAIL || COMPANY_CONTACT
const CONTACT_MAILTO = `mailto:${CONTACT_EMAIL}`

/** The brand icons, copied as drawn from brand-v4 svg/ into public/brand/svg (B29.1). */
type BrandIcon = 'route' | 'prove' | 'reuse' | 'compound'

/** A section's eyebrow, the board's way: the brand icon, the mono index, the spaced-caps label.
 *  /pricing (B29.5) and /documentation (B29.13) use it with no icon. */
export function Eyebrow({ index, icon, children }: { index: string; icon?: BrandIcon; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      {icon ? <img src={`/brand/svg/icon-${icon}-teal.svg`} alt="" width={24} height={24} className="shrink-0" /> : null}
      <span className="font-figure text-caption text-faint">{index}</span>
      <span className="text-eyebrow uppercase text-label">{children}</span>
    </div>
  )
}

/** The teal rule: 32×2 accent, once per section, under its headline. */
export function TealRule({ className = '' }: { className?: string }) {
  return <span className={`block h-0.5 w-8 bg-accent ${className}`} aria-hidden="true" />
}

/** The hero photograph — brand-v4 photos/hero.jpg (2400w) and hero-1200.jpg for phones. index.html
 *  preloads the same srcset and sizes on /marketing, so the bytes it fetches are the ones used. */
const HERO_SRCSET = '/brand/photos/hero-1200.jpg 1200w, /brand/photos/hero.jpg 2400w'
const HERO_SIZES = '(min-width: 840px) 50vw, 100vw'

/** What an agent's wallet does, in the order a request meets it. Each line is something the
 *  console already does — /agents is where a customer sets every one of them. */
const WALLET: Array<{ title: string; body: string }> = [
  {
    title: 'A budget of its own',
    body: 'Fund each agent from the workspace balance. It spends its own money, and when the money runs out the next call is refused rather than billed to you.',
  },
  {
    title: 'Spending rules',
    body: 'Caps per request, per day and per month, the models it may call and the hours it may work, checked before the model is called, not reconciled after.',
  },
  {
    title: 'Approvals',
    body: 'A payment above the line you set waits for a person, unless you always allow that payee or a mandate covers it.',
  },
  {
    title: 'A live statement',
    body: 'Every hold, charge, payment and refund lands on the agent’s own statement as it happens, so you can read what an agent spent the way you read a bank account.',
  },
]

/** B56.10 — a section's eyebrow with Live or Sandbox beside it, as Lens labels the money it describes. */
function LabelledEyebrow({ labels, capability, ...eyebrow }: Parameters<typeof Eyebrow>[0] & {
  labels: Record<string, string> | undefined
  capability: readonly string[]
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Eyebrow {...eyebrow} />
      <StatusLabel capability={capability} labels={labels} />
    </div>
  )
}

export function Landing() {
  // The ONE piece of server state this page reads: whether a stranger may sign up. Deliberately a
  // bare-fetch hook rather than react-query — this page renders with no providers at all, and a
  // probe that failed to answer leaves the page saying nothing about access rather than guessing.
  const { signup } = useSignupProbe()
  // B56.10: Lens's Live or Sandbox for the money sections, from the same public read /pricing makes; none until it answers.
  const pricing = usePricing()
  const labels = pricing.status === 'ok' ? pricing.pricing.labels : undefined
  // THE FRONT DOOR TAKES THE BRAND LINE — `null`, not a page name. That is what the marketing
  // site does with its own home page, while every inner page is `<page> | TALYVOR`, and this
  // page's own h1 is a sentence, not a name. See documentTitle.test.tsx for the fetched titles.
  useDocumentTitle(null)
  return (
    <div className="flex min-h-full flex-col bg-canvas text-ink">
      {/* One staggered reveal on load, plus the transition the stepper needs. Deliberately small:
          this page argues with structure, and motion competing with the argument is noise. Honours
          prefers-reduced-motion, because a page about trust should.

          Below the motion: the board's pieces the preset has no token for — the hero
          photograph and its scrim. Colour comes only from the
          theme's variables. The photograph's figure carries data-theme="dark", so its scrim is
          Obsidian in both themes.

          B36.1: the figure itself is masked, so its left and bottom edges (top and bottom under the
          text on a phone) fade to transparent and whichever theme the page is in shows through —
          nothing is painted over the photo, and the man at the glass sits in the opaque part. */}
      <style>{`
        @keyframes tal-rise { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: none } }
        .tal-rise { animation: tal-rise .42s cubic-bezier(.2,.7,.3,1) both }
        .tal-stagger > * { animation: tal-rise .5s cubic-bezier(.2,.7,.3,1) both }
        .tal-stagger > *:nth-child(2) { animation-delay: .06s }
        .tal-stagger > *:nth-child(3) { animation-delay: .12s }
        .tal-stagger > *:nth-child(4) { animation-delay: .18s }
        .tal-stagger > *:nth-child(5) { animation-delay: .24s }
        @media (prefers-reduced-motion: reduce) {
          .tal-rise, .tal-stagger > * { animation: none }
        }
        .tal-hero-photo { position: relative; margin: 0; aspect-ratio: 16 / 9; overflow: hidden; background: var(--canvas) }
        .tal-hero-photo {
          /* Transparent for the first and last 3%: on a phone those are the top and bottom few rows, which a light page shows any trace of the dark photo in. */
          -webkit-mask-image: linear-gradient(to bottom, transparent 0%, transparent 3%, rgba(0,0,0,.35) 8%, rgba(0,0,0,.75) 13%, #000 18%,
            #000 76%, rgba(0,0,0,.9) 81%, rgba(0,0,0,.65) 86%, rgba(0,0,0,.35) 91%, rgba(0,0,0,.12) 95%, transparent 97%);
          mask-image: linear-gradient(to bottom, transparent 0%, transparent 3%, rgba(0,0,0,.35) 8%, rgba(0,0,0,.75) 13%, #000 18%,
            #000 76%, rgba(0,0,0,.9) 81%, rgba(0,0,0,.65) 86%, rgba(0,0,0,.35) 91%, rgba(0,0,0,.12) 95%, transparent 97%);
        }
        .tal-hero-photo img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: 50% 50% }
        .tal-hero-scrim {
          position: absolute; inset: 0;
          background: linear-gradient(90deg, color-mix(in srgb, var(--canvas) 72%, transparent) 0%,
            color-mix(in srgb, var(--canvas) 40%, transparent) 42%, color-mix(in srgb, var(--canvas) 20%, transparent) 100%);
        }
        @media (min-width: 840px) {
          .tal-hero-photo { position: absolute; top: 0; bottom: 0; left: 50%; right: 0; aspect-ratio: auto }
          .tal-hero-photo {
            -webkit-mask-image:
              linear-gradient(to right, transparent 0%, rgba(0,0,0,.06) 6%, rgba(0,0,0,.18) 12%, rgba(0,0,0,.36) 18%,
                rgba(0,0,0,.56) 24%, rgba(0,0,0,.74) 30%, rgba(0,0,0,.88) 36%, rgba(0,0,0,.97) 42%, #000 48%),
              linear-gradient(to bottom, #000 0%, #000 78%, rgba(0,0,0,.9) 83%, rgba(0,0,0,.65) 89%, rgba(0,0,0,.35) 94%,
                rgba(0,0,0,.12) 98%, transparent 100%);
            mask-image:
              linear-gradient(to right, transparent 0%, rgba(0,0,0,.06) 6%, rgba(0,0,0,.18) 12%, rgba(0,0,0,.36) 18%,
                rgba(0,0,0,.56) 24%, rgba(0,0,0,.74) 30%, rgba(0,0,0,.88) 36%, rgba(0,0,0,.97) 42%, #000 48%),
              linear-gradient(to bottom, #000 0%, #000 78%, rgba(0,0,0,.9) 83%, rgba(0,0,0,.65) 89%, rgba(0,0,0,.35) 94%,
                rgba(0,0,0,.12) 98%, transparent 100%);
            -webkit-mask-composite: source-in;
            mask-composite: intersect;
            -webkit-mask-repeat: no-repeat;
            mask-repeat: no-repeat;
            -webkit-mask-size: 100% 100%;
            mask-size: 100% 100%;
          }
          .tal-hero-photo img { object-position: 62% 50% }
          .tal-hero-scrim {
            background: linear-gradient(90deg, var(--canvas) 0%, color-mix(in srgb, var(--canvas) 72%, transparent) 26%,
              color-mix(in srgb, var(--canvas) 20%, transparent) 100%);
          }
        }
      `}</style>

      <PublicHeader width="max-w-6xl" />

      <main className="flex-1">
        {/* ── 00 · The product ─────────────────────────────────────────────── */}
        {/* No border-b on this one section: the photograph fades out at its bottom (B36.1). */}
        <section aria-labelledby="hero-heading" className="relative overflow-hidden">
          <div className="relative z-10 mx-auto w-full max-w-6xl px-gutter pb-12 pt-14 wide:pb-28 wide:pt-24">
            <div className="wide:w-1/2 wide:pr-12">
              <div className="tal-stagger">
                {/* Positioning v2 (23 Oct 2026, B44.4): the line, then the two sentences, as written. The old
                    headline stays only as this supporting eyebrow. */}
                <p className="text-eyebrow uppercase text-label">Money and markets for AI agents</p>
                <h1 id="hero-heading" className="mt-6 text-display-1 text-ink">
                  {POSITIONING_LINE}
                </h1>
                <p className="mt-7 text-lede text-muted">{POSITIONING_SENTENCES[0]}</p>
                <p className="mt-4 text-body text-muted">{POSITIONING_SENTENCES[1]}</p>
                {/* B56.1: what works, then what is on its way, never as live (Landing.test.tsx pins both). */}
                <p className="mt-4 flex flex-wrap items-center gap-2 text-body text-muted">
                  {ON_ITS_WAY}
                  <StatusLabel building="payments_for_everyone" />
                </p>
                {/* ⚠ THE PRIMARY ACTION POINTS AT /signup, NOT /auth/login, AND NOT AT A MAILTO.
                    Preserved from the previous version because the reasoning is easy to "simplify"
                    away: an earlier draft sent people to sign-in on the theory that a stranger could
                    not complete OAuth anyway, since the Google app is in Testing mode. That premise
                    was inferred from config and was FALSE — Google's Testing state exempts apps
                    requesting only openid, email and profile, which is exactly what apps/bff/auth.go
                    requests. Nobody is stopped at Google; the only wall is ours
                    (OIDC_ALLOWED_EMAILS). /signup tells a stranger what this is and who may enter —
                    derived from the gate, so it is right in both configurations — before handing
                    them to a third party. "Open the app" in the header is the other reader. */}
                <div className="mt-8">
                  <TealRule />
                  <div className="mt-8 flex flex-wrap items-center gap-3">
                    <Button asChild variant="primary" className="h-10 px-5">
                      <a href="/signup">Get started</a>
                    </Button>
                    <Button asChild className="h-10 px-5">
                      <a href="#wallets">See how it works</a>
                    </Button>
                  </div>
                  {/* B44.1 — the visitor the ads bring can leave an email while access is by invitation; B51.1 — only
                      then: while sign-up is open Get started is the way in, and while unknown neither is promised. */}
                  {signup === 'closed' ? <Waitlist className="mt-6 max-w-xl" /> : null}
                </div>
              </div>
              <p className="mt-4 text-caption text-faint">
                <a href="/privacy" className={inlineLink}>
                  Privacy
                </a>
                {' · '}
                <a href="/terms" className={inlineLink}>
                  Terms
                </a>
              </p>
              {/* THE ACCESS SENTENCE IS THE SERVER'S, not the bundle's. A hardcoded "closed trial"
                  line became a lie the moment an operator opened signups, with nothing in the build
                  able to notice. This renders what the BFF reports, and renders NOTHING while the
                  answer is unknown (first paint, BFF unreachable, older BFF): an unverified promise
                  is not printed in either direction. */}
              {signup === 'closed' ? (
                <p className="mt-5 max-w-xl text-body text-muted">
                  We’re letting the first companies in one at a time. Start at sign-up and we’ll
                  come back to you.
                </p>
              ) : null}
              {signup === 'open' ? (
                <p className="mt-5 max-w-xl text-body text-muted">
                  No invitation needed. Sign in with an account you already have and you’ll have your
                  own workspace in a few seconds.
                </p>
              ) : null}
            </div>
          </div>
          {/* The board's photograph: off the right edge from 840px, under the text on a phone. The
              figure at the glass stays in frame at both crops. */}
          <figure data-theme="dark" className="tal-hero-photo">
            <img
              src="/brand/photos/hero.jpg"
              srcSet={HERO_SRCSET}
              sizes={HERO_SIZES}
              width={2400}
              height={1357}
              alt="A person standing at a glass wall, looking out over a lake and mountains"
            />
            <div className="tal-hero-scrim" aria-hidden="true" />
          </figure>
        </section>

        {/* ── 01 · Wallets ─────────────────────────────────────────────────── */}
        <section
          id="wallets"
          aria-labelledby="wallets-heading"
          className="scroll-mt-16 border-b border-rule"
        >
          <div className="mx-auto w-full max-w-6xl px-gutter py-16 wide:py-20">
            <LabelledEyebrow index="01" icon="prove" labels={labels} capability={WALLETS}>
              Wallets
            </LabelledEyebrow>
            {/* THE ONE HEADING THAT NAMES THE PRODUCT. Landing.test.tsx asserts exactly one heading
                matches /talyvor/i, so nothing else on this page may put the name in a heading. */}
            <h2
              id="wallets-heading"
              className="mt-6 max-w-3xl text-display-3 text-ink"
            >
              Talyvor checks the rules before the money moves.
            </h2>
            <TealRule className="mt-5" />
            <p className="mt-5 max-w-xl text-body text-muted">
              Every model call and every payment an agent makes is checked against its wallet first,
              so a rule that says no stops the call, instead of showing up as a line on next month’s
              invoice.
            </p>
            <ol className="mt-10 grid gap-3 wide:grid-cols-2">
              {WALLET.map((w, i) => (
                <li key={w.title} className="rounded-card border border-rule bg-raised p-6">
                  <div className="flex items-baseline gap-3">
                    <span className="font-figure text-caption text-label">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <span className="text-head text-ink">{w.title}</span>
                  </div>
                  <p className="mt-3 text-body text-muted">{w.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ── Close ────────────────────────────────────────────────────────── */}
        <section aria-labelledby="close-heading">
          <div className="mx-auto w-full max-w-6xl px-gutter py-20 wide:py-28">
            <h2
              id="close-heading"
              className="max-w-3xl text-display-2 text-ink"
            >
              Give your first agent a wallet.
            </h2>
            <TealRule className="mt-6" />
            <LabelsMeaning className="mt-8" />
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button asChild variant="primary" className="h-10 px-5">
                <a href="/signup">Create your workspace</a>
              </Button>
              <Button asChild className="h-10 px-5">
                <a href={CONTACT_MAILTO} className="font-mono">
                  {CONTACT_EMAIL}
                </a>
              </Button>
            </div>
          </div>
        </section>
      </main>

      <PublicFooter width="max-w-6xl" />
    </div>
  )
}
