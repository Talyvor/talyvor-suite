import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { cn } from '../lib/cn'
import { motion } from '../preset'

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

const ROLL_MS = parseFloat(motion.duration.roll)

/** B61.129 — the web app's opening: a figure first drawn inside counts up from nothing (section 15, Special openings). */
const CountUpContext = createContext(false)

/** Home wraps its figures in this on the first Home of a visit (useOpening): each counts up from 0 as it first appears. */
export function MoneyCountUp({ on, children }: { on: boolean; children: React.ReactNode }) {
  return <CountUpContext.Provider value={on}>{children}</CountUpContext.Provider>
}

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * B61.75 — Pocket Live's roll (DESIGN.md section 4, `roll`): once a figure is on the page, a new value rolls from the
 * one drawn to the new one over 700 ms, easing out on the fourth power, in whole minor units. The first value, a change
 * of currency and reduced motion draw at once. Returns the value to draw now; the roll ends on the value itself.
 */
function useRolled(amount: number, unit: string): number {
  // B61.129 — inside MoneyCountUp the first value rolls up from 0, as a new value rolls from the one drawn.
  const countUp = useContext(CountUpContext) && amount !== 0 && !reducedMotion()
  const [drawn, setDrawn] = useState(countUp ? 0 : amount)
  const at = useRef({ drawn: countUp ? 0 : amount, unit })
  useEffect(() => {
    const from = at.current.drawn
    const sameUnit = at.current.unit === unit
    at.current.unit = unit
    const land = (v: number) => {
      at.current.drawn = v
      setDrawn(v)
    }
    if (from === amount) return land(amount)
    if (!sameUnit || reducedMotion() || typeof requestAnimationFrame !== 'function') return land(amount)
    const start = performance.now()
    let frame = 0
    const step = () => {
      const p = Math.min(1, (performance.now() - start) / ROLL_MS)
      land(p >= 1 ? amount : Math.round(from + (amount - from) * (1 - Math.pow(1 - p, 4))))
      if (p < 1) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [amount, unit])
  return drawn
}

/**
 * B57.7 — every money figure (pocket.css .moneyblock, .money): an account's amount (`minor` with its `currency`) in its
 * own currency. B61.14 — an amount Lens keeps in µLXC reads in the person's currency alone, and "…" while the peg is
 * unknown, never a guessed dollar and never LXC. B61.75 — a new value rolls in; while it rolls the figures in between
 * are hidden from screen readers, which read the new value once.
 */
export function Money(props: MoneyProps) {
  const ctx = useContext(MoneyContext)
  if (ctx === null) throw new Error('<Money> needs the app’s <MoneyProvider>: the figures are the app’s one formatter')
  const figures = ctx.useFigures()
  const { size = 'row', signed = false, className } = props
  const amount = props.ulxc ?? props.minor
  const drawn = useRolled(amount, props.ulxc === undefined ? props.currency : 'ulxc')
  const leadOf = (value: number) => {
    const sign = value < 0 ? '−' : signed && value > 0 ? '+' : ''
    const figure = props.ulxc === undefined ? figures.minor(Math.abs(value), props.currency) : figures.ulxc(Math.abs(value))
    return figure === null ? '…' : nbsp(sign + figure)
  }
  const rolling = drawn !== amount
  const lead = leadOf(drawn)
  const said = rolling ? <span className="sr-only">{leadOf(amount)}</span> : null

  if (size === 'row')
    return (
      <span data-money="" className={cn('whitespace-nowrap font-figure font-semibold', className)}>
        {rolling ? <span aria-hidden="true">{lead}</span> : lead}
        {said}
      </span>
    )
  // "$1,650.00" → "$1,650" with ".00" raised small; a unit after the figure ("USDC") small beside it.
  const [, whole, cents = '', unit = ''] = /^(.*?\d)(\.\d+)?(?: (\D+))?$/.exec(lead) ?? ['', lead]
  return (
    <span data-money="" className={cn('inline-grid justify-items-start gap-1.5 font-figure', className)}>
      <span className={cn('whitespace-nowrap font-display tabular-nums text-ink', LARGE[size])} aria-hidden={rolling ? 'true' : undefined}>
        {whole}
        {cents ? (
          <span className="ml-px tracking-normal" style={{ fontSize: '.55em', verticalAlign: '.55em' }}>
            {cents}
          </span>
        ) : null}
        {unit ? (
          <span className="tracking-normal text-ink-2" style={{ fontSize: '.4em' }}>
            {' ' + unit}
          </span>
        ) : null}
      </span>
      {said}
    </span>
  )
}
