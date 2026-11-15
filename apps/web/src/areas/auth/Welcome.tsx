import { Fragment, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, Navigate } from 'react-router-dom'
import { Logo, cn, inlineLink } from '@talyvor/ui'
import { Button, Card, Chip, EmptyState, Eyebrow, Facts, Field, Input, Money, SnackHost, showSnack } from '@talyvor/ui/pocket'
import { CompanyLine } from '../../components/CompanyLine'
import { useDocumentTitle } from '../../documentTitle'
import { WorkspaceStatus } from '../../labels/workspace'
import { useAuthMeReader } from '../../lib/authMe'
import { IfArea } from '../../lib/workspaceAreas'
import { CARDS_OFF, cardPayments, usePricing } from '../marketing/pricingApi'
import { BOOK_KEY, rulesKey } from '../lens/AgentBank'
import { nameFromEmail } from '../lens/Onboarding'
import { ShareMyAnswers } from '../lens/Sharing'
import { RULE_TEMPLATES } from '../lens/ruleTemplates'
import { WORKSPACE_NAME_KEY, type Agent, type AgentRules, agentBankApi, refusalText } from '../lens/agentBankApi'
import { readFailure } from '../lens/WalletMoney'

// Welcome.tsx — B57.50: a new workspace's first page (Pocket's w-first-home), in its own layout. Lens names a new
// workspace by its id and makes "My first agent" at sign-up, so the first thing a new owner sees is the name to give
// it, the agent Lens made with its rules in words, and where credit comes from. The shell sends a signed-in browser
// here once per tab while the name is still the id (WelcomeRedirect); once it has a name, never again. It is drawn
// under the same AuthGate as the console, in place of the console's shell (App.tsx's AppShell), so it is here, beside
// the other pages outside the shell.

export const WELCOME_PATH = '/welcome'

const WELCOMED = 'talyvor.welcomed'

function welcomed(): boolean {
  try {
    return sessionStorage.getItem(WELCOMED) === '1'
  } catch {
    return false
  }
}

/** This tab has seen /welcome: the shell does not send it there again. */
export function markWelcomed() {
  try {
    sessionStorage.setItem(WELCOMED, '1')
  } catch {
    // Storage refused: the next page in this tab sends them here again, which is no worse than today.
  }
}

/** Lens names a workspace by its id until someone names it. */
const unnamed = (w: { id: string; name: string } | undefined) => w !== undefined && (!w.name || w.name === w.id)

/** In the shell: an unnamed workspace's first page in a tab is /welcome. Renders nothing otherwise. */
export function WelcomeRedirect() {
  const workspace = useQuery({ queryKey: WORKSPACE_NAME_KEY, queryFn: agentBankApi.workspaceName, staleTime: 60_000, retry: false })
  if (!unnamed(workspace.data) || welcomed()) return null
  return <Navigate to={WELCOME_PATH} replace />
}

const LIMITS = [
  ['max_per_request_ulxc', 'a request'],
  ['hourly_limit_ulxc', 'an hour'],
  ['daily_limit_ulxc', 'a day'],
  ['weekly_limit_ulxc', 'a week'],
  ['monthly_limit_ulxc', 'a month'],
] as const

/** "a, b and c", of drawn parts. */
function list(parts: React.ReactNode[]): React.ReactNode {
  return parts.map((p, i) => (
    <Fragment key={i}>
      {i === 0 ? '' : i === parts.length - 1 ? ' and ' : ', '}
      {p}
    </Fragment>
  ))
}

/** The template whose limits, approval amount and pause the rules are exactly, if any. */
function templateOf(rules: AgentRules): string | null {
  const same = (t: AgentRules) =>
    LIMITS.every(([k]) => (rules[k] ?? 0) === (t[k] ?? 0)) &&
    rules.approval_above_ulxc === t.approval_above_ulxc &&
    (rules.pause_on_unusual_spend ?? false) === (t.pause_on_unusual_spend ?? false)
  return RULE_TEMPLATES.find((t) => same(t.rules))?.name ?? null
}

/**
 * An agent's rules as Lens holds them, in words: “My first agent”, on the Support bot rules: at most $0.05 (0.5 LXC)
 * a request, … It asks you above $0.50 (5 LXC), and pauses if its spending looks unusual. A zero is no limit.
 */
