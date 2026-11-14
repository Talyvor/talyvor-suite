import { Fragment, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { inlineLink } from '@talyvor/ui'
import { Button, Card, Facts, Icon, KindTile, pocketFocusRing } from '@talyvor/ui/pocket'
import { formatWhen } from './format'
import { readFailure } from './WalletMoney'
import { BOOK_KEY, OnThePhone, PREPARED_KEY, useKeys } from './AgentBank'
import { BILLS_KEY, PAYEES_KEY, PAYMENTS_KEY } from './Pay'
import { assertOver } from './passkeys'
import { WorkspaceLabel, paymentRequestCapabilities } from '../../labels/workspace'
import { AgentBankError, type AgentTrust, type ApprovalStatement, type PaymentRequest, type PaymentRequestItem, agentBankApi, formatMinor, refusalText } from './agentBankApi'

// Approve.tsx — B40.9: /approve/<id>, the page a prepared request's approval link opens (Lens B40.3) — from Chat, an
// assistant over /mcp, or a push notification in the installed app. One card: every item with its payee (known or new,
// verified or not), amount and reference, where the money comes from and the rule that asked; the person unticks what
// they will not pay and approves the rest with one passkey over the statement Lens writes for exactly those (B40.5).

export const paymentRequestKey = (id: string) => ['money-payment-request', id]

const DECIDED: Record<string, string> = {
  approved: 'Approved. Each payment you approved is paid once.',
  auto: 'Paid without asking you: each payment is inside a permission you signed.',
  blocked: 'Nothing here can be paid: every payment was blocked.',
  // B55.10 — Lens reads a request nobody answered within its approval life as expired (B55.9).
  expired: 'This request expired: nobody approved it within 24 hours. Nothing waiting was paid.',
}

/** B55.33 — a decided request in one line; a status Lens adds later reads as closed, never as its code. */
export const decidedLine = (status: string) => DECIDED[status] ?? 'This request is closed.'

/** B55.33 — each item's payment in words, as on the phone (B55.11); a status Lens adds later is "Not paid yet". */
export function payWords(it: PaymentRequestItem): string {
  switch (it.pay_status) {
    case 'pending':
      return 'On its way'
    case 'sent':
      return 'Sent'
    case 'completed':
      return 'Paid'
    case 'failed':
      return 'Not paid: it failed'
    case 'returned':
      return 'Came back'
    case 'refused':
      return it.pay_detail ? `Not paid: ${it.pay_detail}` : 'Not paid'
    case 'not_approved':
      return 'Not paid: you left it out'
    case 'not_paid':
      return 'Not paid: a marketplace purchase is not paid from here yet'
    default:
      return 'Not paid yet'
  }
}

/** B55.22 — Decline cancels only what waits: a covered item paid when it was prepared (B55.21) stays paid, and is said. */
export function declined(r: PaymentRequest): string {
  const n = r.items.filter((it) => it.decision === 'auto' && it.payment_id).length
  return `Declined. Nothing that waited for you will be paid.${n > 0 ? ` ${n} inside a permission you signed ${n === 1 ? 'was' : 'were'} paid.` : ''}`
}

/** Who prepared it, in words: Lens names the client "chat", "voice", "mcp:<client id>" or "key:<key id>" (B40.3). */
const askedBy = (client: string) =>
  client.startsWith('mcp:') ? 'an assistant you connected' : client.startsWith('key:') ? 'an agent' : client === 'chat' ? 'Chat' : client === 'voice' ? 'a voice request' : client

/** B45.25 — who an outside agent is, in plain words. Built from the level, never from Lens's label, so "Verified agent of"
 * can only appear for the verified level. */
function trustWords(t: AgentTrust): { who: string; detail: string } {
  if (t.level === 'verified' && t.business && t.domain)
    return { who: `Verified agent of ${t.business}`, detail: `Talyvor has checked that ${t.domain}, which signed this request, belongs to ${t.business.replace(/\.$/, '')}.` }
  if ((t.level === 'verified' || t.level === 'signed') && t.domain)
    return { who: `Signed by ${t.domain} (business not checked)`, detail: `That proves only where the request came from: Talyvor has not checked the business behind ${t.domain}.` }
  return { who: 'Unverified agent', detail: 'This request was not signed, so Talyvor cannot tell who sent it.' }
}

/** Totals by currency, as one line: "£12.00, €3.00". */
export const totalsOf = (items: PaymentRequestItem[]) =>
  Object.entries(items.reduce<Record<string, number>>((t, it) => ({ ...t, [it.currency]: (t[it.currency] ?? 0) + it.amount_minor }), {}))
    .map(([cur, minor]) => formatMinor(minor, cur))
    .join(', ')

/** B41.3 — each risk Lens found on an item (B41.103), in words; a duplicate or changed bank details needs a reason to approve. */
const FLAGS: Record<string, { label: string; needsReason: boolean }> = {
  duplicate: { label: 'Possible duplicate', needsReason: true },
  bank_details_changed: { label: 'Bank details changed', needsReason: true },
  first_payment: { label: 'First payment', needsReason: false },
  unusual_amount: { label: 'Unusual amount', needsReason: false },
}
const needsReason = (it: PaymentRequestItem) => (it.flags ?? []).some((f) => FLAGS[f.code]?.needsReason)

/** The statement Lens wrote is what the passkey signs: refuse to sign one that is not exactly the ticked payments and reason. */
function sameAsShown(statement: string, shown: PaymentRequestItem[], reason: string): boolean {
  const s = JSON.parse(statement) as ApprovalStatement
  if ((s.reason ?? '') !== reason) return false
  const key = (x: { position: number; payee_id: string; currency: string; amount_minor: number; reference: string }) =>
    [x.position, x.payee_id, x.currency, x.amount_minor, x.reference].join('\u0000')
  const want = shown.map(key).sort()
  const got = (s.items ?? []).map(key).sort()
  return want.length === got.length && want.every((k, i) => k === got[i])
}

/** B57.27 — the card's heading: Lens's summary in words (B55.32), or the payment itself where Lens wrote one for machines. */
export function headingOf(r: PaymentRequest): string {
  if (r.summary && !/item\(s\)/.test(r.summary)) return r.summary
  const [only] = r.items
  if (r.items.length === 1 && only) return `Pay ${only.payee_name || only.listing_id} ${formatMinor(only.amount_minor, only.currency)}`
  return r.items.length > 0 ? `Pay ${r.items.length} payments, ${totalsOf(r.items)}` : 'Payments waiting for your approval'
}

/** B57.27 — what an approval paid, in one line: "Approved with your passkey: $180.00 to Northwind Data." */
export function approvedLine(r: PaymentRequest): string {
  const each = r.items
    .filter((it) => it.decision === 'needs_approval' && it.pay_status !== 'not_approved')
    .map((it) => `${formatMinor(it.amount_minor, it.currency)} to ${it.payee_name || it.listing_id}`)
  const last = each.pop()
  if (last === undefined) return decidedLine('approved')
  return `Approved with your passkey: ${each.length > 0 ? `${each.join(', ')} and ` : ''}${last}.`
}

const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export function ApproveScreen() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { key } = useLocation()
  const request = useQuery({ queryKey: paymentRequestKey(id), queryFn: () => agentBankApi.paymentRequest(id) })
  // B57.27 — Pocket's w-approve-req: the shell's h1, this page's line and Back, the prepared card, then How it is paid.
  return (
    <div className="grid min-w-0 gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-reading text-ink-2">A payment Chat or a connected assistant prepared. Nothing is paid until you approve it.</p>
        {/* Back to wherever the link was pressed; an address opened on its own goes to Approvals. */}
        <Button variant="secondary" icon={<Icon name="chev" className="rotate-180" />} onClick={() => (key === 'default' ? navigate('/approvals') : navigate(-1))}>
          Back
        </Button>
      </div>
      <div className="grid items-start gap-4 wide:grid-cols-12">
        <div className="min-w-0 wide:col-span-7">
          {request.isError || (request.isSuccess && !Array.isArray(request.data.items)) ? (
            <p className="text-body text-ink-2">
              {request.error instanceof AgentBankError && request.error.status === 404
                ? 'There is no request at this address. It may belong to another workspace.'
                : readFailure(request.error, 'This request')}
            </p>
          ) : request.isPending ? (
            <p className="text-body text-ink-2">Reading…</p>
          ) : (
            <ApprovalCard id={id} request={request.data} />
          )}
        </div>
        <HowItIsPaid />
      </div>
    </div>
  )
}

