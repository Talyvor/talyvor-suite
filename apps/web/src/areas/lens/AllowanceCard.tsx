import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Card, Chip, Eyebrow, Field, Input, Money, Row, Select, Switch, showSnack } from '@talyvor/ui/pocket'
import { InlineFailure } from '../../components/SessionExpiredBar'
import { typedMinor } from './AgentFunding'
import { type CurrencyAccount, type MoneyAllowance, agentBankApi, refusalText } from './agentBankApi'

// AllowanceCard.tsx — B28.33: an agent's monthly allowance, on its page under the low-balance alert. For each of the agent's
// pound, euro and dollar accounts the owner sets an amount paid in from the company's account on a day of the month, and
// whether what the agent did not spend goes back first (Lens B28.309, PUT /api/money/allowances). Lens pays each month
// once, however often its tick runs; the card lists the months it paid, from GET /api/money/allowances/{id}/runs.
// B57.229: drawn as B57.201 drew the Low balance alert above it (w-budgets' Your budgets): a white card under its own
// heading, a hairline between the accounts and between the months paid, and Stop the danger button named for what it stops.

export const ALLOWANCES_KEY = ['allowances']

/** Lens pays an allowance in GBP, EUR or USD only. */
const ALLOWANCE_CURRENCIES = ['GBP', 'EUR', 'USD']
const ACCOUNT_WORDS: Record<string, string> = { USD: 'US dollar account', GBP: 'Pound account', EUR: 'Euro account' }
const accountWords = (currency: string) => ACCOUNT_WORDS[currency] ?? `${currency} account`
const DAYS = Array.from({ length: 28 }, (_, i) => i + 1)

