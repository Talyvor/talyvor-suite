import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, CardHeader, Input, Row, focusRing, inlineLink } from '@talyvor/ui'
import { Card } from './walletBrand'
import { Region, RegionScreen } from '../../components/Region'
import { Note, readFailure } from './WalletMoney'
import { BOOK_KEY } from './AgentBank'
import { BUDGETS_KEY, CATEGORIES, categoryName } from './Budgets'
import { SUBSCRIPTIONS_KEY } from './Subscriptions'
import { MonthPlan } from './MonthPlan'
import { PHYSICAL_CARDS_KEY } from './PhysicalCard'
import { type CoachLine, type NoticeSettings, type SpendFinding, type Spending, agentBankApi, formatMinor, refusalText } from './agentBankApi'

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
    period === 'week'
      ? new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7))
      : new Date(now.getFullYear(), now.getMonth(), 1)
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
const select = `h-8 rounded-control border border-rule-strong bg-surface px-2 text-body text-ink transition-colors duration-200 hover:border-rule-strong ${focusRing}`
const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

/** The Coach's sentence on each finding: the line for its rule and merchant (a sensitive merchant's line names none). */
function sentences(findings: SpendFinding[], lines: CoachLine[]): (CoachLine | undefined)[] {
  const left = [...lines]
  return findings.map((f) => {
    const i = left.findIndex((l) => l.fact.kind === f.rule && (l.fact.merchant === undefined || l.fact.merchant === f.merchant))
    return i < 0 ? undefined : left.splice(i, 1)[0]
  })
}

