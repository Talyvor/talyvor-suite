import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Button, CardHeader, Input, focusRing, tokens } from '@talyvor/ui'
import { encode } from 'uqr'
import { Card } from './walletBrand'
import { Note, readFailure } from './WalletMoney'
import { PAYEES_KEY } from './Pay'
import { CopyButton } from '../chat/CopyButton'
import { PreparedPayment } from '../chat/PaymentCards'
import { type Agent, type AgentMoneyWallet, type OutsidePayee, agentBankApi, formatMinor, minorOf, newMoveKey, refusalText } from './agentBankApi'

// AgentMoneyWallet.tsx — B46.9: the agent's wallet on the money layer (Lens B46.4). What it holds, how to add money to
// it — a USDC address on Base with its QR code, or an IBAN in the account holder's name, whichever its partner gives —
// and Send, which prepares a payment for the person to approve with one tap (Lens B40.3, B40.9's approval card). While
// the sandbox serves the wallet its details are made up, so there is nothing to copy: only Lens's sentence saying so.

export const walletKey = (id: string) => ['agent-money-wallet', id]

/** Lens keeps USDC to six decimal places. */
export const usdcText = (minor: number) =>
  `${(minor / 1e6).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 6 })} USDC`

const NETWORKS: Record<string, string> = { base: 'Base' }

