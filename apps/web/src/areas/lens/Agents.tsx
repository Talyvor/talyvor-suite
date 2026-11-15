import { useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Card, Dialog, EmptyState, Field, Icon, Input, Money, RoomBadge, pocketFocusRing, type FaceColour } from '@talyvor/ui/pocket'
import { cn, inlineLink } from '@talyvor/ui'
import { InlineFailure } from '../../components/SessionExpiredBar'
import { IfArea } from '../../lib/workspaceAreas'
import { HelperPicker } from '../../cards/HelperPicker'
import { planName, usePricing } from '../marketing/pricingApi'
import { BOOK_KEY, rulesKey } from './AgentBank'
import { AgentCard } from './AgentCard'
import { AgentFace } from './AgentFace'
import { AlertChannelsCard } from './AlertChannelsCard'
import { LimitAlertsCard } from './LimitAlertsCard'
import { RULE_TEMPLATES, type RuleTemplate } from './ruleTemplates'
import { type Agent, type WorkspacePlan, AgentBankError, PLAN_KEY, agentBankApi, readWorkspacePlan, refusalText } from './agentBankApi'

// Agents.tsx — B57.19: /agents as Pocket's w-agents. The workspace's total, split between its agents and what is free to
// fund them; Statements and New agent; one AgentCard (B57.16) per agent, each opening its own page; and a room's wallet,
// which Lens keeps as an agent account but which takes none of the plan's agent places. New agent says the plan's limit
// before you try (GET /api/plan, as Home's "2 of 3 on Free" reads it); below it, the create form. Lens still decides:
// a 402 it answers anyway reads in words from its plan, gate, limit and allows fields, never its sentence. Below the room's
// wallet, Limit alerts (B57.90), and below them Where alerts go (B57.115).

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

const pick = cn('inline-flex h-8.5 items-center whitespace-nowrap rounded-pill bg-cloud px-3.5 text-body font-semibold text-ink aria-pressed:bg-page aria-pressed:shadow-pick', pocketFocusRing)

/**
 * The create form (B28.305's rule templates, B57.124's helper): created, then what it is for and its rules saved, in
 * the one press. When Lens refuses either the agent still exists, so the dialog says what was not saved and opens it.
 */
function CreateForm({ onClose, onRefused }: { onClose: () => void; onRefused: (at: AtLimit) => void }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [purpose, setPurpose] = useState('')
  const [template, setTemplate] = useState<RuleTemplate | null>(null)
  const [colour, setColour] = useState<FaceColour | null>(null)
  const create = useMutation({
    mutationFn: async () => {
      const a = await agentBankApi.create(name.trim(), colour ?? undefined)
      const unsaved: string[] = []
      if (purpose.trim() !== '') {
        try {
          await agentBankApi.update(a.id, { description: purpose.trim() })
        } catch (err) {
          unsaved.push(`what it is for was not saved: ${refusalText(err)}`)
        }
      }
      if (template !== null) {
        try {
          qc.setQueryData(rulesKey(a.id), await agentBankApi.setRules(a.id, template.rules))
        } catch (err) {
          unsaved.push(`its ${template.name} rules were not saved: ${refusalText(err)}`)
        }
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
  return (
    <form
      className="grid gap-3.5"
      onSubmit={(e) => {
        e.preventDefault()
        if (name.trim() !== '' && !create.isPending) create.mutate()
      }}
    >
      <Field label="Name">
        <Input placeholder="Agent name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <label className="grid gap-1.5">
        <span className="text-body font-semibold text-ink-2">What it is for</span>
        <textarea
          rows={2}
          maxLength={500}
          placeholder="e.g. answers support tickets overnight"
          className={cn(
            'w-full rounded-control bg-page px-3.5 py-2.5 text-reading text-ink shadow-edge placeholder:text-faint transition-colors duration-200 hover:border-rule-strong disabled:cursor-not-allowed disabled:opacity-50',
            pocketFocusRing,
          )}
          value={purpose}
          onChange={(e) => setPurpose(e.target.value)}
        />
      </label>
      <div className="grid gap-1.5">
        <span className="text-body font-semibold text-ink-2">Rules to start from</span>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Rules to start from">
          {[null, ...RULE_TEMPLATES].map((t) => (
            <button key={t?.id ?? 'none'} type="button" className={pick} aria-pressed={template?.id === t?.id} onClick={() => setTemplate(t)}>
              {t?.name ?? 'No rules'}
            </button>
          ))}
        </div>
        {template ? <p className="text-body text-ink-3">{template.summary}</p> : null}
      </div>
      <div className="grid gap-1.5">
        <span className="text-body font-semibold text-ink-2">Its helper</span>
        <HelperPicker label="Its helper" value={colour} onChange={setColour} />
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
        <Button type="submit" disabled={name.trim() === '' || create.isPending} disabledReason={name.trim() === '' ? 'Name it first.' : undefined}>
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
    <Dialog open={open} onClose={close} title={at ? `${planName(at.plan)} has room for ${agentsWord(at.limit)}` : 'New agent'}>
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
