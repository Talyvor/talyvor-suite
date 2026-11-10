import { Children, isValidElement, type ReactElement } from 'react'
import { Link } from 'react-router-dom'
import { useAuthMeReader } from '../lib/authMe'
import { useDocumentTitle } from '../documentTitle'
import { inlineLink } from '@talyvor/ui'
import { Eyebrow } from '@talyvor/ui/pocket'
import { PublicFooter, PublicHeader } from '../components/SiteChrome'

// legalParts — the shared furniture for /privacy and /terms.
//
// One module so the two documents cannot drift in the ways that matter: the review warning reads
// identically on both, and the cross-links are generated rather than typed. The consent screen and
// the sharing settings share a module for the same reason, and for the same lesson — the first
// draft of the consent screen carried its own copy and promised a settings page that did not exist.
//
// B57.63 — drawn in Pocket (design/pocket s-privacy, s-terms): one narrow column on the page, each section
// numbered on its disc as the reference's rows are, the contents and the review notes as cloud cards. The words
// are unchanged.

/**
 * ReturnLink — the way out of a document that is otherwise a dead end.
 *
 * ⚠ WHY THIS EXISTS AT ALL. /privacy and /terms sit OUTSIDE the AuthGate, so neither renders the
 * app shell and neither has a sidebar. Browser-back covers the reader who clicked through; it does
 * nothing for the one who typed the URL, followed a link from elsewhere, or opened a new tab —
 * which is how a policy page is most often reached. For them the page had no exit at all.
 *
 * ⚠ WHAT IT RETURNS TO IS NOT A CONSTANT, because these pages are reached from both sides. The
 * marketing page, the sign-in and sign-up cards and the consent screen all link here for readers
 * with NO session; the sidebar links here for readers who have one. Sending a stranger to `/`
 * lands them on a sign-in card they never asked for, and sending a signed-in person to `/marketing`
 * ejects them from their own session onto a sales page. So the destination is decided, not chosen.
 *
 * ⚠ IT DOES NOT ADD A THIRD READER OF /auth/me. This is the same useQuery key, queryFn and
 * staleTime the gate and the session chip already use, so a signed-in reader arriving from the
 * sidebar hits a warm cache: no second request, no flash of the wrong destination. It also reuses
 * the GATE'S OWN PREDICATE (`mode === 'oidc' && !authenticated`) rather than a fresh reading of
 * the same fields — in `disabled` mode there is no session concept and the app renders, so `/` is
 * correct there and a naive `!authenticated` test would have sent every local dev run to marketing.
 *
 * ⚠ AND `/` IS THE ANSWER WHEN WE DO NOT KNOW YET. The probe may be in flight or may have failed,
 * and the reader whose network just hiccuped is the one least able to guess a URL — so the way out
 * must render regardless. `/` is the one address that resolves ITSELF by auth state (signed in →
 * the app; signed out → the sign-in card), so it is never a dead end in either direction; it is
 * only less specific than /marketing would have been. `/marketing` is used exactly when the probe
 * has affirmatively said the reader has no session.
 *
 * Deliberately one small muted link and not a nav bar. The instinct that a policy should not carry
 * product chrome was right; what was missing is a way out, and that is a different thing.
 */
function ReturnLink() {
  const q = useAuthMeReader()
  const signedOut = q.data?.mode === 'oidc' && !q.data.authenticated
  return (
    <Link
      to={signedOut ? '/marketing' : '/'}
      className={`text-body text-ink-3 ${inlineLink}`}
    >
      ‹ Back to Talyvor
    </Link>
  )
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/** '2026-10-05' → '5 October 2026'. Read as a calendar date, never through a time zone, so the
 *  page says the same day wherever it is opened. */
export function longDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  return `${d} ${MONTHS[m - 1]} ${y}`
}

