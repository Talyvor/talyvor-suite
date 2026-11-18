import { useRef } from 'react'
import { cn } from '../lib/cn'

const SHAPE = 'block rounded-tile bg-shape bg-double animate-shimmer'

export interface ShapesProps {
  /** Rows of a list: a face, two lines and an amount each. */
  rows?: number
  /** A balance's figure above the rows. */
  figure?: boolean
  /** What a screen reader hears while it waits; the screen's own word. */
  label?: string
  className?: string
}

/**
 * B61.75 — Pocket Live's wait (DESIGN.md section 5, "Wait"): grey shapes of the content with the 1.1 s shimmer, never a
 * spinner on money and never an old figure. The shapes are hidden from screen readers, which hear the label once.
 */
export function Shapes({ rows = 3, figure = false, label = 'Reading…', className }: ShapesProps) {
  return (
    <div role="status" data-shapes="" className={cn('grid gap-4', className)}>
      <span className="sr-only">{label}</span>
      {figure ? <span aria-hidden="true" className={cn(SHAPE, 'h-14 w-56')} /> : null}
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} aria-hidden="true" className="flex items-center gap-3">
          <span className={cn(SHAPE, 'size-10 shrink-0 rounded-pill')} />
          <span className="grid flex-1 gap-2">
            <span className={cn(SHAPE, 'h-3.5 w-2/5')} />
            <span className={cn(SHAPE, 'h-3 w-3/5')} />
          </span>
          <span className={cn(SHAPE, 'h-4 w-16')} />
        </span>
      ))}
    </div>
  )
}

/**
 * B61.75 — the keys of a list that arrived after it was first read, so each lands (`animate-land`) once. Nothing lands
 * while `ready` is false or on the first read, and a key lands only for the 1.6 s its tint lasts, so a row that leaves
 * and comes back under a filter does not drop in again.
 */
export function useLanded(keys: readonly string[], ready: boolean): (key: string) => boolean {
  const seen = useRef<Set<string> | null>(null)
  const landed = useRef(new Map<string, number>())
  const now = Date.now()
  if (ready) {
    if (seen.current === null) seen.current = new Set(keys)
    for (const k of keys) {
      if (!seen.current.has(k)) {
        seen.current.add(k)
        landed.current.set(k, now)
      }
    }
  }
  return (key) => {
    const at = landed.current.get(key)
    return at !== undefined && now - at < 1600
  }
}
