import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Chip, Field, Input, Money, Row, Select, Tabs, type ChipTone } from '@talyvor/ui/pocket'
import { formatUSD, formatWhen } from './format'
import {
  type Agent,
  type CashOut,
  type Escrow,
  type Portfolio,
  type Pot,
  type SimOrder,
  type SimOrderInput,
  agentBankApi,
  newMoveKey,
  parseLXC,
  refusalText,
  retryMoveThroughRestart,
} from './agentBankApi'
import { Note, PanelForm, readFailure } from './WalletMoney'
import { WorkspaceLabel } from '../../labels/workspace'

// WalletHoldings.tsx — B22.12: Agent Wallets' escrow (Lens B22.6), pots (B22.7), simulated portfolios and
// orders (B22.8) and cash-out (B22.9). Each capability carries its class the way B22.10's screens show it:
// an AMBER or RED one Talyvor has not cleared is marked beside it, with why, in one plain sentence.
// B57.21 — each is a panel in Pocket's fields, rows, chips and <Money>, opened from a row of the Money section on the
// agent's page (AgentMoney.tsx). Lens decides; the screen shows Lens's figures and, on a refusal, Lens's own sentence.

const BOOK_KEY = ['agent-book']
export const ESCROWS_KEY = ['wallet-escrows']
export const CASH_OUTS_KEY = ['wallet-cash-outs']
const QUOTES_KEY = ['wallet-quotes']
export const potsKey = (id: string) => ['agent-pots', id]
const portfoliosKey = (id: string) => ['agent-portfolios', id]

/** A date field's `YYYY-MM-DD` → the start of that day, here, as RFC 3339. Null for an empty or bad date. */
function startOfDay(date: string): string | null {
  const d = new Date(`${date}T00:00:00`)
  return date === '' || Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** 1,500,000 micros of an instrument → `1.5`. */
const units = (micros: number) => (micros / 1_000_000).toLocaleString('en-US', { maximumFractionDigits: 6 })

/** Lens's `1.08450000` → `$1.0845`. */
const price = (usdText: string) => `$${Number(usdText).toLocaleString('en-US', { maximumFractionDigits: 8 })}`

// ── Pots ────────────────────────────────────────────────────────────────────────────────────────────

const POT_KINDS: readonly [Pot['kind'], string][] = [
  ['goal', 'Goal'],
  ['budget', 'Budget'],
  ['reserve', 'Reserve'],
]
const POT_WORDS = ['Goal', 'Budget', 'Reserve'] as const

function PotRow({ agent, pot }: { agent: Agent; pot: Pot }) {
  const qc = useQueryClient()
  const [amount, setAmount] = useState('')
  const [until, setUntil] = useState('')
  const micros = parseLXC(amount)
  const lockAt = startOfDay(until)
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: potsKey(agent.id) }), qc.invalidateQueries({ queryKey: BOOK_KEY })])
  // B17.33 — as Money's Fund and Take back (B17.26): the amount and the Idempotency-Key are the mutation's
  // own, so a move sent again through a deploy's restart repeats both and Lens moves the LXC once.
  const move = useMutation({
    mutationFn: ({ dir, ulxc, key }: { dir: 'in' | 'out'; ulxc: number; key: string }) => agentBankApi.movePot(agent.id, pot.id, dir, ulxc, key),
    retry: retryMoveThroughRestart,
    retryDelay: (failures) => Math.min(500 * 2 ** failures, 4_000),
    onSuccess: () => setAmount(''),
    onSettled: refresh,
  })
  const lock = useMutation({
    mutationFn: () => agentBankApi.lockPot(agent.id, pot.id, lockAt),
    onSuccess: () => setUntil(''),
    onSettled: refresh,
  })
  // A press with no amount says what it needs, rather than a press that does nothing.
  const [unsaid, setUnsaid] = useState(false)
  const moveBy = (dir: 'in' | 'out') => {
    setUnsaid(micros === null)
    if (micros !== null) move.mutate({ dir, ulxc: micros, key: newMoveKey() })
  }
  const locked = pot.locked_until !== undefined && new Date(pot.locked_until).getTime() > Date.now()
  return (
    <div className="grid gap-2.5 border-t border-line py-3 first:border-t-0" data-testid="pot">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-ink">{pot.name}</span>
        <Chip>{POT_KINDS.find(([k]) => k === pot.kind)?.[1] ?? 'Pot'}</Chip>
        {locked && pot.locked_until ? (
          <Chip tone="wait">
            Locked until <span className="font-figure">{formatWhen(pot.locked_until)}</span>
          </Chip>
        ) : null}
        <span className="ml-auto text-ink">
          <Money ulxc={pot.balance_ulxc} />
          {pot.target_ulxc ? (
            <>
              {' '}
              of <Money ulxc={pot.target_ulxc} />
            </>
          ) : null}
        </span>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <Field label={`Amount in LXC to move for ${pot.name}`} className="min-w-0 flex-1">
          <Input inputMode="decimal" placeholder="0" unit="LXC" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Button size="sm" disabled={move.isPending} onClick={() => moveBy('in')}>
          Move in
        </Button>
        <Button size="sm" variant="secondary" disabled={move.isPending} onClick={() => moveBy('out')}>
          Move out
        </Button>
      </div>
      {unsaid ? <Note ok={false}>Type an amount in LXC first.</Note> : null}
      <div className="flex flex-wrap items-end gap-2">
        <Field label={`Lock ${pot.name} until`} className="min-w-0 flex-1">
          <Input type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
        </Field>
        <Button size="sm" variant="secondary" disabled={lock.isPending} disabledReason={lockAt === null ? 'Choose a date first' : undefined} onClick={() => lock.mutate()}>
          {locked ? 'Lock for longer' : 'Lock'}
        </Button>
      </div>
      {move.isError ? <Note ok={false}>Not moved. {refusalText(move.error)}</Note> : null}
      {lock.isError ? <Note ok={false}>Not locked. {refusalText(lock.error)}</Note> : null}
    </div>
  )
}

