import { useId, useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Card, Dialog, EmptyState, Field, Icon, Input, Money, RoomBadge, pocketFocusRing } from '@talyvor/ui/pocket'
import { cn, inlineLink } from '@talyvor/ui'
import { InlineFailure } from '../../components/SessionExpiredBar'
import { IfArea } from '../../lib/workspaceAreas'
import { Portrait } from '../../cards/HelperPicker'
import type { AgentCardArt } from '../../cards/cardArt'
import { planName, usePricing } from '../marketing/pricingApi'
import { BOOK_KEY, rulesKey } from './AgentBank'
import { AgentCard } from './AgentCard'
import { AgentFace } from './AgentFace'
import { AlertChannelsCard } from './AlertChannelsCard'
import { LimitAlertsCard } from './LimitAlertsCard'
import { AGENT_KINDS, EVERY_PAYMENT_ASKS_ULXC, type AgentKindChoice, type SuggestedRules, ulxcForCents } from './agentKinds'
import { pegQuery } from './money'
import { PAYEES_KEY } from './Pay'
import { dollarsToCents } from './topupApi'
import { type Agent, type AgentRules, type WorkspacePlan, AgentBankError, PLAN_KEY, agentBankApi, readWorkspacePlan, refusalText } from './agentBankApi'

// Agents.tsx — B57.19: /agents as Pocket's w-agents. The workspace's total, split between its agents and what is free to
// fund them; Statements and New agent; one AgentCard (B57.16) per agent, each opening its own page; and a room's wallet,
// which Lens keeps as an agent account but which takes none of the plan's agent places. New agent says the plan's limit
// before you try (GET /api/plan, as Home's "2 of 3 on Free" reads it); below it, the create form. Lens still decides:
// a 402 it answers anyway reads in words from its plan, gate, limit and allows fields, never its sentence. Below the room's
// wallet, Limit alerts (B57.90), and below them Where alerts go (B57.115).
// B61.13 — New agent starts with one of Talyvor's six, named by what it does, or the owner's own; either way the owner
// types the name, and sets the four rules the approved rules screen names, in dollars at the peg. Nothing typed, every
// payment waits for the owner's yes. The fixed rule sets are gone from it; the agent's Rules page keeps every rule.

