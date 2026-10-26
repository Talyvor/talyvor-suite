import { useQuery } from '@tanstack/react-query'

import { ApprovalCard, paymentRequestKey, totalsOf } from '../lens/Approve'
import { type PaymentRequest, agentBankApi, formatMinor } from '../lens/agentBankApi'
import { readFailure } from '../lens/WalletMoney'

// B45.2 — a payment or batch the assistant prepared in Chat (Lens's prepare_payment / prepare_batch, which pay nothing) is
// B40.9's approval card right under the answer: payee, amount, reference, the rule that asked, Approve with the same
// passkey step as /approve/<id>, or Decline. Chat never approves by itself. Decided, the card is a one-line receipt — read
// from Lens each time, so a reload shows it too.

/** What was decided, in one line: the payments paid (else every one asked) and their total. */
export function receipt(r: PaymentRequest): string {
  const paid = r.items.filter((it) => it.pay_status)
  const shown = r.status === 'approved' && paid.length > 0 ? paid : r.items
  const what = shown.length === 1 ? `${formatMinor(shown[0].amount_minor, shown[0].currency)} to ${shown[0].payee_name || shown[0].listing_id}` : `${shown.length} payments, ${totalsOf(shown)}`
  switch (r.status) {
    case 'approved':
      return `Approved with your passkey: ${what}.`
    case 'cancelled':
      return `Declined. Nothing was paid (${what}).`
    case 'auto':
      return `Inside a mandate you signed, no approval needed: ${what}.`
    case 'blocked':
      return `Blocked, so nothing was paid (${what}).`
    default:
      return `${what}: ${r.status}.`
  }
}

export function PreparedPayment({ id }: { id: string }) {
  const request = useQuery({ queryKey: paymentRequestKey(id), queryFn: () => agentBankApi.paymentRequest(id) })
  return (
    <div className="mt-3">
      {request.isPending ? (
        <p className="text-caption text-muted">Reading the payment…</p>
      ) : request.isError || !Array.isArray(request.data.items) ? (
        <p className="text-caption text-muted">{readFailure(request.error, 'The payment this answer prepared')}</p>
      ) : request.data.status === 'pending_approval' ? (
        <ApprovalCard id={id} request={request.data} />
      ) : (
        <p className="text-caption text-ink" data-testid="chat-pay-receipt">
          {receipt(request.data)}
        </p>
      )}
    </div>
  )
}
