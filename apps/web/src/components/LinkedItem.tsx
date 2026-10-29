import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

import { cn } from '@talyvor/ui'

/**
 * B41.7 — whether the address names this element (/money/pay#bill-…, the way a search result opens it); once it is
 * `ready` — its list or card read — it is brought into view.
 */
export function useLinked(id: string, ready = true): boolean {
  const linked = decodeURIComponent(useLocation().hash.slice(1)) === id
  useEffect(() => {
    if (linked && ready) document.getElementById(id)?.scrollIntoView?.({ block: 'center' })
  }, [linked, ready, id])
  return linked
}

/** A row a search result opens: marked while the address names it. */
export function LinkedItem({ id, className, ...rest }: React.LiHTMLAttributes<HTMLLIElement> & { id: string }) {
  const linked = useLinked(id)
  return <li id={id} data-linked={linked || undefined} className={cn(className, linked && 'bg-accent-tint')} {...rest} />
}
