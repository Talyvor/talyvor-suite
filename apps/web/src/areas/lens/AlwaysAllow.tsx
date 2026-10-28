import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'

import { Button, Input, focusRing, inlineLink } from '@talyvor/ui'

import { type AgentApproval, type PayeeAllowance, agentBankApi, parseLXC, refusalText } from './agentBankApi'
import { Lxc } from './money'

// B41.4 — "Approve and always allow this", on the card of a payment waiting for approval. The person says how much the
// agent may pay this payee a day or a month without asking; Lens's rule simulator (B28.30) answers what that rule would
// do to a payment like this one before anything is saved, and approving saves it with the approval (Lens B41.104).
// Lens's simulator judges payments to an agent, a listing, a company or a card merchant, so only those offer it.

const PREVIEWABLE = new Set(['agent', 'listing', 'company', 'merchant'])

/** Whether an approval's payment can be approved and always allowed. */
export const canAlwaysAllow = (a: AgentApproval) => a.payee !== undefined && PREVIEWABLE.has(a.payee.kind)

/** "up to 3 LXC ($0.30) a month" */
export function AllowedUpTo({ allow }: { allow: PayeeAllowance }) {
  return (
    <>
      up to <Lxc ulxc={allow.amount_ulxc} /> a {allow.per}
    </>
  )
}

const select = `h-8 rounded-control border border-rule bg-surface px-2 text-body text-ink transition-colors duration-200 hover:border-rule-strong ${focusRing}`

export function AlwaysAllow({
  a,
  agentName,
  disabled,
  signed,
  onApprove,
}: {
  a: AgentApproval
  agentName: string
  disabled: boolean
  signed: boolean
  onApprove: (allow: PayeeAllowance) => void
}) {
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState('')
  const [per, setPer] = useState<PayeeAllowance['per']>('month')
  const payee = a.payee
  const ulxc = parseLXC(amount)
  const allow: PayeeAllowance | null = ulxc === null ? null : { amount_ulxc: ulxc, per }
  const preview = useMutation({
    mutationFn: (allow: PayeeAllowance) =>
      agentBankApi.simulate(a.agent_id, {
        amount_ulxc: a.amount_ulxc,
        payee: { kind: payee?.kind as 'agent' | 'listing' | 'company' | 'merchant', id: payee?.id ?? '' },
        always_allow: allow,
      }),
  })
  if (!payee || !canAlwaysAllow(a)) return null
  const to = payee.name || payee.id
  // The approval waits for a preview of exactly the rule it saves.
  const previewed = preview.data !== undefined && allow !== null && preview.variables?.amount_ulxc === allow.amount_ulxc && preview.variables.per === allow.per

  if (!open) {
    return (
      <button type="button" className={`self-start text-caption ${inlineLink}`} disabled={disabled} onClick={() => setOpen(true)}>
        Approve and always allow this…
      </button>
    )
  }
  const answer = preview.data
  return (
    <form
      className="flex flex-col gap-2 rounded-control border border-rule p-3"
      aria-label={`Always allow ${agentName} to pay ${to}`}
      onSubmit={(e) => {
        e.preventDefault()
        if (allow !== null) preview.mutate(allow)
      }}
    >
      <p className="text-caption text-muted">
        Let {agentName} pay {to} without asking you, up to an amount. Past it, a payment waits for you again.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-body text-ink">Up to</span>
        <Input
          aria-label={`Always allow ${agentName} to pay ${to} up to, in LXC`}
          inputMode="decimal"
          placeholder="LXC"
          className="w-28 font-figure"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <select aria-label="Each" className={select} value={per} onChange={(e) => setPer(e.target.value as PayeeAllowance['per'])}>
          <option value="day">a day</option>
          <option value="month">a month</option>
        </select>
        <Button type="submit" disabled={allow === null || preview.isPending}>
          {preview.isPending ? 'Checking…' : 'Preview'}
        </Button>
      </div>
      {answer && previewed ? (
        <p role="status" className="text-caption text-ink" data-testid="always-allow-preview">
          {answer.verdict === 'allowed' ? (
            <>
              With this rule, {agentName} could pay {to} <Lxc ulxc={a.amount_ulxc} /> like this without asking you.
            </>
          ) : (
            <>
              Even with this rule, a payment like this would {answer.verdict === 'refused' ? 'be refused' : 'still wait for you'}: {answer.reason}
              {answer.reason.endsWith('.') ? '' : '.'}
            </>
          )}{' '}
          Nothing is saved until you approve.
        </p>
      ) : null}
      {preview.isError ? (
        <p role="alert" className="text-caption text-ink">
          {refusalText(preview.error)}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="primary" disabled={disabled || !previewed} onClick={() => allow && onApprove(allow)}>
          {signed ? 'Approve and always allow with Face ID' : 'Approve and always allow'}
        </Button>
        <button type="button" className={`text-caption ${inlineLink}`} onClick={() => setOpen(false)}>
          Not now
        </button>
      </div>
    </form>
  )
}
