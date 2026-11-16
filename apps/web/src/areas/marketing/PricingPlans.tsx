import type { ReactNode } from 'react'
import { Button, Card } from '@talyvor/ui/pocket'
import { COMPANY_CONTACT } from '../../company'
import { formatBPS, formatLimit, formatMinor, planName, type Fees, type LadderPlan, type PlanLadders, type Pricing } from './pricingApi'
import { StatusLabel } from '../../labels/StatusLabel'

// B57.61 — /pricing in Pocket (design/pocket s-pricing). The plan cards and both fee lists, drawn in
// Pocket's components. B61.59: the plan cards are Lens's two ladders (GET /v1/public/plans), for a person and for a
// company, and no 5 Oct plan is left. Every figure is still served (pricingApi.ts), and every label is the one B56.10 placed. B59.5: no row or
// fee for a hidden area (LAUNCH-PACK.md section 2): no Edge, no Marketplace, compute or loan fee.
//
// Prices are Figtree's tabular figures (font-figure), as every money figure outside <Money> is; the reference's
// display face for them needs <Money>'s provider, which a public page rendered bare does not have.

/** A plan's monthly price in every currency Lens prices it in: "£3.99 · €3.99 · $3.99 a month", or By contract. */
function LadderPrice({ plan, currencies }: { plan: LadderPlan; currencies: string[] }) {
  if (plan.price_minor === null) return <p className="text-body font-semibold text-ink">By contract</p>
  const prices = currencies.filter((c) => typeof plan.price_minor?.[c] === 'number')
  return (
    <p className="flex flex-wrap items-baseline gap-1.5">
      <span data-testid={`price-${plan.id}`} className="font-figure text-bar font-extrabold text-ink">
        {prices.map((c) => formatMinor(plan.price_minor?.[c] ?? 0, c)).join(' · ')}
      </span>{' '}
      <span className="text-body font-semibold text-ink-3">a month</span>
    </p>
  )
}

/** One plan of a ladder on /pricing: its price, agents, people and exchange fee, as Lens states them. */
function LadderCard({ plan, ladders, pricing }: { plan: LadderPlan; ladders: PlanLadders; pricing: Pricing }) {
  const fees = pricing.fees
  const fx = fees?.fx_margin_bps[plan.id]
  return (
    <div data-testid={`ladder-plan-${plan.id}`} className="grid content-start gap-3 rounded-card bg-cloud p-6">
      <p className="font-display text-bar font-bold text-ink">{plan.name}</p>
      <LadderPrice plan={plan} currencies={ladders.currencies} />
      {plan.by_contract ? (
        <div>
          <Button asChild variant="outline" size="sm">
            <a href={`mailto:${COMPANY_CONTACT}`}>Custom: talk to us</a>
          </Button>
        </div>
      ) : null}
      <dl className="m-0 grid">
        <PlanRow label="Agents">
          <span className="font-figure">{formatLimit(plan.agents)}</span>
        </PlanRow>
        <PlanRow label="People">
          <span className="font-figure">{formatLimit(plan.people)}</span>
        </PlanRow>
        {typeof fx === 'number' && !plan.by_contract ? (
          <PlanRow label="Exchange fee" chip={<StatusLabel capability="fx" labels={pricing.labels} />}>
            <span className="font-figure">{fx === 0 ? 'None' : formatBPS(fx)}</span>
          </PlanRow>
        ) : null}
      </dl>
    </div>
  )
}

/** One plan of a card: pocket.css .prows, the label (and its chip) over what the plan gives. */
function PlanRow({ label, chip, children }: { label: string; chip?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid gap-0.5 border-t border-line py-2 first:border-t-0">
      <dt className="flex flex-wrap items-center gap-1.5 text-micro font-semibold text-ink-3">
        <span>{label}</span>
        {chip}
      </dt>
      <dd className="m-0 text-body font-semibold text-ink">{children}</dd>
    </div>
  )
}

