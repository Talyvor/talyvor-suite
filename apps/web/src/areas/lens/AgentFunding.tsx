import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { inlineLink } from '@talyvor/ui'
import { Button, Dialog, Field, Icon, Input, Money, Select, showSnack } from '@talyvor/ui/pocket'
import { BOOK_KEY } from './AgentBank'
import { MONEY_ACCOUNTS_KEY } from './Invoices'
import { readFailure } from './WalletMoney'
import { type CurrencyAccount, agentBankApi, newMoveKey, refusalText, useAccount } from './agentBankApi'

// AgentFunding.tsx — B61.84: Add money and Take back, as Pocket Live's fund and take panels draw them. The owner or an
// admin gives an agent money from the company's account in the agent's account's currency, or takes it back, now
// (BFF B61.84, Lens B61.66). The amount is typed in the account's currency; the dialog names the company's account it
// comes from or goes to and what that holds; one review line; one move under one key, so a second press moves nothing
// twice; then the snack says what moved and both balances are read again. Lens decides who may and how much: every
// refusal is its own sentence. Where the agent has no account in the currency chosen, the dialog says so and offers
// the currencies it has.

export type FundingDirection = 'to_agent' | 'to_company'

/** An account's currency in words, as the agent's page names it: "US dollar account". */
const ACCOUNT_WORDS: Record<string, string> = { USD: 'US dollar account', GBP: 'Pound account', EUR: 'Euro account', USDC: 'USDC account' }
const accountWords = (currency: string) => ACCOUNT_WORDS[currency] ?? `${currency} account`

/** "12.50" → 1250, or for USDC (six places) 12500000; null when it is not a positive amount. */
function typedMinor(text: string, currency: string): number | null {
  const places = currency === 'USDC' ? 6 : 2
  const m = new RegExp(`^\\s*(\\d+)(?:\\.(\\d{1,${places}}))?\\s*$`).exec(text)
  if (m === null) return null
  const minor = Number(m[1]) * 10 ** places + Number((m[2] ?? '').padEnd(places, '0'))
  return Number.isSafeInteger(minor) && minor > 0 ? minor : null
}

/** Add money and Take back, side by side, each opening its dialog; currency picks the account it opens on. */
export function AgentFundingButtons({ agent, currency, size = 'md' }: { agent: { id: string; name: string }; currency?: string; size?: 'sm' | 'md' }) {
  const [direction, setDirection] = useState<FundingDirection | null>(null)
  return (
    <>
      <span className="flex flex-wrap gap-2" data-testid={`agent-funding-${agent.id}${currency ? `-${currency}` : ''}`}>
        <Button type="button" size={size} variant="secondary" icon={<Icon name="plus" size={16} />} aria-label={`Add money to ${agent.name}`} onClick={() => setDirection('to_agent')}>
          Add money
        </Button>
        <Button type="button" size={size} variant="secondary" aria-label={`Take back from ${agent.name}`} onClick={() => setDirection('to_company')}>
          Take back
        </Button>
      </span>
      {direction ? <AgentFundingDialog agent={agent} direction={direction} currency={currency} onClose={() => setDirection(null)} /> : null}
    </>
  )
}

