import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Card, Chip, Crumb, Icon, type ChipTone, pocketFocusRing } from '@talyvor/ui/pocket'
import { formatDecided } from './format'
import { readFailure } from './WalletMoney'
import { assertOver } from './passkeys'
import { BOOK_KEY, OnThePhone, useKeys } from './AgentBank'
import { ASSISTANT_REQUESTS_KEY, PAYEES_KEY } from './Pay'
import { WorkspaceLabel } from '../../labels/workspace'
import { type AssistantRequest, type MandateTerms, type RecurringPlan, agentBankApi, formatMinor, refusalText, useAccount } from './agentBankApi'

// RecurringPlan.tsx — B45.37: the page an assistant's prepare_recurring_payments link opens. Each standing order Lens
// prepared (B45.13), the mandate's limits in plain words, and one passkey signature over exactly that mandate, after
// which Lens runs the orders and each one's first payment waits under Approvals.
// B57.98 — drawn in Pocket (w-recurring-plan): the plan's orders dollars first, what signing allows beside them, and
// every state in words: waiting, running, declined and expired. With only the phone's key, nothing is asked of this
// browser (B55.2).

const EVERY: Record<string, string> = { hour: 'every hour', day: 'every day', week: 'every week', month: 'every month' }
const CURRENCY: Record<string, string> = { USD: 'US dollar', GBP: 'pound', EUR: 'euro' }
const COUNT = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']
const CHECK: Record<string, string> = { exact_match: 'exact match', close_match: 'close match', no_match: 'no match' }

const dayMonth = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' })
const link = `text-ink underline underline-offset-2 ${pocketFocusRing}`

/** The plan's mandate in plain words: what the passkey signs. */
export function planInWords(t: MandateTerms, payeeName: (id: string) => string): string[] {
  const money = (m: Record<string, number> | null | undefined) =>
    Object.entries(m ?? {})
      .map(([cur, minor]) => formatMinor(minor, cur))
      .join(' or ')
  const perPayment = money(t.limits?.per_payment)
  const perMonth = money(t.limits?.per_month)
  const askAbove = money(t.requires_approval_above)
  return [
    'Each order’s first payment waits for your approval under Approvals. After that it pays on its own, and you are told each time.',
    ...(perPayment ? [`No payment is more than ${perPayment}.`] : []),
    ...(perMonth ? [`At most ${perMonth} a month in all.`] : []),
    ...(askAbove ? [`A payment above ${askAbove} always waits for your approval.`] : []),
    `Paid only to ${(t.scope.payees ?? []).map(payeeName).join(', ')}, in ${[...new Set(t.scope.currencies ?? [])].join(', ')}.`,
    t.new_payee.policy === 'always_ask' ? 'A new payee always needs your approval.' : `New payees: ${t.new_payee.policy}.`,
    `Until ${new Date(t.expires_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })}. You can revoke it at any time.`,
  ]
}

/** waiting, running, declined or expired: the plan's state, as the page and each order's chip say it. */
type PlanState = 'waiting' | 'running' | 'declined' | 'expired'
const CHIP: Record<PlanState, { tone: ChipTone; words: string }> = {
  waiting: { tone: 'wait', words: 'Prepared' },
  running: { tone: 'good', words: 'Running' },
  declined: { tone: 'bad', words: 'Declined' },
  expired: { tone: 'bad', words: 'Expired' },
}