/** The agent's pots: credits set aside for a goal, a budget or a reserve, and a lock until a date. */
export function Pots({ agent }: { agent: Agent }) {
  const qc = useQueryClient()
  const list = useQuery({ queryKey: potsKey(agent.id), queryFn: () => agentBankApi.pots(agent.id) })
  const [name, setName] = useState('')
  const [kindWord, setKindWord] = useState<(typeof POT_WORDS)[number]>('Goal')
  const kind = POT_KINDS.find(([, w]) => w === kindWord)?.[0] ?? 'goal'
  const [target, setTarget] = useState('')
  const [until, setUntil] = useState('')
  const targetMicros = target.trim() === '' ? 0 : parseLXC(target)
  const ready = name.trim() !== '' && targetMicros !== null && (until === '' || startOfDay(until) !== null)
  const create = useMutation({
    mutationFn: () => agentBankApi.createPot(agent.id, { name: name.trim(), kind, target_ulxc: targetMicros ?? 0, locked_until: startOfDay(until) }),
    onSuccess: () => {
      setName('')
      setTarget('')
      setUntil('')
    },
    onSettled: () => qc.invalidateQueries({ queryKey: potsKey(agent.id) }),
  })
  const pots = list.data?.pots ?? []
  return (
    <div className="grid gap-3">
      <p>
        Credits {agent.name} sets aside for a goal, a budget or a reserve. They stay {agent.name}’s, but neither it nor the
        workspace can spend them until they are moved back out, and a locked pot keeps them until its date. Pots earn no
        interest.
      </p>
      {list.isError ? (
        <p>{readFailure(list.error, 'The pots')}</p>
      ) : list.isPending ? (
        <p>Reading…</p>
      ) : pots.length === 0 ? (
        <p>{agent.name} has no pots yet.</p>
      ) : (
        <div>
          {pots.map((p) => (
            <PotRow key={p.id} agent={agent} pot={p} />
          ))}
        </div>
      )}
      <PanelForm className="border-t border-line pt-3" onSubmit={() => (ready && !create.isPending ? create.mutate() : undefined)}>
        <Field label="New pot’s name">
          <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Tabs label="What the pot is for" tabs={POT_WORDS} value={kindWord} onChange={setKindWord} />
        <div className="grid gap-3 wide:grid-cols-2">
          <Field label="Target in LXC (optional)">
            <Input inputMode="decimal" placeholder="0" unit="LXC" value={target} onChange={(e) => setTarget(e.target.value)} />
          </Field>
          <Field label="Locked until (optional)">
            <Input type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
          </Field>
        </div>
        <div>
          <Button type="submit" disabled={create.isPending} disabledReason={ready ? undefined : 'Name the pot first'}>
            Create pot
          </Button>
        </div>
        {create.isError ? <Note ok={false}>Not created. {refusalText(create.error)}</Note> : null}
      </PanelForm>
    </div>
  )
}

