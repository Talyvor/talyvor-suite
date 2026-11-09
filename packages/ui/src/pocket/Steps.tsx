import { cn } from '../lib/cn'

export interface StepsProps {
  steps: { title: React.ReactNode; line?: React.ReactNode }[]
  className?: string
}

// pocket.css .howsteps and .stepn: numbered steps, each number on a tangerine disc. The disc is tangerine-50 with
// tangerine ink, the pair planes.ts scores in both themes (ink on full tangerine has no row there).
export function Steps({ steps, className }: StepsProps) {
  return (
    <ol className={cn('grid gap-3.5 wide:grid-cols-3', className)}>
      {steps.map((s, i) => (
        <li key={i} className="grid content-start justify-items-start gap-1">
          <span aria-hidden="true" className="mb-1 inline-grid h-7 w-7 place-items-center rounded-pill bg-tangerine-50 font-figure text-caption font-bold text-tangerine-ink">
            {i + 1}
          </span>
          <span className="font-semibold text-ink">{s.title}</span>
          {s.line ? <span className="text-body text-ink-3">{s.line}</span> : null}
        </li>
      ))}
    </ol>
  )
}
