import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { inlineLink } from '@talyvor/ui'
import { Bar, Button, Card, EmptyState, Eyebrow, Field, Icon, Input, Money, RoomBadge, Row, Select, Switch } from '@talyvor/ui/pocket'
import { Note, readFailure } from './WalletMoney'
import { BOOK_KEY } from './AgentBank'
import { BUDGETS_KEY, BudgetLine, CATEGORIES, NEAR_PERCENT, categoryName } from './Budgets'
import { SUBSCRIPTIONS_KEY } from './Subscriptions'
import { MonthPlan } from './MonthPlan'
import { PHYSICAL_CARDS_KEY, physicalCardSource } from './PhysicalCard'
import { type CoachLine, type NoticeSettings, type SpendFinding, type Spending, agentBankApi, formatMinor, refusalText } from './agentBankApi'
import { DESIGN_ATTR } from '../../pocketPending'

// Spending.tsx — B53.8: the owner's own spending in one place, every number from Lens (B53.3–B53.7): this week and this
// month by category, the budgets and how far each has gone, the subscriptions with what they cost a year, what was
// unusual with the Coach's sentence on it, every payment of the month with its category (one correction moves that
// merchant's payments, past and future), and when and which notices arrive. B53.16 puts the month plan first: what is safe
// to spend each day until payday, the payments due before it, and what to change when the month is off plan (MonthPlan.tsx).

export const SPENDING_KEY = ['money-spending']
const UNUSUAL_KEY = ['money-spending-unusual']
const COACH_KEY = ['money-coach']
const NOTICES_KEY = ['money-notices']

/** [from, to) of this week (from Monday) or this month, at midnight in this browser's time zone, as Lens reads a period. */
export function spendPeriod(period: 'week' | 'month', now = new Date()): { from: string; to: string } {
  const start =
    period === 'week' ? new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7)) : new Date(now.getFullYear(), now.getMonth(), 1)
  const end = period === 'week' ? new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7) : new Date(start.getFullYear(), start.getMonth() + 1, 1)
  return { from: start.toISOString(), to: end.toISOString() }
}

/** Every wallet's spend in each currency on each category, added up: the owner's own and every agent's together. */
export function byCategory(s: Spending | undefined): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>()
  for (const t of s?.totals ?? []) {
    for (const [cat, minor] of Object.entries(t.by_category ?? {})) {
      const cur = out.get(cat) ?? new Map<string, number>()
      cur.set(t.currency, (cur.get(t.currency) ?? 0) + minor)
      out.set(cat, cur)
    }
  }
  return out
}

/** "£25.00 and €3.00": each currency's amount, never added across currencies. */
export const amounts = (cur: Map<string, number>) => [...cur].map(([c, m]) => formatMinor(m, c)).join(' and ')

/** The same, drawn: each currency's amount through <Money>. */
export function Amounts({ cur }: { cur: Map<string, number> }) {
  return (
    <>
      {[...cur].map(([c, m], i) => (
        <span key={c}>
          {i > 0 ? ' and ' : null}
          <Money minor={m} currency={c} />
        </span>
      ))}
    </>
  )
}

/** Each currency's total this month: what the owner and every agent spent, never added across currencies. */
function spentIn(s: Spending | undefined): Map<string, number> {
  const out = new Map<string, number>()
  for (const t of s?.totals ?? []) out.set(t.currency, (out.get(t.currency) ?? 0) + t.total_minor)
  return out
}

/** The categories, largest first by their largest currency. */
const largestFirst = (cats: Map<string, Map<string, number>>) => [...cats].sort(([, a], [, b]) => Math.max(...b.values()) - Math.max(...a.values()))

const RULES: Record<string, string> = {
  new_merchant: 'Somewhere new',
  above_usual: 'More than you usually pay',
  new_country: 'A new country',
  duplicate: 'Possibly paid twice',
  gambling: 'Gambling',
  agent_unusual_spend: 'An agent spending fast',
}
const KINDS: readonly [string, string][] = [
  ['payment', 'Each payment'],
  ['budget', 'Budget alerts'],
  ['unusual', 'Unusual payments'],
  ['tip', 'The Coach’s daily tip'],
  ['digest', 'Monday’s weekly digest'],
  ['plan', 'When the month plan is off'],
]
const heading = 'font-display text-reading font-bold text-ink'
const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

