import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { type UseQueryResult, useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, CardHeader, Input, Pill, cn, focusRing, inlineLink, type PillStatus } from '@talyvor/ui'
import {
  Button as PocketButton,
  Card as PocketCard,
  Chip,
  Dialog,
  EmptyState,
  Field,
  Icon,
  Input as PocketInput,
  RoomBadge,
  Row as PocketRow,
  Select as PocketSelect,
  pocketFocusRing,
  type ChipTone,
  type IconName,
} from '@talyvor/ui/pocket'
import { Card } from './walletBrand'
import { Region, RegionScreen } from '../../components/Region'
import { LinkedItem } from '../../components/LinkedItem'
import { formatDecided, formatWhen } from './format'
import { Note, readFailure } from './WalletMoney'
import { APPROVALS_KEY, BOOK_KEY, OnThePhone, PREPARED_KEY, preparedBy, useKeys } from './AgentBank'
import { MONEY_ACCOUNTS_KEY } from './Invoices'
import { paymentRequestKey } from './Approve'
import { assertOver, payOutsideSigned, signApproval, signPayee, signPayeeCalled, signPayeeDetails } from './passkeys'
import {
  type AgentApproval,
  type AssistantRequest,
  type Bill,
  type AgentSchedule,
  type CurrencyAccount,
  type Mandate,
  type MandateTerms,
  type OutsidePayee,
  type PayeeDetails,
  type OutsidePayment,
  type PayeeRequest,
  type PaymentRequest,
  type PayoutBatch,
  FIATS,
  agentBankApi,
  formatMinor,
  minorOf,
  newMoveKey,
  refusalText,
  useAccount,
} from './agentBankApi'
import { Lxc } from './money'
import { WorkspaceLabel } from '../../labels/workspace'
import { PAY_OUT } from '../../labels/capabilities'
import { DESIGN_ATTR } from '../../pocketPending'

// Pay.tsx — B30.96: money out of an account. Saved payees outside Talyvor, each checked against its account by the account
// partner (Lens B30.16); a payment to one, from the company's or an agent's account (B30.17), with an agent's requests that
// wait for a person's approval shown here; standing orders (B30.18); mandates a payee pulls within (B30.19); and bulk
// payouts from a CSV, validated row by row and paid on one approval (B30.21). Lens decides everything — which account may
// pay, the agent's rules, screening, what posts — and a refusal shows its sentence. Every amount is Lens's minor units.
// B59.10 — by the workspace's type and kind (account.ts): a Stablecoin and crypto account has no bank transfers, so none of
// the above is rendered for it; payout batches are a Business's; a Personal account reads "your account", not the company's.
// B57.31 — the top of Pay is the Pocket reference's w-pay: Pay a saved payee, Payments out, Saved payees (pressing one pays
// it) and Add a payee's dialog; standing orders, mandates, bulk payouts and bills stay below in today's cards until B57.32.

export const PAYEES_KEY = ['money-payees']
export const PAYMENTS_KEY = ['money-payments']
export const MANDATES_KEY = ['money-mandates']
export const PAYOUTS_KEY = ['money-payouts']
export const SCHEDULES_KEY = ['agent-schedules']
export const ASSISTANT_REQUESTS_KEY = ['money-assistant-requests']
export const BILLS_KEY = ['money-bills']
const EVERY: AgentSchedule['every'][] = ['hour', 'day', 'week', 'month']

// B57.31 — a payment Lens's account partner failed is one it refused; the row says why beside it.
const PAYMENT_STATUS: Record<string, { text: string; tone: ChipTone }> = {
  pending: { text: 'Pending', tone: 'wait' },
  sent: { text: 'Sent', tone: 'wait' },
  completed: { text: 'Completed', tone: 'good' },
  failed: { text: 'Refused', tone: 'bad' },
  returned: { text: 'Returned', tone: 'bad' },
}
// B55.41 — a status Lens adds later is never shown as Lens's own word.
const paymentStatus = (s: string) => PAYMENT_STATUS[s] ?? { text: 'We could not read this payment’s status', tone: 'wait' as ChipTone }
const CHECK: Record<string, { text: string; tone: ChipTone }> = {
  exact_match: { text: 'Exact match', tone: 'good' },
  close_match: { text: 'Close match', tone: 'wait' },
  no_match: { text: 'No match', tone: 'bad' },
}

const select = `h-8 rounded-control border border-rule bg-surface px-2 text-body text-ink transition-colors duration-200 hover:border-rule-strong ${focusRing}`
const field = 'flex flex-col gap-1 text-caption text-muted'

/** A date typed in the form, at nine in the morning UTC, as Lens wants a time. */
const morningOf = (date: string) => `${date}T09:00:00Z`
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)

/** The payee's account details, as it gave them. */
function detailsOf(p: PayeeRequest): string {
  if (p.iban) return `${p.iban}${p.bic ? ` · ${p.bic}` : ''}`
  if (p.routing_number) return `${p.routing_number} · ${p.account_number ?? ''}`
  return `${p.sort_code ?? ''} · ${p.account_number ?? ''}`
}

export function PayScreen() {
  const accounts = useQuery({ queryKey: MONEY_ACCOUNTS_KEY, queryFn: agentBankApi.moneyAccounts })
  const payees = useQuery({ queryKey: PAYEES_KEY, queryFn: agentBankApi.payees })
  const payments = useQuery({ queryKey: PAYMENTS_KEY, queryFn: agentBankApi.payments })
  const book = useQuery({ queryKey: BOOK_KEY, queryFn: agentBankApi.book })
  const asked = useQuery({ queryKey: ASSISTANT_REQUESTS_KEY, queryFn: agentBankApi.assistantRequests })
  const prepared = useQuery({ queryKey: PREPARED_KEY, queryFn: agentBankApi.pendingPaymentRequests })
  const askedPayees = (asked.data?.requests ?? []).filter((r) => r.kind === 'payee')
  const askedMandates = (asked.data?.requests ?? []).filter((r) => r.kind === 'mandate')
  const askedPlans = (asked.data?.requests ?? []).filter((r) => r.kind === 'plan' && r.status !== 'signed')
  // A USDC wallet cannot pay a bank payee (B55.26): only pounds, euros and dollars send, repeat or take a mandate.
  const open = (accounts.data?.accounts ?? []).filter((a) => a.status === 'open' && FIATS.includes(a.currency))
  const agentAccounts = open.filter((a) => a.purpose === 'agent')
  const saved = payees.data?.payees ?? []
  const sent = payments.data?.payments ?? []
  const waiting = prepared.data?.requests ?? []
  const agentName = (id: string | undefined) => book.data?.agents?.find((x) => x.id === id)?.name ?? id ?? ''
  const { shows } = useAccount()
  const business = shows?.team === true
  const accountName = (a: CurrencyAccount) => `${a.purpose === 'agent' ? agentName(a.agent_id) : (shows?.owner ?? 'The company')} · ${a.currency}`
  const payeeName = (id: string | undefined) => saved.find((p) => p.id === id)?.name ?? id ?? ''
  const reading = (q: { isError: boolean; isPending: boolean; error: unknown }, what: string) =>
    q.isError ? <p className="text-body text-muted">{readFailure(q.error, what)}</p> : q.isPending ? <p className="text-body text-muted">Reading…</p> : null

  // B57.31 — the payee being paid: pressed in Saved payees, or named by the address ⌘K's Payees open (/money/pay#payee-<id>).
  const [payeeID, setPayeeID] = useState('')
  const [adding, setAdding] = useState(false)
  const named = /^#payee-(.+)$/.exec(useLocation().hash)?.[1]
  const namedID = named === undefined ? undefined : decodeURIComponent(named)
  const known = namedID !== undefined && saved.some((p) => p.id === namedID)
  const pick = (id: string) => {
    setPayeeID(id)
    document.getElementById('pay-form')?.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
  }
  useEffect(() => {
    if (known && namedID !== undefined) pick(namedID)
  }, [known, namedID])

  if (!shows) {
    return (
      <RegionScreen>
        <p className="text-body text-muted">Reading…</p>
      </RegionScreen>
    )
  }
  if (!shows.bankTransfers) {
    return (
      <RegionScreen>
        <p className="text-body text-muted" data-testid="pay-on-chain">
          Your agents work on chain: each agent’s wallet address is on{' '}
          <Link className={inlineLink} to="/agents">
            Agent Wallets
          </Link>
          .
        </p>
      </RegionScreen>
    )
  }
  // B57.31 — the assistant line says only what waits: "Claude is waiting for you: 1 payee to save, below."
  const askers = [...new Set([...askedPayees, ...askedMandates].map((r) => r.assistant))]
  const asks = [
    askedPayees.length > 0 ? `${askedPayees.length} ${askedPayees.length === 1 ? 'payee' : 'payees'} to save` : '',
    askedMandates.length > 0 ? `${askedMandates.length} ${askedMandates.length === 1 ? 'mandate' : 'mandates'} to sign` : '',
  ].filter((x) => x !== '')
  return (
    <>
      {/* B57.31 — the reference's w-pay, drawn in Pocket, flush with the page's heading. What B57.32 has not given its own
          page yet is kept below it, in today's cards. */}
      <div {...{ [DESIGN_ATTR]: 'pocket' }} className="grid gap-4 pb-10">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid max-w-2xl gap-1">
            <p className="text-reading text-ink-2" data-testid="pay-lead">
              {business
                ? 'Save the people and companies your company pays, then send money from your company’s account or one of your team’s agents’ accounts in pounds, euros or dollars.'
                : 'Save the people and companies you pay, then send money from your account or one of your agents’ accounts in pounds, euros or dollars.'}
            </p>
            {asks.length > 0 ? (
              <p className="text-body text-ink" data-testid="pay-asked">
                <span className="font-semibold">{askers.length === 1 ? askers[0] : 'Your assistant'} is waiting for you:</span> {asks.join(' and ')}, below.
              </p>
            ) : null}
            {askedPlans.map((r) => (
              <p key={r.id} className="text-body text-ink">
                {r.assistant} prepared recurring payments for you to sign:{' '}
                <Link className={pocketLink} to={`/money/plans/${r.id}`}>
                  open the plan
                </Link>
                .
              </p>
            ))}
          </div>
          <PocketButton type="button" variant="secondary" icon={<Icon name="plus" />} onClick={() => setAdding(true)}>
            Add a payee
          </PocketButton>
        </div>
        <div className="grid items-start gap-4 wide:grid-cols-5">
          <div className="grid min-w-0 gap-4 wide:col-span-3">
            {reading(accounts, 'Your accounts') ??
              (open.length === 0 ? (
                <p className="text-body text-muted" data-testid="pay-no-account">
                  No currency account yet: open {business ? 'the company’s account' : 'your account'} on Invoices, then pay from it here.
                </p>
              ) : (
                <PayForm accounts={open} payees={saved} sent={sent} waiting={waiting} payeeID={payeeID} setPayeeID={setPayeeID} accountName={accountName} agentName={agentName} business={business} />
              ))}
            <PaymentsOut payments={payments} waiting={waiting} />
          </div>
          <div className="grid min-w-0 gap-4 wide:col-span-2">
            {askedPayees.length > 0 ? <AssistantPayees requests={askedPayees} /> : null}
            <SavedPayees payees={payees} sent={sent} payeeID={payeeID} onPick={pick} onAdd={() => setAdding(true)} />
            <AlsoOnPay payouts={shows.payoutBatches} />
          </div>
        </div>
        <AddPayee open={adding} onClose={() => setAdding(false)} />
      </div>
      <RegionScreen>
        <div className="px-gutter">
          <Waiting agentName={agentName} />
        </div>
        <div id="standing-orders">
          <Region index="02" label="Standing orders" heading="Pay the same amount on a schedule" className="flex max-w-2xl flex-col gap-3">
            {reading(accounts, 'Your accounts') ??
              (agentAccounts.length === 0 ? (
                <p className="text-body text-muted">A standing order runs from an agent’s account: open one on Invoices first.</p>
              ) : (
                <StandingOrders accounts={agentAccounts} payees={saved} accountName={accountName} payeeName={payeeName} agentName={agentName} />
              ))}
          </Region>
        </div>
        <div id="mandates">
          <Region index="03" label="Mandates" heading="Let a payee pull within limits you set" className="flex max-w-2xl flex-col gap-3">
            {reading(accounts, 'Your accounts') ??
              (agentAccounts.length === 0 ? (
                <p className="text-body text-muted">A mandate is on an agent’s account: open one on Invoices first.</p>
              ) : (
                <Mandates accounts={agentAccounts} payees={saved} accountName={accountName} agentName={agentName} />
              ))}
          </Region>
        </div>
        {shows.payoutBatches ? (
          <div id="bulk-payouts">
            <Region index="04" label="Bulk payouts" heading="Pay many at once from a file" className="flex max-w-2xl flex-col gap-3">
              <Payouts />
            </Region>
          </div>
        ) : null}
        <div id="bills">
          <Region index={shows.payoutBatches ? '05' : '04'} label="Bills" heading="Bills you received" className="flex max-w-2xl flex-col gap-3">
            <Bills payeeName={payeeName} />
          </Region>
        </div>
        {askedMandates.length > 0 ? (
          <Region index={shows.payoutBatches ? '06' : '05'} label="Assistant permissions" heading="Sign what an assistant may pay for you" className="flex max-w-2xl flex-col gap-3">
            <AssistantMandates requests={askedMandates} payeeName={payeeName} />
          </Region>
        ) : null}
      </RegionScreen>
    </>
  )
}

