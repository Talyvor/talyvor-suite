import { useQuery } from '@tanstack/react-query'
import { Card, CardHeader, formatDay, Row } from '@talyvor/ui'
import { Money } from '@talyvor/ui/pocket'
import { planApi } from './planApi'
import { PlanRenewal, SUBSCRIPTION_KEY } from './Plans'
import { formatCents } from './topupApi'

/**
 * B1.6 — a subscriber's plan, on /billing (B61.14: its amounts in the person's currency, never LXC): what it costs, what the team's
 * answers earned back against it, and how much of this period's allowance is used and left.
 *
 * ⚠ IT DRAWS NOTHING UNLESS THERE IS A PLAN TO DESCRIBE. No plans sold here (`enabled:false`),
 * not subscribed (`allowance: null`), still loading, or a read that failed — none of those is a
 * sentence about a plan, and a card saying "no plan" to a workspace whose read merely failed would
 * be the conflation this app has paid for twice. A failed read draws nothing rather than a claim;
 * the balance card above already reports an unreachable Lens.
 *
 * B26.17 — and whether it renews or ends, and when, with cancelling at the end of the period or
 * resuming it before then (PlanRenewal, the same control /plans draws).
 *
 * B27.20 — the allowance row follows that answer: a cancelled plan's allowance ends and is never
 * said to renew, and while the answer is unknown the row promises neither.
 */
export function YourPlan() {
  const plan = useQuery({ queryKey: ['plan-allowance'], queryFn: planApi.allowance, retry: false })
  // Asked only once there is a plan to describe, so /billing asks nothing more of a workspace without one.
  const sub = useQuery({
    queryKey: SUBSCRIPTION_KEY,
    queryFn: planApi.subscription,
    retry: false,
    enabled: !!(plan.data?.enabled && plan.data.data.allowance),
  })
  if (!plan.data?.enabled || !plan.data.data.allowance) return null

  const summary = plan.data.data
  const a = summary.allowance!
  const st = sub.data?.enabled ? sub.data.data : null
  const ends = formatDay(a.period_end)
  const periodEnd = !st?.subscribed
    ? `this period ends ${ends}`
    : st.cancel_at_period_end
      ? `it ends ${ends} and does not renew`
      : `the allowance renews ${ends}`
  return (
    <Card raised className="mt-4">
      <CardHeader>Your plan</CardHeader>
      <div className="border-b border-rule px-gutter py-4">
        {a.fee_usd_cents > 0 ? (
          <p className="text-body text-ink">
            Your plan is <span className="font-figure">{formatCents(a.fee_usd_cents)}</span>. Your
            team’s answers earned{' '}
            <span className="font-figure">{formatCents(summary.earned_back_usd_cents)}</span> of
            it back.
          </p>
        ) : (
          // Lens counts nothing back against a fee it could not read (earnedBack of 0 is its
          // ceiling), so the sentence is not drawn with a price nobody confirmed.
          <p className="text-body text-ink">
            Your plan’s price couldn’t be read from Stripe, so nothing is counted back against it yet.
          </p>
        )}
        {summary.earned_held_ulens > 0 ? (
          <p className="mt-1 text-caption font-normal text-muted">
            Some of what was earned is still inside its holdback, so it can yet be revoked.
          </p>
        ) : null}
      </div>
      <PlanRenewal className="border-b border-rule px-gutter py-4" />
      <Row
        label="Allowance used"
        hint={`Since ${formatDay(a.period_start)}; ${periodEnd}`}
      >
        <Money ulxc={a.consumed_ulxc} />
        <span className="text-body text-muted">of</span>
        <Money ulxc={a.granted_ulxc} />
      </Row>
      <Row
        label="Allowance left"
        hint="The plan never bills an overage"
      >
        <Money ulxc={a.remaining_ulxc} />
      </Row>
    </Card>
  )
}
