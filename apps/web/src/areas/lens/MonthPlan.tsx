import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, CardHeader, Input, Pill, Row, inlineLink } from '@talyvor/ui'
import { Card } from './walletBrand'
import { Note, readFailure } from './WalletMoney'
import { BUDGETS_KEY, categoryName } from './Budgets'
import { SCHEDULES_KEY } from './Pay'
import { type PlanFinding, type SpendBudget, type SpendPlan, agentBankApi, formatMinor, minorOf, refusalText } from './agentBankApi'

// MonthPlan.tsx — B53.16: the owner's month plan on the Spending screen, every number from Lens (B53.15): what is safe to
// spend today and each day until payday, the upcoming payments with their dates and whether each is covered, the payday and
// income, and each off-plan finding with the Coach's sentence and the adjustments open to the owner — about their own
// spending only: move money out of a budget, pause a subscription, stop an agent's standing order until payday.

export const PLAN_KEY = ['money-plan']

/** "2026-11-28" → "28 Nov". */
export const planDay = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })

const SOURCE: Record<string, string> = { bill: 'Bill', subscription: 'Subscription', standing_order: 'Standing order' }
const KIND: Record<string, string> = { plan_uncovered: 'Not covered', plan_pace_short: 'Short at this pace', plan_bill_larger: 'A larger bill', plan_income_late: 'Income late' }
/** An adjustment: its sentence, and a short button beside it (under it on a phone). */
const adjust = 'flex flex-col items-start gap-1 text-body text-ink wide:flex-row wide:items-center wide:justify-between'

/** "1st", "2nd", "28th": a payday as a person says it. */
const nth = (d: number) => `${d}${d % 10 === 1 && d !== 11 ? 'st' : d % 10 === 2 && d !== 12 ? 'nd' : d % 10 === 3 && d !== 13 ? 'rd' : 'th'}`

/** What the owner can change about their own spending to bring the plan back: Lens's numbers, never advice on products or debt. */
function Adjustments({ plan, finding, budgets }: { plan: SpendPlan; finding: PlanFinding; budgets: SpendBudget[] }) {
  const qc = useQueryClient()
  const refresh = () => {
    for (const key of [PLAN_KEY, BUDGETS_KEY, SCHEDULES_KEY]) void qc.invalidateQueries({ queryKey: key })
  }
  const lower = useMutation({
    // A budget moved out whole is removed: Lens keeps no budget of zero.
    mutationFn: ({ b, take }: { b: SpendBudget; take: number }): Promise<unknown> =>
      take >= b.amount_minor
        ? agentBankApi.deleteBudget(b.id)
        : agentBankApi.setBudget({ agent_id: b.agent_id, category: b.category, period: b.period, amount_minor: b.amount_minor - take, currency: b.currency, timezone: b.timezone }),
    onSuccess: refresh,
  })
  const stop = useMutation({ mutationFn: (id: string) => agentBankApi.stopSchedule(id), onSuccess: refresh })
  const short = finding.short_minor ?? 0
  const due = finding.payment?.due ?? plan.until
  // Only what falls before the short payment can make room for it.
  const before = plan.payments.filter((p) => p.due <= due && !(p.source === finding.payment?.source && p.id === finding.payment?.id))
  const subs = before.filter((p) => p.source === 'subscription')
  const orders = [...new Map(before.filter((p) => p.source === 'standing_order').map((p) => [p.id, p])).values()]
  const room = budgets.filter((b) => b.currency === plan.currency && b.left_minor > 0)

  return (
    <ul className="flex flex-col gap-2" data-testid={`plan-adjustments-${finding.kind}`}>
      {finding.keep_to_per_day_minor !== undefined && finding.kind === 'plan_pace_short' ? (
        <li className="text-body text-ink" data-testid="plan-adjust-keep-to">
          Spend at most <span className="font-figure">{formatMinor(finding.keep_to_per_day_minor, plan.currency)}</span> a day until {planDay(due)}.
        </li>
      ) : null}
      {room.map((b) => {
        const take = Math.min(short > 0 ? short : b.left_minor, b.left_minor)
        return (
          <li key={b.id} className={adjust} data-testid={`plan-adjust-budget-${b.id}`}>
            <span>
              Move <span className="font-figure">{formatMinor(take, b.currency)}</span> out of the {(b.category ? categoryName(b.category) : 'overall').toLowerCase()} budget.
            </span>
            <Button type="button" disabled={lower.isPending} onClick={() => lower.mutate({ b, take })}>
              Move it
            </Button>
          </li>
        )
      })}
      {subs.map((p) => (
        <li key={`${p.id}-${p.due}`} className="text-body text-ink" data-testid={`plan-adjust-subscription-${p.id}`}>
          Pause {p.payee} — <span className="font-figure">{formatMinor(p.amount_minor, p.currency)}</span> on {planDay(p.due)}.{' '}
          <Link className={inlineLink} to="/money/subscriptions">
            See it in Subscriptions
          </Link>
        </li>
      ))}
      {orders.map((p) => (
        <li key={p.id} className={adjust} data-testid={`plan-adjust-order-${p.id}`}>
          <span>
            Stop the standing order to {p.payee}, <span className="font-figure">{formatMinor(p.amount_minor, p.currency)}</span> on {planDay(p.due)}, and set
            it up again after payday.
          </span>
          <Button type="button" disabled={stop.isPending} onClick={() => stop.mutate(p.id)}>
            Stop it
          </Button>
        </li>
      ))}
      {lower.isError ? <Note ok={false}>{refusalText(lower.error)}</Note> : null}
      {stop.isError ? <Note ok={false}>{refusalText(stop.error)}</Note> : null}
      {lower.isSuccess || stop.isSuccess ? <Note ok>Done: the plan is worked out again.</Note> : null}
    </ul>
  )
}

