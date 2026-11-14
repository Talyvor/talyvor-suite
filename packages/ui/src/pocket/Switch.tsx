import { forwardRef, useId } from 'react'
import * as SwitchPrimitive from '@radix-ui/react-switch'
import { cn } from '../lib/cn'
import { pocketFocusRing } from './focus'

export interface SwitchProps extends React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root> {
  /** Disables the switch and says why, in words beside it that a screen reader hears as its description. */
  disabledReason?: string
}

// pocket.css .toggle: 44 by 26, the control grey off and ink on. The thumb is white off in both themes (the knob colour)
// and on-primary on: white in the light theme, ink in the dark, as .pk-dark .toggle.on::after (B57.58). Radix supplies role="switch", aria-checked and Space.
export const Switch = forwardRef<React.ElementRef<typeof SwitchPrimitive.Root>, SwitchProps>(function Switch(
  { disabledReason, disabled, className, ...props },
  ref,
) {
  const reasonId = useId()
  const control = (
    <SwitchPrimitive.Root
      ref={ref}
      disabled={disabled || !!disabledReason}
      aria-describedby={disabledReason ? reasonId : undefined}
      className={cn(
        'inline-flex h-6.5 w-11 shrink-0 cursor-pointer items-center rounded-pill bg-control transition-colors duration-200',
        'data-[state=checked]:bg-ink disabled:cursor-not-allowed disabled:opacity-50',
        pocketFocusRing,
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'pointer-events-none block h-5 w-5 translate-x-0.75 rounded-pill bg-knob',
          'transition-all duration-200 data-[state=checked]:translate-x-5.25 data-[state=checked]:bg-on-primary',
        )}
      />
    </SwitchPrimitive.Root>
  )
  if (!disabledReason) return control
  return (
    <span className="inline-flex items-center gap-2.5">
      {control}
      <span id={reasonId} className="text-caption font-normal text-ink-3">
        {disabledReason}
      </span>
    </span>
  )
})
