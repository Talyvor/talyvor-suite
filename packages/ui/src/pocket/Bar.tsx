import { cn } from '../lib/cn'

export interface BarProps {
  /** How full, 0 to 1. Past 1 the bar stays full; the label says by how much. */
  value: number
  /** What the bar shows, in words: "73% of budget used". */
  label: string
  thin?: boolean
  /** The plane it sits on: a cloud card (the default) shows it on the page, a white card or the page on cloud-2. */
  on?: 'cloud' | 'white'
  /** B57.89 — tangerine once a budget is most of the way gone (from 80%): the owner's move. */
  near?: boolean
  className?: string
}

// pocket.css .bar: the 10px budget bar, ink on its track. It is a picture of a number the words beside it
// already give, so it is one image with that number as its name.
export function Bar({ value, label, thin = false, on = 'cloud', near = false, className }: BarProps) {
  const pct = Math.min(1, Math.max(0, value)) * 100
  return (
    <div
      role="img"
      aria-label={label}
      data-tangerine={near ? 'your-move' : undefined}
      className={cn('overflow-hidden rounded-pill', thin ? 'h-1.5' : 'h-2.5', on === 'white' ? 'bg-cloud-2' : 'bg-page', className)}
    >
      <div className={cn('h-full rounded-pill', near ? 'bg-tangerine' : 'bg-ink')} style={{ width: `${pct}%` }} />
    </div>
  )
}
