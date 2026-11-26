import { cn } from '../lib/cn'
import { Icon } from './Icon'
import { pocketFocusRing } from './focus'

export interface PickProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}

// pocket.css .pick ("choices in forms: a box that ticks"): a cloud field 14 round with an 18px box before the words;
// picked, the field takes the page's fill and a 2px ink ring, and the box fills with ink and ticks. A screen reader
// hears a checkbox. Lay several in a PickRow (pocket.css .pickrow).
export function Pick({ checked, onCheckedChange, className, children, ...props }: PickProps) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      className={cn(
        'flex w-full min-w-0 items-center gap-2.5 rounded-control bg-cloud px-3 py-2.5 text-left text-body text-ink',
        'aria-checked:bg-page aria-checked:shadow-pick disabled:cursor-not-allowed disabled:opacity-50',
        pocketFocusRing,
        className,
      )}
      onClick={() => onCheckedChange(!checked)}
      {...props}
    >
      <span
        aria-hidden
        className={cn('flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-tick', checked ? 'bg-ink text-on-primary' : 'shadow-edge')}
      >
        {checked ? <Icon name="check" size={12} /> : null}
      </span>
      <span className="min-w-0">{children}</span>
    </button>
  )
}

export interface PickRowProps extends React.HTMLAttributes<HTMLDivElement> {
  /** What the choices are, for a screen reader: the group's name. */
  label: string
}

/** pocket.css .pickrow: Picks two to a row, 8 apart; one to a row where two do not fit. */
export function PickRow({ label, className, ...props }: PickRowProps) {
  return <div role="group" aria-label={label} className={cn('grid grid-cols-picks gap-2', className)} {...props} />
}
