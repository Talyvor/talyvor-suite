import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Chip, Field, Input, Money, Row, Tabs, type ChipTone } from '@talyvor/ui/pocket'
import { isSessionExpired } from '../../lib/productState'
import { formatWhen } from './format'
import { useLxcText } from './money'
import {
  type Agent,
  type AgentTransfer,
  type Loan,
  type LoanOffer,
  agentBankApi,
  parseLXC,
  refusalText,
} from './agentBankApi'
import { WorkspaceLabel } from '../../labels/workspace'
import { BETWEEN_OWNERS_PAY } from '../../labels/capabilities'

// WalletMoney.tsx — B22.10: Agent Wallets' money between owners. An agent's address (its wallet ID and a
// handle), sending credits to any agent on Talyvor and asking one for them (Lens B22.3), the requests the
// workspace's agents made and were made, paying another owner's agent every day, week or month, the
// company's credit line (B22.4), and loans between companies — offered, accepted, their instalments,
// late and default (B22.5).
//
// B57.21 — each is a panel in Pocket's fields, rows, chips and <Money>, opened from a row of the Money section on the
// agent's page (AgentMoney.tsx); the panel's dialog carries its title. Lens decides; the screen shows Lens's figures
// and, on a refusal, Lens's own sentence.

export const CAPABILITIES_KEY = ['wallet-capabilities']
export const REQUESTS_KEY = ['wallet-requests']
export const LOANS_KEY = ['wallet-loans']
export const CREDIT_KEY = ['wallet-credit-line']
const BOOK_KEY = ['agent-book']
export const transfersKey = (id: string) => ['agent-transfers', id]

export function Note({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <p role={ok ? 'status' : 'alert'} className="text-caption text-ink">
      {children}
    </p>
  )
}

export function readFailure(err: unknown, what: string): string {
  return isSessionExpired(err) ? `${what} can’t be read until you sign in again.` : `${what} could not be read just now.`
}

/** A panel's form: its fields one under the other, the press at the end. */
export function PanelForm({ onSubmit, children, className = '' }: { onSubmit: () => void; children: React.ReactNode; className?: string }) {
  return (
    <form
      className={`grid gap-3 ${className}`}
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit()
      }}
    >
      {children}
    </form>
  )
}

/** Why a send's press waits: who it goes to, then how much. */
export function whoOrAmount(who: string, micros: number | null): string | undefined {
  if (!who.trim()) return 'Type a wallet ID or @handle first'
  return micros === null ? 'Type an amount in LXC first' : undefined
}

const PERIODS = ['Every day', 'Every week', 'Every month'] as const
type Period = (typeof PERIODS)[number]
const periodOf = (p: Period) => (p === 'Every day' ? 'day' : p === 'Every week' ? 'week' : 'month')

/** The agent's address: its wallet ID, and a handle others can send to. */
export function AgentAddress({ agent }: { agent: Agent }) {
  const qc = useQueryClient()
  const [handle, setHandle] = useState(agent.handle ?? '')
  const save = useMutation({
    mutationFn: () => agentBankApi.setHandle(agent.id, handle.trim().replace(/^@/, '')),
    onSettled: () => qc.invalidateQueries({ queryKey: BOOK_KEY }),
  })
  return (
    <PanelForm onSubmit={() => (handle.trim() && !save.isPending ? save.mutate() : undefined)}>
      <p className="text-reading text-ink" data-testid="agent-address">
        Anyone on Talyvor can send {agent.name} credits at wallet ID <span className="font-figure">{agent.id}</span>
        {agent.handle ? (
          <>
            {' '}
            or <span className="font-figure">@{agent.handle}</span>
          </>
        ) : null}
        .
      </p>
      <Field label={`Handle for ${agent.name}`}>
        <Input placeholder="handle" unit="@" value={handle} onChange={(e) => setHandle(e.target.value)} />
      </Field>
      <div>
        <Button type="submit" disabled={save.isPending} disabledReason={handle.trim() ? undefined : 'Type a handle first'}>
          {agent.handle ? 'Change handle' : 'Set handle'}
        </Button>
      </div>
      {save.isSuccess ? <Note ok>{agent.name} is now @{save.data.handle}.</Note> : null}
      {save.isError ? <Note ok={false}>{refusalText(save.error)}</Note> : null}
    </PanelForm>
  )
}

