import { useLocation, useNavigate } from 'react-router-dom'
import { Tabs } from '@talyvor/ui/pocket'

import { usePersonal } from '../areas/lens/agentBankApi'

// B61.3 — the pages that left the sidebar, as tabs of the section they belong to: Statements, Spending, Budgets and
// Subscriptions are Activity's, after Activity itself, and Invoices is Pay's on a Business account. Drawn by the shell
// under the page's heading on each of those addresses, so every one of the pages carries the same row.

interface Place {
  /** The sidebar row the pages sit under, and the tab row's name. */
  label: string
  tabs: readonly { to: string; label: string }[]
  /** Whether a Personal account has the row at all. */
  personal: boolean
}

export const ACTIVITY_TABS: Place = {
  label: 'Activity',
  personal: true,
  tabs: [
    { to: '/activity', label: 'Activity' },
    { to: '/statements', label: 'Statements' },
    { to: '/money/spending', label: 'Spending' },
    { to: '/money/budgets', label: 'Budgets' },
    { to: '/money/subscriptions', label: 'Subscriptions' },
  ],
}

export const PAY_TABS: Place = {
  label: 'Pay',
  personal: false,
  tabs: [
    { to: '/money/pay', label: 'One payment' },
    { to: '/money/invoices', label: 'Invoices' },
  ],
}

const PLACES = [ACTIVITY_TABS, PAY_TABS]

export function PlaceTabs() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const personal = usePersonal()
  const place = PLACES.find((p) => p.tabs.some((t) => t.to === pathname))
  if (place === undefined || (personal && !place.personal)) return null
  const on = place.tabs.find((t) => t.to === pathname)!.label
  return (
    <Tabs
      label={place.label}
      tabs={place.tabs.map((t) => t.label)}
      value={on}
      onChange={(label) => navigate(place.tabs.find((t) => t.label === label)!.to)}
      className="mb-4.5"
    />
  )
}
