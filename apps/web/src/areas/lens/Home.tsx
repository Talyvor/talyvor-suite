import { useState } from 'react'
import { type UseQueryResult, useQueries, useQuery } from '@tanstack/react-query'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Bar, Button, Card, Chip, EmptyState, Eyebrow, Face, Icon, Input, Money, Row, pocketFocusRing } from '@talyvor/ui/pocket'
import { cn, focusRing, inlineLink } from '@talyvor/ui'
import { InlineFailure } from '../../components/SessionExpiredBar'
import { APPROVALS_KEY, BOOK_KEY, FORECAST_KEY, PREPARED_KEY, PreparedRow, rulesKey } from './AgentBank'
import {
  type Agent,
  type AgentApproval,
  type AgentBook,
  type AgentRules,
  type CurrencyAccount,
  type Shows,
  type SpendForecast,
  type WorkspaceAccount,
  type WorkspacePlan,
  PLAN_KEY,
  WORKSPACE_NAME_KEY,
  agentBankApi,
  formatMinor,
  readWorkspacePlan,
  useAccount,
} from './agentBankApi'
import { approvalSheetTo } from './ApprovalSheet'
import { type FXRates, FX_KEY, fetchFX, useMoney } from './money'
import { MONEY_ACCOUNTS_KEY } from './Invoices'
import { walletKey } from './AgentMoneyWallet'
import { cardKey } from './AgentCardPanel'
import { FirstAgent, NameWorkspace } from './Onboarding'
import { TalyvorCard } from '../../cards/TalyvorCard'
import { AgentCard as AgentCardFace } from '../../cards/AgentCard'
import { OWNER_HOLDER, OWNER_SUB, ownerFamily, useOwnerFace } from '../../cards/ownerCard'
import { IfArea } from '../../lib/workspaceAreas'
import { SharingLine } from './Sharing'

// Home.tsx — B57.18: Home as the launch pack's W2 draws it (design/launch-pack DESIGN.md, P3 to P5 and W2), with Lens's
// figures. It answers, in order:
//   1. Good morning, and what needs me: how many things wait for my yes, and which agents are paused. Lens's morning
//      briefing stays one line under it that opens its items (B41.6).
//   2. Waiting for your yes: the agents' requests and the payments prepared for me, as Approvals lists them, each with
//      Review (B57.15's sheet over Home, or a prepared payment's own card, B55.10). Not drawn when nothing waits.
//   3. The total: every currency account and agent wallet the workspace holds, in US dollars first at the ECB's rates
//      (the BFF's /api/fx), split into Fiat and Stablecoin for a Hybrid account; only the sides the account's kind has
//      (SPEC 3.3). Under it what the agents hold in LXC, what is not yet given to an agent, and Lens's forecast.
//   4. The agents: each one's fiat and stablecoin balance and its month against its monthly budget, the plan's
//      "3 of 3 on Free" (Lens's /v1/workspaces/{ws}/plan through GET /api/plan), and the cards.
// Every figure is Lens's, read through the same BFF routes and query keys as the screens that change it. A read that
// failed says so where its figure would be: it is never drawn as zero. Pause every agent is the shell's (B57.8).

/** At most this many waiting things are listed on Home; the rest are on Approvals. */
const WAITING_SHOWN = 3

/** "Good morning", "Good afternoon" or "Good evening" by the person's own clock, with their first name when it is known. */
export function greeting(hour: number, firstName: string): string {
  const part = hour >= 5 && hour < 12 ? 'Good morning' : hour >= 12 && hour < 18 ? 'Good afternoon' : 'Good evening'
  return firstName ? `${part}, ${firstName}` : part
}

const CAUGHT_UP = 'You’re all caught up.'

/** "2 things are waiting for you." — or that nothing is. */
export function waitingLine(n: number): string {
  return n === 0 ? CAUGHT_UP : `${n} ${n === 1 ? 'thing is' : 'things are'} waiting for you.`
}

const names = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)

/** "Ops is paused.", "Ops and Sales are paused." or "Every agent is paused."; "" when every agent runs. */
export function pausedLine(book: Pick<AgentBook, 'agents' | 'all_paused_at'>): string {
  const agents = book.agents.filter((a) => !a.archived_at)
  const paused = agents.filter((a) => a.paused_at).map((a) => a.name)
  if (agents.length > 0 && (book.all_paused_at || (agents.length > 1 && paused.length === agents.length))) return 'Every agent is paused.'
  return paused.length > 0 ? `${names(paused)} ${paused.length === 1 ? 'is' : 'are'} paused.` : ''
}

