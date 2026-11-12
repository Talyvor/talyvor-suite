import { useEffect, useState } from 'react'
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Logo } from '@talyvor/ui'
import { Button, Card, Input, Money, Select, pocketFocusRing, showToast } from '@talyvor/ui/pocket'
import { DESIGN_ATTR } from '../../pocketPending'
import { WorkspaceLabel } from '../../labels/workspace'
import { AGENT_CREDIT } from '../../labels/capabilities'
import { fetchModels } from '../chat/chatApi'
import { Note, STATEMENT_KINDS, dayAfter, lineText, monthPeriod, readFailure, saveFile } from './AgentBank'
import { AgentFace } from './AgentFace'
import { AgentBankError, STATEMENT_PAGE_LINES, agentBankApi, refusalText, type Agent, type StatementLine } from './agentBankApi'
import type { StatementFormat } from './agentBankApi'

// B57.24 — an agent's statement on Statements as the reference draws it (w-stmt-research): a document card with the
// agent's face and name, this month so far, the band of Opening, Money in, Money out and Balance now, and its lines
// newest first by model and day (Lens B57.13), each model's platform fee the line under it. Show all pages to the
// month's first line. The CSV is Lens's, one row per posting.
// B57.110 — B28.51's search and kind filter on it, in Pocket's fields: Lens keeps the month's lines of those kinds
// whose words hold the search, the newest 100 first, and Show older lines puts the next 100 under them.

/** How many of the newest lines the card opens with, and how many each page of Show all reads. */
export const NEWEST_LINES = 20
export const ALL_LINES_PAGE = 500

const STATEMENT_DOC_KEY = 'agent-statement-doc'

/** A day as the statement names it: "1 October". */
const dayMonth = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' })

/** YYYY-MM-DD of `d` in `zone`, the form Lens's grouped `day` takes. */
const dayIn = (d: Date, zone: string) => {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
  } catch {
    return d.toISOString().slice(0, 10)
  }
}

const clock = (d: Date) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })

