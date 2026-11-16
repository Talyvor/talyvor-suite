import { useQuery } from '@tanstack/react-query'
import type { FXRates } from './money'
import { type Agent, type AgentRules, agentBankApi, useAccount } from './agentBankApi'
import { MONEY_ACCOUNTS_KEY } from './Invoices'

// rulesCurrency.ts — B61.87: an agent's rules are typed and shown in the account's own currency. Lens (B61.12) holds the
// rules in a currency, each amount limit in that currency's minor units: pence, cents, and USDC to its six decimals. A
// save names the currency and the minor-unit limits and no µLXC limit, which Lens refuses on rules held in pounds or euros.

/** The currencies an agent's rules are held in, and the decimals of each one's minor units. */
export const RULES_DECIMALS: Readonly<Record<string, number>> = { GBP: 2, EUR: 2, USD: 2, USDC: 6 }

/** A currency in a sentence: "pounds". */
export const CURRENCY_WORDS: Readonly<Record<string, string>> = { GBP: 'pounds', EUR: 'euros', USD: 'dollars', USDC: 'USDC' }

/** The limits Lens holds in the rules' currency, as AgentRules names them. */
export type MinorLimit = 'max_per_payment_minor' | 'hourly_limit_minor' | 'daily_limit_minor' | 'weekly_limit_minor' | 'monthly_limit_minor' | 'approval_above_minor'

export const MINOR_LIMITS: readonly MinorLimit[] = [
  'approval_above_minor',
  'max_per_payment_minor',
  'daily_limit_minor',
  'monthly_limit_minor',
  'hourly_limit_minor',
  'weekly_limit_minor',
]

/** The currency the rules are held in: dollars for rules Lens has not given one. */
export const heldIn = (r: Pick<AgentRules, 'currency'>): string => (r.currency && RULES_DECIMALS[r.currency] !== undefined ? r.currency : 'USD')

/** The currency of the agent's own account: USDC for a crypto agent, its fiat currency otherwise; null when Lens does not say. */
export function agentCurrency(a: Pick<Agent, 'wallet_kind' | 'fiat_currency'>): string | null {
  if (a.wallet_kind === 'crypto') return 'USDC'
  return a.fiat_currency && RULES_DECIMALS[a.fiat_currency] !== undefined ? a.fiat_currency : null
}

/**
 * An amount typed in currency → its minor units, exact: `12.50` GBP → 1250, `0.000001` USDC → 1. Empty is 0 (no limit);
 * null for anything that is not an amount, or that has more decimals than the currency's minor units. A leading £, € or
 * $ and thousands commas are allowed.
 */
export function parseRuleAmount(text: string, currency: string): number | null {
  const places = RULES_DECIMALS[currency]
  if (places === undefined) return null
  const t = text.trim().replace(/^[£€$]/, '').replace(/,/g, '')
  if (t === '') return 0
  const m = /^(\d+)(?:\.(\d+))?$/.exec(t)
  if (!m || (m[2] ?? '').length > places) return null
  const minor = Number(m[1]) * 10 ** places + Number((m[2] ?? '').padEnd(places, '0') || '0')
  return Number.isSafeInteger(minor) ? minor : null
}

/** Minor units → the text a field shows for them, `12.5`; empty for none. Every minor unit kept, so it reads back exact. */
export function ruleAmountText(minor: number, currency: string): string {
  const places = RULES_DECIMALS[currency] ?? 2
  if (!(minor > 0)) return ''
  const whole = Math.floor(minor / 10 ** places)
  const part = String(minor % 10 ** places).padStart(places, '0').replace(/0+$/, '')
  return part === '' ? String(whole) : `${whole}.${part}`
}

/** What one unit of each currency is worth in euros' terms: units per euro, from the day's rates. */
function perEuro(currency: string, fx: FXRates): number | null {
  switch (currency) {
    case 'EUR':
      return 1
    case 'GBP':
      return fx.gbp_per_eur
    case 'USD':
    case 'USDC':
      return fx.usd_per_eur
  }
  return null
}

/**
 * Minor units of from in to's minor units, rounded down: dollars and USDC by their decimals with no rate, as Lens does;
 * pounds and euros at the day's rate. Null while a rate it needs is unknown.
 */
export function convertDown(minor: number, from: string, to: string, fx: FXRates | undefined): number | null {
  const [df, dt] = [RULES_DECIMALS[from], RULES_DECIMALS[to]]
  if (df === undefined || dt === undefined) return null
  if (minor <= 0) return 0
  const dollars = (c: string) => c === 'USD' || c === 'USDC'
  if (from === to || (dollars(from) && dollars(to))) return dt >= df ? minor * 10 ** (dt - df) : Math.floor(minor / 10 ** (df - dt))
  if (!fx) return null
  const [pf, pt] = [perEuro(from, fx), perEuro(to, fx)]
  if (!pf || !pt || !(pf > 0) || !(pt > 0)) return null
  // A hair over the float's own error, so 1250 × an exact rate never lands one below its whole.
  return Math.floor(((minor / 10 ** df) * (pt / pf)) * 10 ** dt + 1e-9)
}

/** The fiat currencies in the order the account's own are taken, as Wallets ranks them. */
const FIAT_ORDER = ['USD', 'EUR', 'GBP']

/**
 * The account's own currency, for an agent made now: the company's open account in a fiat currency (the first, as Wallets
 * ranks them) when the account holds fiat, USDC on a stablecoin account; dollars, the rules' currency before B61.12, while
 * it has none. Null while it is read.
 */
export function useAccountCurrency(): string | null {
  const { shows } = useAccount()
  const accounts = useQuery({ queryKey: MONEY_ACCOUNTS_KEY, queryFn: agentBankApi.moneyAccounts, retry: false })
  if (shows === null) return null
  if (!shows.bankTransfers) return 'USDC'
  if (accounts.isPending) return null
  const own = (accounts.data?.accounts ?? []).filter((a) => a.purpose === 'company' && a.status !== 'closed' && FIAT_ORDER.includes(a.currency))
  return own.map((a) => a.currency).sort((a, b) => FIAT_ORDER.indexOf(a) - FIAT_ORDER.indexOf(b))[0] ?? 'USD'
}