/** "3 of 3 on Free", or "12 on Business" where the plan takes any number of agents. */
export function planLine(p: WorkspacePlan): string {
  const plan = p.plan === 'byok' ? 'BYOK' : p.plan.charAt(0).toUpperCase() + p.plan.slice(1)
  return p.agents < 0 ? `${p.agents_used} on ${plan}` : `${p.agents_used} of ${p.agents} on ${plan}`
}

// ── The money: every balance in its own currency, and its US dollar value at the ECB's rates ──────────────────────

const FIAT_ORDER = ['USD', 'EUR', 'GBP'] as const
const FIAT_WORD: Record<string, string> = { USD: 'US dollar', EUR: 'Euro', GBP: 'British pound' }
const isFiat = (ccy: string) => (FIAT_ORDER as readonly string[]).includes(ccy)

/** One currency's US dollars per unit, or null when it needs a rate that is not read. A stablecoin is valued at par. */
function usdPer(ccy: string, fx: FXRates | undefined): number | null {
  if (ccy === 'USD' || ccy === 'USDC' || ccy === 'USDT') return 1
  if (fx === undefined) return null
  if (ccy === 'EUR' || ccy === 'EURC') return fx.usd_per_eur
  if (ccy === 'GBP') return fx.usd_per_eur / fx.gbp_per_eur
  return null
}

/** Lens keeps USDC to six decimals and every other currency to two (formatMinor). */
const perUnit = (ccy: string) => (ccy === 'USDC' ? 1e6 : 100)

/** The amount in US cents, or null without the rate. */
function usdCents(minor: number, ccy: string, fx: FXRates | undefined): number | null {
  const rate = usdPer(ccy, fx)
  return rate === null ? null : Math.round((minor / perUnit(ccy)) * rate * 100)
}

/** A coin's amount without its code, for the row that names it: 1500000 USDC → "1.50". */
const coinFigure = (minor: number, ccy: string) => formatMinor(minor, ccy).replace(new RegExp(` ${ccy}$`), '')

/** A wallet answer with its asset and balance: Lens's wallet route is read without a shape check (getSaid). */
const readable = (w: { asset?: unknown; balance_minor?: unknown } | undefined): w is { asset: string; balance_minor: number } =>
  w !== undefined && typeof w.asset === 'string' && typeof w.balance_minor === 'number'

interface Holding {
  currency: string
  minor: number
}

/** Each currency's sum over the workspace's open accounts and its agents' wallets, fiat in Pocket's order, then coins. */
export function holdings(accounts: CurrencyAccount[], wallets: { asset: string; balance_minor: number }[]): Holding[] {
  const by = new Map<string, number>()
  for (const a of accounts) if (a.status !== 'closed') by.set(a.currency, (by.get(a.currency) ?? 0) + a.balance_minor)
  for (const w of wallets) by.set(w.asset, (by.get(w.asset) ?? 0) + w.balance_minor)
  const rank = (c: string) => (isFiat(c) ? FIAT_ORDER.indexOf(c as (typeof FIAT_ORDER)[number]) : 10)
  return [...by.entries()].map(([currency, minor]) => ({ currency, minor })).sort((a, b) => rank(a.currency) - rank(b.currency) || a.currency.localeCompare(b.currency))
}

function sumUsd(hs: Holding[], fx: FXRates | undefined): number | null {
  let total = 0
  for (const h of hs) {
    if (h.minor === 0) continue
    const c = usdCents(h.minor, h.currency, fx)
    if (c === null) return null
    total += c
  }
  return total
}

// ── The page ─────────────────────────────────────────────────────────────────────────────────────────────────────