/** "Research", "Research and Sales", "Research, Sales and Ops". */
function namesLine(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/** "3 agents", "1 agent". */
function agentsWord(n: number): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? 'agent' : 'agents'}`
}

/** What a plan's limit stops: the plan, the agents it takes, and the plan that takes more ("" when only a contract does). */
export interface AtLimit {
  plan: string
  limit: number
  /** undefined while it is not known which plan takes more */
  allows?: string
}

/** A plan's 402 from Lens (B55.29: plan, gate, limit and allows); null for any other refusal. */
export function planRefusal(err: unknown): AtLimit | null {
  if (!(err instanceof AgentBankError) || err.status !== 402) return null
  const { plan, gate, limit, allows } = err.body
  if (gate !== 'agents' || typeof plan !== 'string' || typeof limit !== 'number') return null
  return { plan, limit, allows: typeof allows === 'string' ? allows : '' }
}

/** The plan's limit, in the reference's words (dlg-new-agent): who fills the places, and the plan with room for more. */
function LimitReached({ at, names, onClose }: { at: AtLimit; names: string[]; onClose: () => void }) {
  const pricing = usePricing()
  const gates = pricing.status === 'ok' ? pricing.pricing.plan_gates : undefined
  // GET /api/plan names no next plan, so it is the first plan after this one, in Lens's order, that takes more.
  const allows =
    at.allows ??
    (gates ? (gates.order.slice(gates.order.indexOf(at.plan) + 1).find((p) => (gates.plans[p]?.agents ?? 0) < 0 || (gates.plans[p]?.agents ?? 0) > at.limit) ?? '') : undefined)
  const more = allows ? gates?.plans[allows]?.agents : undefined
  const plan = planName(at.plan)
  const fill = names.length === at.limit && names.length > 0 ? namesLine(names) : `Your ${agentsWord(names.length)}`
  return (
    <>
      <p data-testid="new-agent-limit">
        {at.limit === 0 ? `${plan} has no agent places.` : `${fill} ${names.length === 1 ? 'fills' : 'fill'} ${plan}’s ${at.limit === 1 ? 'one place' : `${at.limit.toLocaleString('en-US')} places`}.`}
        {allows === '' ? ' A contract with Talyvor sets more.' : allows ? ` ${planName(allows)} has room for ${more === undefined ? 'more' : more < 0 ? 'any number' : more.toLocaleString('en-US')}.` : ''}{' '}
        Archiving an agent frees its place; a room’s wallet does not take one.
      </p>
      <div className="flex flex-wrap justify-end gap-2.5">
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
        <Button asChild>
          <Link to="/plans">See plans</Link>
        </Button>
      </div>
    </>
  )
}

const pick = cn('inline-flex h-8.5 items-center gap-2 whitespace-nowrap rounded-pill bg-cloud px-3.5 text-body font-semibold text-ink aria-pressed:bg-page aria-pressed:shadow-pick', pocketFocusRing)
// A card the whole of which presses: its button holds only the name, one line, and stretches over the card.
const choice = 'relative flex w-full items-center gap-3 rounded-card bg-cloud p-3 text-left transition-colors duration-200 hover:bg-cloud-2'
const choiceButton = cn('whitespace-nowrap font-semibold text-ink after:absolute after:inset-0 after:rounded-card', pocketFocusRing)

/** One choice of the first step: its picture, its name (the button) and its line. */
function StartChoice({ picture, name, line, onPick }: { picture: React.ReactNode; name: string; line: string; onPick: () => void }) {
  const id = useId()
  return (
    <div className={choice}>
      {picture}
      <span className="grid min-w-0 gap-0.5">
        <button type="button" className={cn(choiceButton, 'justify-self-start')} aria-describedby={id} onClick={onPick}>
          {name}
        </button>
        <span id={id} className="text-body text-ink-3">
          {line}
        </span>
      </span>
    </div>
  )
}

/** B61.13 — the four rules New agent asks for, as the approved rules screen names them (launch pack W4). */
const RULE_FIELDS = [
  ['perPayment', 'Per payment', 'max_per_request_ulxc'],
  ['perDay', 'Per day', 'daily_limit_ulxc'],
  ['perMonth', 'Per month', 'monthly_limit_ulxc'],
  ['askAbove', 'Ask me above', 'approval_above_ulxc'],
] as const
type RuleKey = keyof SuggestedRules
type Typed = Record<RuleKey, string>
const NOTHING_TYPED: Typed = { perPayment: '', perDay: '', perMonth: '', askAbove: '' }
const typedFrom = (r: SuggestedRules): Typed => ({
  perPayment: r.perPayment > 0 ? String(r.perPayment) : '',
  perDay: r.perDay > 0 ? String(r.perDay) : '',
  perMonth: r.perMonth > 0 ? String(r.perMonth) : '',
  askAbove: r.askAbove > 0 ? String(r.askAbove) : '',
})

/** Each typed amount in cents, 0 for one left empty; null while any is not an amount. */
function centsOf(typed: Typed): Record<RuleKey, number> | null {
  const out = { perPayment: 0, perDay: 0, perMonth: 0, askAbove: 0 }
  for (const [key] of RULE_FIELDS) {
    if (typed[key].trim() === '') continue
    const cents = dollarsToCents(typed[key])
    if (cents === null) return null
    out[key] = cents
  }
  return out
}

/**
 * The rules New agent saves: the four amounts in Lens's units at the peg, and the payees More rules names. With none of
 * the four typed, every payment waits for the owner's yes; null while an amount typed has no peg to back it.
 */
export function newAgentRules(cents: Record<RuleKey, number>, usdPerLXC: number | undefined, payees: string[]): AgentRules | null {
  const rules: AgentRules = { max_per_request_ulxc: 0, daily_limit_ulxc: 0, monthly_limit_ulxc: 0, approval_above_ulxc: 0, allowed_models: [], allowed_providers: [], active_from: '', active_until: '', timezone: 'UTC' }
  for (const [key, , field] of RULE_FIELDS) {
    if (cents[key] === 0) continue
    const ulxc = ulxcForCents(cents[key], usdPerLXC)
    if (ulxc === null) return null
    rules[field] = ulxc
  }
  if (RULE_FIELDS.every(([key]) => cents[key] === 0)) rules.approval_above_ulxc = EVERY_PAYMENT_ASKS_ULXC
  if (payees.length > 0) rules.allowed_payees = payees
  return rules
}

/** The first step: one of Talyvor's six, named by what it does, or the owner's own. */
function StartWith({ onPick, onClose }: { onPick: (start: AgentKindChoice | 'own') => void; onClose: () => void }) {
  return (
    <div className="grid gap-3.5">
      <h3 className="text-body font-semibold text-ink-2">Start with one of ours</h3>
      <div className="grid gap-2.5 wide:grid-cols-2" data-testid="new-agent-kinds">
        {AGENT_KINDS.map((k) => (
          <StartChoice key={k.kind} picture={<Portrait helper={k.picture} className="size-12" />} name={k.kind} line={k.line} onPick={() => onPick(k)} />
        ))}
      </div>
      <StartChoice
        picture={
          <span className="grid size-12 shrink-0 place-items-center rounded-pill bg-page text-ink-2 shadow-edge" aria-hidden="true">
            <Icon name="plus" size={20} />
          </span>
        }
        name="Make your own"
        line="Name it, choose its picture and what it does, and set its rules."
        onPick={() => onPick('own')}
      />
      <div className="flex flex-wrap justify-end gap-2.5">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

/**
 * The create form (B61.13): the name the owner types, the picture and what it does, and the four rules, with payees
 * under More rules. Created, then what it does and its rules saved, in the one press. When Lens refuses either the
 * agent still exists, so the dialog says what was not saved and opens it.
 */
function CreateForm({ onClose, onRefused }: { onClose: () => void; onRefused: (at: AtLimit) => void }) {
  const [start, setStart] = useState<AgentKindChoice | 'own' | null>(null)
  if (start === null) return <StartWith onPick={setStart} onClose={onClose} />
  return <Details key={start === 'own' ? 'own' : start.kind} start={start} onBack={() => setStart(null)} onClose={onClose} onRefused={onRefused} />
}

function Details({ start, onBack, onClose, onRefused }: { start: AgentKindChoice | 'own'; onBack: () => void; onClose: () => void; onRefused: (at: AtLimit) => void }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const ours = start === 'own' ? null : start
  const [name, setName] = useState('')
  const [picture, setPicture] = useState<AgentCardArt | null>(ours?.picture ?? null)
  const [does, setDoes] = useState<string>(ours?.kind ?? '')
  const [typed, setTyped] = useState<Typed>(ours ? typedFrom(ours.rules) : NOTHING_TYPED)
  const [more, setMore] = useState(false)
  const [payees, setPayees] = useState<string[]>([])
  const peg = useQuery(pegQuery)
  const book = useQuery({ queryKey: BOOK_KEY, queryFn: agentBankApi.book })
  const saved = useQuery({ queryKey: PAYEES_KEY, queryFn: agentBankApi.payees, retry: false, enabled: more })
  const payeeChoices = [
    ...(book.data?.agents ?? []).filter((a) => !a.archived_at && a.kind !== 'room').map((a) => ({ id: a.id, name: a.name })),
    ...(saved.data?.payees ?? []).map((p) => ({ id: p.id, name: p.name })),
  ]
  const cents = centsOf(typed)
  const nothingTyped = RULE_FIELDS.every(([key]) => typed[key].trim() === '')
  const rules = cents ? newAgentRules(cents, peg.data?.usd_per_lxc, payees) : null
  const create = useMutation({
    mutationFn: async (r: AgentRules) => {
      const a = await agentBankApi.create(name.trim(), picture?.colour)
      const unsaved: string[] = []
      if (does.trim() !== '') {
        try {
          await agentBankApi.update(a.id, { description: does.trim() })
        } catch (err) {
          unsaved.push(`what it does was not saved: ${refusalText(err)}`)
        }
      }
      try {
        qc.setQueryData(rulesKey(a.id), await agentBankApi.setRules(a.id, r))
      } catch (err) {
        unsaved.push(`its rules were not saved: ${refusalText(err)}`)
      }
      return { a, unsaved }
    },
    onSuccess: ({ a, unsaved }) => {
      if (unsaved.length > 0) return
      navigate(`/agents/${encodeURIComponent(a.id)}`)
    },
    onError: (err) => {
      const at = planRefusal(err)
      if (at) onRefused(at)
    },
    onSettled: () => Promise.all([qc.invalidateQueries({ queryKey: BOOK_KEY }), qc.invalidateQueries({ queryKey: PLAN_KEY })]),
  })
  const made = create.data
  if (made && made.unsaved.length > 0) {
    return (
      <>
        <p role="alert" data-testid="new-agent-unsaved">
          {made.a.name} was created, but {made.unsaved.join('; and ')} Set it on its page.
        </p>
        <div className="flex flex-wrap justify-end gap-2.5">
          <Button asChild>
            <Link to={`/agents/${encodeURIComponent(made.a.id)}`}>Open {made.a.name}</Link>
          </Button>
        </div>
      </>
    )
  }
  const why =
    name.trim() === ''
      ? 'Name it first.'
      : cents === null
        ? 'Type each amount in dollars, like 50 or 12.50.'
        : rules === null
          ? peg.isError
            ? 'The dollar rate could not be read. Try again in a moment.'
            : 'Reading the dollar rate…'
          : undefined
  return (
    <form
      className="grid gap-3.5"
      onSubmit={(e) => {
        e.preventDefault()
        if (why === undefined && rules && !create.isPending) create.mutate(rules)
      }}
    >
      <div className="flex items-center gap-3" data-testid="new-agent-start">
        {ours ? (
          <>
            <Portrait helper={ours.picture} className="size-12" />
            <span className="grid min-w-0 flex-1 gap-0.5">
              <span className="font-semibold text-ink">{ours.kind}</span>
              <span className="text-body text-ink-3">{ours.line}</span>
            </span>
          </>
        ) : (
          <span className="min-w-0 flex-1 font-semibold text-ink">Make your own</span>
        )}
        <Button variant="secondary" size="sm" onClick={onBack}>
          Change
        </Button>
      </div>
      <Field label="Name">
        <Input placeholder="Agent name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      {ours ? null : (
        <>
          <div className="grid gap-1.5">
            <span className="text-body font-semibold text-ink-2">Picture</span>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Picture">
              {AGENT_KINDS.map((k, i) => (
                <button
                  key={k.picture.id}
                  type="button"
                  aria-label={`Picture ${i + 1}`}
                  aria-pressed={picture?.id === k.picture.id}
                  className={cn('inline-flex rounded-pill p-0.5 aria-pressed:shadow-pick', pocketFocusRing)}
                  onClick={() => setPicture((p) => (p?.id === k.picture.id ? null : k.picture))}
                >
                  <Portrait helper={k.picture} className="size-11" />
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-1.5">
            <span className="text-body font-semibold text-ink-2">What it does</span>
            <div className="flex flex-wrap gap-2" role="group" aria-label="What it does">
              {AGENT_KINDS.map((k) => (
                <button key={k.kind} type="button" className={pick} aria-pressed={does === k.kind} onClick={() => setDoes((d) => (d === k.kind ? '' : k.kind))}>
                  {k.kind}
                </button>
              ))}
            </div>
            <Input
              aria-label="What it does, in your own words"
              placeholder="Or in your own words"
              maxLength={500}
              value={AGENT_KINDS.some((k) => k.kind === does) ? '' : does}
              onChange={(e) => setDoes(e.target.value)}
            />
          </div>
        </>
      )}
      <div className="grid gap-2.5" role="group" aria-label="Its rules">
        <div className="grid grid-cols-2 gap-2.5">
          {RULE_FIELDS.map(([key, label]) => (
            <Field key={key} label={label} className="min-w-0">
              <Input
                inputMode="decimal"
                className="min-w-0"
                unit="USD"
                placeholder="None"
                value={typed[key]}
                onChange={(e) => setTyped((t) => ({ ...t, [key]: e.target.value }))}
              />
            </Field>
          ))}
        </div>
        <p className="text-body text-ink-3">Anything outside these rules waits for your yes.</p>
        {nothingTyped ? (
          <p className="text-body text-ink-2" data-testid="new-agent-every-payment">
            With none of these set, every payment waits for your yes.
          </p>
        ) : null}
      </div>
      <div className="grid gap-2.5">
        <Button variant="secondary" size="sm" className="justify-self-start" aria-expanded={more} onClick={() => setMore((m) => !m)}>
          More rules
        </Button>
        {more ? (
          <div className="grid gap-1.5" data-testid="new-agent-more-rules">
            <span className="text-body font-semibold text-ink-2">Payees</span>
            <span className="text-body text-ink-3">
              {payees.length > 0 ? 'Only these. Card shops count as payees.' : 'Any payee, inside the rules above. Pick some to allow only them. Card shops count as payees.'}
            </span>
            {payeeChoices.length > 0 ? (
              <div className="flex flex-wrap gap-2" role="group" aria-label="Payees">
                {payeeChoices.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={pick}
                    aria-pressed={payees.includes(p.id)}
                    onClick={() => setPayees((all) => (all.includes(p.id) ? all.filter((x) => x !== p.id) : [...all, p.id]))}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            ) : (
              <span className="text-body text-ink-3">{saved.isPending ? 'Reading your payees…' : 'No saved payees yet. Add them in Pay.'}</span>
            )}
          </div>
        ) : null}
      </div>
      {create.isError && !planRefusal(create.error) ? (
        <p role="alert" className="text-body text-danger">
          {refusalText(create.error)}
        </p>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2.5">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={create.isPending} disabledReason={why}>
          {create.isPending ? 'Creating…' : 'Create agent'}
        </Button>
      </div>
    </form>
  )
}

/** The plan's limit when the plan is full, else the form. Unread, the form: Lens judges the create on its own. */
export function NewAgent({ open, onClose, names }: { open: boolean; onClose: () => void; names: string[] }) {
  const plan = useQuery({ queryKey: PLAN_KEY, queryFn: readWorkspacePlan, staleTime: 60_000, retry: false, enabled: open })
  const [refused, setRefused] = useState<AtLimit | null>(null)
  const close = () => {
    setRefused(null)
    onClose()
  }
  const full = (p: WorkspacePlan) => p.agents >= 0 && p.agents_used >= p.agents
  const at: AtLimit | null = refused ?? (plan.data && full(plan.data) ? { plan: plan.data.plan, limit: plan.data.agents } : null)
  return (
    <Dialog open={open} onClose={close} title={at ? `${planName(at.plan)} has room for ${agentsWord(at.limit)}` : 'New agent'} className="max-h-screen overflow-y-auto">
      {plan.isPending && !refused ? (
        <p>Reading your plan…</p>
      ) : at ? (
        <LimitReached at={at} names={names} onClose={close} />
      ) : (
        <CreateForm onClose={close} onRefused={setRefused} />
      )}
    </Dialog>
  )
}

/** A room's wallet: Lens keeps it as an agent account, but it is the room's, and takes none of the plan's places. */
function RoomWallet({ wallet, plan }: { wallet: Agent; plan: WorkspacePlan | undefined }) {
  const rules = useQuery({ queryKey: rulesKey(wallet.id), queryFn: () => agentBankApi.rules(wallet.id) })
  const budget = rules.data?.monthly_limit_ulxc ?? 0
  return (
    <Card tone="white" className="flex flex-wrap items-center justify-between gap-3" data-testid={`room-wallet-${wallet.id}`}>
      <div className="flex min-w-0 items-center gap-3">
        <RoomBadge icon={<Icon name="rooms" />} size="md" />
        <div className="min-w-0">
          <div className="font-semibold text-ink">{wallet.name}</div>
          <p className="text-body text-ink-2">
            {plan && plan.agents >= 0
              ? `A room’s wallet. It does not take one of ${planName(plan.plan)}’s ${plan.agents.toLocaleString('en-US')} agent places.`
              : 'A room’s wallet. It does not take one of your agent places.'}
            {budget > 0 ? (
              <>
                {' '}
                Its budget is the room’s: <Money ulxc={budget} /> a month.
              </>
            ) : null}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span className="whitespace-nowrap font-semibold">
          <Money ulxc={wallet.balance_ulxc} />
        </span>
        <Button asChild variant="secondary" size="sm">
          <Link to="/rooms">Open the room</Link>
        </Button>
      </div>
    </Card>
  )
}

function AgentsList() {
  const book = useQuery({ queryKey: BOOK_KEY, queryFn: agentBankApi.book })
  const plan = useQuery({ queryKey: PLAN_KEY, queryFn: readWorkspacePlan, staleTime: 60_000, retry: false })
  const [creating, setCreating] = useState(false)
  const all = book.data?.agents ?? []
  const agents = all.filter((a) => !a.archived_at && a.kind !== 'room')
  const rooms = all.filter((a) => !a.archived_at && a.kind === 'room')
  const archived = all.filter((a) => a.archived_at && a.kind !== 'room')

  return (
    <div className="grid min-w-0 gap-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <p className="max-w-3xl text-reading text-ink-2" data-testid="agents-totals">
          Each agent spends its own money, inside its own rules.
          {book.data ? (
            <>
              {' '}
              The workspace holds <Money ulxc={book.data.workspace_balance_ulxc} />: <Money ulxc={book.data.allocated_ulxc} /> with its agents and{' '}
              <Money ulxc={book.data.unallocated_ulxc} /> free to fund them.
            </>
          ) : null}
        </p>
        <div className="flex flex-wrap gap-2.5">
          <Button asChild variant="secondary">
            <Link to="/statements">
              <Icon name="statements" size={18} />
              Statements
            </Link>
          </Button>
          <Button icon={<Icon name="plus" size={18} />} onClick={() => setCreating(true)}>
            New agent
          </Button>
        </div>
      </div>

      {book.isError ? (
        <div role="alert" className="grid justify-items-start gap-3">
          <InlineFailure error={book.error} failed="Couldn’t load your agents" />
          <Button variant="secondary" size="sm" onClick={() => void book.refetch()}>
            Try again
          </Button>
        </div>
      ) : !book.data ? (
        <p className="text-body text-ink-3">Reading…</p>
      ) : agents.length === 0 ? (
        <EmptyState
          icon={<Icon name="agents" />}
          title="No agents yet"
          line="Give an agent its own account, wallet and card."
          action={
            <Button size="sm" icon={<Icon name="plus" size={16} />} onClick={() => setCreating(true)}>
              New agent
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 wide:grid-cols-3" data-testid="agents-list">
          {agents.map((a) => (
            <AgentCard key={a.id} agent={a} book={book.data} />
          ))}
        </div>
      )}

      <IfArea area="rooms">
        {rooms.map((r) => (
          <RoomWallet key={r.id} wallet={r} plan={plan.data} />
        ))}
      </IfArea>

      {book.data ? <LimitAlertsCard nameOf={(id) => all.find((a) => a.id === id)?.name ?? 'an agent'} /> : null}
      {book.data ? <AlertChannelsCard /> : null}

      {archived.length > 0 ? (
        <p className="text-body text-ink-3" data-testid="agents-archived">
          Archived:{' '}
          {archived.map((a, i) => (
            <span key={a.id}>
              {i > 0 ? ', ' : ''}
              <Link to={`/agents/${encodeURIComponent(a.id)}`} className={cn(inlineLink, 'inline-flex items-center gap-1.5')}>
                <AgentFace agent={a} size={20} />
                {a.name}
              </Link>
            </span>
          ))}
        </p>
      ) : null}

      <NewAgent open={creating} onClose={() => setCreating(false)} names={agents.map((a) => a.name)} />
    </div>
  )
}

/** /agents, and /agents?agent=<id> (a statement line Chat links to) sent on to that agent's own page. */
export function Agents() {
  const [params] = useSearchParams()
  const linked = params.get('agent')
  if (linked) {
    const entry = params.get('entry')
    return <Navigate replace to={`/agents/${encodeURIComponent(linked)}${entry ? `?entry=${encodeURIComponent(entry)}` : ''}`} />
  }
  return <AgentsList />
}
