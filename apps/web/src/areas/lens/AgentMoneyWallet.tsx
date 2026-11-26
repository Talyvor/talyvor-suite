import { useId, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { tokens } from '@talyvor/ui'
import { Button, Eyebrow, Facts, Field, Icon, Input, KindTile, Money, Select, pocketFocusRing, showToast, type IconName } from '@talyvor/ui/pocket'
import { encode } from 'uqr'
import { Note, PanelForm, readFailure } from './WalletMoney'
import { PAYEES_KEY } from './Pay'
import { PreparedPayment } from '../chat/PaymentCards'
import { type Agent, type AgentMoneyWallet, type AgentWallets, type OutsidePayee, type Shows, agentBankApi, formatMinor, minorOf, newMoveKey, refusalText, useAccount } from './agentBankApi'
import { WorkspaceLabel } from '../../labels/workspace'
import { MONEY_WALLET } from '../../labels/capabilities'
import { WalletActivity, WalletCashOut, WalletRequest, WalletStatements, WalletTopUp } from './AgentWalletActions'
import { WalletLimits } from './AgentWalletLimits'

// AgentMoneyWallet.tsx — B46.9: the agent's wallet on the money layer (Lens B46.4). What it holds, how to add money to
// it — a USDC address on Base with its QR code, or an IBAN in the account holder's name, whichever its partner gives —
// and Send, which prepares a payment for the person to approve with one tap (Lens B40.3, B40.9's approval card). While
// the sandbox serves the wallet its details are made up, so there is nothing to copy: only Lens's sentence saying so.
// B59.10 — by the workspace's kind (account.ts): a Fiat only account renders no address, a Stablecoin and crypto only
// account no IBAN and no Send, which pays a saved bank payee.
// B57.21 — a panel in Pocket's fields and <Money>, opened from Its wallet on the agent's page (AgentMoney.tsx).
// B57.215 — in Pocket: each wallet named with its balance, and how to pay into it as Pocket's facts, each value copied by
// its icon, as the Instant transfer receipt copies its reference.
// B48.18 — every wallet the agent owns, one of each kind it is (Lens B48.1): a "both" agent's fiat wallet and its USDC
// wallet, each with its balance and how to add money to it.
// B48.47 — and under each wallet what the owner does with it (AgentWalletActions.tsx): Top up, and for the USDC wallet
// Cash out and Request; then its Activity and Statements.
// B48.48 — and for the USDC wallet its Limits and permissions, each change signed with the owner's passkey
// (AgentWalletLimits.tsx).
// B57.216 — each of those a row as the Money card draws its own (AgentMoney.tsx): its tile, its name, the line saying what
// it does, and the chevron; pressing it opens its panel under it, and pressing it again closes it.

export const walletKey = (id: string) => ['agent-money-wallet', id]
export const walletsKey = (id: string) => ['agent-money-wallets', id]

/** "€10.00 and 2.50 USDC": what the agent holds across its wallets, each figure a <Money>. */
export function Holds({ wallets }: { wallets: AgentWallets }) {
  const all = wallets.wallets
  return (
    <>
      {all.map((x, i) => (
        <span key={x.asset}>
          {i === 0 ? '' : i === all.length - 1 ? ' and ' : ', '}
          <Money minor={x.balance_minor} currency={x.asset} />
        </span>
      ))}
    </>
  )
}

/** Lens keeps USDC to six decimal places. */
export const usdcText = (minor: number) => formatMinor(minor, 'USDC')

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

/** Puts text on the clipboard and says so in one line at the bottom. */
function copy(text: string) {
  void (navigator.clipboard?.writeText(text) ?? Promise.reject(new Error('no clipboard'))).then(
    () => showToast('Copied'),
    () => showToast('We couldn’t copy it. Select it and copy it instead.'),
  )
}

/** How to pay into a wallet, as Pocket's facts: each detail by name, its value, and an icon that copies it. */
function Details({ rows }: { rows: { name: string; value: string; copy?: boolean }[] }) {
  return (
    <Facts
      facts={rows.map((r) => ({
        label: r.name,
        value: (
          <span className="inline-flex max-w-full items-center justify-end gap-2">
            <span className="min-w-0 break-all">{r.value}</span>
            {r.copy === false ? null : (
              <button
                type="button"
                aria-label={`Copy ${r.name.replace(/^[A-Z][a-z]/, (c) => c.toLowerCase())}`}
                className={`shrink-0 rounded-pill text-ink-3 ${pocketFocusRing}`}
                onClick={() => copy(r.value)}
              >
                <Icon name="copy" size={14} />
              </button>
            )}
          </span>
        ),
      }))}
    />
  )
}

/** How to add money: the address and its QR code, or the IBAN and its holder; nothing to copy from the sandbox. */
function AddMoney({ agent, wallet, shows }: { agent: Agent; wallet: AgentMoneyWallet; shows: Shows }) {
  const r = {
    ...wallet.receive,
    address: shows.onChain ? wallet.receive.address : undefined,
    iban: shows.bankTransfers ? wallet.receive.iban : undefined,
  }
  if (wallet.mode !== 'LIVE' || (!r.address && !r.iban)) {
    return (
      <p data-testid="wallet-no-details">
        {wallet.notice || `${agent.name}’s wallet has no details to pay into yet.`}
      </p>
    )
  }
  if (r.address) {
    const network = NETWORKS[(r.network ?? '').toLowerCase()] ?? r.network ?? ''
    return (
      <div className="flex flex-col gap-3 wide:flex-row wide:items-start" data-testid="wallet-address">
        <QrCode text={r.address} label={`QR code of ${agent.name}’s ${r.asset} address`} />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <p className="text-body text-ink">
            Send {r.asset}
            {network ? ` on ${network}` : ''} to this address. Money sent on another network is lost.
          </p>
          <Details rows={[{ name: 'Address', value: r.address }, ...(network ? [{ name: 'Network', value: network, copy: false }] : [])]} />
        </div>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-2" data-testid="wallet-iban">
      <p className="text-body text-ink">Pay in from your own bank with these details.</p>
      <Details
        rows={[
          ...(r.holder ? [{ name: 'Account holder', value: r.holder }] : []),
          { name: 'IBAN', value: r.iban ?? '' },
          ...(r.bic ? [{ name: 'BIC', value: r.bic }] : []),
          ...(wallet.payment_reference ? [{ name: 'Reference', value: wallet.payment_reference }] : []),
        ]}
      />
    </div>
  )
}

const currencyOf = (p: OutsidePayee) => (p.routing_number ? 'USD' : p.iban && !/^GB/i.test(p.iban) ? 'EUR' : 'GBP')

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
  if (payees.isError) return <p>{readFailure(payees.error, 'Your saved payees')}</p>
  if (payees.isSuccess && ready.length === 0) return <p>Save a payee on the Pay screen first, then send from here.</p>
  return (
    <div data-testid="wallet-send" className="grid gap-3">
      <PanelForm onSubmit={() => (payee && minor !== null && !prepare.isPending ? prepare.mutate() : undefined)}>
        <Field label="Send to">
          <Select value={payeeID} onChange={(e) => setPayeeID(e.target.value)}>
            <option value="">Choose a payee</option>
            {ready.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid gap-3 wide:grid-cols-2">
          <Field label={`Amount in ${currency}`}>
            <Input inputMode="decimal" placeholder={formatMinor(0, currency)} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="Reference">
            <Input placeholder="What the payee sees" value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
        </div>
        <div>
          <Button type="submit" disabled={prepare.isPending} disabledReason={payee && minor !== null ? undefined : 'Choose a payee and type an amount first'}>
            {prepare.isPending ? 'Preparing…' : 'Send'}
          </Button>
        </div>
        {prepare.isError ? <Note ok={false}>{refusalText(prepare.error)}</Note> : null}
      </PanelForm>
      {prepare.data ? <PreparedPayment id={prepare.data.id} /> : null}
    </div>
  )
}

type WalletAction = 'top-up' | 'cash-out' | 'request' | 'activity' | 'statements' | 'limits'

const ACTION_WORDS: Record<WalletAction, string> = {
  'top-up': 'Top up',
  'cash-out': 'Cash out',
  request: 'Request',
  activity: 'Activity',
  statements: 'Statements',
  limits: 'Limits and permissions',
}

const ACTION_ICONS: Record<WalletAction, IconName> = {
  'top-up': 'plus',
  'cash-out': 'arrow',
  request: 'coin',
  activity: 'clock',
  statements: 'statements',
  limits: 'shield',
}

/** What each action does, in the line under its name. */
function actionLine(a: WalletAction, agent: Agent, wallet: AgentMoneyWallet): string {
  switch (a) {
    case 'top-up':
      return wallet.asset === 'USDC' ? 'By card, bank transfer, or from your own money or USDC' : `From your own ${wallet.asset}`
    case 'cash-out':
      return `Turn ${agent.name}’s USDC back into money, in your own bank account`
    case 'request':
      return 'Ask to be paid, with a link and a QR code, and see where each request stands'
    case 'activity':
      return 'Everything into and out of this wallet, newest first'
    case 'statements':
      return 'A month of this wallet, and its CSV or PDF'
    case 'limits':
      return `What ${agent.name} may pay from it, each change signed with your passkey`
  }
}

/** One action's row: the whole row opens its panel under it; the line under the name describes it. */
function ActionRow({ icon, title, line, open, onToggle }: { icon: IconName; title: string; line: string; open: boolean; onToggle: () => void }) {
  const id = useId()
  return (
    <div className="relative flex items-center gap-3 py-2.5 text-reading">
      <KindTile on="white" icon={<Icon name={icon} size={18} />} />
      <span className="min-w-0 flex-1">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-describedby={id}
          className={`block rounded-control text-left font-semibold text-ink ${pocketFocusRing}`}
        >
          <span aria-hidden="true" className="absolute inset-0" />
          {title}
        </button>
        <span id={id} className="block text-body text-ink-3">
          {line}
        </span>
      </span>
      <Icon name="chev" size={16} className={`shrink-0 text-ink-3 transition-transform duration-200 ${open ? 'rotate-90' : ''}`} />
    </div>
  )
}

/** One wallet's actions: a row each, the one pressed open under it. */
function WalletActions({ agent, wallet, agents }: { agent: Agent; wallet: AgentMoneyWallet; agents: Agent[] }) {
  const [open, setOpen] = useState<WalletAction | null>(null)
  const usdc = wallet.asset === 'USDC'
  const actions: WalletAction[] = usdc ? ['top-up', 'cash-out', 'request', 'activity', 'statements', 'limits'] : ['top-up', 'activity', 'statements']
  return (
    <div className="grid" role="group" aria-label={`What to do with the ${wallet.asset} wallet`}>
      {actions.map((a) => (
        <div key={a} className="grid border-t border-line first:border-t-0">
          <ActionRow icon={ACTION_ICONS[a]} title={ACTION_WORDS[a]} line={actionLine(a, agent, wallet)} open={open === a} onToggle={() => setOpen(open === a ? null : a)} />
          {open === a ? (
            <div className="pb-3">
              {a === 'top-up' ? <WalletTopUp agent={agent} wallet={wallet} agents={agents} /> : null}
              {a === 'cash-out' ? <WalletCashOut agent={agent} /> : null}
              {a === 'request' ? <WalletRequest agent={agent} /> : null}
              {a === 'activity' ? <WalletActivity agent={agent} asset={wallet.asset} /> : null}
              {a === 'statements' ? <WalletStatements agent={agent} asset={wallet.asset} /> : null}
              {a === 'limits' ? <WalletLimits agent={agent} /> : null}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  )
}

/** The agent's wallets: each one's balance and how to add money to it, then Send. */
export function AgentMoneyWalletCard({ agent, agents = [agent] }: { agent: Agent; agents?: Agent[] }) {
  const wallets = useQuery({ queryKey: walletsKey(agent.id), queryFn: () => agentBankApi.wallets(agent.id) })
  const { shows } = useAccount()
  const all = wallets.data?.wallets ?? []
  return (
    <div className="grid gap-4" data-testid="agent-money-wallet">
      <WorkspaceLabel capability={MONEY_WALLET} className="justify-self-start" />
      {wallets.isPending ? (
        <p>Reading the wallet…</p>
      ) : wallets.isError ? (
        <p>{readFailure(wallets.error, `${agent.name}’s wallet`)}</p>
      ) : all.length === 0 ? (
        <p>{agent.name} has no wallet yet.</p>
      ) : (
        <>
          <p className="text-ink">
            {agent.name} holds <Holds wallets={wallets.data} />.
          </p>
          {all.map((w) => (
            <section key={w.asset} className="grid gap-2" aria-label={all.length > 1 ? `Its ${w.asset} wallet` : 'Add money'} data-testid={`agent-wallet-${w.asset}`}>
              {all.length > 1 ? (
                <h3 className="flex items-baseline justify-between gap-2 text-body font-semibold text-ink">
                  <span>Its {w.asset} wallet</span>
                  <Money minor={w.balance_minor} currency={w.asset} />
                </h3>
              ) : null}
              <Eyebrow>Add money</Eyebrow>
              {shows ? <AddMoney agent={agent} wallet={w} shows={shows} /> : null}
              <WalletActions agent={agent} wallet={w} agents={agents} />
            </section>
          ))}
        </>
      )}
      {shows?.bankTransfers ? (
        <section className="grid gap-2" aria-label="Send money">
          <Eyebrow>Send</Eyebrow>
          <Send agent={agent} />
        </section>
      ) : null}
    </div>
  )
}