export function Home() {
  const book = useQuery({ queryKey: BOOK_KEY, queryFn: agentBankApi.book })
  const forecast = useQuery({ queryKey: FORECAST_KEY, queryFn: agentBankApi.forecast })
  const approvals = useQuery({ queryKey: APPROVALS_KEY, queryFn: agentBankApi.approvals })
  const prepared = useQuery({ queryKey: PREPARED_KEY, queryFn: agentBankApi.pendingPaymentRequests })
  const workspace = useQuery({ queryKey: WORKSPACE_NAME_KEY, queryFn: agentBankApi.workspaceName, staleTime: 60_000, retry: false })
  const { account, shows } = useAccount()
  // B28.8 — the first agent made here keeps its onboarding open after the book lists it, until the person is done with it.
  const [onboarding, setOnboarding] = useState(false)
  const agents = (book.data?.agents ?? []).filter((a) => !a.archived_at)
  const nameOf = (id: string) => agents.find((a) => a.id === id)?.name ?? 'An agent'

  const pending = (approvals.data?.approvals ?? []).filter((a) => a.status === 'pending')
  const requests = prepared.data?.requests ?? []
  const waitingKnown = approvals.isSuccess && prepared.isSuccess
  const waiting = pending.length + requests.length

  // A Personal account's name is the person's own (sign-up step 1); a Business's is the company's, so it greets by the
  // time of day alone.
  const own = workspace.data && workspace.data.name !== workspace.data.id ? workspace.data.name : ''
  const firstName = account?.account_type === 'personal' ? own.trim().split(/\s+/)[0] ?? '' : ''
  const status = [waitingKnown ? waitingLine(waiting) : '', book.data ? pausedLine(book.data) : ''].filter((x) => x !== '').join(' ')

  return (
    <div className="grid gap-4 px-gutter pb-10 pt-4 wide:px-7 wide:pb-12 wide:pt-6">
      <div className="grid gap-1">
        <h2 className="font-display text-title font-bold text-ink">{greeting(new Date().getHours(), firstName)}</h2>
        <p className="text-reading text-ink-2" data-testid="home-status">
          {status || 'Reading…'}
          {waitingKnown && waiting === 0 ? (
            <>
              {' '}
              <Link to="/approvals" className={inlineLink}>
                See what you decided
              </Link>
            </>
          ) : null}
        </p>
      </div>
      <NameWorkspace />
      <MorningBriefing />
        <IfArea area="chat">
          <AskTaly />
        </IfArea>
        {book.isError ? (
          <div role="alert" className="grid justify-items-start gap-3">
            <InlineFailure error={book.error} failed="Couldn’t load your agents" />
            <Button variant="secondary" size="sm" onClick={() => void book.refetch()}>
              Try again
            </Button>
          </div>
        ) : !book.data || shows === null ? (
          <p className="text-body text-ink-3">Reading…</p>
        ) : (
          <div className="grid grid-cols-1 items-start gap-4 wide:grid-cols-12">
            {waitingKnown && waiting > 0 ? (
              <div className="min-w-0 wide:col-span-5 wide:col-start-8 wide:row-start-1">
                <Waiting pending={pending} requests={requests} count={waiting} nameOf={nameOf} agents={agents} />
              </div>
            ) : approvals.isError || prepared.isError ? (
              <div className="min-w-0 wide:col-span-5 wide:col-start-8 wide:row-start-1">
                <Card tone="white">
                  <InlineFailure error={approvals.error ?? prepared.error} failed="Couldn’t read what is waiting for you" />
                </Card>
              </div>
            ) : null}
            <div className="min-w-0 wide:col-span-7 wide:col-start-1 wide:row-start-1">
              <Total book={book.data} agents={agents} shows={shows} forecast={forecast} />
            </div>
            <div className="min-w-0 wide:col-span-7 wide:col-start-1 wide:row-start-2">
              {agents.length === 0 || onboarding ? (
                <Card tone="white" data-testid="home-onboarding" className="grid gap-4">
                  <EmptyState icon={<Icon name="agents" />} title="No agents yet" line="Give an agent its own account, wallet and card." />
                  <FirstAgent book={book.data} onStarted={() => setOnboarding(true)} onFinished={() => setOnboarding(false)} />
                  <IfArea area="gateway">
                    <SharingLine />
                  </IfArea>
                </Card>
              ) : (
                <Agents agents={agents} book={book.data} shows={shows} forecast={forecast} />
              )}
            </div>
            {account !== null ? (
              <div className="min-w-0 wide:col-span-5 wide:col-start-8 wide:row-start-2">
                <Cards account={account} agents={agents} />
              </div>
            ) : null}
          </div>
        )}
    </div>
  )
}

/** A read that failed: what failed, that nothing changed, and Try again. Red text always has its icon beside it. */
function Failed({ what, retry }: { what: string; retry: () => void }) {
  return (
    <div role="alert" className="grid justify-items-start gap-3">
      <p className="flex items-center gap-2 text-body text-danger">
        <Icon name="x" size={16} />
        {what}
      </p>
      <Button variant="secondary" size="sm" onClick={retry}>
        Try again
      </Button>
    </div>
  )
}

export const BRIEFING_KEY = ['agent-briefing'] as const

export { SAFE_TO_SPEND_KEY } from './AgentCard'

