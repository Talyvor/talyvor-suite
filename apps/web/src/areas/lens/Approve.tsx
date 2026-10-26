import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, CardHeader, Pill, focusRing } from '@talyvor/ui'
import { Card } from './walletBrand'
import { Region, RegionScreen } from '../../components/Region'
import { formatWhen } from './format'
import { Note, readFailure } from './WalletMoney'
import { BOOK_KEY } from './AgentBank'
import { BILLS_KEY, PAYEES_KEY, PAYMENTS_KEY } from './Pay'
import { assertOver } from './passkeys'
import { AgentBankError, type ApprovalStatement, type PaymentRequest, type PaymentRequestItem, agentBankApi, formatMinor, refusalText } from './agentBankApi'

// Approve.tsx — B40.9: /approve/<id>, the page a prepared request's approval link opens (Lens B40.3) — from Chat, an
// assistant over /mcp, or a push notification in the installed app. One card: every item with its payee (known or new,
// verified or not), amount and reference, where the money comes from and the rule that asked; the person unticks what
// they will not pay and approves the rest with one passkey over the statement Lens writes for exactly those (B40.5).

export const paymentRequestKey = (id: string) => ['money-payment-request', id]

const DECIDED: Record<string, string> = {
  approved: 'Approved. Each payment you approved is paid once.',
  cancelled: 'This request was cancelled. Nothing will be paid.',
  auto: 'Nothing here needs your approval: each payment is inside a mandate you signed.',
  blocked: 'Nothing here can be paid: every payment was blocked.',
}

/** Who prepared it, in words: Lens names the client "chat", "voice", "mcp:<client id>" or "key:<key id>" (B40.3). */
const askedBy = (client: string) =>
  client.startsWith('mcp:') ? 'an assistant you connected' : client.startsWith('key:') ? 'an agent' : client === 'chat' ? 'Chat' : client === 'voice' ? 'a voice request' : client

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

export function ApproveScreen() {
  const { id = '' } = useParams()
  const request = useQuery({ queryKey: paymentRequestKey(id), queryFn: () => agentBankApi.paymentRequest(id) })
  return (
    <RegionScreen>
      <Region index="00" label="Approve" heading="Approve payments" sectionClassName="pb-10 pt-4 wide:pb-12" className="flex max-w-2xl flex-col gap-3">
        {request.isError || (request.isSuccess && !Array.isArray(request.data.items)) ? (
          <p className="text-body text-muted">
            {request.error instanceof AgentBankError && request.error.status === 404
              ? 'There is no request at this address. It may belong to another workspace.'
              : readFailure(request.error, 'This request')}
          </p>
        ) : request.isPending ? (
          <p className="text-body text-muted">Reading…</p>
        ) : (
          <ApprovalCard id={id} request={request.data} />
        )}
      </Region>
    </RegionScreen>
  )
}

