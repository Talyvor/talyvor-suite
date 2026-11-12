import { useSyncExternalStore } from 'react'

import { cardArt, type CardTier, type OwnerCardArt } from './cardArt'

// B57.127 — the owner's or company's own card wears its tier art: Daily for a Personal account, Team for a Business,
// Stablecoin Daily for a Personal stablecoin-only one. The tier the owner picks beside it is a picture only: it is kept in this
// browser beside the currency it shows amounts in, and no plan, price, limit or fee reads it.

type Family = OwnerCardArt['family']

/** Which family an account's own card belongs to. A Business always has the company tiers (B59.10: a Business never
 *  shows a personal tier), so only a Personal stablecoin-only account wears the stablecoin face. */
export function ownerFamily(a: { account_type: 'business' | 'personal'; money_kind: 'fiat' | 'stablecoin' | 'hybrid' }): Family {
  if (a.account_type === 'business') return 'corporate'
  return a.money_kind === 'stablecoin' ? 'stablecoin' : 'personal'
}

/** A family's faces, lowest tier first: the first is the default. */
export const ownerFaces = (family: Family): OwnerCardArt[] =>
  cardArt.filter((c): c is OwnerCardArt => c.family === family)

/** Card.dc.html's holder while the workspace has no name of its own, and each face's sub line. */
export const OWNER_HOLDER: Record<Family, string> = { personal: 'Owner card', corporate: 'Company card', stablecoin: 'Owner card' }
export const OWNER_SUB: Record<string, string> = {
  daily: 'Your everyday account',
  premium: 'Fiat, stablecoins or both',
  platinum: 'Fiat, stablecoins or both',
  team: 'For your team and its agents',
  business: 'For every team and agent',
  enterprise: 'Your contract, your limits',
  stable: 'Spends from your own wallet',
  'stable-premium': 'Spends from your own wallet',
  'stable-platinum': 'Spends from your own wallet',
}

/** The tier this browser shows the owner's card in. */
export const OWNER_TIER_KEY = 'talyvor.card.tier'

const listeners = new Set<() => void>()

function readTier(): string | null {
  try {
    return window.localStorage.getItem(OWNER_TIER_KEY)
  } catch {
    return null
  }
}

export function setOwnerTier(next: CardTier): void {
  try {
    window.localStorage.setItem(OWNER_TIER_KEY, next)
  } catch {
    // A refused write still changes this tab, below; the next load starts from the default.
  }
  listeners.forEach((l) => l())
}

function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

/** The face to draw for a family: the tier this browser chose if the family has it, else the family's default. */
export function useOwnerFace(family: Family): OwnerCardArt {
  const chosen = useSyncExternalStore(subscribe, readTier, () => null)
  const faces = ownerFaces(family)
  return faces.find((c) => c.tier === chosen) ?? faces[0]
}
