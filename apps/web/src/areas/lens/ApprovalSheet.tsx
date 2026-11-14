import { useId, useState } from 'react'
import { Link, useLocation, useNavigate, type To } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { inlineLink } from '@talyvor/ui'
import { Button, Dialog, Face, Field, Input, Layer, Money, SheetFrame, pocketFocusRing, showSnack } from '@talyvor/ui/pocket'
import { WorkspaceLabel, approvalCapability } from '../../labels/workspace'
import { isSessionExpired } from '../../lib/productState'
import { APPROVALS_KEY, BOOK_KEY, OnThePhone, rulesKey, useKeys } from './AgentBank'
import { type AgentApproval, agentBankApi } from './agentBankApi'
import { lxcPartOf, useMoney } from './money'
import { signApproval } from './passkeys'

// ApprovalSheet.tsx — B57.15: the approval sheet (Pocket w-home+sheet-A, w-home+sheet-L), over the page you are on.
// ?approval=<id> on any page opens it, for links from pushes and emails, and so does /approvals#approval-<id>, the
// address B55.2's notifications open. It says what pays (Lens B57.11's paid_from), why it asks, the budget left after
// and when it expires; Approve and Decline are each signed over the approval's own challenge, as Approvals' rows are.

/** The approval whose sheet is open on this page, if any. */
function useOpenApproval(): string | null {
  const { pathname, search, hash } = useLocation()
  const asked = new URLSearchParams(search).get('approval')
  if (asked) return asked
  if (pathname === '/approvals' && hash.startsWith('#approval-')) return decodeURIComponent(hash.slice('#approval-'.length))
  return null
}

/** The address that opens approval `id`'s sheet over the page at `pathname` and `search`; with `decline`, on its Decline form (B57.17's d key). */
export function approvalSheetTo({ pathname, search }: { pathname: string; search: string }, id: string, decline = false): To {
  const q = new URLSearchParams(search)
  q.set('approval', id)
  if (decline) q.set('decline', '1')
  else q.delete('decline')
  return { pathname, search: `?${q}` }
}

/** Mounted once on every signed-in page: the sheet, while the address asks for one. */
export function ApprovalSheetHost() {
  const id = useOpenApproval()
  const { pathname, search } = useLocation()
  const navigate = useNavigate()
  if (id === null) return null
  const close = () => {
    const q = new URLSearchParams(search)
    q.delete('approval')
    q.delete('decline')
    const rest = q.toString()
    navigate({ pathname, search: rest ? `?${rest}` : '' }, { replace: true })
  }
  return <ApprovalSheet key={id} id={id} declining={new URLSearchParams(search).get('decline') === '1'} onClose={close} />
}

