import { day } from './Licences'

// BuyerProtection.tsx — B41.90: the 14-day holdback, said to the buyer as what it is — protection. A seller is paid
// 14 days after the buyer's bill is paid, so until then a use that is not what its listing says is refunded from
// money Talyvor still holds. Said at checkout (from the day this bill will be paid) and on every receipt (from the day
// it was).

export const HOLDBACK_DAYS = 14

/** The instant the protection of a bill paid at `paidIso` ends. */
export function protectedUntil(paidIso: string): string {
  const t = new Date(paidIso).getTime()
  return Number.isNaN(t) ? paidIso : new Date(t + HOLDBACK_DAYS * 86_400_000).toISOString()
}

/** `paid`: when the bill is paid; `due`: it is not paid yet, so `paid` is the day it will be. */
export function BuyerProtection({ paid, due = false }: { paid: string; due?: boolean }) {
  const until = <span className="font-figure">{day(protectedUntil(paid))}</span>
  return (
    <p className="text-caption font-normal text-muted" data-testid="buyer-protection">
      <span className="text-ink">Buyer protection until {until}.</span> The seller is paid{' '}
      <span className="font-figure">{HOLDBACK_DAYS}</span> days after your bill is paid
      {due ? (
        <>
          {' '}
          — this one on <span className="font-figure">{day(paid)}</span>
        </>
      ) : null}
      . Until then, if a listing does not do what it says, you get your money back.
    </p>
  )
}