const pocketLink = `text-ink underline underline-offset-2 ${pocketFocusRing}`

/** A payee's kind of account, in words: "sort code and account number", "IBAN" or "routing and account number". */
function kindOf(p: PayeeRequest): string {
  return p.iban ? 'IBAN' : p.routing_number ? 'routing and account number' : 'sort code and account number'
}

/** "1 Oct": the day a payment was made, as a payee's last payment says it. */
const dayOf = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
const isToday = (iso: string) => new Date(iso).toDateString() === new Date().toDateString()

/** A payment out that money left in: one Lens refused or that came back paid nothing. */
const paid = (p: OutsidePayment) => p.status === 'completed' || p.status === 'sent'

/** A payee's last payment that moved money, newest first as Lens lists them, by date to be sure. */
function lastPaid(payeeID: string, sent: OutsidePayment[]): OutsidePayment | undefined {
  return sent.filter((p) => p.payee_id === payeeID && paid(p)).sort((a, b) => b.created_at.localeCompare(a.created_at))[0]
}

/** B57.31 — the request a payment may have come from: Lens pays item n of request preq_x under the key "preq:preq_x:n". The
 *  key is only a hint, since a caller chooses its own key: a payment reads as prepared only once that request, read from
 *  Lens, names this payment as the one that paid it. */
const preparedRequestOf = (p: OutsidePayment) => /^preq:([^:]+):\d+$/.exec(p.idempotency_key)?.[1]

/**
 * B57.31 — one payment to a saved payee, from the company's or an agent's account (B30.17): From with what it holds, To,
 * the amount in the account's currency, the reference, and Send with the amount. A payee whose payment an assistant
 * prepared and that still waits is reviewed on its own page instead, so the same payment is not sent twice.
 */