/** The payday and income: the owner's own, or Lens's proposal to confirm, or a form to set one. */
function Income({ plan }: { plan: SpendPlan }) {
  const qc = useQueryClient()
  const known = plan.income ?? plan.proposed_income ?? null
  const [payday, setPayday] = useState(String(known?.payday ?? ''))
  const [amount, setAmount] = useState(known ? (known.amount_minor / 100).toFixed(2) : '')
  const [payer, setPayer] = useState(known?.payer ?? '')
  const save = useMutation({
    mutationFn: () => agentBankApi.setIncome({ payday: Number(payday), amount_minor: minorOf(amount) ?? 0, currency: plan.currency, payer: payer.trim() }),
    onSuccess: (p) => qc.setQueryData(PLAN_KEY, p),
  })
  const day = Number(payday)
  const valid = Number.isInteger(day) && day >= 1 && day <= 31 && minorOf(amount) !== null

  return (
    <form
      className="flex flex-col gap-3"
      data-testid="plan-income"
      onSubmit={(e) => {
        e.preventDefault()
        if (valid && !save.isPending) save.mutate()
      }}
    >
      <p className="text-body text-muted">
        {plan.income ? (
          <>
            Payday is the {nth(plan.income.payday)} of each month, about{' '}
            <span className="font-figure">{formatMinor(plan.income.amount_minor, plan.income.currency)}</span>
            {plan.income.payer ? ` from ${plan.income.payer}` : ''}.
          </>
        ) : plan.proposed_income ? (
          <>
            Your money in looks like a payday on the {nth(plan.proposed_income.payday)}, about{' '}
            <span className="font-figure">{formatMinor(plan.proposed_income.amount_minor, plan.proposed_income.currency)}</span>
            {plan.proposed_income.payer ? ` from ${plan.proposed_income.payer}` : ''}. Confirm it, or change it.
          </>
        ) : (
          'Set your payday and the plan runs until then; until you do, it runs to the end of the month.'
        )}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Input aria-label="Payday, day of the month" placeholder="Day" inputMode="numeric" className="w-24 font-figure" value={payday} onChange={(e) => setPayday(e.target.value)} />
        <Input aria-label={`Income in ${plan.currency}`} placeholder={`Income, ${plan.currency}`} inputMode="decimal" className="w-36 font-figure" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <Input aria-label="Paid by (optional)" placeholder="Paid by (optional)" className="w-48" value={payer} onChange={(e) => setPayer(e.target.value)} />
      </div>
      <div>
        <Button type="submit" variant="primary" disabled={!valid || save.isPending}>
          {save.isPending ? 'Saving…' : plan.income ? 'Save payday' : 'Confirm payday'}
        </Button>
      </div>
      {save.isError ? <Note ok={false}>{refusalText(save.error)}</Note> : null}
    </form>
  )
}

