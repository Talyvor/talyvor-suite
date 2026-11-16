import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { cn, inlineLink } from '@talyvor/ui'
import {
  Button as PocketButton,
  Card as PocketCard,
  Dialog,
  Eyebrow,
  Facts,
  Field,
  Icon,
  Input as PocketInput,
  Money,
  Row,
  Select as PocketSelect,
} from '@talyvor/ui/pocket'
import { BOOK_KEY } from './AgentBank'
import { PAYEES_KEY, AddPayee } from './Pay'
import { MONEY_ACCOUNTS_KEY } from './Invoices'
import { readFailure } from './WalletMoney'
import { assertOver } from './passkeys'
import { rateText } from './InstantTransfer'
import {
  type CurrencyAccount,
  type OutsidePayee,
  type Shows,
  type SideConversion,
  FIATS,
  agentBankApi,
  newMoveKey,
  refusalText,
  useAccount,
} from './agentBankApi'
import { DESIGN_ATTR } from '../../pocketPending'
import { AgentFundingButtons } from './AgentFunding'

// Wallets.tsx — B59.53: Wallets on the web, the twin of the phone's (B59.33). Each side the account's kind shows (SPEC
// 3.3): Fiat only the fiat side, Stablecoin and crypto only the stablecoin side, Hybrid both, fiat first. Each side has a
// tile per currency, then each account in it with what it holds, the company's first. Add money adds Sandbox money to one
// of the company's accounts; Withdraw pays one out to a bank saved as the owner's own; Convert (Hybrid only) sells a
// currency for USDC or USDC for a currency, between the company's accounts on the two sides. Each has a confirm step,
// and Withdraw and Convert are signed there with the owner's passkey once the workspace has one (BFF B59.52, Lens B59.51).
// Home's Add money, Withdraw and Convert open it at that action (?do=). Lens decides everything and every refusal is its own
// sentence. A side, an action or a field the kind does not have is not rendered.
// B61.84 — beside each agent's account, Add money from the company's account in its currency and Take back (AgentFunding.tsx).

export type Side = 'fiat' | 'stablecoin'
export type WalletAction = 'top-up' | 'withdraw' | 'convert'

const SIDE_WORD: Record<Side, string> = { fiat: 'Fiat', stablecoin: 'Stablecoin' }
/** The currencies by name, as Home and the phone name them. */
export const CURRENCY_NAME: Record<string, string> = { USD: 'US dollar', EUR: 'Euro', GBP: 'British pound' }
const FIAT_ORDER = ['USD', 'EUR', 'GBP']
const isCoin = (currency: string) => !FIATS.includes(currency)

/** Each side the kind shows: what each currency holds across it, and its open accounts, the company's first. */
export function walletSides(accounts: readonly CurrencyAccount[], shows: Pick<Shows, 'bankTransfers' | 'onChain'>) {
  const open = accounts.filter((a) => a.status !== 'closed')
  const sides: Side[] = [...(shows.bankTransfers ? (['fiat'] as const) : []), ...(shows.onChain ? (['stablecoin'] as const) : [])]
  const rank = (c: string) => (isCoin(c) ? 10 : FIAT_ORDER.indexOf(c))
  return sides.map((side) => {
    const own = open.filter((a) => isCoin(a.currency) === (side === 'stablecoin'))
    const sums = new Map<string, number>()
    for (const a of own) sums.set(a.currency, (sums.get(a.currency) ?? 0) + a.balance_minor)
    return {
      side,
      totals: [...sums].map(([currency, minor]) => ({ currency, minor })).sort((a, b) => rank(a.currency) - rank(b.currency) || a.currency.localeCompare(b.currency)),
      accounts: [...own].sort((a, b) => Number(b.purpose === 'company') - Number(a.purpose === 'company') || rank(a.currency) - rank(b.currency)),
    }
  })
}