/** B40.12 — also the card Chat shows for a payment it prepared. */
export function ApprovalCard({ id, request: r }: { id: string; request: PaymentRequest }) {
  const qc = useQueryClient()
  const payees = useQuery({ queryKey: PAYEES_KEY, queryFn: agentBankApi.payees })
  const payments = useQuery({ queryKey: PAYMENTS_KEY, queryFn: agentBankApi.payments })
  const book = useQuery({ queryKey: BOOK_KEY, queryFn: agentBankApi.book })
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
    },
  })
  // B45.2 — declined: Lens cancels the request, so none of it is paid.
  const decline = useMutation({
    mutationFn: () => agentBankApi.cancelRequest(r.id),
    onSuccess: (done) => qc.setQueryData(paymentRequestKey(r.id), done),
  })

  // Known and verified are read from the payees and past payments; unread, they are not claimed either way.
  const checked = payees.isSuccess && payments.isSuccess
  const unread = payees.isError || payments.isError
  const saved = payees.data?.payees ?? []
  const paidBefore = new Set((payments.data?.payments ?? []).filter((p) => p.status === 'completed').map((p) => p.payee_id))
  const agent = r.agent_id ? (book.data?.agents?.find((a) => a.id === r.agent_id)?.name ?? r.agent_id) : ''
  const pending = r.status === 'pending_approval'

  return (
    <Card>
      <CardHeader>{r.summary || 'Payments waiting for your approval'}</CardHeader>
      <div className="flex flex-col gap-3 px-gutter py-3" data-testid="approve-card">
        <p className="flex flex-wrap items-center gap-2 text-caption text-ink">
          <span>
            From {agent ? `${agent}’s account` : 'the company’s account'} · asked by {askedBy(r.client)} ·{' '}
            <span className="font-figure">{formatWhen(r.created_at)}</span>
          </span>
        </p>
        {pending ? (
          <p className="text-body text-ink" data-testid="approve-total">
            <span className="font-figure">{ticked.length}</span> of <span className="font-figure">{asked.length}</span> {asked.length === 1 ? 'payment' : 'payments'} to approve
            {ticked.length > 0 ? (
              <>
                , total <span className="font-figure">{totalsOf(ticked)}</span>
              </>
            ) : null}
          </p>
        ) : (
          <Note ok={r.status === 'approved'}>{DECIDED[r.status] ?? r.status}</Note>
        )}
        {unread ? <p className="text-caption text-muted">Whether each payee is new or verified could not be read just now.</p> : null}
        <ul className="flex flex-col divide-y divide-rule">
          {r.items.map((it) => {
            const payee = saved.find((p) => p.id === it.payee_id)
            const verified = payee ? payee.check === 'exact_match' || !!payee.confirmed_at : false
            const choosable = pending && it.decision === 'needs_approval'
            return (
              <li key={it.position} className="flex gap-3 py-3" data-testid={`approve-item-${it.position}`}>
                {choosable ? (
                  <input
                    type="checkbox"
                    className={`mt-1 h-4 w-4 shrink-0 accent-accent transition-colors duration-200 hover:border-rule-strong disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`}
                    checked={!unticked.has(it.position)}
                    onChange={() => toggle(it.position)}
                    aria-label={`Approve ${formatMinor(it.amount_minor, it.currency)} to ${it.payee_name}`}
                  />
                ) : null}
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-body text-ink">{it.payee_name || it.listing_id}</span>
                    <span className="font-figure text-body text-ink">{formatMinor(it.amount_minor, it.currency)}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-caption text-muted">
                    {it.payee_id && checked ? (
                      <>
                        {/* Lens's flags say a first payment itself (B41.103); older requests carry none. */}
                        {it.flags ? null : <Pill status={paidBefore.has(it.payee_id) ? 'settled' : 'held'}>{paidBefore.has(it.payee_id) ? 'Known payee' : 'New payee'}</Pill>}
                        <Pill status={verified ? 'settled' : 'held'}>{verified ? 'Verified' : 'Not verified'}</Pill>
                      </>
                    ) : null}
                    {(it.flags ?? []).map((f) => (
                      <Pill key={f.code} status={FLAGS[f.code]?.needsReason ? 'slashed' : 'held'}>
                        {FLAGS[f.code]?.label ?? f.code}
                      </Pill>
                    ))}
                    {it.reference ? <span className="break-all">Reference: {it.reference}</span> : null}
                  </div>
                  {(it.flags ?? []).map((f) => (
                    <p key={f.code} className="text-caption text-muted" data-testid={`approve-flag-${it.position}-${f.code}`}>
                      {f.detail.charAt(0).toUpperCase() + f.detail.slice(1)}.
                    </p>
                  ))}
                  <p className="text-caption text-muted">
                    {it.decision === 'auto'
                      ? 'Inside a mandate you signed: paid with this request, no approval needed.'
                      : it.decision === 'blocked'
                        ? `Blocked: ${it.reason}.`
                        : `Asks for approval: ${it.reason}.`}
                    {it.rule ? <span className="font-figure"> ({it.rule})</span> : null}
                  </p>
                  {it.pay_status ? <p className="text-caption text-ink">Payment: {it.pay_status}</p> : null}
                </div>
              </li>
            )
          })}
        </ul>
        {pending && reasonNeeded ? (
          <label className="flex flex-col gap-1 text-caption text-ink">
            A payment you ticked may be a duplicate or has changed bank details. Say why you are paying it: your reason is signed with the approval.
            <textarea
              rows={2}
              maxLength={500}
              placeholder="Why this is right to pay"
              className={`w-full rounded-control border border-rule bg-surface p-3 text-body text-ink placeholder:text-faint transition-colors duration-200 hover:border-rule-strong disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`}
              value={why}
              onChange={(e) => setWhy(e.target.value)}
            />
          </label>
        ) : null}
        {pending ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="primary" disabled={ticked.length === 0 || (reasonNeeded && !reason) || approve.isPending || decline.isPending} onClick={() => approve.mutate()}>
              {approve.isPending ? 'Approving…' : `Approve ${ticked.length === 1 ? '1 payment' : `${ticked.length} payments`} with a passkey`}
            </Button>
            <Button type="button" disabled={approve.isPending || decline.isPending} onClick={() => decline.mutate()}>
              {decline.isPending ? 'Declining…' : 'Decline'}
            </Button>
            {ticked.length === 0 ? <span className="text-caption text-muted">Tick at least one payment.</span> : reasonNeeded && !reason ? <span className="text-caption text-muted">Give a reason first.</span> : null}
          </div>
        ) : null}
        {approve.isError ? (
          <Note ok={false}>
            {approve.error instanceof Error && approve.error.message === 'mismatch'
              ? 'What you were asked to sign is not what is shown here, so nothing was signed. Reload the page.'
              : refusalText(approve.error)}
          </Note>
        ) : null}
        {decline.isError ? <Note ok={false}>{refusalText(decline.error)}</Note> : null}
      </div>
    </Card>
  )
}
