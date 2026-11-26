import { useId, useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Card, Dialog, EmptyState, Field, Icon, Input, Money, Pick, PickRow, RoomBadge, pocketFocusRing } from '@talyvor/ui/pocket'
import { cn, inlineLink } from '@talyvor/ui'
import { InlineFailure } from '../../components/SessionExpiredBar'
import { IfArea } from '../../lib/workspaceAreas'
import { PictureGallery, Portrait } from '../../cards/HelperPicker'
import { lookFor, type AgentPicture } from '../../cards/agentPictures'
import { planName, usePricing } from '../marketing/pricingApi'
import { BOOK_KEY, rulesKey } from './AgentBank'
import { AgentCard } from './AgentCard'
import { AgentFace } from './AgentFace'
import { AlertChannelsCard } from './AlertChannelsCard'
import { LimitAlertsCard } from './LimitAlertsCard'
import { AGENT_KINDS, EVERY_PAYMENT_ASKS_MINOR, type AgentKindChoice, type SuggestedRules } from './agentKinds'
import { CURRENCY_WORDS, parseRuleAmount, useAccountCurrency } from './rulesCurrency'
import { PAYEES_KEY } from './Pay'
import { MERCHANT_CATEGORIES, merchantCategoriesText } from './merchantCategories'
import { type Agent, type AgentRulesSave, type WalletKind, type WorkspacePlan, AgentBankError, PLAN_KEY, agentBankApi, readWorkspacePlan, refusalText, useAccount } from './agentBankApi'

// Agents.tsx — B57.19: /agents as Pocket's w-agents. The workspace's total, split between its agents and what is free to
// fund them; Statements and New agent; one AgentCard (B57.16) per agent, each opening its own page; and a room's wallet,
// which Lens keeps as an agent account but which takes none of the plan's agent places. New agent says the plan's limit
// before you try (GET /api/plan, as Home's "2 of 3 on Free" reads it); below it, the create form. Lens still decides:
// a 402 it answers anyway reads in words from its plan, gate, limit and allows fields, never its sentence. Below the room's
// wallet, Limit alerts (B57.90), and below them Where alerts go (B57.115).
// B61.13 — New agent starts with one of Talyvor's six, named by what it does, or the owner's own; either way the owner
// types the name, and sets the four rules the approved rules screen names, in dollars at the peg. Nothing typed, every
// payment waits for the owner's yes. The fixed rule sets are gone from it; the agent's Rules page keeps every rule.
// B57.172 — the two ways in Pocket: every start a row button (the launch pack's: cloud, 16 round, a picture, two lines
// and a chevron), one under another at every width; the start picked heads the form in the same cloud row, and the
// form's Cancel and Create agent stay at the dialog's foot while the rules above them scroll.

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

/** B48.18 — the wallets a new agent opens with, asked only where the account holds both kinds of money (Hybrid). */
const WALLET_KINDS: { kind: WalletKind; name: string }[] = [
  { kind: 'fiat', name: 'Fiat' },
  { kind: 'crypto', name: 'Crypto' },
  { kind: 'both', name: 'Both' },
]

const pick = cn('inline-flex h-8.5 items-center gap-2 whitespace-nowrap rounded-pill bg-cloud px-3.5 text-body font-semibold text-ink aria-pressed:bg-page aria-pressed:shadow-pick', pocketFocusRing)
// A row button the whole of which presses: its button holds only the name, one line, and stretches over the row.
const choice = 'relative flex w-full items-center gap-3 rounded-inset bg-cloud p-2.5 pr-3.5 text-left transition-colors duration-fast hover:bg-cloud-2'
const choiceButton = cn('whitespace-nowrap font-semibold text-ink after:absolute after:inset-0 after:rounded-card', pocketFocusRing)

/** One choice of the first step: its picture, its name (the button) and its line. */
function StartChoice({ picture, name, line, onPick }: { picture: React.ReactNode; name: string; line: string; onPick: () => void }) {
  const id = useId()
  return (
    <div className={choice} data-testid="new-agent-way">
      {picture}
      <span className="grid min-w-0 flex-1 gap-0.5">
        <button type="button" className={cn(choiceButton, 'justify-self-start')} aria-describedby={id} onClick={onPick}>
          {name}
        </button>
        <span id={id} className="text-body text-ink-3">
          {line}
        </span>
      </span>
      <Icon name="chev" size={16} className="shrink-0 text-ink-3" />
    </div>
  )
}

