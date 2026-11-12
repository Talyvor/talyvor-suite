import type { ReactNode } from 'react'
import { Button } from '@talyvor/ui'
import { COMPANY_CONTACT } from '../../company'
import { formatCents } from '../lens/topupApi'
import { formatBPS, formatLimit, planName, type PlanGate, type Pricing } from './pricingApi'
import { StatusLabel } from '../../labels/StatusLabel'
import { MONEY_FEATURES } from '../../labels/capabilities'

// B32.14 — the approved price card (Nicolai's decision of 5 Oct 2026), drawn on /plans from GET /api/pricing. Since
// B57.61 /pricing draws the same figures in Pocket (PricingPlans.tsx), with the helpers exported here.
//
// ⚠ EVERY FIGURE IS SERVED. Team's and Business's prices, BYOK's as Team's add-on and where Enterprise starts
// are Lens's public plans read; Plus, Pro and Max with their included usage the same read; what each company
// plan unlocks is Lens's plan gates (B32.12); every fee is Lens's GET /v1/public/fees (B32.8). A figure Lens did
// not state is not printed. The only figure written here is Free's: it is the plan with no price.
//
// B46.1 (Nick, 24 Oct 2026): no preview or test-money labels on the public page; the fees are stated plainly. The
// one label is StatusLabel (B56.9), Live or Sandbox from Lens and Building from the registry. B56.10 places them: Live
// or Sandbox on the Money features row and every money fee row; Building on each switch Lens does not enforce yet and
// each fee it does not charge yet, and on no row once Lens says it is built or charged.

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-t border-rule py-2.5">
      <dt className="text-caption text-label">{label}</dt>
      <dd className="flex flex-wrap items-center gap-2 text-body text-ink">{children}</dd>
    </div>
  )
}

/** Contracted plans have no Stripe Price and agree their own fees. */
export const CONTRACTED = 'enterprise'

function CompanyPrice({ id, pricing }: { id: string; pricing: Pricing }) {
  const listed = pricing.company_plans?.find((p) => p.id === id)
  const cents =
    id === CONTRACTED ? pricing.enterprise_from_usd_cents : listed ? listed.usd_cents : id === 'free' ? 0 : undefined
  if (cents === undefined) {
    return <p className="text-body text-muted">Price not stated by this deployment just now</p>
  }
  return (
    <p className="flex flex-wrap items-baseline gap-2">
      {id === CONTRACTED ? <span className="text-body text-muted">From</span> : null}
      <span data-testid={`price-${id}`} className="font-figure text-page text-ink">
        {formatCents(cents)}
      </span>
      <span className="text-body text-muted">a month</span>
    </p>
  )
}

export function ownKeys(g: PlanGate, pricing: Pricing): ReactNode {
  if (g.own_provider_keys === 'included') return 'Included'
  if (g.own_provider_keys === 'none') return 'Not included'
  return pricing.byok_add_on_usd_cents ? (
    <>
      <span className="font-figure">{formatCents(pricing.byok_add_on_usd_cents)}</span> add-on
    </>
  ) : (
    'Add-on'
  )
}

export function included(on: boolean): string {
  return on ? 'Included' : 'Not included'
}

/** B56.10 — a switch the plan includes that Lens does not enforce yet carries Building; "—" carries nothing. */
function Gate({ on, built, children }: { on: boolean; built: boolean | undefined; children: ReactNode }) {
  return (
    <>
      {included(on)}
      {on && built !== true ? children : null}
    </>
  )
}

/** One company plan: its price, what it unlocks and its fees. /plans passes its own action (a checkout, or
 *  "Your plan") and marks the workspace's plan; /pricing links each plan to where it is chosen. */
export function CompanyCard({
  id,
  gate,
  pricing,
  action,
  current = false,
}: {
  id: string
  gate: PlanGate
  pricing: Pricing
  action?: ReactNode
  current?: boolean
}) {
  const name = planName(id)
  const fees = pricing.fees
  const contracted = id === CONTRACTED
  const fx = fees?.fx_margin_bps[id]
  const built = pricing.plan_gates?.built
  return (
    <div
      data-testid={`company-plan-${id}`}
      aria-current={current ? 'true' : undefined}
      className={`flex flex-col gap-3 rounded-card border bg-raised p-5 ${current ? 'border-accent' : 'border-rule'}`}
    >
      <p className="text-head text-ink">{name}</p>
      <CompanyPrice id={id} pricing={pricing} />
      <div>
        {action !== undefined ? (
          action
        ) : contracted ? (
          <Button asChild variant="primary" className="h-10 px-5">
            <a href={`mailto:${COMPANY_CONTACT}`}>Talk to us</a>
          </Button>
        ) : id === 'free' ? (
          <Button asChild variant="primary" className="h-10 px-5">
            <a href="/signup">Start free</a>
          </Button>
        ) : (
          <Button asChild variant="primary" className="h-10 px-5">
            <a href="/plans">Choose {name}</a>
          </Button>
        )}
      </div>
      <dl className="mt-1 flex flex-col">
        <Row label="Agents">
          <span className="font-figure">{formatLimit(gate.agents)}</span>
        </Row>
        <Row label="Seats">
          <span className="font-figure">{formatLimit(gate.seats)}</span>
        </Row>
        {fees ? (
          <Row label="Platform fee on AI spend">
            {contracted ? 'Agreed' : <span className="font-figure">{formatBPS(fees.platform_fee_bps[id] ?? 0)}</span>}
          </Row>
        ) : null}
        <Row label="Own provider keys">{ownKeys(gate, pricing)}</Row>
        <Row label="Money features">
          {gate.live_money ? 'Included as our money partners switch on' : 'Not included'}
          {gate.live_money ? <StatusLabel capability={MONEY_FEATURES} labels={pricing.labels} /> : null}
        </Row>
        {fees ? (
          <Row label="FX margin over the reference rate">
            {contracted ? 'Agreed' : fx ? <span className="font-figure">{formatBPS(fx)}</span> : 'None'}
            {contracted || fx ? <StatusLabel capability="fx" labels={pricing.labels} /> : null}
          </Row>
        ) : null}
        <Row label="Slack and Teams approvals">
          <Gate on={gate.slack_teams_approvals} built={built?.slack_teams_approvals}>
            <StatusLabel building="slack_teams_approvals" />
          </Gate>
        </Row>
        <Row label="Single sign-on">
          <Gate on={gate.sso} built={built?.sso}>
            <StatusLabel building="sso" />
          </Gate>
        </Row>
        <Row label="Audit export">{included(gate.audit_export)}</Row>
        <Row label="Talyvor Edge">
          <Gate on={gate.edge} built={built?.edge}>
            <StatusLabel building="edge" />
          </Gate>
        </Row>
      </dl>
    </div>
  )
}

export const TAX_LINE =
  'Prices are in US dollars. Where Talyvor must charge VAT or sales tax, it is added at checkout and shown before you pay.'
