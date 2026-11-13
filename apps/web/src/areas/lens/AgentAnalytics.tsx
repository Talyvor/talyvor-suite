import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CardHeader, Row, focusRing } from '@talyvor/ui'
import { Money } from '@talyvor/ui/pocket'
import { Card } from './walletBrand'
import { isSessionExpired } from '../../lib/productState'
import { type Agent, type SpendAnalytics, type SpendBucket, agentBankApi } from './agentBankApi'

// AgentAnalytics.tsx — B28.53: one agent's spend for a period by day, model and destination (Lens B28.326). Every
// posting that took money out of the agent's account is in exactly one of Lens's buckets, so each of the three views
// below adds up to the same Out — the agent's total out on its statement for the period. A hold's unused part comes
// back as Returned on the day it came back; Spent is Out less Returned.
//
// Lens decides; the card shows Lens's figures and never adds a bucket of its own.

export const analyticsKey = (id: string, from: string) => ['agent-analytics', id, from]

/** The periods the card reads, each ending now. */
const PERIODS = [
  { label: 'Last 7 days', days: 7 },
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 90 days', days: 90 },
] as const

/** The UTC day `days − 1` days before today: the period holds today and the days before it. */
const fromDay = (days: number, now = new Date()) => new Date(now.getTime() - (days - 1) * 86_400_000).toISOString().slice(0, 10)

/** Where the money went, in the words the statement uses for the same accounts. */
export function destinationText(destination: string, nameOf: (id: string) => string): string {
  if (destination.startsWith('agent:')) return nameOf(destination.slice(6))
  if (destination.startsWith('escrow:')) return 'Escrow'
  if (destination.startsWith('pot:')) return 'A pot'
  switch (destination) {
    case 'spend':
      return 'Requests and card'
    case 'held':
      return 'Held for requests'
    case 'workspace':
      return 'The workspace'
    default:
      return 'Another account'
  }
}

interface Group {
  key: string
  label: string
  out: number
  returned: number
  postings: number
}

/** Lens's buckets summed by one of their fields, largest Out first (by day, newest first). */
function groupBy(buckets: readonly SpendBucket[], keyOf: (b: SpendBucket) => string, labelOf: (key: string) => string, byKey = false): Group[] {
  const m = new Map<string, Group>()
  for (const b of buckets) {
    const key = keyOf(b)
    const g = m.get(key) ?? { key, label: labelOf(key), out: 0, returned: 0, postings: 0 }
    g.out += b.out_ulxc
    g.returned += b.returned_ulxc
    g.postings += b.postings
    m.set(key, g)
  }
  const list = [...m.values()]
  return byKey ? list.sort((a, b) => (a.key < b.key ? 1 : -1)) : list.sort((a, b) => b.out - a.out || (a.label < b.label ? -1 : 1))
}

function dayText(day: string): string {
  const d = new Date(`${day}T12:00:00Z`)
  return Number.isNaN(d.getTime()) ? day : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
}