/** B61.13 — the four rules New agent asks for, as the approved rules screen names them (launch pack W4). */
const RULE_FIELDS = [
  ['perPayment', 'Per payment', 'max_per_payment_minor'],
  ['perDay', 'Per day', 'daily_limit_minor'],
  ['perMonth', 'Per month', 'monthly_limit_minor'],
  ['askAbove', 'Ask me above', 'approval_above_minor'],
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

/** Each typed amount in currency's minor units, 0 for one left empty; null while any is not an amount in it. */
function minorOf(typed: Typed, currency: string): Record<RuleKey, number> | null {
  const out = { perPayment: 0, perDay: 0, perMonth: 0, askAbove: 0 }
  for (const [key] of RULE_FIELDS) {
    const minor = parseRuleAmount(typed[key], currency)
    if (minor === null) return null
    out[key] = minor
  }
  return out
}

/**
 * B61.87 — the rules New agent saves: held in the account's currency, the four amounts in its minor units and no µLXC
 * limit, and the payees and merchant categories (B61.64) More rules names. With none of the four typed, every payment
 * waits for the owner's yes.
 */
export function newAgentRules(minor: Record<RuleKey, number>, currency: string, payees: string[], merchants: string[] = []): AgentRulesSave {
  const rules: AgentRulesSave = {
    currency,
    max_per_payment_minor: 0,
    hourly_limit_minor: 0,
    daily_limit_minor: 0,
    weekly_limit_minor: 0,
    monthly_limit_minor: 0,
    approval_above_minor: 0,
    allowed_models: [],
    allowed_providers: [],
    active_from: '',
    active_until: '',
    timezone: 'UTC',
  }
  for (const [key, , field] of RULE_FIELDS) rules[field] = minor[key]
  if (RULE_FIELDS.every(([key]) => minor[key] === 0)) rules.approval_above_minor = EVERY_PAYMENT_ASKS_MINOR
  if (payees.length > 0) rules.allowed_payees = payees
  if (merchants.length > 0) rules.allowed_merchant_categories = merchants
  return rules
}

/** Make your own's picture: the plus, in a 48 circle beside the six portraits. */
const ownPicture = (
  <span className="grid size-12 shrink-0 place-items-center rounded-pill bg-page text-ink-2 shadow-edge" aria-hidden="true">
    <Icon name="plus" size={20} />
  </span>
)

/** The first step: one of Talyvor's six, named by what it does, or the owner's own. */
function StartWith({ onPick, onClose }: { onPick: (start: AgentKindChoice | 'own') => void; onClose: () => void }) {
  return (
    <div className="grid gap-3.5">
      <h3 className="text-body font-semibold text-ink-2">Start with one of ours</h3>
      <div className="grid gap-2" data-testid="new-agent-kinds">
        {AGENT_KINDS.map((k) => (
          <StartChoice key={k.kind} picture={<Portrait picture={k.picture} className="size-12" />} name={k.kind} line={k.line} onPick={() => onPick(k)} />
        ))}
      </div>
      <StartChoice
        picture={ownPicture}
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
function CreateForm({ currency, onClose, onRefused }: { currency: string; onClose: () => void; onRefused: (at: AtLimit) => void }) {
  const [start, setStart] = useState<AgentKindChoice | 'own' | null>(null)
  if (start === null) return <StartWith onPick={setStart} onClose={onClose} />
  return <Details key={start === 'own' ? 'own' : start.kind} start={start} currency={currency} onBack={() => setStart(null)} onClose={onClose} onRefused={onRefused} />
}

function Details({
  start,
  currency,
  onBack,
  onClose,
  onRefused,
}: {
  start: AgentKindChoice | 'own'
  /** B61.87 — the account's own currency, which the rules are typed in and the agent's account opens in */
  currency: string
  onBack: () => void
  onClose: () => void
  onRefused: (at: AtLimit) => void
}) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const ours = start === 'own' ? null : start
  const [name, setName] = useState('')
  const [picture, setPicture] = useState<AgentPicture | null>(ours?.picture ?? null)
  const [does, setDoes] = useState<string>(ours?.kind ?? '')
  const [typed, setTyped] = useState<Typed>(ours ? typedFrom(ours.rules) : NOTHING_TYPED)
  const [more, setMore] = useState(false)
  const [payees, setPayees] = useState<string[]>([])
  const [merchants, setMerchants] = useState<string[]>([])
  const [walletKind, setWalletKind] = useState<WalletKind>('both')
  // B48.18 — a Fiat only or Stablecoin and crypto only account opens its own kind's wallet; Lens refuses another.
  const asksKind = useAccount().account?.money_kind === 'hybrid'
  const book = useQuery({ queryKey: BOOK_KEY, queryFn: agentBankApi.book })
  const saved = useQuery({ queryKey: PAYEES_KEY, queryFn: agentBankApi.payees, retry: false, enabled: more })
  const payeeChoices = [
    ...(book.data?.agents ?? []).filter((a) => !a.archived_at && a.kind !== 'room').map((a) => ({ id: a.id, name: a.name })),
    ...(saved.data?.payees ?? []).map((p) => ({ id: p.id, name: p.name })),
  ]
  const minor = minorOf(typed, currency)
  const nothingTyped = RULE_FIELDS.every(([key]) => typed[key].trim() === '')
  const rules = minor ? newAgentRules(minor, currency, payees, merchants) : null
  const create = useMutation({
    mutationFn: async (r: AgentRulesSave) => {
      // B61.87 — the agent's own account is opened in the account's currency, the one its rules are typed in.
      // B48.18 — and with the wallets the owner chose, which Lens opens at once.
      const a = await agentBankApi.create(name.trim(), picture ? lookFor(picture) : {}, r.currency === 'USDC' ? undefined : r.currency, asksKind ? walletKind : undefined)
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
      : minor === null
        ? `Type each amount in ${CURRENCY_WORDS[currency] ?? currency}, like 50 or 12.50.`
        : undefined
  return (
    <form
      className="grid gap-3.5"
      onSubmit={(e) => {
        e.preventDefault()
        if (why === undefined && rules && !create.isPending) create.mutate(rules)
      }}
    >
      <div className="flex items-center gap-3 rounded-inset bg-cloud p-2.5 pr-3" data-testid="new-agent-start">
        {ours ? (
          <>
            <Portrait picture={ours.picture} className="size-12" />
            <span className="grid min-w-0 flex-1 gap-0.5">
              <span className="font-semibold text-ink">{ours.kind}</span>
              <span className="text-body text-ink-3">{ours.line}</span>
            </span>
          </>
        ) : (
          <>
            {ownPicture}
            <span className="min-w-0 flex-1 font-semibold text-ink">Make your own</span>
          </>
        )}
        <Button variant="secondary" size="sm" onClick={onBack}>
          Change
        </Button>
      </div>
      <Field label="Name">
        <Input placeholder="Agent name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      {asksKind ? (
        <div className="grid gap-1.5">
          <span className="text-body font-semibold text-ink-2">Fiat, crypto or both?</span>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Fiat, crypto or both?" data-testid="new-agent-wallet-kind">
            {WALLET_KINDS.map((k) => (
              <button key={k.kind} type="button" className={pick} aria-pressed={walletKind === k.kind} onClick={() => setWalletKind(k.kind)}>
                {k.name}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {ours ? null : (
        <>
          <div className="grid gap-1.5">
            <span className="text-body font-semibold text-ink-2">Its picture</span>
            <PictureGallery label="Its picture" value={picture?.id ?? null} onChange={setPicture} optional />
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
                unit={currency}
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
            <span className="mt-2 text-body font-semibold text-ink-2">Merchants and categories</span>
            <span className="text-body text-ink-3">
              {merchants.length > 0 ? `${merchantCategoriesText(merchants)}. Only these, by card.` : 'Any merchant. Pick some to let it pay only them by card.'}
            </span>
            <PickRow label="Merchants and categories">
              {MERCHANT_CATEGORIES.map((c) => (
                <Pick
                  key={c.id}
                  checked={merchants.includes(c.id)}
                  onCheckedChange={(on) => setMerchants((all) => (on ? [...all, c.id] : all.filter((x) => x !== c.id)))}
                >
                  {c.name}
                </Pick>
              ))}
            </PickRow>
          </div>
        ) : null}
      </div>
      {create.isError && !planRefusal(create.error) ? (
        <p role="alert" className="text-body text-danger">
          {refusalText(create.error)}
        </p>
      ) : null}
      <div className="sticky -bottom-8.5 -mx-6 -mb-8.5 flex flex-wrap justify-end gap-2.5 bg-page px-6 pb-8.5 pt-3.5 wide:-bottom-6 wide:-mb-6 wide:pb-6" data-testid="new-agent-actions">
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
  const currency = useAccountCurrency()
  const close = () => {
    setRefused(null)
    onClose()
  }
  const full = (p: WorkspacePlan) => p.agents >= 0 && p.agents_used >= p.agents
  const at: AtLimit | null = refused ?? (plan.data && full(plan.data) ? { plan: plan.data.plan, limit: plan.data.agents } : null)
  return (
    <Dialog open={open} onClose={close} title={at ? `${planName(at.plan)} has room for ${agentsWord(at.limit)}` : 'New agent'} className="max-h-screen scroll-pb-28 overflow-y-auto">
      {plan.isPending && !refused ? (
        <p>Reading your plan…</p>
      ) : currency === null && !refused ? (
        <p>Reading…</p>
      ) : at ? (
        <LimitReached at={at} names={names} onClose={close} />
      ) : (
        <CreateForm currency={currency ?? 'USD'} onClose={close} onRefused={setRefused} />
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
        <p className="max-w-3xl text-reading pk-on-bg" data-testid="agents-totals">
          Each agent spends its own money, inside its own rules.
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
            <Button variant="secondary" size="sm" icon={<Icon name="plus" size={16} />} onClick={() => setCreating(true)}>
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
