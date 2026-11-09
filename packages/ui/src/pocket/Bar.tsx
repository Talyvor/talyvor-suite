import { cn } from '../lib/cn'

export interface BarProps {
  /** How full, 0 to 1. Past 1 the bar stays full; the label says by how much. */
  value: number
  /** What the bar shows, in words: "73% of budget used". */
  label: string
  thin?: boolean
  /** The plane it sits on: a cloud card (the default) shows it on the page, a white card or the page on cloud-2. */
  on?: 'cloud' | 'white'
  className?: string
}

// pocket.css .bar: the 10px budget bar, ink on its track. It is a picture of a number the words beside it
// already give, so it is one image with that number as its name.
export function Bar({ value, label, thin = false, on = 'cloud', className }: BarProps) {
  const pct = Math.min(1, Math.max(0, value)) * 100
  return (
    <div role="img" aria-label={label} className={cn('overflow-hidden rounded-pill', thin ? 'h-1.5' : 'h-2.5', on === 'white' ? 'bg-cloud-2' : 'bg-page', className)}>
      <div className="h-full rounded-pill bg-ink" style={{ width: `${pct}%` }} />
    </div>
  )
}
