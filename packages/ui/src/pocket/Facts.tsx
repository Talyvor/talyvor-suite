import { cn } from '../lib/cn'

export interface FactsProps {
  facts: { label: React.ReactNode; value: React.ReactNode }[]
  /** The plane it sits on: the page (the default) shows it on cloud, a cloud card on the page. */
  on?: 'page' | 'cloud'
  className?: string
}

// pocket.css .facts2: label and value rows, as the approval sheet's. A list of terms and what they are, so a <dl>.
export function Facts({ facts, on = 'page', className }: FactsProps) {
  return (
    <dl className={cn('grid rounded-inset px-3.5 py-0.5 text-body', on === 'cloud' ? 'bg-page' : 'bg-cloud', className)}>
      {facts.map((f, i) => (
        <div key={i} className="flex justify-between gap-3 border-t border-line py-2 first:border-t-0">
          <dt className="text-ink-3">{f.label}</dt>
          <dd className="m-0 text-right font-figure font-semibold text-ink">{f.value}</dd>
        </div>
      ))}
    </dl>
  )
}