function HowItIsPaid() {
  const { onlyThePhone } = useKeys()
  return (
    <section aria-labelledby="how-it-is-paid" className="wide:col-span-5">
      <Card className="grid gap-3">
        <h2 id="how-it-is-paid" className="font-display text-reading font-bold text-ink">
          How it is paid
        </h2>
        <p className="text-body text-ink-2">
          {onlyThePhone
            ? 'Your phone approves the payments you tick, and each is paid once, from the account it names.'
            : 'One passkey approves the payments you tick, and each is paid once, from the account it names.'}{' '}
          A payment inside a permission you signed is paid without asking.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="secondary" size="sm">
            <Link to="/money/pay">Payments out</Link>
          </Button>
          <Button asChild variant="secondary" size="sm">
            <Link to="/settings/connect">Connect your AI</Link>
          </Button>
        </div>
      </Card>
    </section>
  )
}

/** B40.12 — also the card Chat shows for a payment it prepared. B57.27 — drawn in Pocket (w-approve-req). */
export function ApprovalCard({ id, request: r }: { id: string; request: PaymentRequest }) {
  const qc = useQueryClient()
  const payees = useQuery({ queryKey: PAYEES_KEY, queryFn: agentBankApi.payees })
  const payments = useQuery({ queryKey: PAYMENTS_KEY, queryFn: agentBankApi.payments })
  const book = useQuery({ queryKey: BOOK_KEY, queryFn: agentBankApi.book })
  // B55.2 — with the phone's key alone no passkey here can sign the statement, so nothing is asked of this browser.
  const { hold, onlyThePhone } = useKeys()
  const asked = r.items.filter((it) => it.decision === 'needs_approval')
  const [unticked, setUnticked] = useState<Set<number>>(new Set())
  const [ticksOf, setTicksOf] = useState(id)
  if (ticksOf !== id) {
    setTicksOf(id)
    setUnticked(new Set())
  }
  const ticked = asked.filter((it) => !unticked.has(it.position))
  const [why, setWhy] = useState('')
  const reasonNeeded = ticked.some(needsReason)
  const reason = reasonNeeded ? why.trim() : ''
  const toggle = (p: number) => setUnticked((s) => (s.has(p) ? new Set([...s].filter((x) => x !== p)) : new Set(s).add(p)))

  const approve = useMutation({
    mutationFn: async () => {
      const prepared = await agentBankApi.requestApproval(r.id, ticked.map((it) => it.position), reason)
      if (!sameAsShown(prepared.statement, ticked, reason)) throw new Error('mismatch')
      return agentBankApi.approveRequest(r.id, prepared.statement, await assertOver(prepared))
    },
    onSuccess: (done) => {
      qc.setQueryData(paymentRequestKey(r.id), done)
      // B41.2 — a request made of bills marks each bill it paid as paid.
      void qc.invalidateQueries({ queryKey: BILLS_KEY })
      void qc.invalidateQueries({ queryKey: PAYMENTS_KEY })
      void qc.invalidateQueries({ queryKey: PREPARED_KEY })
    },
  })
  // B45.2 — declined: Lens cancels what waits, so none of that is paid (a covered item paid at prepare stays paid, B55.21).
  const decline = useMutation({
    mutationFn: () => agentBankApi.cancelRequest(r.id),
    onSuccess: (done) => {
      qc.setQueryData(paymentRequestKey(r.id), done)
      void qc.invalidateQueries({ queryKey: PREPARED_KEY })
    },
  })

  // Known and verified are read from the payees and past payments; unread, they are not claimed either way.
  const checked = payees.isSuccess && payments.isSuccess
  const unread = payees.isError || payments.isError
  const saved = payees.data?.payees ?? []
  const paidBefore = new Set((payments.data?.payments ?? []).filter((p) => p.status === 'completed').map((p) => p.payee_id))
  const agent = r.agent_id ? (book.data?.agents?.find((a) => a.id === r.agent_id)?.name ?? r.agent_id) : ''
  const pending = r.status === 'pending_approval'
  const trust = r.agent_trust ? trustWords(r.agent_trust) : null
  const busy = approve.isPending || decline.isPending
  const outcome =
    r.status === 'cancelled' ? declined(r) : r.status === 'approved' ? approvedLine(r) : decidedLine(r.status)

  return (
    // Drawn in Pocket wherever it shows, Chat's thread included, so it is held to Pocket's rules there too.
    <Card tone="white" className="relative grid gap-4 overflow-hidden rounded-sheet pt-6.5" data-testid="approve-card" data-design="pocket">
      {/* pocket.css .sheet: the prepared card wears the approval sheet's tangerine top edge. */}
      <span aria-hidden="true" className="absolute inset-x-0 top-0 h-1.75 bg-tangerine" />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <KindTile on="white" icon={<Icon name={r.client === 'chat' ? 'chat' : 'payments'} />} />
          <div className="min-w-0">
            <h2 className="break-words font-semibold text-ink">{headingOf(r)}</h2>
            <p className="text-caption text-ink-3">
              From {agent ? `${agent}’s account` : 'the company’s account'} · asked by {askedBy(r.client)} · <span className="font-figure">{formatWhen(r.created_at)}</span>
            </p>
          </div>
        </div>
        <WorkspaceLabel capability={paymentRequestCapabilities(r)} />
      </div>
      {trust ? (
        <div className="grid gap-1" data-testid="approve-trust">
          <p className="break-words text-body font-semibold text-ink">{trust.who}</p>
          <p className="text-caption text-ink-3">{trust.detail}</p>
        </div>
      ) : null}
      {pending && asked.length > 1 ? (
        <p className="text-body text-ink" data-testid="approve-total">
          <span className="font-figure">{ticked.length}</span> of <span className="font-figure">{asked.length}</span> payments to approve
          {ticked.length > 0 ? (
            <>
              , total <span className="font-figure">{totalsOf(ticked)}</span>
            </>
          ) : null}
        </p>
      ) : null}
      {unread ? <p className="text-caption text-ink-3">Whether each payee is new or verified could not be read just now.</p> : null}
      <ul className="grid gap-3">
        {r.items.map((it) => {
          const payee = saved.find((p) => p.id === it.payee_id)
          const verified = payee ? payee.check === 'exact_match' || !!payee.confirmed_at : false
          const choosable = pending && !hold && it.decision === 'needs_approval'
          // Lens's flags say a first payment itself (B41.103); for an older request with none, it is read from past payments.
          const first = it.flags ? it.flags.some((f) => f.code === 'first_payment') : checked && !!it.payee_id && !paidBefore.has(it.payee_id)
          const words = [
            ...(it.payee_id && checked ? [payee ? 'Known payee' : 'New payee', verified ? 'Verified' : 'Not verified'] : []),
            ...(first ? ['First payment'] : []),
            // B55.33 — a flag Lens adds later has no label here: its words still show below.
            ...(it.flags ?? []).filter((f) => f.code !== 'first_payment' && FLAGS[f.code]).map((f) => FLAGS[f.code].label),
          ]
          const facts: { label: React.ReactNode; value: React.ReactNode }[] = [
            {
              label: 'To',
              value: (
                <span className="inline-flex flex-wrap items-center justify-end gap-x-1.5 gap-y-1 font-sans font-normal">
                  {choosable ? (
                    // pocket.css .pick.tick: the tick that says this payment is among those the passkey signs.
                    <button
                      type="button"
                      aria-pressed={!unticked.has(it.position)}
                      aria-label={`Pay ${it.payee_name}, ${unticked.has(it.position) ? 'not ticked' : 'ticked'}`}
                      disabled={busy}
                      onClick={() => toggle(it.position)}
                      className={`grid h-5 w-5 shrink-0 place-items-center rounded-tile transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50 ${unticked.has(it.position) ? 'bg-page shadow-edge' : 'bg-primary text-on-primary'} ${pocketFocusRing}`}
                    >
                      {unticked.has(it.position) ? null : <Icon name="check" size={14} />}
                    </button>
                  ) : null}
                  <span className="font-semibold">{it.payee_name || it.listing_id}</span>
                  {words.map((w) => (
                    <Fragment key={w}>
                      {' · '}
                      <span>{w}</span>
                    </Fragment>
                  ))}
                </span>
              ),
            },
            { label: 'Amount', value: <span className="font-figure">{formatMinor(it.amount_minor, it.currency)}</span> },
          ]
          if (it.reference) facts.push({ label: 'Reference', value: <span className="break-all font-sans font-normal">{it.reference}</span> })
          if (it.decision === 'needs_approval' && it.reason) facts.push({ label: 'Why it asks', value: <span className="font-sans font-normal">{sentence(it.reason)}</span> })
          if (it.pay_status && it.pay_status !== 'held') facts.push({ label: 'Payment', value: <span className="font-sans">{payWords(it)}</span> })
          return (
            <li key={it.position} className="grid gap-2" data-testid={`approve-item-${it.position}`}>
              <Facts facts={facts} />
              {(it.flags ?? []).filter((f) => f.code !== 'first_payment').map((f) => (
                <p key={f.code} className="text-caption text-ink-2" data-testid={`approve-flag-${it.position}-${f.code}`}>
                  {sentence(f.detail)}.
                </p>
              ))}
              {it.decision === 'auto' ? (
                <p className="text-caption text-ink-2">Inside a permission you signed: paid without asking you.</p>
              ) : it.decision === 'blocked' ? (
                <p className="text-caption text-ink-2">Blocked: {it.reason}.</p>
              ) : null}
              {it.pay_status === 'held' ? (
                <p className="text-caption text-ink">
                  Payment: held for 24 hours, as {it.payee_name} is a new payee.{' '}
                  <Link className={inlineLink} to={`/money/pay#payee-${it.payee_id}`}>
                    Called them? Pay it now
                  </Link>
                </p>
              ) : null}
            </li>
          )
        })}
      </ul>
      {pending && !hold && reasonNeeded ? (
        <label className="grid gap-1.5 text-body text-ink-2">
          A payment you ticked may be a duplicate or has changed bank details. Say why you are paying it: your reason is signed with the approval.
          <textarea
            rows={2}
            maxLength={500}
            placeholder="Why this is right to pay"
            className={`w-full rounded-control bg-page p-3.5 text-reading text-ink shadow-edge placeholder:text-faint transition-colors duration-200 hover:border-rule-strong disabled:cursor-not-allowed disabled:opacity-50 ${pocketFocusRing}`}
            value={why}
            onChange={(e) => setWhy(e.target.value)}
          />
        </label>
      ) : null}
      {pending && onlyThePhone ? <OnThePhone>Approve this on your phone: it is waiting in Talyvor there.</OnThePhone> : null}
      {pending && !hold ? (
        <div className="grid gap-2">
          <div className="flex flex-wrap gap-2">
            <Button className="flex-1" icon={<Icon name="key" />} disabled={ticked.length === 0 || (reasonNeeded && !reason) || busy} onClick={() => approve.mutate()}>
              {approve.isPending ? 'Approving…' : `Approve ${ticked.length === 1 ? '1 payment' : `${ticked.length} payments`} with your passkey`}
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => decline.mutate()}>
              {decline.isPending ? 'Declining…' : 'Decline'}
            </Button>
          </div>
          {ticked.length === 0 ? <p className="text-caption text-ink-3">Tick at least one payment.</p> : reasonNeeded && !reason ? <p className="text-caption text-ink-3">Give a reason first.</p> : null}
        </div>
      ) : null}
      {pending ? null : (
        <p role="status" className="text-body font-semibold text-ink">
          {outcome}
        </p>
      )}
      {approve.isError ? (
        <p role="alert" className="text-body text-ink">
          {approve.error instanceof Error && approve.error.message === 'mismatch'
            ? 'What you were asked to sign is not what is shown here, so nothing was signed. Reload the page.'
            : refusalText(approve.error)}
        </p>
      ) : null}
      {decline.isError ? (
        <p role="alert" className="text-body text-ink">
          {refusalText(decline.error)}
        </p>
      ) : null}
    </Card>
  )
}
