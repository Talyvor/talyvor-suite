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
  /** Render as the single child element (Radix Slot), such as a router link. */
  asChild?: boolean
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
  { variant = 'primary', size = 'md', icon, disabledReason, asChild = false, className, type, disabled, children, ...props },
  ref,
) {
  const reasonId = useId()
  const Comp = asChild ? Slot : 'button'
  const button = (
    <Comp
      ref={ref}
      type={asChild ? undefined : (type ?? 'button')}
      data-theme={variant === 'white' ? 'light' : undefined}
      disabled={disabled || !!disabledReason}
      aria-describedby={disabledReason ? reasonId : undefined}
      className={cn(
        'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-pill font-semibold leading-none',
        'transition-colors duration-200 active:scale-98 disabled:cursor-not-allowed disabled:opacity-50',
        pocketFocusRing,
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {/* Slot takes exactly one child, so a button drawn as a link brings its own icon. */}
      {asChild || !icon ? (
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
      <span id={reasonId} className="text-caption font-normal text-ink-3">
        {disabledReason}
      </span>
    </span>
  )
})
