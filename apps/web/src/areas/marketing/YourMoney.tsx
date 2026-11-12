import { Card, Eyebrow } from '@talyvor/ui/pocket'
import { useDocumentTitle } from '../../documentTitle'
import { PublicFooter, PublicHeader } from '../../components/SiteChrome'
import { LABEL_LINES, type LabelState } from '../../labels/StatusLabel'
import { POSITIONING_LINE } from '../../positioning'
import { formatPeg, usePricing } from './pricingApi'

// /your-money (B57.62) — how a balance is held, who can move it and what stops a mistake, in the reference's words
// (design/pocket s-money). Public, OUTSIDE the AuthGate like /pricing, and built the same way: no router context,
// plain anchors.
//
// The peg is served (GET /api/pricing, as /pricing reads it); until it answers, point 1 says what LXC is without
// the rate. Points 3 and 4 say what B55.24 made true in Lens: a pull under a mandate is held to the mandate's limits
// and the agent's rules, and a mandate needs the owner's signed say. Point 8 reads the labels' words from B56.9.

const LABEL_WORDS: [LabelState, string][] = [
  ['live', 'Live'],
  ['sandbox', 'Sandbox'],
  ['building', 'Building'],
]

/** "Live: moves real money. Sandbox: works. …", each line as StatusLabel's legend says it. */
const LABELS_LINE = LABEL_WORDS.map(([s, word]) => `${word}: ${LABEL_LINES[s].charAt(0).toLowerCase()}${LABEL_LINES[s].slice(1)}`).join(' ')

function points(peg: number | undefined): { title: string; line: React.ReactNode }[] {
  return [
    {
      title: 'Your LXC balance is Talyvor credit',
      line: (
        <>
          {typeof peg === 'number' ? (
            <>
              <span className="font-figure">1 LXC</span> is <span className="font-figure">{formatPeg(peg)}</span>.{' '}
            </>
          ) : null}
          LXC is not money, not a deposit and not an investment: it is credit for using Talyvor.
        </>
      ),
    },
    {
      title: 'Accounts in dollars, pounds and euros',
      line: 'The company and each agent can hold accounts in dollars, pounds and euros, through a money partner.',
    },
    {
      title: 'Each agent has its own balance and its own rules',
      line: 'You give each agent what it may spend. Its rules cap what it spends, including marketplace uses that go on your monthly bill. A payee pulling under a mandate is held to the mandate’s limits and to the agent’s rules, and every mandate needs your signed say.',
    },
    {
      title: 'Rules are checked before anything moves',
      line: 'Limits for a request, a day and a month, payees, models and hours. A request that breaks a rule is refused. A pull under a mandate is checked against the mandate’s limits and the agent’s rules, and a mandate is granted only with your passkey.',
    },
    {
      title: 'Bigger payments wait for approval',
      line: 'Above the amount you set, a payment waits for approval from you or an approver you chose, unless you allowed it in advance. Once you add a passkey or your phone’s key, approving takes one of them, and an approval covers only what it names.',
    },
    {
      title: 'Everything is on a statement',
      line: 'Every movement of each agent’s credit, line by line, ready to download.',
    },
    {
      title: 'You can ask to cash it out',
      line: 'An owner can ask to turn an agent’s LXC back into money.',
    },
    { title: 'Labels tell you what is real', line: LABELS_LINE },
  ]
}

export function YourMoney() {
  useDocumentTitle('How your money is held')
  const state = usePricing()
  const peg = state.status === 'ok' ? state.pricing.usd_per_lxc : undefined
  return (
    <div data-design="pocket" className="flex min-h-full flex-col bg-page text-ink">
      <PublicHeader current="/your-money" />
      <main className="flex-1">
        {/* pocket.css .ssec.narrow: one narrow column. */}
        <section aria-labelledby="your-money-heading" className="mx-auto w-full max-w-4xl px-gutter pt-14">
          <Eyebrow>{POSITIONING_LINE.replace(/\.$/, '')}</Eyebrow>
          <h1 id="your-money-heading" className="mt-3 font-display text-display-1 font-extrabold text-ink">
            How your money is held
          </h1>
          <p className="mt-3 max-w-2xl text-lede text-ink-2">
            In plain words: what your balance is, who can move it, and what stops a mistake.
          </p>
          {/* pocket.css .mrow: the number on its disc, beside the point; a rule between points. */}
          <ol className="mt-4" data-testid="money-points">
            {points(peg).map((p, i) => (
              <li key={p.title} className="flex gap-4 border-t border-line py-4">
                <span aria-hidden="true" className="inline-grid h-7 w-7 shrink-0 place-items-center rounded-pill bg-tangerine-50 font-figure text-caption font-bold text-tangerine-ink">
                  {i + 1}
                </span>
                <div>
                  <h2 className="font-display text-head font-bold text-ink">{p.title}</h2>
                  <p className="mt-1 text-body text-ink-2">{p.line}</p>
                </div>
              </li>
            ))}
          </ol>
          <Card className="mt-4">
            <p className="font-semibold text-ink">Talyvor is not a bank.</p>
            <p className="mt-1 text-body text-ink-3">LXC is Talyvor credit, not money.</p>
          </Card>
        </section>
      </main>
      <PublicFooter />
    </div>
  )
}
