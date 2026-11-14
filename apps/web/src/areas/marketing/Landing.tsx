import { useState } from 'react'
import { inlineLink } from '@talyvor/ui'
import { Button, Face, Icon, SheetFrame } from '@talyvor/ui/pocket'
import { ACCESS_LINE, useSignupProbe } from '../../lib/signupOpen'
import { useDocumentTitle } from '../../documentTitle'
import { PublicFooter, PublicHeader } from '../../components/SiteChrome'
import { COMPANY_CONTACT } from '../../company'
import { Waitlist } from '../../components/Waitlist'
import { ON_ITS_WAY, OWNER_LINE, POSITIONING_LINE, POSITIONING_SENTENCES } from '../../positioning'
import { LABEL_LINES, StatusLabel } from '../../labels/StatusLabel'
import { PAY_OUT, WALLETS } from '../../labels/capabilities'
import { formatCents } from '../lens/topupApi'
import { formatPeg, planName, usePricing, type Pricing } from './pricingApi'
import { CONTRACTED } from './PriceCard'

// The marketing landing (/marketing, OUTSIDE the AuthGate — see App.tsx). It must render with no
// session, no router context, and no providers: Landing.test.tsx renders <Landing /> bare, so
// nothing here may touch react-router or react-query. Every internal destination is a plain anchor
// for that reason, and Journey.test.tsx drives the real router to each published href to prove it
// ARRIVES at a real screen rather than merely existing.
//
// ── DESIGN STANCE ────────────────────────────────────────────────────────────────────────────────
//
// B57.60 — Pocket's homepage (design/pocket s-home): the hero on ink with a faint tangerine glow, the logo kit's three
// streams flowing into a picture of the approval sheet with two agent cards beside it, then Wallets' four cards, what
// the labels mean, the four plans, four questions and the close. The card faces are the approved deck
// (talyvor-cards-final, Nick, 10 Nov 2026), which beats the reference for card faces. No section icons.
//
// Text on a tangerine fill is not a plane the contrast audit classifies (planes.ts), so the hero's Get started is
// Pocket's primary on the dark plane, the step numbers sit on tangerine-50 and so does the close.
//
// B59.5: the page names only the launch pack. Chat, the Marketplace, Rooms, pooling and the gateway are hidden areas
// (LAUNCH-PACK.md section 2), so the reference's Chat, Marketplace and Pooled answers sections are not drawn, and
// neither is its band: B58.17 took Sovereign off it and the rest named hidden areas.
//
// ── COPY STANCE ──────────────────────────────────────────────────────────────────────────────────
//
// Every price and the LXC rate are served (/api/pricing); the page types none. The approval sheet's figures are a
// picture's, said to be a picture, and in dollars only.

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

/** The teal rule: 32×2 accent, once per section, under its headline. Still drawn by the public board and share pages. */
export function TealRule({ className = '' }: { className?: string }) {
  return <span className={`block h-0.5 w-8 bg-accent ${className}`} aria-hidden="true" />
}

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

/** B57.129 — the approved card faces (talyvor-cards-final/deck, Nick, 10 Nov 2026): one owner card of each family, then
 *  the six agents. Each is a 768-wide WebP with a PNG fallback in /card-faces, under 300 KB (Landing.test.tsx). The
 *  faces carry no network mark: that corner stays empty until the issuer gives the artwork. */
const CARD_FACES: Array<{ id: string; alt: string }> = [
  { id: 'premium', alt: 'Premium personal owner card' },
  { id: 'business', alt: 'Business corporate card' },
  { id: 'stable-premium', alt: 'Premium stablecoin owner card' },
  { id: 'agent-remy', alt: 'Remy, Research’s agent card' },
  { id: 'agent-sunny', alt: 'Sunny, Sales’s agent card' },
  { id: 'agent-penny', alt: 'Penny, Bookkeeping’s agent card' },
  { id: 'agent-max', alt: 'Max, Ads’s agent card' },
  { id: 'agent-nova', alt: 'Nova, Travel’s agent card' },
  { id: 'agent-ollie', alt: 'Ollie, Support’s agent card' },
]

/** The two agents the hero draws beside the sheet, each on its own card face: a picture's names and balances. */
const HERO_AGENTS = [
  { id: 'research', name: 'Research', colour: 'cobalt', face: 'circle', card: 'agent-remy', balance: '$1,650.00' },
  { id: 'sales', name: 'Sales', colour: 'orchid', face: 'squircle', card: 'agent-sunny', balance: '$1,200.00' },
] as const

/** What the sheet's buttons say when pressed: the sheet is a picture of the one in the app (reference data-static). */
export const PICTURE_LINE = 'A picture of the approval sheet. Get started to try it.'

