import { cn } from '../lib/cn'

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** cloud on the page; white (with its shadow) to lift a card off a cloud plane. */
  tone?: 'cloud' | 'white'
  /** The small card: 14 by 16 inside, 18 round. */
  tight?: boolean
}

// pocket.css .card, .card.white, .card.tight.
export function Card({ tone = 'cloud', tight = false, className, ...props }: CardProps) {
  return (
    <div
      className={cn(
        tone === 'white' ? 'bg-page shadow-pocket' : 'bg-cloud',
        tight ? 'rounded-card-tight px-4 py-3.5' : 'rounded-card p-5',
        className,
      )}
      {...props}
    />
  )
}
