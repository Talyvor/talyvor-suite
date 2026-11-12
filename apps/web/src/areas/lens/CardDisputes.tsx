import { useId, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Chip, Field, Icon, Input, Money, pocketFocusRing, showToast } from '@talyvor/ui/pocket'
import { cn, inlineLink } from '@talyvor/ui'
import { monthPeriod, readFailure, saveFile } from './AgentBank'
import { agentBankApi, refusalText, type CardDispute, type CardRefund } from './agentBankApi'
import { formatWhen } from './format'

// B59.25 — card disputes, merchants' refunds and the card export, on Lens B59.24. A card payment is named by the
// issuer's id for it, which its statement line carries (partner_ref). The owner disputes it with a reason; the issuer
// takes it and decides; a won dispute or a refund comes back to the account as its own statement line. Export saves
// the card payments, disputes and refunds of a date range as Lens's CSV.

export const CARD_DISPUTES_KEY = ['card-disputes']
export const CARD_REFUNDS_KEY = ['card-refunds']

/** Lens's longest reason, in characters (economy.MaxCardDisputeReason). */
const MAX_REASON = 500

export const useCardDisputes = () => useQuery({ queryKey: CARD_DISPUTES_KEY, queryFn: agentBankApi.cardDisputes })
export const useCardRefunds = () => useQuery({ queryKey: CARD_REFUNDS_KEY, queryFn: agentBankApi.cardRefunds })

/** Where a dispute stands, in words, with what came back once it was won. */
export function DisputeState({ dispute }: { dispute: CardDispute }) {
  switch (dispute.status) {
    case 'won':
      return (
        <Chip tone="good" data-testid="dispute-state">
          Dispute won · <Money minor={dispute.credited_minor} currency={dispute.currency} /> back
        </Chip>
      )
    case 'lost':
      return (
        <Chip tone="bad" data-testid="dispute-state">
          Dispute lost
        </Chip>
      )
    case 'with_issuer':
      return (
        <Chip tone="wait" data-testid="dispute-state">
          With the card issuer
        </Chip>
      )
    default:
      return (
        <Chip tone="wait" data-testid="dispute-state">
          Dispute opened
        </Chip>
      )
  }
}

/** On a card payment: where its dispute stands, or "Dispute this payment" and the reason it is disputed for. */
export function DisputePayment({ paymentID }: { paymentID: string }) {
  const qc = useQueryClient()
  const disputes = useCardDisputes()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const id = useId()
  const send = useMutation({
    mutationFn: () => agentBankApi.openCardDispute(paymentID, reason.trim()),
    onSuccess: (d) => {
      qc.setQueryData<CardDispute[]>(CARD_DISPUTES_KEY, (list) => [d, ...(list ?? []).filter((x) => x.id !== d.id)])
      setOpen(false)
      showToast('Dispute sent to the card issuer')
    },
  })
  const dispute = (disputes.data ?? []).find((d) => d.payment_id === paymentID)
  if (dispute) return <DisputeState dispute={dispute} />
  // Until the disputes are read, a payment that may already be disputed offers nothing.
  if (!disputes.isSuccess) return null
  if (!open) {
    return (
      <button type="button" className={cn('text-micro font-semibold text-ink', inlineLink)} onClick={() => setOpen(true)}>
        Dispute this payment
      </button>
    )
  }
  const ready = reason.trim() !== '' && !send.isPending
  return (
    <form
      className="mt-2 grid max-w-md gap-2"
      data-testid="dispute-form"
      onSubmit={(e) => {
        e.preventDefault()
        if (ready) send.mutate()
      }}
    >
      <label htmlFor={id} className="text-body font-semibold text-ink-2">
        Why are you disputing it?
      </label>
      <textarea
        id={id}
        rows={3}
        maxLength={MAX_REASON}
        required
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        className={cn(
          'rounded-control bg-page px-3.5 py-2.5 text-reading text-ink shadow-edge placeholder:text-faint',
          'transition-colors duration-200 hover:border-rule-strong disabled:cursor-not-allowed disabled:opacity-50',
          pocketFocusRing,
        )}
      />
      <p className="text-micro text-ink-3">The card issuer decides. If you win, the payment comes back to this account.</p>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={send.isPending} disabledReason={reason.trim() === '' ? 'Say why you are disputing it first.' : undefined}>
          {send.isPending ? 'Sending…' : 'Send dispute'}
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      {send.isError ? (
        <p role="alert" className="text-caption text-ink">
          {refusalText(send.error)}
        </p>
      ) : null}
    </form>
  )
}