/** The reference's four questions (pocket.css .faq), less what the launch pack does not do. */
const QUESTIONS: Array<{ q: string; a: (pricing: Pricing | undefined) => React.ReactNode }> = [
  {
    q: 'Can my agents spend real money?',
    a: () =>
      'Each money feature’s label says. Live moves real money. Sandbox works, and no real money moves. Building is in our build queue and not shipped yet.',
  },
  {
    q: 'What is LXC?',
    // The rate is served: with none confirmed, the answer names no figure.
    a: (pricing) => (
      <>
        Talyvor credit
        {typeof pricing?.usd_per_lxc === 'number' ? (
          <>
            , and <span className="font-figure">1 LXC</span> is <span className="font-figure">{formatPeg(pricing.usd_per_lxc)}</span>
          </>
        ) : null}
        . Agents spend it on AI requests and Talyvor’s services.
      </>
    ),
  },
  {
    q: 'Who approves payments?',
    a: () =>
      'You decide. Anything above the amount you set waits for approval, unless you allowed it in advance, for example by always allowing a payee up to a limit.',
  },
  {
    q: 'Is Talyvor a bank?',
    a: () => 'No. Talyvor is not a bank, and LXC is not money: it is credit for using Talyvor.',
  },
]

/** A section's eyebrow: pocket.css .seye, tangerine-ink spaced caps, with any label beside it. */
function SectionEye({ children, chip }: { children: React.ReactNode; chip?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-pocket-eyebrow font-bold uppercase text-tangerine-ink">
      <span>{children}</span>
      {chip}
    </div>
  )
}

/** A section heading in Pocket's display face (pocket.css .ssec h2). */
function SectionHeading({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="mt-2.5 max-w-4xl font-display text-display-2 font-extrabold text-ink">
      {children}
    </h2>
  )
}

/** One band of the page: pocket.css .ssec. */
function Band({ label, id, children }: { label: string; id?: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={label} className="mx-auto w-full max-w-6xl scroll-mt-16 px-gutter pt-14 wide:px-12">
      {children}
    </section>
  )
}

/** The approval sheet as a picture (reference s-home .heroframe): the frame the app's sheet uses, sample figures in
 *  dollars, and buttons that say what they are when pressed. */
function SheetPicture({ labels }: { labels: Record<string, string> | undefined }) {
  const [pressed, setPressed] = useState(false)
  const research = HERO_AGENTS[0]
  return (
    <>
      <div data-theme="light" data-picture="approval-sheet" className="text-ink">
        <SheetFrame
          className="rounded-sheet pb-5.5 wide:w-full"
          head={
            <>
              <Face agent={research} size={40} waiting />
              <div className="min-w-0">
                <div className="font-bold text-ink">Research wants to pay</div>
                <div className="text-body text-ink-3">October hosting invoice</div>
              </div>
            </>
          }
          label={<StatusLabel capability={PAY_OUT} labels={labels} />}
          amount={<span className="text-pocket-amount font-extrabold">$340.00</span>}
          to={
            <>
              to <b className="text-ink">Acme Hosting</b>
            </>
          }
          facts={[
            { label: 'Why it’s asking', value: 'It asks you above $250.00' },
            { label: 'Paid from', value: 'Research’s US dollar account (holds $400.00)' },
            { label: 'Budget left after', value: '$420.00 of $2,000.00' },
            { label: 'Expires', value: 'Tomorrow at 09:17' },
          ]}
          only="This approves this payment only. Approving or declining asks for your passkey."
          actions={
            <>
              <Button size="lg" className="w-full" aria-describedby="sheet-picture-line" icon={<Icon name="key" />} onClick={() => setPressed(true)}>
                Approve with your passkey
              </Button>
              <Button size="lg" variant="secondary" className="w-full" aria-describedby="sheet-picture-line" onClick={() => setPressed(true)}>
                Decline
              </Button>
            </>
          }
        />
      </div>
      {/* Always in the page for the buttons' description, on the hero's dark plane; shown once either is pressed. */}
      <p id="sheet-picture-line" role="status" className={pressed ? 'mt-3 text-center text-body font-semibold text-ink wide:text-left' : 'sr-only'}>
        {PICTURE_LINE}
      </p>
    </>
  )
}

