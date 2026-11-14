import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { inlineLink } from '@talyvor/ui'
import { Bar, Button, Card, Chip, Crumb, Dialog, Eyebrow, Icon, Money, Switch, pocketFocusRing, showSnack } from '@talyvor/ui/pocket'
import { AgentCard as AgentCardArt } from '../../cards/AgentCard'
import { AGENT_CREDIT } from '../../labels/capabilities'
import { WorkspaceLabel } from '../../labels/workspace'
import { useAuthMeReader } from '../../lib/authMe'
import { isSessionExpired } from '../../lib/productState'
import { fetchModels } from '../chat/chatApi'
import { BOOK_KEY, rulesKey } from './AgentBank'
import { MoveLxc, ResumeAgent, StartEveryAgent } from './AgentCard'
import { IssueCard, cardKey } from './AgentCardPanel'
import { AgentFace } from './AgentFace'
import { DownloadFailed, dayIn, lineWhat, lineWhen, useMonthFile } from './AgentStatement'
import { approvalSheetTo } from './ApprovalSheet'
import { PAYEES_KEY } from './Pay'
import { type AgentApproval, type AgentRules, type AgentSummary, agentBankApi } from './agentBankApi'
import { lxcPartOf, useMoneyFigures } from './money'

// AgentPage.tsx — B57.20: an agent's page, as Pocket's w-agent-research, w-agent-sales and w-agent-ops draw it. Every
// figure comes from GET /api/agents/{id}/summary, which Lens (B57.12) reads in one transaction, so the balance less what
// waits is the safe-to-spend figure beside it. The header pauses, resumes or starts every agent again (B57.16), moves
// LXC and opens the rules; the card tile freezes and unfreezes the agent's card. What today's agent view has that this
// page does not draw yet stays below it, as it was, until B57.21 and B57.22 redraw it.

/** Under BOOK_KEY, so every pause, resume, move and archive that refreshes the book refreshes the page too. */
export const summaryKey = (id: string) => [...BOOK_KEY, 'summary', id]

/** "14 September", and its year when it is not this one. */
function dayText(iso: string, now: Date): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const sameYear = d.getUTCFullYear() === now.getUTCFullYear()
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', ...(sameYear ? {} : { year: 'numeric' }), timeZone: 'UTC' })
}

