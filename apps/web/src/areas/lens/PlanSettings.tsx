import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Card, Chip, Crumb, Dialog, Eyebrow, Facts, Money, showSnack } from '@talyvor/ui/pocket'
import { COMPANY_CONTACT } from '../../company'
import { WorkspaceLabel, useWorkspaceLabels } from '../../labels/workspace'
import { isSessionExpired } from '../../lib/productState'
import { formatBPS, formatLimit, usePricing, type Fees, type LadderPlan, type PlanLadders } from '../marketing/pricingApi'
import { PLAN_KEY, PlanChangeError, changeWorkspacePlan, readWorkspacePlan, useAccount, type WorkspacePlan } from './agentBankApi'
import { useFiat } from './money'

// B61.59 — Settings, Plan (/billing; /plans opens it), one page: the account's plan by its name with its monthly price
// in the account's own currency, what it includes, and the ladder of the account's own type with Change plan on the
// others. A Personal account sees Solo, Crew and Fleet; a Business sees Studio, Company, Group and Custom, which is
// talked about, never chosen here.
//
// ⚠ EVERY FIGURE IS LENS'S. The plan, its price and its agents come from GET /api/plan; the ladders from GET
// /api/pricing's `ladders` (Lens's GET /v1/public/plans) and the exchange fee from its `fees`. Nothing here is a price,
// a count or a fee: a plan Lens did not state is not drawn. Changing plan is PUT /api/plan, and Lens decides it: its
// refusal (a move down under too many agents, a paid plan while none can be charged) is said in its own words.

/** The money capability a plan's price is paid under: spending on Talyvor itself. */
const PLAN_CAPABILITY = 'spend_on_talyvor'

/** The Sandbox sentence, beside its label, while a plan costs nothing. */
export const PLAN_SANDBOX_LINE = 'In Sandbox a plan costs nothing. The price is what it will cost when real money is live.'

const countOf = (n: number, one: string, many: string) => (n < 0 ? `Unlimited ${many}` : `${formatLimit(n)} ${n === 1 ? one : many}`)
const agentsOf = (n: number) => countOf(n, 'agent', 'agents')
const peopleOf = (n: number) => countOf(n, 'person', 'people')

/** The currency the account's plan is priced in: a stablecoin account's is the one Lens names; otherwise the person's
 *  own, where Lens prices plans in it. */
function usePlanCurrency(ladders: PlanLadders | undefined): string | undefined {
  const fiat = useFiat()
  const { account } = useAccount()
  if (!ladders) return undefined
  if (account?.money_kind === 'stablecoin') return ladders.stablecoin_priced_in
  return ladders.currencies.includes(fiat) ? fiat : ladders.stablecoin_priced_in
}

/** A plan's monthly price in currency, or null where Lens states none (Custom, by contract). */
function priceIn(prices: Record<string, number> | null | undefined, currency: string): number | null {
  const n = prices?.[currency]
  return typeof n === 'number' ? n : null
}

function MonthlyPrice({ minor, currency, size = 'row' }: { minor: number | null; currency: string; size?: 'row' | 'card-sm' }) {
  if (minor === null) return <span className="text-body font-semibold text-ink">By contract</span>
  return (
    <span className="inline-flex flex-wrap items-baseline gap-1.5">
      <Money minor={minor} currency={currency} size={size} />{' '}
      <span className="text-body font-semibold text-ink-3">a month</span>
    </span>
  )
}

/** The exchange fee Lens charges on plan, as its fees read states it; nothing when it was not read. */
function exchangeFee(fees: Fees | undefined, plan: string): string | null {
  const bps = fees?.fx_margin_bps[plan]
  if (typeof bps !== 'number') return null
  return bps === 0 ? 'No exchange fee' : `${formatBPS(bps)} on exchange`
}

/** What changes, in words, for the confirmation: the price, the agents and the people, each "instead of" today's. */
function whatChanges(from: LadderPlan | undefined, to: LadderPlan, currency: string, served: WorkspacePlan): React.ReactNode[] {
  const lines: React.ReactNode[] = []
  const now = priceIn(from?.price_minor ?? served.price_minor, currency)
  const next = priceIn(to.price_minor, currency)
  if (next !== null) {
    lines.push(
      <>
        You pay <Money minor={next} currency={currency} /> a month
        {now !== null ? (
          <>
            {' '}
            instead of <Money minor={now} currency={currency} />
          </>
        ) : null}
        .
      </>,
    )
  }
  lines.push(`${agentsOf(to.agents)} instead of ${agentsOf(served.agents).toLowerCase()}.`)
  if (from) lines.push(`${peopleOf(to.people)} instead of ${peopleOf(from.people).toLowerCase()}.`)
  return lines
}

/** The refusal, in Lens's words where it gave them. */
function changeRefusal(err: unknown): string {
  if (isSessionExpired(err)) return 'Sign in again to change your plan.'
  if (err instanceof PlanChangeError && err.sentence) return err.sentence
  return 'Your plan was not changed. You can try again.'
}