/** "12.50" → 1250, or for USDC (six places) 12500000: a typed amount in the currency's minor units; null when not positive. */
export function amountMinor(text: string, currency: string): number | null {
  const places = currency === 'USDC' ? 6 : 2
  const m = new RegExp(`^\\s*(\\d+)(?:\\.(\\d{1,${places}}))?\\s*$`).exec(text)
  if (m === null) return null
  const minor = Number(m[1]) * 10 ** places + Number((m[2] ?? '').padEnd(places, '0'))
  return Number.isSafeInteger(minor) && minor > 0 ? minor : null
}

/** "The company · USD" or "Your account · USD" for the company's, "Remy · USD" for an agent's. */
function nameOf(a: CurrencyAccount, owner: string, agents: { id: string; name: string }[]): string {
  if (a.purpose === 'company') return `${owner} · ${a.currency}`
  return `${agents.find((x) => x.id === a.agent_id)?.name ?? a.name} · ${a.currency}`
}

/** B59.53 — /money/wallets. */
export function WalletsScreen() {
  const { shows } = useAccount()
  const [params, setParams] = useSearchParams()
  const accounts = useQuery({ queryKey: MONEY_ACCOUNTS_KEY, queryFn: agentBankApi.moneyAccounts })
  const book = useQuery({ queryKey: BOOK_KEY, queryFn: agentBankApi.book })
  const agents = book.data?.agents ?? []
  const asked = params.get('do')
  const open = (a: WalletAction | null) => setParams(a ? { do: a } : {}, { replace: true })
  const all = accounts.data?.accounts ?? []
  const action: WalletAction | null =
    asked === 'top-up' || (asked === 'withdraw' && shows?.bankTransfers) || (asked === 'convert' && shows?.convert) ? (asked as WalletAction) : null

  return (
    <div {...{ [DESIGN_ATTR]: 'pocket' }} className="grid gap-5 pb-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        {shows ? (
          <div className="flex flex-wrap gap-2" data-testid="wallets-actions">
            <PocketButton type="button" icon={<Icon name="plus" size={18} />} onClick={() => open('top-up')}>
              Add money
            </PocketButton>
            {shows.bankTransfers ? (
              <PocketButton type="button" variant="white" onClick={() => open('withdraw')}>
                Withdraw
              </PocketButton>
            ) : null}
            {shows.convert ? (
              <PocketButton type="button" variant="white" onClick={() => open('convert')}>
                Convert
              </PocketButton>
            ) : null}
          </div>
        ) : null}
      </div>
      {!shows || accounts.isPending ? (
        <p className="text-body text-ink-3">Reading…</p>
      ) : accounts.isError ? (
        <p className="text-body text-ink-2">{readFailure(accounts.error, 'Your accounts')}</p>
      ) : (
        <div className={cn('grid items-start gap-5', shows.bankTransfers && shows.onChain && 'wide:grid-cols-2')}>
          {walletSides(all, shows).map((s) => (
            <section key={s.side} aria-label={SIDE_WORD[s.side]} data-testid={`wallets-${s.side}`} className="grid content-start gap-3">
              <Eyebrow>{SIDE_WORD[s.side]}</Eyebrow>
              {s.totals.length === 0 ? (
                <p className="text-body text-ink-2">{s.side === 'fiat' ? 'Add money to get started.' : 'Receive stablecoins to get started.'}</p>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-y-3.5 rounded-card bg-cloud p-4">
                    {s.totals.map(({ currency, minor }) => (
                      <div key={currency} className="grid gap-0.5" data-testid={`wallets-tile-${currency}`}>
                        <span className="text-body text-ink-3">{CURRENCY_NAME[currency] ?? currency}</span>
                        <Money minor={minor} currency={currency} className="font-semibold text-ink" />
                      </div>
                    ))}
                  </div>
                  <PocketCard tone="white" className="grid">
                    {s.accounts.map((a) => (
                      <Row
                        key={a.id}
                        title={nameOf(a, shows.owner, agents)}
                        line={CURRENCY_NAME[a.currency] ?? a.currency}
                        amount={<Money minor={a.balance_minor} currency={a.currency} />}
                        wrap={a.purpose === 'agent'}
                        action={
                          a.purpose === 'agent' && a.agent_id ? (
                            <AgentFundingButtons agent={{ id: a.agent_id, name: agents.find((x) => x.id === a.agent_id)?.name ?? a.name }} currency={a.currency} size="sm" />
                          ) : undefined
                        }
                      />
                    ))}
                  </PocketCard>
                </>
              )}
            </section>
          ))}
        </div>
      )}
      {shows ? (
        <>
          <TopUp open={action === 'top-up'} onClose={() => open(null)} shows={shows} />
          {shows.bankTransfers ? <Withdraw open={action === 'withdraw'} onClose={() => open(null)} shows={shows} /> : null}
          {shows.convert ? <Convert open={action === 'convert'} onClose={() => open(null)} shows={shows} /> : null}
        </>
      ) : null}
    </div>
  )
}