export function RecurringPlanScreen() {
  const { id = '' } = useParams()
  const asked = useQuery({ queryKey: ASSISTANT_REQUESTS_KEY, queryFn: agentBankApi.assistantRequests })
  const found = (asked.data?.requests ?? []).find((r) => r.id === id && r.kind === 'plan')
  // Declined, the BFF drops the plan, so the list no longer has it: the page keeps what was declined to say so.
  const [declined, setDeclined] = useState<AssistantRequest | null>(null)
  const [declinedOf, setDeclinedOf] = useState(id)
  if (declinedOf !== id) {
    setDeclinedOf(id)
    setDeclined(null)
  }
  const request = found ?? declined ?? undefined
  const when = request ? formatDecided(request.created_at) : ''
  const n = request?.kind === 'plan' ? request.details.schedules.length : 0
  return (
    <div className="grid min-w-0 gap-5">
      <Crumb trail={[{ label: 'Approvals', href: '/approvals' }, { label: 'Recurring payments' }]} />
      {request?.kind === 'plan' ? (
        <p className="max-w-2xl text-reading text-ink-2">
          {request.assistant} prepared {COUNT[n] ?? n} standing {n === 1 ? 'order' : 'orders'} {/^(today|yesterday)/.test(when) ? when : `on ${when}`}. Nothing is paid until you
          sign.
        </p>
      ) : null}
      {asked.isError ? (
        <p className="text-body text-ink-2">{readFailure(asked.error, 'This plan')}</p>
      ) : asked.isPending ? (
        <p className="text-body text-ink-2">Reading…</p>
      ) : request?.kind === 'plan' ? (
        <div className="grid items-start gap-4 wide:grid-cols-12">
          <PlanCard request={request} plan={request.details} declined={declined !== null} onDeclined={() => setDeclined(request)} />
          <WhatSigningAllows plan={request.details} />
        </div>
      ) : (
        <p className="text-body text-ink-2" data-testid="plan-missing">
          There is no plan at this address. It may belong to another workspace, or the assistant that prepared it was disconnected.
        </p>
      )}
    </div>
  )
}

function usePayeeName() {
  const payees = useQuery({ queryKey: PAYEES_KEY, queryFn: agentBankApi.payees })
  const saved = payees.data?.payees ?? []
  return { saved, payeeName: (pid = '') => saved.find((p) => p.id === pid)?.name ?? pid }
}

