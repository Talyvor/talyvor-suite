import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { cn, inlineLink } from '@talyvor/ui'
import {
  Button as PocketButton,
  Card as PocketCard,
  Chip,
  Crumb,
  Dialog,
  Facts,
  Field,
  Icon,
  Input as PocketInput,
  Money,
  Select as PocketSelect,
  pocketFocusRing,
} from '@talyvor/ui/pocket'
import { BOOK_KEY } from './AgentBank'
import { PAYEES_KEY } from './Pay'
import { MONEY_ACCOUNTS_KEY } from './Invoices'
import { readFailure } from './WalletMoney'
import { assertOver } from './passkeys'
import {
  type CurrencyAccount,
  type InstantQuote,
  type InstantQuoteRequest,
  type InstantTo,
  type InstantTransfer,
  type OutsidePayee,
  AgentBankError,
  FIATS,
  agentBankApi,
  approvalNamedIn,
  minorOf,
  newMoveKey,
  refusalText,
  useAccount,
} from './agentBankApi'
import { WorkspaceLabel } from '../../labels/workspace'
import { INSTANT_TRANSFER } from '../../labels/capabilities'
import { DESIGN_ATTR } from '../../pocketPending'

// InstantTransfer.tsx — B59.19: Instant transfer on the web, for a Hybrid account (launch pack 4.1 and 4.5, design W3 and
// P7 to P10). Pay › Instant transfer: who gets it (a Talyvor account, an outside wallet or an outside bank account), from
// which agent's account, how much, then one quote — you send, rate, fee, they get, and when it arrives — locked for 30
// seconds, counting down, with a fresh quote when they run out. Continue sends it from the agent's account (Lens B59.15
// to B59.17); when Lens asks for the owner's approval, the passkey signs it here and it is sent again at a fresh quote.
// Then its progress (Sent, Converted, On its way, Received) and its receipt: both conversions and the on-chain reference.
// Lens decides everything: a workspace that is not Hybrid never reaches it, and every refusal is read from its field.

export const instantKey = (id: string) => ['instant-transfer', id]

/** "US dollar" for USD: a balance or an account in words. */
export const BALANCE_WORDS: Record<string, string> = {
  USD: 'US dollar',
  GBP: 'pound',
  EUR: 'euro',
  USDC: 'USDC',
}
/** "US dollars" for USD: what a beneficiary gets, in words. */
export const MONEY_WORDS: Record<string, string> = {
  USD: 'US dollars',
  GBP: 'pounds',
  EUR: 'euros',
  USDC: 'USDC',
}
/** What a bank account in a country is paid in. Lens pays GBP, EUR and USD into a bank. */
const bankCurrency = (country: string) => (country === 'GB' ? 'GBP' : country === 'US' ? 'USD' : 'EUR')
const countryName = (code: string) => {
  try {
    return new Intl.DisplayNames(['en-GB'], { type: 'region' }).of(code) ?? code
  } catch {
    return code
  }
}

const CHOICES: { to: InstantTo; title: string; line: string }[] = [
  {
    to: 'talyvor_account',
    title: 'A Talyvor account',
    line: 'Lands in their balance.',
  },
  {
    to: 'wallet',
    title: 'An outside wallet',
    line: 'We send the stablecoin to the address they give.',
  },
  {
    to: 'bank_account',
    title: 'An outside bank account',
    line: 'They get fiat in their bank account.',
  },
]