/** The dialog itself, open while it is drawn. */
export function AgentFundingDialog({
  agent,
  direction,
  currency: asked,
  onClose,
}: {
  agent: { id: string; name: string }
  direction: FundingDirection
  currency?: string
  onClose: () => void
}) {
  const qc = useQueryClient()
  const { shows } = useAccount()
  const read = useQuery({ queryKey: MONEY_ACCOUNTS_KEY, queryFn: agentBankApi.moneyAccounts })
  const open = (read.data?.accounts ?? []).filter((a) => a.status === 'open')
  const company = open.filter((a) => a.purpose === 'company')
  const its = open.filter((a) => a.purpose === 'agent' && a.agent_id === agent.id)
  const currencies = [...new Set([...its, ...company].map((a) => a.currency))]
  const [chosen, setChosen] = useState(asked ?? '')
  const currency = chosen || its[0]?.currency || currencies[0] || ''
  const agentAccount = its.find((a) => a.currency === currency)
  const companyAccount = company.find((a) => a.currency === currency)
  const [amount, setAmount] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [key, setKey] = useState(newMoveKey)
  const minor = currency ? typedMinor(amount, currency) : null
  const toAgent = direction === 'to_agent'
  // The reference's words: "the company account" for a business, "your account" for a person's own.
  const ours = shows?.owner === 'Your account' ? 'your account' : 'the company account'
  const title = toAgent ? `Add money to ${agent.name}` : `Take back from ${agent.name}`
  const move = useMutation({
    mutationFn: () => agentBankApi.agentFunding(agentAccount?.id ?? '', direction, minor ?? 0, key),
    onSuccess: (f) => {
      void qc.invalidateQueries({ queryKey: MONEY_ACCOUNTS_KEY })
      void qc.invalidateQueries({ queryKey: BOOK_KEY })
      setKey(newMoveKey())
      const moved = <Money minor={f.amount_minor} currency={f.currency} />
      showSnack({ title: toAgent ? <>{moved} moved to {agent.name}</> : <>{moved} back from {agent.name}</> })
      onClose()
    },
  })
  const ready = agentAccount !== undefined && companyAccount !== undefined && minor !== null
  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      actions={
        confirming && ready ? (
          <>
            <Button type="button" variant="secondary" disabled={move.isPending} onClick={() => setConfirming(false)}>
              Back
            </Button>
            <Button type="button" disabled={move.isPending} onClick={() => move.mutate()}>
              {move.isPending ? (
                'Moving…'
              ) : (
                <>
                  {toAgent ? 'Move' : 'Take back'} <Money minor={minor} currency={currency} />
                </>
              )}
            </Button>
          </>
        ) : (
          <>
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="button" disabled={!ready} disabledReason={!ready ? 'Add an amount first.' : undefined} onClick={() => setConfirming(true)}>
              Continue
            </Button>
          </>
        )
      }
    >
      {read.isError ? (
        <p className="text-body text-ink-2">{readFailure(read.error, 'Your accounts')}</p>
      ) : read.isPending ? (
        <p className="text-body text-ink-3">Reading…</p>
      ) : its.length === 0 ? (
        <p className="text-body text-ink-2" data-testid="agent-funding-no-account">
          {agent.name} has no account yet. Open one on{' '}
          <Link className={`text-ink ${inlineLink}`} to="/money/invoices">
            Invoices
          </Link>{' '}
          first.
        </p>
      ) : confirming && ready ? (
        <div className="grid gap-3" data-testid="agent-funding-review">
          <p className="font-display text-title font-bold text-ink">
            <Money minor={minor} currency={currency} />
          </p>
          <p className="text-body text-ink-2">
            {toAgent
              ? `From ${ours} to ${agent.name}’s ${accountWords(currency)}, now.`
              : `From ${agent.name}’s ${accountWords(currency)} back to ${ours}, now.`}
          </p>
          {move.isError ? <Refused error={move.error} /> : null}
        </div>
      ) : (
        <div className="grid gap-3">
          <Line toAgent={toAgent} ours={ours} name={agent.name} agentAccount={agentAccount} companyAccount={companyAccount} currency={currency} />
          {agentAccount === undefined ? (
            <div className="grid gap-2" data-testid="agent-funding-other-currencies">
              <p className="text-body text-ink-2">
                {agent.name} has no {accountWords(currency).replace(/ account$/, '')} account. It has:
              </p>
              <span className="flex flex-wrap gap-2">
                {its.map((a) => (
                  <Button key={a.id} type="button" size="sm" variant="secondary" onClick={() => setChosen(a.currency)}>
                    {accountWords(a.currency)}
                  </Button>
                ))}
              </span>
            </div>
          ) : null}
          <div className="grid gap-3 wide:grid-cols-2">
            <Field label="Currency">
              <Select aria-label="Currency" value={currency} onChange={(e) => setChosen(e.target.value)}>
                {currencies.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Amount">
              <Input aria-label="Amount" inputMode="decimal" unit={currency} value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
          </div>
        </div>
      )}
    </Dialog>
  )
}

/** "From the company account. It holds $90.00." or "Into the company account. Remy holds $10.00." */
function Line({
  toAgent,
  ours,
  name,
  agentAccount,
  companyAccount,
  currency,
}: {
  toAgent: boolean
  ours: string
  name: string
  agentAccount?: CurrencyAccount
  companyAccount?: CurrencyAccount
  currency: string
}) {
  const Ours = `${ours.charAt(0).toUpperCase()}${ours.slice(1)}`
  if (companyAccount === undefined)
    return (
      <p className="text-body text-ink-2" data-testid="agent-funding-no-company-account">
        {Ours} has no {accountWords(currency)}.
      </p>
    )
  return (
    <p className="text-body text-ink-2" data-testid="agent-funding-line">
      {toAgent ? (
        <>
          From {ours}. It holds <Money minor={companyAccount.balance_minor} currency={currency} />.
        </>
      ) : (
        <>
          Into {ours}. {name} holds <Money minor={agentAccount?.balance_minor ?? 0} currency={currency} />.
        </>
      )}
    </p>
  )
}

/** Lens's refusal, in its own sentence. */
function Refused({ error }: { error: unknown }) {
  return (
    <p className="flex items-start gap-1.5 text-body text-danger" role="alert">
      <Icon name="x" size={16} />
      <span>{refusalText(error)}</span>
    </p>
  )
}