function PayForm({
  accounts,
  payees,
  sent,
  waiting,
  payeeID,
  setPayeeID,
  accountName,
  agentName,
  business,
}: {
  accounts: CurrencyAccount[]
  payees: OutsidePayee[]
  sent: OutsidePayment[]
  waiting: PaymentRequest[]
  payeeID: string
  setPayeeID: (id: string) => void
  accountName: (a: CurrencyAccount) => string
  agentName: (id: string | undefined) => string
  business: boolean
}) {
  const qc = useQueryClient()
  const [accountID, setAccountID] = useState(accounts[0]?.id ?? '')
  const [amount, setAmount] = useState('')
  const [reference, setReference] = useState('')
  const [key, setKey] = useState(newMoveKey)
  const [made, setMade] = useState<OutsidePayment | null>(null)
  const [answers, setAnswers] = useState<ScamAnswers>({})
  const [stillPay, setStillPay] = useState(false)
  const account = accounts.find((a) => a.id === accountID) ?? accounts[0]
  const payee = payees.find((p) => p.id === payeeID)
  const minor = minorOf(amount)
  const currency = account?.currency ?? 'GBP'
  // B41.13: before the first payment to a payee, both questions are answered; a yes to either needs a second confirmation.
  const first = payee !== undefined && !sent.some((p) => p.payee_id === payee.id)
  const risky = SCAM_QUESTIONS.some((q) => answers[q.key] === true)
  const checked = !first || (SCAM_QUESTIONS.every((q) => answers[q.key] !== undefined) && (!risky || stillPay))
  const complete = account !== undefined && payee !== undefined && !payee.needs_confirmation && minor !== null && checked
  const preparedFor = payee === undefined ? undefined : waiting.find((r) => (r.items ?? []).some((i) => i.payee_id === payee.id))
  // Reset per payee: the questions are about this payee's details.
  useEffect(() => {
    setAnswers({})
    setStillPay(false)
  }, [payeeID])
  const pay = useMutation({
    mutationFn: () => payOutsideSigned({ account_id: account?.id ?? '', payee_id: payeeID, amount_minor: minor ?? 0, currency, reference: reference.trim(), idempotency_key: key }),
    onSuccess: (p) => {
      setMade(p)
      setAmount('')
      setReference('')
      setKey(newMoveKey())
      setAnswers({})
      setStillPay(false)
      void qc.invalidateQueries({ queryKey: PAYMENTS_KEY })
      void qc.invalidateQueries({ queryKey: MONEY_ACCOUNTS_KEY })
    },
  })
  const why =
    payee === undefined
      ? 'Choose who to pay.'
      : payee.needs_confirmation
        ? `Confirm ${payee.name} with a passkey first.`
        : minor === null
          ? 'Add an amount.'
          : !checked
            ? risky
              ? 'Confirm you checked the details first.'
              : 'Answer both questions first.'
            : undefined
  return (
    <PocketCard tone="white" id="pay-form" className="scroll-mt-24">
      <form
        className="grid gap-4"
        data-testid="send-payment"
        onSubmit={(e) => {
          e.preventDefault()
          if (complete && !pay.isPending) pay.mutate()
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-head font-bold text-ink">Pay a saved payee</h2>
          <WorkspaceLabel capability={PAY_OUT} />
        </div>
        <Field label="From">
          {/* What the account holds sits inside the box, at its end, as the reference draws it. */}
          <span className="relative block">
            <PocketSelect aria-label="From" className="pr-36" value={account?.id ?? ''} onChange={(e) => setAccountID(e.target.value)}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {accountName(a)}
                </option>
              ))}
            </PocketSelect>
            <span className="pointer-events-none absolute right-10 top-1/2 -translate-y-1/2 text-body text-ink-3" data-testid="pay-holds">
              holds <span className="font-figure">{formatMinor(account?.test_minor ?? 0, currency)}</span>
            </span>
          </span>
        </Field>
        <div className="grid gap-4 wide:grid-cols-2">
          <Field label="To">
            <PocketSelect aria-label="To" value={payeeID} onChange={(e) => setPayeeID(e.target.value)}>
              <option value="">Choose a payee</option>
              {payees.map((p) => (
                <option key={p.id} value={p.id} disabled={p.needs_confirmation}>
                  {p.name}
                  {p.needs_confirmation ? ' (confirm first)' : ''}
                </option>
              ))}
            </PocketSelect>
          </Field>
          <Field label={`Amount in ${currency}`}>
            <PocketInput aria-label={`Amount in ${currency}`} inputMode="decimal" placeholder="20.00" unit={currency} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
        </div>
        <Field label="Reference">
          <PocketInput aria-label="Reference" placeholder="What the payee sees" className="font-sans" value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
        <p className="text-body text-ink-3" data-testid="pay-approval">
          {account?.purpose === 'agent'
            ? `From ${agentName(account.agent_id)}’s account, its rules judge it at its LXC value, and above its approval amount it waits for you.`
            : `From ${business ? 'the company’s' : 'your'} account, a payment needs no approval.`}
        </p>
        {first && preparedFor === undefined ? (
          <fieldset className="grid gap-3 border-t border-line pt-4" data-testid="scam-check">
            <legend className="mb-1 text-reading font-semibold text-ink">First payment to {payee.name}: two quick questions</legend>
            {SCAM_QUESTIONS.map((q) => (
              <div key={q.key} className="flex flex-wrap items-center justify-between gap-3">
                <span className="min-w-0 flex-1 text-reading text-ink" id={`scam-${q.key}`}>
                  {q.text}
                </span>
                <div role="radiogroup" aria-labelledby={`scam-${q.key}`} className="flex gap-2">
                  {([true, false] as const).map((yes) => (
                    <button
                      key={String(yes)}
                      type="button"
                      role="radio"
                      aria-checked={answers[q.key] === yes}
                      className={cn(
                        'h-8.5 rounded-pill px-3.5 text-body font-semibold transition-colors duration-200',
                        answers[q.key] === yes ? 'bg-primary text-on-primary' : 'bg-cloud-2 text-ink',
                        pocketFocusRing,
                      )}
                      onClick={() => {
                        setAnswers((a) => ({ ...a, [q.key]: yes }))
                        setStillPay(false)
                      }}
                    >
                      {yes ? 'Yes' : 'No'}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {risky ? (
              <div role="alert" className="grid gap-2 rounded-control bg-danger-50 px-4 py-3" data-testid="scam-warning">
                <p className="flex items-center gap-1.5 text-reading font-semibold text-danger">
                  <Icon name="shield" size={16} />
                  Stop and check. This could be a scam.
                </p>
                <p className="text-body text-ink">
                  Fraudsters rush people into paying, and they send or change bank details by email or chat. Before you pay, call {payee.name} on a
                  number you already have (not one from the message) and check the details. Money sent to a fraudster is often not recovered.
                </p>
                <label className="flex items-start gap-2 text-body text-ink">
                  <input
                    type="checkbox"
                    className={`mt-0.5 h-4 w-4 shrink-0 accent-primary transition-colors duration-200 hover:border-rule-strong disabled:cursor-not-allowed disabled:opacity-50 ${pocketFocusRing}`}
                    checked={stillPay}
                    onChange={(e) => setStillPay(e.target.checked)}
                  />
                  <span>I have checked the details with {payee.name} directly and still want to pay.</span>
                </label>
              </div>
            ) : null}
          </fieldset>
        ) : null}
        {preparedFor !== undefined ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-control bg-tangerine-50 px-4 py-3" data-testid="pay-prepared">
            <p className="min-w-0 flex-1 text-reading text-ink">{preparedBy(preparedFor.client)} prepared this payment, and it waits for your approval.</p>
            <PocketButton asChild variant="primary" data-tangerine="your-move">
              <Link to={`/approve/${encodeURIComponent(preparedFor.id)}`}>Review it</Link>
            </PocketButton>
          </div>
        ) : (
          <div>
            <PocketButton type="submit" variant="primary" disabled={!complete || pay.isPending} disabledReason={pay.isPending ? undefined : why}>
              {pay.isPending ? (
                'Sending…'
              ) : minor === null ? (
                'Send'
              ) : (
                <>
                  Send <span className="font-figure">{formatMinor(minor, currency)}</span>
                </>
              )}
            </PocketButton>
          </div>
        )}
        {pay.isError ? <Said ok={false}>{refusalText(pay.error)}</Said> : null}
        {made !== null ? (
          <Said ok>
            <span className="font-figure">{formatMinor(made.amount_minor, made.currency)}</span> to {made.payee_name}: {paymentStatus(made.status).text.toLowerCase()}
            {made.detail ? ` (${made.detail})` : ''}.
          </Said>
        ) : null}
      </form>
    </PocketCard>
  )
}

/** What a press said: a sentence, or a refusal in red with its icon beside it. */
function Said({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return ok ? (
    <p role="status" className="text-body text-ink-2">
      {children}
    </p>
  ) : (
    <p role="alert" className="flex items-center gap-1.5 text-body text-danger">
      <Icon name="x" size={16} />
      <span>{children}</span>
    </p>
  )
}

/**
 * B57.31 — the payments out: each with its payee, amount, reference, date and status in words, why one was refused, and
 * whether it was prepared; a prepared one still waiting reads Waiting for approval until it is decided.
 */
function PaymentsOut({ payments, waiting }: { payments: UseQueryResult<{ payments: OutsidePayment[] | null }>; waiting: PaymentRequest[] }) {
  const sent = payments.data?.payments ?? []
  const items = waiting.flatMap((r) => (r.items ?? []).filter((i) => !i.payment_id).map((i) => ({ r, i })))
  const hinted = [...new Set(sent.map(preparedRequestOf).filter((id): id is string => id !== undefined))]
  const requests = useQueries({ queries: hinted.map((id) => ({ queryKey: paymentRequestKey(id), queryFn: () => agentBankApi.paymentRequest(id) })) })
  // Who prepared each payment, for the payments a request Lens holds says it paid.
  const preparedFor = new Map<string, string>()
  for (const q of requests) for (const i of q.data?.items ?? []) if (i.payment_id) preparedFor.set(i.payment_id, preparedBy(q.data?.client ?? ''))
  return (
    <PocketCard>
      <h2 className="font-display text-head font-bold text-ink">Payments out</h2>
      {payments.isError ? (
        <Said ok={false}>We couldn’t read your payments. Nothing changed.</Said>
      ) : payments.isPending ? (
        <p className="mt-3 text-body text-ink-3">Reading…</p>
      ) : sent.length + items.length === 0 ? (
        <p className="mt-3 text-body text-ink-3">No payments yet.</p>
      ) : (
        <ul className="mt-3 border-t border-line">
          {items.map(({ r, i }) => (
            <li key={`${r.id}-${i.position}`} data-testid={`prepared-${r.id}`}>
              <PocketRow
                wrap
                leading={<RoomBadge icon={<Icon name="clock" />} />}
                title={`${i.payee_name} · ${formatMinor(i.amount_minor, i.currency)}`}
                line={[i.reference, `prepared by ${preparedBy(r.client)}`].filter((x) => x !== '').join(' · ')}
                action={
                  <Link to={`/approve/${encodeURIComponent(r.id)}`} className={cn('rounded-pill', pocketFocusRing)}>
                    <Chip tone="wait">Waiting for approval</Chip>
                  </Link>
                }
              />
            </li>
          ))}
          {sent.map((p) => {
            const s = paymentStatus(p.status)
            return (
              <li key={p.id} id={`payment-${p.id}`} data-testid={`payment-${p.id}`}>
                <PocketRow
                  wrap
                  leading={<RoomBadge icon={<Icon name={p.status === 'completed' ? 'check' : p.status === 'failed' || p.status === 'returned' ? 'x' : 'send'} />} />}
                  title={`${p.payee_name} · ${formatMinor(p.amount_minor, p.currency)}`}
                  line={
                    <>
                      {[p.reference, formatDecided(p.created_at), preparedFor.has(p.id) ? `prepared by ${preparedFor.get(p.id)}, approved by you` : ''].filter((x) => x !== '').join(' · ')}
                      {p.detail ? <span className="block">{p.detail}</span> : null}
                    </>
                  }
                  action={<Chip tone={s.tone}>{s.text}</Chip>}
                />
              </li>
            )
          })}
        </ul>
      )}
    </PocketCard>
  )
}

/**
 * B57.31 — saved payees outside Talyvor (B30.16): pressing one pays it. Each says its country, its kind of account and its
 * last payment, with what its bank said of the name; a close or no match is confirmed with a passkey, a new payee's first
 * 24 hours are said with the call that ends them early (B41.11), and changed details hold its payments (B41.12).
 */
function SavedPayees({
  payees,
  sent,
  payeeID,
  onPick,
  onAdd,
}: {
  payees: UseQueryResult<{ payees: OutsidePayee[] | null }>
  sent: OutsidePayment[]
  payeeID: string
  onPick: (id: string) => void
  onAdd: () => void
}) {
  const qc = useQueryClient()
  const saved = payees.data?.payees ?? []
  const refresh = () => void qc.invalidateQueries({ queryKey: PAYEES_KEY })
  const confirm = useMutation({ mutationFn: async (id: string) => agentBankApi.confirmPayee(id, await signPayee(id)), onSuccess: refresh })
  // B41.11: the payments the cooling-off held are paid as it ends, so the payments and balances are read again too.
  const called = useMutation({
    mutationFn: async (id: string) => agentBankApi.confirmPayeeCalled(id, await signPayeeCalled(id)),
    onSuccess: () => {
      refresh()
      void qc.invalidateQueries({ queryKey: PAYMENTS_KEY })
      void qc.invalidateQueries({ queryKey: MONEY_ACCOUNTS_KEY })
    },
  })
  const paying = saved.find((p) => p.id === payeeID)
  if (payees.isError || payees.isPending) {
    return (
      <PocketCard tone="white">
        <h2 className="font-display text-head font-bold text-ink">People and companies you pay</h2>
        {payees.isError ? (
          <div className="mt-3 grid justify-items-start gap-3">
            <Said ok={false}>We couldn’t read your payees. Nothing changed.</Said>
            <PocketButton type="button" variant="secondary" onClick={() => void payees.refetch()}>
              Try again
            </PocketButton>
          </div>
        ) : (
          <p className="mt-3 text-body text-ink-3">Reading…</p>
        )}
      </PocketCard>
    )
  }
  if (saved.length === 0) {
    return (
      <PocketCard tone="white">
        <EmptyState
          icon={<Icon name="payments" />}
          title="No payees yet"
          line="Save the people and companies you pay."
          action={
            <PocketButton type="button" variant="primary" onClick={onAdd}>
              Add a payee
            </PocketButton>
          }
        />
      </PocketCard>
    )
  }
  return (
    <PocketCard tone="white">
      <h2 className="font-display text-head font-bold text-ink">People and companies you pay</h2>
      <ul className="mt-3 border-t border-line" aria-label="Saved payees">
        {saved.map((p) => {
          const c = CHECK[p.check] ?? { text: 'Name not checked', tone: 'plain' as ChipTone }
          const last = lastPaid(p.id, sent)
          return (
            <li key={p.id} className="grid gap-2 border-t border-line py-2.5 first:border-t-0" data-testid={`payee-${p.id}`}>
              <Link
                to={{ hash: `payee-${p.id}` }}
                onClick={() => onPick(p.id)}
                className={cn('flex items-center gap-3 rounded-control text-reading', pocketFocusRing)}
                aria-current={p.id === payeeID ? 'true' : undefined}
              >
                <RoomBadge icon={<Icon name="payments" />} />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-ink">
                    {p.name}
                    {last !== undefined && isToday(last.created_at) ? (
                      <>
                        {' '}
                        <span className="font-normal text-ink-3">·</span> <span className="font-normal text-ink-3">paid today</span>
                      </>
                    ) : null}
                  </span>
                  <span className="block text-body text-ink-3">
                    {p.country} · {kindOf(p)} ·{' '}
                    {last === undefined ? (
                      'not paid yet'
                    ) : (
                      <>
                        last paid <span className="font-figure">{formatMinor(last.amount_minor, last.currency)}</span> on {dayOf(last.created_at)}
                      </>
                    )}
                    {p.suggested_name ? ` · the account is held by ${p.suggested_name}` : ''}
                    {p.screening ? ` · ${p.screening}` : ''}
                  </span>
                </span>
                <span className="flex shrink-0 flex-wrap justify-end gap-1.5">
                  {p.id === payeeID ? <Chip tone="wait">Paying</Chip> : <Chip tone={c.tone}>{c.text}</Chip>}
                  {p.needs_confirmation ? <Chip tone="wait">Needs confirmation</Chip> : null}
                  {p.cooling_off_until ? <Chip tone="wait">New payee</Chip> : null}
                  {p.held_until ? <Chip tone="wait">Details changed</Chip> : null}
                </span>
              </Link>
              {p.needs_confirmation ? (
                <div className="pl-14">
                  <PocketButton type="button" size="sm" variant="secondary" disabled={confirm.isPending} onClick={() => confirm.mutate(p.id)}>
                    {confirm.isPending && confirm.variables === p.id ? 'Confirming…' : 'Confirm with a passkey'}
                  </PocketButton>
                </div>
              ) : null}
              {p.cooling_off_until ? (
                <div className="grid gap-2 pl-14" data-testid={`cooling-off-${p.id}`}>
                  <p className="text-body text-ink">
                    A payment of more than <span className="font-figure">1,000</span> to {p.name} waits until{' '}
                    <span className="font-figure">{formatWhen(p.cooling_off_until)}</span>. To pay it sooner, call {p.name} on a number you already
                    had (not one from an email, an invoice or a message) and check the account details with them.
                  </p>
                  <div>
                    <PocketButton type="button" size="sm" variant="secondary" disabled={called.isPending} onClick={() => called.mutate(p.id)}>
                      {called.isPending && called.variables === p.id ? 'Confirming…' : 'I called them: confirm with a passkey'}
                    </PocketButton>
                  </div>
                </div>
              ) : null}
              {p.held_until ? (
                <p className="pl-14 text-body text-ink" data-testid={`details-held-${p.id}`}>
                  {p.name}’s bank details changed, so every payment to them is held until <span className="font-figure">{formatWhen(p.held_until)}</span>.{' '}
                  {p.notice}
                </p>
              ) : null}
            </li>
          )
        })}
      </ul>
      {confirm.isError ? <Said ok={false}>{refusalText(confirm.error)}</Said> : null}
      {called.isError ? <Said ok={false}>{refusalText(called.error)}</Said> : null}
      {paying !== undefined ? <ChangeDetails key={paying.id} payee={paying} onChanged={refresh} /> : null}
      <p className="mt-3 text-body text-ink-3">
        Press a payee to pay it. A payee’s name is checked against its account before it can be paid. For its first{' '}
        <span className="font-figure">24</span> hours, a new payee can be paid at most <span className="font-figure">1,000</span> in total in its
        currency, unless you confirm with your passkey that you called them.
      </p>
    </PocketCard>
  )
}

/** B57.31 — Add a payee: the name on the account, the account, and the name check before Save payee keeps it. */
function AddPayee({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const [kind, setKind] = useState<'uk' | 'iban' | 'us'>('uk')
  const [form, setForm] = useState({ name: '', country: 'GB', sort_code: '', account_number: '', iban: '', bic: '', routing_number: '' })
  const [made, setMade] = useState<OutsidePayee | null>(null)
  const create = useMutation({
    mutationFn: () => {
      const body: PayeeRequest = { name: form.name.trim(), country: form.country.trim().toUpperCase() }
      if (kind === 'iban') Object.assign(body, { iban: form.iban.replace(/\s/g, '').toUpperCase(), bic: form.bic.trim().toUpperCase() })
      else if (kind === 'us') Object.assign(body, { routing_number: form.routing_number.trim(), account_number: form.account_number.trim() })
      else Object.assign(body, { sort_code: form.sort_code.replace(/\D/g, ''), account_number: form.account_number.trim() })
      return agentBankApi.createPayee(body)
    },
    onSuccess: (p) => {
      setMade(p)
      setForm({ name: '', country: 'GB', sort_code: '', account_number: '', iban: '', bic: '', routing_number: '' })
      void qc.invalidateQueries({ queryKey: PAYEES_KEY })
      onClose()
    },
  })
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }))
  const complete =
    form.name.trim() !== '' &&
    form.country.trim().length === 2 &&
    (kind === 'iban' ? form.iban.trim() !== '' : kind === 'us' ? form.routing_number.trim() !== '' && form.account_number.trim() !== '' : form.sort_code.trim() !== '' && form.account_number.trim() !== '')
  const save = () => {
    if (complete && !create.isPending) create.mutate()
  }
  return (
    <>
      {made !== null ? (
        <Said ok>
          {made.name} saved: {(CHECK[made.check]?.text ?? 'name not checked').toLowerCase()}
          {made.suggested_name ? `. The account is held by ${made.suggested_name}` : ''}
          {made.needs_confirmation ? '. Confirm it with a passkey before the first payment.' : '.'}
        </Said>
      ) : null}
      <Dialog
        open={open}
        onClose={onClose}
        title="Add a payee"
        actions={
          <>
            <PocketButton type="button" variant="secondary" onClick={onClose}>
              Cancel
            </PocketButton>
            <PocketButton type="submit" form="new-payee" variant="primary" disabled={!complete || create.isPending} disabledReason={create.isPending ? undefined : complete ? undefined : 'Add the name and the account first.'}>
              {create.isPending ? 'Checking…' : 'Save payee'}
            </PocketButton>
          </>
        }
      >
        <form
          id="new-payee"
          className="grid gap-3.5"
          data-testid="new-payee"
          onSubmit={(e) => {
            e.preventDefault()
            save()
          }}
        >
          <Field label="Name on the account">
            <PocketInput className="font-sans" value={form.name} onChange={(e) => set({ name: e.target.value })} />
          </Field>
          <Field label="Country">
            <PocketInput placeholder="GB" value={form.country} onChange={(e) => set({ country: e.target.value })} />
          </Field>
          <Field label="Account">
            <PocketSelect value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              <option value="uk">Sort code and account number</option>
              <option value="iban">IBAN</option>
              <option value="us">Routing and account number</option>
            </PocketSelect>
          </Field>
          {kind === 'iban' ? (
            <div className="grid gap-3.5 wide:grid-cols-3">
              <Field label="IBAN" className="wide:col-span-2">
                <PocketInput value={form.iban} onChange={(e) => set({ iban: e.target.value })} />
              </Field>
              <Field label="BIC (optional)">
                <PocketInput value={form.bic} onChange={(e) => set({ bic: e.target.value })} />
              </Field>
            </div>
          ) : (
            <div className="grid gap-3.5 wide:grid-cols-2">
              {kind === 'us' ? (
                <Field label="Routing number">
                  <PocketInput inputMode="numeric" value={form.routing_number} onChange={(e) => set({ routing_number: e.target.value })} />
                </Field>
              ) : (
                <Field label="Sort code">
                  <PocketInput inputMode="numeric" value={form.sort_code} onChange={(e) => set({ sort_code: e.target.value })} />
                </Field>
              )}
              <Field label="Account number">
                <PocketInput inputMode="numeric" value={form.account_number} onChange={(e) => set({ account_number: e.target.value })} />
              </Field>
            </div>
          )}
          <p className="text-body text-ink-3">Its name is checked against the account before it can be paid.</p>
          {create.isError ? <Said ok={false}>{refusalText(create.error)}</Said> : null}
        </form>
      </Dialog>
    </>
  )
}

/** B57.31 — what else is on Pay, each scrolling to today's card below until B57.32 gives it its own page. */
function AlsoOnPay({ payouts }: { payouts: boolean }) {
  const bills = useQuery({ queryKey: BILLS_KEY, queryFn: agentBankApi.bills })
  const all = bills.data?.bills ?? []
  const due = all.filter((b) => b.status === 'due').length
  const billsLine = bills.isError
    ? 'We couldn’t read your bills'
    : bills.isSuccess
    ? all.length === 0
      ? 'None yet'
      : `${all.length} ${all.length === 1 ? 'bill' : 'bills'} · ${due === 0 ? 'paid' : `${due} due`}`
    : 'Bills sent to you to pay'
  const rows: { to: string; icon: IconName; title: string; line: string }[] = [
    { to: 'standing-orders', icon: 'clock', title: 'Standing orders', line: 'The same amount on a schedule' },
    { to: 'mandates', icon: 'key', title: 'Mandates', line: 'A payee pulls within limits you set' },
    ...(payouts ? [{ to: 'bulk-payouts', icon: 'payments' as IconName, title: 'Bulk payouts', line: 'Pay many at once from a file' }] : []),
    { to: 'bills', icon: 'invoices', title: 'Bills you received', line: billsLine },
  ]
  return (
    <PocketCard>
      <h2 className="font-display text-head font-bold text-ink">Also on Pay</h2>
      <div className="mt-3 border-t border-line">
        {rows.map((r) => (
          <PocketRow key={r.to} href={`#${r.to}`} leading={<RoomBadge icon={<Icon name={r.icon} />} />} title={r.title} line={r.line} />
        ))}
      </div>
      <p className="mt-3 text-body text-ink-3">
        A payment an agent’s rules hold for you waits on{' '}
        <Link className={pocketLink} to="/approvals">
          Approvals
        </Link>{' '}
        and Home.
      </p>
    </PocketCard>
  )
}

// B41.12: the notice shown before a change is signed — Lens's PayeeDetailsNotice, the one it answers the change with.
const CHANGE_NOTICE = 'Call them on a number you already know (not one from the message that asked for the change) to check the new details are theirs.'

/** B41.12 — changing a saved payee's bank details (Lens B41.112): signed with a passkey over exactly the new details, the
 *  name checked afresh at the new account's bank, and every payment to the payee held for 24 hours after. B57.31: in
 *  Pocket, under Saved payees, for the payee being paid. */
function ChangeDetails({ payee, onChanged }: { payee: OutsidePayee; onChanged: () => void }) {
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<'uk' | 'iban' | 'us'>(payee.iban ? 'iban' : payee.routing_number ? 'us' : 'uk')
  const [form, setForm] = useState({ sort_code: '', account_number: '', iban: '', bic: '', routing_number: '' })
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }))
  const details = (): PayeeDetails => {
    const d: PayeeDetails = { country: payee.country }
    if (kind === 'iban') return { ...d, iban: form.iban.replace(/\s/g, '').toUpperCase(), bic: form.bic.trim().toUpperCase() }
    if (kind === 'us') return { ...d, routing_number: form.routing_number.trim(), account_number: form.account_number.trim() }
    return { ...d, sort_code: form.sort_code.replace(/\D/g, ''), account_number: form.account_number.trim() }
  }
  const change = useMutation({
    mutationFn: async (d: PayeeDetails) => agentBankApi.changePayeeDetails(payee.id, d, await signPayeeDetails(payee.id, d)),
    onSuccess: () => {
      setOpen(false)
      setForm({ sort_code: '', account_number: '', iban: '', bic: '', routing_number: '' })
      onChanged()
    },
  })
  const complete = kind === 'iban' ? form.iban.trim() !== '' : kind === 'us' ? form.routing_number.trim() !== '' && form.account_number.trim() !== '' : form.sort_code.trim() !== '' && form.account_number.trim() !== ''
  if (!open) {
    return (
      <p className="mt-3">
        <button type="button" className={cn('text-body', pocketLink)} onClick={() => setOpen(true)}>
          Change {payee.name}’s bank details
        </button>
      </p>
    )
  }
  return (
    <form
      className="mt-3 grid gap-3 border-t border-line pt-3"
      data-testid={`change-details-${payee.id}`}
      onSubmit={(e) => {
        e.preventDefault()
        if (complete && !change.isPending) change.mutate(details())
      }}
    >
      <p className="text-body text-ink">
        Changed bank details are the most common way invoices are stolen. {CHANGE_NOTICE} The change needs your passkey, and every payment to{' '}
        {payee.name} is held for <span className="font-figure">24</span> hours after it.
      </p>
      <Field label="New account">
        <PocketSelect aria-label="New account details" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
          <option value="uk">Sort code and account number</option>
          <option value="iban">IBAN</option>
          <option value="us">Routing and account number</option>
        </PocketSelect>
      </Field>
      {kind === 'iban' ? (
        <div className="grid gap-3 wide:grid-cols-3">
          <PocketInput aria-label="New IBAN" placeholder="IBAN" className="wide:col-span-2" value={form.iban} onChange={(e) => set({ iban: e.target.value })} />
          <PocketInput aria-label="New BIC" placeholder="BIC (optional)" value={form.bic} onChange={(e) => set({ bic: e.target.value })} />
        </div>
      ) : (
        <div className="grid gap-3 wide:grid-cols-2">
          {kind === 'us' ? (
            <PocketInput aria-label="New routing number" placeholder="Routing number" value={form.routing_number} onChange={(e) => set({ routing_number: e.target.value })} />
          ) : (
            <PocketInput aria-label="New sort code" placeholder="Sort code" value={form.sort_code} onChange={(e) => set({ sort_code: e.target.value })} />
          )}
          <PocketInput aria-label="New account number" placeholder="Account number" value={form.account_number} onChange={(e) => set({ account_number: e.target.value })} />
        </div>
      )}
      <div className="flex flex-wrap justify-end gap-2.5">
        <PocketButton type="button" variant="secondary" onClick={() => setOpen(false)}>
          Cancel
        </PocketButton>
        <PocketButton type="submit" variant="primary" disabled={!complete || change.isPending} disabledReason={change.isPending || complete ? undefined : 'Add the new details first.'}>
          {change.isPending ? 'Confirming…' : 'Change with a passkey'}
        </PocketButton>
      </div>
      {change.isError ? <Said ok={false}>{refusalText(change.error)}</Said> : null}
    </form>
  )
}