/** The QR code of text, dark on light whatever the theme, so every camera reads it. */
export function QrCode({ text, label }: { text: string; label: string }) {
  const { data, size } = encode(text, { border: 2 })
  const path = data.flatMap((row, y) => row.flatMap((on, x) => (on ? [`M${x} ${y}h1v1h-1z`] : []))).join('')
  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${size} ${size}`} className="h-40 w-40 shrink-0 rounded-control" shapeRendering="crispEdges">
      <rect width={size} height={size} fill={tokens.light.surface} />
      <path d={path} fill={tokens.light.ink} />
    </svg>
  )
}

function Detail({ name, value }: { name: string; value: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-28 text-caption text-muted">{name}</span>
      <span className="min-w-0 break-all font-figure text-body text-ink">{value}</span>
      <CopyButton text={value} label={`Copy ${name.replace(/^[A-Z][a-z]/, (c) => c.toLowerCase())}`} />
    </div>
  )
}

/** How to add money: the address and its QR code, or the IBAN and its holder; nothing to copy from the sandbox. */
function AddMoney({ agent, wallet }: { agent: Agent; wallet: AgentMoneyWallet }) {
  const r = wallet.receive
  if (wallet.mode !== 'LIVE' || (!r.address && !r.iban)) {
    return (
      <p className="text-body text-muted" data-testid="wallet-no-details">
        {wallet.notice || `${agent.name}’s wallet has no details to pay into yet.`}
      </p>
    )
  }
  if (r.address) {
    const network = NETWORKS[(r.network ?? '').toLowerCase()] ?? r.network ?? ''
    return (
      <div className="flex flex-col gap-3 wide:flex-row wide:items-start" data-testid="wallet-address">
        <QrCode text={r.address} label={`QR code of ${agent.name}’s ${r.asset} address`} />
        <div className="flex min-w-0 flex-col gap-2">
          <p className="text-body text-ink">
            Send {r.asset}
            {network ? ` on ${network}` : ''} to this address. Money sent on another network is lost.
          </p>
          <Detail name="Address" value={r.address} />
        </div>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-2" data-testid="wallet-iban">
      <p className="text-body text-ink">Pay in from your own bank with these details.</p>
      {r.holder ? <Detail name="Account holder" value={r.holder} /> : null}
      <Detail name="IBAN" value={r.iban ?? ''} />
      {r.bic ? <Detail name="BIC" value={r.bic} /> : null}
    </div>
  )
}

const currencyOf = (p: OutsidePayee) => (p.routing_number ? 'USD' : p.iban && !/^GB/i.test(p.iban) ? 'EUR' : 'GBP')
const select = `h-8 rounded-control border border-rule bg-surface px-2 text-body text-ink transition-colors duration-200 hover:border-rule-strong ${focusRing}`

/** Send: prepares the payment, pays nothing; the approval card under it approves it with one tap. */
function Send({ agent }: { agent: Agent }) {
  const payees = useQuery({ queryKey: PAYEES_KEY, queryFn: agentBankApi.payees })
  const ready = (payees.data?.payees ?? []).filter((p) => !p.needs_confirmation)
  const [payeeID, setPayeeID] = useState('')
  const [amount, setAmount] = useState('')
  const [reference, setReference] = useState('')
  const [key, setKey] = useState(newMoveKey)
  const payee = ready.find((p) => p.id === payeeID)
  const minor = minorOf(amount)
  const currency = payee ? currencyOf(payee) : 'GBP'
  const prepare = useMutation({
    mutationFn: () =>
      agentBankApi.prepareRequest(
        { voice: false, items: [{ payee_id: payeeID, currency, amount_minor: minor ?? 0, reference: reference.trim() || `From ${agent.name}` }] },
        key,
      ),
    onSuccess: () => {
      setAmount('')
      setReference('')
      setKey(newMoveKey())
    },
  })
  if (payees.isError) return <p className="text-body text-muted">{readFailure(payees.error, 'Your saved payees')}</p>
  if (payees.isSuccess && ready.length === 0) return <p className="text-body text-muted">Save a payee on the Pay screen first, then send from here.</p>
  return (
    <form
      className="flex flex-col gap-2"
      data-testid="wallet-send"
      onSubmit={(e) => {
        e.preventDefault()
        if (payee && minor !== null && !prepare.isPending) prepare.mutate()
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Send to" className={select} value={payeeID} onChange={(e) => setPayeeID(e.target.value)}>
          <option value="">Choose a payee</option>
          {ready.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <Input
          aria-label={`Amount in ${currency}`}
          inputMode="decimal"
          placeholder={formatMinor(0, currency)}
          className="w-28 font-figure"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <Input aria-label="Reference" placeholder="What the payee sees" className="wide:w-56" value={reference} onChange={(e) => setReference(e.target.value)} />
        <Button type="submit" disabled={!payee || minor === null || prepare.isPending}>
          {prepare.isPending ? 'Preparing…' : 'Send'}
        </Button>
      </div>
      {prepare.isError ? <Note ok={false}>{refusalText(prepare.error)}</Note> : null}
      {prepare.data ? <PreparedPayment id={prepare.data.id} /> : null}
    </form>
  )
}

/** The agent's wallet: balance, how to add money, and Send. */
export function AgentMoneyWalletCard({ agent }: { agent: Agent }) {
  const wallet = useQuery({ queryKey: walletKey(agent.id), queryFn: () => agentBankApi.wallet(agent.id) })
  return (
    <Card>
      <CardHeader>Wallet</CardHeader>
      <div className="flex flex-col gap-4 px-gutter py-3" data-testid="agent-money-wallet">
        {wallet.isPending ? (
          <p className="text-body text-muted">Reading the wallet…</p>
        ) : wallet.isError ? (
          <p className="text-body text-muted">{readFailure(wallet.error, `${agent.name}’s wallet`)}</p>
        ) : (
          <>
            <p className="text-body text-ink">
              {agent.name} holds <span className="font-figure">{usdcText(wallet.data.balance_minor)}</span>.
            </p>
            <section className="flex flex-col gap-2" aria-label="Add money">
              <h3 className="text-body font-medium text-ink">Add money</h3>
              <AddMoney agent={agent} wallet={wallet.data} />
            </section>
          </>
        )}
        <section className="flex flex-col gap-2" aria-label="Send money">
          <h3 className="text-body font-medium text-ink">Send</h3>
          <Send agent={agent} />
        </section>
      </div>
    </Card>
  )
}
