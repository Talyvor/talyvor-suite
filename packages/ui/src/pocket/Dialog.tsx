import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../lib/cn'
import { pocketFocusRing } from './focus'
import { play } from './motion'

export type LayerPosition = 'centre' | 'top' | 'corner' | 'panel'

export interface LayerProps {
  /** Names the dialog for a screen reader when no heading inside does (labelledBy). */
  label?: string
  labelledBy?: string
  onClose: () => void
  /**
   * Where it opens, as the reference has them: centred (dialogs, the sheet), top (⌘K, Paid by, the model list), the corner
   * (Taly), and the panel (B61.74: a detail or a decision, 440 wide from the right, over the page it was opened on).
   */
  position?: LayerPosition
  children: React.ReactNode
}

// pocket.css .layer > .scrim, .scrim.top, .scrim.corner and .scrim.bottom: a centred dialog is a bottom sheet below 840.
const places: Record<LayerPosition, string> = {
  centre: 'items-end justify-center wide:items-center',
  top: 'items-start justify-center px-4 pt-24',
  // B57.175 — the corner is the bottom right, so it does not also carry justify-center (which Tailwind's own order lets win).
  corner: 'items-end justify-end px-4 pb-20 wide:pr-6',
  // B61.74 — Pocket Live's move 3 on the web: the full height of the window at the right; what it holds fills it.
  panel: 'items-stretch justify-end',
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * B61.74 — the panel leaving, 280 ms to the right while its scrim clears. React has already taken the layer out of the
 * page, so the same node is put back for that long, inert and hidden from a screen reader, and then taken away: whatever
 * closed it (Esc, the scrim, the close x, Cancel, a save) leaves the same way, and nothing that opens it waits.
 */
function leave(node: HTMLDivElement) {
  if (node.isConnected) return
  const out = play(node.querySelector('[data-panel]'), [{ transform: 'translateX(0)' }, { transform: 'translateX(100%)' }], 'panel-out', 'std')
  if (!out) return
  node.setAttribute('inert', '')
  node.setAttribute('aria-hidden', 'true')
  document.body.appendChild(node)
  play(node.querySelector('[data-scrim]'), [{ opacity: 1 }, { opacity: 0 }], 'panel-out', 'std')
  const gone = () => node.remove()
  out.addEventListener('finish', gone)
  out.addEventListener('cancel', gone)
}

/**
 * B57.5 — what every Pocket dialog opens in: over the page you are on, which stays behind its scrim. Focus goes in and
 * stays in, Esc or a press on the scrim closes it, and focus goes back to the control that opened it.
 */
export function Layer({ label, labelledBy, onClose, position = 'centre', children }: LayerProps) {
  const root = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const isPanel = position === 'panel'
  useEffect(() => {
    const node = root.current
    const opener = document.activeElement as HTMLElement | null
    ;(panel.current?.querySelector<HTMLElement>(FOCUSABLE) ?? panel.current)?.focus({ preventScroll: true })
    // The page behind can be seen and not pressed, by a pointer or a screen reader, until this closes.
    const behind = Array.from(document.body.children).filter((el) => el !== root.current && !el.hasAttribute('inert'))
    for (const el of behind) el.setAttribute('inert', '')
    if (isPanel) {
      // B61.74 — in from the right over 420 ms as its scrim comes up; the page behind keeps its scroll.
      play(panel.current, [{ transform: 'translateX(100%)' }, { transform: 'translateX(0)' }], 'panel-in', 'out')
      play(node?.querySelector('[data-scrim]'), [{ opacity: 0 }, { opacity: 1 }], 'panel-in', 'out')
    }
    return () => {
      for (const el of behind) el.removeAttribute('inert')
      if (opener?.isConnected) opener.focus({ preventScroll: true })
      if (isPanel && node) leave(node)
    }
  }, [isPanel])
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
    <div ref={root} data-design="pocket" data-layer="" className={cn('fixed inset-0 z-40 flex', places[position])}>
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
        data-panel={isPanel ? '' : undefined}
        className={cn('relative w-full outline-none', isPanel ? 'pk-panel overflow-y-auto overscroll-contain bg-page shadow-pocket-lg wide:w-110' : 'wide:w-auto')}
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

// pocket.css .dialog: 480 wide, 24 round, the close x, a heading, lead lines and one row of actions; or the right panel.
export function Dialog({ open, onClose, title, children, actions, position, className }: DialogProps) {
  const heading = useId()
  if (!open) return null
  // B61.74 — in the panel the dialog is the panel's whole height, and its one row of actions sits at the foot.
  const panel = position === 'panel'
  return (
    <Layer labelledBy={heading} onClose={onClose} position={position}>
      <div
        className={cn(
          'relative w-full gap-3.5 bg-page p-6 pb-8.5 shadow-pocket-lg wide:w-120 wide:pb-6',
          panel ? 'flex flex-col' : 'grid',
          'rounded-t-sheet wide:rounded-card',
          className,
        )}
      >
        <CloseX onClose={onClose} className="absolute right-4 top-4" />
        <h2 id={heading} className="pr-10 font-display text-pocket-dialog text-ink">
          {title}
        </h2>
        {children ? <div className="grid gap-3.5 text-reading text-ink-2">{children}</div> : null}
        {actions ? <div className={cn('flex flex-wrap justify-end gap-2.5', panel && 'mt-auto pt-2')}>{actions}</div> : null}
      </div>
    </Layer>
  )
}