/** Send credits to any agent on Talyvor, or ask one for them. */
export function SendAndRequest({ agent }: { agent: Agent }) {
  const qc = useQueryClient()
  const [mode, setMode] = useState<'Send' | 'Request'>('Send')
  const [who, setWho] = useState('')
  const [amount, setAmount] = useState('')
  const [memo, setMemo] = useState('')
  const micros = parseLXC(amount)
  const move = useMutation({
    mutationFn: async () => {
      const address = who.trim()
      if (mode === 'Send') return { kind: 'sent' as const, t: await agentBankApi.send(agent.id, address, micros ?? 0, memo.trim()) }
      await agentBankApi.request(agent.id, address, micros ?? 0, memo.trim())
      return { kind: 'asked' as const, t: null }
    },
    onSuccess: () => {
      setAmount('')
      setMemo('')
    },
    onSettled: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: BOOK_KEY }),
        qc.invalidateQueries({ queryKey: REQUESTS_KEY }),
        qc.invalidateQueries({ queryKey: transfersKey(agent.id) }),
      ]),
  })
  const sent = move.data?.t ?? null
  const verb = mode === 'Send' ? 'send' : 'request'
  return (
    <PanelForm onSubmit={() => (who.trim() && micros !== null && !move.isPending ? move.mutate() : undefined)}>
      <WorkspaceLabel capability={BETWEEN_OWNERS_PAY} className="justify-self-start" />
      <p>
        To or from any agent on Talyvor, by its wallet ID or @handle. Credits stay credits: the other side can spend them
        only on Talyvor. Sending is judged by {agent.name}’s rules.
      </p>
      <Tabs label="Send or request" tabs={['Send', 'Request'] as const} value={mode} onChange={setMode} />
      <Field label={mode === 'Send' ? 'Send to (wallet ID or @handle)' : 'Request from (wallet ID or @handle)'}>
        <Input placeholder="@handle or wallet ID" value={who} onChange={(e) => setWho(e.target.value)} />
      </Field>
      <Field label={`Amount in LXC to ${verb}`}>
        <Input inputMode="decimal" placeholder="0" unit="LXC" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Field>
      <Field label="What it is for">
        <Input placeholder="What it is for" value={memo} onChange={(e) => setMemo(e.target.value)} />
      </Field>
      <div>
        <Button type="submit" disabled={move.isPending} disabledReason={whoOrAmount(who, micros)}>
          {mode === 'Send' ? 'Send credits' : 'Ask for credits'}
        </Button>
      </div>
      {move.isSuccess && sent ? (
        <Note ok>
          Sent <Money ulxc={sent.amount_ulxc} />. {sent.class === 'AMBER' ? 'It went to another owner’s agent.' : 'It stayed with one owner.'}
        </Note>
      ) : null}
      {move.isSuccess && !sent ? <Note ok>Asked. They see the request and can accept or decline it.</Note> : null}
      {move.isError ? <Note ok={false}>Refused. {refusalText(move.error)}</Note> : null}
    </PanelForm>
  )
}

/** Pay another owner's agent every day, week or month: a schedule whose payee is any agent (Lens B22.3). */
export function RecurringTransfer({ agent }: { agent: Agent }) {
  const qc = useQueryClient()
  const [who, setWho] = useState('')
  const [amount, setAmount] = useState('')
  const [every, setEvery] = useState<Period>('Every month')
  const [memo, setMemo] = useState('')
  const micros = parseLXC(amount)
  const start = useMutation({
    mutationFn: async () => {
      const to = await agentBankApi.address(who.trim())
      return agentBankApi.schedule(agent.id, { to_agent_id: to.wallet_id, to_listing_id: '', amount_ulxc: micros ?? 0, memo: memo.trim(), every: periodOf(every) })
    },
    onSuccess: () => {
      setAmount('')
      setMemo('')
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['agent-schedules'] }),
  })
  return (
    <PanelForm onSubmit={() => (who.trim() && micros !== null && !start.isPending ? start.mutate() : undefined)}>
      <WorkspaceLabel capability={BETWEEN_OWNERS_PAY} className="justify-self-start" />
      <p>Pay any agent on Talyvor the same amount every day, week or month.</p>
      <Field label="Pay every period to (wallet ID or @handle)">
        <Input placeholder="@handle or wallet ID" value={who} onChange={(e) => setWho(e.target.value)} />
      </Field>
      <Field label="Recurring amount in LXC">
        <Input inputMode="decimal" placeholder="0" unit="LXC" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Field>
      <Tabs label="How often" tabs={PERIODS} value={every} onChange={setEvery} />
      <Field label="What the recurring transfer is for">
        <Input placeholder="What it is for" value={memo} onChange={(e) => setMemo(e.target.value)} />
      </Field>
      <div>
        <Button type="submit" disabled={start.isPending} disabledReason={whoOrAmount(who, micros)}>
          Start
        </Button>
      </div>
      {start.isSuccess ? (
        <Note ok>
          <Money ulxc={start.data.amount_ulxc} /> every {start.data.every}, first on{' '}
          <span className="font-figure">{formatWhen(start.data.next_run_at)}</span>. It is listed under Scheduled payments.
        </Note>
      ) : null}
      {start.isError ? <Note ok={false}>Not started. {refusalText(start.error)}</Note> : null}
    </PanelForm>
  )
}

