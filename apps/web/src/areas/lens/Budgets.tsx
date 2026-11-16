import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bar, Button, Card, EmptyState, Field, Icon, Input, Money, Select } from '@talyvor/ui/pocket'
import { Note, readFailure } from './WalletMoney'
import { BOOK_KEY } from './AgentBank'
import { AgentBankError, type SpendBudget, agentBankApi, minorOf, refusalText } from './agentBankApi'
import { DESIGN_ATTR } from '../../pocketPending'

// Budgets.tsx — B41.39: a weekly or monthly budget per category (AI and software, travel …) for your own wallet, one
// agent's or every wallet together, each with a progress bar worked out by Lens from the postings (B41.139), and the
// alerts Lens raised at 50, 80 and 100% of it this period — each once. B57.89 draws it in Pocket, a tab of Activity.

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
/** B57.89 — dollars first (B55.38). */
const CURRENCIES = ['USD', 'EUR', 'GBP']
export const categoryName = (c: string) => CATEGORIES.find(([v]) => v === c)?.[1] ?? c.replace(/_/g, ' ')
/** A category's name inside a sentence: "eating out", but "AI and software". */
export const categoryWords = (c: string) => categoryName(c).replace(/^(?!AI\b)./, (f) => f.toLowerCase())

/** B55.42 — Lens's budget refusals list every category id and its own limits; these say what to do instead.
 *  B55.57 — matched in any case, so Lens's sentence with or without its "economy: spending: " prefix reads the same. */
function budgetRefusal(err: unknown): string {
  const s = err instanceof AgentBankError ? (err.sentence ?? '') : ''
  if (/category must be/i.test(s)) return 'Choose a category from the list.'
  const most = /at most (\d+) budgets/i.exec(s)
  return most ? `A workspace can have at most ${most[1]} budgets.` : refusalText(err)
}
const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })

/** B57.89 — the bar turns tangerine from 80%: most of the budget is gone, and what happens next is the owner's call. */
export const NEAR_PERCENT = 80

/** "£80.50 of £100.00 this month · £19.50 left": what a budget has spent, of what, and what is left or over. */
export function BudgetLine({ b }: { b: SpendBudget }) {
  return (
    <>
      <Money minor={b.spent_minor} currency={b.currency} /> of <Money minor={b.amount_minor} currency={b.currency} /> this{' '}
      {b.period === 'week' ? 'week' : 'month'} · <Money minor={Math.abs(b.left_minor)} currency={b.currency} /> {b.left_minor >= 0 ? 'left' : 'over'}
    </>
  )
}

