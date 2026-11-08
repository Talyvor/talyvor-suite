import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../lib/cn'
import { pocketFocusRing } from './focus'

export type LayerPosition = 'centre' | 'top' | 'corner'

export interface LayerProps {
  /** Names the dialog for a screen reader when no heading inside does (labelledBy). */
  label?: string
  labelledBy?: string
  onClose: () => void
  /** Where it opens, as the reference has them: centred (dialogs, the sheet), top (⌘K, Paid by, the model list), the corner (Taly). */
  position?: LayerPosition
  children: React.ReactNode
}

// pocket.css .layer > .scrim, .scrim.top, .scrim.corner and .scrim.bottom: a centred dialog is a bottom sheet below 840.
const places: Record<LayerPosition, string> = {
  centre: 'items-end wide:items-center',
  top: 'items-start px-4 pt-24',
  corner: 'items-end justify-end px-4 pb-20 wide:pr-6',
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * B57.5 — what every Pocket dialog opens in: over the page you are on, which stays behind its scrim. Focus goes in and
 * stays in, Esc or a press on the scrim closes it, and focus goes back to the control that opened it.
 */
export function Layer({ label, labelledBy, onClose, position = 'centre', children }: LayerProps) {
  const root = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    ;(panel.current?.querySelector<HTMLElement>(FOCUSABLE) ?? panel.current)?.focus()
    // The page behind can be seen and not pressed, by a pointer or a screen reader, until this closes.
    const behind = Array.from(document.body.children).filter((el) => el !== root.current && !el.hasAttribute('inert'))
    for (const el of behind) el.setAttribute('inert', '')
    return () => {
      for (const el of behind) el.removeAttribute('inert')
      if (opener?.isConnected) opener.focus()
    }
  }, [])
  const keys = (e: React.KeyboardEvent) => {
    // Handled here, not on document, so Esc closes only the dialog on top.
    if (e.key === 'Escape') {
      e.stopPropagation()
      onClose()
      return
    }
    if (e.key !== 'Tab' || !panel.current) return
    const all = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE))
    const first = all[0]
    const last = all[all.length - 1]
    if (!first || (e.shiftKey ? document.activeElement === first : document.activeElement === last)) {
      e.preventDefault()
      ;(e.shiftKey ? last : first)?.focus()
    }
  }
  return createPortal(
    <div ref={root} data-design="pocket" data-layer="" className={cn('fixed inset-0 z-40 flex justify-center', places[position])}>
      {/* The scrim: a press on it closes, as Esc does; a keyboard has Esc and the close x, so it is out of the tab order. */}
      <button type="button" data-scrim="" tabIndex={-1} aria-hidden="true" className="absolute inset-0 bg-scrim" onClick={onClose} />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        aria-labelledby={labelledBy}
        tabIndex={-1}
        onKeyDown={keys}
        className="relative w-full outline-none wide:w-auto"
      >
        {children}
      </div>
    </div>,
    document.body,
  )
}

export interface CloseXProps {
  onClose: () => void
  className?: string
}

// pocket.css .xclose: the 34px cloud circle in a dialog's corner.
export function CloseX({ onClose, className }: CloseXProps) {
  return (
    <button
      type="button"
      aria-label="Close"
      onClick={onClose}
      className={cn('grid h-8.5 w-8.5 place-items-center rounded-pill bg-cloud text-ink-2', pocketFocusRing, className)}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 fill-none stroke-current" strokeWidth={1.9} strokeLinecap="round">
        <path d="m7 7 10 10M17 7 7 17" />
      </svg>
    </button>
  )
}

export interface DialogProps {
  open: boolean
  onClose: () => void
  /** The heading, which also names the dialog. */
  title: React.ReactNode
  /** The lead lines under it, and anything else the dialog asks (a field, facts). */
  children?: React.ReactNode
  /** One row: secondary first, then primary or danger. */
  actions?: React.ReactNode
  position?: LayerPosition
  className?: string
}

// pocket.css .dialog: 480 wide, 24 round, the close x, a heading, lead lines and one row of actions.
export function Dialog({ open, onClose, title, children, actions, position, className }: DialogProps) {
  const heading = useId()
  if (!open) return null
  return (
    <Layer labelledBy={heading} onClose={onClose} position={position}>
      <div
        className={cn(
          'relative grid w-full gap-3.5 bg-page p-6 pb-8.5 shadow-pocket-lg wide:w-120 wide:pb-6',
          'rounded-t-sheet wide:rounded-card',
          className,
        )}
      >
        <CloseX onClose={onClose} className="absolute right-4 top-4" />
        <h2 id={heading} className="pr-10 font-display text-pocket-dialog text-ink">
          {title}
        </h2>
        {children ? <div className="grid gap-3.5 text-reading text-ink-2">{children}</div> : null}
        {actions ? <div className="flex flex-wrap justify-end gap-2.5">{actions}</div> : null}
      </div>
    </Layer>
  )
}