function ChangePlanDialog({
  to,
  from,
  currency,
  served,
  onClose,
}: {
  to: LadderPlan
  from: LadderPlan | undefined
  currency: string
  served: WorkspacePlan
  onClose: () => void
}) {
  const qc = useQueryClient()
  const change = useMutation({
    mutationFn: () => changeWorkspacePlan(to.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: PLAN_KEY })
      showSnack({ title: `You are on ${to.name}`, line: 'Your plan changed now.' })
      onClose()
    },
  })
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Change to ${to.name}?`}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={change.isPending} onClick={() => change.mutate()}>
            {change.isPending ? 'Changing…' : `Change to ${to.name}`}
          </Button>
        </>
      }
    >
      <div data-testid="plan-change-lines" className="grid gap-1">
        {whatChanges(from, to, currency, served).map((line, i) => (
          <p key={i}>{line}</p>
        ))}
      </div>
      {change.isError ? (
        <p role="alert" data-testid="plan-change-refusal" className="text-ink">
          {changeRefusal(change.error)}
        </p>
      ) : null}
    </Dialog>
  )
}

/** One plan of the ladder: its name, price, agents, people and exchange fee; Your plan or Change plan. */
function LadderCard({
  plan,
  current,
  currency,
  fees,
  onChange,
}: {
  plan: LadderPlan
  current: boolean
  currency: string
  fees: Fees | undefined
  onChange: (() => void) | null
}) {
  const fee = exchangeFee(fees, plan.id)
  return (
    <div
      data-testid={`ladder-${plan.id}`}
      className={`grid content-start gap-3 rounded-card p-5 ${current ? 'bg-page shadow-pocket ring-2 ring-inset ring-ink' : 'bg-cloud'}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-display text-bar font-bold text-ink">{plan.name}</p>
        {current ? <Chip tone="good">Your plan</Chip> : null}
      </div>
      <MonthlyPrice minor={priceIn(plan.price_minor, currency)} currency={currency} />
      <ul className="m-0 grid list-none gap-1 p-0 text-body text-ink-2">
        <li>{agentsOf(plan.agents)}</li>
        <li>{peopleOf(plan.people)}</li>
        {fee && !plan.by_contract ? <li>{fee}</li> : null}
      </ul>
      {plan.by_contract ? (
        <div>
          <Button asChild variant="outline" size="sm">
            <a href={`mailto:${COMPANY_CONTACT}`}>Custom: talk to us</a>
          </Button>
        </div>
      ) : onChange ? (
        <div>
          <Button variant="outline" size="sm" onClick={onChange}>
            Change plan
          </Button>
        </div>
      ) : null}
    </div>
  )
}

export function PlanSettings() {
  const plan = useQuery({ queryKey: PLAN_KEY, queryFn: readWorkspacePlan, retry: false })
  const pricing = usePricing()
  const ladders = pricing.status === 'ok' ? pricing.pricing.ladders : undefined
  const fees = pricing.status === 'ok' ? pricing.pricing.fees : undefined
  const currency = usePlanCurrency(ladders)
  const [changing, setChanging] = useState<LadderPlan | null>(null)

  const served = plan.data
  const type = served?.account_type
  const ladder = ladders && type ? ladders[type] : undefined
  const mine = ladder?.find((p) => p.id === served?.plan)
  // A plan is paid to Talyvor: Lens's label for spending on Talyvor says whether that is Sandbox, and while it is, the
  // plan costs nothing and the page says so.
  const sandbox = useWorkspaceLabels()?.[PLAN_CAPABILITY] === 'sandbox'

  return (
    <div data-testid="plan-settings" className="grid min-w-0 gap-5">
      <Crumb trail={[{ label: 'Settings', href: '/settings' }, { label: 'Plan' }]} />

      {plan.isPending || pricing.status === 'loading' ? (
        <p className="text-body text-ink-2">Reading your plan…</p>
      ) : !served || !type ? (
        <p className="max-w-2xl text-body text-ink-2">
          {isSessionExpired(plan.error)
            ? 'Your plan can’t be read until you sign in again.'
            : 'Couldn’t read your plan just now, so no plan is shown.'}
        </p>
      ) : (
        <>
          <Card tone="white" data-testid="plan-current" className="grid gap-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="grid gap-1.5">
                <Eyebrow>Your plan</Eyebrow>
                <p className="font-display text-head font-bold text-ink">You are on {served.name ?? mine?.name}.</p>
                {currency ? (
                  <MonthlyPrice minor={priceIn(served.price_minor, currency)} currency={currency} size="card-sm" />
                ) : null}
              </div>
              <WorkspaceLabel capability={PLAN_CAPABILITY} />
            </div>
            {sandbox ? (
              <p data-testid="plan-sandbox-line" className="text-body text-ink-2">
                {PLAN_SANDBOX_LINE}
              </p>
            ) : null}
            <Facts
              facts={[
                {
                  label: 'Agents',
                  value: served.agents < 0 ? `${formatLimit(served.agents_used)} of unlimited` : `${formatLimit(served.agents_used)} of ${formatLimit(served.agents)}`,
                },
                { label: 'People', value: peopleOf(served.seats) },
                ...(exchangeFee(fees, served.plan) ? [{ label: 'Exchange', value: exchangeFee(fees, served.plan) }] : []),
              ]}
            />
            {served.on_contract ? (
              <p className="text-body text-ink-2">This account is on a contract with Talyvor, which sets its plan.</p>
            ) : null}
          </Card>

          <section aria-labelledby="plan-ladder" className="grid gap-3">
            <h2 id="plan-ladder" className="font-display text-head font-bold text-ink">
              {type === 'personal' ? 'Plans for a person' : 'Plans for a company'}
            </h2>
            {ladder && currency ? (
              <div className="grid gap-4 wide:grid-cols-2 lg:grid-cols-4">
                {ladder.map((p) => (
                  <LadderCard
                    key={p.id}
                    plan={p}
                    current={p.id === served.plan}
                    currency={currency}
                    fees={fees}
                    onChange={p.id === served.plan || served.on_contract ? null : () => setChanging(p)}
                  />
                ))}
              </div>
            ) : (
              <p className="max-w-2xl text-body text-ink-2">The plans couldn’t be read just now, so none is shown.</p>
            )}
          </section>

          {changing && currency ? (
            <ChangePlanDialog to={changing} from={mine} currency={currency} served={served} onClose={() => setChanging(null)} />
          ) : null}
        </>
      )}
    </div>
  )
}
