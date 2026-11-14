import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Bar, Card, Eyebrow, Money, Row, Tabs } from '@talyvor/ui/pocket'
import { isSessionExpired } from '../../lib/productState'
import { fetchModels } from '../chat/chatApi'
import { type Agent, type SpendAnalytics, type SpendBucket, agentBankApi } from './agentBankApi'

// AgentAnalytics.tsx — B28.53: one agent's spend for a period by day, model and destination (Lens B28.326). Every
// posting that took money out of the agent's account is in exactly one of Lens's buckets, so each of the three views
// below adds up to the same Out — the agent's total out on its statement for the period. A hold's unused part comes
// back as Returned on the day it came back; Spent is Out less Returned.
//
// Lens decides; the card shows Lens's figures and never adds a bucket of its own. B57.111: drawn in Pocket's components
// on the agent's page, as its Statement and Rules cards are, the period a row of tabs.

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
    <div className="grid" data-testid={testid}>
      <Eyebrow className="pb-1 pt-3">{title}</Eyebrow>
      {groups.map((g) => {
        const pct = total > 0 ? Math.round((g.out / total) * 100) : 0
        return (
          <div key={g.key} className="border-t border-line pb-2.5 first-of-type:border-t-0" data-testid={`${testid}-row`}>
            <Row
              wrap
              title={g.label}
              line={
                <>
                  <span className="font-figure">{g.postings}</span> {g.postings === 1 ? 'movement' : 'movements'}
                  {g.returned > 0 ? (
                    <>
                      {' '}
                      · <Money ulxc={g.returned} className="font-normal" /> returned unused
                    </>
                  ) : null}
                </>
              }
              amount={
                <span data-testid={`${testid}-out`}>
                  <Money ulxc={g.out} />
                </span>
              }
            />
            <Bar thin on="white" value={total > 0 ? g.out / total : 0} label={`${g.label}: ${pct}% of the period’s out`} />
          </div>
        )
      })}
    </div>
  )
}

function Figures({ a, nameOf }: { a: SpendAnalytics; nameOf: (id: string) => string }) {
  const buckets = a.buckets ?? []
  // A model by the name the agent's statement gives it ("Claude Sonnet 5"), its id while the catalog is not read.
  const catalog = useQuery({ queryKey: ['agent-statement-doc', 'models'], queryFn: () => fetchModels().catch(() => []), retry: false })
  const modelOf = (id: string) => catalog.data?.find((m) => m.id === id)?.display_name ?? id
  return (
    <>
      <div className="grid">
        <Row
          wrap
          title="Out"
          line={`Everything that left the wallet in the period, as its statement counts it · days in ${a.time_zone}`}
          amount={
            <span data-testid="agent-analytics-out">
              <Money ulxc={a.out_ulxc} />
            </span>
          }
        />
        <Row
          wrap
          title="Returned unused"
          line="What a request held and did not use, back in the wallet"
          amount={
            <span data-testid="agent-analytics-returned">
              <Money ulxc={a.returned_ulxc} />
            </span>
          }
        />
        <Row
          wrap
          title="Spent"
          line="Out less returned"
          amount={
            <span data-testid="agent-analytics-spent">
              <Money ulxc={a.spent_ulxc} />
            </span>
          }
        />
      </div>
      <GroupRows title="By day" testid="agent-analytics-day" total={a.out_ulxc} groups={groupBy(buckets, (b) => b.day, dayText, true)} />
      <GroupRows
        title="By model"
        testid="agent-analytics-model"
        total={a.out_ulxc}
        groups={groupBy(buckets, (b) => b.model, (m) => (m === '' ? 'Not a request' : modelOf(m)))}
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

/** B28.53 — the agent's spend for the last 7, 30 or 90 days, by day, model and destination; B57.111 draws it in Pocket. */
export function AgentAnalytics({ agent, nameOf }: { agent: Agent; nameOf: (id: string) => string }) {
  const [days, setDays] = useState<number>(30)
  const from = fromDay(days)
  const read = useQuery({ queryKey: analyticsKey(agent.id, from), queryFn: () => agentBankApi.analytics(agent.id, from) })
  const chosen = PERIODS.find((p) => p.days === days) ?? PERIODS[1]
  return (
    <Card tone="white" className="grid gap-2" data-design="pocket" data-testid="agent-analytics">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-reading font-bold text-ink">Spend by day, model and destination</h2>
        <Tabs
          label={`Period of ${agent.name}’s spend`}
          tabs={PERIODS.map((p) => p.label)}
          value={chosen.label}
          onChange={(label) => setDays(PERIODS.find((p) => p.label === label)?.days ?? 30)}
        />
      </div>
      {read.isError ? (
        <p className="text-body text-ink-2">
          {isSessionExpired(read.error) ? 'This agent’s spend can’t be read until you sign in again.' : 'This agent’s spend could not be read just now.'}
        </p>
      ) : read.isPending ? (
        <p className="text-body text-ink-3">Reading…</p>
      ) : (read.data.buckets ?? []).length === 0 ? (
        <p className="text-body text-ink-2" data-testid="agent-analytics-none">
          Nothing left this wallet in the period. Choose a longer period above, or fund the agent under Money to start it spending.
        </p>
      ) : (
        <Figures a={read.data} nameOf={nameOf} />
      )}
    </Card>
  )
}
