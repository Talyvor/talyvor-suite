import { useState } from 'react'
import { cn } from '../lib/cn'
import { Button } from './Button'

export interface CodeBoxProps {
  code: string
  /** What to say once it is copied: "Copied", or "Copied. Store it now: it will not be shown again" for a key. */
  copied?: string
  /** Keys, commands and addresses are mono; words are not. */
  mono?: boolean
  className?: string
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <rect x="8" y="8" width="11" height="11" rx="2.5" />
      <path d="M16 8V6.5A1.5 1.5 0 0 0 14.5 5h-8A1.5 1.5 0 0 0 5 6.5v8A1.5 1.5 0 0 0 6.5 16H8" />
    </svg>
  )
}

// pocket.css .codebox: the code on cloud with a Copy button beside it.
export function CodeBox({ code, copied = 'Copied', mono = true, className }: CodeBoxProps) {
  const [said, setSaid] = useState('')
  return (
    <div className={cn('grid gap-1.5', className)}>
      <div className="flex items-center justify-between gap-3 rounded-control bg-cloud py-2.5 pl-4 pr-2.5">
        <span className={cn('min-w-0 break-all font-semibold text-ink', mono ? 'font-mono text-body' : 'text-reading')}>{code}</span>
        <Button
          variant="secondary"
          size="sm"
          icon={<CopyIcon />}
          onClick={() =>
            navigator.clipboard.writeText(code).then(
              () => setSaid(copied),
              () => setSaid('Could not copy. Select it and copy it yourself.'),
            )
          }
        >
          Copy
        </Button>
      </div>
      <p role="status" className="text-caption font-normal text-ink-3">
        {said}
      </p>
    </div>
  )
}
