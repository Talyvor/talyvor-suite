import { useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Button, Icon, pocketFocusRing } from '@talyvor/ui/pocket'
import { cn } from '@talyvor/ui'
import { useAuthMeReader } from '../lib/authMe'
import { useWorkspaceAreas } from '../lib/workspaceAreas'
import { useAccount } from '../areas/lens/agentBankApi'

/**
 * B57.8 — a page's links to the pages that left the sidebar, as Pocket draws them (pocket.css .card.setc): Billing
 * links Overview and Ledger, the Marketplace its own pages, Settings the settings. Drawn in Pocket on a page that is
 * still today's design, so the links carry their own marker.
 */
export interface PageLink {
  to: string
  title: string
  line?: string
}

export function PageLinks({ links, label, className }: { links: readonly PageLink[]; label: string; className?: string }) {
  return (
    <nav aria-label={label} data-design="pocket" className={cn('grid gap-3 wide:grid-cols-2', className)}>
      {links.map((l) => (
        <Link
          key={l.to}
          to={l.to}
          className={cn('flex items-center justify-between gap-3 rounded-card bg-cloud p-4 text-ink', pocketFocusRing)}
        >
          <span className="grid min-w-0 gap-0.5">
            <span className="text-reading font-semibold">{l.title}</span>
            {l.line ? <span className="text-body text-ink-3">{l.line}</span> : null}
          </span>
          <Icon name="chev" size={16} className="text-ink-3" />
        </Link>
      ))}
    </nav>
  )
}

/** Billing: where the workspace's money went, which left the sidebar's Billing group. */
export const BILLING_LINKS: readonly PageLink[] = [
  { to: '/overview', title: 'Spend and earnings', line: 'Overview: what this workspace has, spends and earns' },
  { to: '/ledger', title: 'Ledger', line: 'Every movement of the workspace’s LXC, in words' },
]

/** The Marketplace's own pages; the review queue only for someone the BFF's operator gate admits. */
export function MarketplaceLinks() {
  const operator = useAuthMeReader().data?.operator === true
  const links: PageLink[] = [
    { to: '/marketplace/licences', title: 'Your licences' },
    { to: '/marketplace/selling', title: 'Your listings and earnings' },
    { to: '/marketplace/publish', title: 'Publish' },
    { to: '/marketplace/compare', title: 'Compare listings' },
    { to: '/marketplace/bill', title: 'Your bill' },
    { to: '/marketplace/content-filter', title: 'Content filter' },
    ...(operator ? [{ to: '/marketplace/review', title: 'Review queue' }] : []),
  ]
  return <PageLinks label="Marketplace pages" links={links} className="mb-4.5" />
}

/** Settings: who is signed in and the way out (moved here from the top bar), and every settings page. */
export function SettingsLinks() {
  const me = useAuthMeReader()
  const qc = useQueryClient()
  const operator = me.data?.operator === true
  // B59.2 — no link to a hidden area's page; B59.10 — Members only for a Business.
  const areas = useWorkspaceAreas()
  const { account, shows } = useAccount()
  const team = shows?.team !== false
  // B59.31 — the company details only once the account is known to be a Business.
  const business = account?.account_type === 'business'
  const links: PageLink[] = [
    { to: '/settings/connect', title: 'Connect your AI', line: 'Use Talyvor from Claude, ChatGPT and others' },
    ...(team ? [{ to: '/members', title: 'Members' }] : []),
    { to: '/billing', title: 'Billing and plan' },
    ...(business ? [{ to: '/settings/company', title: 'Company details', line: 'Company name, number and country, and the people with control' }] : []),
    { to: '/settings/verification', title: 'Verification', line: 'What Talyvor has checked about you' },
    // B55.28 — where the workspace is paid its earnings.
    { to: '/settings/payout-details', title: 'Payout details', line: 'Where Talyvor pays you' },
    { to: '/settings/terms', title: 'Capability terms', line: 'The terms each money feature asks you to accept' },
    { to: '/settings/webhooks', title: 'Webhooks', line: 'Docs tells your server about approvals and comments' },
    { to: '/settings/email-branding', title: 'Email branding', line: 'How Docs email looks: its name, colour and logo' },
    { to: '/settings/help', title: 'Help and complaints', line: 'Ask us something, or make a complaint' },
    { to: '/settings/data', title: 'Your data', line: 'A copy of your data, or ask for it to be deleted' },
    { to: '/settings/close', title: 'Close this account', line: 'What must be empty first, and asking to close' },
    ...(operator ? [{ to: '/operator', title: 'Talyvor operators', line: 'Workspaces, tax, compliance and the review queue' }] : []),
  ].filter((l) => areas.shows(l.to))
  return (
    <div data-design="pocket" className="grid gap-4.5">
      {me.data?.authenticated && me.data.user ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="min-w-0 truncate text-reading text-ink-2" title={me.data.user.email}>
            Signed in as {me.data.user.email}.
          </p>
          <Button
            variant="secondary"
            onClick={() => {
              void fetch('/auth/logout', { method: 'POST' }).then(() => {
                // The session is dead server-side; re-probe so the gate re-renders.
                void qc.invalidateQueries({ queryKey: ['auth-me'] })
              })
            }}
          >
            Sign out
          </Button>
        </div>
      ) : null}
      <PageLinks label="Settings pages" links={links} />
    </div>
  )
}
