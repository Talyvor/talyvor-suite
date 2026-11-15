import { useSyncExternalStore } from 'react'
import { queryOptions, useQuery } from '@tanstack/react-query'
import { type MoneyFigures, MoneyProvider } from '@talyvor/ui/pocket'
import { ApiError, UnreadableError, readable } from '../../lib/api'
import { formatMinor } from './agentBankApi'
import { topupApi } from './topupApi'

// B28.22 — every amount Lens keeps in µLXC reads in the person's own currency: dollars from Lens's peg
// (/api/lxc/topup-options), pounds and euros from that and the ECB's euro rates (/api/fx). A rate that cannot be read
// shows no figure for it, never a guess: no peg ⇒ "…"; no ECB rate ⇒ dollars instead of pounds or euros. B61.14 — LXC
// itself is parked (Nick, 15 Nov) and never drawn.

export type Fiat = 'USD' | 'GBP' | 'EUR'

export const FIATS: readonly { code: Fiat; label: string }[] = [
  { code: 'USD', label: 'US dollars ($)' },
  { code: 'GBP', label: 'British pounds (£)' },
  { code: 'EUR', label: 'Euros (€)' },
]

/** The currency this browser shows amounts in. */
export const FIAT_KEY = 'talyvor.wallet.currency'

const listeners = new Set<() => void>()

function readFiat(): Fiat {
  try {
    const v = window.localStorage.getItem(FIAT_KEY)
    return v === 'GBP' || v === 'EUR' ? v : 'USD'
  } catch {
    return 'USD'
  }
}

export function setFiat(next: Fiat): void {
  try {
    window.localStorage.setItem(FIAT_KEY, next)
  } catch {
    // A refused write still changes this tab, below; the next load starts from dollars.
  }
  listeners.forEach((l) => l())
}

function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useFiat(): Fiat {
  return useSyncExternalStore(subscribe, readFiat, () => 'USD' as const)
}

/** The ECB's euro reference rates, as the BFF serves them (apps/bff/fx.go). */
export interface FXRates {
  rate_date: string
  usd_per_eur: number
  gbp_per_eur: number
}

export const FX_KEY = ['fx']