function PlanCard({ request, plan, declined, onDeclined }: { request: AssistantRequest; plan: RecurringPlan; declined: boolean; onDeclined: () => void }) {
  const qc = useQueryClient()
  const { saved, payeeName } = usePayeeName()
  const book = useQuery({ queryKey: BOOK_KEY, queryFn: agentBankApi.book })
  const { shows } = useAccount()
  // B55.2 — with the phone's key alone no passkey here can sign the mandate, so nothing is asked of this browser.
  const { hold, onlyThePhone } = useKeys()
  const terms = JSON.parse(plan.mandate.canonical) as MandateTerms
  // Lens starts the orders in the same transaction that keeps the signed mandate.
  const signed = request.status === 'signed' || plan.status === 'signed'
  const state: PlanState = signed ? 'running' : declined ? 'declined' : new Date(terms.expires_at).getTime() < Date.now() ? 'expired' : 'waiting'
  const sign = useMutation({
    mutationFn: async () =>
      agentBankApi.signAssistantMandate(
        request.id,
        plan.mandate.canonical,
        await assertOver({ challenge: plan.mandate.challenge, allow_credentials: plan.mandate.credential_ids }),
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ASSISTANT_REQUESTS_KEY }),
  })
  // Declined, the BFF drops the plan unsigned: no mandate is kept and no order starts.
  const decline = useMutation({
    mutationFn: () => agentBankApi.dismissAssistantRequest(request.id),
    onSuccess: () => {
      onDeclined()
      void qc.invalidateQueries({ queryKey: ASSISTANT_REQUESTS_KEY })
    },
  })
  const busy = sign.isPending || decline.isPending
  const from = (agentID: string, currency: string) => {
    const account = `${CURRENCY[currency] ?? currency} account`
    if (agentID) return `${book.data?.agents?.find((a) => a.id === agentID)?.name ?? agentID}’s ${account}`
    return shows?.team === false ? `your ${account}` : `the company’s ${account}`
  }
  const payeeWords = (pid = '') => {
    const p = saved.find((x) => x.id === pid)
    return p ? `saved payee, ${CHECK[p.check] ?? 'not checked'}` : 'new payee'
  }
  const chip = CHIP[state]

  return (
    <section aria-labelledby="the-plan" className="wide:col-span-7">
      <Card tone="white" className="grid gap-3" data-testid="plan-card">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="the-plan" className="font-display text-reading font-bold text-ink">
            The plan
          </h2>
          <WorkspaceLabel capability="payments_out" />
        </div>
        <ul className="grid">
          {plan.schedules.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 border-t border-line py-2.5 text-reading first:border-t-0 wide:flex-nowrap" data-testid={`plan-order-${s.id}`}>
              <span className="min-w-0 flex-1 basis-4/5 wide:basis-0">
                <span className="block font-semibold text-ink">
                  {payeeName(s.to_payee_id)} · <span className="font-figure">{formatMinor(s.amount_minor ?? 0, s.currency ?? 'USD')}</span> {EVERY[s.every] ?? s.every}
                </span>
                <span className="block text-body font-normal text-ink-3">
                  From {from(s.from_agent_id, s.currency ?? 'USD')} · first on {dayMonth(s.next_run_at)} · {payeeWords(s.to_payee_id)}
                  {s.memo ? ` · ${s.memo}` : ''}
                </span>
              </span>
              <Chip tone={chip.tone} className="ml-auto">
                {chip.words}
              </Chip>
            </li>
          ))}
        </ul>
        {state === 'waiting' && onlyThePhone ? <OnThePhone>Sign these with a passkey on this browser: add this browser first.</OnThePhone> : null}
        {state === 'waiting' && !hold ? (
          <div className="flex flex-wrap gap-2">
            <Button icon={<Icon name="key" />} disabled={busy} onClick={() => sign.mutate()}>
              {sign.isPending ? 'Signing…' : 'Sign with your passkey'}
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => decline.mutate()}>
              {decline.isPending ? 'Declining…' : 'Decline'}
            </Button>
          </div>
        ) : null}
        {state === 'running' ? (
          <p role="status" className="text-body text-ink">
            <b>Running.</b> Each order’s first payment waits for your approval under{' '}
            <Link className={link} to="/approvals">
              Approvals
            </Link>
            .
          </p>
        ) : state === 'declined' ? (
          <p role="status" className="text-body text-ink">
            <b>Declined.</b> Nothing is set up, and nothing is paid.
          </p>
        ) : state === 'expired' ? (
          <p role="status" className="text-body text-ink">
            <b>Expired.</b> Nothing is set up, and nothing is paid.
          </p>
        ) : null}
        {sign.isError ? (
          <p role="alert" className="text-body text-ink">
            {refusalText(sign.error)}
          </p>
        ) : null}
        {decline.isError ? (
          <p role="alert" className="text-body text-ink">
            {refusalText(decline.error)}
          </p>
        ) : null}
      </Card>
    </section>
  )
}

function WhatSigningAllows({ plan }: { plan: RecurringPlan }) {
  const { payeeName } = usePayeeName()
  const terms = JSON.parse(plan.mandate.canonical) as MandateTerms
  return (
    <section aria-labelledby="what-signing-allows" className="wide:col-span-5">
      <Card className="grid gap-2">
        <h2 id="what-signing-allows" className="font-display text-reading font-bold text-ink">
          What signing allows
        </h2>
        <ul className="grid gap-2 text-body text-ink-2" data-testid="plan-terms">
          {planInWords(terms, payeeName).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="text-body text-ink-3">Each payment is still judged by the account’s rules, and you can stop an order on Pay, Standing orders.</p>
        <div>
          <Button asChild variant="secondary" size="sm">
            <Link to="/money/pay#standing-orders">Standing orders</Link>
          </Button>
        </div>
      </Card>
    </section>
  )
}