export function MonthPlan() {
  const plan = useQuery({ queryKey: PLAN_KEY, queryFn: agentBankApi.plan })
  const budgets = useQuery({ queryKey: BUDGETS_KEY, queryFn: agentBankApi.budgets })
  if (plan.isError) return <p className="text-body text-muted">{readFailure(plan.error, 'Your month plan')}</p>
  if (plan.isPending) return <p className="text-body text-muted">Reading…</p>
  const p = plan.data
  const money = (minor: number) => formatMinor(minor, p.currency)
  const until = p.next_income ? `until payday, ${planDay(p.next_income)}` : `until ${planDay(p.until)}, the month’s end`

  return (
    <>
      <Card data-testid="plan-card">
        <CardHeader>Safe to spend</CardHeader>
        <div className="flex flex-col gap-1 px-4 py-3">
          <p className="text-body text-ink" data-testid="plan-safe-per-day">
            <span className="font-figure">{money(p.safe_per_day_minor)}</span> a day {until}
          </p>
          <p className="text-caption text-muted">
            <span className="font-figure">{money(p.money_now_minor)}</span> now, less <span className="font-figure">{money(p.upcoming_minor)}</span> of payments
            due and <span className="font-figure">{money(p.budgets_left_minor)}</span> your budgets still mean to spend, over {p.days}{' '}
            {p.days === 1 ? 'day' : 'days'}. You have spent <span className="font-figure">{money(p.pace_per_day_minor)}</span> a day over the last seven.
          </p>
        </div>
      </Card>

      {p.findings.length > 0 ? (
        <Card data-testid="plan-findings">
          <CardHeader>Off plan</CardHeader>
          {p.findings.map((f) => (
            <Row
              key={`${f.kind}-${f.payment?.source ?? ''}-${f.payment?.id ?? f.expected_on ?? ''}-${f.payment?.due ?? ''}`}
              stack
              data-testid={`plan-finding-${f.kind}`}
              label={`${KIND[f.kind] ?? 'Off plan'}${f.payment ? ` · ${f.payment.payee}` : ''}`}
              hint={
                <div className="flex flex-col gap-2">
                  <span data-testid="plan-sentence">{f.sentence}</span>
                  {f.urgent ? <Adjustments plan={p} finding={f} budgets={budgets.data?.budgets ?? []} /> : null}
                </div>
              }
            />
          ))}
        </Card>
      ) : null}

      <Card data-testid="plan-payments">
        <CardHeader>Payments due {until}</CardHeader>
        {p.payments.length === 0 ? (
          <p className="px-4 py-3 text-body text-muted">No bill, subscription or standing order is due before then: add a bill in Bills and it shows here with its date.</p>
        ) : (
          p.payments.map((x) => (
            <Row
              key={`${x.source}-${x.id}-${x.due}`}
              label={x.payee || SOURCE[x.source]}
              data-testid={`plan-payment-${x.source}-${x.id}`}
              hint={
                <>
                  {SOURCE[x.source]} · <span className="font-figure">{planDay(x.due)}</span>
                </>
              }
            >
              <span className="flex items-center gap-2">
                <span className="font-figure text-body text-ink">{money(x.amount_minor)}</span>
                <Pill status={x.covered ? 'settled' : 'slashed'}>{x.covered ? 'Covered' : 'Not covered'}</Pill>
              </span>
            </Row>
          ))
        )}
      </Card>

      <Income key={`${p.income?.payday ?? p.proposed_income?.payday ?? ''}-${p.currency}`} plan={p} />
    </>
  )
}
