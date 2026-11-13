import { cn } from '../lib/cn'

export interface KindTileProps extends React.HTMLAttributes<HTMLSpanElement> {
  icon: React.ReactNode
  /** The plane it sits on: the page on a cloud card (the default), cloud on a white one. */
  on?: 'cloud' | 'white'
}

// pocket.css .kindico: a 38px tile that says what kind of thing a row or an empty state is about.
export function KindTile({ icon, on = 'cloud', className, ...props }: KindTileProps) {
  return (
    <span
      aria-hidden="true"
      className={cn('inline-grid h-9.5 w-9.5 shrink-0 place-items-center rounded-tile text-ink', on === 'white' ? 'bg-cloud' : 'bg-page', className)}
      {...props}
    >
      {icon}
    </span>
  )
}
