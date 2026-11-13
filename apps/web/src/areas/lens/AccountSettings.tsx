import { Fragment } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { cn, inlineLink } from '@talyvor/ui'
import { Card, Chip, Eyebrow, Icon, Money } from '@talyvor/ui/pocket'
import { FIATS, KIND_LABEL, KIND_LINE, TYPE_LABEL, agentBankApi, useAccount, type CurrencyAccount, type MoneyKind } from './agentBankApi'
import { MONEY_ACCOUNTS_KEY } from './Invoices'
import { StatusLabel } from '../../labels/StatusLabel'

// B57.137 — Settings' Account and Team sections in Pocket (launch-pack P11, SPEC 3.5). The kinds are drawn as P11's
// choice cards: the current one ringed, and each other one either blocked by the zero-balance rule, with what the
// other side holds, or free to pick. Changing the kind is not built yet, so a choice that could be picked and the way
// wears the Building label instead of leading nowhere. P11's "Convert or withdraw a balance" is left out: the web has
// no screen yet that converts or withdraws the company's balance.

const KINDS: readonly MoneyKind[] = ['fiat', 'stablecoin', 'hybrid']

/** Each currency's total on one side of the account, company and agents together; only the ones that hold money. */
function held(accounts: readonly CurrencyAccount[], fiat: boolean): [string, number][] {
  const sums = new Map<string, number>()
  for (const a of accounts) {
    if (FIATS.includes(a.currency) !== fiat) continue
    sums.set(a.currency, (sums.get(a.currency) ?? 0) + a.balance_minor)
  }
  return [...sums].filter(([, minor]) => minor !== 0)
}

/** "$31,580.00", "£120.00 and €40.00": each currency in its own figures, never a rate the screen made up. */
function heldText(sums: [string, number][]) {
  return sums.map(([currency, minor], i) => (
    <Fragment key={currency}>
      {i === 0 ? '' : i === sums.length - 1 ? ' and ' : ', '}
      <Money minor={minor} currency={currency} className="font-normal" />
    </Fragment>
  ))
}

/** P11's rule line: why a single kind can't be picked yet. `sums` is null when the balances could not be read. */
function RuleLine({ fiatSide, sums }: { fiatSide: boolean; sums: [string, number][] | null }) {
  return (
    <p className="mt-2.5 flex items-start gap-2 rounded-control bg-page px-3.5 py-2.5 text-body text-ink-2">
      <Icon name="lock" className="mt-0.5 h-4 w-4 shrink-0" />
      <span>
        {fiatSide ? 'Needs zero fiat balances.' : 'Needs zero stablecoin and crypto balances.'}
        {sums && sums.length > 0 ? <> They hold {heldText(sums)}.</> : null}
      </span>
    </p>
  )
}

function KindChoices({ current }: { current: MoneyKind }) {
  const accounts = useQuery({ queryKey: MONEY_ACCOUNTS_KEY, queryFn: agentBankApi.moneyAccounts, retry: false })
  const list = accounts.data?.accounts ?? []
  const fiat = accounts.isSuccess ? held(list, true) : null
  const coin = accounts.isSuccess ? held(list, false) : null
  // A single kind needs the other side empty; Hybrid can be picked at any time.
  const blockedBy = (k: MoneyKind): { fiatSide: boolean; sums: [string, number][] | null } | null => {
    if (k === 'hybrid' || k === current) return null
    const fiatSide = k === 'stablecoin'
    const sums = fiatSide ? fiat : coin
    // Unread or unreadable balances keep the rule, without a figure: an empty side is never assumed.
    if (accounts.isError || sums === null) return { fiatSide, sums: null }
    return sums.length === 0 ? null : { fiatSide, sums }
  }
  return (
    <>
      <div role="radiogroup" aria-label="Kind of money" aria-readonly="true" className="mt-3 grid gap-2.5" data-testid="settings-money-kind">
        {KINDS.map((k) => {
          const on = k === current
          const blocked = blockedBy(k)
          return (
            <div
              key={k}
              role="radio"
              aria-checked={on}
              aria-disabled={!on}
              data-testid={`settings-kind-${k}`}
              className={cn('rounded-inset px-4 py-3.5', on ? 'bg-page shadow-pick' : 'bg-cloud')}
            >
              <div className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className={cn(
                    'mt-0.5 grid h-4.5 w-4.5 shrink-0 place-items-center rounded-pill',
                    on ? 'bg-ink' : 'bg-page shadow-edge',
                  )}
                >
                  {on ? <span className="h-1.5 w-1.5 rounded-pill bg-page" /> : null}
                </span>
                <div className="grid min-w-0 flex-1 gap-0.5">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-head font-semibold text-ink">{KIND_LABEL[k]}</span>
                    {on ? <Chip>Current</Chip> : blocked ? null : <StatusLabel building="money_kind_change" />}
                  </span>
                  <span className="text-body text-ink-2">{KIND_LINE[k]}</span>
                </div>
              </div>
              {blocked ? <RuleLine {...blocked} /> : null}
            </div>
          )
        })}
      </div>
      <p className="mt-3 flex items-start gap-2.5 rounded-control bg-cloud px-3.5 py-3 text-body text-ink-2" data-testid="settings-kind-note">
        <Icon name="shield" className="h-5 w-5 shrink-0" />
        {current === 'hybrid'
          ? 'Hybrid can become a single kind only when the other side’s balances are zero.'
          : 'Fiat only or Stablecoin and crypto only can become Hybrid at any time.'}
      </p>
    </>
  )
}

/** B59.10, drawn in Pocket by B57.137 — the account's kind of money and type (SPEC 3.5's card), and a Business's team. */
export function AccountCards() {
  const { account, shows } = useAccount()
  return (
    <>
      {account ? (
        <>
          <Eyebrow className="mt-1.5">Account</Eyebrow>
          <Card tone="white">
            <h2 className="font-display text-reading font-bold text-ink">Kind of money</h2>
            <KindChoices current={account.money_kind} />
          </Card>
          <Card tone="white" data-testid="settings-account-type">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-display text-reading font-bold text-ink">Account type</h2>
              <Chip>{TYPE_LABEL[account.account_type]}</Chip>
            </div>
            <p className="mt-1 text-body text-ink-2">The type can’t be changed. You can hold several accounts and switch between them.</p>
          </Card>
        </>
      ) : null}
      {shows?.team ? (
        <Card tone="white">
          <h2 className="font-display text-reading font-bold text-ink">Your team</h2>
          <p className="mt-1 text-body text-ink-2" data-testid="settings-team">
            Who is in your team and the role each one has are on{' '}
            <Link to="/members" className={cn(inlineLink, 'font-semibold text-ink')}>
              Members
            </Link>
            .
          </p>
        </Card>
      ) : null}
    </>
  )
}