/** When a line was: "Today, 10:24", "Yesterday, 11:12", else "20 Oct, 18:30". */
export function lineWhen(iso: string, now = new Date()): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const day = (x: Date) => x.toDateString()
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (day(d) === day(now)) return `Today, ${clock(d)}`
  if (day(d) === day(yesterday)) return `Yesterday, ${clock(d)}`
  return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}, ${clock(d)}`
}

/** What a line was, and the faint words after it. */
function lineWhat(l: StatementLine, nameOf: (id: string) => string, modelOf: (id: string) => string, today: string): [string, string] {
  if (l.kind === 'platform_fee' && l.day) return [lineText(l, nameOf), l.memo ?? '']
  if (l.day && l.model && l.requests !== undefined) {
    const n = `${l.requests.toLocaleString('en-GB')} request${l.requests === 1 ? '' : 's'}`
    return [modelOf(l.model), l.day === today ? `${n} today` : n]
  }
  const held = l.kind === 'hold' || (l.kind === 'escrow' && l.amount_ulxc < 0)
  return [lineText(l, nameOf), held ? 'Held' : 'Settled']
}

/** The file's stem: the agent's name in lower case, its words joined by hyphens. */
const stem = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'agent'

/** B57.112 — the file types Statements offers, as the choice names them. */
export const MONTH_FILE_TYPES: Array<{ format: Extract<StatementFormat, 'csv' | 'json' | 'pdf'>; words: string }> = [
  { format: 'csv', words: 'CSV' },
  { format: 'json', words: 'JSON' },
  { format: 'pdf', words: 'PDF' },
]

/**
 * This month so far, for one agent (or with none every agent), as the file Lens writes: the CSV one row per posting,
 * or (B57.112) its JSON or PDF.
 */
export function useMonthFile(agent: Agent | null) {
  return useMutation({
    mutationFn: async (format: StatementFormat = 'csv') => {
      const { from, through } = monthPeriod('this')
      const name = `${agent ? stem(agent.name) : 'agent-wallets'}-statement-${from}-to-${through}.${format}`
      saveFile(name, await agentBankApi.statementFile(agent?.id ?? null, from, dayAfter(through), format))
      return name
    },
    onSuccess: (_name, format = 'csv') => {
      const month = new Date().toLocaleDateString('en-GB', { month: 'long' })
      const type = format.toUpperCase()
      showToast(
        agent
          ? `Downloading ${agent.name}’s statement for ${month} as a ${type} file`
          : `Downloading the workspace’s statement for ${month}: every agent’s lines in one ${type} file`,
      )
    },
  })
}

/** A download's refusal or failure, in words, under the buttons. */
export function DownloadFailed({ error }: { error: unknown }) {
  return (
    <Note ok={false}>{error instanceof AgentBankError && error.status < 500 ? refusalText(error) : readFailure(error, 'The statement')}</Note>
  )
}

export function AgentStatement({ agent, nameOf }: { agent: Agent; nameOf: (id: string) => string }) {
  const { from } = monthPeriod('this')
  const [all, setAll] = useState(false)
  const [typed, setTyped] = useState('')
  const [q, setQ] = useState('')
  const [kindAt, setKindAt] = useState(0)
  useEffect(() => {
    const t = setTimeout(() => setQ(typed.trim()), 300)
    return () => clearTimeout(t)
  }, [typed])
  const kinds = STATEMENT_KINDS[kindAt].kinds
  const searching = kinds.length > 0 || q !== ''
  const st = useInfiniteQuery({
    queryKey: [STATEMENT_DOC_KEY, agent.id, from, kinds.join(','), q],
    queryFn: ({ pageParam }) =>
      searching
        ? agentBankApi.statementByDay(agent.id, from, STATEMENT_PAGE_LINES, pageParam, { kinds, q })
        : agentBankApi.statementByDay(agent.id, from, pageParam ? ALL_LINES_PAGE : NEWEST_LINES, pageParam),
    initialPageParam: undefined as { to?: string; cursor: string } | undefined,
    getNextPageParam: (last, pages) => (last.next_cursor ? { to: pages[0].to, cursor: last.next_cursor } : undefined),
    // A new search keeps the lines on screen until Lens answers, so the fields stay where the person is typing.
    placeholderData: keepPreviousData,
  })
  // The catalog only names the models: a read that fails shows each model as Lens names it, and raises nothing.
  const catalog = useQuery({ queryKey: [STATEMENT_DOC_KEY, 'models'], queryFn: () => fetchModels().catch(() => []), retry: false })
  const modelOf = (id: string) => catalog.data?.find((m) => m.id === id)?.display_name ?? id
  // Show all reads every page after the first, one at a time, to the month's first line; a search pages by hand.
  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = st
  useEffect(() => {
    if (all && !searching && hasNextPage && !isFetchingNextPage && !isFetchNextPageError) void fetchNextPage()
  }, [all, searching, hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage])

  const first = st.data?.pages[0]
  const account = first?.accounts?.find((a) => a.account === `agent:${agent.id}`)
  const lines = st.data?.pages.flatMap((p) => p.lines ?? []) ?? []
  const zone = first?.time_zone || 'UTC'
  const now = new Date()
  const monthStart = new Date(`${from}T00:00:00Z`)
  const made = new Date(agent.created_at)
  const opened = !Number.isNaN(made.getTime()) && made > monthStart ? made : monthStart
  const newest = lines[0] ? new Date(lines[0].at) : null
  const month = monthStart.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  const fresh = newest === null ? '' : newest.toDateString() === now.toDateString() ? ` · updated ${clock(newest)}` : ` · last activity ${dayMonth(newest)}`

  return (
    <Card tone="white" data-testid="statement-doc" {...{ [DESIGN_ATTR]: 'pocket' }} className="grid gap-4 p-5 wide:px-7 wide:py-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link to={`/agents?agent=${encodeURIComponent(agent.id)}`} aria-label={`Open ${agent.name}`} className={`rounded-pill ${pocketFocusRing}`}>
            <AgentFace agent={agent} size={44} />
          </Link>
          <div>
            <h2 className="font-display text-title font-extrabold leading-none text-ink">{agent.name}</h2>
            <p className="mt-1 text-body text-ink-2">
              Statement · {month}, so far{fresh}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <WorkspaceLabel capability={AGENT_CREDIT} />
          <Logo width={120} />
        </div>
      </div>
      {st.isError && st.data === undefined ? (
        <p className="text-body text-ink-2">{readFailure(st.error, 'This agent’s statement')}</p>
      ) : st.isPending ? (
        <p className="text-body text-ink-2">Reading…</p>
      ) : (
        <dl className="grid grid-cols-2 gap-4 rounded-card-tight bg-cloud px-4 py-3.5 wide:grid-cols-4" data-testid="statement-band">
          {(
            [
              [`Opening, ${dayMonth(opened)}`, account?.opening_ulxc ?? 0, false, ''],
              ['Money in', account?.in_ulxc ?? 0, true, 'text-success'],
              ['Money out', -(account?.out_ulxc ?? 0), false, ''],
              ['Balance now', account?.closing_ulxc ?? 0, false, ''],
            ] as const
          ).map(([label, ulxc, signed, tone]) => (
            <div key={label} className="grid content-end gap-0.5">
              <dt className="text-micro font-semibold text-ink-3">{label}</dt>
              <dd>
                <Money ulxc={ulxc} signed={signed} className={`grid justify-items-start gap-0.5 font-display text-head font-bold ${tone}`} />
              </dd>
            </div>
          ))}
        </dl>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Input
          type="search"
          aria-label={`Search ${agent.name}’s statement`}
          placeholder="Search"
          className="w-full wide:w-64"
          maxLength={200}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
        />
        <Select
          aria-label={`Kind of line in ${agent.name}’s statement`}
          className="w-full wide:w-56"
          value={kindAt}
          onChange={(e) => setKindAt(Number(e.target.value))}
        >
          {STATEMENT_KINDS.map((k, i) => (
            <option key={k.label} value={i}>
              {k.label}
            </option>
          ))}
        </Select>
      </div>
      {/* The failure and Reading… are said above the fields; the lines wait for them. */}
      {(st.isError && st.data === undefined) || st.isPending ? null : (
        <>
          {lines.length === 0 ? (
            <p className="text-body text-ink-2">
              {searching ? 'No line on this statement matches.' : 'Nothing has moved in this wallet yet. Fund it under Money to start.'}
            </p>
          ) : (
            <table className="w-full border-collapse text-body" data-testid="statement-lines">
              <thead>
                <tr className="text-left font-semibold text-ink-3">
                  <th className="hidden py-1.5 font-semibold wide:table-cell">When</th>
                  <th className="py-1.5 font-semibold wide:pl-4">What</th>
                  <th className="py-1.5 pl-4 text-right font-semibold">Amount</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => {
                  const [what, detail] = lineWhat(l, nameOf, modelOf, dayIn(now, zone))
                  return (
                    <tr key={`${l.entry_id}-${l.kind}-${l.day ?? ''}-${l.model ?? ''}-${l.at}`} className="border-t border-line text-ink">
                      <td className="hidden whitespace-nowrap py-2.5 text-ink-3 wide:table-cell">{lineWhen(l.at, now)}</td>
                      <td className="py-2.5 wide:pl-4">
                        <span data-testid="statement-doc-what">
                          {what}
                          {detail ? <span className="text-ink-3"> · {detail}</span> : null}
                        </span>
                        {/* On a phone the time goes under the words, so the line keeps its width. */}
                        <span className="block text-micro text-ink-3 wide:hidden">{lineWhen(l.at, now)}</span>
                      </td>
                      <td className="py-2.5 pl-4 text-right">
                        {/* On a phone the LXC goes under the dollars, so the table fits the width. */}
                        <Money ulxc={l.amount_ulxc} signed className={`grid justify-items-end wide:block ${l.amount_ulxc > 0 ? 'text-success' : ''}`} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
          {isFetchNextPageError ? <Note ok={false}>{readFailure(st.error, 'The older lines')}</Note> : null}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-micro text-ink-3">The newest lines. Requests to one model on one day are shown together.</span>
            {searching ? (
              hasNextPage ? (
                <Button variant="secondary" size="sm" disabled={isFetchingNextPage} onClick={() => void fetchNextPage()}>
                  {isFetchingNextPage ? 'Reading…' : 'Show older lines'}
                </Button>
              ) : null
            ) : hasNextPage ? (
              <Button
                variant="secondary"
                size="sm"
                disabled={all && !isFetchNextPageError}
                onClick={() => (all ? void fetchNextPage() : setAll(true))}
              >
                {all && !isFetchNextPageError ? 'Reading…' : 'Show all'}
              </Button>
            ) : null}
          </div>
        </>
      )}
    </Card>
  )
}
