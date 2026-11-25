import { useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { inlineLink } from '@talyvor/ui'
import { Button, Card, Chip, Facts, Field, Input, Money, Row, Select, type ChipTone } from '@talyvor/ui/pocket'
import { kindWords } from './AccountStatement'
import { QrCode as QrOf } from './AgentMoneyWallet'
import { saveFile } from './AgentBank'
import { formatWhen } from './format'
import { CopyButton } from '../chat/CopyButton'
import { PAYEES_KEY } from './Pay'
import { assertOver } from './passkeys'
import { Note, PanelForm, readFailure } from './WalletMoney'
import {
  AgentBankError,
  type Agent,
  type AgentMoneyWallet,
  type CryptoPayRequest,
  type OutsidePayee,
  type WalletLine,
  type WalletMove,
  type WalletMoveRequest,
  type WalletMoveRoute,
  agentBankApi,
  agentWalletApi,
  minorOf,
  newMoveKey,
  refusalText,
  usdcMinorOf,
} from './agentBankApi'

// AgentWalletActions.tsx — B48.47: the rest of an agent's wallet, in its wallet panel (AgentMoneyWallet.tsx). Top up
// its USDC wallet by card, bank transfer, from the owner's money in pounds, euros or dollars, or from their own wallet
// (Lens B48.8), and cash it out to the owner's own bank account; each is quoted first — what it costs, the fee, the
// rate, what arrives, until when — then confirmed once, a cash-out or convert signed with the owner's passkey (B48.42).
// Request a payment as a link and a QR code (Lens B48.10). Activity: every posting on each wallet, a payment on the
// chain with its explorer link; Statements: a month of each wallet, and its CSV or PDF (Lens B48.14).
// B48.44: on the agent's page, the top-up its wallet_topup_link asked the owner for (?top_up=<move>), quoted then confirmed.

export const walletMovesKey = (id: string) => ['agent-wallet-moves', id]
export const walletActivityKey = (id: string) => ['agent-wallet-activity', id]
export const cryptoRequestsKey = (id: string) => ['agent-crypto-requests', id]

const FIAT = ['GBP', 'EUR', 'USD']

/** The routes into a USDC wallet, as the owner reads them; a fiat wallet is topped up from the owner's own money. */
const TOP_UP_ROUTES: { value: Exclude<WalletMoveRoute, 'cash_out'>; name: string }[] = [
  { value: 'card', name: 'Card' },
  { value: 'bank_transfer', name: 'Bank transfer' },
  { value: 'convert', name: 'From your pounds, euros or dollars' },
  { value: 'wallet', name: 'From your own USDC' },
]

/** Where a network's transactions are shown. */
const EXPLORERS: Record<string, string> = { base: 'https://basescan.org', 'base-sepolia': 'https://sepolia.basescan.org' }

/** A payment on a chain, on its network's explorer; null for a posting that is not on one. */
export function explorerLink(l: Pick<WalletLine, 'account_name' | 'ref'>): string | null {
  const network = l.account_name.startsWith('chain:') ? l.account_name.slice('chain:'.length) : ''
  const tx = (l.ref ?? '').split(':')[0]
  return EXPLORERS[network] && /^0x[0-9a-fA-F]{64}$/.test(tx) ? `${EXPLORERS[network]}/tx/${tx}` : null
}

/** "1 GBP = 1.2700 USDC". */
const rateText = (m: WalletMove) => `1 ${m.sell_currency} = ${m.rate} ${m.buy_currency}`

const currencyOf = (p: OutsidePayee) => (p.routing_number ? 'USD' : p.iban && !/^GB/i.test(p.iban) ? 'EUR' : 'GBP')

/** A confirm Lens did not answer may have gone through: confirming again makes it once, never twice. */
function confirmFailure(err: unknown): string {
  if (err instanceof AgentBankError && err.status === 409) return `${refusalText(err)} Ask for a new quote.`
  return err instanceof AgentBankError && err.status < 500 ? refusalText(err) : 'There was no answer. Press Confirm again: it is made once, however many times you press.'
}

/** What a quoted move costs and brings, then Confirm; a cash-out or convert is signed with the owner's passkey first. */
function MoveQuote({
  agent,
  m,
  gets,
  change = 'Change',
  onChange,
  onDone,
}: {
  agent: Agent
  m: WalletMove
  gets: string
  change?: string
  onChange: () => void
  onDone: (m: WalletMove) => void
}) {
  const qc = useQueryClient()
  const signs = m.route === 'cash_out' || m.route === 'convert'
  // A second press before the first has re-rendered the button disabled is not a second confirm.
  const sent = useRef(false)
  const confirm = useMutation({
    mutationFn: async () => {
      if (!signs) return agentWalletApi.confirm(agent.id, m.id)
      const c = await agentWalletApi.challenge(agent.id, m.id)
      const assertion = (c.allow_credentials ?? []).length > 0 ? await assertOver(c) : undefined
      return agentWalletApi.confirm(agent.id, m.id, assertion)
    },
    onSuccess: onDone,
    onSettled: () => {
      sent.current = false
      return Promise.all([
        qc.invalidateQueries({ queryKey: walletMovesKey(agent.id) }),
        qc.invalidateQueries({ queryKey: ['agent-money-wallets', agent.id] }),
        qc.invalidateQueries({ queryKey: walletActivityKey(agent.id) }),
      ])
    },
  })
  const press = () => {
    if (sent.current) return
    sent.current = true
    confirm.mutate()
  }
  return (
    <div className="grid gap-3" data-testid="wallet-move-quote">
      <Facts
        facts={[
          { label: m.route === 'cash_out' ? 'You sell' : 'You pay', value: <Money minor={m.sell_minor} currency={m.sell_currency} /> },
          { label: 'Fee', value: <Money minor={m.fee_minor} currency={m.sell_currency} /> },
          ...(m.sell_currency === m.buy_currency ? [] : [{ label: 'Rate', value: rateText(m) }]),
          {
            label: <span className="font-semibold text-ink">{gets}</span>,
            value: (
              <span data-testid="wallet-move-gets" className="font-display text-title font-bold">
                <Money minor={m.buy_minor} currency={m.buy_currency} />
              </span>
            ),
          },
          ...(m.expires_at ? [{ label: 'Price held until', value: formatWhen(m.expires_at) }] : []),
        ]}
      />
      {signs ? <p className="text-body text-ink-3">Your passkey asks before anything moves.</p> : null}
      <Button size="lg" className="w-full" disabled={confirm.isPending} onClick={press}>
        {confirm.isPending ? 'Confirming…' : 'Confirm'}
      </Button>
      <Button variant="secondary" className="w-full" disabled={confirm.isPending} onClick={onChange}>
        {change}
      </Button>
      {confirm.isError ? <Note ok={false}>{confirmFailure(confirm.error)}</Note> : null}
    </div>
  )
}

/** Where a confirmed move stands, in one sentence. */
function MoveDone({ agent, m }: { agent: Agent; m: WalletMove }) {
  return (
    <Note ok={m.status === 'posted'}>
      {m.status === 'posted' ? (
        m.route === 'cash_out' ? (
          <>
            Cashed out: <Money minor={m.buy_minor} currency={m.buy_currency} /> is on its way to your bank account.
          </>
        ) : (
          <>
            Added: <Money minor={m.buy_minor} currency={m.buy_currency} /> is in {agent.name}’s wallet.
          </>
        )
      ) : (
        m.detail || 'This is held while the partner finishes it. It shows here until it ends.'
      )}
    </Note>
  )
}

/** A quote whose price is no longer held: confirming it would be refused. */
const expired = (m: WalletMove) => m.status === 'quoted' && !!m.expires_at && Date.parse(m.expires_at) <= Date.now()

/** B48.44 — the top-up an agent asked its owner for (Lens B48.39's wallet_topup_link), opened from its link
 *  /agents/<id>?top_up=<move>: the quote as Lens B48.43 reads it back by id, then Confirm, made once (Lens B48.8). An
 *  expired quote says so, and Add money quotes the same top-up again. Not now closes it; nothing moves until Confirm. */
export function TopUpLink({ agent }: { agent: Agent }) {
  const [params, setParams] = useSearchParams()
  const moveID = params.get('top_up') ?? ''
  const read = useQuery({
    queryKey: [...walletMovesKey(agent.id), moveID],
    queryFn: () => agentWalletApi.move(agent.id, moveID),
    enabled: moveID !== '',
    retry: false,
  })
  const [fresh, setFresh] = useState<WalletMove | null>(null)
  const [done, setDone] = useState<WalletMove | null>(null)
  const again = useMutation({
    mutationFn: (m: WalletMove) => agentWalletApi.quote(agent.id, { route: m.route, amount_minor: m.sell_minor, currency: m.sell_currency }),
    onSuccess: setFresh,
  })
  if (moveID === '') return null
  const close = () =>
    setParams(
      (p) => {
        p.delete('top_up')
        return p
      },
      { replace: true },
    )
  const m = fresh ?? read.data
  const notNow = (
    <Button variant="secondary" className="w-full" onClick={close}>
      Not now
    </Button>
  )
  let body: React.ReactNode
  if (done) {
    body = (
      <>
        <MoveDone agent={agent} m={done} />
        <Button variant="secondary" className="w-full" onClick={close}>
          Close
        </Button>
      </>
    )
  } else if (read.isError) {
    body = (
      <>
        <Note ok={false}>
          {read.error instanceof AgentBankError && read.error.status === 404
            ? `This top-up link is not one ${agent.name} asked you for, or it has gone. Nothing moved.`
            : readFailure(read.error, 'This top-up')}
        </Note>
        {notNow}
      </>
    )
  } else if (!m) {
    body = <p className="text-body text-ink-3">Reading the quote…</p>
  } else if (m.route === 'cash_out') {
    body = (
      <>
        <Note ok={false}>{`This top-up link is not one ${agent.name} asked you for, or it has gone. Nothing moved.`}</Note>
        {notNow}
      </>
    )
  } else if (m.status !== 'quoted') {
    body = (
      <>
        <MoveDone agent={agent} m={m} />
        {notNow}
      </>
    )
  } else if (expired(m)) {
    body = (
      <>
        <Note ok={false}>This quote has expired. Nothing moved.</Note>
        <Button size="lg" className="w-full" disabled={again.isPending} onClick={() => again.mutate(m)}>
          {again.isPending ? 'Reading the quote…' : 'Add money'}
        </Button>
        {notNow}
        {again.isError ? <Note ok={false}>{refusalText(again.error)}</Note> : null}
      </>
    )
  } else {
    body = <MoveQuote key={m.id} agent={agent} m={m} gets={`${agent.name} gets`} change="Not now" onChange={close} onDone={setDone} />
  }
  return (
    <Card className="grid gap-3" data-testid="agent-top-up-link">
      <h2 className="font-display text-reading font-bold text-ink">Add money to {agent.name}</h2>
      {done ? null : <p className="text-body text-ink-2">{agent.name} asked for this top-up. Nothing moves until you confirm.</p>}
      {body}
    </Card>
  )
}

/** Top up one wallet: how, how much, the quote, Confirm. */
export function WalletTopUp({ agent, wallet, agents }: { agent: Agent; wallet: AgentMoneyWallet; agents: Agent[] }) {
  const usdc = wallet.asset === 'USDC'
  const routes = usdc ? TOP_UP_ROUTES : TOP_UP_ROUTES.filter((r) => r.value === 'wallet')
  const [route, setRoute] = useState<Exclude<WalletMoveRoute, 'cash_out'>>(routes[0].value)
  const [currency, setCurrency] = useState('GBP')
  const [from, setFrom] = useState('')
  const [amount, setAmount] = useState('')
  const [quote, setQuote] = useState<WalletMove | null>(null)
  const [done, setDone] = useState<WalletMove | null>(null)
  const buys = route !== 'wallet'
  const sells = buys ? currency : wallet.asset
  const minor = sells === 'USDC' ? usdcMinorOf(amount) : minorOf(amount)
  const others = agents.filter((a) => a.id !== agent.id)
  const body = (): WalletMoveRequest => ({
    route,
    amount_minor: minor ?? 0,
    currency: sells,
    ...(route === 'wallet' || route === 'convert' ? (from ? { from_agent_id: from } : {}) : {}),
  })
  const ask = useMutation({
    mutationFn: () => agentWalletApi.quote(agent.id, body()),
    onSuccess: (m) => {
      setDone(null)
      setQuote(m)
    },
  })
  if (quote) {
    return (
      <MoveQuote
        agent={agent}
        m={quote}
        gets={`${agent.name} gets`}
        onChange={() => setQuote(null)}
        onDone={(m) => {
          setQuote(null)
          setAmount('')
          setDone(m)
        }}
      />
    )
  }
  return (
    <div className="grid gap-3" data-testid={`wallet-top-up-${wallet.asset}`}>
      <PanelForm onSubmit={() => (minor !== null && !ask.isPending ? ask.mutate() : undefined)}>
        {routes.length > 1 ? (
          <Field label="How">
            <Select value={route} onChange={(e) => setRoute(e.target.value as typeof route)}>
              {routes.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        {(route === 'wallet' || route === 'convert') && others.length > 0 ? (
          <Field label="From">
            <Select value={from} onChange={(e) => setFrom(e.target.value)}>
              <option value="">Your own wallet</option>
              {others.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <div className="grid gap-3 wide:grid-cols-2">
          {buys ? (
            <Field label="Pay in">
              <Select value={currency} onChange={(e) => setCurrency(e.target.value)}>
                {FIAT.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <Field label={`Amount in ${sells}`}>
            <Input inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
        </div>
        <div>
          <Button type="submit" disabled={ask.isPending} disabledReason={minor !== null ? undefined : 'Type an amount first'}>
            {ask.isPending ? 'Reading the quote…' : 'Review'}
          </Button>
        </div>
        {ask.isError ? <Note ok={false}>{refusalText(ask.error)}</Note> : null}
      </PanelForm>
      {done ? <MoveDone agent={agent} m={done} /> : null}
    </div>
  )
}

/** Cash out the USDC wallet to one of the owner's own bank accounts. */
export function WalletCashOut({ agent }: { agent: Agent }) {
  const payees = useQuery({ queryKey: PAYEES_KEY, queryFn: agentBankApi.payees })
  const ready = (payees.data?.payees ?? []).filter((p) => !p.needs_confirmation)
  const [payeeID, setPayeeID] = useState('')
  const [amount, setAmount] = useState('')
  const [quote, setQuote] = useState<WalletMove | null>(null)
  const [done, setDone] = useState<WalletMove | null>(null)
  const payee = ready.find((p) => p.id === payeeID)
  const minor = usdcMinorOf(amount)
  const ask = useMutation({
    mutationFn: () =>
      agentWalletApi.quote(agent.id, { route: 'cash_out', amount_minor: minor ?? 0, currency: 'USDC', payee_id: payeeID, to_currency: payee ? currencyOf(payee) : 'GBP' }),
    onSuccess: (m) => {
      setDone(null)
      setQuote(m)
    },
  })
  if (payees.isError) return <p>{readFailure(payees.error, 'Your saved payees')}</p>
  if (payees.isSuccess && ready.length === 0) return <p>Save your own bank account as a payee on the Pay screen first, then cash out here.</p>
  if (quote) {
    return (
      <MoveQuote
        agent={agent}
        m={quote}
        gets={`${payee?.name ?? 'Your bank account'} gets`}
        onChange={() => setQuote(null)}
        onDone={(m) => {
          setQuote(null)
          setAmount('')
          setDone(m)
        }}
      />
    )
  }
  return (
    <div className="grid gap-3" data-testid="wallet-cash-out">
      <PanelForm onSubmit={() => (payee && minor !== null && !ask.isPending ? ask.mutate() : undefined)}>
        <div className="grid gap-3 wide:grid-cols-2">
          <Field label="To your bank account">
            <Select value={payeeID} onChange={(e) => setPayeeID(e.target.value)}>
              <option value="">Choose a payee</option>
              {ready.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Amount in USDC">
            <Input inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
        </div>
        <div>
          <Button type="submit" disabled={ask.isPending} disabledReason={payee && minor !== null ? undefined : 'Choose your bank account and type an amount first'}>
            {ask.isPending ? 'Reading the quote…' : 'Review'}
          </Button>
        </div>
        {ask.isError ? <Note ok={false}>{refusalText(ask.error)}</Note> : null}
      </PanelForm>
      {done ? <MoveDone agent={agent} m={done} /> : null}
    </div>
  )
}

const REQUEST_STATUS: Record<CryptoPayRequest['status'], [string, ChipTone]> = {
  open: ['Waiting', 'wait'],
  partial: ['Part paid', 'wait'],
  paid: ['Paid', 'good'],
  overpaid: ['Paid more', 'good'],
  expired: ['Expired', 'bad'],
}

const EXPIRES: { days: number; name: string }[] = [
  { days: 1, name: 'In a day' },
  { days: 7, name: 'In a week' },
  { days: 30, name: 'In 30 days' },
]

/** Ask to be paid USDC into the agent's wallet: a link and a QR code anyone can pay, then the requests and where they stand. */
export function WalletRequest({ agent }: { agent: Agent }) {
  const qc = useQueryClient()
  const [amount, setAmount] = useState('')
  const [memo, setMemo] = useState('')
  const [days, setDays] = useState(7)
  const [key, setKey] = useState(newMoveKey)
  const minor = usdcMinorOf(amount)
  const list = useQuery({ queryKey: cryptoRequestsKey(agent.id), queryFn: () => agentWalletApi.requests(agent.id) })
  const ask = useMutation({
    mutationFn: () =>
      agentWalletApi.request(
        agent.id,
        { token: 'USDC', network: 'base', amount_minor: minor ?? 0, memo: memo.trim(), expires_at: new Date(Date.now() + days * 86_400_000).toISOString() },
        key,
      ),
    onSuccess: () => {
      setKey(newMoveKey())
      setAmount('')
      setMemo('')
    },
    onSettled: () => qc.invalidateQueries({ queryKey: cryptoRequestsKey(agent.id) }),
  })
  const requests = list.data?.requests ?? []
  return (
    <div className="grid gap-3" data-testid="wallet-request">
      <PanelForm onSubmit={() => (minor !== null && memo.trim() && !ask.isPending ? ask.mutate() : undefined)}>
        <div className="grid gap-3 wide:grid-cols-2">
          <Field label="Amount in USDC">
            <Input inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="What it is for">
            <Input placeholder="What the payer sees" value={memo} onChange={(e) => setMemo(e.target.value)} />
          </Field>
        </div>
        <Field label="Expires">
          <Select value={String(days)} onChange={(e) => setDays(Number(e.target.value))}>
            {EXPIRES.map((x) => (
              <option key={x.days} value={x.days}>
                {x.name}
              </option>
            ))}
          </Select>
        </Field>
        <div>
          <Button type="submit" disabled={ask.isPending} disabledReason={minor !== null && memo.trim() ? undefined : 'Type an amount and what it is for first'}>
            {ask.isPending ? 'Making the link…' : 'Make the link'}
          </Button>
        </div>
        {ask.isError ? <Note ok={false}>{refusalText(ask.error)}</Note> : null}
      </PanelForm>
      {ask.data ? <RequestLink agent={agent} r={ask.data} /> : null}
      <section aria-label="Requests" className="grid gap-1 border-t border-line pt-3">
        <h3 className="font-semibold text-ink">Requests</h3>
        {list.isPending ? (
          <p className="text-body text-ink-3">Reading…</p>
        ) : list.isError ? (
          <p className="text-body text-ink-2">{readFailure(list.error, `${agent.name}’s requests`)}</p>
        ) : requests.length === 0 ? (
          <p className="text-body text-ink-3">{agent.name} has not asked to be paid yet.</p>
        ) : (
          requests.map((r) => (
            <div key={r.id} data-crypto-request={r.id} className="border-t border-line first:border-t-0">
              <Row
                wrap
                title={r.memo || 'A request to be paid'}
                line={
                  <span className="inline-flex flex-wrap items-center gap-2">
                    <Chip tone={REQUEST_STATUS[r.status][1]}>{REQUEST_STATUS[r.status][0]}</Chip>
                    <span>
                      Expires <span className="font-figure">{formatWhen(r.expires_at)}</span>
                    </span>
                    <CopyButton text={r.link} label="Copy the link" />
                  </span>
                }
                amount={<Money minor={r.amount_minor} currency="USDC" />}
              />
            </div>
          ))
        )}
      </section>
    </div>
  )
}

/** A new request: its link to share, and the QR code a wallet app scans to pay it. */
function RequestLink({ agent, r }: { agent: Agent; r: CryptoPayRequest }) {
  return (
    <div className="flex flex-col gap-3 wide:flex-row wide:items-start" data-testid="wallet-request-link" role="status">
      <QrOf text={r.uri} label={`QR code to pay ${agent.name} ${r.memo}`} />
      <div className="grid min-w-0 gap-2">
        <p className="text-ink">
          Share this link, or have the payer scan the code. It asks for <Money minor={r.amount_minor} currency="USDC" /> on Base.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <a href={r.link} target="_blank" rel="noreferrer" className={`min-w-0 break-all font-figure text-body text-ink ${inlineLink}`}>
            {r.link}
          </a>
          <CopyButton text={r.link} label="Copy the link" />
        </div>
      </div>
    </div>
  )
}

/** One wallet's postings, newest first; a payment on the chain links to its transaction. */
export function WalletActivity({ agent, asset }: { agent: Agent; asset: string }) {
  const activity = useQuery({ queryKey: walletActivityKey(agent.id), queryFn: () => agentWalletApi.activity(agent.id) })
  if (activity.isPending) return <p className="text-body text-ink-3">Reading…</p>
  if (activity.isError) return <p className="text-body text-ink-2">{readFailure(activity.error, `${agent.name}’s activity`)}</p>
  const lines = (activity.data.lines ?? []).filter((l) => l.currency === asset)
  if (lines.length === 0) return <p className="text-body text-ink-3">Nothing has gone into or out of this wallet yet. Press Top up to add money to it.</p>
  return (
    <div className="grid" data-testid={`wallet-activity-${asset}`}>
      {lines.map((l) => {
        const link = explorerLink(l)
        return (
          <div key={`${l.entry_id}:${l.line}`} className="border-t border-line first:border-t-0">
            <Row
              wrap
              title={l.counterparty && !l.counterparty.startsWith('workspace:') ? l.counterparty : kindWords(l.kind)}
              line={
                <span className="inline-flex flex-wrap items-center gap-2">
                  <span>
                    <span className="font-figure">{formatWhen(l.at)}</span>
                    {l.memo ? ` · ${l.memo}` : ''}
                  </span>
                  {link ? (
                    <a href={link} target="_blank" rel="noreferrer" className={`font-semibold text-ink ${inlineLink}`}>
                      See it on the explorer
                    </a>
                  ) : null}
                </span>
              }
              amount={
                <>
                  {l.amount_minor > 0 ? '+' : '−'}
                  <Money minor={Math.abs(l.amount_minor)} currency={l.currency} />
                </>
              }
            />
          </div>
        )
      })}
    </div>
  )
}

const thisMonth = () => new Date().toISOString().slice(0, 7)

/** One wallet's month: what it opened with, what came in and went out, what it closed with; its CSV and PDF. */
export function WalletStatements({ agent, asset }: { agent: Agent; asset: string }) {
  const [month, setMonth] = useState(thisMonth)
  const statement = useQuery({ queryKey: ['agent-wallet-statement', agent.id, month], queryFn: () => agentWalletApi.statement(agent.id, month) })
  const download = useMutation({
    mutationFn: async (format: 'csv' | 'pdf') => {
      saveFile(`${agent.name}-${asset}-statement-${month}.${format}`, await agentWalletApi.statementFile(agent.id, month, format))
    },
  })
  const accounts = (statement.data?.accounts ?? []).filter((a) => a.currency === asset)
  return (
    <div className="grid gap-3" data-testid={`wallet-statements-${asset}`}>
      <Field label="Month">
        <Input type="month" max={thisMonth()} value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
      </Field>
      {statement.isPending ? (
        <p className="text-body text-ink-3">Reading…</p>
      ) : statement.isError ? (
        <p className="text-body text-ink-2">{readFailure(statement.error, `${agent.name}’s statement`)}</p>
      ) : accounts.length === 0 ? (
        <p className="text-body text-ink-3">This wallet has no statement for that month.</p>
      ) : (
        accounts.map((a) => (
          <Facts
            key={a.account_id}
            facts={[
              { label: 'Opening balance', value: <Money minor={a.opening_minor} currency={a.currency} /> },
              { label: 'Money in', value: <Money minor={Math.abs(a.in_minor)} currency={a.currency} /> },
              { label: 'Money out', value: <Money minor={Math.abs(a.out_minor)} currency={a.currency} /> },
              { label: 'Closing balance', value: <Money minor={a.closing_minor} currency={a.currency} /> },
            ]}
          />
        ))
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" disabled={download.isPending} onClick={() => download.mutate('csv')}>
          Download CSV
        </Button>
        <Button variant="secondary" size="sm" disabled={download.isPending} onClick={() => download.mutate('pdf')}>
          Download PDF
        </Button>
      </div>
      {download.isError ? <Note ok={false}>{refusalText(download.error)}</Note> : null}
    </div>
  )
}