/** B41.6 — this morning's briefing: Lens's one line, and behind it each item, Lens's own sentence with its amount. */
function MorningBriefing() {
  const here = useLocation()
  const b = useQuery({ queryKey: BRIEFING_KEY, queryFn: agentBankApi.briefing })
  if (b.isError) return <InlineFailure error={b.error} failed="Couldn’t read this morning’s briefing" />
  const line = (
    <span className="text-body text-ink-2" data-testid="home-briefing-line">
      {b.isPending ? 'Reading…' : b.data.line}
    </span>
  )
  const items = b.data?.items ?? []
  if (items.length === 0) return <div data-testid="home-briefing">{line}</div>
  return (
    <details className="rounded-card-tight bg-cloud" data-testid="home-briefing">
      <summary className={cn('flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3', pocketFocusRing)}>
        <span className="flex min-w-0 items-center gap-2">
          <Icon name="bell" size={16} />
          {line}
        </span>
        <span className="shrink-0 text-body text-ink-3">
          {items.length} {items.length === 1 ? 'item' : 'items'}
        </span>
      </summary>
      <ul data-testid="home-briefing-items">
        {items.map((it, i) => {
          const body = (
            <span className="flex min-w-0 flex-col">
              <span className="text-body text-ink">{it.text}</span>
              <span className="text-body text-ink-3">
                {[it.kind === 'approval' ? it.name : '', it.reason ?? '', it.due_date ? `due ${it.due_date}` : ''].filter((x) => x !== '').join(' · ')}
              </span>
            </span>
          )
          return (
            <li key={`${it.kind}-${it.id ?? i}`} className="border-t border-line" data-kind={it.kind}>
              {it.kind === 'approval' && it.id ? (
                // B55.10 — a prepared payment (Lens's preq_ id) opens its own card; an agent's request, its sheet over Home.
                <Link to={it.id.startsWith('preq_') ? `/approve/${encodeURIComponent(it.id)}` : approvalSheetTo(here, it.id)} className={cn('flex min-h-row items-center px-gutter py-2', focusRing)}>
                  {body}
                </Link>
              ) : (
                <div className="flex min-h-row items-center px-gutter py-2">{body}</div>
              )}
            </li>
          )
        })}
      </ul>
    </details>
  )
}

/** B45.11 — Taly's input, where the workspace has Chat: the question goes to Chat, typed and ready to send. */
function AskTaly() {
  const navigate = useNavigate()
  const [ask, setAsk] = useState('')
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        if (ask.trim() !== '') navigate('/chat', { state: { ask: ask.trim() } })
      }}
    >
      <Input aria-label="Ask Taly" placeholder="Ask Taly about your agents" value={ask} onChange={(e) => setAsk(e.target.value)} className="flex-1" />
      <Button type="submit" disabled={ask.trim() === ''}>
        Ask
      </Button>
    </form>
  )
}

// ── Waiting for your yes ─────────────────────────────────────────────────────────────────────────────────────────

/** What an agent's request asks, as the approval sheet names it: "Sunny wants to pay €1,240.00". */
function RequestRow({ a, agent }: { a: AgentApproval; agent: Agent | undefined }) {
  // B57.15 — each opens its approval sheet over Home.
  const here = useLocation()
  const who = agent?.name ?? 'An agent'
  const amount =
    a.paid_from && a.paid_from.kind !== 'lxc' ? <Money minor={a.paid_from.amount_minor} currency={a.paid_from.currency} /> : <Money ulxc={a.amount_ulxc} />
  const title = a.payee ? (
    <>
      {who} wants to pay {amount}
    </>
  ) : a.model ? (
    <>
      {who} wants to use {a.model}, up to {amount}
    </>
  ) : (
    <>
      {who} wants to spend {amount}
    </>
  )
  const line = [a.payee ? `to ${a.payee.name || a.payee.id}` : '', a.reason ?? ''].filter((x) => x !== '').join(' · ')
  return (
    <div className="border-t border-line first:border-t-0" data-approval={a.id}>
      <Row
        wrap
        leading={agent ? <Face agent={agent} size={40} waiting /> : undefined}
        title={title}
        line={line || undefined}
        action={
          <Button asChild variant="secondary" size="sm" data-tangerine="your-move">
            <Link to={approvalSheetTo(here, a.id)} aria-label={`Review ${who}’s request`}>
              Review
            </Link>
          </Button>
        }
      />
    </div>
  )
}

/** B45.11 — the approvals waiting for a person, first; each opens its approval sheet over Home (B57.15). B55.10: the payments Chat or an
 * assistant prepared come before them, each opening its own card at /approve/<id>, and the count is both. B57.116: each is
 * drawn in Pocket's row with Review, as w-home draws it. B57.18: under "Waiting for your yes", as W2 draws it. */
