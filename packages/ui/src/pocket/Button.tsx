import { forwardRef, useId } from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cn } from '../lib/cn'
import { pocketFocusRing } from './focus'

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'danger' | 'white'
export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Drawn before the words and hidden from a screen reader: the words name the button. */
  icon?: React.ReactNode
  /** Disables the button and says why, in words beside it that a screen reader hears as its description. */
  disabledReason?: string
  /** B61.98 — the reason's own class: pk-on-bg where the button sits straight on the page's background. */
  reasonClassName?: string
  /** Render as the single child element (Radix Slot), such as a router link. */
  asChild?: boolean
  /** B61.129 — a small job is done (useDoneTick): green, with a tick drawn in place of the words, and a press does nothing. */
  done?: boolean
}

// pocket.css .btn: primary is ink, secondary cloud-2, outline and danger a 1.5px ring. White stays white in both
// themes, so it keeps the light tokens (data-theme="light") wherever it sits: on tangerine, on an ink hero.
const variants: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-on-primary',
  secondary: 'bg-cloud-2 text-ink',
  outline: 'text-ink shadow-edge',
  danger: 'text-danger shadow-edge-current',
  white: 'bg-page text-ink',
}

const sizes: Record<ButtonSize, string> = {
  sm: 'h-8.5 px-3.5 text-body',
  md: 'h-11 px-5 text-reading',
  lg: 'h-13.5 px-6.5 text-head',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', icon, disabledReason, reasonClassName, asChild = false, done = false, className, type, disabled, children, onClick, ...props },
  ref,
) {
  const reasonId = useId()
  const Comp = asChild ? Slot : 'button'
  const button = (
    <Comp
      ref={ref}
      type={asChild ? undefined : (type ?? 'button')}
      data-theme={variant === 'white' ? 'light' : undefined}
      // B61.129 — a ripple from the pointer (theme.css .pk-fx-ripple): a main button's in a tint of its own words, the rest
      // in a tint of ink. A main button also glows in the page's colour (.pk-glow).
      data-ripple={variant === 'primary' ? 'main' : 'ink'}
      data-done={done ? '' : undefined}
      // Done is not disabled (it stays at full strength, green): it says so to a screen reader and takes no second press.
      aria-disabled={done ? true : undefined}
      disabled={disabled || !!disabledReason}
      aria-describedby={disabledReason ? reasonId : undefined}
      className={cn(
        'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-pill font-semibold leading-none',
        'relative overflow-hidden transition-press active:scale-97 disabled:cursor-not-allowed disabled:opacity-50',
        pocketFocusRing,
        variants[variant],
        variant === 'primary' && 'pk-glow',
        sizes[size],
        className,
        done && 'pk-done cursor-default',
      )}
      {...props}
      onClick={done ? undefined : onClick}
    >
      {/* Slot takes exactly one child, so a button drawn as a link brings its own icon. */}
      {asChild ? (
        children
      ) : done ? (
        <>
          {/* The words stay the button's name, unseen; the tick draws itself where they were. */}
          <span className="inline-flex items-center gap-2 opacity-0">
            {icon ? <span aria-hidden="true">{icon}</span> : null}
            {children}
          </span>
          <svg viewBox="0 0 24 24" aria-hidden="true" data-done-tick="" className="pk-done-tick absolute inset-0 m-auto h-6.5 w-6.5">
            <path d="m5.5 12.5 4.2 4.2 8.8-9.2" />
          </svg>
        </>
      ) : !icon ? (
        children
      ) : (
        <>
          <span aria-hidden="true" className="inline-flex shrink-0">
            {icon}
          </span>
          {children}
        </>
      )}
    </Comp>
  )
  if (!disabledReason) return button
  return (
    <span className="inline-grid justify-items-start gap-1">
      {button}
      <span id={reasonId} className={cn('text-caption font-normal text-ink-3', reasonClassName)}>
        {disabledReason}
      </span>
    </span>
  )
})