// ── Escrow ──────────────────────────────────────────────────────────────────────────────────────────

/** Pay credits into escrow for any agent: held until delivery is confirmed or the release date passes. */
export function PayIntoEscrow({ agent }: { agent: Agent }) {
  const qc = useQueryClient()
  const [who, setWho] = useState('')
  const [amount, setAmount] = useState('')
  const [release, setRelease] = useState('')
  const [memo, setMemo] = useState('')
  const micros = parseLXC(amount)
  const releaseAt = startOfDay(release)
  const ready = who.trim() !== '' && micros !== null && releaseAt !== null
  const pay = useMutation({
    mutationFn: () => agentBankApi.payIntoEscrow(agent.id, { to: who.trim(), amount_ulxc: micros ?? 0, release_at: releaseAt ?? '', memo: memo.trim() }),
    onSuccess: () => {
      setAmount('')
      setMemo('')
    },
    onSettled: () => Promise.all([qc.invalidateQueries({ queryKey: ESCROWS_KEY }), qc.invalidateQueries({ queryKey: BOOK_KEY })]),
  })
  return (
    <PanelForm onSubmit={() => (ready && !pay.isPending ? pay.mutate() : undefined)}>
      <WorkspaceLabel capability="escrow" className="justify-self-start" />
      <p>
        The credits leave {agent.name} now and are held, in neither side’s balance, until you confirm the work was
        delivered or the release date passes with no dispute. A dispute holds them until Talyvor decides.
      </p>
      <Field label="Hold for (wallet ID or @handle)">
        <Input placeholder="@handle or wallet ID" value={who} onChange={(e) => setWho(e.target.value)} />
      </Field>
      <div className="grid gap-3 wide:grid-cols-2">
        <Field label="Amount in LXC to hold">
          <Input inputMode="decimal" placeholder="0" unit="LXC" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Release on">
          <Input type="date" value={release} onChange={(e) => setRelease(e.target.value)} />
        </Field>
      </div>
      <Field label="What the escrow is for">
        <Input placeholder="What it is for" value={memo} onChange={(e) => setMemo(e.target.value)} />
      </Field>
      <div>
        <Button type="submit" disabled={pay.isPending} disabledReason={ready ? undefined : 'Type who it is for, the amount and the release date first'}>
          Pay into escrow
        </Button>
      </div>
      {pay.isSuccess ? (
        <Note ok>
          Held <Money ulxc={pay.data.amount_ulxc} /> until <span className="font-figure">{formatWhen(pay.data.release_at)}</span>. It is under Escrow.
        </Note>
      ) : null}
      {pay.isError ? <Note ok={false}>Not paid in. {refusalText(pay.error)}</Note> : null}
    </PanelForm>
  )
}

const ESCROW_STATUS: Record<Escrow['status'], [string, ChipTone]> = {
  held: ['Held', 'wait'],
  disputed: ['Disputed', 'bad'],
  released: ['Released', 'good'],
  returned: ['Returned', 'paused'],
}

function escrowEventText(e: Escrow['events'][number]): string {
  switch (e.kind) {
    case 'held':
      return 'Paid in and held'
    case 'disputed':
      return `Disputed${e.detail ? `: ${e.detail}` : ''}. Held until Talyvor decides`
    case 'released':
      return e.actor === 'payer'
        ? 'Released to the payee: delivery confirmed'
        : e.actor === 'deadline'
          ? 'Released to the payee at the release date'
          : `Released to the payee by Talyvor${e.detail ? `: ${e.detail}` : ''}`
    case 'returned':
      return `Returned to the payer by Talyvor${e.detail ? `: ${e.detail}` : ''}`
  }
}