/** B40.35 — payees an assistant asked to add: none is a payee until the person presses Save, through the same route as the form. */
function AssistantPayees({ requests }: { requests: AssistantRequest[] }) {
  const qc = useQueryClient()
  const [made, setMade] = useState<OutsidePayee | null>(null)
  const done = () => {
    void qc.invalidateQueries({ queryKey: ASSISTANT_REQUESTS_KEY })
    void qc.invalidateQueries({ queryKey: PAYEES_KEY })
  }
  const save = useMutation({
    mutationFn: async (r: AssistantRequest & { kind: 'payee' }) => {
      const p = await agentBankApi.createPayee(r.details)
      await agentBankApi.dismissAssistantRequest(r.id)
      return p
    },
    onSuccess: (p) => {
      setMade(p)
      done()
    },
  })
  const dismiss = useMutation({ mutationFn: agentBankApi.dismissAssistantRequest, onSuccess: done })
  const assistants = [...new Set(requests.map((r) => r.assistant))]
  return (
    <PocketCard tone="white">
      <h2 className="font-display text-head font-bold text-ink">Payees your assistant asked to add</h2>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {assistants.map((a) => (
          <Chip key={a} tone="wait">
            Asked by {a}
          </Chip>
        ))}
      </div>
      <p className="mt-2 text-body text-ink-2">Check each against what the payee told you. Nothing is saved, or can be paid, until you press Save.</p>
      <ul className="mt-3 border-t border-line" aria-label="Payees your assistant asked to add">
        {requests.map((r) =>
          r.kind === 'payee' ? (
            <li key={r.id} data-testid={`asked-payee-${r.id}`}>
              <PocketRow
                wrap
                title={`${r.details.name} · ${r.details.country}`}
                line={
                  <>
                    {kindOf(r.details).replace(/^./, (c) => c.toUpperCase())} · <span className="font-figure">{detailsOf(r.details)}</span> · asked{' '}
                    {formatDecided(r.created_at)}
                  </>
                }
                action={
                  <>
                    <PocketButton type="button" size="sm" variant="primary" disabled={save.isPending} onClick={() => save.mutate(r)}>
                      {save.isPending && save.variables?.id === r.id ? 'Checking…' : 'Save payee'}
                    </PocketButton>
                    <PocketButton type="button" size="sm" variant="secondary" disabled={dismiss.isPending} onClick={() => dismiss.mutate(r.id)}>
                      Dismiss
                    </PocketButton>
                  </>
                }
              />
            </li>
          ) : null,
        )}
      </ul>
      {save.isError ? <Said ok={false}>{refusalText(save.error)}</Said> : null}
      {dismiss.isError ? <Said ok={false}>{refusalText(dismiss.error)}</Said> : null}
      {made !== null ? (
        <Said ok>
          {made.name} saved: {(CHECK[made.check]?.text ?? 'name not checked').toLowerCase()}
          {made.needs_confirmation ? '. Confirm it with a passkey before the first payment.' : '.'}
        </Said>
      ) : null}
    </PocketCard>
  )
}