/** The company's open accounts on the sides the kind shows (only the fiat side with fiatOnly), and their read. */
function useCompanyAccounts(shows: Shows, fiatOnly = false) {
  const read = useQuery({ queryKey: MONEY_ACCOUNTS_KEY, queryFn: agentBankApi.moneyAccounts })
  const accounts = (read.data?.accounts ?? []).filter(
    (a) => a.status === 'open' && a.purpose === 'company' && (isCoin(a.currency) ? shows.onChain && !fiatOnly : shows.bankTransfers),
  )
  return { read, accounts }
}

/** A refusal or a failure, in Lens's own sentence; a passkey prompt the owner closed changed nothing. */
function Refused({ error }: { error: unknown }) {
  const text = error instanceof Error && error.message === 'The approval was not signed.' ? 'Nothing changed.' : refusalText(error)
  return (
    <p className="flex items-start gap-1.5 text-body text-danger" role="alert">
      <Icon name="x" size={16} />
      <span>{text}</span>
    </p>
  )
}

function NoAccount() {
  return (
    <p className="text-body text-ink-2" data-testid="wallets-no-account">
      Open an account on{' '}
      <Link className={`text-ink ${inlineLink}`} to="/money/invoices">
        Invoices
      </Link>{' '}
      first.
    </p>
  )
}

/** The account picker and the amount, shared by Top up and Withdraw. */
function AccountAndAmount({
  accounts,
  owner,
  accountID,
  setAccountID,
  amount,
  setAmount,
}: {
  accounts: CurrencyAccount[]
  owner: string
  accountID: string
  setAccountID: (id: string) => void
  amount: string
  setAmount: (a: string) => void
}) {
  const account = accounts.find((a) => a.id === accountID) ?? accounts[0]
  return (
    <div className="grid gap-3 wide:grid-cols-2">
      <Field label="Account">
        <PocketSelect aria-label="Account" value={account?.id ?? ''} onChange={(e) => setAccountID(e.target.value)}>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {owner} · {a.currency}
            </option>
          ))}
        </PocketSelect>
      </Field>
      <Field label="Amount">
        <PocketInput aria-label="Amount" inputMode="decimal" unit={account?.currency} value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Field>
    </div>
  )
}

