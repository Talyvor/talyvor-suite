import { cn } from '../lib/cn'
import { KindTile } from './KindTile'

export interface EmptyStateProps {
  icon: React.ReactNode
  /** What would show here. */
  title: React.ReactNode
  /** How it gets there. */
  line: React.ReactNode
  /** The one thing to do about it, if there is one. */
  action?: React.ReactNode
  className?: string
}

// pocket.css .empty: a kind tile, a title and a line on cloud, and at most one action.
export function EmptyState({ icon, title, line, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex items-start gap-3.5 rounded-card-tight bg-cloud p-4', className)}>
      <KindTile icon={icon} />
      <div className="grid min-w-0 flex-1 justify-items-start gap-2.5">
        <div>
          <div className="font-semibold text-ink">{title}</div>
          <div className="mt-0.5 text-body text-ink-2">{line}</div>
        </div>
        {action}
      </div>
    </div>
  )
}