export function RulesInWords({ name, rules }: { name: string; rules: AgentRules }) {
  const template = templateOf(rules)
  const caps = LIMITS.flatMap(([k, per]) =>
    (rules[k] ?? 0) > 0
      ? [
          <>
            <Money ulxc={rules[k] ?? 0} /> {per}
          </>,
        ]
      : [],
  )
  const tail: React.ReactNode[] = []
  if (rules.approval_above_ulxc > 0)
    tail.push(
      <>
        asks you above <Money ulxc={rules.approval_above_ulxc} />
      </>,
    )
  if (rules.pause_on_unusual_spend) tail.push('pauses if its spending looks unusual')
  return (
    <>
      “{name}”{template ? `, on the ${template} rules` : ''}: {caps.length ? <>at most {list(caps)}.</> : 'no spending limit yet.'}
      {tail.length ? (
        <>
          {' '}
          It {tail[0]}
          {tail.length > 1 ? <>, and {tail[1]}</> : null}.
        </>
      ) : null}
    </>
  )
}

/** The agent Lens made at sign-up: the workspace's oldest agent that is not a room's wallet or archived. */
const firstAgent = (agents: Agent[] | undefined): Agent | undefined =>
  [...(agents ?? [])].filter((a) => a.kind !== 'room' && !a.archived_at).sort((a, b) => a.created_at.localeCompare(b.created_at))[0]

function StepNumber({ n }: { n: number }) {
  return (
    <span aria-hidden="true" className="inline-grid h-6 w-6 place-items-center rounded-pill bg-tangerine-50 font-figure text-caption font-bold text-tangerine-ink">
      {n}
    </span>
  )
}

function NameStep({ workspace }: { workspace: { id: string; name: string } | undefined }) {
  const qc = useQueryClient()
  const email = useAuthMeReader().data?.user?.email
  const [typed, setTyped] = useState<string | null>(null)
  const named = workspace !== undefined && !unnamed(workspace)
  const name = named ? workspace.name : (typed ?? nameFromEmail(email))
  const save = useMutation({
    mutationFn: () => agentBankApi.setWorkspaceName(name.trim()),
    onSuccess: async () => {
      showSnack({ title: 'Saved. Your workspace has a name now.' })
      await qc.invalidateQueries({ queryKey: WORKSPACE_NAME_KEY })
    },
  })
  return (
    <Card tone="white" data-testid="welcome-name">
      <StepNumber n={1} />
      <h2 className="mt-2 font-display text-reading font-bold text-ink">Name your workspace</h2>
      <p className="mt-1 text-body text-ink-2">It shows under the logo and on your invoices.</p>
      <form
        className="mt-2 grid justify-items-start gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (!named && name.trim() && !save.isPending) save.mutate()
        }}
      >
        <Field label="Workspace name" className="w-full">
          <Input value={name} maxLength={80} disabled={named || save.isPending} onChange={(e) => setTyped(e.target.value)} />
        </Field>
        {named ? (
          <Chip tone="good" dot>
            Named
          </Chip>
        ) : (
          <Button type="submit" size="sm" disabled={!name.trim() || save.isPending}>
            Save name
          </Button>
        )}
        {save.isError ? (
          <p role="alert" className="text-body text-ink">
            {refusalText(save.error)}
          </p>
        ) : null}
      </form>
    </Card>
  )
}

function AgentStep() {
  const book = useQuery({ queryKey: BOOK_KEY, queryFn: agentBankApi.book })
  const agent = firstAgent(book.data?.agents)
  const rules = useQuery({ queryKey: rulesKey(agent?.id ?? ''), queryFn: () => agentBankApi.rules(agent!.id), enabled: agent !== undefined })
  const line = book.isError
    ? readFailure(book.error, 'Your agents')
    : book.isPending
      ? 'Reading…'
      : !agent
        ? 'This workspace has no agent yet. Make your first one on Home.'
        : rules.isError
          ? readFailure(rules.error, 'Its rules')
          : rules.data
            ? <RulesInWords name={agent.name} rules={rules.data} />
            : 'Reading…'
  return (
    <Card data-testid="welcome-agent">
      <StepNumber n={2} />
      <h2 className="mt-2 font-display text-reading font-bold text-ink">Your first agent is ready</h2>
      <p className="mt-1 text-body text-ink-2" data-testid="welcome-agent-rules">
        {line}
      </p>
      {agent ? <Facts className="mt-2" on="cloud" facts={[{ label: 'Its balance', value: <Money ulxc={agent.balance_ulxc} /> }]} /> : null}
    </Card>
  )
}

