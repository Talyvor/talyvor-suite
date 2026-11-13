import type { ReactNode } from 'react'
import { Button, Card, Facts } from '@talyvor/ui/pocket'
import { COMPANY_CONTACT } from '../../company'
import { formatCents } from '../lens/topupApi'
import { CONTRACTED, included, ownKeys } from './PriceCard'
import { formatBPS, formatLimit, formatMinor, planName, type Fees, type PlanGate, type Pricing } from './pricingApi'
import { StatusLabel } from '../../labels/StatusLabel'
import { MONEY_FEATURES } from '../../labels/capabilities'

// B57.61 — /pricing in Pocket (design/pocket s-pricing). The plan cards and both fee lists, drawn in
// Pocket's components for /pricing alone; /plans keeps PriceCard.tsx's CompanyCard, in today's design, until its own
// B57 item. Every figure is still served (pricingApi.ts), and every label is the one B56.10 placed. B59.5: no row or
// fee for a hidden area (LAUNCH-PACK.md section 2): no Edge, no Marketplace, compute or loan fee.
//
// Prices are Figtree's tabular figures (font-figure), as every money figure outside <Money> is; the reference's
// display face for them needs <Money>'s provider, which a public page rendered bare does not have.

/** The company plan drawn highlighted: Team, as the reference draws it. A mark of where most companies start, not a
 *  claim that it sells most, so no words go with it. */
const HIGHLIGHTED_PLAN = 'team'

/** One row of a plan card: pocket.css .prows, the label (and its chip) over what the plan gives. */
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

/** A price as pocket.css .pprice draws it: the figure in the display face, its words small beside it. */
function PlanPrice({ id, pricing }: { id: string; pricing: Pricing }) {
  const listed = pricing.company_plans?.find((p) => p.id === id)
  const cents =
    id === CONTRACTED ? pricing.enterprise_from_usd_cents : listed ? listed.usd_cents : id === 'free' ? 0 : undefined
  if (cents === undefined) {
    return <p className="text-body text-ink-2">Price not stated by this deployment just now</p>
  }
  return (
    <p className="flex flex-wrap items-baseline gap-1.5">
      {id === CONTRACTED ? <span className="text-body font-semibold text-ink-3">From</span> : null}
      <span data-testid={`price-${id}`} className="font-figure text-pocket-balance-sm font-extrabold text-ink">
        {formatCents(cents)}
      </span>
      {/* Free has no price, so nothing is "a month" about it. */}
      {cents > 0 ? <span className="text-body font-semibold text-ink-3">a month</span> : null}
    </p>
  )
}

/** One company plan on /pricing: its price, what it unlocks and its fees, each row with the label B56.10 gives it. */
function PlanCard({ id, gate, pricing }: { id: string; gate: PlanGate; pricing: Pricing }) {
  const name = planName(id)
  const fees = pricing.fees
  const contracted = id === CONTRACTED
  const fx = fees?.fx_margin_bps[id]
  const built = pricing.plan_gates?.built
  const highlighted = id === HIGHLIGHTED_PLAN
  // B51.3 — a plan's button only while a card can be charged; until then the page's one action is Create your workspace.
  const action =
    pricing.card_payments !== 'live' ? null : contracted ? (
      <a href={`mailto:${COMPANY_CONTACT}`}>Talk to us</a>
    ) : id === 'free' ? (
      <a href="/signup">Start free</a>
    ) : (
      <a href="/plans">Choose {name}</a>
    )
  return (
    <div
      data-testid={`company-plan-${id}`}
      data-highlighted={highlighted ? 'true' : undefined}
      className={`grid content-start gap-3 rounded-card p-6 ${highlighted ? 'bg-page shadow-pocket ring-2 ring-inset ring-ink' : 'bg-cloud'}`}
    >
      <p className="font-display text-bar font-bold text-ink">{name}</p>
      <PlanPrice id={id} pricing={pricing} />
      {action ? (
        <div>
          <Button asChild variant="outline" size="sm">
            {action}
          </Button>
        </div>
      ) : null}
      <dl className="m-0 grid">
        <PlanRow label="Agents">
          <span className="font-figure">{formatLimit(gate.agents)}</span>
        </PlanRow>
        <PlanRow label="Seats">
          <span className="font-figure">{formatLimit(gate.seats)}</span>
        </PlanRow>
        {fees ? (
          <PlanRow label="Platform fee on AI spend">
            {contracted ? 'Agreed' : <span className="font-figure">{formatBPS(fees.platform_fee_bps[id] ?? 0)}</span>}
          </PlanRow>
        ) : null}
        <PlanRow label="Own provider keys">{ownKeys(gate, pricing)}</PlanRow>
        <PlanRow label="Live money" chip={gate.live_money ? <StatusLabel capability={MONEY_FEATURES} labels={pricing.labels} /> : null}>
          {included(gate.live_money)}
        </PlanRow>
        <PlanRow label="Single sign-on" chip={gate.sso && built?.sso !== true ? <StatusLabel building="sso" /> : null}>
          {included(gate.sso)}
        </PlanRow>
        <PlanRow label="Audit export">{included(gate.audit_export)}</PlanRow>
        <PlanRow
          label="Slack and Teams approvals"
          chip={gate.slack_teams_approvals && built?.slack_teams_approvals !== true ? <StatusLabel building="slack_teams_approvals" /> : null}
        >
          {included(gate.slack_teams_approvals)}
        </PlanRow>
        {fees ? (
          <PlanRow
            label="FX margin over the reference rate"
            chip={
              contracted || fx ? <StatusLabel capability="fx" labels={pricing.labels} /> : null
            }
          >
            {contracted ? 'Agreed' : fx ? <span className="font-figure">{formatBPS(fx)}</span> : 'Not offered'}
          </PlanRow>
        ) : null}
      </dl>
    </div>
  )
}

/** For companies: each plan Lens gates, from the smallest up. */
export function CompanyPlans({ pricing }: { pricing: Pricing }) {
  const gates = pricing.plan_gates
  if (!gates) {
    return (
      <p className="max-w-xl text-body text-ink-2">
        What each plan includes could not be read from this deployment just now, so no plan is printed here.
      </p>
    )
  }
  return (
    <div className="grid gap-4 wide:grid-cols-2 lg:grid-cols-4">
      {gates.order.map((id) => (
        <PlanCard key={id} id={id} gate={gates.plans[id]} pricing={pricing} />
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

/** What a request costs: each plan's platform fee as served, on its own line (B56.2). */
export function RequestCost({ fees, planIds }: { fees: Fees; planIds: string[] }) {
  const ids = planIds.length > 0 ? planIds : Object.keys(fees.platform_fee_bps)
  return (
    <Facts
      className="mt-3"
      facts={ids.map((id) => ({
        label: planName(id),
        value: id === CONTRACTED ? 'Agreed' : formatBPS(fees.platform_fee_bps[id] ?? 0),
      }))}
    />
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
  const fx = planIds
    .filter((id) => id !== 'free')
    .map((id) => `${planName(id)} ${id === CONTRACTED ? 'agreed' : formatBPS(fees.fx_margin_bps[id] ?? 0)}`)
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