/** Add money (B61.80; was Top up): Sandbox money into one of the company's accounts, once under its key. */
function TopUp({ open, onClose, shows }: { open: boolean; onClose: () => void; shows: Shows }) {
  const qc = useQueryClient()
  const { read, accounts } = useCompanyAccounts(shows)
  const owner = shows.owner
  const [accountID, setAccountID] = useState('')
  const [amount, setAmount] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [key, setKey] = useState(newMoveKey)
  const account = accounts.find((a) => a.id === accountID) ?? accounts[0]
  const minor = account ? amountMinor(amount, account.currency) : null
  const close = () => {
    setConfirming(false)
    setAmount('')
    top.reset()
    onClose()
  }
  const top = useMutation({
    mutationFn: () => agentBankApi.walletTopUp(account?.id ?? '', minor ?? 0, key),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: MONEY_ACCOUNTS_KEY })
      setKey(newMoveKey())
      close()
    },
  })
  return (
    <Dialog
      open={open}
      onClose={close}
      title="Add money"
      actions={
        confirming ? (
          <>
            <PocketButton type="button" variant="secondary" disabled={top.isPending} onClick={() => setConfirming(false)}>
              Back
            </PocketButton>
            <PocketButton type="button" disabled={top.isPending} onClick={() => top.mutate()}>
              {top.isPending ? 'Adding…' : 'Add money'}
            </PocketButton>
          </>
        ) : (
          <>
            <PocketButton type="button" variant="secondary" onClick={close}>
              Cancel
            </PocketButton>
            <PocketButton type="button" disabled={minor === null} disabledReason={minor === null ? 'Add an amount first.' : undefined} onClick={() => setConfirming(true)}>
              Continue
            </PocketButton>
          </>
        )
      }
    >
      {read.isError ? (
        <p className="text-body text-ink-2">{readFailure(read.error, 'Your accounts')}</p>
      ) : read.isPending ? (
        <p className="text-body text-ink-3">Reading…</p>
      ) : accounts.length === 0 ? (
        <NoAccount />
      ) : confirming && account && minor !== null ? (
        <div className="grid gap-3" data-testid="top-up-confirm">
          <p className="font-display text-title font-bold text-ink">
            <Money minor={minor} currency={account.currency} />
          </p>
          <Facts facts={[{ label: 'To', value: `${owner} · ${account.currency}` }]} />
          {top.isError ? <Refused error={top.error} /> : null}
        </div>
      ) : (
        <AccountAndAmount accounts={accounts} owner={owner} accountID={account?.id ?? ''} setAccountID={setAccountID} amount={amount} setAmount={setAmount} />
      )}
    </Dialog>
  )
}

/** "Ada Lovelace · account ending 9911". */
const bankLine = (p: OutsidePayee) => {
  const number = p.iban || p.account_number || ''
  return number ? `${p.name} · account ending ${number.slice(-4)}` : p.name
}

