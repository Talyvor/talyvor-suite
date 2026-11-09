import { cn } from '../lib/cn'

// pocket.css .eyebrow: the small label that names a card before it says anything.
export function Eyebrow({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn('text-pocket-eyebrow uppercase text-ink-3', className)} {...props} />
}