/** The Coach's sentence on each finding: the line for its rule and merchant (a sensitive merchant's line names none). */
function sentences(findings: SpendFinding[], lines: CoachLine[]): (CoachLine | undefined)[] {
  const left = [...lines]
  return findings.map((f) => {
    const i = left.findIndex((l) => l.fact.kind === f.rule && (l.fact.merchant === undefined || l.fact.merchant === f.merchant))
    return i < 0 ? undefined : left.splice(i, 1)[0]
  })
}

/** This week's or this month's spend by category, a row each, with a bar against the largest. */
function Totals({ period, title }: { period: 'week' | 'month'; title?: string }) {
  const [at] = useState(() => spendPeriod(period))
  const q = useQuery({ queryKey: [...SPENDING_KEY, period], queryFn: () => agentBankApi.spending(at.from, at.to) })
  const cats = largestFirst(byCategory(q.data))
  const top = cats.length > 0 ? Math.max(...cats[0][1].values()) : 0
  return (
    <Card className="grid gap-1" data-testid={`spending-${period}`}>
      {title ? <h3 className={heading}>{title}</h3> : null}
      {q.isError ? (
        <p className="text-body text-ink-2">{readFailure(q.error, 'Your spending')}</p>
      ) : q.isPending ? (
        <p className="text-body text-ink-3">Reading…</p>
      ) : cats.length === 0 ? (
        <p className="text-body text-ink-2">Nothing spent yet: a payment from your wallet or an agent’s lands in its category here.</p>
      ) : (
        cats.map(([cat, cur]) => (
          <div key={cat} className="grid gap-1.5 border-t border-line py-2.5 first-of-type:border-t-0" data-testid={`spending-${period}-${cat}`}>
            <div className="flex items-center justify-between gap-3 text-reading">
              <span className="font-semibold text-ink">{categoryName(cat)}</span>
              <span className="text-right font-semibold text-ink">
                <Amounts cur={cur} />
              </span>
            </div>
            <Bar thin value={top > 0 ? Math.max(...cur.values()) / top : 0} label={`${categoryName(cat)}: part of the most spent on one category`} />
          </div>
        ))
      )}
    </Card>
  )
}