/** Withdraw: one of the company's fiat accounts paid out to a bank saved as the owner's own, signed with the passkey. */
function Withdraw({ open, onClose, shows }: { open: boolean; onClose: () => void; shows: Shows }) {
  const qc = useQueryClient()
  const { read, accounts } = useCompanyAccounts(shows, true)
  const owner = shows.owner
  const payees = useQuery({ queryKey: PAYEES_KEY, queryFn: agentBankApi.payees, enabled: open })
  const banks = (payees.data?.payees ?? []).filter((p) => p.own && !p.address)
  const [accountID, setAccountID] = useState('')
  const [payeeID, setPayeeID] = useState('')
  const [amount, setAmount] = useState('')
  const [adding, setAdding] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [key, setKey] = useState(newMoveKey)
  const account = accounts.find((a) => a.id === accountID) ?? accounts[0]
  const bank = banks.find((p) => p.id === payeeID) ?? banks[0]
  const minor = account ? amountMinor(amount, account.currency) : null
  const close = () => {
    setConfirming(false)
    setAmount('')
    withdraw.reset()
    onClose()
  }
  const withdraw = useMutation({
    mutationFn: async () => {
      const body = { payee_id: bank?.id ?? '', amount_minor: minor ?? 0 }
      const c = await agentBankApi.walletWithdrawChallenge(account?.id ?? '', body, key)
      const assertion = (c.allow_credentials ?? []).length > 0 ? await assertOver(c) : undefined
      return agentBankApi.walletWithdraw(account?.id ?? '', body, key, assertion)
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: MONEY_ACCOUNTS_KEY })
      setKey(newMoveKey())
      close()
    },
  })
  const why = minor === null ? 'Add an amount first.' : !bank ? 'Add your own bank first.' : undefined
  return (
    <>
      <Dialog
        open={open && !adding}
        onClose={close}
        title="Withdraw"
        actions={
          confirming ? (
            <>
              <PocketButton type="button" variant="secondary" disabled={withdraw.isPending} onClick={() => setConfirming(false)}>
                Back
              </PocketButton>
              <PocketButton type="button" disabled={withdraw.isPending} onClick={() => withdraw.mutate()}>
                {withdraw.isPending ? 'Withdrawing…' : 'Withdraw with your passkey'}
              </PocketButton>
            </>
          ) : (
            <>
              <PocketButton type="button" variant="secondary" onClick={close}>
                Cancel
              </PocketButton>
              <PocketButton type="button" disabled={why !== undefined} disabledReason={why} onClick={() => setConfirming(true)}>
                Continue
              </PocketButton>
            </>
          )
        }
      >
        {read.isError ? (
          <p className="text-body text-ink-2">{readFailure(read.error, 'Your accounts')}</p>
        ) : read.isPending ? (
          <p className="text-body text-ink-3">Reading…</p>
        ) : accounts.length === 0 ? (
          <NoAccount />
        ) : confirming && account && bank && minor !== null ? (
          <div className="grid gap-3" data-testid="withdraw-confirm">
            <p className="font-display text-title font-bold text-ink">
              <Money minor={minor} currency={account.currency} />
            </p>
            <Facts
              facts={[
                { label: 'From', value: `${owner} · ${account.currency}` },
                { label: 'To', value: bankLine(bank) },
              ]}
            />
            <p className="flex items-start gap-2 rounded-card-tight bg-cloud p-3.5 text-body text-ink-2">
              <Icon name="key" size={16} />
              <span>Your passkey or Face ID asks before anything is sent.</span>
            </p>
            {withdraw.isError ? <Refused error={withdraw.error} /> : null}
          </div>
        ) : (
          <div className="grid gap-3">
            <AccountAndAmount accounts={accounts} owner={owner} accountID={account?.id ?? ''} setAccountID={setAccountID} amount={amount} setAmount={setAmount} />
            <Field label="To your own bank">
              {payees.isError ? (
                <p className="text-body text-ink-3">{readFailure(payees.error, 'Your payees')}</p>
              ) : payees.isPending ? (
                <p className="text-body text-ink-3">Reading…</p>
              ) : banks.length === 0 ? (
                <p className="text-body text-ink-2" data-testid="withdraw-no-bank">
                  No bank of your own yet.
                </p>
              ) : (
                <PocketSelect aria-label="To your own bank" value={bank?.id ?? ''} onChange={(e) => setPayeeID(e.target.value)}>
                  {banks.map((p) => (
                    <option key={p.id} value={p.id}>
                      {bankLine(p)}
                    </option>
                  ))}
                </PocketSelect>
              )}
            </Field>
            {payees.isSuccess ? (
              <PocketButton type="button" variant="outline" size="sm" className="justify-self-start" onClick={() => setAdding(true)}>
                Add your own bank
              </PocketButton>
            ) : null}
          </div>
        )}
      </Dialog>
      <AddPayee own open={open && adding} onClose={() => setAdding(false)} />
    </>
  )
}

