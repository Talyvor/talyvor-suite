import { Link } from 'react-router-dom'
import { pocketFocusRing } from '@talyvor/ui/pocket'

// HelpLinks — B59.28: Help and complaints, Close this account and Your data, linked from the foot of every signed-in
// page and from the legal pages. One list, so the footer and the documents cannot name them differently.

export const HELP_LINKS: readonly { to: string; label: string }[] = [
  { to: '/settings/help', label: 'Help and complaints' },
  { to: '/settings/close', label: 'Close this account' },
  { to: '/settings/data', label: 'Your data' },
]

export function HelpLinks({ className = '' }: { className?: string }) {
  return (
    <nav aria-label="Help and your account" className={className}>
      <ul className="flex flex-wrap items-center gap-x-6 gap-y-2 text-body">
        {HELP_LINKS.map((l) => (
          <li key={l.to}>
            <Link to={l.to} className={`font-semibold text-ink-2 ${pocketFocusRing}`}>
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}

/** The foot of every signed-in page. */
export function SignedInFooter() {
  return (
    <footer data-design="pocket" className="mt-12 border-t border-line pt-5">
      <HelpLinks />
    </footer>
  )
}