function transferText(t: AgentTransfer, agentID: string): string {
  const out = t.from_agent_id === agentID
  const verb = t.refund_of ? (out ? 'Gave back' : 'Given back') : out ? 'Sent' : 'Received'
  const other = out ? t.to_agent_id : t.from_agent_id
  return `${verb} ${out ? 'to' : 'from'} ${other}${t.memo ? ` · ${t.memo}` : ''}`
}

/**
 * What the agent sent to and received from other agents. B28.23: a transfer it received and Lens says it may
 * still give back has "Give back", asked twice; Lens moves the same amount back to the sender as one refund.
 */
export function AgentTransfers({ agent }: { agent: Agent }) {
  const qc = useQueryClient()
  const list = useQuery({ queryKey: transfersKey(agent.id), queryFn: () => agentBankApi.transfers(agent.id) })
  const [asking, setAsking] = useState<string | null>(null)
  const giveBack = useMutation({
    mutationFn: (t: AgentTransfer) => agentBankApi.refundTransfer(t.id),
    onSettled: () => {
      setAsking(null)
      return Promise.all([
        qc.invalidateQueries({ queryKey: transfersKey(agent.id) }),
        qc.invalidateQueries({ queryKey: BOOK_KEY }),
        qc.invalidateQueries({ queryKey: ['agent-statement'] }),
      ])
    },
  })
  const transfers = list.data?.transfers ?? []
  return (
    <div className="grid gap-3">
      <WorkspaceLabel capability={BETWEEN_OWNERS_PAY} className="justify-self-start" />
      {list.isError ? (
        <p>{readFailure(list.error, 'The transfers')}</p>
      ) : list.isPending ? (
        <p>Reading…</p>
      ) : transfers.length === 0 ? (
        <p>{agent.name} has not sent or received a transfer yet.</p>
      ) : (
        <div>
          {transfers.map((t) => (
            <Row
              key={t.id}
              wrap
              title={transferText(t, agent.id)}
              line={formatWhen(t.created_at)}
              amount={<Money ulxc={t.from_agent_id === agent.id ? -t.amount_ulxc : t.amount_ulxc} signed />}
              action={
                <>
                  {t.refunded_by ? <Chip tone="good">Given back</Chip> : null}
                  {!t.refundable ? null : asking === t.id ? (
                    <>
                      <Button size="sm" disabled={giveBack.isPending} onClick={() => giveBack.mutate(t)}>
                        Yes, give it back
                      </Button>
                      <Button size="sm" variant="secondary" disabled={giveBack.isPending} onClick={() => setAsking(null)}>
                        Keep it
                      </Button>
                    </>
                  ) : (
                    <Button size="sm" variant="secondary" disabled={giveBack.isPending} onClick={() => setAsking(t.id)}>
                      Give back
                    </Button>
                  )}
                </>
              }
            />
          ))}
        </div>
      )}
      {giveBack.isSuccess ? (
        <Note ok>
          Gave <Money ulxc={giveBack.data.amount_ulxc} /> back to {giveBack.data.to_agent_id}.
        </Note>
      ) : giveBack.isError ? (
        <Note ok={false}>Not given back. {refusalText(giveBack.error)}</Note>
      ) : null}
    </div>
  )
}

/**
 * The requests the workspace's agents were asked and made; an incoming one is accepted or declined here. With
 * `agentId`, only the ones that agent asked or was asked.
 */