function Totals({ title, period }: { title: string; period: 'week' | 'month' }) {
  const [at] = useState(() => spendPeriod(period))
  const q = useQuery({ queryKey: [...SPENDING_KEY, period], queryFn: () => agentBankApi.spending(at.from, at.to) })
  const cats = [...byCategory(q.data)].sort(([, a], [, b]) => Math.max(...b.values()) - Math.max(...a.values()))
  return (
    <Card data-testid={`spending-${period}`}>
      <CardHeader>{title}</CardHeader>
      {q.isError ? (
        <p className="px-4 py-3 text-body text-muted">{readFailure(q.error, 'Your spending')}</p>
      ) : q.isPending ? (
        <p className="px-4 py-3 text-body text-muted">Reading…</p>
      ) : cats.length === 0 ? (
        <p className="px-4 py-3 text-body text-muted">Nothing spent yet: a payment from your wallet or an agent’s lands in its category here.</p>
      ) : (
        cats.map(([cat, cur]) => (
          <Row key={cat} label={categoryName(cat)} data-testid={`spending-${period}-${cat}`}>
            <span className="font-figure text-body text-ink">{amounts(cur)}</span>
          </Row>
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

  // B53.12 — null while Lens's physical-card switch is off, and then no link shows.
  const physicalCards = useQuery({ queryKey: PHYSICAL_CARDS_KEY, queryFn: agentBankApi.physicalCards, retry: false })
  const findings = unusual.data?.findings ?? []
  const said = sentences(findings, coach.data?.lines ?? [])
  const payments = spending.data?.payments ?? []

  return (
    <RegionScreen>
      <Region index="00" label="Spending" heading="Where your money went" sectionClassName="pb-10 pt-4 wide:pb-12" className="flex max-w-2xl flex-col gap-3">
        <p className="text-body text-muted">
          Every payment from your own wallet and your agents’, sorted into categories, against your budgets. The Coach explains anything
          unusual in a sentence; it talks only about your own spending.
        </p>
        {physicalCards.data ? (
          <p className="text-body text-muted">
            <Link className={inlineLink} to="/money/card">
              Your Talyvor Card
            </Link>:{' '}
            order one, follow its delivery, activate it, or replace a lost one.
          </p>
        ) : null}
      </Region>

      <Region index="01" label="Month plan" heading="Until payday" className="flex max-w-2xl flex-col gap-3">
        <MonthPlan />
      </Region>

      <Region index="02" label="By category" heading="This week and this month" className="flex max-w-2xl flex-col gap-3">
        <Totals title="This week, from Monday" period="week" />
        <Totals title="This month" period="month" />
      </Region>

      <Region index="03" label="Budgets" heading="Your budgets" className="flex max-w-2xl flex-col gap-3">
        {budgets.isError ? (
          <p className="text-body text-muted">{readFailure(budgets.error, 'Your budgets')}</p>
        ) : (budgets.data?.budgets ?? []).length === 0 ? (
          <p className="text-body text-muted">{budgets.isPending ? 'Reading…' : 'No budget yet.'}</p>
        ) : (
          <Card>
            <CardHeader>Budgets</CardHeader>
            {(budgets.data?.budgets ?? []).map((b) => {
              const pct = Math.min(100, Math.max(0, b.percent))
              const label = `${categoryName(b.category)} · ${whose(b.agent_id)}`
              return (
                <Row
                  key={b.id}
                  stack
                  label={label}
                  data-testid={`spending-budget-${b.id}`}
                  hint={
                    <>
                      <span className="font-figure">{formatMinor(b.spent_minor, b.currency)}</span> of{' '}
                      <span className="font-figure">{formatMinor(b.amount_minor, b.currency)}</span> this {b.period} ·{' '}
                      <span className="font-figure">{formatMinor(Math.abs(b.left_minor), b.currency)}</span> {b.left_minor >= 0 ? 'left' : 'over'}
                    </>
                  }
                >
                  <div
                    className="relative h-2 w-full overflow-hidden rounded-pill bg-rule-strong wide:w-64"
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
                </Row>
              )
            })}
          </Card>
        )}
        <p className="text-body text-muted">
          <Link className={inlineLink} to="/money/budgets">
            Set or change a budget
          </Link>
        </p>
      </Region>

      <Region index="04" label="Unusual" heading="What was unusual this month" className="flex max-w-2xl flex-col gap-3">
        {unusual.isError ? (
          <p className="text-body text-muted">{readFailure(unusual.error, 'Unusual spending')}</p>
        ) : findings.length === 0 || coach.isPending ? (
          // The Coach asks a model, so it answers after the findings; a row waits for its sentence rather than showing without it.
          <p className="text-body text-muted">{unusual.isPending || coach.isPending ? 'Reading…' : 'Nothing unusual this month.'}</p>
        ) : (
          <Card>
            <CardHeader>Unusual payments</CardHeader>
            {findings.map((f, i) => {
              const line = said[i]
              return (
                <Row
                  key={`${f.rule}-${f.entry_id ?? f.at}-${i}`}
                  stack
                  data-testid={`spending-unusual-${f.entry_id ?? i}`}
                  label={`${RULES[f.rule] ?? f.rule} · ${f.merchant || (f.category ? categoryName(f.category) : whose(f.agent_id))}`}
                  hint={
                    <>
                      {line !== undefined ? <span data-testid="coach-sentence">{line.sentence}</span> : null}
                      {line?.help?.map((h) => (
                        <span key={h.name}>
                          {' '}
                          <a className={inlineLink} href={h.url} target="_blank" rel="noreferrer">
                            {h.name}
                          </a>:{' '}
                          {h.for}.
                        </span>
                      ))}
                    </>
                  }
                >
                  <span className="font-figure text-body text-ink">
                    {f.amount_minor !== undefined && f.currency ? formatMinor(f.amount_minor, f.currency) : null} · {day(f.at)}
                  </span>
                </Row>
              )
            })}
          </Card>
        )}
      </Region>

      <Region index="05" label="Payments" heading="This month’s payments" className="flex max-w-2xl flex-col gap-3">
        <p className="text-body text-muted">Change a payment’s category and every payment to that merchant, before and after, moves with it.</p>
        {correct.isError ? <Note ok={false}>{refusalText(correct.error)}</Note> : null}
        {spending.isError ? (
          <p className="text-body text-muted">{readFailure(spending.error, 'Your payments')}</p>
        ) : payments.length === 0 ? (
          <p className="text-body text-muted">{spending.isPending ? 'Reading…' : 'No payment this month yet.'}</p>
        ) : (
          <Card>
            <CardHeader>Payments</CardHeader>
            {payments.map((p) => (
              <Row
                key={p.entry_id}
                stack
                data-testid={`spending-payment-${p.entry_id}`}
                label={p.merchant || 'A payment'}
                hint={
                  <>
                    <span className="font-figure">{formatMinor(p.amount_minor, p.currency)}</span> · {day(p.created_at)} · {whose(p.agent_id)}
                  </>
                }
              >
                <select
                  aria-label={`Category of ${p.merchant || 'this payment'}`}
                  className={select}
                  value={p.category}
                  disabled={correct.isPending || !p.merchant}
                  onChange={(e) => correct.mutate({ merchant: p.merchant, category: e.target.value })}
                >
                  {CATEGORIES.filter(([v]) => v !== '').map(([v, name]) => (
                    <option key={v} value={v}>
                      {name}
                    </option>
                  ))}
                </select>
              </Row>
            ))}
          </Card>
        )}
      </Region>

      <Region index="06" label="Subscriptions" heading="What you pay again and again" className="flex max-w-2xl flex-col gap-3">
        {subs.isError ? (
          <p className="text-body text-muted">{readFailure(subs.error, 'Your subscriptions')}</p>
        ) : (subs.data?.subscriptions ?? []).length === 0 ? (
          <p className="text-body text-muted">{subs.isPending ? 'Reading…' : 'No subscription found yet: one shows after its third payment.'}</p>
        ) : (
          <Card>
            <CardHeader>Subscriptions</CardHeader>
            {(subs.data?.subscriptions ?? []).map((s) => (
              <Row
                key={`${s.agent_id ?? ''}-${s.merchant}-${s.amount_minor}`}
                label={s.merchant}
                hint={
                  <>
                    <span className="font-figure">{formatMinor(s.amount_minor, s.currency)}</span> {s.interval} · next{' '}
                    <span className="font-figure">{day(s.next_at)}</span>
                  </>
                }
              >
                <span className="font-figure text-body text-ink">{formatMinor(s.yearly_minor, s.currency)} a year</span>
              </Row>
            ))}
          </Card>
        )}
      </Region>

      <Region index="07" label="Notices" heading="When you hear from us" className="flex max-w-2xl flex-col gap-3">
        {notices.isError ? (
          <p className="text-body text-muted">{readFailure(notices.error, 'Your notice settings')}</p>
        ) : settings === null ? (
          <p className="text-body text-muted">Reading…</p>
        ) : (
          <form
            className="flex flex-col gap-3"
            data-testid="notice-settings"
            onSubmit={(e) => {
              e.preventDefault()
              if (!saveSettings.isPending) saveSettings.mutate(settings)
            }}
          >
            <p className="text-body text-muted">
              Quiet hours hold every notice but an unusual payment until they end. Leave both empty for none.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Input aria-label="Quiet from" type="time" className="w-32 font-figure" value={settings.quiet_from} onChange={(e) => setSettings({ ...settings, quiet_from: e.target.value })} />
              <span className="text-body text-muted">to</span>
              <Input aria-label="Quiet until" type="time" className="w-32 font-figure" value={settings.quiet_until} onChange={(e) => setSettings({ ...settings, quiet_until: e.target.value })} />
            </div>
            <fieldset className="flex flex-col gap-2">
              <legend className="pb-1 text-body text-ink">Tell me about</legend>
              {KINDS.map(([kind, name]) => {
                const off = settings.off ?? []
                return (
                  <label key={kind} className="flex items-center gap-2 text-body text-ink">
                    <input
                      type="checkbox"
                      className={`h-4 w-4 shrink-0 accent-accent transition-colors duration-200 hover:border-rule-strong disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`}
                      checked={!off.includes(kind)}
                      onChange={(e) => setSettings({ ...settings, off: e.target.checked ? off.filter((k) => k !== kind) : [...off, kind] })}
                    />
                    {name}
                  </label>
                )
              })}
            </fieldset>
            <div>
              <Button type="submit" variant="primary" disabled={saveSettings.isPending}>
                {saveSettings.isPending ? 'Saving…' : 'Save notice settings'}
              </Button>
            </div>
            {saveSettings.isError ? <Note ok={false}>{refusalText(saveSettings.error)}</Note> : null}
            {saveSettings.isSuccess ? <Note ok>Saved.</Note> : null}
          </form>
        )}
        {(notices.data?.notices ?? []).length > 0 ? (
          <Card>
            <CardHeader>Latest notices</CardHeader>
            {(notices.data?.notices ?? []).slice(0, 10).map((n) => (
              <Row
                key={n.id}
                id={`notice-${n.id}`}
                stack
                label={n.title}
                hint={
                  <>
                    {n.body} · {day(n.created_at)}
                    {n.status === 'waiting' ? (n.held === 'quiet_hours' ? ' · waiting for quiet hours to end' : ' · waiting: one tip a day') : null}
                  </>
                }
              />
            ))}
          </Card>
        ) : null}
      </Region>
    </RegionScreen>
  )
}