/** One budget as Pocket draws it: its name, spent of amount, the bar, left or over, when it resets and the alerts reached. */
function BudgetCard({ b, whose, points, removing, onRemove }: { b: SpendBudget; whose: string; points: number[]; removing: boolean; onRemove: () => void }) {
  const label = `${categoryName(b.category)} · ${whose}`
  return (
    <Card className="grid gap-2.5" data-testid={`budget-${b.id}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold text-ink">{label}</h3>
        <span className="font-figure text-body font-semibold text-ink" data-testid={`budget-percent-${b.id}`}>
          {b.percent}%
        </span>
      </div>
      <Bar value={b.percent / 100} near={b.percent >= NEAR_PERCENT} label={`${label}: ${b.percent}% of budget used`} />
      <p className="text-body text-ink-2">
        <BudgetLine b={b} /> · resets <span className="font-figure">{day(b.period_end)}</span>
      </p>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-body text-ink-3">
          {points.length > 0 ? (
            <>
              Alerted at <span className="font-figure">{points.map((p) => `${p}%`).join(', ')}</span>
            </>
          ) : null}
        </p>
        <Button variant="danger" size="sm" disabled={removing} onClick={onRemove} aria-label={`Remove the ${label} budget`}>
          Remove
        </Button>
      </div>
    </Card>
  )
}

export function BudgetsScreen() {
  const qc = useQueryClient()
  const budgets = useQuery({ queryKey: BUDGETS_KEY, queryFn: agentBankApi.budgets })
  const alerts = useQuery({ queryKey: LIMIT_ALERTS_KEY, queryFn: agentBankApi.limitAlerts })
  const book = useQuery({ queryKey: BOOK_KEY, queryFn: agentBankApi.book })
  const agents = book.data?.agents ?? []
  const whose = (id: string) => (id === '' ? 'Your own wallet' : id === 'all' ? 'Every wallet' : (agents.find((a) => a.id === id)?.name ?? 'An agent'))

  const [form, setForm] = useState({ category: 'ai_software', agent_id: 'all', period: 'month' as SpendBudget['period'], amount: '', currency: 'USD' })
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
    <div {...{ [DESIGN_ATTR]: 'pocket' }} className="grid max-w-3xl gap-5 px-gutter py-4 wide:py-6">
      <p className="text-body text-ink-2">
        A weekly or monthly budget for a kind of spending (AI and software, travel, eating out) on your own wallet, one agent’s, or every wallet together. You
        get an alert when spending reaches 50, 80 and 100% of it, once each period.
      </p>
      <section className="grid gap-3">
        <h2 className="font-display text-reading font-bold text-ink">Your budgets</h2>
        {remove.isError ? <Note ok={false}>{refusalText(remove.error)}</Note> : null}
        {budgets.isError ? (
          <p className="text-body text-ink-2">{readFailure(budgets.error, 'Your budgets')}</p>
        ) : budgets.isPending ? (
          <p className="text-body text-ink-3">Reading…</p>
        ) : list.length === 0 ? (
          <EmptyState icon={<Icon name="spending" />} title="No budget yet" line="Choose a category below and a budget appears here with its progress." />
        ) : (
          list.map((b) => (
            <BudgetCard key={b.id} b={b} whose={whose(b.agent_id)} points={reached(b)} removing={remove.isPending} onRemove={() => remove.mutate(b.id)} />
          ))
        )}
      </section>
      <Card tone="white" className="grid gap-3">
        <h2 className="font-display text-reading font-bold text-ink">Set or change a budget</h2>
        <p className="text-body text-ink-2">Setting a budget for a category, wallet and period you already budget changes its amount.</p>
        <form
          className="grid gap-3 wide:grid-cols-2"
          data-testid="new-budget"
          onSubmit={(e) => {
            e.preventDefault()
            if (amountMinor !== null && !save.isPending) save.mutate()
          }}
        >
          <Field label="Category">
            <Select value={form.category} onChange={(e) => set({ category: e.target.value })}>
              {CATEGORIES.map(([v, name]) => (
                <option key={v} value={v}>
                  {name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Wallet">
            <Select value={form.agent_id} onChange={(e) => set({ agent_id: e.target.value })}>
              <option value="all">Every wallet</option>
              <option value="">Your own wallet</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Period">
            <Select value={form.period} onChange={(e) => set({ period: e.target.value as SpendBudget['period'] })}>
              <option value="month">Monthly</option>
              <option value="week">Weekly, from Monday</option>
            </Select>
          </Field>
          <Field label="Amount">
            <Input placeholder="100.00" inputMode="decimal" value={form.amount} onChange={(e) => set({ amount: e.target.value })} />
          </Field>
          <Field label="Currency">
            <Select value={form.currency} onChange={(e) => set({ currency: e.target.value })}>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex items-end">
            <Button type="submit" disabled={save.isPending} disabledReason={amountMinor === null ? 'Add an amount first.' : undefined}>
              {save.isPending ? 'Saving…' : 'Save budget'}
            </Button>
          </div>
          {save.isError ? <Note ok={false}>{budgetRefusal(save.error)}</Note> : null}
          {save.isSuccess ? <Note ok>Saved. Its progress is above.</Note> : null}
        </form>
      </Card>
    </div>
  )
}