function Waiting({
  pending,
  requests,
  count,
  nameOf,
  agents,
}: {
  pending: AgentApproval[]
  requests: Parameters<typeof PreparedRow>[0]['r'][]
  count: number
  nameOf: (id: string) => string
  agents: Agent[]
}) {
  const preparedShown = requests.slice(0, WAITING_SHOWN)
  const requestsShown = pending.slice(0, WAITING_SHOWN - preparedShown.length)
  return (
    <Card tone="white" className="overflow-hidden" aria-labelledby="home-waiting">
      <div aria-hidden="true" className="-mx-5 -mt-5 mb-4 h-1.75 bg-tangerine" />
      <div className="flex items-center justify-between gap-3">
        <h3 id="home-waiting" className="font-display text-head font-bold text-ink">
          Waiting for your yes
        </h3>
        <Link
          to="/approvals"
          aria-label={`${count} waiting, open Approvals`}
          className={cn('inline-flex h-6.5 min-w-6.5 items-center justify-center rounded-pill bg-tangerine-50 px-2 text-micro font-bold text-tangerine-ink', pocketFocusRing)}
        >
          <span className="font-figure" data-testid="home-approvals-waiting">
            {count}
          </span>
        </Link>
      </div>
      <div className="mt-3 border-t border-line" data-testid="home-approvals">
        {preparedShown.map((r) => (
          <PreparedRow key={r.id} r={r} nameOf={nameOf} />
        ))}
        {requestsShown.map((a) => (
          <RequestRow key={a.id} a={a} agent={agents.find((x) => x.id === a.agent_id)} />
        ))}
      </div>
      {count > WAITING_SHOWN ? (
        <p className="border-t border-line pt-3 text-body">
          <Link to="/approvals" className={inlineLink}>
            {count - WAITING_SHOWN} more waiting
          </Link>
        </p>
      ) : null}
      <p className="mt-3 text-body text-ink-3">Anything outside your rules waits for your yes.</p>
    </Card>
  )
}

// ── The total ────────────────────────────────────────────────────────────────────────────────────────────────────

function Actions({ shows }: { shows: Shows }) {
  // Only the actions with a screen to open: Withdraw, Receive, Send, Convert and Instant transfer join them with theirs.
  return (
    <div className="flex flex-wrap gap-2 wide:justify-end">
      {shows.bankTransfers ? (
        <Button asChild icon={<Icon name="plus" size={18} />}>
          <Link to="/billing">Top up</Link>
        </Button>
      ) : null}
      <Button asChild variant={shows.bankTransfers ? 'white' : 'primary'}>
        <Link to="/money/pay">Pay</Link>
      </Button>
    </div>
  )
}

function Side({ word, usd, rows, testid }: { word: string; usd: number | null; rows: React.ReactNode; testid: string }) {
  return (
    <div className="grid content-start" data-testid={testid}>
      {word ? (
        <div className="flex items-center justify-between gap-3 border-b border-line pb-2">
          <span className="flex items-center gap-2 font-semibold text-ink">
            <span aria-hidden="true" className={cn('h-2.5 w-2.5', testid === 'home-fiat' ? 'bg-ink' : 'bg-control')} />
            {word}
          </span>
          {usd !== null ? <Money minor={usd} currency="USD" className="text-head" /> : null}
        </div>
      ) : null}
      {rows}
    </div>
  )
}

function BalanceRow({ label, figure, to }: { label: string; figure: React.ReactNode; to?: string }) {
  const body = (
    <>
      <span className="text-body text-ink-2">{label}</span>
      <span className="whitespace-nowrap font-figure font-semibold text-ink">{figure}</span>
    </>
  )
  return to ? (
    <Link to={to} className={cn('flex min-h-11 items-center justify-between gap-3 border-b border-line last:border-b-0', pocketFocusRing)}>
      {body}
    </Link>
  ) : (
    <div className="flex min-h-11 items-center justify-between gap-3 border-b border-line last:border-b-0">{body}</div>
  )
}

