import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { inlineLink } from '@talyvor/ui'
import { Button, Card, Chip, Eyebrow, Field, Input, Money, Row } from '@talyvor/ui/pocket'
import { Note, readFailure } from './WalletMoney'
import { BUDGETS_KEY, categoryWords } from './Budgets'
import { SCHEDULES_KEY } from './Pay'
import { type PlanFinding, type SpendBudget, type SpendPlan, agentBankApi, minorOf, refusalText } from './agentBankApi'

// MonthPlan.tsx — B53.16: the owner's month plan on the Spending screen, every number from Lens (B53.15): what is safe to
// spend today and each day until payday, the upcoming payments with their dates and whether each is covered, the payday and
// income, and each off-plan finding with the Coach's sentence and the adjustments open to the owner — about their own
// spending only: move money out of a budget, pause a subscription, stop an agent's standing order until payday.
// B57.89 — in Pocket: what is safe to spend large, the payments due with Covered or Not covered, and the Payday form.

export const PLAN_KEY = ['money-plan']

/** "2026-11-28" → "28 Nov". */
export const planDay = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })

const SOURCE: Record<string, string> = { bill: 'Bill', subscription: 'Subscription', standing_order: 'Standing order' }
const KIND: Record<string, string> = {
  plan_uncovered: 'Not covered',
  plan_pace_short: 'Short at this pace',
  plan_bill_larger: 'A larger bill',
  plan_income_late: 'Income late',
}
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
        : agentBankApi.setBudget({
            agent_id: b.agent_id,
            category: b.category,
            period: b.period,
            amount_minor: b.amount_minor - take,
            currency: b.currency,
            timezone: b.timezone,
          }),
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
          Spend at most <Money minor={finding.keep_to_per_day_minor} currency={plan.currency} /> a day until {planDay(due)}.
        </li>
      ) : null}
      {room.map((b) => {
        const take = Math.min(short > 0 ? short : b.left_minor, b.left_minor)
        return (
          <li key={b.id} className={adjust} data-testid={`plan-adjust-budget-${b.id}`}>
            <span>
              Move <Money minor={take} currency={b.currency} /> out of the {b.category ? categoryWords(b.category) : 'overall'} budget.
            </span>
            <Button type="button" variant="secondary" size="sm" disabled={lower.isPending} onClick={() => lower.mutate({ b, take })}>
              Move it
            </Button>
          </li>
        )
      })}
      {subs.map((p) => (
        <li key={`${p.id}-${p.due}`} className="text-body text-ink" data-testid={`plan-adjust-subscription-${p.id}`}>
          Pause {p.payee}: <Money minor={p.amount_minor} currency={p.currency} /> on {planDay(p.due)}.{' '}
          <Link className={inlineLink} to="/money/subscriptions">
            See it in Subscriptions
          </Link>
        </li>
      ))}
      {orders.map((p) => (
        <li key={p.id} className={adjust} data-testid={`plan-adjust-order-${p.id}`}>
          <span>
            Stop the standing order to {p.payee}, <Money minor={p.amount_minor} currency={p.currency} /> on {planDay(p.due)}, and set it up again after payday.
          </span>
          <Button type="button" variant="secondary" size="sm" disabled={stop.isPending} onClick={() => stop.mutate(p.id)}>
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
    <Card tone="white" className="grid gap-3">
      <h3 className="font-display text-reading font-bold text-ink">Payday</h3>
      <form
        className="grid gap-3"
        data-testid="plan-income"
        onSubmit={(e) => {
          e.preventDefault()
          if (valid && !save.isPending) save.mutate()
        }}
      >
        <p className="text-body text-ink-2">
          {plan.income ? (
            <>
              Payday is the {nth(plan.income.payday)} of each month, about <Money minor={plan.income.amount_minor} currency={plan.income.currency} />
              {plan.income.payer ? ` from ${plan.income.payer}` : ''}.
            </>
          ) : plan.proposed_income ? (
            <>
              Your money in looks like a payday on the {nth(plan.proposed_income.payday)}, about{' '}
              <Money minor={plan.proposed_income.amount_minor} currency={plan.proposed_income.currency} />
              {plan.proposed_income.payer ? ` from ${plan.proposed_income.payer}` : ''}. Confirm it, or change it.
            </>
          ) : (
            'Set your payday and the plan runs until then; until you do, it runs to the end of the month.'
          )}
        </p>
        <div className="grid gap-3 wide:grid-cols-2">
          <Field label="Payday, day of the month">
            <Input placeholder="Day" inputMode="numeric" value={payday} onChange={(e) => setPayday(e.target.value)} />
          </Field>
          <Field label={`Income in ${plan.currency}`}>
            <Input
              placeholder={`Income, ${plan.currency}`}
              inputMode="decimal"
              unit={plan.currency}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>
          <Field label="Paid by (optional)" className="wide:col-span-2">
            <Input placeholder="Who pays you" value={payer} onChange={(e) => setPayer(e.target.value)} />
          </Field>
        </div>
        <div>
          <Button type="submit" disabled={save.isPending} disabledReason={valid ? undefined : 'Add a payday from 1 to 31 and an amount first.'}>
            {save.isPending ? 'Saving…' : plan.income ? 'Save payday' : 'Confirm payday'}
          </Button>
        </div>
        {save.isError ? <Note ok={false}>{refusalText(save.error)}</Note> : null}
      </form>
    </Card>
  )
}

export function MonthPlan() {
  const plan = useQuery({ queryKey: PLAN_KEY, queryFn: agentBankApi.plan })
  const budgets = useQuery({ queryKey: BUDGETS_KEY, queryFn: agentBankApi.budgets })
  if (plan.isError) return <p className="text-body text-ink-2">{readFailure(plan.error, 'Your month plan')}</p>
  if (plan.isPending) return <p className="text-body text-ink-3">Reading…</p>
  const p = plan.data
  const money = (minor: number) => <Money minor={minor} currency={p.currency} />
  const until = p.next_income ? `until payday, ${planDay(p.next_income)}` : `until ${planDay(p.until)}, the month’s end`

  return (
    <>
      <Card className="grid gap-2" data-testid="plan-card">
        <Eyebrow>Safe to spend</Eyebrow>
        <p className="grid justify-items-start gap-1" data-testid="plan-safe-per-day">
          <Money size="card" minor={p.safe_per_day_minor} currency={p.currency} /> <span className="text-reading text-ink">a day {until}</span>
        </p>
        <p className="text-body text-ink-2">
          {money(p.money_now_minor)} now, less {money(p.upcoming_minor)} of payments due and {money(p.budgets_left_minor)} your budgets still mean to spend,
          over <span className="font-figure">{p.days}</span> {p.days === 1 ? 'day' : 'days'}. You have spent {money(p.pace_per_day_minor)} a day over the last
          seven.
        </p>
      </Card>

      {p.findings.length > 0 ? (
        <Card className="grid gap-2" data-testid="plan-findings">
          <h3 className="font-display text-reading font-bold text-ink">Off plan</h3>
          {p.findings.map((f) => (
            <div
              key={`${f.kind}-${f.payment?.source ?? ''}-${f.payment?.id ?? f.expected_on ?? ''}-${f.payment?.due ?? ''}`}
              className="grid gap-2 border-t border-line py-2.5 first-of-type:border-t-0"
              data-testid={`plan-finding-${f.kind}`}
            >
              <p className="font-semibold text-ink">
                {KIND[f.kind] ?? 'Off plan'}
                {f.payment ? ` · ${f.payment.payee}` : ''}
              </p>
              <p className="text-body text-ink-2" data-testid="plan-sentence">
                {f.sentence}
              </p>
              {f.urgent ? <Adjustments plan={p} finding={f} budgets={budgets.data?.budgets ?? []} /> : null}
            </div>
          ))}
        </Card>
      ) : null}

      <Card className="grid gap-1" data-testid="plan-payments">
        <h3 className="font-display text-reading font-bold text-ink">Payments due {until}</h3>
        {p.payments.length === 0 ? (
          <p className="text-body text-ink-2">
            No bill, subscription or standing order is due before then: add a bill in Bills and it shows here with its date.
          </p>
        ) : (
          p.payments.map((x) => (
            <div key={`${x.source}-${x.id}-${x.due}`} data-testid={`plan-payment-${x.source}-${x.id}`}>
              <Row
                wrap
                title={x.payee || SOURCE[x.source]}
                line={
                  <>
                    {SOURCE[x.source]} · <span className="font-figure">{planDay(x.due)}</span>
                  </>
                }
                amount={money(x.amount_minor)}
                action={<Chip tone={x.covered ? 'good' : 'bad'}>{x.covered ? 'Covered' : 'Not covered'}</Chip>}
              />
            </div>
          ))
        )}
      </Card>

      <Income key={`${p.income?.payday ?? p.proposed_income?.payday ?? ''}-${p.currency}`} plan={p} />
    </>
  )
}
