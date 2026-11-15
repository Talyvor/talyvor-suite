import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Button, Card, Chip, Money, Row, type ChipTone } from '@talyvor/ui/pocket'
import { cn, inlineLink } from '@talyvor/ui'
import { InlineFailure } from '../../components/SessionExpiredBar'
import { MONEY_ORDER } from '../../moneyOrder'
import { categoryWords } from './Budgets'
import { formatWhen } from './format'
import { lxcPartOf, useMoney } from './money'
import { type LimitAlert, agentBankApi } from './agentBankApi'

// LimitAlertsCard.tsx — B57.90: Limit alerts on /agents as Pocket's w-agents draws them, below the room's wallet. Each time
// spending reached 50, 80 or 100% of a budget, a card's cap or an agent's limit, once a period (Lens B28.335, B28.62):
// what it is about in words, how much of the limit is spent (dollars first, LXC beside them for an agent's limit), when,
// and Nearing or Reached.

export const LIMIT_ALERTS_KEY = ['limit-alerts']

const PERIOD_WORD: Record<string, string> = { week: 'weekly', month: 'monthly' }

/** "80% of Researcher's daily limit", "80% of every wallet's monthly bills budget": what an alert is about, in words. */
export function limitAlertText(a: LimitAlert, nameOf: (id: string) => string): string {
  const whose = !a.agent_id ? 'your own' : a.agent_id === 'all' ? 'every wallet’s' : `${nameOf(a.agent_id)}’s`
  const period = a.period ? `${PERIOD_WORD[a.period] ?? a.period} ` : ''
  const what =
    a.kind === 'card' ? 'card cap' : a.kind === 'agent_limit' ? `${period}limit` : `${period}${a.category ? `${categoryWords(a.category)} ` : ''}budget`
  return `${a.percent}% of ${whose} ${what}`
}

/** Reached at 100%; Nearing before it, in the wait colour from 80%. */
function chipOf(percent: number): { tone: ChipTone; words: string } {
  return percent >= 100 ? { tone: 'bad', words: 'Reached' } : { tone: percent >= 80 ? 'wait' : 'plain', words: 'Nearing' }
}

/** "$1,012.00 of $2,000.00 (10,120 of 20,000 LXC)" for an agent's limit, LXC alone while no rate backs it; "$900.00 of $1,000.00" for a budget or a card. */
function SpentOf({ a, money }: { a: LimitAlert; money: (ulxc: number) => string | null }) {
  if (a.currency !== 'LXC')
    return (
      <>
        <Money minor={a.spent_minor} currency={a.currency} /> of{' '}
        <Money minor={a.limit_minor} currency={a.currency} />
      </>
    )
  const lxc = lxcPartOf(a.spent_minor, a.limit_minor)
  const spent = money(a.spent_minor)
  const limit = money(a.limit_minor)
  if (spent === null || limit === null) return <>{lxc}</>
  const cash = `${spent} of ${limit}`
  return <>{MONEY_ORDER === 'usd-first' ? `${cash} (${lxc})` : `${lxc} (${cash})`}</>
}

export function LimitAlertsCard({ nameOf }: { nameOf: (id: string) => string }) {
  const alerts = useQuery({ queryKey: LIMIT_ALERTS_KEY, queryFn: agentBankApi.limitAlerts })
  const money = useMoney()
  const list = alerts.data?.alerts ?? []
  return (
    <Card tone="white" data-testid="agents-limit-alerts">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-head font-bold text-ink">Limit alerts</h2>
        <Link to="/money/budgets" className={cn(inlineLink, 'text-body')}>
          Budgets
        </Link>
      </div>
      <p className="mt-1 text-body text-ink-3">
        An alert appears here when spending reaches 50, 80 or 100% of a budget, a card’s cap or an agent’s limit, once each period.
      </p>
      <div className="mt-2">
        {alerts.isError ? (
          <div role="alert" className="grid justify-items-start gap-3">
            <InlineFailure error={alerts.error} failed="Couldn’t load the limit alerts" />
            <Button variant="secondary" size="sm" onClick={() => void alerts.refetch()}>
              Try again
            </Button>
          </div>
        ) : alerts.isPending ? (
          <p className="text-body text-ink-3">Reading…</p>
        ) : list.length > 0 ? (
          list.slice(0, 20).map((a) => {
            const chip = chipOf(a.percent)
            return (
              <div key={a.id} data-testid={`limit-alert-${a.id}`} className="border-t border-line first:border-t-0">
                <Row
                  wrap
                  title={limitAlertText(a, nameOf)}
                  line={
                    <span className="font-figure">
                      <SpentOf a={a} money={money} /> spent · {formatWhen(a.created_at)}
                    </span>
                  }
                  action={<Chip tone={chip.tone}>{chip.words}</Chip>}
                />
              </div>
            )
          })
        ) : (
          <div className="grid justify-items-start gap-2.5">
            <p className="text-body text-ink-2">No limit reached yet.</p>
            <Button asChild variant="secondary" size="sm">
              <Link to="/money/budgets">Set a budget</Link>
            </Button>
          </div>
        )}
      </div>
    </Card>
  )
}
