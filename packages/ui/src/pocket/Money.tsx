import { createContext, useContext } from 'react'
import { cn } from '../lib/cn'

/** Which figure leads beside LXC. The app owns the one switch (apps/web src/moneyOrder.ts) and hands it down. */
export type MoneyOrder = 'usd-first' | 'lxc-first'

/** The app's formatter (B55.38, B55.26). <Money> draws what these return and never formats a figure itself. */
export interface MoneyFigures {
  /** µLXC in the person's currency ("$1,650.00", "<$0.01"), null while no rate backs it, and in LXC ("16,500 LXC"). */
  ulxc: (ulxc: number) => { cash: string | null; lxc: string }
  /** An account's amount in its own currency: "$400.00", "£24.00", "400.00 USDC". */
  minor: (minor: number, currency: string) => string
}

export interface MoneyProviderProps {
  order: MoneyOrder
  /** A hook, so the app reads its peg and the person's currency where <Money> renders. */
  useFigures: () => MoneyFigures
  children: React.ReactNode
}

const MoneyContext = createContext<Omit<MoneyProviderProps, 'children'> | null>(null)

export function MoneyProvider({ order, useFigures, children }: MoneyProviderProps) {
  return <MoneyContext.Provider value={{ order, useFigures }}>{children}</MoneyContext.Provider>
}

/** The reference's sizes: the sheet's amount (56), a balance card's (44, or 40 beside others), and a row's. */
export type MoneySize = 'sheet' | 'card' | 'card-sm' | 'row'

const LARGE: Record<Exclude<MoneySize, 'row'>, string> = {
  sheet: 'text-pocket-amount',
  card: 'text-pocket-balance',
  'card-sm': 'text-pocket-balance-sm',
}

export type MoneyProps = ({ ulxc: number; minor?: never; currency?: never } | { minor: number; currency: string; ulxc?: never }) & {
  size?: MoneySize
  /** A credit shows its +; a debit always shows the true minus. */
  signed?: boolean
  className?: string
}

const nbsp = (s: string) => s.replace(/ /g, ' ')

/**
 * B57.7 — every money figure, dollars first (pocket.css .moneyblock, .money, .money-sub, .lxs): the person's currency
 * large and LXC small, in the order the app's MoneyProvider gives; LXC alone while the peg is unknown, never a guessed
 * dollar. An account's amount (`minor` with its `currency`) shows its own currency and no LXC.
 */
export function Money(props: MoneyProps) {
  const ctx = useContext(MoneyContext)
  if (ctx === null) throw new Error('<Money> needs the app’s <MoneyProvider>: the order is the app’s one switch')
  const figures = ctx.useFigures()
  const { size = 'row', signed = false, className } = props
  const amount = props.ulxc ?? props.minor
  const sign = amount < 0 ? '−' : signed && amount > 0 ? '+' : ''
  let lead: string
  let sub: string | null = null
  if (props.ulxc === undefined) lead = figures.minor(Math.abs(props.minor), props.currency)
  else {
    const { cash, lxc } = figures.ulxc(Math.abs(props.ulxc))
    if (cash === null) lead = lxc
    else [lead, sub] = ctx.order === 'usd-first' ? [cash, lxc] : [lxc, cash]
  }
  lead = nbsp(sign + lead)
  sub = sub === null ? null : nbsp(sign + sub)

  if (size === 'row')
    return (
      <span data-money="" className={cn('whitespace-nowrap font-figure font-semibold', className)}>
        {lead}
        {sub === null ? null : (
          <>
            {' '}
            <span className="text-micro font-semibold text-ink-3">{sub}</span>
          </>
        )}
      </span>
    )
  // "$1,650.00" → "$1,650" with ".00" raised small; a unit after the figure ("LXC", "USDC") small beside it.
  const [, whole, cents = '', unit = ''] = /^(.*?\d)(\.\d+)?(?: (\D+))?$/.exec(lead) ?? ['', lead]
  return (
    <span data-money="" className={cn('inline-grid justify-items-start gap-1.5 font-figure', className)}>
      <span className={cn('whitespace-nowrap font-display tabular-nums text-ink', LARGE[size])}>
        {whole}
        {cents ? (
          <span className="ml-px tracking-normal" style={{ fontSize: '.55em', verticalAlign: '.55em' }}>
            {cents}
          </span>
        ) : null}
        {unit ? (
          <span className="tracking-normal text-ink-2" style={{ fontSize: '.4em' }}>
            {' ' + unit}
          </span>
        ) : null}
      </span>
      {/* The space keeps the two figures apart when read aloud; a grid drops it from the layout. */}
      {sub === null ? null : ' '}
      {sub === null ? null : <span className="whitespace-nowrap text-reading font-semibold leading-none text-ink-3">{sub}</span>}
    </span>
  )
}
