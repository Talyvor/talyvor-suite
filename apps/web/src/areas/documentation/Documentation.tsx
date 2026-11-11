import { inlineLink } from '@talyvor/ui'
import { Card, Eyebrow, pocketFocusRing } from '@talyvor/ui/pocket'
import { useDocumentTitle } from '../../documentTitle'
import {
  CAPABILITIES,
  CHANGE_DATE,
  CHANGE_LICENCE,
  CLAUDE_CONNECTOR_PATH,
  DOCUMENTATION_PATH,
  LENS_ORIGIN,
  LICENCES,
  START,
  licenceUrl,
  type Claim,
} from './content'
import lensRoutes from './lens-routes.json'
import { PublicFooter, PublicHeader } from '../../components/SiteChrome'
import { POSITIONING_LINE } from '../../positioning'
import { StatusLabel, buildingWords } from '../../labels/StatusLabel'
import { usePricing } from '../marketing/pricingApi'

// /documentation (B27.31) — what Talyvor does today, one claim per thing a person can do, each
// linked to the screen or route that does it. Public, OUTSIDE the AuthGate like /marketing and
// /pricing, and built the same way: no router context, plain anchors, Landing's instrument
// language. A signed-out reader who follows a link into the console meets the sign-in card there.
//
// ⚠ NOT /docs. /docs/* is the Docs product — the team wiki — and has been since before this page;
// mounting the documentation there would take the wiki's index away from every signed-in user.
//
// B57.63 — drawn in Pocket (design/pocket s-docs): the title, a card for each part of Talyvor opening its guide
// below, and the Claude connector; then each guide, the Lens API and the licences as Pocket's sections.

type Labels = Record<string, string> | undefined

function ClaimRow({ claim, labels }: { claim: Claim; labels: Labels }) {
  const building = claim.building ? buildingWords(claim.building.key, claim.building.until) : null
  return (
    <li className="flex flex-col gap-1 border-t border-line py-4 wide:flex-row wide:items-baseline wide:justify-between wide:gap-8">
      <div className="max-w-lg">
        <p className="flex flex-wrap items-center gap-2 text-reading text-ink">
          {claim.text}
          {claim.money ? <StatusLabel capability={claim.money} labels={labels} /> : null}
        </p>
        {claim.building && building ? (
          <p className="mt-1 flex flex-wrap items-center gap-2 text-body text-ink-3">
            {building}
            <StatusLabel building={claim.building.key} />
          </p>
        ) : null}
      </div>
      <a href={claim.href} className={`shrink-0 text-body font-semibold text-ink-2 ${inlineLink}`}>
        {claim.label}
      </a>
    </li>
  )
}

function Claims({ claims, labels }: { claims: Claim[]; labels?: Labels }) {
  return (
    <ul className="mt-6 border-b border-line">
      {claims.map((c) => (
        <ClaimRow key={`${c.href} ${c.text}`} claim={c} labels={labels} />
      ))}
    </ul>
  )
}

const ROUTE_COUNT = lensRoutes.groups.reduce((n, g) => n + g.routes.length, 0)