/** One agent on its own card (reference .floatc, with the approved card face): its face, name and balance. */
function AgentCard({ agent, className = '' }: { agent: (typeof HERO_AGENTS)[number]; className?: string }) {
  return (
    <div
      data-theme="light"
      data-agent-card={agent.id}
      className={`flex items-center gap-2.5 rounded-card-tight bg-page py-2.5 pl-2.5 pr-3.5 text-ink shadow-pocket ${className}`}
    >
      {/* The words beside it name the agent, so the card face is decorative here. */}
      <img src={`/card-faces/${agent.card}.png`} width={768} height={485} alt="" decoding="async" className="tal-cardface block h-auto w-16" />
      <Face agent={agent} size={34} />
      <div className="grid text-caption">
        <b className="text-body">{agent.name}</b>
        <span className="font-figure">{agent.balance}</span>
      </div>
    </div>
  )
}

/** The four plans, each price as /api/pricing serves it (reference .pmini). */
function PlanMinis({ pricing }: { pricing: Pricing }) {
  const gates = pricing.plan_gates
  if (!gates) return null
  return (
    <ul className="mt-4 grid grid-cols-2 gap-4 wide:grid-cols-4">
      {gates.order.map((id) => {
        const listed = pricing.company_plans?.find((p) => p.id === id)
        const cents = id === CONTRACTED ? pricing.enterprise_from_usd_cents : listed ? listed.usd_cents : id === 'free' ? 0 : undefined
        // A plan Lens states no price for is left out rather than printed without one; /pricing says why.
        if (cents === undefined) return null
        const agents = gates.plans[id]?.agents
        return (
          <li key={id} data-plan={id} className="grid gap-1 rounded-card bg-cloud p-5">
            <b className="text-ink">{planName(id)}</b>
            <span className="font-figure text-title font-extrabold text-ink">
              {`${id === CONTRACTED ? 'From ' : ''}${formatCents(cents)}`}
            </span>
            <span className="text-body text-ink-3">
              {cents === 0 ? (typeof agents === 'number' && agents > 0 ? `up to ${agents} agents` : null) : 'a month'}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

export function Landing() {
  // The ONE piece of server state this page reads: whether a stranger may sign up. Deliberately a
  // bare-fetch hook rather than react-query — this page renders with no providers at all, and a
  // probe that failed to answer leaves the page saying nothing about access rather than guessing.
  const { signup } = useSignupProbe()
  // B56.10: Lens's Live or Sandbox for the money sections, from the same public read /pricing makes; none until it answers.
  const state = usePricing()
  const pricing = state.status === 'ok' ? state.pricing : undefined
  const labels = pricing?.labels
  // THE FRONT DOOR TAKES THE BRAND LINE — `null`, not a page name. That is what the marketing
  // site does with its own home page, while every inner page is `<page> | TALYVOR`, and this
  // page's own h1 is a sentence, not a name. See documentTitle.test.tsx for the fetched titles.
  useDocumentTitle(null)
  return (
    <div data-design="pocket" className="flex min-h-full flex-col bg-page text-ink">
      {/* pocket.css .hero.on-ink: ink in both themes, the glow tangerine at 16%. The stage is the reference's 1280 frame
          from 840px; on a phone the art sits behind the sheet and the two agent cards follow it. Honours
          prefers-reduced-motion: the only motion is the rise on load. */}
      <style>{`
        @keyframes tal-rise { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: none } }
        .tal-stagger > * { animation: tal-rise .5s cubic-bezier(.2,.7,.3,1) both }
        .tal-stagger > *:nth-child(2) { animation-delay: .06s }
        .tal-stagger > *:nth-child(3) { animation-delay: .12s }
        @media (prefers-reduced-motion: reduce) { .tal-stagger > * { animation: none } }
        .tal-hero, .tal-band { border-radius: 36px }
        .tal-cardface { border-radius: 5px }
        .tal-hero { background: radial-gradient(60% 55% at 58% 82%, color-mix(in srgb, var(--tangerine) 16%, transparent), transparent 72%), #111216 }
        .tal-stage { position: relative; display: grid; justify-items: center; gap: 16px; margin-top: 32px }
        .tal-stage .tal-streams { position: absolute; left: 50%; top: 40%; width: 150%; max-width: none; height: auto; transform: translate(-50%, -50%); opacity: .55 }
        .tal-stage .tal-sheet { position: relative; z-index: 1; width: 100%; max-width: 380px }
        .tal-stage .tal-cards { position: relative; z-index: 2; display: grid; gap: 12px; justify-items: center }
        @media (min-width: 840px) {
          .tal-stage { display: block; height: 700px; margin: 30px -56px 0 }
          .tal-stage .tal-streams { left: 0; top: 50%; width: 660px; transform: translateY(-47.46%); opacity: 1 }
          .tal-stage .tal-sheet { position: absolute; left: min(620px, calc(100% - 420px)); top: 50%; transform: translateY(-50%); width: 380px }
          .tal-stage .tal-cards { position: static }
          .tal-stage .tal-c1 { position: absolute; top: 96px; right: 64px; z-index: 2 }
          .tal-stage .tal-c2 { position: absolute; bottom: 104px; right: 40px; z-index: 2 }
        }
      `}</style>

      <PublicHeader width="max-w-6xl" />

      <main className="flex-1">
        {/* ── The product ─────────────────────────────────────────────────── */}
        <div className="px-3 pt-1.5 wide:px-6">
          <section
            aria-labelledby="hero-heading"
            data-theme="dark"
            className="tal-hero relative overflow-hidden px-6 pb-8 pt-12 text-ink wide:px-14 wide:pb-0 wide:pt-16"
          >
            <div className="tal-stagger">
              {/* B58.17 (Nick, 10 Nov 2026): the line and who owns the account, then positioning v2's two sentences
                  (B44.4). The old headline stays only as this supporting eyebrow. */}
              <p className="text-pocket-eyebrow font-bold uppercase text-ink-2">Money and markets for AI agents</p>
              <div>
                <h1 id="hero-heading" className="mt-4 max-w-5xl font-display text-display-1 font-extrabold text-ink">
                  {POSITIONING_LINE}
                </h1>
                <p className="mt-3 font-display text-display-3 font-bold text-ink">{OWNER_LINE}</p>
              </div>
              <div className="mt-7 grid items-start gap-8 wide:grid-cols-12 wide:gap-12">
                <div className="wide:col-span-7">
                  <p className="text-lede text-ink">{POSITIONING_SENTENCES[0]}</p>
                  <p className="mt-3.5 text-reading text-ink-2">{POSITIONING_SENTENCES[1]}</p>
                </div>
                <div className="wide:col-span-5">
                  {/* ⚠ THE PRIMARY ACTION POINTS AT /signup, NOT /auth/login, AND NOT AT A MAILTO. /signup tells a
                      stranger what this is and who may enter, derived from the gate, before handing them to a third
                      party (apps/bff/auth.go requests only openid, email and profile, so Google stops nobody).
                      "Open the app" in the header is the other reader. */}
                  <div className="flex flex-wrap items-center gap-2.5">
                    <Button asChild size="lg">
                      <a href="/signup">Get started</a>
                    </Button>
                    <Button asChild size="lg" variant="outline">
                      <a href="#wallets">See how it works</a>
                    </Button>
                  </div>
                  {/* B56.1: what works, then what is on its way, never as live (Landing.test.tsx pins both). */}
                  <p className="mt-3.5 flex flex-wrap items-center gap-2 text-body font-medium text-ink-2">
                    <StatusLabel building="payments_for_everyone" />
                    {ON_ITS_WAY}
                  </p>
                  {/* B44.1 — the visitor the ads bring can leave an email while access is by invitation; B51.1 — only
                      then: while sign-up is open Get started is the way in, and while unknown neither is promised. */}
                  {signup === 'closed' ? (
                    <div data-theme="light" className="mt-5 rounded-card bg-page p-4 text-ink shadow-pocket">
                      {/* The waitlist form is still today's component (components/Waitlist.tsx), so it is held to
                          today's rules, on today's name for the same white. */}
                      <div data-design="today" className="bg-surface">
                        <Waitlist />
                      </div>
                    </div>
                  ) : null}
                  {/* THE ACCESS SENTENCE IS THE SERVER'S, not the bundle's, and renders NOTHING while the answer is
                      unknown. B58.17: one sign-up door, so these are /signup's words (ACCESS_LINE). */}
                  {signup !== 'unknown' ? (
                    <p data-access-line className="mt-4 max-w-xl text-body text-ink-2">
                      {ACCESS_LINE[signup]}
                    </p>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="tal-stage">
              <img
                className="tal-streams"
                src="/brand/logo/talyvor-streams-on-dark.svg"
                alt=""
                aria-hidden="true"
                width={660}
                height={508}
                decoding="async"
              />
              <div className="tal-sheet">
                <SheetPicture labels={labels} />
              </div>
              <div className="tal-cards">
                <AgentCard agent={HERO_AGENTS[0]} className="tal-c1" />
                <AgentCard agent={HERO_AGENTS[1]} className="tal-c2" />
              </div>
            </div>
          </section>
        </div>

        {/* ── Wallets ─────────────────────────────────────────────────────── */}
        <Band id="wallets" label="wallets-heading">
          <SectionEye chip={<StatusLabel capability={WALLETS} labels={labels} />}>Wallets</SectionEye>
          {/* THE ONE HEADING THAT NAMES THE PRODUCT. Landing.test.tsx asserts exactly one heading
              matches /talyvor/i, so nothing else on this page may put the name in a heading. */}
          <SectionHeading id="wallets-heading">Talyvor checks the rules before the money moves.</SectionHeading>
          <p className="mt-5 max-w-2xl text-lede text-ink-2">
            Every model call and every payment an agent makes is checked against its wallet first, so a rule that says no
            stops the call, instead of showing up as a line on next month’s invoice.
          </p>
          <ol className="mt-6 grid gap-4 wide:grid-cols-2 lg:grid-cols-4">
            {WALLET.map((w, i) => (
              <li key={w.title} className="grid content-start gap-2.5 rounded-sheet bg-cloud p-6.5">
                <span
                  aria-hidden="true"
                  className="grid h-7 w-7 place-items-center rounded-pill bg-tangerine-50 font-figure text-caption font-bold text-tangerine-ink"
                >
                  {String(i + 1).padStart(2, '0')}
                </span>
                <h3 className="font-display text-title font-bold text-ink">{w.title}</h3>
                <p className="text-body text-ink-2">{w.body}</p>
              </li>
            ))}
          </ol>
          <ul className="mt-8 grid grid-cols-2 gap-4 wide:grid-cols-3">
            {CARD_FACES.map((c) => (
              <li key={c.id}>
                <picture>
                  <source type="image/webp" srcSet={`/card-faces/${c.id}.webp`} />
                  <img
                    src={`/card-faces/${c.id}.png`}
                    width={768}
                    height={485}
                    loading="lazy"
                    decoding="async"
                    alt={c.alt}
                    className="block h-auto w-full"
                  />
                </picture>
              </li>
            ))}
          </ul>
        </Band>

        {/* ── What the labels mean (B56.9's legend) ───────────────────────── */}
        <Band label="labels-heading">
          <div data-testid="labels-meaning">
            <SectionEye>What the labels mean</SectionEye>
            <SectionHeading id="labels-heading">You always know what is real.</SectionHeading>
            <p className="max-w-2xl text-lede text-ink-2">Every money feature carries a label, and so does every feature still being built.</p>
            <dl className="mt-4 grid gap-4 wide:grid-cols-3">
              {(['live', 'sandbox', 'building'] as const).map((s) => (
                <div key={s} className="grid justify-items-start gap-2.5 rounded-card bg-cloud p-5">
                  <dt>
                    <StatusLabel legend={s} />
                  </dt>
                  <dd className="m-0 text-body text-ink-2">{LABEL_LINES[s]}</dd>
                </div>
              ))}
            </dl>
          </div>
        </Band>

        {/* ── Pricing ─────────────────────────────────────────────────────── */}
        <Band label="pricing-heading">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <SectionEye>Pricing</SectionEye>
              <SectionHeading id="pricing-heading">Start free. Grow when you need to.</SectionHeading>
            </div>
            <Button asChild variant="secondary">
              <a href="/pricing">See pricing</a>
            </Button>
          </div>
          {pricing ? <PlanMinis pricing={pricing} /> : null}
        </Band>

        {/* ── Questions ───────────────────────────────────────────────────── */}
        <Band label="questions-heading">
          <SectionEye>Questions</SectionEye>
          <SectionHeading id="questions-heading">Before you start.</SectionHeading>
          <dl className="mt-4 grid gap-4 wide:grid-cols-2">
            {QUESTIONS.map((f) => (
              <div key={f.q} className="grid gap-1.5 rounded-card bg-cloud px-5.5 py-5">
                <dt className="font-bold text-ink">{f.q}</dt>
                <dd className="m-0 text-body text-ink-2">{f.a(pricing)}</dd>
              </div>
            ))}
          </dl>
        </Band>

        {/* ── Close (pocket.css .cta) ─────────────────────────────────────── */}
        <div className="px-3 pt-14 wide:px-6">
          <section
            aria-labelledby="close-heading"
            className="tal-band flex flex-col items-start justify-between gap-6 bg-tangerine-50 p-8 text-ink wide:flex-row wide:items-center wide:p-14"
          >
            <h2 id="close-heading" className="font-display text-display-2 font-extrabold text-ink">
              Give your first agent a wallet.
            </h2>
            <div className="flex flex-wrap items-center gap-3">
              <Button asChild size="lg">
                <a href="/signup">Create your workspace</a>
              </Button>
              <a href={CONTACT_MAILTO} className={`${inlineLink} font-mono font-semibold text-ink`}>
                {CONTACT_EMAIL}
              </a>
            </div>
          </section>
        </div>
      </main>

      <PublicFooter width="max-w-6xl" />
    </div>
  )
}