function Total({ book, agents, shows, forecast }: { book: AgentBook; agents: Agent[]; shows: Shows; forecast: UseQueryResult<SpendForecast> }) {
  const accounts = useQuery({ queryKey: MONEY_ACCOUNTS_KEY, queryFn: agentBankApi.moneyAccounts })
  // An agent's USDC account is its wallet (Lens B46.4): read for each agent where the account's kind holds coins.
  const wallets = useQueries({
    queries: (shows.onChain ? agents : []).map((a) => ({ queryKey: walletKey(a.id), queryFn: () => agentBankApi.wallet(a.id) })),
  })
  const open = (accounts.data?.accounts ?? []).filter((a) => a.status !== 'closed')
  const all = holdings(
    open,
    wallets.flatMap((w) => (readable(w.data) ? [w.data] : [])),
  )
  const fiat = shows.bankTransfers ? all.filter((h) => isFiat(h.currency)) : []
  const coins = shows.onChain ? all.filter((h) => !isFiat(h.currency)) : []
  const needsRates = [...fiat, ...coins].some((h) => h.minor !== 0 && usdPer(h.currency, undefined) === null)
  const fx = useQuery({ queryKey: FX_KEY, queryFn: fetchFX, retry: false, staleTime: 60 * 60_000, enabled: needsRates })
  const fiatUsd = sumUsd(fiat, fx.data)
  const coinUsd = sumUsd(coins, fx.data)
  const total = fiatUsd === null || coinUsd === null ? null : fiatUsd + coinUsd
  const reading = accounts.isPending || wallets.some((w) => w.isPending) || (needsRates && fx.isPending)
  const companyUsd = open.find((a) => a.purpose === 'company' && a.currency === 'USD')
  const hybrid = shows.bankTransfers && shows.onChain

  return (
    <Card className="grid gap-5" aria-labelledby="home-total-label">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid gap-1">
          <span id="home-total-label">
            <Eyebrow>{shows.total}</Eyebrow>
          </span>
          {accounts.isError ? null : reading ? (
            <span className="block h-14 w-56 rounded-tile bg-cloud-2" aria-label="Reading…" />
          ) : total === null ? (
            <p className="text-body text-ink-2">We couldn’t read today’s exchange rates, so your total is in each currency below.</p>
          ) : (
            <span data-testid="home-total">
              <Money minor={total} currency="USD" size="card" />
            </span>
          )}
          {!reading && total === 0 ? (
            <p className="text-body text-ink-2">{shows.bankTransfers ? 'Top up to get started.' : 'Receive stablecoins to get started.'}</p>
          ) : null}
        </div>
        <Actions shows={shows} />
      </div>

      {accounts.isError ? (
        <Failed what="We couldn’t read your balances. Nothing changed." retry={() => void accounts.refetch()} />
      ) : reading ? null : (
        <>
          {hybrid && fiatUsd !== null && coinUsd !== null && fiatUsd + coinUsd > 0 ? (
            <div className="flex h-2.5 gap-0.75" role="img" aria-label={`Fiat ${Math.round((fiatUsd / (fiatUsd + coinUsd)) * 100)}%, Stablecoin ${Math.round((coinUsd / (fiatUsd + coinUsd)) * 100)}%`}>
              {fiatUsd > 0 ? <span className="h-full rounded-pill bg-ink" style={{ flexGrow: fiatUsd }} /> : null}
              {coinUsd > 0 ? <span className="h-full rounded-pill bg-control" style={{ flexGrow: coinUsd }} /> : null}
            </div>
          ) : null}
          <div className={cn('grid gap-5', hybrid && 'wide:grid-cols-2')}>
            {shows.bankTransfers ? (
              <Side
                word={hybrid ? 'Fiat' : ''}
                usd={fiatUsd}
                testid="home-fiat"
                rows={
                  fiat.map((h) => (
                      <BalanceRow
                        key={h.currency}
                        label={FIAT_WORD[h.currency] ?? h.currency}
                        figure={<Money minor={h.minor} currency={h.currency} />}
                        to={h.currency === 'USD' && companyUsd ? '/money/invoices' : undefined}
                      />
                    ))
                }
              />
            ) : null}
            {shows.onChain ? (
              <Side
                word={hybrid ? 'Stablecoin' : ''}
                usd={coinUsd}
                testid="home-stablecoin"
                rows={
                  <>
                    {coins.map((h) => (
                      <BalanceRow key={h.currency} label={h.currency} figure={coinFigure(h.minor, h.currency)} />
                    ))}
                    {wallets.some((w) => w.isError) ? <InlineFailure error={wallets.find((w) => w.isError)?.error} failed="Couldn’t read every agent’s wallet" /> : null}
                  </>
                }
              />
            ) : null}
          </div>
        </>
      )}

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line pt-4 wide:grid-cols-4">
        <Fact label="Across your agents" testid="home-agents-total">
          <Money ulxc={book.allocated_ulxc} />
        </Fact>
        <Fact label="Not yet given to an agent" testid="home-unallocated">
          <Money ulxc={book.unallocated_ulxc} />
        </Fact>
        <Fact label="Spent this month" testid="home-spent">
          {forecast.isError ? <InlineFailure error={forecast.error} className="text-body text-ink-3" /> : forecast.data ? <Money ulxc={forecast.data.spent_ulxc} /> : 'Reading…'}
        </Fact>
        <Fact label="On pace for" testid="home-forecast">
          {forecast.isError ? <InlineFailure error={forecast.error} className="text-body text-ink-3" /> : forecast.data ? <Money ulxc={forecast.data.forecast_ulxc} /> : 'Reading…'}
        </Fact>
      </dl>
    </Card>
  )
}

function Fact({ label, testid, children }: { label: string; testid: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-body text-ink-3">{label}</dt>
      <dd className="text-ink" data-testid={testid}>
        {children}
      </dd>
    </div>
  )
}

// ── The agents ───────────────────────────────────────────────────────────────────────────────────────────────────