/** "Tomorrow at 09:17", "Today at 18:02" or "16 Nov at 09:17", on this device's clock. */
export function expiresText(iso: string, now = new Date()): string {
  const d = new Date(iso)
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const at = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })
  const ahead = Math.round((day(d) - day(now)) / 86_400_000)
  if (ahead === 0) return `Today at ${at}`
  if (ahead === 1) return `Tomorrow at ${at}`
  return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} at ${at}`
}

/** What went wrong, in words: never Lens's sentence or a µLXC count (problem 8). */
function refusal(err: unknown): string {
  if (err instanceof DOMException && err.name === 'NotAllowedError') return 'Cancelled. Nothing changed.'
  if (isSessionExpired(err)) return 'Nothing was decided. Sign in again, then try once more.'
  return 'Nothing was decided. You can try again.'
}

const DECIDED: Record<string, string> = { approved: 'approved', used: 'approved and used', denied: 'declined' }

/** The frame while there is no approval to fill it: reading, unreadable, or not this workspace's. */
function SheetLine({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <Layer label="Approval" onClose={onClose}>
      <SheetFrame head={<span className="font-semibold text-ink">Approval</span>} amount={null} only={children} onClose={onClose} />
    </Layer>
  )
}

function ApprovalSheet({ id, declining, onClose }: { id: string; declining: boolean; onClose: () => void }) {
  const list = useQuery({ queryKey: APPROVALS_KEY, queryFn: agentBankApi.approvals })
  const a = (list.data?.approvals ?? []).find((x) => x.id === id)
  if (list.isError) return <SheetLine onClose={onClose}>The approval could not be read just now. Close this and try again.</SheetLine>
  if (list.isPending) return <SheetLine onClose={onClose}>Reading…</SheetLine>
  if (!a) return <SheetLine onClose={onClose}>This workspace has no approval at this address.</SheetLine>
  return <Sheet a={a} declineFirst={declining} onClose={onClose} />
}

function Sheet({ a, declineFirst, onClose }: { a: AgentApproval; declineFirst: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const titleId = useId()
  const keys = useKeys()
  const money = useMoney()
  const book = useQuery({ queryKey: BOOK_KEY, queryFn: agentBankApi.book })
  const budgetLeft = a.budget_left_after_ulxc ?? null
  const rules = useQuery({ queryKey: rulesKey(a.agent_id), queryFn: () => agentBankApi.rules(a.agent_id), enabled: budgetLeft !== null })
  const [declining, setDeclining] = useState(declineFirst && a.status === 'pending')
  const [why, setWhy] = useState('')

  const agents = book.data?.agents ?? []
  const agent = agents.find((x) => x.id === a.agent_id)
  const name = agent?.name ?? 'Your agent'
  const paused = !!agent?.paused_at || !!book.data?.all_paused_at
  const uses = a.payee?.kind === 'listing' || (!a.payee && !!a.model)
  const payeeName = a.payee ? a.payee.name || a.payee.id : a.model
  const from = a.paid_from ?? null
  // An account in another currency pays its own amount; otherwise the LXC the rules judge, dollars first.
  const ownCurrency = from?.kind === 'account' && from.currency !== 'USD'
  const amount = ownCurrency ? <Money minor={from.amount_minor} currency={from.currency} /> : <Money ulxc={a.amount_ulxc} />
  // The snack's title names the amount once, in dollars where the peg is known.
  const amountOnce = ownCurrency ? amount : (money(a.amount_ulxc) ?? amount)

  const decide = useMutation({
    mutationFn: async ({ decision, reason }: { decision: 'approve' | 'deny'; reason?: string }) =>
      agentBankApi.decide(a.id, decision, keys.signed ? await signApproval(a.id) : undefined, undefined, reason),
    onSuccess: (_, { decision }) => {
      onClose()
      showSnack(
        decision === 'approve'
          ? {
              title: (
                <>
                  Approved: {payeeName}, {amountOnce}
                </>
              ),
              line: paused
                ? `${name} is paused: it goes through once ${name} runs again and sends it, within 24 hours.`
                : `It goes through the next time ${name} sends it, once, within 24 hours.${from?.kind === 'marketplace_bill' ? ' It goes on your monthly bill.' : ''}`,
            }
          : { title: `Declined. ${name}’s ${a.payee ? 'payment' : 'request'} is refused`, line: 'And the same request is refused without asking you for 24 hours.' },
      )
    },
    onSettled: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: APPROVALS_KEY }),
        qc.invalidateQueries({ queryKey: BOOK_KEY }),
        qc.invalidateQueries({ queryKey: ['agent-statement'] }),
      ]),
  })
  const failed = decide.isError ? (
    <p role="alert" className="text-body text-ink">
      {refusal(decide.error)}
    </p>
  ) : null

  // Only where this browser may decide: an address asking for Decline does not get round B55.2.
  if (declining && !keys.onlyThePhone && !keys.noLiveKey) {
    const decline = () => decide.mutate({ decision: 'deny', reason: why.trim() || undefined })
    return (
      <Dialog
        open
        onClose={() => setDeclining(false)}
        title={`Decline ${name}’s ${a.payee ? 'payment' : 'request'}?`}
        actions={
          <>
            <Button variant="secondary" onClick={() => setDeclining(false)}>
              Cancel
            </Button>
            <Button variant="danger" disabled={keys.hold || decide.isPending} onClick={decline}>
              Decline
            </Button>
          </>
        }
      >
        <p>
          {amount}
          {payeeName ? ` to ${payeeName}` : ''}. The same request is then refused without asking you for 24 hours.
        </p>
        <Field label="Why (optional, the agent sees it)">
          <Input
            autoFocus
            maxLength={200}
            placeholder="For example: not this month"
            value={why}
            onChange={(e) => setWhy(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') decline()
            }}
          />
        </Field>
        {failed}
        {keys.signed ? <p className="text-caption text-ink-3">Declining asks for your passkey.</p> : null}
      </Dialog>
    )
  }

  const facts: { label: React.ReactNode; value: React.ReactNode }[] = []
  if (a.asks_above_ulxc != null)
    facts.push({
      label: 'Why it’s asking',
      value: (
        <>
          It asks you above <Money ulxc={a.asks_above_ulxc} />
        </>
      ),
    })
  if (from) {
    const b = from.balance_minor
    facts.push({
      label: 'Paid from',
      value:
        b == null ? (
          from.name
        ) : (
          <>
            {from.name} (holds {from.kind === 'lxc' ? <Money ulxc={b} /> : <Money minor={b} currency={from.currency} />})
          </>
        ),
    })
  }
  const limit = rules.data?.monthly_limit_ulxc ?? 0
  if (budgetLeft !== null && limit > 0) {
    const sign = budgetLeft < 0 ? '−' : ''
    const left = money(Math.abs(budgetLeft))
    const of = money(limit)
    facts.push({
      label: 'Budget left after',
      value: (
        <span data-testid="approval-budget-left" className="font-figure">
          {left !== null && of !== null ? `${sign}${left} of ${of} ` : null}
          <span className="text-micro font-semibold text-ink-3">
            {sign}
            {lxcPartOf(Math.abs(budgetLeft), limit)}
          </span>
        </span>
      ),
    })
  }
  if (a.expires_at) facts.push({ label: 'Expires', value: expiresText(a.expires_at) })

  const pending = a.status === 'pending'
  const decides = pending && !keys.onlyThePhone && !keys.noLiveKey
  const closeButton = (
    <Button variant="secondary" size="lg" className="w-full" onClick={onClose}>
      Close
    </Button>
  )
  const ownAgent = (id: string) => agents.some((x) => x.id === id)

  return (
    <Layer labelledBy={titleId} onClose={onClose}>
      <SheetFrame
        onClose={onClose}
        head={
          <>
            <Link to={`/agents/${a.agent_id}`} aria-label={`Open ${name}`} className={`block rounded-pill leading-none ${pocketFocusRing}`}>
              <Face agent={agent ?? { id: a.agent_id, name }} state={agent?.paused_at ? 'asleep' : 'happy'} size={40} waiting={pending} />
            </Link>
            <div className="min-w-0">
              <div id={titleId} className="font-semibold text-ink">
                {name} wants to {uses ? 'use' : 'pay'}
              </div>
              {a.memo || a.reason ? <div className="text-caption text-ink-3">{a.memo || a.reason}</div> : null}
            </div>
          </>
        }
        label={<WorkspaceLabel capability={approvalCapability(a, ownAgent)} />}
        amount={ownCurrency ? <Money minor={from.amount_minor} currency={from.currency} size="sheet" /> : <Money ulxc={a.amount_ulxc} size="sheet" />}
        to={
          payeeName ? (
            <>
              to{' '}
              {a.payee?.kind === 'agent' ? (
                <Link to={`/agents/${a.payee.id}`} className={`${inlineLink} font-semibold`}>
                  {payeeName}
                </Link>
              ) : (
                <b className="text-ink">{payeeName}</b>
              )}
            </>
          ) : null
        }
        facts={facts}
        only={decides ? `This approves this payment only.${keys.signed ? ' Approving or declining asks for your passkey.' : ''}` : undefined}
        actions={
          !pending ? (
            <>
              <p className="text-body text-ink" data-testid="approval-sheet-state">
                {a.status === 'expired' ? `This request expired. If ${name} asks again, it waits for you again.` : `Already decided: ${DECIDED[a.status] ?? 'closed'}.`}
              </p>
              {closeButton}
            </>
          ) : !decides ? (
            <>
              <OnThePhone>Approve this on your phone: it is waiting in Talyvor there.</OnThePhone>
              {closeButton}
            </>
          ) : (
            <>
              {paused ? (
                <p className="rounded-inset bg-tangerine-50 px-3.5 py-2.5 text-body text-ink" data-testid="approval-sheet-paused">
                  {name} is paused: nothing goes through until it runs again. An approval lasts 24 hours.
                </p>
              ) : null}
              {failed}
              <Button size="lg" className="w-full" disabled={keys.hold || decide.isPending} onClick={() => decide.mutate({ decision: 'approve' })}>
                {keys.signed ? 'Approve with your passkey' : 'Approve'}
              </Button>
              <Button variant="secondary" size="lg" className="w-full" disabled={keys.hold || decide.isPending} onClick={() => setDeclining(true)}>
                Decline
              </Button>
            </>
          )
        }
      />
    </Layer>
  )
}