function LensReference() {
  return (
    <div className="mt-10 flex flex-col gap-3">
      {lensRoutes.groups.map((g) => (
        <details key={g.id} id={`lens-${g.id}`} className="scroll-mt-16 rounded-card bg-cloud">
          <summary className={`cursor-pointer list-none rounded-control px-5 py-4 ${pocketFocusRing}`}>
            <span className="font-display text-head font-bold text-ink">{g.title}</span>
            <span className="ml-3 font-figure text-caption text-ink-3">
              {g.routes.length} {g.routes.length === 1 ? 'route' : 'routes'}
            </span>
          </summary>
          <div className="border-t border-line px-5 py-4">
            <p className="max-w-lg text-reading text-ink-2">{g.about}</p>
            {g.screen ? (
              <p className="mt-2 text-body text-ink-3">
                In the app:{' '}
                <a href={g.screen.href} className={`text-ink ${inlineLink}`}>
                  {g.screen.label}
                </a>
              </p>
            ) : null}
            <table className="mt-4 w-full text-left">
              <thead>
                <tr className="text-micro font-semibold text-ink-3">
                  <th scope="col" className="py-2 pr-4">
                    Method
                  </th>
                  <th scope="col" className="py-2 pr-4">
                    Path
                  </th>
                  <th scope="col" className="py-2">
                    What it does
                  </th>
                </tr>
              </thead>
              <tbody>
                {g.routes.map((r) => (
                  <tr key={`${r.method} ${r.path}`} className="border-t border-line align-baseline">
                    <td className="py-2 pr-4 font-mono text-caption text-ink-3">{r.method}</td>
                    <td className="break-all py-2 pr-4 font-mono text-caption text-ink">{r.path}</td>
                    <td className="py-2 text-body text-ink-2">{r.does}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ))}
    </div>
  )
}


// B28.15 — the guides first, Agent Wallets leading them, then the Lens API reference.
const CONTENTS: Array<{ id: string; label: string }> = [
  { id: 'start', label: 'Start here' },
  ...CAPABILITIES.map((c) => ({ id: c.id, label: c.name })),
  { id: 'lens', label: 'Lens API' },
  { id: 'licences', label: 'Licences' },
]

// B57.63 — the reference's cards, in its order and with its words: each opens that part's guide on this page.
// B59.37 — the launch pack's parts only.
const PARTS: Array<{ id: string; line: string }> = [{ id: 'wallets', line: 'Wallets, rules, approvals and statements' }]

/** One part of the page: its eyebrow, its heading and what follows, on the page's one column. */
function Part({ id, eyebrow, heading, children }: { id: string; eyebrow: string; heading: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="mx-auto w-full max-w-5xl scroll-mt-16 px-gutter pt-14">
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 id={`${id}-heading`} className="mt-2 max-w-2xl font-display text-display-2 font-extrabold text-ink">
        {heading}
      </h2>
      {children}
    </section>
  )
}

export function Documentation() {
  useDocumentTitle('Documentation')
  // B56.10: Lens's Live or Sandbox beside each claim that moves money, from the public read /pricing makes.
  const pricing = usePricing()
  const labels = pricing.status === 'ok' ? pricing.pricing.labels : undefined
  return (
    <div data-design="pocket" className="flex min-h-full flex-col bg-page text-ink">
      <PublicHeader current={DOCUMENTATION_PATH} />

      <main className="flex-1">
        <section aria-labelledby="documentation-heading" className="mx-auto w-full max-w-5xl px-gutter pt-14">
          <h1 id="documentation-heading" className="font-display text-display-1 font-extrabold text-ink">
            Documentation
          </h1>
          <p className="mt-3 max-w-2xl text-lede text-ink-2">How each part of Talyvor works, and every route of its API.</p>
          <p className="mt-3 max-w-2xl text-body text-ink-3">
            {POSITIONING_LINE} Today every AI agent gets a wallet: a
            budget, spending rules, approvals and a live statement, and Lens checks the rules
            before the model is called or the payment moves. Every line below is something you can do now. Each links to the screen that does it, or
            names the API route. Nothing here is planned work.
          </p>
          <ul aria-label="Parts of Talyvor" className="mt-6 grid gap-4 wide:grid-cols-3">
            {PARTS.map((p) => {
              const c = CAPABILITIES.find((x) => x.id === p.id)!
              return (
                <li key={p.id} className="grid">
                  <a href={`#${p.id}`} className={`grid content-start gap-1 rounded-card bg-page p-5 shadow-pocket ${pocketFocusRing}`}>
                    <b className="text-reading font-bold text-ink">{c.name}</b>
                    <span className="text-body text-ink-3">{p.line}</span>
                  </a>
                </li>
              )
            })}
          </ul>
          <Card className="mt-4">
            <b className="text-reading font-bold text-ink">Talyvor for Claude</b>
            <p className="mt-1 text-body text-ink-3">
              Add Talyvor to Claude and ask about your agents and bills.{' '}
              <a href={CLAUDE_CONNECTOR_PATH} className={`font-semibold text-ink ${inlineLink}`}>
                The Claude connector
              </a>
            </p>
          </Card>
          <nav aria-label="On this page" className="mt-8">
            <ul className="flex flex-wrap gap-x-6 gap-y-2 text-body">
              {CONTENTS.map((c) => (
                <li key={c.id}>
                  <a href={`#${c.id}`} className={`font-semibold text-ink-2 ${inlineLink}`}>
                    {c.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </section>

        <Part id="start" eyebrow="Start here" heading="From sign-up to an agent spending from its own wallet.">
          <Claims claims={START} />
        </Part>

        {CAPABILITIES.map((c) => (
          <Part key={c.id} id={c.id} eyebrow={c.role} heading={c.name}>
            <p className="mt-3 max-w-2xl text-reading text-ink-2">{c.lede}</p>
            <Claims claims={c.claims} labels={labels} />
          </Part>
        ))}

        <Part id="lens" eyebrow="Lens API" heading="One API for every model call and every agent payment.">
          <div className="mt-4 grid gap-x-12 gap-y-4 wide:grid-cols-2">
            <p className="max-w-lg text-reading text-ink-2">
              Lens is hosted at <span className="font-mono text-ink">{LENS_ORIGIN}</span>. Every
              route except the public ones takes your key as{' '}
              <span className="font-mono text-ink">Authorization: Bearer &lt;key&gt;</span> or{' '}
              <span className="font-mono text-ink">X-Talyvor-Key: &lt;key&gt;</span>. The{' '}
              <span className="font-mono text-ink">{'{wsID}'}</span> in a path is your workspace’s id,
              and a key only reaches its own workspace.
            </p>
            <p className="max-w-lg text-reading text-ink-2">
              Below is every route a customer can call, <span className="font-figure">{ROUTE_COUNT}</span> of them, read from Lens’s
              source and each answered by hosted Lens. Admin and operator routes are not
              listed. The core routes are also described in Lens’s{' '}
              <a href={`${LENS_ORIGIN}/openapi.json`} className={`text-ink ${inlineLink}`}>
                OpenAPI document
              </a>
              , and its{' '}
              <a href={`${LENS_ORIGIN}/status`} className={`text-ink ${inlineLink}`}>
                status page
              </a>{' '}
              says whether it is up.
            </p>
          </div>
          <LensReference />
        </Part>

        <Part id="licences" eyebrow="Licences" heading="Source-available, not open source.">
          <p className="mt-3 max-w-2xl text-reading text-ink-2">
            Each repository is under the Business Source License 1.1, which lets you read the source
            and use it on the terms in its LICENSE file; it is not an open-source licence. On the
            Change Date, <span className="font-figure text-ink">{CHANGE_DATE}</span> (or four years
            after a version is first published, if that comes first), that version becomes available
            under the {CHANGE_LICENCE}. The LICENSE file in each repository is the authority.
          </p>
          <ul className="mt-6 border-b border-line">
            {LICENCES.map((l) => (
              <li
                key={l.repo}
                className="flex flex-col gap-1 border-t border-line py-4 wide:flex-row wide:items-baseline wide:justify-between wide:gap-8"
              >
                <div className="max-w-lg">
                  <p className="font-mono text-body text-ink">{l.repo}</p>
                  <p className="text-body text-ink-3">{l.what}</p>
                </div>
                <div className="shrink-0 text-body text-ink-3 wide:text-right">
                  <a href={licenceUrl(l.repo)} className={`text-ink ${inlineLink}`}>
                    {l.licence}
                  </a>
                  {l.except ? <p className="max-w-xs">Except: {l.except}.</p> : null}
                </div>
              </li>
            ))}
          </ul>
        </Part>
      </main>

      <PublicFooter />
    </div>
  )
}
