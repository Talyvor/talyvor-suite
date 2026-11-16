// B35.7 — the fees every money oracle judges by are Lens's own: its public read (GET /v1/public/fees, B32), read once
// a run, and the plan Lens holds each workspace to. A fee is right only at the rate Lens states; none is typed here.

import type { Fees } from './lens.ts'

/** 100%, in basis points. */
export const BPS = 10_000

/**
 * The platform fee on a workspace's AI spend charged to credits, as Lens picks it (billing.PlatformFeeBPS): B61.90 —
 * the rate Lens states for the plan it holds the workspace to, by the plan's key (talyvor-lens B61.57); a plan the fees
 * do not name pays none, as Lens reads a plan missing from LENS_PLATFORM_FEE_BPS.
 */
export function platformFeeBPS(fees: Fees, plan: string): number {
  return fees.platform_fee_bps[plan] ?? 0
}

/** What a seller or payee keeps of `gross` µUSD once Talyvor takes `takeBPS` of it, rounded down to the µUSD. */
export function keptOf(gross: number, takeBPS: number): number {
  return Math.floor((gross * (BPS - takeBPS)) / BPS)
}

/** "5%" for 500 basis points. */
export const percent = (bps: number): string => `${bps / 100}%`
