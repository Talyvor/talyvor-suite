import { cn } from '../lib/cn'

export type ChipTone = 'good' | 'bad' | 'wait' | 'paused' | 'plain'

// pocket.css .chip: a soft fill with the same family's ink, which stays readable in both themes.
const tones: Record<ChipTone, string> = {
  good: 'bg-success-50 text-success',
  bad: 'bg-danger-50 text-danger',
  wait: 'bg-tangerine-50 text-tangerine-ink',
  paused: 'bg-cloud-2 text-ink-2',
  plain: 'bg-cloud-2 text-ink-2',
}

const GOOD = ['settled', 'paid', 'running', 'active', 'approved', 'live', 'succeeded', 'complete', 'completed', 'done']
const BAD = ['declined', 'denied', 'failed', 'slashed', 'void', 'voided', 'revoked', 'rejected', 'expired', 'cancelled', 'canceled']
const WAIT = ['held', 'pending', 'waiting', 'not_paid', 'open', 'due', 'past_due', 'overdue', 'review', 'in_review', 'processing']
const PAUSED = ['paused', 'frozen', 'draft', 'archived', 'suspended']

/** A status from the API as a chip: its tone, and the status in words a person reads (`not_paid` is "Not paid"). */
export function chipFor(status: string): { tone: ChipTone; words: string } {
  const key = status.toLowerCase()
  const tone: ChipTone = GOOD.includes(key) ? 'good' : BAD.includes(key) ? 'bad' : WAIT.includes(key) ? 'wait' : PAUSED.includes(key) ? 'paused' : 'plain'
  const words = key.replace(/[_-]+/g, ' ').trim()
  return { tone, words: words.charAt(0).toUpperCase() + words.slice(1) }
}

export interface ChipProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: ChipTone
  /** A dot in the chip's ink before the words. */
  dot?: boolean
  /** A raw status from the API: sets the tone and the words (chipFor), unless children give the words. */
  status?: string
}

export function Chip({ tone, dot = false, status, className, children, ...props }: ChipProps) {
  const fromStatus = status ? chipFor(status) : null
  const shade = tone ?? fromStatus?.tone ?? 'plain'
  return (
    <span
      className={cn(
        'inline-flex h-6.5 items-center gap-1.5 whitespace-nowrap rounded-pill px-2.5 text-micro font-semibold',
        tones[shade],
        className,
      )}
      {...props}
    >
      {dot ? <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-pill bg-current" /> : null}
      {children ?? fromStatus?.words}
    </span>
  )
}
