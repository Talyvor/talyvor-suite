import { createContext, useContext } from 'react'
import { cn } from '../lib/cn'

/** The app's formatter (B55.38, B55.26). <Money> draws what these return and never formats a figure itself. */
export interface MoneyFigures {
  /** B61.14 — µLXC in the person's currency alone ("$1,650.00", "<$0.01"), null while no rate backs it. LXC is never drawn. */
  ulxc: (ulxc: number) => string | null
  /** An account's amount in its own currency: "$400.00", "£24.00", "400.00 USDC". */
  minor: (minor: number, currency: string) => string
}

export interface MoneyProviderProps {
  /** A hook, so the app reads its peg and the person's currency where <Money> renders. */
  useFigures: () => MoneyFigures
  children: React.ReactNode
}

const MoneyContext = createContext<Omit<MoneyProviderProps, 'children'> | null>(null)

export function MoneyProvider({ useFigures, children }: MoneyProviderProps) {
  return <MoneyContext.Provider value={{ useFigures }}>{children}</MoneyContext.Provider>
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
 * B57.7 — every money figure (pocket.css .moneyblock, .money): an account's amount (`minor` with its `currency`) in its
 * own currency. B61.14 — an amount Lens keeps in µLXC reads in the person's currency alone, and "…" while the peg is
 * unknown, never a guessed dollar and never LXC.
 */
export function Money(props: MoneyProps) {
  const ctx = useContext(MoneyContext)
  if (ctx === null) throw new Error('<Money> needs the app’s <MoneyProvider>: the figures are the app’s one formatter')
  const figures = ctx.useFigures()
  const { size = 'row', signed = false, className } = props
  const amount = props.ulxc ?? props.minor
  const sign = amount < 0 ? '−' : signed && amount > 0 ? '+' : ''
  const figure = props.ulxc === undefined ? figures.minor(Math.abs(props.minor), props.currency) : figures.ulxc(Math.abs(props.ulxc))
  const lead = figure === null ? '…' : nbsp(sign + figure)

  if (size === 'row')
    return (
      <span data-money="" className={cn('whitespace-nowrap font-figure font-semibold', className)}>
        {lead}
      </span>
    )
  // "$1,650.00" → "$1,650" with ".00" raised small; a unit after the figure ("USDC") small beside it.
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
    </span>
  )
}