/** "09:17" today, else "20 Oct". */
function sinceText(iso: string, now: Date): string {
  const d = new Date(iso)
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

/** A card's currency in words: "pounds". */
const CARD_CURRENCY: Record<string, string> = { gbp: 'pounds', eur: 'euros', usd: 'US dollars' }

/** An account's currency in words: "US dollar account". */
const ACCOUNT_WORDS: Record<string, string> = { USD: 'US dollar account', GBP: 'Pound account', EUR: 'Euro account', USDC: 'USDC account' }

/** "Acme Hosting and Northwind Data", "Research, Sales and Ops". */
function andList(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/** "London" from "Europe/London". */
const cityOf = (zone: string) => (zone ? (zone.split('/').pop() ?? zone).replace(/_/g, ' ') : 'UTC')

export interface RuleLine {
  title: string
  line: string
}

/**
 * B57.20 — the agent's rules in words, as the reference's rules card says them: each limit in the person's currency
 * with its LXC under it, the hours, who it may pay, what it always allows, and its models. None set reads as such.
 */
export function rulesInWords(
  r: AgentRules,
  { figures, payeeName, modelName, monthEnd }: { figures: (ulxc: number) => { cash: string | null; lxc: string }; payeeName: (id: string) => string; modelName: (id: string) => string; monthEnd: string },
): RuleLine[] {
  // The person's currency in the title and LXC first in the line under it; LXC alone while no rate backs it.
  const lead = (ulxc: number) => figures(ulxc).cash ?? figures(ulxc).lxc
  const lxcFirst = (ulxc: number) => (figures(ulxc).cash === null ? '' : `${figures(ulxc).lxc}. `)
  const zone = cityOf(r.timezone)
  const allowances = Object.entries(r.payee_allowances ?? {}).filter(([, a]) => a.amount_ulxc > 0)
  const out: RuleLine[] = []
  if (r.approval_above_ulxc > 0)
    out.push({
      title: `Asks you above ${lead(r.approval_above_ulxc)}`,
      line: `${lxcFirst(r.approval_above_ulxc)}Above it, a payment asks you first${allowances.length > 0 ? ', unless a rule below allows it' : ''}`,
    })
  if (r.max_per_request_ulxc > 0)
    out.push({ title: `At most ${lead(r.max_per_request_ulxc)} on one request`, line: `${lxcFirst(r.max_per_request_ulxc)}Anything larger is refused` })
  if (r.daily_limit_ulxc > 0) out.push({ title: `At most ${lead(r.daily_limit_ulxc)} a day`, line: `${lxcFirst(r.daily_limit_ulxc)}Counted in ${zone} time` })
  if (r.monthly_limit_ulxc > 0) {
    const next = new Date(monthEnd)
    const from = Number.isNaN(next.getTime()) ? '' : ` Counted from ${next.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' })} again`
    out.push({ title: `At most ${lead(r.monthly_limit_ulxc)} a month`, line: `${lxcFirst(r.monthly_limit_ulxc).trim()}${from}`.trim() })
  }
  if (r.active_from && r.active_until) out.push({ title: `Only from ${r.active_from} to ${r.active_until}`, line: `${zone} time` })
  const allowed = r.allowed_payees ?? []
  if (allowed.length > 0) out.push({ title: `Pays only ${andList(allowed.map(payeeName))}`, line: 'Any other payee is refused, card shops included' })
  const blocked = r.blocked_payees ?? []
  if (blocked.length > 0) out.push({ title: `Never pays ${andList(blocked.map(payeeName))}`, line: 'A payment to them is refused' })
  for (const [id, a] of allowances)
    out.push({
      title: `Always allows ${payeeName(id)} up to ${lead(a.amount_ulxc)} a ${a.per}`,
      line: `${lxcFirst(a.amount_ulxc)}${r.approval_above_ulxc > 0 ? `Above ${lead(r.approval_above_ulxc)}, without asking you, up to that` : 'Without asking you, up to that'}`,
    })
  const models = r.allowed_models ?? []
  if (models.length > 0) out.push({ title: `Only ${andList(models.map(modelName))}`, line: 'Other models are refused' })
  return out
}

/** What a waiting request asks for, as its row's title: "Acme Hosting, $340.00", in what pays it. */
function WaitingRow({ a, agentName }: { a: AgentApproval; agentName: string }) {
  const here = useLocation()
  const now = new Date()
  const lxcText = useMoneyFigures().ulxc(a.amount_ulxc).lxc
  const amount = a.paid_from && a.paid_from.kind !== 'lxc' ? <Money minor={a.paid_from.amount_minor} currency={a.paid_from.currency} /> : <Money ulxc={a.amount_ulxc} />
  const what = a.payee?.name || a.model || 'A payment'
  return (
    <Card tone="white" tight className="flex items-center gap-3" data-testid={`agent-page-waiting-${a.id}`}>
      <div className="min-w-0 flex-1">
        <div className="font-semibold text-ink">
          {what}, {amount}
        </div>
        <p className="text-caption text-ink-3">
          <span className="font-figure">{lxcText}</span> for its rules · waiting for you since <span className="font-figure">{sinceText(a.created_at, now)}</span>
        </p>
      </div>
      <Button asChild variant="secondary" size="sm" data-tangerine="your-move">
        <Link to={approvalSheetTo(here, a.id)} aria-label={`Review ${agentName}’s request`}>
          Review
        </Link>
      </Button>
    </Card>
  )
}

function BalanceCard({ s }: { s: AgentSummary }) {
  const lxc = s.safe_to_spend?.find((f) => f.currency === 'LXC')
  const { month } = s
  const budget = month.monthly_limit_ulxc
  const lastDay = new Date(new Date(month.end).getTime() - 1)
  return (
    <Card className="grid gap-3" data-testid="agent-page-balance">
      <div className="flex items-center justify-between gap-3">
        <Eyebrow>Balance</Eyebrow>
        <WorkspaceLabel capability={AGENT_CREDIT} />
      </div>
      <Money ulxc={s.agent.balance_ulxc} size="card-sm" />
      <p className="text-caption text-ink-3" data-testid="agent-page-safe">
        {lxc ? (
          <>
            <Money ulxc={lxc.safe_to_spend} /> safe to spend
            {lxc.pending_approvals > 0 ? (
              <>
                , after the <Money ulxc={lxc.pending_approvals} /> waiting
              </>
            ) : null}
          </>
        ) : (
          'Safe to spend could not be read just now.'
        )}
      </p>
      <div className="grid gap-1.5" data-testid="agent-page-month">
        {budget > 0 ? <Bar value={month.spent_ulxc / budget} label={`${Math.round((month.spent_ulxc / budget) * 100)}% of budget used`} /> : null}
        <div className="flex items-baseline justify-between gap-3 text-caption">
          <span className="text-ink-2">This month</span>
          <span className="text-right">
            <MoneyCash ulxc={month.spent_ulxc} strong />
            {budget > 0 ? (
              <span className="text-ink-3">
                {' '}
                of <MoneyCash ulxc={budget} />
              </span>
            ) : null}
          </span>
        </div>
        {budget > 0 ? <span className="text-right font-figure text-micro text-ink-3">{lxcPartOf(month.spent_ulxc, budget)}</span> : null}
        {month.forecast_ulxc > 0 ? (
          <span className="text-caption text-ink-3">
            On pace for about <Money ulxc={month.forecast_ulxc} />
            {Number.isNaN(lastDay.getTime()) ? '' : ` by ${lastDay.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' })}`}
          </span>
        ) : null}
      </div>
      {(s.currency_accounts ?? []).map((acc) => (
        <Link
          key={acc.id}
          to="/money/invoices"
          className={`flex items-center justify-between gap-3 rounded-card-tight bg-page px-4 py-3 shadow-pocket text-body font-semibold text-ink ${pocketFocusRing}`}
          data-testid={`agent-page-account-${acc.currency}`}
        >
          <span className="flex items-center gap-2">
            <Icon name="invoices" size={18} />
            {ACCOUNT_WORDS[acc.currency] ?? `${acc.currency} account`}
          </span>
          <Money minor={acc.balance_minor} currency={acc.currency} />
        </Link>
      ))}
    </Card>
  )
}

/** The person's currency alone ("$1,240.00"), or LXC while no rate backs it: the LXC is the line under it. */
function MoneyCash({ ulxc, strong = false }: { ulxc: number; strong?: boolean }) {
  const { cash, lxc } = useMoneyFigures().ulxc(ulxc)
  const text = cash ?? lxc
  return <span className={`font-figure ${strong ? 'font-semibold text-ink' : ''}`}>{text}</span>
}

/** `lines` is the summary's, so a read that failed never reaches here: the page says so in its place. */
function StatementCard({ s, lines }: { s: AgentSummary; lines: NonNullable<AgentSummary['statement']> | null }) {
  const file = useMonthFile(s.agent)
  const catalog = useQuery({ queryKey: ['agent-statement-doc', 'models'], queryFn: () => fetchModels().catch(() => []), retry: false })
  const modelOf = (id: string) => catalog.data?.find((m) => m.id === id)?.display_name ?? id
  const now = new Date()
  const today = dayIn(now, s.statement_time_zone || 'UTC')
  return (
    <Card tone="white" className="grid gap-2" data-testid="agent-page-statement">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-reading font-bold text-ink">Statement</h2>
        <span className="flex gap-3 text-caption">
          <button type="button" className={inlineLink} disabled={file.isPending} onClick={() => file.mutate('csv')}>
            Download CSV
          </button>
          <Link to={`/statements?wallet=${encodeURIComponent(s.agent.id)}`} className={inlineLink}>
            Full statement
          </Link>
        </span>
      </div>
      {file.isError ? <DownloadFailed error={file.error} /> : null}
      {lines === null ? (
        <p className="text-body text-ink-2">Nothing has moved in its wallet this month. Each payment appears here when it is made.</p>
      ) : (
        <div>
          {lines.map((l) => {
            const [what, detail] = lineWhat(l, (id) => (id === s.agent.id ? s.agent.name : 'an agent'), modelOf, today)
            return (
              <div key={`${l.entry_id}-${l.kind}-${l.day ?? ''}-${l.model ?? ''}`} className="flex items-center gap-3 border-t border-line py-2.5 first:border-t-0" data-testid="agent-page-line">
                <span className="hidden w-24 shrink-0 font-figure text-caption text-ink-3 wide:block">{lineWhen(l.at, now)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-ink">{what}</span>
                  {detail ? <span className="block text-caption text-ink-3">{detail}</span> : null}
                  {/* On a phone the time goes under the words, so the line keeps its width. */}
                  <span className="block font-figure text-micro text-ink-3 wide:hidden">{lineWhen(l.at, now)}</span>
                </span>
                <Money ulxc={l.amount_ulxc} signed className={l.amount_ulxc > 0 ? 'text-success' : ''} />
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}

function RulesCard({ s }: { s: AgentSummary }) {
  const id = s.agent.id
  const figures = useMoneyFigures()
  const rules = useQuery({ queryKey: rulesKey(id), queryFn: () => agentBankApi.rules(id) })
  const book = useQuery({ queryKey: BOOK_KEY, queryFn: agentBankApi.book })
  const named = [...(rules.data?.allowed_payees ?? []), ...(rules.data?.blocked_payees ?? []), ...Object.keys(rules.data?.payee_allowances ?? {})]
  const outside = named.some((p) => !(book.data?.agents ?? []).some((a) => a.id === p))
  const payees = useQuery({ queryKey: PAYEES_KEY, queryFn: agentBankApi.payees, enabled: outside })
  const catalog = useQuery({ queryKey: ['agent-statement-doc', 'models'], queryFn: () => fetchModels().catch(() => []), retry: false })
  const payeeName = (p: string) =>
    book.data?.agents.find((a) => a.id === p)?.name ??
    payees.data?.payees?.find((x) => x.id === p)?.name ??
    (s.approvals ?? []).find((a) => a.payee?.id === p)?.payee?.name ??
    'a payee'
  const lines = rules.data
    ? rulesInWords(rules.data, { figures: figures.ulxc, payeeName, modelName: (m) => catalog.data?.find((x) => x.id === m)?.display_name ?? m, monthEnd: s.month.end })
    : []
  return (
    <Card className="grid gap-3" data-testid="agent-page-rules">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-reading font-bold text-ink">Rules</h2>
        <span className="flex gap-3 text-caption">
          <Link to={`/agents/${encodeURIComponent(id)}/rules`} className={inlineLink}>
            Would it pass?
          </Link>
          <Link to={`/agents/${encodeURIComponent(id)}/rules`} className={inlineLink}>
            History
          </Link>
        </span>
      </div>
      {rules.isError ? (
        <p className="text-body text-ink-2">{isSessionExpired(rules.error) ? 'Its rules can’t be read until you sign in again.' : 'Its rules could not be read just now.'}</p>
      ) : rules.isPending ? (
        <p className="text-body text-ink-2">Reading…</p>
      ) : lines.length === 0 ? (
        <p className="text-body text-ink-2">No rules yet: {s.agent.name} may spend what it holds. Edit rules to set its limits.</p>
      ) : (
        <ul className="grid gap-x-6 wide:grid-cols-2">
          {lines.map((l) => (
            <li key={l.title} className="flex gap-2.5 border-t border-line py-3 [&:nth-child(-n+2)]:wide:border-t-0 first:border-t-0">
              <Icon name="check" size={16} className="mt-0.5 shrink-0 text-success" />
              <span>
                <span className="block text-body font-semibold text-ink">{l.title}</span>
                <span className="block text-caption text-ink-3">{l.line}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function CardColumn({ s }: { s: AgentSummary }) {
  const qc = useQueryClient()
  const { agent, card } = s
  const [issuing, setIssuing] = useState(false)
  const frozen = card.status === 'frozen'
  const toggle = useMutation({
    mutationFn: (freeze: boolean) => (freeze ? agentBankApi.freezeCard(agent.id) : agentBankApi.unfreezeCard(agent.id)),
    onSuccess: (_card, freeze) =>
      showSnack(
        freeze
          ? { title: `${agent.name}’s card is frozen`, line: 'Every purchase on it is refused until you unfreeze it. Its other spending carries on, within its rules.' }
          : { title: `${agent.name}’s card takes purchases again`, line: `Each one is judged by ${agent.name}’s rules.` },
      ),
    onSettled: () => Promise.all([qc.invalidateQueries({ queryKey: summaryKey(agent.id) }), qc.invalidateQueries({ queryKey: cardKey(agent.id) })]),
  })
  if (card.status === 'none') {
    return (
      <Card tone="white" className="grid content-start gap-3" data-testid="agent-page-no-card">
        <h2 className="font-display text-reading font-bold text-ink">Its card</h2>
        <p className="text-body text-ink-2">{agent.name} has no card yet. Each purchase on one is paid from its wallet only if its rules allow it.</p>
        <div>
          <Button onClick={() => setIssuing(true)}>Issue a card</Button>
        </div>
        <Dialog open={issuing} onClose={() => setIssuing(false)} title={`Issue ${agent.name} a card`}>
          <IssueCard
            agent={agent}
            onIssued={() => {
              setIssuing(false)
              void qc.invalidateQueries({ queryKey: summaryKey(agent.id) })
            }}
          />
        </Dialog>
      </Card>
    )
  }
  const declined = card.last_declined
  return (
    <div className="grid gap-4 wide:grid-cols-2" data-testid="agent-page-card">
      <AgentCardArt agent={agent} sub={`Agent card · ${CARD_CURRENCY[card.currency ?? ''] ?? (card.currency ?? '').toUpperCase()}`} />
      <div className="grid content-start gap-4">
        <Card tight className="flex items-center justify-between gap-3">
          <span className="text-body font-semibold text-ink">Freeze card</span>
          <Switch
            checked={frozen}
            disabled={toggle.isPending}
            aria-label={frozen ? `Unfreeze ${agent.name}’s card` : `Freeze ${agent.name}’s card`}
            onCheckedChange={(on) => toggle.mutate(on)}
          />
        </Card>
        {toggle.isError ? (
          <p role="alert" className="text-caption text-ink">
            {isSessionExpired(toggle.error) ? 'Nothing changed. Sign in again, then try once more.' : 'Nothing changed. You can try again.'}
          </p>
        ) : null}
        <Card tight className="grid gap-1" data-testid="agent-page-declined">
          <Eyebrow>Last declined</Eyebrow>
          {declined ? (
            <>
              <span className="text-body font-semibold text-ink">
                {declined.merchant_name || 'A shop'}, <Money minor={declined.amount_minor} currency={declined.currency.toUpperCase()} />
              </span>
              <span className="text-caption text-ink-3">{declined.words}</span>
            </>
          ) : (
            <span className="text-caption text-ink-3">Nothing declined yet.</span>
          )}
        </Card>
      </div>
    </div>
  )
}

function Header({ s }: { s: AgentSummary }) {
  const qc = useQueryClient()
  const me = useAuthMeReader()
  const book = useQuery({ queryKey: BOOK_KEY, queryFn: agentBankApi.book })
  const [dialog, setDialog] = useState<'resume' | 'start-all' | 'move' | null>(null)
  const { agent } = s
  const allPaused = !!s.all_paused_at
  const running = !agent.paused_at && !allPaused
  const pause = useMutation({
    mutationFn: () => agentBankApi.pause(agent.id, 'paused from its page'),
    onSuccess: () => showSnack({ title: `${agent.name} is paused`, line: 'Talyvor refuses its next request or payment until you resume it.' }),
    onSettled: () => qc.invalidateQueries({ queryKey: BOOK_KEY }),
  })
  const by = me.data?.user?.sub && me.data.user.sub === s.owner_user_id ? ' by you' : ''
  const made = dayText(s.made_at, new Date(s.as_of))
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-4">
        <AgentFace agent={agent} size={60} />
        <div className="grid gap-1">
          <h2 className="font-display text-title font-bold text-ink">{agent.name}</h2>
          <div className="flex flex-wrap items-center gap-2" data-testid="agent-page-state">
            {agent.paused_at ? (
              <Chip tone="paused" dot>
                Paused
              </Chip>
            ) : allPaused ? (
              <Chip tone="paused" dot>
                Paused with every agent
              </Chip>
            ) : (
              <Chip tone="good" dot>
                Running
              </Chip>
            )}
            {s.card.status === 'frozen' ? <Chip tone="paused">Card frozen</Chip> : null}
            {made ? <span className="text-caption text-ink-3">{`Made${by} on ${made}`}</span> : null}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-2.5">
        {running ? (
          <Button variant="secondary" icon={<Icon name="pause" size={18} />} disabled={pause.isPending} onClick={() => pause.mutate()}>
            Pause
          </Button>
        ) : agent.paused_at ? (
          <Button variant="secondary" onClick={() => setDialog('resume')}>
            Resume
          </Button>
        ) : (
          <Button variant="secondary" onClick={() => setDialog('start-all')}>
            Start every agent again
          </Button>
        )}
        <Button variant="secondary" disabled={!book.data} onClick={() => setDialog('move')}>
          Move LXC
        </Button>
        <Button asChild>
          <Link to={`/agents/${encodeURIComponent(agent.id)}/rules`}>Edit rules</Link>
        </Button>
      </div>
      {pause.isError ? (
        <p role="alert" className="w-full text-caption text-ink">
          {isSessionExpired(pause.error) ? `${agent.name} is still running. Sign in again, then try once more.` : `${agent.name} is still running. You can try again.`}
        </p>
      ) : null}
      <ResumeAgent agent={agent} allPaused={allPaused} open={dialog === 'resume'} onClose={() => setDialog(null)} />
      <StartEveryAgent open={dialog === 'start-all'} onClose={() => setDialog(null)} />
      {book.data ? <MoveLxc agent={agent} book={book.data} open={dialog === 'move'} onClose={() => setDialog(null)} /> : null}
    </div>
  )
}

/** The page's own part: the header, the balance, what waits, the statement, the rules and the card. */
export function AgentSummaryView({ id }: { id: string }) {
  // Not retried: every pause, move and freeze waits for this read again (it is under BOOK_KEY), and a failed one says so
  // with Try again rather than holding those presses.
  const q = useQuery({ queryKey: summaryKey(id), queryFn: () => agentBankApi.summary(id), retry: false })
  const s = q.data
  return (
    <section data-design="pocket" className="grid gap-5 px-gutter pb-8 pt-4 wide:px-8" data-testid="agent-page">
      <Crumb trail={[{ label: 'Agents', href: '/agents' }, { label: s?.agent.name ?? 'Agent' }]} />
      {q.isError ? (
        <div className="grid justify-items-start gap-3">
          <p className="text-body text-ink-2">
            {isSessionExpired(q.error) ? 'This agent can’t be read until you sign in again.' : 'This agent could not be read just now. Nothing changed.'}
          </p>
          <Button variant="secondary" size="sm" onClick={() => void q.refetch()}>
            Try again
          </Button>
        </div>
      ) : !s ? (
        <p className="text-body text-ink-3">Reading…</p>
      ) : (
        <>
          <Header s={s} />
          <div className="grid items-start gap-4 wide:grid-cols-12">
            <div className="grid gap-4 wide:col-span-5">
              <BalanceCard s={s} />
              {(s.approvals ?? [])
                .filter((a) => a.status === 'pending')
                .map((a) => (
                  <WaitingRow key={a.id} a={a} agentName={s.agent.name} />
                ))}
              <StatementCard s={s} lines={(s.statement ?? []).length === 0 ? null : (s.statement ?? [])} />
            </div>
            <div className="grid gap-4 wide:col-span-7">
              <RulesCard s={s} />
              <CardColumn s={s} />
            </div>
          </div>
        </>
      )}
    </section>
  )
}