/** B61.59 — both ladders, from Lens's GET /v1/public/plans: for a person, then for a company. */
export function PlanLadderCards({ pricing }: { pricing: Pricing }) {
  const ladders = pricing.ladders
  if (!ladders) {
    return (
      <p className="max-w-xl text-body text-ink-2">
        The plans could not be read from this deployment just now, so no plan is printed here.
      </p>
    )
  }
  return (
    <div className="grid gap-10">
      {(['personal', 'business'] as const).map((type) => (
        <div key={type} data-testid={`ladder-${type}`} className="grid gap-4">
          <h3 className="font-display text-head font-bold text-ink">{type === 'personal' ? 'For a person' : 'For a company'}</h3>
          <div className={`grid gap-4 wide:grid-cols-2 ${type === 'personal' ? 'lg:grid-cols-3' : 'lg:grid-cols-4'}`}>
            {ladders[type].map((p) => (
              <LadderCard key={p.id} plan={p} ladders={ladders} pricing={pricing} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

/** One fee: pocket.css .facts2.stackv .fact, its name and chips over what it is. */
function FeeRow({ label, chips, children }: { label: string; chips?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid gap-1 border-t border-line py-2.5 first:border-t-0">
      <dt className="flex flex-wrap items-center gap-2 text-body text-ink-3">
        <span>{label}</span>
        {chips}
      </dt>
      <dd className="m-0 text-body font-semibold text-ink">{children}</dd>
    </div>
  )
}

/** A white card of fee rows on a cloud inset, as the reference's fee lists (pocket.css .card.white .facts2). */
function FeeList({ testId, children }: { testId: string; children: ReactNode }) {
  return (
    <Card tone="white">
      <dl data-testid={testId} className="m-0 grid rounded-inset bg-cloud px-3.5 py-0.5">
        {children}
      </dl>
    </Card>
  )
}

/** The fees on any plan, each as Lens states it. */
export function FeesOnAnyPlan({ fees, labels }: { fees: Fees | undefined; labels?: Record<string, string> }) {
  if (!fees) {
    return (
      <p className="max-w-xl text-body text-ink-2">
        The fees could not be read from this deployment just now, so none is printed here.
      </p>
    )
  }
  return (
    <FeeList testId="fees-any-plan">
      {/* Lens takes the services fee only on a payment to another company's agent. */}
      <FeeRow label="Services" chips={<StatusLabel capability="pay_another_owner" labels={labels} />}>
        <span className="font-figure">{formatBPS(fees.services_take_bps)}</span> of a payment to another company’s agent
      </FeeRow>
    </FeeList>
  )
}

/**
 * B51.1 — the fees of the money features, apart from the ones that apply on any plan. The FX margin is each plan's, as
 * the plan cards show it.
 */
export function MoneyFeatureFees({ fees, planIds, labels }: { fees: Fees; planIds: string[]; labels?: Record<string, string> }) {
  const fx = planIds.map((id) => `${planName(id)} ${formatBPS(fees.fx_margin_bps[id] ?? 0)}`)
  return (
    <FeeList testId="fees-money-features">
      <FeeRow label="International payments" chips={<StatusLabel capability="payments_out" labels={labels} />}>
        <span className="font-figure">{intlPaymentFees(fees)}</span> plus the partner’s cost
      </FeeRow>
      <FeeRow label="Agent cards" chips={<StatusLabel capability="agent_card" labels={labels} />}>
        Free to issue
      </FeeRow>
      <FeeRow
        label="Accepting payments"
        chips={
          <>
            <StatusLabel capability="merchant_acceptance" labels={labels} />
            {fees.charged?.merchant_fee_bps && fees.charged.merchant_a2a_fee_bps ? null : <StatusLabel building="merchant_fees" />}
          </>
        }
      >
        <span className="font-figure">{formatBPS(fees.merchant_fee_bps)}</span> plus card processing, or{' '}
        <span className="font-figure">{formatBPS(fees.merchant_a2a_fee_bps)}</span> from an account
      </FeeRow>
      {fx.length > 0 ? (
        <FeeRow
          label="FX margin over the reference rate"
          chips={<StatusLabel capability="fx" labels={labels} />}
        >
          <span className="font-figure">{fx.join(' · ')}</span>
        </FeeRow>
      ) : null}
    </FeeList>
  )
}

/** "a, b or c". */
function either(items: string[]): string {
  return items.length > 1 ? `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}` : items.join('')
}

/** Pounds, euros, dollars, then any other currency Lens states. */
const CURRENCY_ORDER = ['GBP', 'EUR', 'USD']

function intlPaymentFees(fees: Fees): string {
  const codes = Object.keys(fees.intl_payment_fee_minor).sort((a, b) => {
    const i = CURRENCY_ORDER.indexOf(a)
    const j = CURRENCY_ORDER.indexOf(b)
    return (i < 0 ? 99 : i) - (j < 0 ? 99 : j) || a.localeCompare(b)
  })
  return either(codes.map((c) => formatMinor(fees.intl_payment_fee_minor[c], c)))
}