export function MoneyRequests({ agents, agentId }: { agents: Agent[]; agentId?: string }) {
  const qc = useQueryClient()
  const list = useQuery({ queryKey: REQUESTS_KEY, queryFn: agentBankApi.moneyRequests })
  const answer = useMutation({
    mutationFn: ({ id, accept }: { id: string; accept: boolean }) => agentBankApi.answerRequest(id, accept),
    onSettled: () => Promise.all([qc.invalidateQueries({ queryKey: REQUESTS_KEY }), qc.invalidateQueries({ queryKey: BOOK_KEY })]),
  })
  const mine = new Set(agents.map((a) => a.id))
  const nameOf = (id: string) => agents.find((a) => a.id === id)?.name ?? id
  const requests = (list.data?.requests ?? []).filter((r) => agentId === undefined || r.from_agent_id === agentId || r.to_agent_id === agentId)
  return (
    <div className="grid gap-3">
      <WorkspaceLabel capability={BETWEEN_OWNERS_PAY} className="justify-self-start" />
      {list.isError ? (
        <p>{readFailure(list.error, 'The requests')}</p>
      ) : list.isPending ? (
        <p>Reading…</p>
      ) : requests.length === 0 ? (
        <p>
          No requests yet. Ask any agent for credits from Send or request; what others ask of your agents appears here to
          accept or decline.
        </p>
      ) : (
        <div>
          {requests.map((r) => {
            const incoming = mine.has(r.to_agent_id)
            return (
              <Row
                key={r.id}
                wrap
                title={incoming ? `${nameOf(r.from_agent_id)} asks ${nameOf(r.to_agent_id)}` : `${nameOf(r.from_agent_id)} asked ${nameOf(r.to_agent_id)}`}
                line={`${r.memo ? `${r.memo} · ` : ''}${formatWhen(r.created_at)}`}
                amount={<Money ulxc={r.amount_ulxc} />}
                action={
                  r.status !== 'pending' ? (
                    <Chip tone={r.status === 'accepted' ? 'good' : 'bad'}>{r.status === 'accepted' ? 'Accepted' : 'Declined'}</Chip>
                  ) : incoming ? (
                    <>
                      <Button size="sm" disabled={answer.isPending} onClick={() => answer.mutate({ id: r.id, accept: true })}>
                        Accept
                      </Button>
                      <Button size="sm" variant="secondary" disabled={answer.isPending} onClick={() => answer.mutate({ id: r.id, accept: false })}>
                        Decline
                      </Button>
                    </>
                  ) : (
                    <Chip tone="wait">Waiting</Chip>
                  )
                }
              />
            )
          })}
        </div>
      )}
      {answer.isError ? <Note ok={false}>Not paid. {refusalText(answer.error)}</Note> : null}
    </div>
  )
}

/** The company's credit line: what it may use, what it has used, and its monthly invoices. */
export function CreditLinePanel() {
  const line = useQuery({ queryKey: CREDIT_KEY, queryFn: agentBankApi.creditLine })
  return (
    <div className="grid gap-3">
      <WorkspaceLabel capability="company_credit_line" className="justify-self-start" />
      {line.isError ? (
        <p>{readFailure(line.error, 'The credit line')}</p>
      ) : line.isSuccess && line.data === null ? (
        <p data-testid="no-credit-line">
          This workspace has no credit line. Talyvor can give a company one: its agents then spend past zero, up to the
          limit, and the company pays what they used once a month.
        </p>
      ) : line.data ? (
        <>
          <p className="text-ink" data-testid="credit-line">
            Your agents may spend up to <Money ulxc={line.data.limit_ulxc} /> past zero. They have used <Money ulxc={line.data.used_ulxc} />, and{' '}
            <Money ulxc={line.data.available_ulxc} /> is left.
          </p>
          {line.data.paused ? (
            <Note ok={false}>The credit line is paused{line.data.paused_reason ? `: ${line.data.paused_reason}` : ''}.</Note>
          ) : null}
          {line.data.invoices.length > 0 ? (
            <div>
              {line.data.invoices.map((i) => (
                <Row
                  key={i.id}
                  wrap
                  title={`Invoice for use before ${formatWhen(i.period_end)}`}
                  line={`Due ${formatWhen(i.due_at)}`}
                  amount={<Money minor={i.amount_cents} currency="USD" />}
                  action={<Chip tone={i.paid_at ? 'good' : i.late ? 'bad' : 'wait'}>{i.paid_at ? 'Paid' : i.late ? 'Late' : 'Open'}</Chip>}
                />
              ))}
            </div>
          ) : null}
        </>
      ) : (
        <p>Reading…</p>
      )}
    </div>
  )
}