/** 1 → "1st", 22 → "22nd", 13 → "13th". */
export function ordinal(n: number): string {
  const tens = n % 100
  if (tens >= 11 && tens <= 13) return `${n}th`
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`
}

/** "2026-11" → "November 2026". */
function monthWords(period: string): string {
  const [y, m] = period.split('-').map(Number)
  if (!y || !m) return period
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

const dayWords = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })

/** The months an allowance paid, newest first. */
function AllowanceMonths({ allowance }: { allowance: MoneyAllowance }) {
  const runs = useQuery({ queryKey: [...ALLOWANCES_KEY, 'runs', allowance.id], queryFn: () => agentBankApi.allowanceRuns(allowance.id) })
  const months = [...(runs.data?.runs ?? [])].sort((a, b) => b.period.localeCompare(a.period)).slice(0, 3)
  if (runs.isError) return <InlineFailure error={runs.error} failed="Couldn’t load the months it paid" />
  if (months.length === 0) return null
  return (
    <div className="pb-2" data-testid={`allowance-months-${allowance.currency}`}>
      {months.map((r) => (
        <p key={r.period} className="border-t border-line py-1.5 text-caption text-ink-3" data-testid={`allowance-month-${allowance.currency}-${r.period}`}>
          {monthWords(r.period)}:{' '}
          {r.status === 'funded' ? (
            <span className="font-figure">
              <Money minor={r.funded_minor} currency={allowance.currency} /> paid in
              {r.swept_minor > 0 ? (
                <>
                  , <Money minor={r.swept_minor} currency={allowance.currency} /> back to the company
                </>
              ) : null}
            </span>
          ) : (
            <span>not paid{r.detail ? ` (${r.detail})` : ''}</span>
          )}
        </p>
      ))}
    </div>
  )
}

/** One account: its allowance, or the form to set one. */
function AccountAllowance({ agentId, account, allowance }: { agentId: string; account: CurrencyAccount; allowance?: MoneyAllowance }) {
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [amount, setAmount] = useState('')
  const [day, setDay] = useState(allowance?.day_of_month ?? 1)
  const [sweepBack, setSweepBack] = useState(allowance?.sweep_back ?? false)
  const minor = typedMinor(amount, account.currency)
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ALLOWANCES_KEY })
  }
  const save = useMutation({
    mutationFn: (m: number) => agentBankApi.setAllowance({ agent_id: agentId, currency: account.currency, amount_minor: m, day_of_month: day, sweep_back: sweepBack }),
    onSuccess: () => {
      setEditing(false)
      setAmount('')
      showSnack({ title: 'Allowance saved' })
      refresh()
    },
  })
  const stop = useMutation({
    mutationFn: (id: string) => agentBankApi.stopAllowance(id),
    onSuccess: () => {
      showSnack({ title: 'Allowance stopped' })
      refresh()
    },
  })
  const testid = `allowance-${account.currency}`
  if (allowance && !editing)
    return (
      <div className="border-t border-line first:border-t-0" data-testid={testid}>
        <Row
          wrap
          title={accountWords(account.currency)}
          line={
            <span className="font-figure">
              <Money minor={allowance.amount_minor} currency={allowance.currency} /> a month, on the {ordinal(allowance.day_of_month)}
            </span>
          }
          action={
            <span className="flex items-center gap-2">
              {allowance.sweep_back ? <Chip tone="plain">Unspent goes back</Chip> : null}
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  setDay(allowance.day_of_month)
                  setSweepBack(allowance.sweep_back)
                  setEditing(true)
                }}
              >
                Change
              </Button>
              <Button
                type="button"
                variant="danger"
                size="sm"
                aria-label={`Stop the allowance on the ${accountWords(account.currency)}`}
                disabled={stop.isPending}
                onClick={() => stop.mutate(allowance.id)}
              >
                Stop
              </Button>
            </span>
          }
        />
        <p className="pb-2 text-caption text-ink-3">Next paid on {dayWords(allowance.next_run_at)}</p>
        <AllowanceMonths allowance={allowance} />
        {stop.isError ? (
          <p role="alert" className="pb-2.5 text-body text-ink-2">
            {refusalText(stop.error)}
          </p>
        ) : null}
      </div>
    )
  return (
    // A group, not a <form>: Radix's Switch inside a form measures a hidden input with ResizeObserver, which jsdom lacks.
    <div className="grid gap-2 border-t border-line py-2.5 first:border-t-0" role="group" aria-label={`Allowance, ${accountWords(account.currency)}`} data-testid={testid}>
      <Eyebrow>{accountWords(account.currency)}</Eyebrow>
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Amount each month">
          <Input aria-label={`Allowance amount, ${account.currency}`} inputMode="decimal" unit={account.currency} value={amount} onChange={(ev) => setAmount(ev.target.value)} />
        </Field>
        <Field label="Paid on">
          <Select aria-label={`Allowance day, ${account.currency}`} value={day} onChange={(ev) => setDay(Number(ev.target.value))}>
            {DAYS.map((d) => (
              <option key={d} value={d}>
                the {ordinal(d)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <label className="flex items-center justify-between gap-3 text-body text-ink-2">
        <span>Send what it did not spend back to the company’s account first</span>
        <Switch aria-label={`Sweep back, ${account.currency}`} checked={sweepBack} onCheckedChange={setSweepBack} />
      </label>
      <span className="flex gap-2">
        <Button
          type="button"
          size="sm"
          disabled={minor === null || save.isPending}
          onClick={() => {
            if (minor !== null) save.mutate(minor)
          }} disabledReason={minor === null ? 'Add an amount first.' : undefined}>
          Save
        </Button>
        {editing ? (
          <Button type="button" variant="outline" size="sm" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        ) : null}
      </span>
      {save.isError ? (
        <p role="alert" className="text-body text-ink-2">
          {refusalText(save.error)}
        </p>
      ) : null}
    </div>
  )
}

export function AllowanceCard({ agent, accounts }: { agent: { id: string; name: string }; accounts: CurrencyAccount[] }) {
  const list = useQuery({ queryKey: [...ALLOWANCES_KEY, agent.id], queryFn: () => agentBankApi.allowances(agent.id) })
  const payable = accounts.filter((a) => ALLOWANCE_CURRENCIES.includes(a.currency))
  const live = (list.data?.allowances ?? []).filter((a) => a.agent_id === agent.id && !a.stopped_at)
  return (
    <Card tone="white" className="grid gap-2" data-testid="agent-page-allowance">
      <h2 className="font-display text-reading font-bold text-ink">Monthly allowance</h2>
      <p className="text-body text-ink-3">Pay {agent.name} a set amount from the company’s account once a month.</p>
      {list.isError ? (
        <div role="alert" className="grid justify-items-start gap-3">
          <InlineFailure error={list.error} failed="Couldn’t load the allowances" />
          <Button variant="secondary" size="sm" onClick={() => void list.refetch()}>
            Try again
          </Button>
        </div>
      ) : list.isPending ? (
        <p className="text-body text-ink-3">Reading…</p>
      ) : payable.length === 0 ? (
        <p className="text-body text-ink-2">{agent.name} has no pound, euro or dollar account yet, so there is nowhere to pay an allowance.</p>
      ) : (
        <div>
          {payable.map((acc) => (
            <AccountAllowance key={acc.id} agentId={agent.id} account={acc} allowance={live.find((a) => a.currency === acc.currency)} />
          ))}
        </div>
      )}
    </Card>
  )
}
