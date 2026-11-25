import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { inlineLink } from '@talyvor/ui'
import { Button, Card, Dialog, Facts, Field, Icon, Input, Money, Select, showSnack } from '@talyvor/ui/pocket'
import { BOOK_KEY, saveFile } from './AgentBank'
import { MONEY_ACCOUNTS_KEY } from './Invoices'
import { usePendingApprovals } from './WalletScreens'
import { type Agent, type CurrencyAccount, type WalletMove, agentWalletApi, refusalText } from './agentBankApi'

// WalletsTogether.tsx — B48.19: the owner's money in one place, on Wallets (/money/wallets). Beside every agent's wallet:
// move money from one of the owner's agents to another, by dragging one agent's wallet onto another's or from Move
// between agents; how many approvals wait, crypto sends to a new address among them (B57.202), with the way to them;
// and every wallet's month, the owner's and each agent's, in one CSV or PDF (Lens B48.14's workspace statement).
// A move is Lens B48.8's route wallet: quoted first, then confirmed once under the quote's id, so it posts once however
// many times Move is pressed. Lens decides who may and how much; every refusal is its own sentence.

/** The data a dragged agent's wallet carries: its account's id. */
export const DRAG_TYPE = 'application/x-talyvor-wallet'

/** Wallets of two different agents in one currency: what a move can go between. */
export function movePairs(accounts: readonly CurrencyAccount[]) {
  return accounts.filter((a) => accounts.some((b) => b.currency === a.currency && b.agent_id !== a.agent_id))
}

/** "12.50" → 1250, or for USDC (six places) 12500000; null when it is not a positive amount. */
function typedMinor(text: string, currency: string): number | null {
  const places = currency === 'USDC' ? 6 : 2
  const m = new RegExp(`^\\s*(\\d+)(?:\\.(\\d{1,${places}}))?\\s*$`).exec(text)
  if (m === null) return null
  const minor = Number(m[1]) * 10 ** places + Number((m[2] ?? '').padEnd(places, '0'))
  return Number.isSafeInteger(minor) && minor > 0 ? minor : null
}

function Refused({ error }: { error: unknown }) {
  return (
    <p className="flex items-start gap-1.5 text-body text-danger" role="alert">
      <Icon name="x" size={16} />
      <span>{refusalText(error)}</span>
    </p>
  )
}

