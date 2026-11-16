import { Button, Eyebrow } from '@talyvor/ui/pocket'
import { useDocumentTitle } from '../../documentTitle'
import { usePricing, type Pricing as PricingRead } from './pricingApi'
import { PublicFooter, PublicHeader } from '../../components/SiteChrome'
import { LADDER_TAX_LINE } from './PriceCard'
import { FeesOnAnyPlan, MoneyFeatureFees, PlanLadderCards } from './PricingPlans'
import { LABEL_LINES, StatusLabel } from '../../labels/StatusLabel'
import { POSITIONING_LINE } from '../../positioning'

// /pricing (B5.2) — what anything costs, for a buyer who has not signed up. Public, OUTSIDE the
// AuthGate like /marketing, and built the same way: no router context, plain anchors.
//
// ⚠ EVERY FIGURE IS SERVED. The ladders and the fees come from GET /api/pricing (see pricingApi.ts); nothing here is a
// price, a count or a fee.
//
// B61.59 — the plans are Lens's two ladders (GET /v1/public/plans), for a person and for a company, with no 5 Oct plan
// left; the rate line and Credit for agents, both in LXC, are gone with them.
//
// B57.61 — the page is Pocket's (design/pocket s-pricing): the headline and Create your workspace, the four company
// plans with Team highlighted, credit for agents and what a request costs, the fees on any plan and on money features,
// what the labels mean and the tax line. The served-rate card, the list of top-up amounts and the monthly-billing line
// are left out: the headline states the rate, and the billing screen sells the top-ups. B59.5: the chat plans and the
// Marketplace bill are left out too, with every other hidden area (LAUNCH-PACK.md section 2).

/** The priced plans of both ladders, Custom (by contract) left out: the FX line names each plan's margin. */
function pricedPlanIds(pricing: PricingRead): string[] {
  const l = pricing.ladders
  return l ? [...l.personal, ...l.business].filter((p) => !p.by_contract).map((p) => p.id) : []
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
          </p>
          <div className="mt-5">
            <Button asChild variant="primary" size="lg">
              <a href="/signup">Create your workspace</a>
            </Button>
          </div>
        </section>

        <Band label="plans-heading">
          <h2 id="plans-heading" className="sr-only">
            Plans
          </h2>
          {pricing ? (
            <PlanLadderCards pricing={pricing} />
          ) : state.status === 'loading' ? (
            <p className="text-body text-ink-2">Reading the price card…</p>
          ) : (
            <p className="max-w-xl text-body text-ink-2">
              The price card could not be read from this deployment just now, so no price is printed here.
            </p>
          )}
        </Band>

        <Band label="fees-heading">
          <Split
            left={
              <>
                <SectionHeading id="fees-heading">Fees on any plan</SectionHeading>
                <p className="mt-5 text-lede text-ink-2">Taken from each payment.</p>
              </>
            }
            right={pricing ? <FeesOnAnyPlan fees={pricing.fees} labels={labels} /> : null}
          />
        </Band>

        {pricing?.fees ? (
          <Band label="money-fees-heading">
            <Split
              left={<SectionHeading id="money-fees-heading">Fees on money features</SectionHeading>}
              right={<MoneyFeatureFees fees={pricing.fees} planIds={pricedPlanIds(pricing)} labels={labels} />}
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
            {LADDER_TAX_LINE}
          </p>
        </section>
      </main>

      <PublicFooter width="max-w-6xl" />
    </div>
  )
}