export function SpendingScreen() {
  const qc = useQueryClient()
  const [month] = useState(() => spendPeriod('month'))
  const spending = useQuery({ queryKey: [...SPENDING_KEY, 'month'], queryFn: () => agentBankApi.spending(month.from, month.to) })
  const unusual = useQuery({ queryKey: [...UNUSUAL_KEY, month.from], queryFn: () => agentBankApi.unusual(month.from, month.to) })
  const coach = useQuery({ queryKey: COACH_KEY, queryFn: agentBankApi.coach })
  const budgets = useQuery({ queryKey: BUDGETS_KEY, queryFn: agentBankApi.budgets })
  const subs = useQuery({ queryKey: SUBSCRIPTIONS_KEY, queryFn: agentBankApi.subscriptions })
  const notices = useQuery({ queryKey: NOTICES_KEY, queryFn: agentBankApi.notices })
  // B55.43: a payment or unusual notice's push opens /money/spending#notice-{id}; once the notices are read, go to it.
  const { hash } = useLocation()
  useEffect(() => {
    if (hash.startsWith('#notice-') && notices.data !== undefined) document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'center' })
  }, [hash, notices.data])
  const book = useQuery({ queryKey: BOOK_KEY, queryFn: agentBankApi.book })
  const whose = (id: string | undefined) =>
    !id ? 'Your own wallet' : id === 'all' ? 'Every wallet' : (book.data?.agents.find((a) => a.id === id)?.name ?? 'An agent')

  const correct = useMutation({
    mutationFn: ({ merchant, category }: { merchant: string; category: string }) => agentBankApi.setSpendCategory(merchant, category),
    onSuccess: () => {
      for (const key of [SPENDING_KEY, UNUSUAL_KEY, COACH_KEY, BUDGETS_KEY, SUBSCRIPTIONS_KEY]) void qc.invalidateQueries({ queryKey: key })
    },
  })

  const [settings, setSettings] = useState<NoticeSettings | null>(null)
  useEffect(() => {
    if (notices.data !== undefined && settings === null) setSettings(notices.data.settings)
  }, [notices.data, settings])
  const saveSettings = useMutation({
    mutationFn: (s: NoticeSettings) => agentBankApi.setNoticeSettings({ ...s, timezone: s.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone }),
    onSuccess: (s) => {
      setSettings(s)
      void qc.invalidateQueries({ queryKey: NOTICES_KEY })
    },
  })

  // B53.12 — null while Lens's physical-card switch is off, and then no link shows. B60.6: not asked at all until served.
  const physicalCards = useQuery({ queryKey: PHYSICAL_CARDS_KEY, queryFn: agentBankApi.physicalCards, retry: false, enabled: physicalCardSource.served })
  const findings = unusual.data?.findings ?? []
  const said = sentences(findings, coach.data?.lines ?? [])
  const payments = spending.data?.payments ?? []

  const spent = spentIn(spending.data)

  return (
    <div {...{ [DESIGN_ATTR]: 'pocket' }} className="grid max-w-6xl gap-6 px-gutter py-4 wide:py-6">
      <p className="max-w-3xl text-body text-ink-2">
        Every payment from your own wallet and your agents’, sorted into categories, against your budgets. The Coach explains anything unusual in a sentence; it
        talks only about your own spending.
      </p>

      <div className="grid items-start gap-3 wide:grid-cols-2">
        <Card className="grid content-start gap-2" data-testid="spending-spent">
          <Eyebrow>Spent this month</Eyebrow>
          {spending.isError ? (
            <p className="text-body text-ink-2">{readFailure(spending.error, 'Your spending')}</p>
          ) : spending.isPending ? (
            <p className="text-body text-ink-3">Reading…</p>
          ) : spent.size === 0 ? (
            <Money size="card" minor={0} currency="USD" />
          ) : (
            [...spent].map(([c, m]) => <Money key={c} size={spent.size > 1 ? 'card-sm' : 'card'} minor={m} currency={c} />)
          )}
          <p className="text-body text-ink-3">By you and your agents</p>
        </Card>
        <section className="grid content-start gap-2">
          <h2 className={heading}>Where it went</h2>
          <Totals period="month" />
        </section>
      </div>

      {physicalCards.data ? (
        <Card tight className="flex items-center gap-3">
          <RoomBadge icon={<Icon name="card" />} />
          <p className="text-body text-ink-2">
            <Link className={`font-semibold text-ink ${inlineLink}`} to="/money/card">
              Your Talyvor Card
            </Link>
            : order one, follow its delivery, activate it, or replace a lost one.
          </p>
        </Card>
      ) : null}

      <div className="grid items-start gap-6 wide:grid-cols-2">
        <div className="grid gap-6">
          <section className="grid gap-3">
            <h2 className={heading}>Until payday</h2>
            <MonthPlan />
          </section>

          <section className="grid gap-3">
            <h2 className={heading}>This week, from Monday</h2>
            <Totals period="week" />
          </section>

          <section className="grid gap-3">
            <h2 className={heading}>This month’s payments</h2>
            <p className="text-body text-ink-2">Change a payment’s category and every payment to that merchant, before and after, moves with it.</p>
            {correct.isError ? <Note ok={false}>{refusalText(correct.error)}</Note> : null}
            {spending.isError ? (
              <p className="text-body text-ink-2">{readFailure(spending.error, 'Your payments')}</p>
            ) : payments.length === 0 ? (
              <p className="text-body text-ink-2">{spending.isPending ? 'Reading…' : 'No payment this month yet.'}</p>
            ) : (
              <Card>
                {payments.map((p) => (
                  <div key={p.entry_id} data-testid={`spending-payment-${p.entry_id}`}>
                    <Row
                      wrap
                      title={p.merchant || 'A payment'}
                      line={
                        <>
                          {day(p.created_at)} · {whose(p.agent_id)}
                        </>
                      }
                      amount={<Money minor={p.amount_minor} currency={p.currency} />}
                      action={
                        <Select
                          aria-label={`Category of ${p.merchant || 'this payment'}`}
                          className="w-44"
                          value={p.category}
                          disabled={correct.isPending || !p.merchant}
                          onChange={(e) => correct.mutate({ merchant: p.merchant, category: e.target.value })}
                        >
                          {CATEGORIES.filter(([v]) => v !== '').map(([v, name]) => (
                            <option key={v} value={v}>
                              {name}
                            </option>
                          ))}
                        </Select>
                      }
                    />
                  </div>
                ))}
              </Card>
            )}
          </section>
        </div>
        <div className="grid gap-6">
          <section className="grid gap-3">
            <h2 className={heading}>Your budgets</h2>
            {budgets.isError ? (
              <p className="text-body text-ink-2">{readFailure(budgets.error, 'Your budgets')}</p>
            ) : (budgets.data?.budgets ?? []).length === 0 ? (
              <p className="text-body text-ink-2">{budgets.isPending ? 'Reading…' : 'No budget yet.'}</p>
            ) : (
              <Card className="grid gap-1">
                {(budgets.data?.budgets ?? []).map((b) => {
                  const label = `${categoryName(b.category)} · ${whose(b.agent_id)}`
                  return (
                    <div key={b.id} className="grid gap-1.5 border-t border-line py-2.5 first-of-type:border-t-0" data-testid={`spending-budget-${b.id}`}>
                      <span className="font-semibold text-ink">{label}</span>
                      <Bar value={b.percent / 100} near={b.percent >= NEAR_PERCENT} label={`${label}: ${b.percent}% of budget used`} />
                      <span className="text-body text-ink-2">
                        <BudgetLine b={b} />
                      </span>
                    </div>
                  )
                })}
              </Card>
            )}
            <p className="text-body">
              <Link className={`text-ink ${inlineLink}`} to="/money/budgets">
                Set or change a budget
              </Link>
            </p>
          </section>

          <section className="grid gap-3">
            <h2 className={heading}>What was unusual this month</h2>
            {unusual.isError ? (
              <p className="text-body text-ink-2">{readFailure(unusual.error, 'Unusual spending')}</p>
            ) : findings.length === 0 || coach.isPending ? (
              // The Coach asks a model, so it answers after the findings; a row waits for its sentence rather than showing without it.
              <p className="text-body text-ink-2">{unusual.isPending || coach.isPending ? 'Reading…' : 'Nothing unusual this month.'}</p>
            ) : (
              <Card>
                {findings.map((f, i) => {
                  const line = said[i]
                  return (
                    <div key={`${f.rule}-${f.entry_id ?? f.at}-${i}`} data-testid={`spending-unusual-${f.entry_id ?? i}`}>
                      <Row
                        wrap
                        title={`${RULES[f.rule] ?? f.rule} · ${f.merchant || (f.category ? categoryName(f.category) : whose(f.agent_id))}`}
                        line={
                          <>
                            {line !== undefined ? <span data-testid="coach-sentence">{line.sentence}</span> : null}
                            {line?.help?.map((h) => (
                              <span key={h.name}>
                                {' '}
                                <a className={`text-ink ${inlineLink}`} href={h.url} target="_blank" rel="noreferrer">
                                  {h.name}
                                </a>
                                : {h.for}.
                              </span>
                            ))}
                          </>
                        }
                        amount={
                          <>
                            {f.amount_minor !== undefined && f.currency ? <Money minor={f.amount_minor} currency={f.currency} /> : null} · {day(f.at)}
                          </>
                        }
                      />
                    </div>
                  )
                })}
              </Card>
            )}
          </section>

          <section className="grid gap-3">
            <h2 className={heading}>What you pay again and again</h2>
            {subs.isError ? (
              <p className="text-body text-ink-2">{readFailure(subs.error, 'Your subscriptions')}</p>
            ) : (subs.data?.subscriptions ?? []).length === 0 ? (
              subs.isPending ? (
                <p className="text-body text-ink-3">Reading…</p>
              ) : (
                <EmptyState icon={<Icon name="clock" />} title="No subscription found yet" line="One shows after its third payment." />
              )
            ) : (
              <Card>
                {(subs.data?.subscriptions ?? []).map((s) => (
                  <Row
                    key={`${s.agent_id ?? ''}-${s.merchant}-${s.amount_minor}`}
                    wrap
                    title={s.merchant}
                    line={
                      <>
                        <Money minor={s.amount_minor} currency={s.currency} /> {s.interval} · next <span className="font-figure">{day(s.next_at)}</span>
                      </>
                    }
                    amount={
                      <>
                        <Money minor={s.yearly_minor} currency={s.currency} /> a year
                      </>
                    }
                  />
                ))}
              </Card>
            )}
          </section>

          <section className="grid gap-3">
            <h2 className={heading}>When you hear from us</h2>
            {notices.isError ? (
              <p className="text-body text-ink-2">{readFailure(notices.error, 'Your notice settings')}</p>
            ) : settings === null ? (
              <p className="text-body text-ink-3">Reading…</p>
            ) : (
              <Card tone="white">
                {/* A group, not a <form>: Radix's Switch inside a form measures a hidden input with ResizeObserver, which jsdom lacks. */}
                <div className="grid gap-4" role="group" aria-label="When you hear from us" data-testid="notice-settings">
                  <p className="text-body text-ink-2">Quiet hours hold every notice but an unusual payment until they end. Leave both empty for none.</p>
                  <div className="grid grid-cols-2 gap-3 wide:max-w-sm">
                    <Field label="Quiet from">
                      <Input type="time" value={settings.quiet_from} onChange={(e) => setSettings({ ...settings, quiet_from: e.target.value })} />
                    </Field>
                    <Field label="Quiet until">
                      <Input type="time" value={settings.quiet_until} onChange={(e) => setSettings({ ...settings, quiet_until: e.target.value })} />
                    </Field>
                  </div>
                  <fieldset className="grid gap-1">
                    <legend className="pb-1 text-body font-semibold text-ink-2">Tell me about</legend>
                    {KINDS.map(([kind, name]) => {
                      const off = settings.off ?? []
                      return (
                        <div
                          key={kind}
                          className="flex items-center justify-between gap-3 border-t border-line py-2 text-reading text-ink first-of-type:border-t-0"
                        >
                          <span>{name}</span>
                          <Switch
                            aria-label={name}
                            checked={!off.includes(kind)}
                            onCheckedChange={(on) => setSettings({ ...settings, off: on ? off.filter((k) => k !== kind) : [...off, kind] })}
                          />
                        </div>
                      )
                    })}
                  </fieldset>
                  <div>
                    <Button type="button" disabled={saveSettings.isPending} onClick={() => saveSettings.mutate(settings)}>
                      {saveSettings.isPending ? 'Saving…' : 'Save notice settings'}
                    </Button>
                  </div>
                  {saveSettings.isError ? <Note ok={false}>{refusalText(saveSettings.error)}</Note> : null}
                  {saveSettings.isSuccess ? <Note ok>Saved.</Note> : null}
                </div>
              </Card>
            )}
            {(notices.data?.notices ?? []).length > 0 ? (
              <Card className="grid gap-1">
                <h3 className={heading}>Latest notices</h3>
                {(notices.data?.notices ?? []).slice(0, 10).map((n) => (
                  <div key={n.id} id={`notice-${n.id}`}>
                    <Row
                      title={n.title}
                      line={
                        <>
                          {n.body} · {day(n.created_at)}
                          {n.status === 'waiting' ? (n.held === 'quiet_hours' ? ' · waiting for quiet hours to end' : ' · waiting: one tip a day') : null}
                        </>
                      }
                    />
                  </div>
                ))}
              </Card>
            ) : null}
          </section>
        </div>
      </div>
    </div>
  )
}