/** One refund as a line: the merchant, when, and what came back. */
function RefundLine({ refund }: { refund: CardRefund }) {
  return (
    <li className="flex items-baseline justify-between gap-3 border-t border-line py-2.5 text-body text-ink" data-testid="card-refund">
      <span>
        {refund.merchant || 'A merchant'}
        <span className="text-ink-3">
          {' · Refund · '}
          <span className="font-figure">{formatWhen(refund.created_at)}</span>
        </span>
      </span>
      <Money minor={refund.credited_minor} currency={refund.currency} signed className="text-success" />
    </li>
  )
}

/** One dispute as a line: the merchant, the payment, its reason and where it stands. */
function DisputeLine({ dispute }: { dispute: CardDispute }) {
  return (
    <li className="grid gap-1 border-t border-line py-2.5 text-body text-ink" data-testid="card-dispute">
      <span className="flex flex-wrap items-baseline justify-between gap-3">
        <span>
          {dispute.merchant || 'A merchant'}
          <span className="text-ink-3">
            {' · '}
            <Money minor={dispute.amount_minor} currency={dispute.currency} />
            {' · '}
            <span className="font-figure">{formatWhen(dispute.created_at)}</span>
          </span>
        </span>
        <DisputeState dispute={dispute} />
      </span>
      <span className="text-micro text-ink-3">{dispute.reason}</span>
    </li>
  )
}

/** On an agent's card: its payments' disputes and its refunds, newest first. Nothing at all while it has none. */
export function CardDisputesAndRefunds({ agentID }: { agentID: string }) {
  const disputes = useCardDisputes()
  const refunds = useCardRefunds()
  const mine = <T extends { agent_id?: string }>(xs: T[] | undefined) => (xs ?? []).filter((x) => x.agent_id === agentID)
  const ds = mine(disputes.data)
  const rs = mine(refunds.data)
  const failed = disputes.isError ? disputes.error : refunds.isError ? refunds.error : null
  if (failed !== null) return <p className="px-gutter py-3 text-body text-ink-2">{readFailure(failed, 'Its disputes and refunds')}</p>
  if (ds.length === 0 && rs.length === 0) return null
  return (
    <div className="grid gap-1 px-gutter py-3" data-testid="card-disputes-refunds">
      <h3 className="text-body font-semibold text-ink-2">Disputes and refunds</h3>
      <ul>
        {ds.map((d) => (
          <DisputeLine key={d.id} dispute={d} />
        ))}
        {rs.map((r) => (
          <RefundLine key={r.id} refund={r} />
        ))}
      </ul>
    </div>
  )
}

/** Export: the card payments, disputes and refunds of a date range, this month so far to start with, as a CSV file. */
export function CardExport() {
  const start = monthPeriod('this')
  const [from, setFrom] = useState(start.from)
  const [through, setThrough] = useState(start.through)
  const save = useMutation({
    mutationFn: async () => {
      saveFile(`card-payments-${from}-to-${through}.csv`, await agentBankApi.cardExportFile(from, through))
    },
    onSuccess: () => showToast(`Downloading card payments from ${from} to ${through} as a CSV file`),
  })
  const ready = from !== '' && through !== '' && through >= from && !save.isPending
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      data-testid="card-export"
      onSubmit={(e) => {
        e.preventDefault()
        if (ready) save.mutate()
      }}
    >
      <Field label="Card payments from">
        <Input type="date" className="font-figure" value={from} max={through} onChange={(e) => setFrom(e.target.value)} />
      </Field>
      <Field label="To">
        <Input type="date" className="font-figure" value={through} min={from} onChange={(e) => setThrough(e.target.value)} />
      </Field>
      <Button
        type="submit"
        variant="secondary"
        icon={<Icon name="download" />}
        disabled={save.isPending}
        disabledReason={from === '' || through === '' || through < from ? 'Choose a first day on or before the last.' : undefined}
      >
        Export
      </Button>
      {save.isError ? (
        <p role="alert" className="basis-full text-caption text-ink">
          {refusalText(save.error)}
        </p>
      ) : null}
    </form>
  )
}