function CreditStep() {
  const cards = cardPayments(usePricing())
  return (
    <Card data-testid="welcome-credit">
      <StepNumber n={3} />
      <h2 className="mt-2 font-display text-reading font-bold text-ink">Credit</h2>
      <p className="mt-1 text-body text-ink-2">
        {cards === 'off' ? <>{CARDS_OFF} </> : null}
        {cards === 'live' ? (
          <>
            Add credit by card on{' '}
            <Link to="/billing" className={cn(inlineLink, 'font-semibold text-ink')}>
              Billing
            </Link>
            .{' '}
          </>
        ) : null}
        <IfArea area="gateway">
          {cards === 'live' ? 'LENS your shared answers earn converts to LXC too.' : 'Until they are, credit arrives as LENS your shared answers earn, which converts to LXC.'}
        </IfArea>
      </p>
      <IfArea area="gateway">
        <div className="mt-2">
          <ShareMyAnswers />
        </div>
      </IfArea>
    </Card>
  )
}

function AlertsCard() {
  const alerts = useQuery({ queryKey: ['limit-alerts'], queryFn: agentBankApi.limitAlerts })
  const n = alerts.data?.alerts?.length ?? 0
  return (
    <Card tone="white">
      <h2 className="font-display text-reading font-bold text-ink">Limit alerts</h2>
      <EmptyState
        className="mt-2"
        icon={
          <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth={1.9} strokeLinecap="round" aria-hidden="true">
            <path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 1.5H5z" />
            <path d="M10 20.5h4" />
          </svg>
        }
        title={n > 0 ? `${n} ${n === 1 ? 'alert' : 'alerts'} so far.` : 'No alert yet.'}
        line="When spending reaches 50, 80 or 100% of a budget, a card’s cap or an agent’s limit, the alert shows here and on Agents, once each period."
        action={
          <Button asChild size="sm" variant="secondary">
            <Link to="/money/budgets">Set a budget</Link>
          </Button>
        }
      />
    </Card>
  )
}

function SignOut() {
  const qc = useQueryClient()
  return (
    <Button
      size="sm"
      variant="secondary"
      onClick={() => {
        void fetch('/auth/logout', { method: 'POST' }).then(() => {
          // The session is dead server-side; re-probe so the gate shows the sign-in card.
          void qc.invalidateQueries({ queryKey: ['auth-me'] })
        })
      }}
    >
      Sign out
    </Button>
  )
}

/** /welcome: its own layout (the logo, the workspace's label, Sign out), the three steps, and Go to Home. */
export function Welcome() {
  useDocumentTitle('Welcome to Talyvor')
  const workspace = useQuery({ queryKey: WORKSPACE_NAME_KEY, queryFn: agentBankApi.workspaceName, staleTime: 60_000, retry: false })
  // A workspace that had a name when this page opened is sent Home; one named here stays to see it Named.
  const sawUnnamed = useRef(false)
  if (unnamed(workspace.data)) sawUnnamed.current = true
  useEffect(markWelcomed, [])
  if (workspace.data && !sawUnnamed.current) return <Navigate to="/" replace />
  return (
    <div data-design="pocket" className="flex min-h-screen flex-col bg-page text-ink">
      <header className="flex items-center justify-between gap-4 border-b border-line px-gutter py-4 wide:px-10">
        <Logo width={144} />
        <div className="flex items-center gap-3">
          <WorkspaceStatus />
          <SignOut />
        </div>
      </header>
      <main className="mx-auto grid w-full max-w-5xl flex-1 content-start gap-4.5 px-gutter pb-16 pt-6 wide:px-10">
        <div>
          <Eyebrow>A new workspace</Eyebrow>
          <h1 className="mt-1 font-display text-title font-bold text-ink">Welcome to Talyvor</h1>
          <p className="mt-1 text-reading text-ink-2">
            Every agent gets a wallet: a budget, rules and approvals, checked by Talyvor before the model is called or a payment moves.
          </p>
        </div>
        <div className="grid items-start gap-3 wide:grid-cols-3">
          <NameStep workspace={workspace.data} />
          <AgentStep />
          <CreditStep />
        </div>
        <AlertsCard />
        <Card className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-body text-ink">That is all to start. Your agents, what waits for you and their statements are on Home.</span>
          <Button asChild>
            <Link to="/">Go to Home</Link>
          </Button>
        </Card>
        <CompanyLine className="mt-6" />
      </main>
      <SnackHost view={WELCOME_PATH} />
    </div>
  )
}