/** Convert (Hybrid only): a currency for USDC or USDC for a currency, quoted, then converted once, signed with the passkey. */
function Convert({ open, onClose, shows }: { open: boolean; onClose: () => void; shows: Shows }) {
  const qc = useQueryClient()
  const { read, accounts } = useCompanyAccounts(shows)
  const held = [...new Set(accounts.map((a) => a.currency))]
  const [sell, setSell] = useState('')
  const [buy, setBuy] = useState('')
  const [amount, setAmount] = useState('')
  const [quote, setQuote] = useState<SideConversion | null>(null)
  const [key, setKey] = useState(newMoveKey)
  const from = sell || held.find((c) => !isCoin(c)) || held[0] || 'USD'
  const targets = isCoin(from) ? FIATS.filter((c) => held.includes(c)) : held.filter(isCoin)
  const to = targets.includes(buy) ? buy : (targets[0] ?? '')
  const minor = amountMinor(amount, from)
  const close = () => {
    setQuote(null)
    setAmount('')
    ask.reset()
    convert.reset()
    onClose()
  }
  const ask = useMutation({
    mutationFn: () => agentBankApi.sideConvertQuote({ sell_currency: from, buy_currency: to, sell_minor: minor ?? 0 }),
    onSuccess: setQuote,
  })
  const convert = useMutation({
    mutationFn: async () => {
      const id = quote?.id ?? ''
      const c = await agentBankApi.sideConvertChallenge(id, key)
      const assertion = (c.allow_credentials ?? []).length > 0 ? await assertOver(c) : undefined
      return agentBankApi.sideConvert(id, key, assertion)
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: MONEY_ACCOUNTS_KEY })
      setKey(newMoveKey())
      close()
    },
  })
  const why = read.isError ? 'We couldn’t read your accounts.' : targets.length === 0 ? 'Open an account on the other side first.' : minor === null ? 'Add an amount first.' : undefined
  return (
    <Dialog
      open={open}
      onClose={close}
      title="Convert"
      actions={
        quote ? (
          <>
            <PocketButton
              type="button"
              variant="secondary"
              disabled={convert.isPending}
              onClick={() => {
                setQuote(null)
                convert.reset()
              }}
            >
              Back
            </PocketButton>
            <PocketButton type="button" disabled={convert.isPending} onClick={() => convert.mutate()}>
              {convert.isPending ? 'Converting…' : 'Convert with your passkey'}
            </PocketButton>
          </>
        ) : (
          <>
            <PocketButton type="button" variant="secondary" onClick={close}>
              Cancel
            </PocketButton>
            <PocketButton type="button" disabled={why !== undefined || ask.isPending} disabledReason={why} onClick={() => ask.mutate()}>
              {ask.isPending ? 'Getting your quote…' : 'Continue'}
            </PocketButton>
          </>
        )
      }
    >
      {read.isError ? (
        <p className="text-body text-ink-2">{readFailure(read.error, 'Your accounts')}</p>
      ) : read.isPending ? (
        <p className="text-body text-ink-3">Reading…</p>
      ) : held.length === 0 ? (
        <NoAccount />
      ) : quote ? (
        <div className="grid gap-3" data-testid="convert-confirm">
          <p className="font-display text-title font-bold text-ink">
            <Money minor={quote.buy_minor} currency={quote.buy_currency} />
          </p>
          <Facts
            facts={[
              { label: 'You convert', value: <Money minor={quote.sell_minor} currency={quote.sell_currency} /> },
              { label: 'Rate', value: rateText(quote.rate, quote.sell_currency, quote.buy_currency) },
              { label: 'Fee', value: <Money minor={quote.margin_minor} currency={quote.sell_currency} /> },
              { label: 'You get', value: <Money minor={quote.buy_minor} currency={quote.buy_currency} /> },
            ]}
          />
          <p className="flex items-start gap-2 rounded-card-tight bg-cloud p-3.5 text-body text-ink-2">
            <Icon name="key" size={16} />
            <span>Your passkey or Face ID asks before anything is converted.</span>
          </p>
          {convert.isError ? <Refused error={convert.error} /> : null}
        </div>
      ) : (
        <div className="grid gap-3">
          <div className="grid gap-3 wide:grid-cols-2">
            <Field label="From">
              <PocketSelect
                aria-label="From"
                value={from}
                onChange={(e) => {
                  setSell(e.target.value)
                  setBuy('')
                }}
              >
                {held.map((c) => (
                  <option key={c} value={c}>
                    {CURRENCY_NAME[c] ?? c}
                  </option>
                ))}
              </PocketSelect>
            </Field>
            <Field label="To">
              <PocketSelect aria-label="To" value={to} onChange={(e) => setBuy(e.target.value)}>
                {targets.map((c) => (
                  <option key={c} value={c}>
                    {CURRENCY_NAME[c] ?? c}
                  </option>
                ))}
              </PocketSelect>
            </Field>
          </div>
          <Field label="Amount">
            <PocketInput aria-label="Amount" inputMode="decimal" unit={from} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          {ask.isError ? <Refused error={ask.error} /> : null}
        </div>
      )}
    </Dialog>
  )
}