/** "Arrives in seconds", or "Arrives by 14:20" with the bank rail's real time. */
export function arrivesText(t: { arrives_in_seconds: boolean; arrives_within_seconds?: number }, from: Date = new Date()): string {
  if (t.arrives_in_seconds || !t.arrives_within_seconds) return 'Arrives in seconds'
  const by = new Date(from.getTime() + t.arrives_within_seconds * 1000)
  return `Arrives by ${by.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
}

/** "1 USD = 0.9210 EUR": a rate Lens gives in whole units, to four places. */
export const rateText = (rate: string | number, sell: string, buy: string) => `1 ${sell} = ${Number(rate).toFixed(4)} ${buy}`

/** The seconds a quote has left, counted from when it arrived on this screen, so a clock that is off does not shorten it. */
function useSecondsLeft(quote: InstantQuote | undefined, arrivedAt: number): number {
  const [, tick] = useState(0)
  useEffect(() => {
    if (!quote) return
    const timer = setInterval(() => tick((n) => n + 1), 250)
    return () => clearInterval(timer)
  }, [quote, arrivedAt])
  if (!quote) return 0
  // Read at every render, so the render a new quote arrives in already counts its seconds.
  const life = Math.max(0, new Date(quote.expires_at).getTime() - new Date(quote.created_at).getTime())
  return Math.max(0, Math.ceil((arrivedAt + life - Date.now()) / 1000))
}

/** The words a refusal of a send is shown in, picked from its field and code (DESIGN 6), never its field's name. */
function sendRefusal(err: unknown, agent: string, account: CurrencyAccount | undefined): React.ReactNode {
  if (err instanceof AgentBankError) {
    if (err.body.field === 'may_instant_transfer') return `${agent} can’t use Instant transfer. Turn it on in ${agent}’s rules.`
    if (err.body.code === 'screened') return 'We can’t send to this recipient. Nothing was sent.'
    if (err.status === 409 && /quote/i.test(err.sentence)) return 'This quote expired. Nothing was sent.'
    if (err.status === 409 && /holds/i.test(err.sentence) && account)
      return (
        <>
          {agent}’s {BALANCE_WORDS[account.currency] ?? account.currency} balance holds <Money minor={account.test_minor} currency={account.currency} />. Lower the amount or top
          up.
        </>
      )
  }
  return refusalText(err)
}

/** B59.19 — /money/pay/instant-transfer: Pay › Instant transfer. Hybrid only: any other kind is sent back to Pay. */
export function PayInstantTransferScreen() {
  const { shows } = useAccount()
  if (shows && !shows.instantTransfer) return <Navigate to="/money/pay" replace />
  return (
    <div {...{ [DESIGN_ATTR]: 'pocket' }} className="grid gap-4 pb-10">
      <Crumb trail={[{ label: 'Pay', href: '/money/pay' }, { label: 'Instant transfer' }]} />
      {shows ? <InstantTransferForm /> : <p className="text-body text-ink-3">Reading…</p>}
    </div>
  )
}

function InstantTransferForm() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const accounts = useQuery({
    queryKey: MONEY_ACCOUNTS_KEY,
    queryFn: agentBankApi.moneyAccounts,
  })
  const payees = useQuery({
    queryKey: PAYEES_KEY,
    queryFn: agentBankApi.payees,
  })
  const book = useQuery({ queryKey: BOOK_KEY, queryFn: agentBankApi.book })
  const agentName = (id: string | undefined) => book.data?.agents?.find((x) => x.id === id)?.name ?? 'This agent'
  // An Instant transfer goes from an agent's account in pounds, euros or dollars.
  const from = (accounts.data?.accounts ?? []).filter((a) => a.status === 'open' && a.purpose === 'agent' && FIATS.includes(a.currency))
  const saved = payees.data?.payees ?? []

  const [to, setTo] = useState<InstantTo>('talyvor_account')
  const [accountID, setAccountID] = useState('')
  const [toAccount, setToAccount] = useState('')
  const [toCurrency, setToCurrency] = useState('USD')
  const [payeeID, setPayeeID] = useState('')
  const [amount, setAmount] = useState('')
  const [typed, setTyped] = useState('')
  const [key, setKey] = useState(newMoveKey)
  const [approvalID, setApprovalID] = useState<string | null>(null)
  const [declined, setDeclined] = useState(false)

  const pick = (next: InstantTo) => {
    setTo(next)
    setPayeeID('')
  }
  // The amount is quoted once typing stops, not at every key.
  useEffect(() => {
    const t = setTimeout(() => setTyped(amount), 400)
    return () => clearTimeout(t)
  }, [amount])

  const account = from.find((a) => a.id === accountID) ?? from[0]
  const agent = agentName(account?.agent_id)
  const choices = saved.filter((p) => (to === 'wallet' ? Boolean(p.address) : !p.address))
  const payee = choices.find((p) => p.id === payeeID)
  const minor = minorOf(typed)
  const receiveCurrency = to === 'wallet' ? 'USDC' : to === 'bank_account' ? bankCurrency(payee?.country ?? '') : toCurrency
  const recipient = to === 'talyvor_account' ? toAccount.trim() : (payee?.id ?? '')
  const ask: InstantQuoteRequest | null =
    account && recipient && minor !== null
      ? {
          send_minor: minor,
          send_currency: account.currency,
          receive_currency: receiveCurrency,
          to,
          country: to === 'bank_account' ? (payee?.country ?? '') : '',
        }
      : null

  const quote = useQuery({
    queryKey: ['instant-quote', ask],
    queryFn: () => agentBankApi.instantQuote(ask as InstantQuoteRequest),
    enabled: ask !== null,
    retry: false,
    staleTime: Infinity,
    gcTime: 0,
  })
  const seconds = useSecondsLeft(quote.data, quote.dataUpdatedAt)
  // The 30 seconds ran out: a fresh quote, unless one is on its way or a send is.
  const expired = quote.data !== undefined && seconds === 0
  useEffect(() => {
    if (expired && !quote.isFetching && approvalID === null) void quote.refetch()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refetch when it runs out, once
  }, [expired])

  const sendNow = async (at?: InstantQuote) => {
    if (!account || !ask) throw new AgentBankError(400, '/api/money/instant-transfers/quote', 'Pick who gets it')
    const fresh = at ?? (expired ? (await quote.refetch()).data : quote.data)
    if (!fresh) throw new AgentBankError(409, '/api/money/instant-transfers/quote', 'This quote expired. Nothing was sent.')
    return agentBankApi.instantSend(
      account.agent_id ?? '',
      {
        quote_id: fresh.id,
        ...(to === 'talyvor_account' ? { to_account_id: recipient } : { to_payee_id: recipient }),
      },
      key,
    )
  }
  const done = (t: InstantTransfer) => {
    qc.setQueryData(instantKey(t.id), t)
    void qc.invalidateQueries({ queryKey: MONEY_ACCOUNTS_KEY })
    setKey(newMoveKey())
    navigate(`/money/pay/instant-transfer/${encodeURIComponent(t.id)}`)
  }
  const send = useMutation({
    mutationFn: () => sendNow(),
    onSuccess: done,
    onError: (err) => {
      // A new payee, or an amount above the agent's approval amount: Lens filed an approval for the owner to sign.
      const id = approvalNamedIn(err)
      if (id) setApprovalID(id)
    },
  })
  // The owner approves with a passkey once the workspace has one; then it is sent again, at a fresh quote, once.
  const approve = useMutation({
    mutationFn: async () => {
      const id = approvalID ?? ''
      const c = await agentBankApi.approvalChallenge(id)
      await agentBankApi.decide(id, 'approve', (c.allow_credentials ?? []).length > 0 ? await assertOver(c) : undefined)
      return sendNow((await quote.refetch()).data)
    },
    onSuccess: (t) => {
      setApprovalID(null)
      done(t)
    },
  })
  const decline = useMutation({
    mutationFn: () => agentBankApi.decide(approvalID ?? '', 'deny'),
    onSuccess: () => {
      setApprovalID(null)
      setDeclined(true)
      setKey(newMoveKey())
    },
  })

  const reading = accounts.isError ? readFailure(accounts.error, 'Your accounts') : accounts.isPending ? 'Reading…' : null
  const why = !recipient ? 'Pick who gets it' : minor === null ? 'Add an amount to see your quote.' : undefined
  const q = quote.data
  const lockedFor = q ? Math.round((new Date(q.expires_at).getTime() - new Date(q.created_at).getTime()) / 1000) : 30
  const refused = send.isError && !approvalNamedIn(send.error)

  return (
    <div className="grid items-start gap-4 wide:grid-cols-5">
      <div className="grid min-w-0 gap-4 wide:col-span-3">
        <PocketCard data-testid="instant-transfer-form" className="grid gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-head font-bold text-ink">Instant transfer</h2>
            <WorkspaceLabel capability={INSTANT_TRANSFER} />
          </div>
          <fieldset className="grid gap-2">
            <legend className="mb-2 text-body font-semibold text-ink-2">Who gets it</legend>
            <div role="radiogroup" aria-label="Who gets it" className="grid gap-2 wide:grid-cols-3">
              {CHOICES.map((c) => (
                <label
                  key={c.to}
                  className={cn(
                    'relative grid cursor-pointer content-start gap-0.5 rounded-card-tight bg-page p-3.5 shadow-pocket',
                    'has-[:focus-visible]:outline has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-tangerine',
                    to === c.to ? 'ring-2 ring-inset ring-ink' : '',
                  )}
                >
                  <input type="radio" name="instant-to" className={cn('sr-only', pocketFocusRing)} checked={to === c.to} onChange={() => pick(c.to)} />
                  <span aria-hidden="true" className={cn('absolute right-3.5 top-3.5 inline-grid h-5 w-5 place-items-center rounded-pill shadow-edge', to === c.to && 'bg-ink')}>
                    {to === c.to ? <span className="h-2 w-2 rounded-pill bg-page" /> : null}
                  </span>
                  <span className="pr-7 font-semibold text-ink">{c.title}</span>
                  <span className="text-body text-ink-2">{c.line}</span>
                </label>
              ))}
            </div>
          </fieldset>
          {to === 'talyvor_account' ? (
            <div className="grid gap-3 wide:grid-cols-3">
              <Field label="Their Talyvor account" className="wide:col-span-2">
                <PocketInput aria-label="Their Talyvor account" placeholder="macc_…" value={toAccount} onChange={(e) => setToAccount(e.target.value)} />
              </Field>
              <Field label="They get">
                <PocketSelect aria-label="They get" value={toCurrency} onChange={(e) => setToCurrency(e.target.value)}>
                  {['USD', 'EUR', 'GBP', 'USDC'].map((c) => (
                    <option key={c} value={c}>
                      {MONEY_WORDS[c]}
                    </option>
                  ))}
                </PocketSelect>
              </Field>
            </div>
          ) : (
            <Field label="Recipient">
              {payees.isError ? (
                <p className="text-body text-ink-3">{readFailure(payees.error, 'Your payees')}</p>
              ) : choices.length === 0 ? (
                <p className="text-body text-ink-3" data-testid="instant-no-payees">
                  {to === 'wallet' ? 'No saved wallet yet.' : 'No payees yet.'}{' '}
                  <Link className={`text-ink ${inlineLink}`} to="/money/pay">
                    Add a payee
                  </Link>{' '}
                  on Pay first.
                </p>
              ) : (
                <PocketSelect aria-label="Recipient" value={payeeID} onChange={(e) => setPayeeID(e.target.value)}>
                  <option value="">Pick who gets it</option>
                  {choices.map((p) => (
                    <option key={p.id} value={p.id}>
                      {payeeLine(p)}
                    </option>
                  ))}
                </PocketSelect>
              )}
            </Field>
          )}
          {reading !== null ? (
            <p className="text-body text-ink-3">{reading}</p>
          ) : from.length === 0 ? (
            <p className="text-body text-ink-3" data-testid="instant-no-account">
              An Instant transfer goes from an agent’s account in pounds, euros or dollars: open one on Invoices first.
            </p>
          ) : (
            <div className="grid gap-3 wide:grid-cols-2">
              <div className="grid gap-1">
                <Field label="From">
                  <PocketSelect aria-label="From" value={account?.id ?? ''} onChange={(e) => setAccountID(e.target.value)}>
                    {from.map((a) => (
                      <option key={a.id} value={a.id}>
                        {agentName(a.agent_id)} · {BALANCE_WORDS[a.currency]} balance
                      </option>
                    ))}
                  </PocketSelect>
                </Field>
                {account ? (
                  <p className="text-body text-ink-3" data-testid="instant-holds">
                    holds <Money minor={account.test_minor} currency={account.currency} />
                  </p>
                ) : null}
              </div>
              <Field label="Amount">
                <PocketInput aria-label="Amount" inputMode="decimal" unit={account?.currency} value={amount} onChange={(e) => setAmount(e.target.value)} />
              </Field>
            </div>
          )}
        </PocketCard>
        {q ? <StatementPreview quote={q} beneficiary={to === 'talyvor_account' ? 'their account' : (payee?.name ?? '')} /> : null}
      </div>
      <PocketCard tone="white" className="grid gap-3 wide:col-span-2" data-testid="instant-quote">
        <h2 className="font-display text-head font-bold text-ink">Your quote</h2>
        {why !== undefined ? (
          <p className="text-body text-ink-3">{why}</p>
        ) : quote.isError ? (
          <div className="grid justify-items-start gap-2">
            <p className="text-body text-ink-2">
              {quote.error instanceof AgentBankError && quote.error.status < 500 && quote.error.status !== 409
                ? refusalText(quote.error)
                : 'We couldn’t get a quote. Nothing was sent.'}
            </p>
            <PocketButton type="button" variant="secondary" size="sm" onClick={() => void quote.refetch()}>
              Try again
            </PocketButton>
          </div>
        ) : !q ? (
          <p className="text-body text-ink-3" aria-live="polite">
            Getting your quote…
          </p>
        ) : (
          <>
            <Facts
              on="page"
              facts={[
                {
                  label: 'You send',
                  value: <Money minor={q.send_minor} currency={q.send_currency} />,
                },
                {
                  label: 'Rate',
                  value: rateText(q.rate, q.send_currency, q.receive_currency),
                },
                {
                  label: 'Fee',
                  value: <Money minor={q.fee_minor} currency={q.send_currency} />,
                },
                {
                  label: 'They get',
                  value: (
                    <span data-testid="instant-they-get">
                      <Money minor={q.receive_minor} currency={q.receive_currency} />
                    </span>
                  ),
                },
              ]}
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Chip tone="plain" data-testid="instant-arrives">
                <Icon name="send" size={14} />
                {arrivesText(q)}
              </Chip>
              <span className="text-body text-ink-3">
                Locked for <span className="font-figure">{lockedFor}</span> seconds
              </span>
            </div>
            <div aria-hidden="true" className="h-1.5 overflow-hidden rounded-pill bg-cloud-2">
              <div
                className="h-full bg-ink transition-all duration-200"
                style={{
                  width: `${Math.min(100, (seconds / Math.max(1, lockedFor)) * 100)}%`,
                }}
              />
            </div>
            <p className="text-right text-body text-ink-3" data-testid="instant-seconds-left" aria-live="polite" aria-label={`${seconds} seconds left on this quote`}>
              <span className="font-figure">{seconds}</span> seconds left
            </p>
          </>
        )}
        <PocketButton
          type="button"
          size="lg"
          disabled={!q || seconds === 0 || send.isPending || approve.isPending || approvalID !== null}
          className="w-full"
          onClick={() => {
            setDeclined(false)
            send.mutate()
          }}
        >
          {send.isPending ? 'Sending…' : 'Continue'}
        </PocketButton>
        {refused ? (
          <p className="flex items-start gap-1.5 text-body text-danger" role="alert" data-testid="instant-refused">
            <Icon name="x" size={16} />
            <span>
              {sendRefusal(send.error, agent, account)}
              {send.error instanceof AgentBankError && send.error.body.field === 'may_instant_transfer' && account?.agent_id ? (
                <>
                  {' '}
                  <Link className={`text-ink ${inlineLink}`} to={`/agents/${encodeURIComponent(account.agent_id)}/rules`}>
                    Open {agent}’s rules
                  </Link>
                </>
              ) : null}
            </span>
          </p>
        ) : null}
        {declined ? <p className="text-body text-ink-2">Declined. Nothing was sent.</p> : null}
        <p className="flex items-start gap-2 rounded-card-tight bg-cloud p-3.5 text-body text-ink-2">
          <Icon name="key" size={16} />
          <span>Your passkey or Face ID asks before anything is sent, when it’s outside {agent}’s rules or the payee is new.</span>
        </p>
        <p className="text-body text-ink-3">The amount in “They get” is the amount that arrives.</p>
      </PocketCard>
      <Dialog
        open={approvalID !== null}
        onClose={() => setApprovalID(null)}
        title="Approve this Instant transfer"
        actions={
          <>
            <PocketButton type="button" disabled={approve.isPending || decline.isPending} onClick={() => approve.mutate()}>
              {approve.isPending ? 'Approving…' : 'Approve with your passkey'}
            </PocketButton>
            <PocketButton type="button" variant="outline" disabled={approve.isPending || decline.isPending} onClick={() => decline.mutate()}>
              Decline
            </PocketButton>
          </>
        }
      >
        {q && account ? (
          <div className="grid gap-3" data-testid="instant-approval">
            <p className="text-body text-ink-3">From {agent}’s account</p>
            <p className="font-display text-title font-bold text-ink" tabIndex={-1}>
              <Money minor={q.send_minor} currency={q.send_currency} />
            </p>
            <p className="text-body text-ink-2">to {to === 'talyvor_account' ? recipient : (payee?.name ?? '')}</p>
            <p className="text-body text-ink-2">
              They get <Money minor={q.receive_minor} currency={q.receive_currency} /> · {arrivesText(q)}
            </p>
            <Facts
              facts={[
                {
                  label: 'Paid from',
                  value: `${agent}’s ${BALANCE_WORDS[account.currency]} balance`,
                },
              ]}
            />
            <p className="text-body text-ink-2">This approves this payment only.</p>
            {approve.isError ? (
              <p className="flex items-start gap-1.5 text-body text-danger" role="alert">
                <Icon name="x" size={16} />
                <span>
                  {approve.error instanceof Error && approve.error.message === 'The approval was not signed.' ? 'Nothing changed.' : sendRefusal(approve.error, agent, account)}
                </span>
              </p>
            ) : null}
          </div>
        ) : null}
      </Dialog>
    </div>
  )
}

/** "Lumen Freight GmbH · Germany · account ending 4417 · gets euros", or a wallet's name and the end of its address. */
function payeeLine(p: OutsidePayee): string {
  if (p.address) return `${p.name} · wallet ending ${p.address.slice(-4)}`
  const number = p.iban || p.account_number || ''
  return [p.name, countryName(p.country), number ? `account ending ${number.slice(-4)}` : '', `gets ${MONEY_WORDS[bankCurrency(p.country)]}`].filter(Boolean).join(' · ')
}

/** The line the statement will show for it, and the legs under it, from the quote (W3: "One line, three legs"). */
function StatementPreview({ quote: q, beneficiary }: { quote: InstantQuote; beneficiary: string }) {
  const direct = q.to === 'bank_account' && q.receive_currency === q.send_currency && q.fee_minor === 0
  const legs: [string, React.ReactNode][] = direct
    ? [['Pay out · to their bank', <Money minor={q.receive_minor} currency={q.receive_currency} />]]
    : [
        [`Convert · ${MONEY_WORDS[q.send_currency]} to USDC`, <Money minor={q.send_minor - q.fee_minor} currency={q.send_currency} />],
        ['Move · on chain', 'USDC'],
        ...(q.to === 'wallet'
          ? []
          : ([[q.to === 'bank_account' ? 'Pay out · to their bank' : 'Credit · to their account', <Money minor={q.receive_minor} currency={q.receive_currency} />]] as [
              string,
              React.ReactNode,
            ][])),
        ['Fee', <Money minor={q.fee_minor} currency={q.send_currency} />],
      ]
  return (
    <PocketCard tone="white" className="grid gap-2" data-testid="instant-statement-preview">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-head font-bold text-ink">On the statement</h2>
        <span className="text-body text-ink-3">{legs.length === 1 ? 'One line' : `One line, ${legs.length === 4 ? 'three' : 'two'} legs`}</span>
      </div>
      <div className="flex justify-between gap-3 border-t border-line pt-2 font-semibold text-ink">
        <span>Instant transfer to {beneficiary}</span>
        <Money minor={-q.send_minor} currency={q.send_currency} />
      </div>
      {legs.map(([what, figure]) => (
        <div key={what} className="flex justify-between gap-3 border-t border-line pt-2 pl-4 text-body text-ink-2">
          <span>{what}</span>
          {figure}
        </div>
      ))}
    </PocketCard>
  )
}
