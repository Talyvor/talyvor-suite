import { cn } from '../lib/cn'
import { pocketFocusRing } from './focus'

export interface CrumbProps {
  /** From the top down; the last is the page you are on and has no address. */
  trail: { label: string; href?: string }[]
  className?: string
}

// pocket.css .crumb: Agents › Research, faint, the page you are on in ink.
export function Crumb({ trail, className }: CrumbProps) {
  return (
    <nav aria-label="Breadcrumb" className={className}>
      <ol className="flex flex-wrap items-center gap-1.5 text-body text-ink-3">
        {trail.map((c, i) => {
          const last = i === trail.length - 1
          return (
            <li key={`${i}-${c.label}`} className="flex items-center gap-1.5">
              {last || !c.href ? (
                <span aria-current={last ? 'page' : undefined} className={cn(last && 'text-ink')}>
                  {c.label}
                </span>
              ) : (
                <a href={c.href} className={pocketFocusRing}>
                  {c.label}
                </a>
              )}
              {last ? null : (
                <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10 7l5 5-5 5" />
                </svg>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