function Agents({ agents, book, shows, forecast }: { agents: Agent[]; book: AgentBook; shows: Shows; forecast: UseQueryResult<SpendForecast> }) {
  const plan = useQuery({ queryKey: PLAN_KEY, queryFn: readWorkspacePlan, staleTime: 60_000, retry: false })
  const accounts = useQuery({ queryKey: MONEY_ACCOUNTS_KEY, queryFn: agentBankApi.moneyAccounts })
  const rules = useQueries({ queries: agents.map((a) => ({ queryKey: rulesKey(a.id), queryFn: () => agentBankApi.rules(a.id) })) })
  const wallets = useQueries({
    queries: (shows.onChain ? agents : []).map((a) => ({ queryKey: walletKey(a.id), queryFn: () => agentBankApi.wallet(a.id) })),
  })
  const both = shows.bankTransfers && shows.onChain
  const span = columnsFor(both)
  return (
    <Card tone="white" aria-labelledby="home-agents" className="min-w-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 id="home-agents" className="font-display text-head font-bold text-ink">
          {shows.agents}
        </h3>
        <span className="flex items-baseline gap-4 text-body">
          {plan.data ? (
            <Link to="/plans" className={cn(inlineLink, 'text-ink-2')} data-testid="home-plan">
              {planLine(plan.data)}
            </Link>
          ) : null}
          <Link to="/agents" className={inlineLink}>
            See all
          </Link>
        </span>
      </div>
      {/* The column heads, on a wide screen; on a phone each figure carries its own word. */}
      <div aria-hidden="true" className="mt-3 hidden grid-cols-12 gap-x-3 border-b border-line pb-2 text-body text-ink-3 wide:grid">
        <span className={span.agent}>Agent</span>
        {shows.bankTransfers ? <span className={cn(span.money, 'text-right')}>Fiat</span> : null}
        {shows.onChain ? <span className={cn(span.money, 'text-right')}>Stablecoin</span> : null}
        <span className={span.month}>This month</span>
      </div>
      <ul className="mt-1 wide:mt-0">
        {agents.map((a, i) => (
          <AgentRow
            key={a.id}
            agent={a}
            paused={!!a.paused_at || !!book.all_paused_at}
            shows={shows}
            span={span}
            fiat={(accounts.data?.accounts ?? []).filter((x) => x.agent_id === a.id && x.status !== 'closed' && isFiat(x.currency))}
            fiatRead={accounts}
            wallet={shows.onChain ? wallets[i] : undefined}
            rules={rules[i]}
            forecast={forecast}
          />
        ))}
      </ul>
    </Card>
  )
}

/** Each column's span: on a phone the agent takes the row and its figures sit under it; on a wide screen, twelve columns. */
function columnsFor(both: boolean) {
  return {
    agent: 'col-span-2 wide:col-span-4',
    money: both ? 'col-span-1 wide:col-span-2' : 'col-span-1 wide:col-span-3',
    month: both ? 'col-span-2 wide:col-span-4' : 'col-span-1 wide:col-span-5',
  }
}

function AgentRow({
  agent,
  paused,
  shows,
  span,
  fiat,
  fiatRead,
  wallet,
  rules,
  forecast,
}: {
  agent: Agent
  paused: boolean
  shows: Shows
  span: ReturnType<typeof columnsFor>
  fiat: CurrencyAccount[]
  fiatRead: UseQueryResult<unknown>
  wallet: UseQueryResult<{ asset: string; balance_minor: number }> | undefined
  rules: UseQueryResult<AgentRules>
  forecast: UseQueryResult<SpendForecast>
}) {
  const money = useMoney()
  const cell = 'min-w-0 font-figure font-semibold text-ink wide:text-right'
  const word = 'block font-sans text-body font-normal text-ink-3 wide:sr-only'
  const job = (agent.description ?? '').split(' · ')[0].trim()
  return (
    <li className="grid grid-cols-2 items-center gap-x-3 gap-y-2 border-b border-line py-3 last:border-b-0 wide:grid-cols-12" data-testid={`home-agent-${agent.id}`}>
      <Link to={`/agents/${encodeURIComponent(agent.id)}`} className={cn('flex min-h-11 min-w-0 items-center gap-3', span.agent, pocketFocusRing)}>
        <Face agent={agent} size={40} state={paused ? 'asleep' : 'happy'} />
        <span className="grid min-w-0">
          <span className="truncate font-semibold text-ink">{agent.name}</span>
          <span className="truncate text-body text-ink-3">{[job, paused ? 'Paused' : 'Running'].filter((x) => x !== '').join(' · ')}</span>
        </span>
      </Link>
      {shows.bankTransfers ? (
        <div className={cn(cell, span.money)}>
          <span className={word}>Fiat</span>
          {fiatRead.isError ? (
            <InlineFailure error={fiatRead.error} className="text-body font-normal text-ink-3" />
          ) : fiat.length === 0 ? (
            <span className="text-body font-normal text-ink-3">{fiatRead.isPending ? 'Reading…' : 'No account'}</span>
          ) : (
            fiat.map((x) => (
              <span key={x.id} className="block">
                <Money minor={x.balance_minor} currency={x.currency} />
              </span>
            ))
          )}
        </div>
      ) : null}
      {shows.onChain && wallet ? (
        <div className={cn(cell, span.money)}>
          <span className={word}>Stablecoin</span>
          {wallet.isError ? (
            <InlineFailure error={wallet.error} className="text-body font-normal text-ink-3" />
          ) : readable(wallet.data) ? (
            <span className="whitespace-nowrap font-figure">{formatMinor(wallet.data.balance_minor, wallet.data.asset)}</span>
          ) : (
            <span className="text-body font-normal text-ink-3">Reading…</span>
          )}
        </div>
      ) : null}
      <div className={cn('min-w-0', span.month)}>
        <Month agent={agent} rules={rules} forecast={forecast} money={money} />
      </div>
    </li>
  )
}

