import { cn } from '../lib/cn'
import { pocketFocusRing } from './focus'

export interface RowProps {
  /** A face, an icon tile or a badge. */
  leading?: React.ReactNode
  title: React.ReactNode
  /** The line under the title. */
  line?: React.ReactNode
  /** Right aligned, in tabular figures, so a column of money lines up. */
  amount?: React.ReactNode
  /** A control at the end of the row. A row that is a link has none: the whole row is the control. */
  action?: React.ReactNode
  /** Makes the whole row one link, with a chevron at its end. */
  href?: string
  /** On a phone, the amount and the action drop under the title, so a long title keeps the width. */
  wrap?: boolean
  className?: string
}

function Chevron() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 shrink-0 fill-none stroke-current text-ink-3" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 7l5 5-5 5" />
    </svg>
  )
}

// pocket.css .li: the leading piece, the title over its line, the amount, then the action or chevron;
// a hairline between rows.
export function Row({ leading, title, line, amount, action, href, wrap = false, className }: RowProps) {
  const body = (
    <>
      {leading ? <span className="shrink-0">{leading}</span> : null}
      <span className={cn('min-w-0 flex-1', wrap && 'basis-4/5 wide:basis-0')}>
        <span className="block font-semibold text-ink">{title}</span>
        {line ? <span className="block text-body font-normal text-ink-3">{line}</span> : null}
      </span>
      {amount ? <span className={cn('shrink-0 whitespace-nowrap text-right font-figure font-semibold text-ink', wrap && 'ml-auto')}>{amount}</span> : null}
    </>
  )
  const row = cn('flex items-center gap-3 border-t border-line py-2.5 text-reading first:border-t-0', wrap && 'flex-wrap wide:flex-nowrap', className)
  if (href) {
    return (
      <a href={href} className={cn(row, 'rounded-control', pocketFocusRing)}>
        {body}
        <Chevron />
      </a>
    )
  }
  return (
    <div className={row}>
      {body}
      {action ? <span className="flex shrink-0 items-center gap-2">{action}</span> : null}
    </div>
  )
}
