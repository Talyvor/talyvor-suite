import { useLocation, useNavigate } from 'react-router-dom'
import { Tabs } from '@talyvor/ui/pocket'

import { useAccount, type Shows } from '../areas/lens/agentBankApi'

// B61.3 — the pages that left the sidebar, as tabs of the section they belong to: Spending, Budgets, Subscriptions and
// Statements are Activity's, after All, and Invoices is Pay's on a Business account. Drawn by the shell under the page's
// heading on each of those addresses, so every one of the pages carries the same row. B57.171 — in Pocket Live's words
// (web `activity` with its four tabs, `pay` and `pay@maya`) and W3's order: Pay's row also holds Instant transfer,
// Standing orders, Mandates and Payout batches, each only on an account that has it.

interface Tab {
  to: string
  label: string
  /** Whether the account has the page; every account does when it is not said. */
  has?: (s: Shows) => boolean
}

interface Place {
  /** The sidebar row the pages sit under, and the tab row's name. */
  label: string
  tabs: readonly Tab[]
}

export const ACTIVITY_TABS: Place = {
  label: 'Activity',
  tabs: [
    { to: '/activity', label: 'All' },
    { to: '/money/spending', label: 'Spending' },
    { to: '/money/budgets', label: 'Budgets' },
    { to: '/money/subscriptions', label: 'Subscriptions' },
    { to: '/statements', label: 'Statements' },
  ],
}

export const PAY_TABS: Place = {
  label: 'Pay',
  tabs: [
    { to: '/money/pay', label: 'One payment' },
    { to: '/money/invoices', label: 'Invoices', has: (s) => s.team },
    { to: '/money/pay/instant-transfer', label: 'Instant transfer', has: (s) => s.instantTransfer },
    { to: '/money/pay/standing-orders', label: 'Standing orders', has: (s) => s.bankTransfers },
    { to: '/money/pay/mandates', label: 'Mandates', has: (s) => s.bankTransfers },
    { to: '/money/pay/bulk-payouts', label: 'Payout batches', has: (s) => s.bankTransfers && s.payoutBatches },
  ],
}

const PLACES = [ACTIVITY_TABS, PAY_TABS]

/** B61.121 — `pathname` is the page drawn, which is the page behind while one opens in the right panel. */
export function PlaceTabs({ pathname: drawn }: { pathname?: string } = {}) {
  const here = useLocation().pathname
  const pathname = drawn ?? here
  const navigate = useNavigate()
  const { shows } = useAccount()
  const place = PLACES.find((p) => p.tabs.some((t) => t.to === pathname))
  if (place === undefined || shows === null) return null
  const tabs = place.tabs.filter((t) => t.has === undefined || t.has(shows))
  const on = tabs.find((t) => t.to === pathname)
  // A row of one says nothing, and a page the account does not have sends itself on.
  if (on === undefined || tabs.length < 2) return null
  return (
    <Tabs
      label={place.label}
      tabs={tabs.map((t) => t.label)}
      value={on.label}
      onChange={(label) => navigate(tabs.find((t) => t.label === label)!.to)}
      className="mb-4.5"
    />
  )
}
