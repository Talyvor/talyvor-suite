import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, CardHeader, Pill, inlineLink } from '@talyvor/ui'
import { Card } from './walletBrand'
import { Region, RegionScreen } from '../../components/Region'
import { formatWhen } from './format'
import { Note, readFailure } from './WalletMoney'
import { assertOver } from './passkeys'
import { ASSISTANT_REQUESTS_KEY, PAYEES_KEY } from './Pay'
import { type AssistantRequest, type MandateTerms, type RecurringPlan, agentBankApi, formatMinor, refusalText } from './agentBankApi'

// RecurringPlan.tsx — B45.37: the page an assistant's prepare_recurring_payments link opens. Each standing order Lens
// prepared (B45.13), the mandate's limits in plain words, and one passkey signature over exactly that mandate, after
// which Lens runs the orders and each one's first payment waits under Approvals.

const EVERY: Record<string, string> = { day: 'every day', week: 'every week', month: 'every month' }

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
    `Until ${formatWhen(t.expires_at)}. You can revoke it at any time.`,
  ]
}

export function RecurringPlanScreen() {
  const { id = '' } = useParams()
  const asked = useQuery({ queryKey: ASSISTANT_REQUESTS_KEY, queryFn: agentBankApi.assistantRequests })
  const request = (asked.data?.requests ?? []).find((r) => r.id === id && r.kind === 'plan')
  return (
    <RegionScreen>
      <Region index="00" label="Recurring payments" heading="Sign recurring payments" sectionClassName="pb-10 pt-4 wide:pb-12" className="flex max-w-2xl flex-col gap-3">
        {asked.isError ? (
          <p className="text-body text-muted">{readFailure(asked.error, 'This plan')}</p>
        ) : asked.isPending ? (
          <p className="text-body text-muted">Reading…</p>
        ) : request?.kind === 'plan' ? (
          <PlanCard request={request} plan={request.details} />
        ) : (
          <p className="text-body text-muted" data-testid="plan-missing">
            There is no plan at this address. It may belong to another workspace, or the assistant that prepared it was disconnected.
          </p>
        )}
      </Region>
    </RegionScreen>
  )
}

function PlanCard({ request, plan }: { request: AssistantRequest; plan: RecurringPlan }) {
  const qc = useQueryClient()
  const payees = useQuery({ queryKey: PAYEES_KEY, queryFn: agentBankApi.payees })
  const payeeName = (pid = '') => payees.data?.payees?.find((p) => p.id === pid)?.name ?? pid
  const terms = JSON.parse(plan.mandate.canonical) as MandateTerms
  // Lens starts the orders in the same transaction that keeps the signed mandate.
  const signed = request.status === 'signed' || plan.status === 'signed'
  const sign = useMutation({
    mutationFn: async () =>
      agentBankApi.signAssistantMandate(
        request.id,
        plan.mandate.canonical,
        await assertOver({ challenge: plan.mandate.challenge, allow_credentials: plan.mandate.credential_ids }),
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ASSISTANT_REQUESTS_KEY }),
  })
  return (
    <Card>
      <CardHeader>
        {request.assistant} prepared {plan.schedules.length} recurring {plan.schedules.length === 1 ? 'payment' : 'payments'}
      </CardHeader>
      <div className="flex flex-col gap-3 px-gutter py-3" data-testid="plan-card">
        <ul className="flex flex-col divide-y divide-rule">
          {plan.schedules.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2" data-testid={`plan-order-${s.id}`}>
              <span className="flex flex-col">
                <span className="text-body text-ink">{payeeName(s.to_payee_id)}</span>
                <span className="text-caption text-muted">
                  <span className="font-figure">{formatMinor(s.amount_minor ?? 0, s.currency ?? 'GBP')}</span> {EVERY[s.every] ?? s.every}, first on{' '}
                  <span className="font-figure">{formatWhen(s.next_run_at)}</span>
                  {s.memo ? ` · ${s.memo}` : ''}
                </span>
              </span>
              {signed ? <Pill status="settled">Running</Pill> : <Pill status="idle">Waiting for your signature</Pill>}
            </li>
          ))}
        </ul>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-body text-ink" data-testid="plan-terms">
          {planInWords(terms, payeeName).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        {signed ? (
          <Note ok>
            Signed. The orders are running; each first payment waits for you under{' '}
            <Link className={inlineLink} to="/approvals">
              Approvals
            </Link>
            .
          </Note>
        ) : (
          <>
            <p className="text-caption text-muted">
              Prepared <span className="font-figure">{formatWhen(request.created_at)}</span>. Nothing is paid until you sign.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="primary" disabled={sign.isPending} onClick={() => sign.mutate()}>
                {sign.isPending ? 'Signing…' : 'Sign with passkey'}
              </Button>
            </div>
          </>
        )}
        {sign.isError ? <Note ok={false}>{refusalText(sign.error)}</Note> : null}
      </div>
    </Card>
  )
}