/** The agent's month against its monthly budget: "$2,000.00 of $10,000.00" over its bar, or what is missing. */
function Month({
  agent,
  rules,
  forecast,
  money,
}: {
  agent: Agent
  rules: UseQueryResult<AgentRules>
  forecast: UseQueryResult<SpendForecast>
  money: (ulxc: number) => string | null
}) {
  if (forecast.isError || rules.isError) return <InlineFailure error={forecast.error ?? rules.error} className="text-body text-ink-3" />
  if (!forecast.data || !rules.data) return <span className="text-body text-ink-3">Reading…</span>
  // Lens's forecast lists every agent in the workspace; one created since it was read has spent nothing.
  const spent = (forecast.data.agents ?? []).find((f) => f.agent_id === agent.id)?.spent_ulxc ?? 0
  const limit = rules.data.monthly_limit_ulxc
  const text = (u: number) => <Money ulxc={u} />
  if (!(limit > 0))
    return (
      <span className="grid text-body text-ink-3">
        <span>
          {text(spent)} spent
        </span>
        <Link to={`/agents/${encodeURIComponent(agent.id)}/rules`} className={inlineLink}>
          Set a budget
        </Link>
      </span>
    )
  const pct = Math.round((spent / limit) * 100)
  const named = money(spent)
  return (
    <span className="grid gap-1">
      <span data-testid={`home-budget-used-${agent.id}`} data-used={`${pct}%`}>
        <Bar value={spent / limit} on="white" thin label={`${pct}% of ${agent.name}’s monthly budget used${named ? `, ${named}` : ''}`} />
      </span>
      <span className="flex flex-wrap items-center gap-x-2 text-body text-ink-3">
        <span>
          {text(spent)} of {text(limit)}
        </span>
        {spent > limit ? (
          <Chip tone="bad" data-testid={`home-above-budget-${agent.id}`}>
            Above budget
          </Chip>
        ) : null}
      </span>
    </span>
  )
}

// ── The cards ────────────────────────────────────────────────────────────────────────────────────────────────────

/** The owner's own card in its tier art, then each agent's card that Lens has issued, four at most. */
function Cards({ account, agents }: { account: WorkspaceAccount; agents: Agent[] }) {
  const family = ownerFamily(account)
  const face = useOwnerFace(family)
  const workspace = useQuery({ queryKey: WORKSPACE_NAME_KEY, queryFn: agentBankApi.workspaceName, staleTime: 60_000, retry: false })
  const named = workspace.data && workspace.data.name !== workspace.data.id ? workspace.data.name : null
  const cards = useQueries({ queries: agents.map((a) => ({ queryKey: cardKey(a.id), queryFn: () => agentBankApi.card(a.id) })) })
  const issued = agents.filter((_, i) => cards[i]?.data?.card).slice(0, 3)
  return (
    <Card tone="white" aria-labelledby="home-cards">
      <div className="flex items-baseline justify-between gap-4">
        <h3 id="home-cards" className="font-display text-head font-bold text-ink">
          Cards
        </h3>
        <Link to="/money/card" className={cn(inlineLink, 'text-body')}>
          See all
        </Link>
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-3" data-testid="home-card-list">
        <li className="@container">
          <Link to="/money/card" className={cn('block rounded-tile', pocketFocusRing)}>
            <TalyvorCard card={face} holder={named ?? OWNER_HOLDER[family]} sub={OWNER_SUB[face.id]} />
          </Link>
        </li>
        {issued.map((a) => (
          <li key={a.id} className="@container">
            <Link to={`/agents/${encodeURIComponent(a.id)}`} className={cn('block rounded-tile', pocketFocusRing)}>
              <AgentCardFace agent={a} />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  )
}