export async function fetchFX(): Promise<FXRates> {
  const res = await fetch('/api/fx', { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new ApiError(res.status, '/api/fx')
  return readable<FXRates>('/api/fx', await res.json(), { usd_per_eur: 'number', gbp_per_eur: 'number' })
}

/**
 * B55.38 — the one formatter for an amount in a currency: dollars "$450.00" (en-US), pounds "£20.00" and
 * euros "€20.00" (en-GB), never "US$". A minus leads.
 */
export function currencyText(amount: number, currency: string): string {
  return new Intl.NumberFormat(currency === 'USD' ? 'en-US' : 'en-GB', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

/** An amount of money as a person reads it: 1.25 USD → "$1.25"; a non-zero amount under a cent → "<$0.01". */
export function fiatText(amount: number, fiat: Fiat): string {
  const abs = Math.abs(amount)
  if (abs > 0 && abs < 0.005) return `<${currencyText(0.01, fiat)}`
  return currencyText(abs, fiat)
}

/**
 * µLXC → the person's currency, or null when a rate it needs is unknown. Pounds and euros fall back to
 * dollars when the ECB rates cannot be read, so the figure is always labelled by its own symbol.
 */
export function convertULXC(
  ulxc: number,
  usdPerLXC: number | undefined,
  fx: FXRates | undefined,
  fiat: Fiat,
): { amount: number; fiat: Fiat } | null {
  if (usdPerLXC === undefined || !(usdPerLXC > 0)) return null
  const usd = (ulxc / 1_000_000) * usdPerLXC
  if (fiat === 'USD' || fx === undefined) return { amount: usd, fiat: 'USD' }
  const eur = usd / fx.usd_per_eur
  return fiat === 'EUR' ? { amount: eur, fiat } : { amount: eur * fx.gbp_per_eur, fiat }
}

/**
 * B35.6 — Lens's credit peg. It is fixed, so one answer is kept for the session; a read that fails is
 * asked again with react-query's default retries and backoff, so one failed or slow read no longer
 * leaves every amount on the screen without its currency. A 401, a 403 or an unreadable answer is a
 * verdict, not a flake, and is not asked again (as the app's own default, App.tsx). Every reader of the
 * peg shares these options: the observer that starts a read decides whether it is retried.
 */
export const pegQuery = queryOptions({
  queryKey: ['topup-options'],
  queryFn: topupApi.options,
  retry: (failures, error) =>
    failures < 3 &&
    !(error instanceof UnreadableError) &&
    !(error instanceof ApiError && (error.status === 401 || error.status === 403)),
  staleTime: Infinity,
})

/** A formatter for the person's currency: µLXC → "$1.25", or null while no rate backs one. */
export function useMoney(): (ulxc: number) => string | null {
  const fiat = useFiat()
  const peg = useQuery(pegQuery)
  const fx = useQuery({ queryKey: FX_KEY, queryFn: fetchFX, retry: false, staleTime: 60 * 60_000, enabled: fiat !== 'USD' })
  return (ulxc) => {
    const v = convertULXC(ulxc, peg.data?.usd_per_lxc, fiat === 'USD' ? undefined : fx.data, fiat)
    return v === null ? null : fiatText(v.amount, v.fiat)
  }
}

/** B57.7 — the figures packages/ui's <Money> draws: this formatter's, at the rate the screen's <Lxc> figures use. */
export function useMoneyFigures(): MoneyFigures {
  // B61.14 — LXC is parked: an amount Lens keeps in µLXC reads in the person's currency alone.
  return { ulxc: useMoney(), minor: formatMinor }
}

export function AppMoney({ children }: { children: React.ReactNode }) {
  return <MoneyProvider useFigures={useMoneyFigures}>{children}</MoneyProvider>
}

/**
 * B55.38 — an amount Lens keeps in µLXC, as words: its value in the person's currency, "$450.00" (B61.14: never LXC),
 * and "…" while no rate backs it (`fiat` null). `sign` is written before the figure; a negative amount carries its minus.
 */
export function lxcText(ulxc: number, fiat: string | null, sign: '' | '+' | '−' = ''): string {
  if (fiat === null) return '…'
  return `${ulxc < 0 ? '-' : sign}${fiat}`
}

/** lxcText for words a screen builds itself, at the rate the screen's <Lxc> figures use. */
export function useLxcText(): (ulxc: number, sign?: '' | '+' | '−') => string {
  const money = useMoney()
  return (ulxc, sign = '') => lxcText(ulxc, money(Math.abs(ulxc)), sign)
}

/**
 * B61.14 — a sentence Lens wrote, as a person reads it: each "0.75 LXC" or "750000 µLXC" in it becomes its value in
 * the person's currency, "$0.08", and "…" while no rate backs it. Lens's briefing and refusals still say LXC.
 */
export function useLensWords(): (text: string) => string {
  const money = useMoney()
  return (text) =>
    text.replace(/(\d[\d,]*(?:\.\d+)?)\s?(µ|u)?LXC\b/gi, (_, n: string, micro: string | undefined) => {
      const v = Number(n.replace(/,/g, ''))
      return money(Math.round(micro ? v : v * 1_000_000)) ?? '…'
    })
}

/** `$1.25` — lxcText as a figure, on the figure face. */
export function Lxc({ ulxc, sign = '' }: { ulxc: number; sign?: '' | '+' | '−' }) {
  const money = useMoney()
  // B29.9 — the whole amount is on the figure face: IBM Plex Mono, tabular figures.
  return (
    <span className="whitespace-nowrap font-figure" data-testid="fiat">
      {lxcText(ulxc, money(Math.abs(ulxc)), sign)}
    </span>
  )
}