/** Move money from one of the owner's agents to another, in one currency: quoted, then moved once. */
export function MoveBetweenAgents({
  accounts,
  agents,
  from: fromAsked,
  to: toAsked,
  onClose,
}: {
  accounts: readonly CurrencyAccount[]
  agents: readonly Agent[]
  from?: string
  to?: string
  onClose: () => void
}) {
  const qc = useQueryClient()
  const pairs = movePairs(accounts)
  const nameOf = (a: CurrencyAccount | undefined) => agents.find((x) => x.id === a?.agent_id)?.name ?? a?.name ?? ''
  const [fromID, setFromID] = useState(fromAsked ?? pairs[0]?.id ?? '')
  const from = pairs.find((a) => a.id === fromID) ?? pairs[0]
  const targets = pairs.filter((a) => a.currency === from?.currency && a.agent_id !== from?.agent_id)
  const [toID, setToID] = useState(toAsked ?? '')
  const to = targets.find((a) => a.id === toID) ?? targets[0]
  const [amount, setAmount] = useState('')
  const [quote, setQuote] = useState<WalletMove | null>(null)
  const minor = from ? typedMinor(amount, from.currency) : null
  const ask = useMutation({
    mutationFn: () =>
      agentWalletApi.quote(to?.agent_id ?? '', { route: 'wallet', amount_minor: minor ?? 0, currency: from?.currency ?? '', from_agent_id: from?.agent_id ?? '' }),
    onSuccess: setQuote,
  })
  // A second press while the first is on its way sends nothing; Lens moves a confirmed quote once either way.
  const sending = useRef(false)
  const move = useMutation({
    mutationFn: () => agentWalletApi.confirm(quote?.agent_id ?? '', quote?.id ?? ''),
    onSettled: () => {
      sending.current = false
    },
    onSuccess: (m) => {
      void qc.invalidateQueries({ queryKey: MONEY_ACCOUNTS_KEY })
      void qc.invalidateQueries({ queryKey: BOOK_KEY })
      showSnack({
        title: (
          <>
            <Money minor={m.buy_minor} currency={m.buy_currency} /> moved from {nameOf(from)} to {nameOf(to)}
          </>
        ),
      })
      onClose()
    },
  })
  const why = !from || !to ? 'You need two agents with a wallet in one currency.' : minor === null ? 'Add an amount first.' : undefined
  return (
    <Dialog
      position="panel"
      open
      onClose={onClose}
      title="Move between agents"
      actions={
        quote ? (
          <>
            <Button
              type="button"
              variant="secondary"
              disabled={move.isPending}
              onClick={() => {
                setQuote(null)
                move.reset()
              }}
            >
              Back
            </Button>
            <Button
              type="button"
              disabled={move.isPending}
              onClick={() => {
                if (sending.current) return
                sending.current = true
                move.mutate()
              }}
            >
              {move.isPending ? (
                'Moving…'
              ) : (
                <>
                  Move <Money minor={quote.sell_minor} currency={quote.sell_currency} />
                </>
              )}
            </Button>
          </>
        ) : (
          <>
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="button" disabled={why !== undefined || ask.isPending} disabledReason={why} onClick={() => ask.mutate()}>
              {ask.isPending ? 'Getting your quote…' : 'Continue'}
            </Button>
          </>
        )
      }
    >
      {quote ? (
        <div className="grid gap-3" data-testid="move-review">
          <p className="font-display text-title font-bold text-ink">
            <Money minor={quote.sell_minor} currency={quote.sell_currency} />
          </p>
          <Facts
            facts={[
              { label: 'From', value: `${nameOf(from)} · ${quote.sell_currency}` },
              { label: 'To', value: `${nameOf(to)} · ${quote.buy_currency}` },
              ...(quote.fee_minor > 0 ? [{ label: 'Fee', value: <Money minor={quote.fee_minor} currency={quote.sell_currency} /> }] : []),
              { label: 'They get', value: <Money minor={quote.buy_minor} currency={quote.buy_currency} /> },
            ]}
          />
          {move.isError ? <Refused error={move.error} /> : null}
        </div>
      ) : (
        <div className="grid gap-3">
          <div className="grid gap-3 wide:grid-cols-2">
            <Field label="From">
              <Select
                aria-label="From"
                value={from?.id ?? ''}
                onChange={(e) => {
                  setFromID(e.target.value)
                  setToID('')
                }}
              >
                {pairs.map((a) => (
                  <option key={a.id} value={a.id}>
                    {nameOf(a)} · {a.currency}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="To">
              <Select aria-label="To" value={to?.id ?? ''} onChange={(e) => setToID(e.target.value)}>
                {targets.map((a) => (
                  <option key={a.id} value={a.id}>
                    {nameOf(a)} · {a.currency}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          {from ? (
            <p className="text-body text-ink-3">
              {nameOf(from)} holds <Money minor={from.balance_minor} currency={from.currency} className="font-normal" />.
            </p>
          ) : null}
          <Field label="Amount">
            <Input aria-label="Amount" inputMode="decimal" unit={from?.currency} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          {ask.isError ? <Refused error={ask.error} /> : null}
        </div>
      )}
    </Dialog>
  )
}

/** How many approvals wait for the owner, crypto sends among them, and the way to them; nothing while none do. */
export function ApprovalsWaiting() {
  const waiting = usePendingApprovals()
  if (!waiting) return null
  return (
    <p className="flex flex-wrap items-center gap-2 rounded-card-tight bg-cloud p-3.5 text-body text-ink-2" data-testid="wallets-approvals">
      <Icon name="key" size={16} />
      <span>
        <span className="font-figure">{waiting}</span> waiting for you.
      </span>
      <Link className={`font-semibold text-ink ${inlineLink}`} to="/approvals">
        Open Approvals
      </Link>
    </p>
  )
}

const thisMonth = () => new Date().toISOString().slice(0, 7)

/** Every wallet's month, the owner's and each agent's, in one CSV or PDF. */
export function AllStatements() {
  const [month, setMonth] = useState(thisMonth)
  const download = useMutation({
    mutationFn: async (format: 'csv' | 'pdf') => saveFile(`wallets-statement-${month}.${format}`, await agentWalletApi.ownerStatementFile(month, format)),
  })
  return (
    <Card tone="white" aria-labelledby="wallets-statements" className="grid gap-3" data-testid="wallets-statements">
      <h3 id="wallets-statements" className="font-display text-head font-bold text-ink">
        Statements
      </h3>
      <p className="text-body text-ink-2">Every wallet, yours and each agent’s, for one month in one file.</p>
      <Field label="Month">
        <Input type="month" aria-label="Month" max={thisMonth()} value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" size="sm" disabled={download.isPending} onClick={() => download.mutate('csv')}>
          Download CSV
        </Button>
        <Button type="button" variant="secondary" size="sm" disabled={download.isPending} onClick={() => download.mutate('pdf')}>
          Download PDF
        </Button>
      </div>
      {download.isError ? <Refused error={download.error} /> : null}
    </Card>
  )
}