const LOAN_STATUS: Record<Loan['status'], [string, ChipTone]> = {
  offered: ['Offered', 'wait'],
  declined: ['Declined', 'paused'],
  withdrawn: ['Withdrawn', 'paused'],
  active: ['Repaying', 'wait'],
  late: ['Late', 'bad'],
  defaulted: ['In default', 'bad'],
  repaid: ['Repaid', 'good'],
}

function eventText(e: Loan['events'][number], l: Loan, lxc: (ulxc: number) => string): string {
  switch (e.kind) {
    case 'payout':
      return 'Paid out to the borrower'
    case 'instalment':
      return `Instalment ${e.instalment} of ${l.instalments} repaid: ${lxc(e.principal_ulxc ?? 0)} + ${lxc(e.interest_ulxc ?? 0)} interest${
        e.late_fee_ulxc ? ` + ${lxc(e.late_fee_ulxc)} late fee` : ''
      }`
    case 'missed':
      return `Instalment ${e.instalment} missed${e.detail ? `: ${e.detail.replace(/^economy: /, '')}` : ''}`
    case 'late':
      return 'The loan is late; the instalment is tried again one period on, with the late fee'
    case 'defaulted':
      return 'Missed again: the loan is in default'
  }
}

/** One loan, as either side sees it. */
function LoanRow({ loan, agents }: { loan: Loan; agents: Agent[] }) {
  const qc = useQueryClient()
  const lxc = useLxcText()
  const mine = new Set(agents.map((a) => a.id))
  const lending = mine.has(loan.lender_agent_id)
  const act = useMutation({
    mutationFn: (action: 'accept' | 'decline' | 'withdraw') =>
      action === 'accept'
        ? agentBankApi.acceptLoan(loan.id)
        : action === 'decline'
          ? agentBankApi.declineLoan(loan.id)
          : agentBankApi.withdrawLoan(loan.id),
    onSettled: () => Promise.all([qc.invalidateQueries({ queryKey: LOANS_KEY }), qc.invalidateQueries({ queryKey: BOOK_KEY })]),
  })
  const [label, tone] = LOAN_STATUS[loan.status]
  const nameOf = (id: string) => agents.find((a) => a.id === id)?.name ?? id
  return (
    <div className="grid gap-1.5 border-t border-line py-3 first:border-t-0" data-testid="loan">
      <p className="flex flex-wrap items-center gap-2 font-semibold text-ink">
        {lending ? `${nameOf(loan.lender_agent_id)} lends ${loan.borrower_agent_id}` : `${nameOf(loan.borrower_agent_id)} borrows from ${loan.lender_agent_id}`}{' '}
        {lxc(loan.principal_ulxc)} at {loan.interest_bps / 100}% over {loan.instalments} {loan.every === 'day' ? 'daily' : `${loan.every}ly`}{' '}
        instalments
        <Chip tone={tone}>{label}</Chip>
      </p>
      <p className="text-body text-ink-3">
        <span className="font-figure">
          {loan.paid_instalments} of {loan.instalments}
        </span>{' '}
        repaid
        {loan.next_due_at ? (
          <>
            {' '}
            · next due <span className="font-figure">{formatWhen(loan.next_due_at)}</span>
          </>
        ) : null}
        {loan.late_fee_ulxc ? <> · late fee {lxc(loan.late_fee_ulxc)}</> : null}
        {loan.memo ? ` · ${loan.memo}` : ''}
      </p>
      {loan.events.map((e, i) => (
        <p key={i} className="text-body text-ink-2">
          <span className="font-figure text-ink-3">{formatWhen(e.at)}</span> {eventText(e, loan, lxc)}
        </p>
      ))}
      {loan.status === 'offered' ? (
        <div className="flex flex-wrap gap-2">
          {lending ? (
            <Button size="sm" variant="secondary" disabled={act.isPending} onClick={() => act.mutate('withdraw')}>
              Withdraw the offer
            </Button>
          ) : (
            <>
              <Button size="sm" disabled={act.isPending} onClick={() => act.mutate('accept')}>
                Accept the loan
              </Button>
              <Button size="sm" variant="secondary" disabled={act.isPending} onClick={() => act.mutate('decline')}>
                Decline
              </Button>
            </>
          )}
        </div>
      ) : null}
      {act.isError ? <Note ok={false}>{refusalText(act.error)}</Note> : null}
    </div>
  )
}

