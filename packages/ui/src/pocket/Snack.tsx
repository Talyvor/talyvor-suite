import { useEffect } from 'react'
import { create } from 'zustand'
import { cn } from '../lib/cn'

export interface SnackProps {
  title: React.ReactNode
  line?: React.ReactNode
  /** The status label where the reference draws one (B56.9's StatusLabel). */
  label?: React.ReactNode
  className?: string
}

// pocket.css .snack: ink with the page's colour on it, a tick, the title and its line, at the foot of the view.
export function Snack({ title, line, label, className }: SnackProps) {
  return (
    <div
      role="status"
      className={cn(
        'fixed inset-x-4 bottom-5.5 z-50 flex items-center gap-3 rounded-inset bg-primary py-3 pl-4 pr-3.5 text-body text-on-primary shadow-pocket-lg',
        'wide:inset-x-auto wide:left-1/2 wide:max-w-3xl wide:-translate-x-1/2',
        className,
      )}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 shrink-0 fill-none stroke-current" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 12.5l4 4 8-9" />
      </svg>
      <div className="grid min-w-0 gap-px">
        <b className="font-semibold">{title}</b>
        {line ? <span className="opacity-80">{line}</span> : null}
      </div>
      {label}
    </div>
  )
}

// The prototype's short message for a control that only explains itself (index.html's toast()).
export function Toast({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      role="status"
      className={cn(
        'fixed bottom-6 left-1/2 z-50 max-w-sm -translate-x-1/2 rounded-control bg-primary px-4 py-2.5 text-body font-semibold text-on-primary shadow-pocket-lg',
        className,
      )}
    >
      {children}
    </div>
  )
}

type Shown = Omit<SnackProps, 'className'> & { id: number; shownOn?: string }
const useConfirmations = create<{ snack: Shown | null; toast: { text: string; id: number } | null }>(() => ({ snack: null, toast: null }))
let next = 0

/** After an action: its confirmation, shown once on the next view, and gone from the view after that. */
export function showSnack(snack: Omit<SnackProps, 'className'>) {
  useConfirmations.setState({ snack: { ...snack, id: ++next } })
}

/** B57.8 — the confirmation taken away early, when what comes next sits where it is drawn (a sheet below 840). */
export function hideSnack() {
  useConfirmations.setState({ snack: null })
}

/** A short message that goes by itself, for a control that only explains itself. */
export function showToast(text: string) {
  useConfirmations.setState({ toast: { text, id: ++next } })
}

const TOAST_MS = 2800

/** Once per app, beside the routes: `view` is the address, so a snack is shown on one view and never again. */
export function SnackHost({ view }: { view: string }) {
  const { snack, toast } = useConfirmations()
  useEffect(() => {
    if (!snack) return
    if (snack.shownOn === undefined) useConfirmations.setState({ snack: { ...snack, shownOn: view } })
    else if (snack.shownOn !== view) useConfirmations.setState({ snack: null })
  }, [snack, view])
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => useConfirmations.setState((s) => (s.toast?.id === toast.id ? { toast: null } : s)), TOAST_MS)
    return () => clearTimeout(t)
  }, [toast])
  // Signing out takes the host away, and what it was about to say with it.
  useEffect(() => () => useConfirmations.setState({ snack: null, toast: null }), [])
  const shown = snack && (snack.shownOn === undefined || snack.shownOn === view) ? snack : null
  return (
    <>
      {shown ? <Snack key={shown.id} title={shown.title} line={shown.line} label={shown.label} /> : null}
      {toast ? <Toast key={toast.id}>{toast.text}</Toast> : null}
    </>
  )
}
