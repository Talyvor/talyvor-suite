import { Button, Card, Eyebrow } from '@talyvor/ui/pocket'
import { useDocumentTitle } from '../../documentTitle'
import { formatCents, formatLXC, lxcForCents } from '../lens/topupApi'
import { cardPayments, formatPeg, usePricing, type PricingState } from './pricingApi'
import { PublicFooter, PublicHeader } from '../../components/SiteChrome'
import { TAX_LINE } from './PriceCard'
import { CompanyPlans, FeesOnAnyPlan, IndividualPlans, MoneyFeatureFees, RequestCost } from './PricingPlans'
import { LABEL_LINES, StatusLabel } from '../../labels/StatusLabel'
import { CREDIT_FOR_AGENTS, MARKETPLACE } from '../../labels/capabilities'
import { POSITIONING_LINE } from '../../positioning'

// /pricing (B5.2) — what anything costs, for a buyer who has not signed up. Public, OUTSIDE the
// AuthGate like /marketing, and built the same way: no router context, plain anchors.
//
// ⚠ EVERY FIGURE IS SERVED. The peg, the plans, the gates and the fees come from GET /api/pricing (see
// pricingApi.ts). What is written here is only the RULES the figures obey — how a request is charged — each read
// from talyvor-lens:
//   request charge   internal/proxy/agent_allocator.go settleReservationBasis:
//                    ceil(delivered USD / peg × 1e6) µLXC — the model's catalog rate, rounded UP
//   platform fee     internal/economy/platform_fee.go: the plan's platform_fee_bps, its own row (B56.2)
//
// B57.61 — the page is Pocket's (design/pocket s-pricing): the headline and Create your workspace, the four company
// plans with Team highlighted, credit for agents and what a request costs, the chat plans, the Marketplace bill, the
// fees on any plan and on money features, what the labels mean and the tax line. The served-rate card, the list of
// top-up amounts and the monthly-billing line are left out: the headline states the rate, and the billing screen
// sells the top-ups.

/** The amount the headline converts at the served rate. An AMOUNT, not a price: what it buys is computed. */
const EXAMPLE_CENTS = 1000

/** The headline's second line: the served rate and what the example amount buys at it, or nothing unconfirmed. */
function RateLine({ state }: { state: PricingState }) {
  const peg = state.status === 'ok' ? state.pricing.usd_per_lxc : undefined
  const lxc = lxcForCents(EXAMPLE_CENTS, peg)
  if (typeof peg !== 'number' || lxc === null) return null
  return (
    <>
      {' '}
      <span className="font-figure">1 LXC</span> is <span className="font-figure">{formatPeg(peg)}</span>, so{' '}
      <span className="font-figure">{formatCents(EXAMPLE_CENTS)}</span> buys <span className="font-figure">{formatLXC(lxc)}</span>.
    </>
  )
}

/** A section heading in Pocket's display face (pocket.css .ssec h2), with any chip beside it. */
function SectionHeading({ id, children, chip }: { id: string; children: React.ReactNode; chip?: React.ReactNode }) {
  return (
    <h2 id={id} className="flex flex-wrap items-center gap-3 font-display text-display-2 font-extrabold text-ink">
      <span>{children}</span>
      {chip}
    </h2>
  )
}

/** One band of the page: pocket.css .ssec. */
function Band({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <section aria-labelledby={label} className={`mx-auto w-full max-w-6xl px-gutter pt-14 wide:px-12 ${className}`}>
      {children}
    </section>
  )
}

/** pocket.css .split2: words on the left, a card on the right, seven parts to five, from 840px. */
function Split({ left, right }: { left: React.ReactNode; right: React.ReactNode }) {
  return (
    <div className="grid items-center gap-8 wide:grid-cols-12">
      <div className="wide:col-span-7">{left}</div>
      <div className="wide:col-span-5">{right}</div>
    </div>
  )
}