/** The loans the workspace lends and borrows; with `agentId`, only the ones that agent lends or borrows. */
export function Loans({ agents, agentId }: { agents: Agent[]; agentId?: string }) {
  const list = useQuery({ queryKey: LOANS_KEY, queryFn: agentBankApi.loans })
  const loans = (list.data?.loans ?? []).filter((l) => agentId === undefined || l.lender_agent_id === agentId || l.borrower_agent_id === agentId)
  return (
    <div className="grid gap-3">
      <WorkspaceLabel capability="loans_between_companies" className="justify-self-start" />
      {list.isError ? (
        <p>{readFailure(list.error, 'The loans')}</p>
      ) : list.isPending ? (
        <p>Reading…</p>
      ) : loans.length === 0 ? (
        <p>No loans yet. Offer one to another company’s agent; a loan offered to yours appears here when it is made.</p>
      ) : (
        <div>
          {loans.map((l) => (
            <LoanRow key={l.id} loan={l} agents={agents} />
          ))}
        </div>
      )}
    </div>
  )
}

/** Offer a loan from this agent to another company's agent. */
export function OfferLoan({ agent }: { agent: Agent }) {
  const qc = useQueryClient()
  const [to, setTo] = useState('')
  const [principal, setPrincipal] = useState('')
  const [rate, setRate] = useState('')
  const [instalments, setInstalments] = useState('3')
  const [every, setEvery] = useState<Period>('Every month')
  const [fee, setFee] = useState('')
  const [memo, setMemo] = useState('')
  const micros = parseLXC(principal)
  const pct = /^\s*\d+(\.\d{1,2})?\s*$/.test(rate) ? Math.round(Number(rate) * 100) : null
  const n = /^\s*\d+\s*$/.test(instalments) ? Number(instalments) : null
  const lateFee = fee.trim() === '' ? 0 : parseLXC(fee)
  const ready = to.trim() !== '' && micros !== null && pct !== null && n !== null && n >= 1 && lateFee !== null
  const offer = useMutation({
    mutationFn: () =>
      agentBankApi.offerLoan(agent.id, {
        to: to.trim(),
        principal_ulxc: micros ?? 0,
        interest_bps: pct ?? 0,
        instalments: n ?? 0,
        every: periodOf(every) as LoanOffer['every'],
        late_fee_ulxc: lateFee ?? 0,
        memo: memo.trim(),
      }),
    onSettled: () => qc.invalidateQueries({ queryKey: LOANS_KEY }),
  })
  return (
    <PanelForm onSubmit={() => (ready && !offer.isPending ? offer.mutate() : undefined)}>
      <WorkspaceLabel capability="loans_between_companies" className="justify-self-start" />
      <p>
        To another company’s agent. The borrower repays in equal instalments with the interest; a missed one makes the loan
        late, and missed again it is in default. Both companies see every instalment.
      </p>
      <Field label="Lend to (wallet ID or @handle)">
        <Input placeholder="@handle or wallet ID" value={to} onChange={(e) => setTo(e.target.value)} />
      </Field>
      <div className="grid gap-3 wide:grid-cols-2">
        <Field label="Loan amount in LXC">
          <Input inputMode="decimal" placeholder="0" unit="LXC" value={principal} onChange={(e) => setPrincipal(e.target.value)} />
        </Field>
        <Field label="Interest over the whole loan, in percent">
          <Input inputMode="decimal" placeholder="0" unit="%" value={rate} onChange={(e) => setRate(e.target.value)} />
        </Field>
        <Field label="Number of instalments">
          <Input inputMode="numeric" value={instalments} onChange={(e) => setInstalments(e.target.value)} />
        </Field>
        <Field label="Late fee in LXC">
          <Input inputMode="decimal" placeholder="0" unit="LXC" value={fee} onChange={(e) => setFee(e.target.value)} />
        </Field>
      </div>
      <Tabs label="Instalments every" tabs={PERIODS} value={every} onChange={setEvery} />
      <Field label="What the loan is for">
        <Input placeholder="What it is for" value={memo} onChange={(e) => setMemo(e.target.value)} />
      </Field>
      <div>
        <Button type="submit" disabled={offer.isPending} disabledReason={ready ? undefined : 'Type who it lends to, the amount, the interest and the instalments first'}>
          Offer
        </Button>
      </div>
      {offer.isSuccess ? <Note ok>Offered. It is under Loans until the borrower accepts or declines.</Note> : null}
      {offer.isError ? <Note ok={false}>Not offered. {refusalText(offer.error)}</Note> : null}
    </PanelForm>
  )
}
