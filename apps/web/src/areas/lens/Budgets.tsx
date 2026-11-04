import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, CardHeader, Input, Row, focusRing } from '@talyvor/ui'
import { Card } from './walletBrand'
import { Region, RegionScreen } from '../../components/Region'
import { Note, readFailure } from './WalletMoney'
import { BOOK_KEY } from './AgentBank'
import { type SpendBudget, agentBankApi, formatMinor, minorOf, refusalText } from './agentBankApi'

// Budgets.tsx — B41.39: a weekly or monthly budget per category (AI and software, travel …) for your own wallet, one
// agent's or every wallet together, each with a progress bar worked out by Lens from the postings (B41.139), and the
// alerts Lens raised at 50, 80 and 100% of it this period — each once.

export const BUDGETS_KEY = ['money-budgets']
const LIMIT_ALERTS_KEY = ['limit-alerts']

/** Lens economy.SpendCategories, in its picker order. */
export const CATEGORIES: readonly [string, string][] = [
  ['ai_software', 'AI and software'],
  ['groceries', 'Groceries'],
  ['eating_out', 'Eating out'],
  ['transport', 'Transport'],
  ['travel', 'Travel'],
  ['bills', 'Bills'],
  ['subscriptions', 'Subscriptions'],
  ['shopping', 'Shopping'],
  ['health', 'Health'],
  ['entertainment', 'Entertainment'],
  ['cash', 'Cash'],
  ['transfers', 'Transfers to people'],
  ['other', 'Other'],
  ['', 'All spending'],
]
const CURRENCIES = ['GBP', 'EUR', 'USD']
export const categoryName = (c: string) => CATEGORIES.find(([v]) => v === c)?.[1] ?? c.replace(/_/g, ' ')
const select = `h-8 rounded-control border border-rule bg-surface px-2 text-body text-ink transition-colors duration-200 hover:border-rule-strong ${focusRing}`
const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })

export function BudgetsScreen() {
  const qc = useQueryClient()
  const budgets = useQuery({ queryKey: BUDGETS_KEY, queryFn: agentBankApi.budgets })
  const alerts = useQuery({ queryKey: LIMIT_ALERTS_KEY, queryFn: agentBankApi.limitAlerts })
  const book = useQuery({ queryKey: BOOK_KEY, queryFn: agentBankApi.book })
  const agents = book.data?.agents ?? []
  const whose = (id: string) => (id === '' ? 'Your own wallet' : id === 'all' ? 'Every wallet' : (agents.find((a) => a.id === id)?.name ?? 'An agent'))

  const [form, setForm] = useState({ category: 'ai_software', agent_id: 'all', period: 'month' as SpendBudget['period'], amount: '', currency: 'GBP' })
  const set = (p: Partial<typeof form>) => setForm((f) => ({ ...f, ...p }))
  const amountMinor = minorOf(form.amount)
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: BUDGETS_KEY })
    void qc.invalidateQueries({ queryKey: LIMIT_ALERTS_KEY })
  }
  const save = useMutation({
    mutationFn: () =>
      agentBankApi.setBudget({
        agent_id: form.agent_id,
        category: form.category,
        period: form.period,
        amount_minor: amountMinor ?? 0,
        currency: form.currency,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
    onSuccess: () => {
      set({ amount: '' })
      refresh()
    },
  })
  const remove = useMutation({ mutationFn: agentBankApi.deleteBudget, onSuccess: refresh })

  const list = budgets.data?.budgets ?? []
  /** The points this period's spending has reached on a budget, as Lens raised them. */
  const reached = (b: SpendBudget) =>
    (alerts.data?.alerts ?? [])
      .filter((a) => a.kind === 'budget' && a.subject === b.id && Date.parse(a.period_start) === Date.parse(b.period_start))
      .map((a) => a.percent)
      .sort((x, y) => x - y)

  return (
    <RegionScreen>
      <Region
        index="00"
        label="Budgets"
        heading="What you mean to spend, by category"
        sectionClassName="pb-10 pt-4 wide:pb-12"
        className="flex max-w-2xl flex-col gap-3"
      >
        <p className="text-body text-muted">
          A weekly or monthly budget for a kind of spending — AI and software, travel, eating out — on your own wallet, one
          agent’s, or every wallet together. You get an alert when spending reaches 50, 80 and 100% of it, once each period.
        </p>
      </Region>
      <Region index="01" label="This period" heading="Your budgets" className="flex max-w-2xl flex-col gap-3">
        {remove.isError ? <Note ok={false}>{refusalText(remove.error)}</Note> : null}
        {budgets.isError ? (
          <p className="text-body text-muted">{readFailure(budgets.error, 'Your budgets')}</p>
        ) : budgets.isPending ? (
          <p className="text-body text-muted">Reading…</p>
        ) : list.length === 0 ? (
          <p className="text-body text-muted">No budget yet. Choose a category below and a budget appears here with its progress.</p>
        ) : (
          <Card>
            <CardHeader>Budgets</CardHeader>
            {list.map((b) => {
              const pct = Math.min(100, Math.max(0, b.percent))
              const points = reached(b)
              const label = `${categoryName(b.category)} · ${whose(b.agent_id)}`
              return (
                <Row
                  key={b.id}
                  stack
                  data-testid={`budget-${b.id}`}
                  label={label}
                  hint={
                    <>
                      <span className="font-figure">{formatMinor(b.spent_minor, b.currency)}</span> of{' '}
                      <span className="font-figure">{formatMinor(b.amount_minor, b.currency)}</span> this{' '}
                      {b.period === 'week' ? 'week' : 'month'} ·{' '}
                      {b.left_minor >= 0 ? (
                        <>
                          <span className="font-figure">{formatMinor(b.left_minor, b.currency)}</span> left
                        </>
                      ) : (
                        <>
                          <span className="font-figure">{formatMinor(-b.left_minor, b.currency)}</span> over
                        </>
                      )}{' '}
                      · resets <span className="font-figure">{day(b.period_end)}</span>
                      {points.length > 0 ? (
                        <>
                          <br />
                          Alerted at <span className="font-figure">{points.map((p) => `${p}%`).join(', ')}</span>
                        </>
                      ) : null}
                    </>
                  }
                >
                  <div className="flex w-full items-center gap-3 wide:w-64">
                    <div
                      className="relative h-2 flex-1 overflow-hidden rounded-pill bg-rule-strong"
                      role="progressbar"
                      aria-valuenow={pct}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`${label}: budget used`}
                    >
                      {/* width is a runtime value → inline style, not a Tailwind arbitrary class. */}
                      <div
                        className={`absolute inset-y-0 left-0 rounded-pill ${b.percent >= 100 ? 'bg-slashed' : b.percent >= 80 ? 'bg-held' : 'bg-accent'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="w-12 text-right font-figure text-body text-ink" data-testid={`budget-percent-${b.id}`}>
                      {b.percent}%
                    </span>
                    <Button variant="danger" disabled={remove.isPending} onClick={() => remove.mutate(b.id)} aria-label={`Remove the ${label} budget`}>
                      Remove
                    </Button>
                  </div>
                </Row>
              )
            })}
          </Card>
        )}
      </Region>
      <Region index="02" label="Set a budget" heading="Set or change a budget" className="flex max-w-2xl flex-col gap-3">
        <p className="text-body text-muted">Setting a budget for a category, wallet and period you already budget changes its amount.</p>
        <form
          className="flex flex-col gap-3"
          data-testid="new-budget"
          onSubmit={(e) => {
            e.preventDefault()
            if (amountMinor !== null && !save.isPending) save.mutate()
          }}
        >
          <div className="flex flex-wrap items-center gap-2">
            <select aria-label="Category" className={select} value={form.category} onChange={(e) => set({ category: e.target.value })}>
              {CATEGORIES.map(([v, name]) => (
                <option key={v} value={v}>
                  {name}
                </option>
              ))}
            </select>
            <select aria-label="Wallet" className={select} value={form.agent_id} onChange={(e) => set({ agent_id: e.target.value })}>
              <option value="all">Every wallet</option>
              <option value="">Your own wallet</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <select aria-label="Period" className={select} value={form.period} onChange={(e) => set({ period: e.target.value as SpendBudget['period'] })}>
              <option value="month">Monthly</option>
              <option value="week">Weekly, from Monday</option>
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input aria-label="Amount" placeholder="Amount (100.00)" className="w-36 font-figure" inputMode="decimal" value={form.amount} onChange={(e) => set({ amount: e.target.value })} />
            <select aria-label="Currency" className={select} value={form.currency} onChange={(e) => set({ currency: e.target.value })}>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <Button type="submit" variant="primary" disabled={amountMinor === null || save.isPending}>
              {save.isPending ? 'Saving…' : 'Save budget'}
            </Button>
          </div>
          {save.isError ? <Note ok={false}>{refusalText(save.error)}</Note> : null}
          {save.isSuccess ? <Note ok>Saved. Its progress is above.</Note> : null}
        </form>
      </Region>
    </RegionScreen>
  )
}
