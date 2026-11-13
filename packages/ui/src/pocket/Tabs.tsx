import { useEffect, useRef } from 'react'
import { cn } from '../lib/cn'
import { pocketFocusRing } from './focus'

export interface TabsProps<T extends string> {
  /** What the tabs choose between, for a screen reader: "Kinds". */
  label: string
  tabs: readonly T[]
  value: T
  onChange: (value: T) => void
  className?: string
}

// pocket.css .tabs-row and .tab: a row of pill tabs, the one on in ink. One tab stop for the row; the arrow
// keys move along it (WAI-ARIA tabs, selection follows focus).
export function Tabs<T extends string>({ label, tabs, value, onChange, className }: TabsProps<T>) {
  const row = useRef<HTMLDivElement>(null)
  const moved = useRef(false)
  useEffect(() => {
    if (!moved.current) return
    moved.current = false
    row.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus()
  }, [value])

  function onKeyDown(e: React.KeyboardEvent, i: number) {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key]
    const to = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : step ? (i + step + tabs.length) % tabs.length : -1
    if (to < 0) return
    e.preventDefault()
    moved.current = true
    onChange(tabs[to])
  }

  return (
    <div ref={row} role="tablist" aria-label={label} className={cn('flex flex-wrap gap-1.5', className)}>
      {tabs.map((t, i) => {
        const on = t === value
        return (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(t)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              'inline-flex h-8.5 items-center whitespace-nowrap rounded-pill px-3.5 text-body font-semibold transition-colors duration-200',
              on ? 'bg-primary text-on-primary' : 'bg-cloud text-ink-2 hover:bg-cloud-2',
              pocketFocusRing,
            )}
          >
            {t}
          </button>
        )
      })}
    </div>
  )
}
