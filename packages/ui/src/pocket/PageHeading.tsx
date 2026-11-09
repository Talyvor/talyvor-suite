import { cn } from '../lib/cn'

export interface PageHeadingProps {
  children: React.ReactNode
  /** The line under the heading. */
  line?: React.ReactNode
  className?: string
}

// pocket.css .h-page: the page's one h1, in the display face, with its line under it.
export function PageHeading({ children, line, className }: PageHeadingProps) {
  return (
    <div className={cn('grid gap-1', className)}>
      <h1 className="font-display text-title font-bold text-ink">{children}</h1>
      {line ? <p className="text-reading text-ink-2">{line}</p> : null}
    </div>
  )
}
