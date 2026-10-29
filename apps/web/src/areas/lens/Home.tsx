import { useState } from 'react'
import { type UseQueryResult, useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { Button, Card, CardHeader, Input, NavIcon, type NavIconName, Pill, Row, Switch, cn, focusRing, inlineLink } from '@talyvor/ui'
import { Region, RegionScreen } from '../../components/Region'
import { InlineFailure, PanelFailure } from '../../components/SessionExpiredBar'
import { APPROVALS_KEY, BOOK_KEY, FORECAST_KEY, PauseEveryAgent, rulesKey } from './AgentBank'
import { type Agent, type AgentBook, type AgentRules, type SpendForecast, agentBankApi, refusalText } from './agentBankApi'
import { Lxc } from './money'
import { FirstAgent } from './Onboarding'
import { SharingLine } from './Sharing'

// Home.tsx — B28.6: the first screen after sign-in is the wallet home. It answers, in order:
//   1. What does the workspace hold, and how much of it have I not yet given to an agent?
//   2. Is anything waiting for me? — the approvals an agent's rules filed for a person.
//   3. How far through its budget is each agent? — this month's spend against its monthly limit.
//   4. Where is the month heading? — Lens's forecast, the pace so far run on to the month's end.
//   5. How do I stop it all? — the one switch that pauses every agent.
// Every figure is Lens's, read through the same BFF routes and the same query keys as Agent Wallets,
// so a change made on either screen is the figure the other shows.
//
// B29.8 — it opens like the board's PRODUCT UI tile: "Welcome to Talyvor", then a raised card for each
// product, each opening the route its sidebar row opens. The figures above are unchanged, one region down.
//
// B45.11 — Home in one glance: the approvals waiting first, each opening its card; then one total across the agents;
// then one row per agent — its balance, its safe to spend (Lens B41.105) and a running/paused switch that asks before
// it changes; then Taly's input. On a 390px phone that is all that sits above the fold; the rest follows below it.
//
// A workspace with no agents yet opens in onboarding mode: what it holds, the one click that makes its
// first agent ready (B46.2, Onboarding.tsx), and the one line that says whether it shares answers. Like Overview's first run, that is a MEASUREMENT — the book answered and
// listed no agents — never a default: a read that failed is not an empty workspace.

const lxc = (micros: number) => <Lxc ulxc={micros} />

/** The products a person reaches from Home, in the sidebar's order; `to` is the route its sidebar row opens. */
export const PRODUCT_CARDS: readonly { title: string; to: string; icon: NavIconName; line: string }[] = [
  { title: 'Agent Wallets', to: '/agents', icon: 'wallet', line: 'A budget and rules for each agent' },
  { title: 'Approvals', to: '/approvals', icon: 'approvals', line: 'Requests waiting for a person' },
  { title: 'Statements', to: '/statements', icon: 'statement', line: 'What each agent spent, line by line' },
  { title: 'Chat', to: '/chat', icon: 'chat', line: 'Ask any model, with its wallet beside it' },
  { title: 'Marketplace', to: '/marketplace', icon: 'grid', line: 'Agents, prompts and skills to use or sell' },
  { title: 'Track', to: '/track', icon: 'issues', line: 'Issues, boards and cycles' },
  { title: 'Docs', to: '/docs', icon: 'docs', line: 'Your workspace’s pages' },
  { title: 'Developers', to: '/setup', icon: 'code', line: 'Connect an agent, keys and routing' },
]

/** The board's product cards: raised, a brand line icon, the product's name and one line, and an arrow. */
function ProductCards() {
  return (
    <ul className="grid grid-cols-2 gap-3 xl:grid-cols-4" aria-label="Products">
      {PRODUCT_CARDS.map((p) => (
        <li key={p.to} className="flex">
          <Link
            to={p.to}
            data-testid={`home-card-${p.to.slice(1)}`}
            className={cn('flex w-full flex-col gap-3 rounded-card border border-rule bg-raised p-4', focusRing)}
          >
            <span className="flex items-start justify-between gap-2">
              <NavIcon name={p.icon} className="h-7 w-7 text-accent-strong" />
              <NavIcon name="arrow" className="h-4 w-4 text-muted" />
            </span>
            <span className="flex flex-col gap-1">
              <span className="text-head text-ink">{p.title}</span>
              <span className="text-body text-muted">{p.line}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

function Muted({ children }: { children: React.ReactNode }) {
  return <p className="px-gutter py-3 text-body text-muted">{children}</p>
}

/** At most this many approvals are listed on Home, so the total and the agents stay above a phone's fold. */
const APPROVALS_SHOWN = 3

/** B45.11 — the approvals waiting for a person, first; each opens its card on Approvals. */
function ApprovalsFirst({ nameOf }: { nameOf: (id: string) => string }) {
  const list = useQuery({ queryKey: APPROVALS_KEY, queryFn: agentBankApi.approvals })
  const pending = (list.data?.approvals ?? []).filter((a) => a.status === 'pending')
  return (
    <Card>
      <CardHeader>
        Waiting for you
        {list.isSuccess ? (
          <>
            {' · '}
            <span className="font-figure" data-testid="home-approvals-waiting">
              {pending.length}
            </span>
          </>
        ) : null}
      </CardHeader>
      {list.isError ? (
        <PanelFailure error={list.error} what="the approvals" />
      ) : list.isPending ? (
        <Muted>Reading…</Muted>
      ) : pending.length === 0 ? (
        <Muted>Nothing is waiting for you.</Muted>
      ) : (
        <ul data-testid="home-approvals">
          {pending.slice(0, APPROVALS_SHOWN).map((a) => (
            <li key={a.id} className="border-b border-rule last:border-b-0">
              <Link
                to={`/approvals#approval-${a.id}`}
                className={cn('flex min-h-row items-center justify-between gap-gutter px-gutter py-2', focusRing)}
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-body text-ink">{nameOf(a.agent_id)}</span>
                  <span className="truncate text-caption text-muted">
                    {a.payee ? `Pay ${a.payee.name || a.payee.id}` : a.reason || (a.model ? `A request to ${a.model}` : 'A request')}
                  </span>
                </span>
                <span className="text-body text-ink">{lxc(a.amount_ulxc)}</span>
              </Link>
            </li>
          ))}
          {pending.length > APPROVALS_SHOWN ? (
            <li className="px-gutter py-2 text-body">
              <Link to="/approvals" className={inlineLink}>
                {pending.length - APPROVALS_SHOWN} more waiting
              </Link>
            </li>
          ) : null}
        </ul>
      )}
    </Card>
  )
}

/** B45.11 — one total: what the agents hold together, and what the workspace has not given to an agent yet. */
function Total({ book }: { book: AgentBook }) {
  return (
    <div className="flex flex-col gap-1 rounded-card border border-rule bg-surface px-gutter py-3">
      <span className="font-figure text-eyebrow uppercase text-faint">Across your agents</span>
      <span className="text-head text-ink" data-testid="home-total">
        {lxc(book.allocated_ulxc)}
      </span>
      <span className="text-caption text-muted" data-testid="home-unallocated">
        {lxc(book.unallocated_ulxc)} more in the workspace, not yet given to an agent
      </span>
    </div>
  )
}

export const SAFE_TO_SPEND_KEY = ['agent-safe-to-spend'] as const

/** One agent's line: its balance and safe to spend, and a switch between running and paused that asks first. */
function AgentLine({ agent, safe }: { agent: Agent; safe: UseQueryResult<Awaited<ReturnType<typeof agentBankApi.safeToSpend>>> }) {
  const qc = useQueryClient()
  const [asking, setAsking] = useState(false)
  const running = !agent.paused_at
  const change = useMutation({
    mutationFn: () => (running ? agentBankApi.pause(agent.id, 'paused from Home') : agentBankApi.resume(agent.id)),
    onSuccess: () => setAsking(false),
    onSettled: () => qc.invalidateQueries({ queryKey: BOOK_KEY }),
  })
  const figure = (safe.data?.agents ?? []).find((s) => s.agent_id === agent.id)?.figures?.find((f) => f.currency === 'LXC')
  return (
    <div className="border-b border-rule px-gutter py-2 last:border-b-0" data-testid={`home-agent-${agent.id}`}>
      <div className="flex min-h-row items-center justify-between gap-gutter">
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-body text-ink">{agent.name}</span>
          <span className="text-caption text-muted">
            {lxc(agent.balance_ulxc)} held ·{' '}
            {safe.isError ? (
              <InlineFailure error={safe.error} className="" />
            ) : figure ? (
              <span data-testid={`home-safe-${agent.id}`}>{lxc(figure.safe_to_spend)} safe to spend</span>
            ) : (
              'reading safe to spend…'
            )}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <span className="text-caption text-muted">{running ? 'Running' : 'Paused'}</span>
          <Switch
            checked={running}
            disabled={change.isPending}
            onCheckedChange={() => setAsking(true)}
            aria-label={`${agent.name} running`}
          />
        </span>
      </div>
      {asking ? (
        <div role="group" aria-label={`${running ? 'Pause' : 'Resume'} ${agent.name}?`} className="flex flex-wrap items-center gap-2 pb-1">
          <span className="text-body text-ink">
            {running ? `Pause ${agent.name}? Lens refuses its next request or payment.` : `Resume ${agent.name}?`}
          </span>
          <Button variant="primary" disabled={change.isPending} onClick={() => change.mutate()}>
            {running ? 'Pause' : 'Resume'}
          </Button>
          <Button disabled={change.isPending} onClick={() => setAsking(false)}>
            Cancel
          </Button>
        </div>
      ) : null}
      {change.isError ? <p className="pb-1 text-body text-ink">{refusalText(change.error)}</p> : null}
    </div>
  )
}

/** B45.11 — one row per agent. */
function AgentLines({ agents }: { agents: Agent[] }) {
  const safe = useQuery({ queryKey: SAFE_TO_SPEND_KEY, queryFn: agentBankApi.safeToSpend })
  return (
    <Card>
      <CardHeader>Your agents</CardHeader>
      {agents.map((a) => (
        <AgentLine key={a.id} agent={a} safe={safe} />
      ))}
    </Card>
  )
}

/** B45.11 — Taly's input: the question goes to Chat, typed and ready to send. */
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
      <Button type="submit" variant="primary" disabled={ask.trim() === ''}>
        Ask
      </Button>
    </form>
  )
}

/**
 * One agent's month against its budget: the monthly limit its rules set, when they set one. Two reads
 * feed it — the month's spend from the forecast, the budget from the agent's rules — and each says on
 * its own whether it is still reading or failed, so a rules read that failed never reads as "no budget".
 */
function BudgetRow({
  agent,
  forecast,
  rules,
}: {
  agent: Agent
  forecast: UseQueryResult<SpendForecast>
  rules: UseQueryResult<AgentRules>
}) {
  // Lens's forecast lists every agent in the workspace; one created since it was read has spent nothing.
  const spent = forecast.data ? ((forecast.data.agents ?? []).find((f) => f.agent_id === agent.id)?.spent_ulxc ?? 0) : null
  const limit = rules.data ? rules.data.monthly_limit_ulxc : null
  const pct = spent !== null && limit !== null && limit > 0 ? Math.min(100, Math.round((spent / limit) * 100)) : null
  const spend = forecast.isError ? (
    <>
      This month’s spend: <InlineFailure error={forecast.error} className="" />
    </>
  ) : spent === null ? (
    'Reading this month’s spend…'
  ) : (
    <>Spent {lxc(spent)} this month</>
  )
  const budget = rules.isError ? (
    <>
      Budget: <InlineFailure error={rules.error} className="" />
    </>
  ) : limit === null ? null : limit > 0 ? (
    <>monthly budget {lxc(limit)}</>
  ) : (
    'no monthly budget set'
  )
  return (
    <Row
      stack
      label={
        <span className="flex items-center gap-2">
          {agent.name}
          {agent.paused_at ? <Pill status="parked">Paused</Pill> : null}
        </span>
      }
      hint={
        <span className="whitespace-normal">
          {spend}
          {budget ? <> · {budget}</> : null} · {lxc(agent.balance_ulxc)} left in its wallet
        </span>
      }
    >
      {pct !== null ? (
        <div className="flex w-full items-center gap-3 wide:w-56">
          <div
            className="relative h-2 flex-1 overflow-hidden rounded-pill bg-rule-strong"
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${agent.name}’s monthly budget used`}
          >
            {/* width is a runtime value → inline style, not a Tailwind arbitrary class. */}
            <div className="absolute inset-y-0 left-0 rounded-pill bg-accent" style={{ width: `${pct}%` }} />
          </div>
          <span className="w-12 text-right font-figure text-body text-ink" data-testid={`home-budget-used-${agent.id}`}>
            {pct}%
          </span>
        </div>
      ) : limit === 0 ? (
        <Button asChild>
          <Link to="/agents">Set a budget</Link>
        </Button>
      ) : null}
    </Row>
  )
}

/** Each agent's budget used. The month's spend is the forecast's; the budget is each agent's own rules. */
function Budgets({ agents, forecast }: { agents: Agent[]; forecast: UseQueryResult<SpendForecast> }) {
  const rules = useQueries({
    queries: agents.map((a) => ({ queryKey: rulesKey(a.id), queryFn: () => agentBankApi.rules(a.id) })),
  })
  return (
    <Card>
      <CardHeader>Budget used this month</CardHeader>
      {agents.map((a, i) => (
        <BudgetRow key={a.id} agent={a} forecast={forecast} rules={rules[i]} />
      ))}
    </Card>
  )
}

/** Lens's month-end forecast for every agent together. */
function Forecast({ forecast }: { forecast: UseQueryResult<SpendForecast> }) {
  return (
    <Card>
      <CardHeader>This month</CardHeader>
      {forecast.isError ? (
        <PanelFailure error={forecast.error} what="the forecast" />
      ) : forecast.isPending ? (
        <Muted>Reading…</Muted>
      ) : (
        <>
          <Row label="Spent so far" hint="Every agent, since the first of the month (UTC)">
            <span className="text-body text-ink">{lxc(forecast.data.spent_ulxc)}</span>
          </Row>
          <Row label="Forecast for the month" hint="The pace so far, run on to the month’s end">
            <span className="text-body text-ink" data-testid="home-forecast">
              {lxc(forecast.data.forecast_ulxc)}
            </span>
          </Row>
        </>
      )}
    </Card>
  )
}

function useForecast() {
  return useQuery({ queryKey: FORECAST_KEY, queryFn: agentBankApi.forecast })
}

/** Onboarding: the workspace's first agent, in one click (B46.2), and the one line about sharing. */
function FirstWallet({ book, onStarted, onFinished }: { book: AgentBook; onStarted: () => void; onFinished: () => void }) {
  return (
    <>
      <p className="max-w-2xl text-body text-muted" data-testid="home-onboarding">
        Every AI agent gets a wallet: a budget, rules and approvals, checked by Lens before the model is called or a
        payment moves. This workspace holds {lxc(book.workspace_balance_ulxc)}; your first agent is one click away.
      </p>
      <FirstAgent book={book} onStarted={onStarted} onFinished={onFinished} />
      <SharingLine />
      <p className="text-caption text-muted">
        Already pointing tools at Lens with a workspace key?{' '}
        <Link to="/setup" className={inlineLink}>
          Setup
        </Link>{' '}
        has the base URL, and{' '}
        <Link to="/overview" className={inlineLink}>
          Overview
        </Link>{' '}
        has what the workspace spends and earns.
      </p>
    </>
  )
}

export function Home() {
  const book = useQuery({ queryKey: BOOK_KEY, queryFn: agentBankApi.book })
  const forecast = useForecast()
  const agents = book.data?.agents ?? []
  // B28.8 — the onboarding begun here stays open after its agent exists, until the person is done with it.
  const [onboarding, setOnboarding] = useState(false)
  // The failed read is decided first: a book that could not be read is not a workspace with no agents.
  const state = book.isError ? 'failed' : book.isPending ? 'reading' : agents.length === 0 || onboarding ? 'onboarding' : 'wallets'
  const nameOf = (id: string) => agents.find((a) => a.id === id)?.name ?? 'An agent'
  return (
    <RegionScreen>
      <Region
        index="00"
        label="Home"
        heading="Welcome to Talyvor"
        sectionClassName="pb-10 pt-4 wide:pb-12"
        className="flex flex-col gap-3"
        fullWidth
      >
        {state === 'onboarding' || state === 'wallets' ? (
          <p className="text-body text-muted" data-testid="home-lead">
            {state === 'onboarding' ? 'Give every agent a wallet.' : 'Your agents’ wallets, at a glance.'}
          </p>
        ) : null}
        {state === 'failed' ? (
          <PanelFailure error={book.error} what="the workspace’s wallets" />
        ) : !book.data ? (
          <p className="text-body text-muted">Reading…</p>
        ) : state === 'onboarding' ? (
          <FirstWallet book={book.data} onStarted={() => setOnboarding(true)} onFinished={() => setOnboarding(false)} />
        ) : (
          <>
            <ApprovalsFirst nameOf={nameOf} />
            <Total book={book.data} />
            <AgentLines agents={agents} />
            <AskTaly />
          </>
        )}
      </Region>
      <Region index="01" label="Products">
        <ProductCards />
      </Region>
      {state === 'wallets' && book.data ? (
        <>
          <Region index="02" label="Each agent’s budget">
            <Budgets agents={agents} forecast={forecast} />
          </Region>
          <Region index="03" label="Where the month is heading">
            <Forecast forecast={forecast} />
          </Region>
          <Region index="04" label="Stop every agent" className="flex flex-col gap-3">
            <p className="text-body text-muted">
              One switch: Lens refuses each agent’s next request, payment or hold before a provider is called.
            </p>
            <PauseEveryAgent book={book.data} />
          </Region>
        </>
      ) : null}
    </RegionScreen>
  )
}
