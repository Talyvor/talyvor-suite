import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Card, Chip, Eyebrow, Field, Input, Money, Row, showSnack } from '@talyvor/ui/pocket'
import { InlineFailure } from '../../components/SessionExpiredBar'
import { typedMinor } from './AgentFunding'
import { formatWhen } from './format'
import { type BalanceThreshold, type CurrencyAccount, agentBankApi, refusalText } from './agentBankApi'

// LowBalanceCard.tsx — B28.61: an agent's low-balance alert, on its page under the Balance card. For each of the agent's
// accounts the owner sets the amount to be alerted below (Lens B28.334, PUT /api/money/low-balance); while the account
// holds less, Lens writes one alert an hour, however often it is checked, and sends it to the alert channels. The card
// lists this agent's latest alerts from GET /api/money/low-balance/alerts.

export const LOW_BALANCE_KEY = ['low-balance']
const LOW_BALANCE_ALERTS_KEY = ['low-balance', 'alerts']

const ACCOUNT_WORDS: Record<string, string> = { USD: 'US dollar account', GBP: 'Pound account', EUR: 'Euro account', USDC: 'USDC account' }
const accountWords = (currency: string) => ACCOUNT_WORDS[currency] ?? `${currency} account`

/** One account: the amount it alerts below, or the field to set one. */
function AccountAlert({ agentId, account, threshold }: { agentId: string; account: CurrencyAccount; threshold?: BalanceThreshold }) {
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [amount, setAmount] = useState('')
  const minor = typedMinor(amount, account.currency)
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: LOW_BALANCE_KEY })
  }
  const save = useMutation({
    mutationFn: (m: number) => agentBankApi.setLowBalance(agentId, account.currency, m),
    onSuccess: () => {
      setEditing(false)
      setAmount('')
      showSnack({ title: 'Low balance alert saved' })
      refresh()
    },
  })
  const remove = useMutation({
    mutationFn: (id: string) => agentBankApi.removeLowBalance(id),
    onSuccess: () => {
      showSnack({ title: 'Low balance alert removed' })
      refresh()
    },
  })
  const testid = `low-balance-${account.currency}`
  if (threshold && !editing)
    return (
      <div data-testid={testid}>
        <Row
          wrap
          title={accountWords(account.currency)}
          line={
            <span className="font-figure">
              Alert below <Money minor={threshold.threshold_minor} currency={threshold.currency} />
            </span>
          }
          action={
            <span className="flex items-center gap-2">
              {threshold.below ? <Chip tone="bad">Below</Chip> : null}
              <Button type="button" variant="secondary" size="sm" onClick={() => setEditing(true)}>
                Change
              </Button>
              <Button type="button" variant="outline" size="sm" disabled={remove.isPending} onClick={() => remove.mutate(threshold.id)}>
                Remove
              </Button>
            </span>
          }
        />
        {remove.isError ? (
          <p role="alert" className="text-body text-ink-2">
            {refusalText(remove.error)}
          </p>
        ) : null}
      </div>
    )
  return (
    <form
      className="grid gap-2 border-t border-line py-2.5 first:border-t-0"
      data-testid={testid}
      onSubmit={(ev) => {
        ev.preventDefault()
        if (minor !== null) save.mutate(minor)
      }}
    >
      <Field label={`Alert me when the ${accountWords(account.currency)} is below`}>
        <Input aria-label={`Low balance amount, ${account.currency}`} inputMode="decimal" unit={account.currency} value={amount} onChange={(ev) => setAmount(ev.target.value)} />
      </Field>
      <span className="flex gap-2">
        <Button type="submit" size="sm" disabled={minor === null || save.isPending} disabledReason={minor === null ? 'Add an amount first.' : undefined}>
          Save
        </Button>
        {editing ? (
          <Button type="button" variant="outline" size="sm" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        ) : null}
      </span>
      {save.isError ? (
        <p role="alert" className="text-body text-ink-2">
          {refusalText(save.error)}
        </p>
      ) : null}
    </form>
  )
}

export function LowBalanceCard({ agent, accounts }: { agent: { id: string; name: string }; accounts: CurrencyAccount[] }) {
  const thresholds = useQuery({ queryKey: LOW_BALANCE_KEY, queryFn: agentBankApi.lowBalance })
  const alerts = useQuery({ queryKey: LOW_BALANCE_ALERTS_KEY, queryFn: agentBankApi.lowBalanceAlerts })
  const mine = (thresholds.data?.thresholds ?? []).filter((t) => t.agent_id === agent.id)
  const raised = (alerts.data?.alerts ?? []).filter((a) => a.agent_id === agent.id).slice(0, 5)
  return (
    <Card className="grid gap-3" data-testid="agent-page-low-balance">
      <Eyebrow>Low balance alert</Eyebrow>
      <p className="text-body text-ink-3">An alert goes to you once an hour while {agent.name}’s balance is below the amount you set.</p>
      {thresholds.isError ? (
        <div role="alert" className="grid justify-items-start gap-3">
          <InlineFailure error={thresholds.error} failed="Couldn’t load the low balance alerts" />
          <Button variant="secondary" size="sm" onClick={() => void thresholds.refetch()}>
            Try again
          </Button>
        </div>
      ) : thresholds.isPending ? (
        <p className="text-body text-ink-3">Reading…</p>
      ) : accounts.length === 0 ? (
        <p className="text-body text-ink-2">{agent.name} has no account yet, so there is no balance to watch.</p>
      ) : (
        <div>
          {accounts.map((acc) => (
            <AccountAlert key={acc.id} agentId={agent.id} account={acc} threshold={mine.find((t) => t.currency === acc.currency)} />
          ))}
        </div>
      )}
      {raised.length > 0 ? (
        <div className="grid gap-1" data-testid="low-balance-alerts">
          <span className="text-caption font-semibold text-ink-2">Latest alerts</span>
          {raised.map((a) => (
            <p key={a.id} className="text-caption text-ink-3" data-testid={`low-balance-alert-${a.id}`}>
              <span className="font-figure text-ink-2">
                <Money minor={a.balance_minor} currency={a.currency} />, below <Money minor={a.threshold_minor} currency={a.currency} />
              </span>{' '}
              · <span className="font-figure">{formatWhen(a.created_at)}</span>
            </p>
          ))}
        </div>
      ) : null}
    </Card>
  )
}