function GroupRows({ title, groups, total, testid }: { title: string; groups: readonly Group[]; total: number; testid: string }) {
  return (
    <div data-testid={testid}>
      <h3 className="border-t border-rule px-gutter pb-1 pt-3 font-figure text-eyebrow uppercase text-muted">{title}</h3>
      {groups.map((g) => {
        const pct = total > 0 ? Math.round((g.out / total) * 100) : 0
        return (
          <Row
            key={g.key}
            stack
            label={g.label}
            data-testid={`${testid}-row`}
            hint={
              <>
                <span className="font-figure">{g.postings}</span> {g.postings === 1 ? 'movement' : 'movements'}
                {g.returned > 0 ? (
                  <>
                    {' '}
                    · <Money ulxc={g.returned} /> returned unused
                  </>
                ) : null}
              </>
            }
          >
            <div className="flex w-full items-center gap-3 wide:w-80">
              <div
                className="relative h-2 flex-1 overflow-hidden rounded-pill bg-rule-strong"
                role="progressbar"
                aria-valuenow={pct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${g.label}: share of the period’s out`}
              >
                {/* width is a runtime value → inline style, not a Tailwind arbitrary class. */}
                <div className="absolute inset-y-0 left-0 rounded-pill bg-accent" style={{ width: `${pct}%` }} />
              </div>
              <span className="w-36 shrink-0 text-right text-body text-ink" data-testid={`${testid}-out`}>
                <Money ulxc={g.out} />
              </span>
            </div>
          </Row>
        )
      })}
    </div>
  )
}

function Figures({ a, nameOf }: { a: SpendAnalytics; nameOf: (id: string) => string }) {
  const buckets = a.buckets ?? []
  return (
    <>
      <Row label="Out" hint={`Everything that left the wallet in the period, as its statement counts it · days in ${a.time_zone}`}>
        <span className="text-body text-ink" data-testid="agent-analytics-out">
          <Money ulxc={a.out_ulxc} />
        </span>
      </Row>
      <Row label="Returned unused" hint="What a request held and did not use, back in the wallet">
        <span className="text-body text-ink" data-testid="agent-analytics-returned">
          <Money ulxc={a.returned_ulxc} />
        </span>
      </Row>
      <Row label="Spent" hint="Out less returned">
        <span className="text-body text-ink" data-testid="agent-analytics-spent">
          <Money ulxc={a.spent_ulxc} />
        </span>
      </Row>
      <GroupRows title="By day" testid="agent-analytics-day" total={a.out_ulxc} groups={groupBy(buckets, (b) => b.day, dayText, true)} />
      <GroupRows
        title="By model"
        testid="agent-analytics-model"
        total={a.out_ulxc}
        groups={groupBy(buckets, (b) => b.model, (m) => (m === '' ? 'Not a request' : m))}
      />
      <GroupRows
        title="By destination"
        testid="agent-analytics-destination"
        total={a.out_ulxc}
        groups={groupBy(buckets, (b) => b.destination, (d) => destinationText(d, nameOf))}
      />
    </>
  )
}

/** B28.53 — the agent's spend for the last 7, 30 or 90 days, by day, model and destination. */
export function AgentAnalytics({ agent, nameOf }: { agent: Agent; nameOf: (id: string) => string }) {
  const [days, setDays] = useState<number>(30)
  const from = fromDay(days)
  const read = useQuery({ queryKey: analyticsKey(agent.id, from), queryFn: () => agentBankApi.analytics(agent.id, from) })
  return (
    <Card>
      <CardHeader>Spend by day, model and destination</CardHeader>
      <div className="flex flex-wrap items-center gap-2 border-b border-rule px-gutter py-3">
        <select
          aria-label={`Period of ${agent.name}’s spend`}
          className={`h-8 w-56 rounded-control border border-rule bg-surface px-2 text-body text-ink transition-colors duration-200 hover:border-rule-strong ${focusRing}`}
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
        >
          {PERIODS.map((p) => (
            <option key={p.days} value={p.days}>
              {p.label}
            </option>
          ))}
        </select>
      </div>
      {read.isError ? (
        <p className="px-gutter py-3 text-body text-muted">
          {isSessionExpired(read.error) ? 'This agent’s spend can’t be read until you sign in again.' : 'This agent’s spend could not be read just now.'}
        </p>
      ) : read.isPending ? (
        <p className="px-gutter py-3 text-body text-muted">Reading…</p>
      ) : (read.data.buckets ?? []).length === 0 ? (
        <p className="px-gutter py-3 text-body text-muted" data-testid="agent-analytics-none">
          Nothing left this wallet in the period. Choose a longer period above, or fund the agent under Money to start it spending.
        </p>
      ) : (
        <Figures a={read.data} nameOf={nameOf} />
      )}
    </Card>
  )
}
