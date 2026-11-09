import { cn } from '../lib/cn'
import { CloseX } from './Dialog'
import { Facts, type FactsProps } from './Facts'

export interface SheetFrameProps {
  /** The head row: who is asking and for what (the agent's face, its words). */
  head: React.ReactNode
  /** Drawn at the head row's end: the label the reference puts there. */
  label?: React.ReactNode
  /** The large amount. */
  amount: React.ReactNode
  /** Under the amount: who it goes to. */
  to?: React.ReactNode
  facts?: FactsProps['facts']
  /** The "only this payment" line. */
  only?: React.ReactNode
  /** Full-width large buttons, one above the other (Button size="lg" className="w-full"). */
  actions?: React.ReactNode
  onClose?: () => void
  className?: string
}

/**
 * B57.5 — the approval sheet's frame (pocket.css .sheet): 28 round with the 7px tangerine top edge, the head row, the
 * large amount, facts on cloud, the "only this payment" line and the actions. Below 840 it is a bottom sheet with its
 * grab handle. What fills it is B57.15's (the web) and B57.67's (the phone); open it in a Layer.
 */
export function SheetFrame({ head, label, amount, to, facts, only, actions, onClose, className }: SheetFrameProps) {
  return (
    <div
      data-sheet=""
      className={cn(
        'relative w-full overflow-hidden bg-page px-6 pb-8.5 pt-6.5 shadow-pocket-lg wide:w-105 wide:pb-5.5',
        'rounded-t-sheet wide:rounded-sheet',
        className,
      )}
    >
      <span data-edge="" aria-hidden="true" className="absolute inset-x-0 top-0 h-1.75 bg-tangerine" />
      <span aria-hidden="true" className="absolute left-1/2 top-2.5 h-1 w-10 -translate-x-1/2 rounded-pill bg-cloud-2 wide:hidden" />
      {onClose ? <CloseX onClose={onClose} className="absolute right-4 top-4 z-10 h-8 w-8" /> : null}
      <div className={cn('flex items-center justify-between gap-3', onClose && 'pr-10')}>
        <div className="flex min-w-0 items-center gap-2.5">{head}</div>
        {label}
      </div>
      <div className="mt-3.5 font-display text-pocket-amount tabular-nums text-ink">{amount}</div>
      {to ? <div className="mt-1.5 text-head font-normal text-ink-2">{to}</div> : null}
      {facts?.length ? <Facts facts={facts} className="mt-4" /> : null}
      {only ? (
        <p className="mt-3 flex items-center gap-2 text-body text-ink-2">
          <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 shrink-0 fill-none stroke-current" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 12.5l4 4 8-9" />
          </svg>
          {only}
        </p>
      ) : null}
      {actions ? <div className="mt-4 grid gap-2.5">{actions}</div> : null}
    </div>
  )
}
