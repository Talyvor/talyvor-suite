import { cn } from '../lib/cn'

export interface RoomBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  icon: React.ReactNode
  /** 44 beside a room's name, 26 inside a line of text. */
  size?: 'md' | 'sm'
}

// pocket.css .roomico: a room's mark, an icon on cloud-2. Rooms have no face; agents do.
export function RoomBadge({ icon, size = 'md', className, ...props }: RoomBadgeProps) {
  return (
    <span
      aria-hidden="true"
      className={cn('inline-grid shrink-0 place-items-center rounded-tile bg-cloud-2 text-ink-2', size === 'sm' ? 'h-6.5 w-6.5' : 'h-11 w-11', className)}
      {...props}
    >
      {icon}
    </span>
  )
}