/** A section's anchor, from its title: "⚠ Deleting your data" → "deleting-your-data". */
export function sectionId(title: string) {
  return title
    .replace(/⚠/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function Updated({ updated }: { updated: string }) {
  return <time dateTime={updated}>{longDate(updated)}</time>
}

function LegalHeader({ title, updated }: { title: string; updated: string }) {
  // The tab is told the SAME prop the h1 paints, from the one component both legal pages share.
  // Setting it in Privacy.tsx and Terms.tsx instead would be two more places a page name lives.
  useDocumentTitle(title)
  return (
    <header className="mb-8">
      <div className="mb-8">
        <ReturnLink />
      </div>
      <Eyebrow>Talyvor</Eyebrow>
      <h1 className="mt-3 font-display text-display-1 font-extrabold text-ink">{title}</h1>
      <p className="mt-3 text-body text-ink-3">
        Last updated <Updated updated={updated} />. Written from the code.{' '}
        <Link className={inlineLink} to={title === 'Privacy' ? '/terms' : '/privacy'}>
          {title === 'Privacy' ? 'Terms' : 'Privacy'}
        </Link>
      </p>
    </header>
  )
}

/** Every section of the document, listed before the first one, so a reader sees the whole of it
 *  — and where it ends — before scrolling. */
function Contents({ titles }: { titles: string[] }) {
  return (
    <nav id="on-this-page" aria-label="On this page" className="mb-10 rounded-card bg-cloud p-5">
      <Eyebrow>On this page</Eyebrow>
      <ol className="mt-3 flex flex-col gap-1.5 text-body">
        {titles.map((t) => (
          <li key={t}>
            <a className={`text-ink-2 ${inlineLink}`} href={`#${sectionId(t)}`}>
              {t}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  )
}

/** The document's last line, so its end reads as an end and not as a page that stopped loading. */
function EndOf({ title, updated }: { title: string; updated: string }) {
  return (
    <p className="mt-12 border-t border-line pt-6 text-body text-ink-3">
      End of {title}. Last updated <Updated updated={updated} />.{' '}
      <a className={inlineLink} href="#on-this-page">
        Back to the contents
      </a>
    </p>
  )
}

/**
 * LawyerReview — an explicit, visible marker that a draft is a draft.
 *
 * Deliberately not a footnote. A document that reads as final and is not is worse than no document:
 * the reader cannot tell which parts were checked by someone qualified. `compact` marks a single
 * clause; the full form marks a whole document.
 */
export function LawyerReview({
  children,
  compact = false,
  label,
}: {
  children: React.ReactNode
  compact?: boolean
  /** B27.38 — the marker's own words, where a clause is new rather than a known gap. */
  label?: string
}) {
  return (
    <div className={'bg-cloud ' + (compact ? 'mt-4 rounded-card-tight px-4 py-3.5' : 'mb-10 rounded-card p-5')}>
      <div className="text-body font-bold text-ink">
        {label ?? (compact ? 'Needs legal review' : 'Draft: needs legal review before it is relied on')}
      </div>
      <p className="mt-1 text-reading text-ink-2">{children}</p>
    </div>
  )
}

/**
 * LegalPage — the frame both documents sit in (B29.13): the site's logo header and footer, and
 * between them a reading column on canvas at the 15/24 reading step, left on the same edge as the
 * logo. `max-w-lg` (32rem) is what sets about 65 characters a line: measured in Chrome, a full line
 * here holds 66 on median. `max-w-prose` (65ch) set 82, because a `ch` is the width of a zero and
 * Space Grotesk's zero is wider than its average letter.
 *
 * `main` holds the whole document, title block included, so a reader deciding whether to hand us
 * their data can jump straight to it; LandmarkCoverage.test.tsx holds the proportion. The company
 * line (B32.2) is in the footer, as on every other page of the website.
 *
 * `updated` is the day the document's words last changed, as YYYY-MM-DD (B28.274): change it in
 * the same commit as the words. The contents list is read from the page's own `Section`s, so it
 * cannot name a section that is not there; it goes before the first one, after the draft warning.
 */
export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string
  updated: string
  children: React.ReactNode
}) {
  const kids = Children.toArray(children)
  const isSection = (k: (typeof kids)[number]): k is ReactElement<{ title: string }> =>
    isValidElement(k) && k.type === Section
  const sections = kids.filter(isSection)
  const first = sections.length > 0 ? kids.indexOf(sections[0]) : kids.length
  return (
    <div data-design="pocket" className="flex min-h-full flex-col bg-page text-ink">
      <PublicHeader />
      <main className="flex-1">
        {/* pocket.css .ssec.narrow: one narrow column. */}
        <div className="mx-auto w-full max-w-4xl px-gutter pb-4 pt-14">
          <div className="max-w-2xl text-reading">
            <LegalHeader title={title} updated={updated} />
            {kids.slice(0, first)}
            {sections.length > 0 && <Contents titles={sections.map((s) => s.props.title)} />}
            {kids.slice(first).map((k) => (isSection(k) ? <Numbered key={k.key} n={sections.indexOf(k) + 1} section={k} /> : k))}
            <EndOf title={title} updated={updated} />
          </div>
        </div>
      </main>
      <PublicFooter />
    </div>
  )
}

/**
 * A section beside its number on a disc, as pocket.css's .mrow draws a row. The disc sits outside the <section>, so
 * the section reads, and is quoted, as its words alone.
 */
function Numbered({ n, section }: { n: number; section: ReactElement }) {
  return (
    <div className="mb-10 flex gap-3 border-t border-line pt-6">
      <span aria-hidden="true" className="inline-grid h-7 w-7 shrink-0 place-items-center rounded-pill bg-tangerine-50 font-figure text-caption font-bold text-tangerine-ink">
        {n}
      </span>
      <div className="min-w-0 flex-1">{section}</div>
    </div>
  )
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section id={sectionId(title)} className="scroll-mt-6 wide:scroll-mt-20">
      <h2 className="mb-4 font-display text-head font-bold text-ink">{title}</h2>
      {children}
    </section>
  )
}