export function Pricing() {
  useDocumentTitle('Pricing')
  const state = usePricing()
  const cards = cardPayments(state) === 'live'
  // B56.10: Lens's Live or Sandbox for each money section; none until /api/pricing answers with labels.
  const labels = state.status === 'ok' ? state.pricing.labels : undefined
  const pricing = state.status === 'ok' ? state.pricing : undefined
  return (
    <div data-design="pocket" className="flex min-h-full flex-col bg-page text-ink">
      <PublicHeader current="/pricing" width="max-w-6xl" />

      <main className="flex-1">
        <section aria-labelledby="pricing-heading" className="mx-auto grid w-full max-w-6xl justify-items-center gap-1 px-gutter pt-14 text-center wide:px-12">
          <Eyebrow>{POSITIONING_LINE.replace(/\.$/, '')}</Eyebrow>
          <h1 id="pricing-heading" className="mt-3 max-w-3xl font-display text-display-1 font-extrabold text-ink">
            Credit for your agents. A plan for your people.
          </h1>
          <p className="mt-3 max-w-2xl text-lede text-ink-2">
            Every plan has wallets, rules, approvals and statements.
            <RateLine state={state} />
          </p>
          <div className="mt-5">
            <Button asChild variant="primary" size="lg">
              <a href="/signup">Create your workspace</a>
            </Button>
          </div>
        </section>

        <Band label="plans-heading">
          <h2 id="plans-heading" className="sr-only">
            Plans for companies
          </h2>
          {pricing ? (
            <CompanyPlans pricing={pricing} />
          ) : state.status === 'loading' ? (
            <p className="text-body text-ink-2">Reading the price card…</p>
          ) : (
            <p className="max-w-xl text-body text-ink-2">
              The price card could not be read from this deployment just now, so no price is printed here.
            </p>
          )}
        </Band>

        <Band label="credit-heading">
          <Split
            left={
              <>
                <SectionHeading id="credit-heading" chip={<StatusLabel capability={CREDIT_FOR_AGENTS} labels={labels} />}>
                  Credit for agents
                </SectionHeading>
                <p className="mt-5 text-lede text-ink-2">
                  Each agent spends LXC from its own wallet. When its wallet is empty, its next call is refused rather than
                  billed to you, unless your company has a Talyvor credit line, which covers it and bills you once a month.
                </p>
              </>
            }
            right={
              <Card tone="white">
                <h3 className="font-display text-head font-bold text-ink">What a request costs</h3>
                <p className="mt-1 text-body text-ink-2">The model’s list price, and your plan’s platform fee on its own line:</p>
                {pricing?.fees ? (
                  <div data-testid="platform-fee-line">
                    <RequestCost fees={pricing.fees} planIds={pricing.plan_gates?.order ?? []} />
                  </div>
                ) : null}
              </Card>
            }
          />
        </Band>

        <Band label="chat-plans-heading">
          <SectionHeading id="chat-plans-heading">Chat plans, for one person</SectionHeading>
          <div className="mt-6">
            {pricing ? <IndividualPlans pricing={pricing} /> : null}
          </div>
        </Band>

        <Band label="marketplace-bill-heading">
          <Split
            left={
              <SectionHeading id="marketplace-bill-heading" chip={<StatusLabel capability={MARKETPLACE} labels={labels} />}>
                Paid listings, on one bill a month.
              </SectionHeading>
            }
            right={
              <div className="grid gap-4">
                <p className="text-lede text-ink-2">
                  Agents, prompts, skills and evaluations other teams publish on the Marketplace. Each use of a paid listing,
                  by you or one of your agents, is charged the price the listing shows and billed {cards ? 'on your card ' : ''}
                  once a month, never taken from your credits.
                </p>
                <p className="text-lede text-ink-2">The models a listing calls are charged like any other request, not on this bill.</p>
              </div>
            }
          />
        </Band>

        <Band label="fees-heading">
          <Split
            left={
              <>
                <SectionHeading id="fees-heading">Fees on any plan</SectionHeading>
                <p className="mt-5 text-lede text-ink-2">Taken from each sale or payment.</p>
              </>
            }
            right={pricing ? <FeesOnAnyPlan fees={pricing.fees} labels={labels} /> : null}
          />
        </Band>

        {pricing?.fees ? (
          <Band label="money-fees-heading">
            <Split
              left={<SectionHeading id="money-fees-heading">Fees on money features</SectionHeading>}
              right={<MoneyFeatureFees fees={pricing.fees} planIds={pricing.plan_gates?.order ?? []} labels={labels} />}
            />
          </Band>
        ) : null}

        <Band label="labels-heading">
          <div data-testid="labels-meaning">
            <p id="labels-heading" className="text-pocket-eyebrow uppercase text-ink-3">
              What the labels mean
            </p>
            <dl className="mt-3 grid gap-4 wide:grid-cols-3">
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

        <section aria-label="Tax" className="mx-auto w-full max-w-6xl px-gutter pb-4 pt-10 wide:px-12">
          <p data-testid="tax-line" className="text-body text-ink-3">
            {TAX_LINE}
          </p>
        </section>
      </main>

      <PublicFooter width="max-w-6xl" />
    </div>
  )
}
