import { cn } from '@talyvor/ui'
import { pocketFocusRing } from '@talyvor/ui/pocket'

// Choice.tsx — sign-up's choice card, shared by its steps and the last question, "Let people find you?" (B57.196).

/** The choice card (P1, P2, W1): radio semantics; cloud when off, white with a 2px ink ring when on. */
export function Choice({ name, value, picked, onPick, title, line, children }: {
  name: string
  value: string
  picked: boolean
  onPick: () => void
  title: string
  line: string
  children?: React.ReactNode
}) {
  return (
    <label
      className={cn(
        'relative grid cursor-pointer content-start gap-1.5 rounded-card-tight p-5 transition-colors duration-200',
        'has-[:focus-visible]:outline has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-tangerine',
        picked ? 'bg-page shadow-pocket ring-2 ring-inset ring-ink' : 'bg-cloud',
      )}
    >
      <input type="radio" name={name} value={value} checked={picked} onChange={onPick} className={cn('sr-only', pocketFocusRing)} />
      <span
        aria-hidden="true"
        className={cn('absolute right-5 top-5 inline-grid h-5 w-5 place-items-center rounded-pill shadow-edge', picked && 'bg-ink')}
      >
        {picked ? <span className="h-2 w-2 rounded-pill bg-page" /> : null}
      </span>
      <span className="pr-8 text-head text-ink">{title}</span>
      <span className="text-body text-ink-2">{line}</span>
      {children}
    </label>
  )
}