function EscrowRow({ escrow, agents }: { escrow: Escrow; agents: Agent[] }) {
  const qc = useQueryClient()
  const [reason, setReason] = useState('')
  const nameOf = (id: string) => agents.find((a) => a.id === id)?.name ?? id
  const paying = agents.some((a) => a.id === escrow.payer_agent_id)
  const act = useMutation({
    mutationFn: (action: 'confirm' | 'dispute') =>
      action === 'confirm' ? agentBankApi.confirmEscrow(escrow.id) : agentBankApi.disputeEscrow(escrow.id, reason.trim()),
    onSettled: () => Promise.all([qc.invalidateQueries({ queryKey: ESCROWS_KEY }), qc.invalidateQueries({ queryKey: BOOK_KEY })]),
  })
  const [label, tone] = ESCROW_STATUS[escrow.status]
  return (
    <div className="grid gap-1.5 border-t border-line py-3 first:border-t-0" data-testid="escrow">
      <p className="flex flex-wrap items-center gap-2 font-semibold text-ink">
        {paying
          ? `${nameOf(escrow.payer_agent_id)} holds for ${nameOf(escrow.payee_agent_id)}`
          : `${nameOf(escrow.payee_agent_id)} is owed by ${escrow.payer_agent_id}`}{' '}
        <Money ulxc={escrow.amount_ulxc} />
        <Chip tone={tone}>{label}</Chip>
      </p>
      <p className="text-body text-ink-3">
        Releases <span className="font-figure">{formatWhen(escrow.release_at)}</span> unless disputed
        {escrow.memo ? ` · ${escrow.memo}` : ''}
      </p>
      {escrow.events.map((e, i) => (
        <p key={i} className="text-body text-ink-2">
          <span className="font-figure text-ink-3">{formatWhen(e.at)}</span> {escrowEventText(e)}
        </p>
      ))}
      {paying && escrow.status === 'held' ? (
        <div className="grid gap-2">
          <div>
            <Button size="sm" disabled={act.isPending} onClick={() => act.mutate('confirm')}>
              Confirm delivered
            </Button>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Why you dispute it" className="min-w-0 flex-1">
              <Input placeholder="Why you dispute it" value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
            <Button size="sm" variant="danger" disabled={act.isPending} disabledReason={reason.trim() ? undefined : 'Say why first'} onClick={() => act.mutate('dispute')}>
              Dispute
            </Button>
          </div>
        </div>
      ) : null}
      {act.isError ? <Note ok={false}>{refusalText(act.error)}</Note> : null}
    </div>
  )
}