const NEW_PAYEE: Record<string, (hours: number) => string> = {
  always_ask: () => 'The first payment to any payee always waits for your approval.',
  confirmation_of_payee: () => 'A payee is paid without asking only once its name matches its account.',
  cooling_off: (h) => `A newly added payee is paid without asking only ${h} hours after it was added.`,
}

/** A drafted mandate in plain words: exactly the terms the passkey signs. */
export function mandateInWords(assistant: string, t: MandateTerms, payeeName: (id: string) => string): string[] {
  const money = (m: Record<string, number> | null | undefined) =>
    Object.entries(m ?? {})
      .map(([cur, minor]) => formatMinor(minor, cur))
      .join(' or ')
  const to = [
    ...(t.scope.payees ?? []).map(payeeName),
    ...(t.scope.payee_categories ?? []).map((c) => `any payee in ${c}`),
    ...(t.scope.sellers ?? []).map((id) => `marketplace seller ${id}`),
    ...(t.scope.rooms ?? []).map((id) => `room ${id}`),
  ]
  const lim = t.limits ?? {}
  const limits = [
    [lim.per_payment, 'a payment'],
    [lim.per_day, 'a day'],
    [lim.per_month, 'a month'],
    [lim.batch_total, 'a batch'],
  ]
    .filter(([m]) => Object.keys(m ?? {}).length > 0)
    .map(([m, per]) => `${money(m as Record<string, number>)} ${per as string}`)
  if ((lim.payments_per_hour ?? 0) > 0) limits.push(`${lim.payments_per_hour} payments an hour`)
  return [
    `Payments ${assistant} prepares for ${to.join(', ')}, in ${(t.scope.currencies ?? []).join(', ')}, are paid without asking you again.`,
    limits.length > 0 ? `At most ${limits.join(', ')}.` : 'No limit on amounts.',
    ...(Object.keys(t.requires_approval_above ?? {}).length > 0 ? [`A payment above ${money(t.requires_approval_above)} waits for your approval.`] : []),
    (NEW_PAYEE[t.new_payee.policy] ?? (() => `New payees: ${t.new_payee.policy}.`))(t.new_payee.cooling_off_hours ?? 0),
    `Until ${formatWhen(t.expires_at)}. You can revoke it at any time.`,
  ]
}

