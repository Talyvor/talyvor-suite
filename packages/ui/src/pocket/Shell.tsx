import { useEffect, useId, useRef, useState } from 'react'
import { cn } from '../lib/cn'
import { pocketFocusRing } from './focus'

export interface ShellProps {
  /** The sidebar: the logo, the workspace, the rows and the foot. */
  sidebar: React.ReactNode
  /** The top bar's content: search, the actions and the avatar. */
  bar: React.ReactNode
  children: React.ReactNode
  /** B47.2 — the sidebar is a drawer at every width, opened only by Menu (Chat takes the whole page). */
  drawer?: boolean
  className?: string
}

/**
 * B57.8 — Pocket's app frame (pocket.css .pk.app, .side, .top, .content): the 232px sidebar on the page colour beside
 * the main column, and the top bar over the content. Below 840px the sidebar is a drawer, opened by Menu in the top bar
 * and closed by Esc, the scrim or following one of its links. It is the same <aside> at every width, off-screen and
 * invisible (so nothing in it takes focus) until opened.
 */
export function Shell({ sidebar, bar, children, drawer = false, className }: ShellProps) {
  const [open, setOpen] = useState(false)
  const asideId = useId()
  const asideRef = useRef<HTMLElement | null>(null)
  const menuRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!open) return
    const menu = menuRef.current
    asideRef.current?.querySelector<HTMLElement>('a, button:not(:disabled)')?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      menu?.focus()
    }
  }, [open])

  return (
    <div className={cn('flex min-h-full flex-col', !drawer && 'wide:flex-row', className)}>
      {open ? (
        <button
          type="button"
          aria-label="Close navigation"
          tabIndex={-1}
          className={cn('fixed inset-0 z-20 bg-scrim', !drawer && 'wide:hidden')}
          onClick={() => setOpen(false)}
        />
      ) : null}
      <aside
        id={asideId}
        ref={asideRef}
        className={cn(
          'fixed inset-y-0 left-0 z-30 w-58 max-w-full shrink-0 border-r border-line bg-page',
          !drawer && 'wide:visible wide:static wide:z-auto',
          open ? 'visible' : 'invisible',
        )}
        aria-label="Primary"
        onClick={(e) => {
          if ((e.target as Element).closest('a')) setOpen(false)
        }}
      >
        <div className="sticky top-0 flex max-h-screen min-h-screen flex-col overflow-y-auto px-3.5 py-4.5">{sidebar}</div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-header items-center gap-3 border-b border-line bg-page px-4 wide:px-7">
          <button
            ref={menuRef}
            type="button"
            aria-expanded={open}
            aria-controls={asideId}
            className={cn(
              'grid h-9 w-9 shrink-0 place-items-center rounded-pill bg-cloud text-ink',
              !drawer && 'wide:hidden',
              pocketFocusRing,
            )}
            onClick={() => setOpen((o) => !o)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-none stroke-current" strokeWidth={1.9} strokeLinecap="round">
              <path d="M4.5 7h15M4.5 12h15M4.5 17h15" />
            </svg>
            <span className="sr-only">Menu</span>
          </button>
          {bar}
        </header>
        <main className="flex-1 p-gutter">{children}</main>
      </div>
    </div>
  )
}