/** Every escrow the workspace's agents paid into or are owed from; with `agentId`, only that agent's. */
export function Escrows({ agents, agentId }: { agents: Agent[]; agentId?: string }) {
  const list = useQuery({ queryKey: ESCROWS_KEY, queryFn: agentBankApi.escrows })
  const escrows = (list.data?.escrows ?? []).filter((e) => agentId === undefined || e.payer_agent_id === agentId || e.payee_agent_id === agentId)
  return (
    <div className="grid gap-3">
      <WorkspaceLabel capability="escrow" className="justify-self-start" />
      {list.isError ? (
        <p>{readFailure(list.error, 'The escrows')}</p>
      ) : list.isPending ? (
        <p>Reading…</p>
      ) : escrows.length === 0 ? (
        <p>Nothing in escrow. What others hold for your agents appears here too.</p>
      ) : (
        <div>
          {escrows.map((e) => (
            <EscrowRow key={e.id} escrow={e} agents={agents} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Investing, simulated ────────────────────────────────────────────────────────────────────────────

const ORDER_STATUS: Record<SimOrder['status'], [string, ChipTone]> = {
  open: ['Open', 'wait'],
  filled: ['Filled', 'good'],
  cancelled: ['Cancelled', 'paused'],
  rejected: ['Rejected', 'bad'],
}

function orderText(o: SimOrder): string {
  const what = `${o.side === 'buy' ? 'Buy' : 'Sell'} ${units(o.quantity_micros)} ${o.instrument}`
  const how = o.type === 'market' ? 'at market' : `at ${price(o.limit_price_usd ?? '0')} or better`
  const outcome =
    o.status === 'filled' && o.fill_price_usd
      ? `, filled at ${price(o.fill_price_usd)}${o.fill_rate_date ? ` (${o.fill_rate_date} rate)` : ''}`
      : o.status === 'rejected' && o.reason
        ? `: ${o.reason.replace(/^economy: /, '')}`
        : ''
  return `${what} ${how}${outcome}`
}

const SIDES = ['Buy', 'Sell'] as const
const TYPES = ['At market', 'Limit'] as const

function PortfolioView({ agent, portfolio, instruments }: { agent: Agent; portfolio: Portfolio; instruments: string[] }) {
  const qc = useQueryClient()
  const [instrument, setInstrument] = useState('')
  const [sideWord, setSideWord] = useState<(typeof SIDES)[number]>('Buy')
  const [typeWord, setTypeWord] = useState<(typeof TYPES)[number]>('At market')
  const side: SimOrderInput['side'] = sideWord === 'Buy' ? 'buy' : 'sell'
  const type: SimOrderInput['type'] = typeWord === 'At market' ? 'market' : 'limit'
  const [quantity, setQuantity] = useState('')
  const [limit, setLimit] = useState('')
  const qty = parseLXC(quantity)
  const limitOK = type === 'market' || /^\s*\d+(\.\d{1,8})?\s*$/.test(limit)
  const ready = instrument !== '' && qty !== null && limitOK
  const refresh = () => qc.invalidateQueries({ queryKey: portfoliosKey(agent.id) })
  const place = useMutation({
    mutationFn: () =>
      agentBankApi.placeOrder(agent.id, portfolio.id, {
        instrument,
        side,
        type,
        quantity_micros: qty ?? 0,
        ...(type === 'limit' ? { limit_price_usd: limit.trim() } : {}),
      }),
    onSuccess: () => {
      setQuantity('')
      setLimit('')
    },
    onSettled: refresh,
  })
  const cancel = useMutation({ mutationFn: (oid: string) => agentBankApi.cancelOrder(agent.id, portfolio.id, oid), onSettled: refresh })
  const positions = portfolio.positions ?? []
  const orders = portfolio.orders ?? []
  return (
    <div className="grid gap-2.5 border-t border-line py-3 first:border-t-0" data-testid="portfolio">
      <p className="text-ink">
        <span className="font-semibold">{portfolio.name}</span> worth <span className="font-figure">{formatUSD(portfolio.value_uusd)}</span>:{' '}
        <span className="font-figure">{formatUSD(portfolio.cash_uusd)}</span> cash, started with{' '}
        <span className="font-figure">{formatUSD(portfolio.starting_cash_uusd)}</span>
      </p>
      <p className="text-body text-ink-3">{portfolio.notice}</p>
      {positions.length > 0 ? (
        <div>
          {positions.map((p) => (
            <Row key={p.instrument} title={`${units(p.quantity_micros)} ${p.instrument}`} line={`at ${price(p.price_usd)}`} amount={formatUSD(p.value_uusd)} />
          ))}
        </div>
      ) : null}
      <PanelForm onSubmit={() => (ready && !place.isPending ? place.mutate() : undefined)}>
        <Field label={`Instrument for ${portfolio.name}`}>
          <Select value={instrument} onChange={(e) => setInstrument(e.target.value)}>
            <option value="">Currency…</option>
            {instruments.map((i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex flex-wrap gap-3">
          <Tabs label="Buy or sell" tabs={SIDES} value={sideWord} onChange={setSideWord} />
          <Tabs label="Order type" tabs={TYPES} value={typeWord} onChange={setTypeWord} />
        </div>
        <div className="grid gap-3 wide:grid-cols-2">
          <Field label="Quantity">
            <Input inputMode="decimal" placeholder="quantity" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </Field>
          {type === 'limit' ? (
            <Field label="Limit price in US dollars">
              <Input inputMode="decimal" placeholder="0" unit="$" value={limit} onChange={(e) => setLimit(e.target.value)} />
            </Field>
          ) : null}
        </div>
        <div>
          <Button type="submit" size="sm" disabled={place.isPending} disabledReason={ready ? undefined : 'Choose a currency and type a quantity first'}>
            Place order
          </Button>
        </div>
      </PanelForm>
      {place.isSuccess ? (
        <Note ok={place.data.status !== 'rejected'}>
          {place.data.status === 'filled'
            ? `Filled: ${orderText(place.data)}.`
            : place.data.status === 'open'
              ? 'Open: it fills when the price crosses your limit.'
              : `Rejected: ${orderText(place.data)}.`}
        </Note>
      ) : null}
      {place.isError ? <Note ok={false}>Not placed. {refusalText(place.error)}</Note> : null}
      {orders.length > 0 ? (
        <div>
          {orders.map((o) => (
            <Row
              key={o.id}
              wrap
              title={orderText(o)}
              line={formatWhen(o.created_at)}
              action={
                <>
                  <Chip tone={ORDER_STATUS[o.status][1]}>{ORDER_STATUS[o.status][0]}</Chip>
                  {o.status === 'open' ? (
                    <Button size="sm" variant="secondary" disabled={cancel.isPending} onClick={() => cancel.mutate(o.id)}>
                      Cancel
                    </Button>
                  ) : null}
                </>
              }
            />
          ))}
        </div>
      ) : null}
      {cancel.isError ? <Note ok={false}>Not cancelled. {refusalText(cancel.error)}</Note> : null}
    </div>
  )
}

/** The agent's simulated portfolios: simulated US dollars trading real currencies at real prices. */
export function Portfolios({ agent }: { agent: Agent }) {
  const qc = useQueryClient()
  const list = useQuery({ queryKey: portfoliosKey(agent.id), queryFn: () => agentBankApi.portfolios(agent.id) })
  const quotes = useQuery({ queryKey: QUOTES_KEY, queryFn: agentBankApi.quotes })
  const [name, setName] = useState('')
  const [cash, setCash] = useState('')
  const cashMicros = parseLXC(cash)
  const open = useMutation({
    mutationFn: () => agentBankApi.openPortfolio(agent.id, name.trim(), cashMicros ?? 0),
    onSuccess: () => {
      setName('')
      setCash('')
    },
    onSettled: () => qc.invalidateQueries({ queryKey: portfoliosKey(agent.id) }),
  })
  const portfolios = list.data?.portfolios ?? []
  const instruments = (quotes.data?.quotes ?? []).map((q) => q.instrument)
  return (
    <div className="grid gap-3">
      <WorkspaceLabel capability="invest_and_trade" className="justify-self-start" />
      <p>
        Portfolios of simulated US dollars that buy and sell real currencies at real prices
        {quotes.data?.market_data ? ` (${quotes.data.market_data})` : ''}. No credits move, and no order is ever sent to a
        market.
      </p>
      {list.isError ? (
        <p>{readFailure(list.error, 'The portfolios')}</p>
      ) : list.isPending ? (
        <p>Reading…</p>
      ) : portfolios.length === 0 ? (
        <p>{agent.name} has no portfolio yet.</p>
      ) : (
        <div>
          {portfolios.map((p) => (
            <PortfolioView key={p.id} agent={agent} portfolio={p} instruments={instruments} />
          ))}
        </div>
      )}
      <PanelForm className="border-t border-line pt-3" onSubmit={() => (name.trim() && cashMicros !== null && !open.isPending ? open.mutate() : undefined)}>
        <div className="grid gap-3 wide:grid-cols-2">
          <Field label="New portfolio’s name">
            <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Starting simulated US dollars">
            <Input inputMode="decimal" placeholder="0" unit="$" value={cash} onChange={(e) => setCash(e.target.value)} />
          </Field>
        </div>
        <div>
          <Button type="submit" disabled={open.isPending} disabledReason={name.trim() && cashMicros !== null ? undefined : 'Name it and type its starting dollars first'}>
            Open portfolio
          </Button>
        </div>
        {open.isError ? <Note ok={false}>Not opened. {refusalText(open.error)}</Note> : null}
      </PanelForm>
    </div>
  )
}

// ── Cash-out ────────────────────────────────────────────────────────────────────────────────────────

/** Ask to turn the agent's credits back into money, paid through Talyvor's payments partner. */
export function CashOutCard({ agent }: { agent: Agent }) {
  const qc = useQueryClient()
  const [amount, setAmount] = useState('')
  const [destination, setDestination] = useState('')
  const micros = parseLXC(amount)
  const ready = micros !== null && destination.trim() !== ''
  const ask = useMutation({
    mutationFn: () => agentBankApi.requestCashOut(agent.id, micros ?? 0, destination.trim()),
    onSuccess: () => setAmount(''),
    onSettled: () => Promise.all([qc.invalidateQueries({ queryKey: CASH_OUTS_KEY }), qc.invalidateQueries({ queryKey: BOOK_KEY })]),
  })
  return (
    <PanelForm onSubmit={() => (ready && !ask.isPending ? ask.mutate() : undefined)}>
      <WorkspaceLabel capability="cash_out" className="justify-self-start" />
      <p>
        Turn {agent.name}’s credits back into money, paid to the account you name. The credits are held while Talyvor’s
        payments partner pays it, and come back if the payment fails. Only the workspace’s owner can ask.
      </p>
      <div className="grid gap-3 wide:grid-cols-2">
        <Field label="Amount in LXC to cash out">
          <Input inputMode="decimal" placeholder="0" unit="LXC" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Pay to (a name for the account)">
          <Input placeholder="Pay to" value={destination} onChange={(e) => setDestination(e.target.value)} />
        </Field>
      </div>
      <div>
        <Button type="submit" disabled={ask.isPending} disabledReason={ready ? undefined : 'Type the amount and who to pay first'}>
          Ask to cash out
        </Button>
      </div>
      {ask.isSuccess ? (
        <Note ok>
          Asked: <Money ulxc={ask.data.amount_ulxc} /> is held and is under Cash-outs until it is paid.
        </Note>
      ) : null}
      {ask.isError ? <Note ok={false}>Not cashed out. {refusalText(ask.error)}</Note> : null}
    </PanelForm>
  )
}

const CASH_OUT_STATUS: Record<CashOut['status'], [string, ChipTone]> = {
  held: ['Held', 'wait'],
  submitted: ['With the partner', 'wait'],
  paid: ['Paid', 'good'],
  failed: ['Failed, credits back', 'bad'],
}

/** Every cash-out the workspace asked for, and where it stands; with `agentId`, only that agent's. */
export function CashOuts({ agents, agentId }: { agents: Agent[]; agentId?: string }) {
  const list = useQuery({ queryKey: CASH_OUTS_KEY, queryFn: agentBankApi.cashOuts })
  const nameOf = (id: string) => agents.find((a) => a.id === id)?.name ?? id
  const cashOuts = (list.data?.cash_outs ?? []).filter((c) => agentId === undefined || c.agent_id === agentId)
  return (
    <div className="grid gap-3">
      {list.isError ? (
        <p>{readFailure(list.error, 'The cash-outs')}</p>
      ) : list.isPending ? (
        <p>Reading…</p>
      ) : cashOuts.length === 0 ? (
        <p>{agentId === undefined ? 'No cash-outs yet. Open an agent to ask for one.' : 'No cash-outs yet. Ask for one above.'}</p>
      ) : (
        <div>
          {cashOuts.map((c) => (
            <Row
              key={c.id}
              wrap
              title={`${nameOf(c.agent_id)} to ${c.destination}`}
              line={`${formatWhen(c.created_at)}${c.detail ? ` · ${c.detail}` : ''}`}
              amount={
                <span data-testid="cash-out">
                  <Money ulxc={c.amount_ulxc} /> = <span className="font-figure">{formatUSD(c.amount_uusd)}</span>
                </span>
              }
              action={<Chip tone={CASH_OUT_STATUS[c.status][1]}>{CASH_OUT_STATUS[c.status][0]}</Chip>}
            />
          ))}
        </div>
      )}
    </div>
  )
}