/** B40.35 — permission mandates an assistant drafted: none has any effect until the person's passkey signs it (Lens B40.2). */
function AssistantMandates({ requests, payeeName }: { requests: AssistantRequest[]; payeeName: (id: string) => string }) {
  const qc = useQueryClient()
  const [signed, setSigned] = useState(false)
  const done = () => void qc.invalidateQueries({ queryKey: ASSISTANT_REQUESTS_KEY })
  const sign = useMutation({
    mutationFn: async (id: string) => {
      const prepared = await agentBankApi.prepareAssistantMandate(id)
      return agentBankApi.signAssistantMandate(id, prepared.canonical, await assertOver(prepared))
    },
    onSuccess: () => {
      setSigned(true)
      done()
    },
  })
  const dismiss = useMutation({ mutationFn: agentBankApi.dismissAssistantRequest, onSuccess: done })
  return (
    <>
      {requests.map((r) =>
        r.kind === 'mandate' ? (
          <Card key={r.id}>
            <CardHeader>{r.assistant} asks for a permission mandate</CardHeader>
            <div className="flex flex-col gap-3 px-gutter py-3" data-testid={`asked-mandate-${r.id}`}>
              <ul className="flex list-disc flex-col gap-1 pl-5 text-body text-ink">
                {mandateInWords(r.assistant, r.details, payeeName).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              <p className="text-caption text-muted">
                Drafted <span className="font-figure">{formatWhen(r.created_at)}</span>. It does nothing until you sign it.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="primary" disabled={sign.isPending} onClick={() => sign.mutate(r.id)}>
                  {sign.isPending && sign.variables === r.id ? 'Signing…' : 'Sign with a passkey'}
                </Button>
                <Button type="button" disabled={dismiss.isPending} onClick={() => dismiss.mutate(r.id)}>
                  Dismiss
                </Button>
              </div>
            </div>
          </Card>
        ) : null,
      )}
      {sign.isError ? <Note ok={false}>{refusalText(sign.error)}</Note> : null}
      {dismiss.isError ? <Note ok={false}>{refusalText(dismiss.error)}</Note> : null}
      {signed ? <Note ok>Signed. The mandate is in force until it ends or you revoke it.</Note> : null}
    </>
  )
}

/** The two scam questions asked before a first payment to a payee (B41.13). */
const SCAM_QUESTIONS = [
  { key: 'urgent', text: 'Were you told to pay urgently?' },
  { key: 'by_message', text: 'Did the bank details arrive by email or chat?' },
] as const
type ScamAnswers = Partial<Record<(typeof SCAM_QUESTIONS)[number]['key'], boolean>>

/** An agent's own payments out that its rules sent to a person: approve or deny here, signed once the workspace has a passkey. */
function Waiting({ agentName }: { agentName: (id: string) => string }) {
  const qc = useQueryClient()
  const approvals = useQuery({ queryKey: APPROVALS_KEY, queryFn: agentBankApi.approvals })
  const { signed, onlyThePhone, hold } = useKeys()
  const waiting = (approvals.data?.approvals ?? []).filter((a) => a.status === 'pending' && a.payee?.kind === 'outside')
  const decide = useMutation({
    mutationFn: async ({ a, decision }: { a: AgentApproval; decision: 'approve' | 'deny' }) =>
      agentBankApi.decide(a.id, decision, signed ? await signApproval(a.id) : undefined),
    onSuccess: () => void qc.invalidateQueries({ queryKey: APPROVALS_KEY }),
  })
  if (approvals.isError) return <p className="text-body text-muted">{readFailure(approvals.error, 'The agents’ requests')}</p>
  if (waiting.length === 0) return null
  return (
    <Card>
      <CardHeader>Waiting for your approval</CardHeader>
      <ul>
        {waiting.map((a) => (
          <li key={a.id} className="flex flex-col gap-2 border-b border-rule px-gutter py-3 last:border-b-0" data-testid={`approval-${a.id}`}>
            <p className="text-body text-ink">
              {agentName(a.agent_id)} asked to pay {a.payee?.name} <Lxc ulxc={a.amount_ulxc} />
              {a.memo ? ` · ${a.memo}` : ''}
            </p>
            <p className="text-caption text-muted">
              Asked <span className="font-figure">{formatWhen(a.created_at)}</span>. Approved, the agent’s next identical request goes through, once.
            </p>
            {onlyThePhone ? (
              <OnThePhone>Approve this on your phone: it is waiting in Talyvor there.</OnThePhone>
            ) : hold ? null : (
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" disabled={decide.isPending} onClick={() => decide.mutate({ a, decision: 'approve' })}>
                  Approve
                </Button>
                <Button type="button" disabled={decide.isPending} onClick={() => decide.mutate({ a, decision: 'deny' })}>
                  Deny
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {decide.isError ? (
        <div className="px-gutter pb-3">
          <Note ok={false}>{refusalText(decide.error)}</Note>
        </div>
      ) : null}
    </Card>
  )
}

/** A standing order: an agent's schedule to a saved payee, each tick a payment out judged by its rules when it runs (B30.18). */
function StandingOrders({
  accounts,
  payees,
  accountName,
  payeeName,
  agentName,
}: {
  accounts: CurrencyAccount[]
  payees: OutsidePayee[]
  accountName: (a: CurrencyAccount) => string
  payeeName: (id: string | undefined) => string
  agentName: (id: string) => string
}) {
  const qc = useQueryClient()
  const schedules = useQuery({ queryKey: SCHEDULES_KEY, queryFn: agentBankApi.schedules })
  const [accountID, setAccountID] = useState(accounts[0]?.id ?? '')
  const [payeeID, setPayeeID] = useState('')
  const [amount, setAmount] = useState('')
  const [every, setEvery] = useState<AgentSchedule['every']>('week')
  const [first, setFirst] = useState(() => inDays(7))
  const [end, setEnd] = useState('')
  const [memo, setMemo] = useState('')
  const [made, setMade] = useState<AgentSchedule | null>(null)
  const account = accounts.find((a) => a.id === accountID) ?? accounts[0]
  const payee = payees.find((p) => p.id === payeeID)
  const minor = minorOf(amount)
  const complete = account !== undefined && payee !== undefined && !payee.needs_confirmation && minor !== null && first !== ''
  const refresh = () => void qc.invalidateQueries({ queryKey: SCHEDULES_KEY })
  const create = useMutation({
    mutationFn: () =>
      agentBankApi.schedule(account?.agent_id ?? '', {
        to_agent_id: '',
        to_listing_id: '',
        to_payee_id: payeeID,
        amount_ulxc: 0,
        amount_minor: minor ?? 0,
        currency: account?.currency ?? '',
        memo: memo.trim(),
        every,
        first_run_at: morningOf(first),
        ...(end !== '' ? { end_at: morningOf(end) } : {}),
      }),
    onSuccess: (s) => {
      setMade(s)
      setAmount('')
      setMemo('')
      refresh()
    },
  })
  const stop = useMutation({ mutationFn: (sid: string) => agentBankApi.stopSchedule(sid), onSuccess: refresh })
  const orders = (schedules.data?.schedules ?? []).filter((s) => s.to_payee_id)
  return (
    <Card>
      <CardHeader>Standing orders</CardHeader>
      <div className="flex flex-col gap-3 px-gutter py-3">
        {schedules.isError ? (
          <p className="text-body text-muted">{readFailure(schedules.error, 'Your standing orders')}</p>
        ) : orders.length > 0 ? (
          <ul className="flex flex-col gap-2" aria-label="Standing orders">
            {orders.map((s) => (
              <li key={s.id} className="flex flex-col gap-1 border-b border-rule pb-2 last:border-b-0 last:pb-0" data-testid={`standing-order-${s.id}`}>
                <div className="flex flex-wrap items-center justify-between gap-2 text-body text-ink">
                  <span>
                    <span className="font-figure">{formatMinor(s.amount_minor ?? 0, s.currency ?? 'GBP')}</span> every {s.every} to {payeeName(s.to_payee_id)} from{' '}
                    {agentName(s.from_agent_id)}
                  </span>
                  <Pill status={s.active ? 'settled' : 'idle'}>{s.active ? 'Active' : 'Stopped'}</Pill>
                </div>
                <p className="text-caption text-muted">
                  Next <span className="font-figure">{formatWhen(s.next_run_at)}</span>
                  {s.end_at ? (
                    <>
                      {' '}
                      · until <span className="font-figure">{formatWhen(s.end_at)}</span>
                    </>
                  ) : null}
                  {s.memo ? ` · ${s.memo}` : ''}
                </p>
                {s.active ? (
                  <div>
                    <Button type="button" disabled={stop.isPending} onClick={() => stop.mutate(s.id)}>
                      Stop
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-body text-muted">{schedules.isPending ? 'Reading…' : 'No standing order yet.'}</p>
        )}
        {stop.isError ? <Note ok={false}>{refusalText(stop.error)}</Note> : null}
          <form
            className="flex flex-col gap-3"
            data-testid="new-standing-order"
            onSubmit={(e) => {
              e.preventDefault()
              if (complete && !create.isPending) create.mutate()
            }}
          >
            <div className="grid gap-3 wide:grid-cols-2">
              <label className={field}>
                From
                <select aria-label="Standing order from" className={`${select} w-full`} value={account?.id ?? ''} onChange={(e) => setAccountID(e.target.value)}>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {accountName(a)}
                    </option>
                  ))}
                </select>
              </label>
              <label className={field}>
                To
                <select aria-label="Standing order to" className={`${select} w-full`} value={payeeID} onChange={(e) => setPayeeID(e.target.value)}>
                  <option value="">Choose a payee</option>
                  {payees.map((p) => (
                    <option key={p.id} value={p.id} disabled={p.needs_confirmation}>
                      {p.name}
                      {p.needs_confirmation ? ' (confirm first)' : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label className={field}>
                Amount in {account?.currency ?? 'GBP'}
                <Input aria-label="Standing order amount" inputMode="decimal" placeholder="10.00" className="font-figure" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </label>
              <label className={field}>
                Every
                <select aria-label="Every" className={`${select} w-full`} value={every} onChange={(e) => setEvery(e.target.value as AgentSchedule['every'])}>
                  {EVERY.map((x) => (
                    <option key={x} value={x}>
                      {x}
                    </option>
                  ))}
                </select>
              </label>
              <label className={field}>
                First payment on
                <Input aria-label="First payment on" type="date" className="font-figure" value={first} onChange={(e) => setFirst(e.target.value)} />
              </label>
              <label className={field}>
                Until (optional)
                <Input aria-label="Until" type="date" className="font-figure" value={end} onChange={(e) => setEnd(e.target.value)} />
              </label>
            </div>
            <Input aria-label="Standing order memo" placeholder="Memo (optional)" value={memo} onChange={(e) => setMemo(e.target.value)} />
            <div>
              <Button type="submit" disabled={!complete || create.isPending}>
                {create.isPending ? 'Setting up…' : 'Set up standing order'}
              </Button>
            </div>
            {create.isError ? <Note ok={false}>{refusalText(create.error)}</Note> : null}
            {made !== null ? (
              <Note ok>
                <span className="font-figure">{formatMinor(made.amount_minor ?? 0, made.currency ?? 'GBP')}</span> every {made.every}, first on{' '}
                <span className="font-figure">{formatWhen(made.next_run_at)}</span>.
              </Note>
            ) : null}
          </form>
      </div>
    </Card>
  )
}

/** A mandate from an agent's account: a Talyvor company or an outside business pulls within it (B30.19). */
function Mandates({
  accounts,
  payees,
  accountName,
  agentName,
}: {
  accounts: CurrencyAccount[]
  payees: OutsidePayee[]
  accountName: (a: CurrencyAccount) => string
  agentName: (id: string) => string
}) {
  const qc = useQueryClient()
  const mandates = useQuery({ queryKey: MANDATES_KEY, queryFn: agentBankApi.mandates })
  const [accountID, setAccountID] = useState(accounts[0]?.id ?? '')
  const [kind, setKind] = useState<'company' | 'business'>('business')
  const [form, setForm] = useState({ workspace: '', business: '', payee: '', name: '', pull: '', month: '', expires: inDays(365) })
  const [made, setMade] = useState<Mandate | null>(null)
  const account = accounts.find((a) => a.id === accountID) ?? accounts[0]
  const pull = minorOf(form.pull)
  const month = minorOf(form.month)
  const complete = account !== undefined && pull !== null && month !== null && form.expires !== '' &&
    (kind === 'company' ? form.workspace.trim() !== '' : form.business.trim() !== '' && form.payee !== '')
  const refresh = () => void qc.invalidateQueries({ queryKey: MANDATES_KEY })
  const grant = useMutation({
    mutationFn: () =>
      agentBankApi.grantMandate({
        account_id: account?.id ?? '',
        payee_workspace_id: kind === 'company' ? form.workspace.trim() : '',
        payee_business_id: kind === 'business' ? form.business.trim() : '',
        payee_id: kind === 'business' ? form.payee : '',
        payee_name: form.name.trim(),
        max_per_pull_minor: pull ?? 0,
        max_per_month_minor: month ?? 0,
        expires_at: `${form.expires}T23:59:59Z`,
      }),
    onSuccess: (m) => {
      setMade(m)
      setForm({ workspace: '', business: '', payee: '', name: '', pull: '', month: '', expires: inDays(365) })
      refresh()
    },
  })
  const revoke = useMutation({ mutationFn: (id: string) => agentBankApi.revokeMandate(id), onSuccess: refresh })
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }))
  const row = (m: Mandate, granted: boolean) => (
    <li key={m.id} className="flex flex-col gap-1 border-b border-rule pb-2 last:border-b-0 last:pb-0" data-testid={`mandate-${m.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-body text-ink">
        <span>
          {granted ? `${m.payee_name} pulls from ${agentName(m.agent_id)}` : `${m.payee_name} lets you pull`} · up to <span className="font-figure">{formatMinor(m.max_per_pull_minor, m.currency)}</span> a pull,{' '}
          <span className="font-figure">{formatMinor(m.max_per_month_minor, m.currency)}</span> a month
        </span>
        <Pill status={m.status === 'active' ? 'settled' : 'slashed'}>{m.status === 'active' ? 'Active' : 'Revoked'}</Pill>
      </div>
      <p className="text-caption text-muted">
        Pulled this month <span className="font-figure">{formatMinor(m.pulled_this_month_minor, m.currency)}</span> · expires{' '}
        <span className="font-figure">{formatWhen(m.expires_at)}</span>
      </p>
      {granted && m.status === 'active' ? (
        <div>
          <Button type="button" disabled={revoke.isPending} onClick={() => revoke.mutate(m.id)}>
            Revoke
          </Button>
        </div>
      ) : null}
    </li>
  )
  const granted = mandates.data?.granted ?? []
  const received = mandates.data?.received ?? []
  return (
    <Card>
      <CardHeader>Mandates</CardHeader>
      <div className="flex flex-col gap-3 px-gutter py-3">
        {mandates.isError ? (
          <p className="text-body text-muted">{readFailure(mandates.error, 'Your mandates')}</p>
        ) : granted.length > 0 ? (
          <ul className="flex flex-col gap-2" aria-label="Mandates granted">
            {granted.map((m) => row(m, true))}
          </ul>
        ) : (
          <p className="text-body text-muted">{mandates.isPending ? 'Reading…' : 'No mandate granted yet.'}</p>
        )}
        {received.length > 0 ? (
          <>
            <p className="text-caption text-label">Received</p>
            <ul className="flex flex-col gap-2" aria-label="Mandates received">
              {received.map((m) => row(m, false))}
            </ul>
          </>
        ) : null}
        {revoke.isError ? <Note ok={false}>{refusalText(revoke.error)}</Note> : null}
          <form
            className="flex flex-col gap-3"
            data-testid="new-mandate"
            onSubmit={(e) => {
              e.preventDefault()
              if (complete && !grant.isPending) grant.mutate()
            }}
          >
            <div className="grid gap-3 wide:grid-cols-2">
              <label className={field}>
                On
                <select aria-label="Mandate on" className={`${select} w-full`} value={account?.id ?? ''} onChange={(e) => setAccountID(e.target.value)}>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {accountName(a)}
                    </option>
                  ))}
                </select>
              </label>
              <label className={field}>
                Payee
                <select aria-label="Mandate payee kind" className={`${select} w-full`} value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
                  <option value="business">An outside business, paid to a saved payee</option>
                  <option value="company">A Talyvor company, by its workspace id</option>
                </select>
              </label>
              {kind === 'company' ? (
                <Input aria-label="Payee’s workspace id" placeholder="Their workspace id" className="font-figure" value={form.workspace} onChange={(e) => set({ workspace: e.target.value })} />
              ) : (
                <>
                  <Input aria-label="Business id" placeholder="The business’s id, as it names itself" className="font-figure" value={form.business} onChange={(e) => set({ business: e.target.value })} />
                  <label className={field}>
                    Paid out to
                    <select aria-label="Paid out to" className={`${select} w-full`} value={form.payee} onChange={(e) => set({ payee: e.target.value })}>
                      <option value="">Choose a saved payee</option>
                      {payees.map((p) => (
                        <option key={p.id} value={p.id} disabled={p.needs_confirmation}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}
              <Input aria-label="Payee’s name" placeholder="Payee’s name (optional)" value={form.name} onChange={(e) => set({ name: e.target.value })} />
              <label className={field}>
                Most per pull, {account?.currency ?? 'GBP'}
                <Input aria-label="Most per pull" inputMode="decimal" placeholder="5.00" className="font-figure" value={form.pull} onChange={(e) => set({ pull: e.target.value })} />
              </label>
              <label className={field}>
                Most per month, {account?.currency ?? 'GBP'}
                <Input aria-label="Most per month" inputMode="decimal" placeholder="20.00" className="font-figure" value={form.month} onChange={(e) => set({ month: e.target.value })} />
              </label>
              <label className={field}>
                Expires on
                <Input aria-label="Expires on" type="date" className="font-figure" value={form.expires} onChange={(e) => set({ expires: e.target.value })} />
              </label>
            </div>
            <div>
              <Button type="submit" disabled={!complete || grant.isPending}>
                {grant.isPending ? 'Granting…' : 'Grant mandate'}
              </Button>
            </div>
            {grant.isError ? <Note ok={false}>{refusalText(grant.error)}</Note> : null}
            {made !== null ? (
              <Note ok>
                Granted to {made.payee_name}.
                {made.pull_key ? (
                  <>
                    {' '}
                    Give the business this key once; it is not shown again: <span className="font-figure" data-testid="mandate-pull-key">{made.pull_key}</span>
                  </>
                ) : null}
              </Note>
            ) : null}
          </form>
      </div>
    </Card>
  )
}

/** A file of payouts (payee_id, amount, currency, reference), validated row by row by Lens and paid on one approval (B30.21). */
function Payouts() {
  const qc = useQueryClient()
  const batches = useQuery({ queryKey: PAYOUTS_KEY, queryFn: agentBankApi.payouts })
  const [file, setFile] = useState<File | null>(null)
  const [key, setKey] = useState(newMoveKey)
  const [made, setMade] = useState<PayoutBatch | null>(null)
  const refresh = () => void qc.invalidateQueries({ queryKey: PAYOUTS_KEY })
  const upload = useMutation({
    mutationFn: async () => agentBankApi.uploadPayouts(await (file as File).text(), key),
    onSuccess: (b) => {
      setMade(b)
      setFile(null)
      setKey(newMoveKey())
      refresh()
    },
  })
  const list = batches.data?.payouts ?? []
  return (
    <Card>
      <CardHeader>Bulk payouts</CardHeader>
      <div className="flex flex-col gap-3 px-gutter py-3">
        <form
          className="flex flex-col gap-3"
          data-testid="payout-upload"
          onSubmit={(e) => {
            e.preventDefault()
            if (file !== null && !upload.isPending) upload.mutate()
          }}
        >
          <p className="text-caption text-muted">
            A CSV with a header row (<span className="font-figure">payee_id,amount,currency,reference</span>) and up to 1,000 rows, each a saved payee’s id, an amount such as{' '}
            <span className="font-figure">12.34</span>, GBP, EUR or USD and a reference. Every row is checked before anything moves; one approval pays the valid ones from the company’s
            account.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Input aria-label="Payouts CSV" type="file" accept=".csv,text/csv" className="file:mr-3 file:border-0 file:bg-transparent file:text-caption file:text-ink" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <Button type="submit" disabled={file === null || upload.isPending}>
              {upload.isPending ? 'Checking rows…' : 'Upload and check'}
            </Button>
          </div>
          {upload.isError ? <Note ok={false}>{refusalText(upload.error)}</Note> : null}
        </form>
        {made !== null ? <Batch b={made} /> : null}
        {list.filter((b) => b.id !== made?.id).length > 0 ? (
          <ul className="flex flex-col gap-2" aria-label="Payout batches">
            {list
              .filter((b) => b.id !== made?.id)
              .map((b) => (
                <li key={b.id}>
                  <Batch b={b} />
                </li>
              ))}
          </ul>
        ) : null}
      </div>
    </Card>
  )
}

/** One batch: its counts and totals, every row's result once read, and its one approval. */
function Batch({ b }: { b: PayoutBatch }) {
  const qc = useQueryClient()
  const [shown, setShown] = useState(b.rows !== undefined && b.rows !== null)
  const detail = useQuery({ queryKey: [...PAYOUTS_KEY, b.id], queryFn: () => agentBankApi.payout(b.id), enabled: shown, initialData: b.rows ? b : undefined })
  const approve = useMutation({
    mutationFn: () => agentBankApi.approvePayout(b.id),
    onSuccess: (next) => {
      qc.setQueryData([...PAYOUTS_KEY, b.id], next)
      setShown(true)
      void qc.invalidateQueries({ queryKey: PAYOUTS_KEY })
      void qc.invalidateQueries({ queryKey: PAYMENTS_KEY })
      void qc.invalidateQueries({ queryKey: MONEY_ACCOUNTS_KEY })
    },
  })
  const batch = detail.data ?? b
  const totals = Object.entries(batch.totals_minor ?? {})
  const rows = batch.rows ?? []
  return (
    <div className="flex flex-col gap-2 rounded-card border border-rule p-3" data-testid={`payout-${b.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-body text-ink">
        <span>
          <span className="font-figure">{batch.rows_total}</span> rows: <span className="font-figure">{batch.rows_valid}</span> valid,{' '}
          <span className="font-figure">{batch.rows_invalid}</span> invalid
          {totals.length > 0 ? (
            <>
              {' '}
              · <span className="font-figure">{totals.map(([c, n]) => formatMinor(n, c)).join(', ')}</span> to pay
            </>
          ) : null}
        </span>
        <Pill status={batch.status === 'approved' ? 'settled' : batch.status === 'awaiting_approval' ? 'held' : 'idle'}>
          {batch.status === 'awaiting_approval' ? 'Awaiting approval' : batch.status === 'approved' ? 'Approved' : batch.status}
        </Pill>
      </div>
      <p className="text-caption text-muted">
        Uploaded <span className="font-figure">{formatWhen(batch.created_at)}</span>
        {batch.approved_at ? (
          <>
            {' '}
            · approved <span className="font-figure">{formatWhen(batch.approved_at)}</span>
          </>
        ) : null}
      </p>
      {shown ? (
        rows.length > 0 ? (
          <ul className="flex flex-col gap-1" aria-label="Rows">
            {rows.map((r) => (
              <li key={r.line} className="flex flex-wrap items-center justify-between gap-2 text-caption text-ink" data-testid={`payout-row-${r.line}`}>
                <span className="min-w-0">
                  <span className="font-figure">{r.line}</span> · {r.payee_name || r.payee_id}
                  {r.reference ? ` · ${r.reference}` : ''}
                  {r.detail ? <span className="text-muted"> · {r.detail}</span> : null}
                </span>
                <span className="flex items-center gap-2">
                  <span className="font-figure">{formatMinor(r.amount_minor, r.currency)}</span>
                  <Pill status={r.status === 'invalid' || r.status === 'failed' || r.status === 'returned' ? 'slashed' : r.status === 'completed' ? 'settled' : r.status === 'valid' ? 'idle' : 'held'}>
                    {r.status}
                  </Pill>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-caption text-muted">{detail.isError ? readFailure(detail.error, 'Its rows') : 'Reading rows…'}</p>
        )
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {!shown ? (
          <Button type="button" onClick={() => setShown(true)}>
            Rows
          </Button>
        ) : null}
        {batch.status === 'awaiting_approval' && batch.rows_valid > 0 ? (
          <Button type="button" disabled={approve.isPending} onClick={() => approve.mutate()}>
            {approve.isPending ? 'Paying…' : `Approve and pay ${batch.rows_valid} ${batch.rows_valid === 1 ? 'row' : 'rows'}`}
          </Button>
        ) : null}
      </div>
      {approve.isError ? <Note ok={false}>{refusalText(approve.error)}</Note> : null}
    </div>
  )
}

const PAYEE_MATCH: Record<string, { text: (name: string) => string; pill: PillStatus }> = {
  matched: { text: (name) => `Saved payee: ${name}`, pill: 'settled' },
  bank_details_differ: { text: (name) => `Bank details differ from ${name}`, pill: 'slashed' },
  new_payee: { text: () => 'New payee', pill: 'held' },
}
const MISSING: Record<string, string> = { supplier: 'supplier', amount: 'amount', currency: 'currency', due_date: 'due date', invoice_number: 'invoice number' }

/** B41.1 — the bills inbox: an invoice uploaded as a file becomes one bill, matched to a saved payee or marked a new payee (Lens B41.101). */
function Bills({ payeeName }: { payeeName: (id: string | undefined) => string }) {
  const qc = useQueryClient()
  const bills = useQuery({ queryKey: BILLS_KEY, queryFn: agentBankApi.bills })
  const [file, setFile] = useState<File | null>(null)
  const upload = useMutation({
    mutationFn: () => agentBankApi.uploadBill(file as File),
    onSuccess: () => {
      setFile(null)
      void qc.invalidateQueries({ queryKey: BILLS_KEY })
    },
  })
  const list = bills.data?.bills ?? []
  // B41.2 — pay all due: the ticked bills become one payment request (Lens B41.102), approved once on its card at /approve/<id>.
  const navigate = useNavigate()
  const [unticked, setUnticked] = useState<Set<string>>(new Set())
  const [payKey, setPayKey] = useState(newMoveKey)
  const due = list.filter(payable)
  const ticked = due.filter((b) => !unticked.has(b.id))
  const pay = useMutation({
    mutationFn: () => agentBankApi.payBills(ticked.map((b) => b.id), payKey),
    onSuccess: (r) => {
      setPayKey(newMoveKey())
      void qc.invalidateQueries({ queryKey: BILLS_KEY })
      navigate(`/approve/${encodeURIComponent(r.id)}`)
    },
  })
  return (
    <Card>
      <CardHeader>Bills inbox</CardHeader>
      <div className="flex flex-col gap-3 px-gutter py-3">
        <form
          className="flex flex-col gap-3"
          data-testid="bill-upload"
          onSubmit={(e) => {
            e.preventDefault()
            if (file !== null && !upload.isPending) upload.mutate()
          }}
        >
          <p className="text-caption text-muted">
            Add an invoice you received (a PDF, Word, HTML or text file) and Talyvor reads its supplier, amount, due date and invoice number and finds the saved payee. Bank details
            printed on an invoice are shown, never paid on their own: a bill is paid to a saved payee. The same invoice added twice is one bill.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              aria-label="Invoice file"
              type="file"
              accept=".pdf,.docx,.html,.htm,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/html,text/plain,text/markdown"
              className="file:mr-3 file:border-0 file:bg-transparent file:text-caption file:text-ink"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <Button type="submit" disabled={file === null || upload.isPending}>
              {upload.isPending ? 'Reading invoice…' : 'Add bill'}
            </Button>
          </div>
          {upload.isError ? <Note ok={false}>{refusalText(upload.error)}</Note> : null}
          {upload.isSuccess ? (
            <Note ok>{upload.data.created ? `Added: ${upload.data.bill.supplier || 'a bill'}` : `Already in your inbox: ${upload.data.bill.supplier || 'this bill'}`}</Note>
          ) : null}
        </form>
        {bills.isError ? (
          <p className="text-body text-muted">{readFailure(bills.error, 'Your bills')}</p>
        ) : bills.isPending ? (
          <p className="text-body text-muted">Reading…</p>
        ) : list.length === 0 ? (
          <p className="text-body text-muted" data-testid="bills-empty">
            No bills yet: add an invoice you received above.
          </p>
        ) : (
          <>
            <ul className="flex flex-col gap-2" aria-label="Bills">
              {list.map((b) => (
                <BillRow
                  key={b.id}
                  b={b}
                  payeeName={payeeName}
                  ticked={payable(b) ? !unticked.has(b.id) : undefined}
                  onTick={() => {
                    setUnticked((s) => (s.has(b.id) ? new Set([...s].filter((x) => x !== b.id)) : new Set(s).add(b.id)))
                    setPayKey(newMoveKey())
                  }}
                />
              ))}
            </ul>
            {due.length > 0 ? (
              <div className="flex flex-col gap-2" data-testid="bills-pay">
                <p className="text-caption text-muted">
                  Pay the bills you tick as one batch: one card shows their count, total and every payee, and you approve it once with a passkey. Each bill is then paid
                  separately, with its invoice number as the reference, and never twice.
                  {list.some((b) => b.status === 'due' && !b.payee_id) ? ' A bill whose supplier is not a saved payee can be paid once you save the supplier as a payee.' : ''}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant="primary" disabled={ticked.length === 0 || pay.isPending} onClick={() => pay.mutate()}>
                    {pay.isPending ? 'Preparing…' : `Pay ${ticked.length === 1 ? '1 bill' : `${ticked.length} bills`}`}
                  </Button>
                  {ticked.length > 0 ? (
                    <span className="text-caption text-muted" data-testid="bills-pay-total">
                      Total <span className="font-figure">{totalOf(ticked)}</span>
                    </span>
                  ) : (
                    <span className="text-caption text-muted">Tick at least one bill.</span>
                  )}
                </div>
                {pay.isError ? <Note ok={false}>{refusalText(pay.error)}</Note> : null}
              </div>
            ) : null}
          </>
        )}
      </div>
    </Card>
  )
}

/** B41.2 — a bill Lens can pay: still due, its amount read, and its supplier a saved payee (never the details printed on it). */
const payable = (b: Bill) => b.status === 'due' && !!b.payee_id && b.amount_minor > 0 && !!b.currency

/** Totals by currency, as one line: "£12.00, €3.00". */
const totalOf = (bills: Bill[]) =>
  Object.entries(bills.reduce<Record<string, number>>((t, b) => ({ ...t, [b.currency]: (t[b.currency] ?? 0) + b.amount_minor }), {}))
    .map(([cur, minor]) => formatMinor(minor, cur))
    .join(', ')

function BillRow({ b, payeeName, ticked, onTick }: { b: Bill; payeeName: (id: string | undefined) => string; ticked?: boolean; onTick: () => void }) {
  const match = PAYEE_MATCH[b.payee_match] ?? { text: () => b.payee_match, pill: 'idle' as PillStatus }
  const missing = (b.missing ?? []).map((m) => MISSING[m] ?? m)
  const printed = b.iban ? `${b.iban}${b.bic ? ` · ${b.bic}` : ''}` : b.routing_number ? `${b.routing_number} · ${b.account_number ?? ''}` : b.sort_code ? `${b.sort_code} · ${b.account_number ?? ''}` : ''
  return (
    <LinkedItem id={`bill-${b.id}`} className="flex flex-col gap-1 rounded-card border border-rule p-3" data-testid={`bill-${b.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-body text-ink">
        <span className="flex min-w-0 items-center gap-2">
          {ticked !== undefined ? (
            <input
              type="checkbox"
              className={`h-4 w-4 shrink-0 accent-accent transition-colors duration-200 hover:border-rule-strong disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`}
              checked={ticked}
              onChange={onTick}
              aria-label={`Pay ${formatMinor(b.amount_minor, b.currency)} to ${b.supplier || 'this supplier'}`}
            />
          ) : null}
          <span className="min-w-0">
            {b.supplier || 'Supplier not read'}
            {b.invoice_number ? (
              <>
                {' '}
                · <span className="font-figure">{b.invoice_number}</span>
              </>
            ) : null}
          </span>
        </span>
        <span className="flex items-center gap-2">
          {b.amount_minor > 0 && b.currency ? <span className="font-figure">{formatMinor(b.amount_minor, b.currency)}</span> : null}
          <Pill status={b.status === 'paid' ? 'settled' : 'held'}>{b.status === 'paid' ? 'Paid' : 'Due'}</Pill>
        </span>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-caption text-muted">
        <span>
          {b.due_date ? (
            <>
              Due <span className="font-figure">{b.due_date}</span>
            </>
          ) : (
            'No due date read'
          )}
          {printed ? (
            <>
              {' '}
              · printed details <span className="font-figure">{printed}</span>
            </>
          ) : null}
        </span>
        <Pill status={match.pill}>{match.text(payeeName(b.payee_id))}</Pill>
      </div>
      {missing.length > 0 ? <p className="text-caption text-muted">Could not read: {missing.join(', ')}</p> : null}
    </LinkedItem>
  )
}
