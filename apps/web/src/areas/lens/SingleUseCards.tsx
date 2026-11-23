import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Chip, Eyebrow, Field, Input, Money, Row, Select } from '@talyvor/ui/pocket'
import { readFailure } from './AgentBank'
import { type Agent, type MoneyCard, type MoneyCardBatch, agentBankApi, newMoveKey, refusalText } from './agentBankApi'
import { agentCurrency } from './rulesCurrency'
import { typedMinor } from './AgentFunding'
import { formatWhen } from './format'

// B28.49 — an agent's single-use cards (Lens B46.10). The owner asks for a card for one job: one merchant, capped. Nothing
// is held until the owner or an admin approves it; then the cap is held out of the agent's account and the card issued.
// It pays its merchant once, up to its cap, within 24 hours: Lens declines a second charge, gives back what the first did
// not spend, and closes the card. One unused for 24 hours is closed and its whole cap given back.
// B57.200 — drawn in Pocket as the card's "Disputes and refunds" rows are: each card a row with where it stands under its
// merchant, and the ask form one field to a line at the dialog's width, the most it may spend beside its currency.

export const singleUseKey = (agentID: string) => ['single-use-cards', agentID]

const CURRENCIES = ['GBP', 'EUR', 'USD'] as const

/** Where one card stands, in words. */
function CardState({ card }: { card: MoneyCard }) {
  switch (card.status) {
    case 'active':
      return <Chip tone="good">Ready for one purchase</Chip>
    case 'used':
      return (
        <Chip tone="plain">
          Used · <Money minor={card.spent_minor} currency={card.currency} /> spent
        </Chip>
      )
    case 'expired':
      return <Chip tone="plain">Expired unused</Chip>
    case 'failed':
      return <Chip tone="bad">Not issued</Chip>
    case 'issuing':
      return <Chip tone="wait">Issuing</Chip>
    default:
      return <Chip tone="wait">Waiting for approval</Chip>
  }
}

/** One card as a Pocket row: the merchant over where it stands and its number, and the most it may spend. */
function CardLine({ card }: { card: MoneyCard }) {
  const detail =
    card.status === 'active' && card.expires_at
      ? `${card.last4 ? `•••• ${card.last4} · ` : ''}until ${formatWhen(card.expires_at)}`
      : card.last4
        ? `•••• ${card.last4}`
        : card.detail || undefined
  return (
    <li data-testid="single-use-card" className="border-t border-line first:border-t-0">
      <Row
        title={card.merchant}
        line={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-0.5">
            <CardState card={card} />
            {detail ? <span className="font-figure">{detail}</span> : null}
          </span>
        }
        amount={
          <span className="grid justify-items-end">
            <Money minor={card.cap_minor} currency={card.currency} />
            <span className="text-body font-normal text-ink-3">at most</span>
          </span>
        }
      />
    </li>
  )
}

function Batch({ batch, agentID }: { batch: MoneyCardBatch; agentID: string }) {
  const qc = useQueryClient()
  const approve = useMutation({
    mutationFn: () => agentBankApi.approveCards(batch.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: singleUseKey(agentID) }),
  })
  return (
    <div data-testid="single-use-batch" className="grid gap-1 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-body font-semibold text-ink">{batch.purpose || 'One job'}</p>
        {batch.status === 'awaiting_approval' ? (
          <Button size="sm" disabled={approve.isPending} onClick={() => approve.mutate()}>
            {approve.isPending ? 'Approving…' : 'Approve'}
          </Button>
        ) : null}
      </div>
      {approve.isError ? (
        <p role="alert" className="text-body text-ink">
          {refusalText(approve.error)}
        </p>
      ) : null}
      <ul>
        {(batch.cards ?? []).map((c) => (
          <CardLine key={c.id} card={c} />
        ))}
      </ul>
    </div>
  )
}

/** Ask for one card for one job: what it is for, the merchant it pays and the most it may spend. */
function AskCard({ agent }: { agent: Agent }) {
  const qc = useQueryClient()
  const [purpose, setPurpose] = useState('')
  const [merchant, setMerchant] = useState('')
  const [cap, setCap] = useState('')
  const own = agentCurrency(agent)
  const [currency, setCurrency] = useState<string>(own && own !== 'USDC' ? own : 'GBP')
  const [key, setKey] = useState(newMoveKey)
  const capMinor = typedMinor(cap, currency)
  const ready = purpose.trim() !== '' && merchant.trim() !== '' && capMinor !== null
  const ask = useMutation({
    mutationFn: () =>
      agentBankApi.askCards(
        { agent_id: agent.id, purpose: purpose.trim(), currency, cards: [{ merchant: merchant.trim(), cap_minor: capMinor ?? 0 }] },
        key,
      ),
    onSuccess: () => {
      setPurpose('')
      setMerchant('')
      setCap('')
      setKey(newMoveKey())
      return qc.invalidateQueries({ queryKey: singleUseKey(agent.id) })
    },
  })
  return (
    <form
      className="grid gap-3"
      data-testid="single-use-ask"
      onSubmit={(e) => {
        e.preventDefault()
        if (ready && !ask.isPending) ask.mutate()
      }}
    >
      <Field label="For">
        <Input placeholder="Book a train ticket" value={purpose} onChange={(e) => setPurpose(e.target.value)} />
      </Field>
      <Field label="Merchant">
        <Input value={merchant} onChange={(e) => setMerchant(e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Up to" className="min-w-0 grid-cols-1">
          <Input className="font-figure" inputMode="decimal" value={cap} aria-invalid={cap !== '' && capMinor === null} onChange={(e) => setCap(e.target.value)} />
        </Field>
        <Field label="Currency" className="min-w-0 grid-cols-1">
          <Select value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Button
        type="submit"
        variant="secondary"
        className="justify-self-start"
        disabled={!ready || ask.isPending}
        disabledReason={ready ? undefined : 'Say what it is for, the merchant and the most it may spend first.'}
      >
        {ask.isPending ? 'Asking…' : 'Ask for a single-use card'}
      </Button>
      {ask.isError ? (
        <p role="alert" className="text-body text-ink">
          {refusalText(ask.error)}
        </p>
      ) : null}
    </form>
  )
}

/** On an agent's card: its single-use cards, newest first, and the form that asks for another. */
export function SingleUseCards({ agent }: { agent: Agent }) {
  const q = useQuery({ queryKey: singleUseKey(agent.id), queryFn: () => agentBankApi.cardBatches(agent.id) })
  return (
    <section className="grid gap-2 px-gutter py-3" data-testid="single-use-cards">
      <Eyebrow>Single-use cards</Eyebrow>
      <p className="text-body text-ink-2">
        A card for one purchase. It pays one merchant once, up to its limit, within 24 hours. Nothing is held until it is
        approved, and what the purchase does not spend goes back to {agent.name}’s account.
      </p>
      {q.isError ? (
        <p className="text-body text-ink-2">{readFailure(q.error, 'Its single-use cards')}</p>
      ) : (q.data ?? []).length > 0 ? (
        <div className="divide-y divide-line">
          {(q.data ?? []).map((b) => (
            <Batch key={b.id} batch={b} agentID={agent.id} />
          ))}
        </div>
      ) : null}
      <AskCard agent={agent} />
    </section>
  )
}
