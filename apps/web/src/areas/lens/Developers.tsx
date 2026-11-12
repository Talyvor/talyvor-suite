import { useLocation, useNavigate } from 'react-router-dom'
import { Eyebrow, Tabs } from '@talyvor/ui/pocket'

import { useWorkspaceAreas } from '../../lib/workspaceAreas'

// B57.55 — the head every Developers page shares (w-dev, w-dev-keys): the eyebrow, the page's heading under the shell's
// h1, its line, and the tab row between the four pages. A tab for an area this workspace does not have is not drawn
// (B59.2), so Gateway features shows only where the gateway is on.
const TABS: readonly { to: string; label: string }[] = [
  { to: '/setup', label: 'Connect an agent' },
  { to: '/keys', label: 'API keys' },
  { to: '/spend', label: 'Spend and routing' },
  { to: '/features', label: 'Gateway features' },
]

export function DevelopersHead({ heading, line }: { heading: React.ReactNode; line: React.ReactNode }) {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const areas = useWorkspaceAreas()
  const tabs = TABS.filter((t) => areas.shows(t.to))
  const on = tabs.find((t) => t.to === pathname)?.label ?? tabs[0].label
  return (
    <div className="grid gap-3">
      <div className="grid max-w-3xl gap-1">
        <Eyebrow>Developers</Eyebrow>
        {/* The shell's top bar holds the page's one h1. */}
        <h2 className="font-display text-title font-bold text-ink">{heading}</h2>
        <p className="text-reading text-ink-2">{line}</p>
      </div>
      {/* pocket.css .tabs-row: the kit's tabs, each one the page it names. */}
      <Tabs label="Developers" tabs={tabs.map((t) => t.label)} value={on} onChange={(label) => navigate(tabs.find((t) => t.label === label)!.to)} />
    </div>
  )
}
