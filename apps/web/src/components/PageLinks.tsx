import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Button, Icon, KindTile, pocketFocusRing, type IconName } from '@talyvor/ui/pocket'
import { cn } from '@talyvor/ui'
import { getJSONArray } from '../lib/api'
import { useAuthMeReader } from '../lib/authMe'
import { useWorkspaceAreas } from '../lib/workspaceAreas'
import { WORKSPACE_NAME_KEY, agentBankApi, useAccount } from '../areas/lens/agentBankApi'
import type { RosterMember } from '../areas/lens/Members'
import { SUBSCRIPTION_KEY } from '../areas/lens/Plans'
import { planApi } from '../areas/lens/planApi'

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

/** B57.42 — one settings page's card on /settings (pocket.css .card.setc): its tile, its name and its line. */
export interface SettingsLink extends PageLink {
  icon: IconName
}

/** Settings' cards: every settings page, two to a row, each a link. */
export function SettingsCards({ links }: { links: readonly SettingsLink[] }) {
  return (
    <nav aria-label="Settings pages" className="grid content-start gap-3 wide:grid-cols-2">
      {links.map((l) => (
        <Link key={l.to} to={l.to} className={cn('flex items-center gap-3 rounded-card bg-cloud p-4 text-ink', pocketFocusRing)}>
          <KindTile icon={<Icon name={l.icon} size={18} />} />
          <span className="grid min-w-0 flex-1 gap-0.5">
            <span className="text-reading font-semibold">{l.title}</span>
            {l.line ? <span className="text-body text-ink-3">{l.line}</span> : null}
          </span>
          <Icon name="chev" size={16} className="shrink-0 text-ink-3" />
        </Link>
      ))}
    </nav>
  )
}

/** Each settings page's tile. */
const SETTINGS_ICON: Record<string, IconName> = {
  '/settings/connect': 'model',
  '/members': 'rooms',
  '/billing': 'billing',
  '/settings/company': 'statements',
  '/settings/verification': 'shield',
  '/settings/payout-details': 'coin',
  '/settings/terms': 'check',
  '/settings/webhooks': 'send',
  '/settings/email-branding': 'bell',
  '/settings/help': 'phone',
  '/settings/data': 'download',
  '/settings/close': 'x',
  '/operator': 'key',
}

/** "1 person" or "3 people". */
const people = (n: number) => (n === 1 ? `${n} person` : `${n} people`)

/** The plan Lens bills, by its name: free, plus, pro, max, byok, team, business or enterprise. */
const planName = (plan: string) => (plan === 'byok' ? 'BYOK' : `${plan.charAt(0).toUpperCase()}${plan.slice(1)}`)

/** Every settings page this person may open: a page for an area the workspace does not have is not linked (B59.2). */
export function useSettingsLinks(): SettingsLink[] {
  const me = useAuthMeReader()
  const operator = me.data?.operator === true
  const areas = useWorkspaceAreas()
  const { account, shows } = useAccount()
  // B59.10 — Members only for a Business; B59.31 — the company details once the account is known to be one.
  const team = shows?.team !== false
  const business = account?.account_type === 'business'
  const roster = useQuery({
    queryKey: ['members'],
    queryFn: () => getJSONArray<{ id: string }>('/api/members'),
    enabled: team,
  })
  const sub = useQuery({
    queryKey: SUBSCRIPTION_KEY,
    queryFn: planApi.subscription,
    retry: false,
  })
  const st = sub.data?.enabled ? sub.data.data : null
  const plan = st ? planName(st.subscribed && st.plan ? st.plan : 'free') : undefined
  const links: PageLink[] = [
    { to: '/settings/connect', title: 'Connect your AI', line: 'Use Talyvor from Claude, ChatGPT and others' },
    ...(team ? [{ to: '/members', title: 'Members', line: roster.data ? people(roster.data.length) : undefined }] : []),
    { to: '/billing', title: 'Billing and plan', line: plan },
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
    ...(operator ? [{ to: '/operator', title: 'Talyvor operators', line: 'Workspaces, tax, compliance and the review queue. Shown only to Talyvor’s operators' }] : []),
  ]
  return links.filter((l) => areas.shows(l.to)).map((l) => ({ ...l, icon: SETTINGS_ICON[l.to] ?? 'settings' }))
}

/** Who is signed in, to which workspace and as what, and the way out (moved here from the top bar by B57.8). */
export function SignedIn() {
  const me = useAuthMeReader()
  const qc = useQueryClient()
  const roster = useQuery({
    queryKey: ['members'],
    queryFn: () => getJSONArray<RosterMember>('/api/members'),
  })
  const workspace = useQuery({
    queryKey: WORKSPACE_NAME_KEY,
    queryFn: agentBankApi.workspaceName,
    staleTime: 60_000,
    retry: false,
  })
  if (!me.data?.authenticated || !me.data.user) return null
  const email = me.data.user.email
  const self = roster.data?.find((m) => m.email === email)
  // B55.39 — Lens names a new workspace by its id; it is never shown.
  const named = workspace.data?.name && workspace.data.name !== workspace.data.id ? workspace.data.name : null
  const where = named ?? 'your workspace'
  const who = self?.name || email
  const line = self ? `Signed in as ${who}, ${self.role === 'owner' ? 'the owner' : 'a member'} of ${where}.` : `Signed in as ${who}.`
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="min-w-0 truncate text-reading text-ink-2" title={email} data-testid="settings-signed-in">
        {line}
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
  )
}
