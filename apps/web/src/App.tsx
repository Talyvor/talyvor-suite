import { useLayoutEffect, useMemo } from 'react'
import { QueryCache, QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import {
  BrowserRouter,
  Link,
  Route,
  Routes,
  matchRoutes,
  useHref,
  useLinkClickHandler,
  useLocation,
  useNavigationType,
} from 'react-router-dom'
import { Logo, cn, inlineLink } from '@talyvor/ui'
import {
  Button as PocketButton,
  EmptyState,
  Icon as PocketIcon,
  PageHeading,
  Shell as PocketShell,
  SnackHost,
  pocketFocusRing,
  type IconName as PocketIconName,
} from '@talyvor/ui/pocket'
import { AuthGate } from './components/AuthGate'
import { EveryAgentSwitch, KillBanner } from './components/EveryAgent'
import { TalyButton } from './taly/TalyButton'
import { useDocumentTitle } from './documentTitle'
import { ApiError, UnreadableError } from './lib/api'
import { Overview } from './areas/lens/Overview'
import { Home } from './areas/lens/Home'
import { AppMoney } from './areas/lens/money'
import { WORKSPACE_NAME_KEY, accountChip, agentBankApi, useAccount, usePersonal } from './areas/lens/agentBankApi'
import { Ledger } from './areas/lens/Ledger'
import { Earnings, EarningsMoved, ROYALTIES_PATH } from './areas/lens/Earnings'
import { Keys } from './areas/lens/Keys'
import { Setup } from './areas/lens/Setup'
import { Spend } from './areas/lens/Spend'
import { Members } from './areas/lens/Members'
import { Settings, TeamOnly } from './areas/lens/Sharing'
import { WELCOME_PATH, Welcome, WelcomeRedirect } from './areas/auth/Welcome'
import { CloseAccountScreen, HelpScreen, YourDataScreen } from './areas/lens/HelpAndAccount'
import { CompanyDetailsScreen } from './areas/lens/CompanyDetails'
import { SignedInFooter } from './components/HelpLinks'
import { Features } from './areas/lens/Features'
import { AgentBank } from './areas/lens/AgentBank'
import { Agents } from './areas/lens/Agents'
import { CardsScreen } from './areas/lens/Cards'
import { ApprovalsScreen, StatementsScreen, usePendingApprovals } from './areas/lens/WalletScreens'
import { ApprovalSheetHost } from './areas/lens/ApprovalSheet'
import { MarketplaceArea } from './areas/marketplace/Marketplace'
import { TryConversion, TryTare } from './areas/lens/TryIt'
import { TopUp } from './areas/lens/TopUp'
import { Plans } from './areas/lens/Plans'
import { BillingCancel, BillingSuccess } from './areas/lens/BillingReturn'
import { Chat } from './areas/chat/Chat'
import { ChatHelp } from './areas/chat/ChatHelp'
import { CompareModels } from './areas/chat/CompareModels'
import { ConnectorsPage } from './areas/chat/ConnectorsPage'
import { InstructionsPage } from './areas/chat/InstructionsPage'
import { PromptsPage } from './areas/chat/PromptsPage'
import { ScheduledPage } from './areas/chat/ScheduledPage'
import { FilesPage } from './areas/chat/FilesPage'
import { MemoryPage } from './areas/chat/MemoryPage'
import { RoomsArea } from './areas/rooms/Rooms'
import { TrackArea } from './areas/track/TrackArea'
import { PublicBoard } from './areas/board/PublicBoard'
import { SharedChat } from './areas/share/SharedChat'
import { SharedDocsPage } from './areas/share/SharedDocsPage'
import { DocsArea } from './areas/docs/DocsArea'
import { OperatorTax } from './areas/lens/OperatorTax'
import { OperatorCompliance } from './areas/lens/OperatorCompliance'
import { VerificationScreen } from './areas/lens/Verification'
import { PayoutDetailsScreen } from './areas/lens/PayoutDetails'
import { CapabilityTermsScreen } from './areas/lens/CapabilityTerms'
import { ConnectAI } from './areas/lens/ConnectAI'
import { DocsEmailBranding } from './areas/docs/DocsEmailBranding'
import { DocsWebhooks } from './areas/docs/DocsWebhooks'
import { InvoicesScreen } from './areas/lens/Invoices'
import { PayBillsScreen, PayBulkPayoutsScreen, PayMandatesScreen, PayScreen, PayStandingOrdersScreen } from './areas/lens/Pay'
import { RecurringPlanScreen } from './areas/lens/RecurringPlan'
import { SubscriptionsScreen } from './areas/lens/Subscriptions'
import { BudgetsScreen } from './areas/lens/Budgets'
import { ScanAgentsScreen, ScanReportsScreen, ScanTrackRecordScreen } from './areas/lens/Scan'
import { ScanReportScreen } from './areas/lens/ScanReport'
import { SpendingScreen } from './areas/lens/Spending'
import { PhysicalCardScreen } from './areas/lens/PhysicalCard'
import { ApproveScreen } from './areas/lens/Approve'
import { PayInvoicePage } from './areas/pay/PayInvoice'
import { OperatorWorkspaces } from './areas/lens/OperatorWorkspaces'
import { Landing } from './areas/marketing/Landing'
import { Pricing } from './areas/marketing/Pricing'
import { YourMoney } from './areas/marketing/YourMoney'
import { Documentation } from './areas/documentation/Documentation'
import { CLAUDE_CONNECTOR_PATH, DOCUMENTATION_PATH } from './areas/documentation/content'
import { ClaudeConnector } from './areas/documentation/ClaudeConnector'
import { MetaPixel } from './areas/marketing/MetaPixel'
import { Privacy } from './routes/Privacy'
import { Terms } from './routes/Terms'
import { SignIn } from './areas/auth/Entry'
import { SignUp, SignUpKey } from './areas/auth/SignUp'
import { SessionExpiredBar } from './components/SessionExpiredBar'
import { KeyRecoveryNotice, RecoveryCodeSheet } from './areas/lens/KeyRecovery'
import { CommandPalette, ariaKeys, shortcutText, type PalettePage } from './components/CommandPalette'
import { ScreenBoundary } from './components/ScreenBoundary'
import { useAuthMeReader } from './lib/authMe'
import { designOf } from './pocketPending'
import { WorkspaceStatus } from './labels/workspace'
import { AreaRoute, IfArea, useWorkspaceAreas } from './lib/workspaceAreas'

// App.tsx is a SHARED file (see README §Directory ownership): it owns routing
// and the nav for every area. Area work happens inside src/areas/<area>/ —
// changing THIS file requires its own PR, because five parallel tracks depend
// on it not moving under them.

// Exported as a test seam: route-level tests need to clear cached probes between cases so one
// test's /auth/me answer cannot be read as the next one's.
export const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (err) => {
      // A 401 mid-session (expiry, signed out elsewhere) re-probes the gate, so
      // the sign-in card appears instead of a screen of silent per-card failures.
      if (err instanceof ApiError && err.status === 401) {
        void queryClient.invalidateQueries({ queryKey: ['auth-me'] })
      }
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: false,
      // A 401 or 403 is a verdict, not a flake — retrying it just delays the gate or the refusal.
      // So is an answer that arrived and cannot be read (B27.12): asking again a second later gets
      // the same body, and the screen's own "try again" is the person's to press.
      retry: (failureCount, error) =>
        failureCount < 1 &&
        !(error instanceof UnreadableError) &&
        !(error instanceof ApiError && (error.status === 401 || error.status === 403)),
    },
  },
})

/**
 * THE CONSOLE'S PAGES — ONE TABLE, because two tables that must agree do not.
 *
 * ⚠ WHAT THIS REPLACED, MEASURED AT `c9e1e8a` WITH EVERY GATE GREEN. The route list and a
 * separate `titleFor()` each held their own copy of the paths, and they disagreed on every
 * address that has no page:
 *   · `titleFor` ended `exact[pathname] ?? 'Overview'`, so /admin — the retired operator
 *     console someone still has bookmarked — rendered the header "Overview" above the body
 *     "Nothing at this address". The sidebar highlighted nothing, so the ONLY name on the
 *     screen was the wrong one.
 *   · the three prefix rules over-matched by a character: /billingx titled "Billing",
 *     /trackers "Track", /docs-old "Docs", each of them routed to the catch-all.
 * Eight addresses measured, eight titled as a page they were not. ConsoleTitle.test.tsx drives
 * the real `<App />` to each one and reads the banner, so the assertion survives this table
 * being replaced again.
 *
 * The title now travels WITH the route, so a new page cannot be added without naming itself,
 * and `matchRoutes` answers "which page is this" with the same matcher `<Routes>` uses —
 * `startsWith` was never that matcher, which is the whole defect above.
 */
export const NOT_FOUND_TITLE = 'Not found'

export interface ConsoleRoute {
  /** Exactly the string `<Route path>` receives — splats included, so the two cannot drift. */
  path: string
  /** What the sticky top bar says while this route is matched. */
  title: string
  element: React.ReactElement
}

export const CONSOLE_ROUTES: readonly ConsoleRoute[] = [
  // B28.6 — the first screen after sign-in is the wallet home: total balance, credit not yet given to
  // agents, each agent's budget used, approvals waiting, the month forecast and pause-all. Overview —
  // what the workspace has, spends and earns across both tokens — moved one address over, unchanged.
  { path: '/', title: 'Home', element: <Home /> },
  // B28.7 — the wallet's own destinations, first in the sidebar after Home.
  { path: '/approvals', title: 'Approvals', element: <ApprovalsScreen /> },
  { path: '/statements', title: 'Statements', element: <StatementsScreen /> },
  { path: '/overview', title: 'Overview', element: <Overview /> },
  { path: '/ledger', title: 'Ledger', element: <Ledger /> },
  // W4.6.1 step 7 — the earnings screen. It sits beside the Ledger because they answer adjacent
  // questions off the SAME ledger table, and deliberately is NOT a panel on Overview: the field
  // Overview would have reached for, lifetime_earned, is lifetime CREDITED (talyvor-lens #472),
  // and putting an honest earnings figure next to a misleading one invites a reader to average
  // them.
  //
  // B28.10 — it is "Royalties" now, under Statements: a royalty on a shared answer is a side effect
  // of a cost saving, not the product's revenue, so it sits beside the agents' statements and
  // carries the LENS→LXC conversion. The old /earnings address redirects here (below the table).
  { path: '/statements/royalties', title: 'Royalties', element: <Earnings /> },
  // W4.6.1 step 6 — the chat screen. It sits directly under Overview because it is the first
  // surface a subscriber uses, not an administrative one.
  { path: '/chat', title: 'Chat', element: <Chat /> },
  // B10.3 — the chat carries no instructions; they live here, linked from its rail.
  { path: '/chat/help', title: 'How to use Chat', element: <ChatHelp /> },
  // B28.369 — one question to three models at once, side by side, each answer priced. Linked from Chat's rail.
  { path: '/chat/compare', title: 'Compare models', element: <CompareModels /> },
  // B28.115 — custom instructions, sent with every question in every chat. Linked from Chat's rail.
  { path: '/chat/instructions', title: 'Custom instructions', element: <InstructionsPage /> },
  // B28.370 — the prompt library: the workspace's named prompts in Lens, used in any chat by name. Linked from Chat's rail.
  { path: '/chat/prompts', title: 'Prompts', element: <PromptsPage /> },
  // B28.377 — prompts scheduled with /schedule, each asked on an agent's wallet, and their answers. Linked from Chat's rail.
  { path: '/chat/scheduled', title: 'Scheduled prompts', element: <ScheduledPage /> },
  // B28.371 — memory: what Chat remembers about the person, opt-in, every fact listed and deleted. Linked from Chat's rail.
  { path: '/chat/memory', title: 'Memory', element: <MemoryPage /> },
  // B28.380 — uploaded files: every file attached in Chat, kept in Lens, listed and deleted for good. Linked from Chat's rail.
  { path: '/chat/files', title: 'Files', element: <FilesPage /> },
  // B28.122 — connectors: the person's own MCP servers, whose tools Chat offers beside Talyvor's. Linked from Chat's rail.
  { path: '/chat/connectors', title: 'Connectors', element: <ConnectorsPage /> },
  // B32.53 — rooms: open chats other workspaces join, the directory and a new room. Chat's rail lists them too.
  { path: '/rooms/*', title: 'Rooms', element: <RoomsArea /> },
  // THESE TWO PATHS ARE NOT OURS TO CHOOSE. Lens's Stripe redirect targets already default to
  // app.talyvor.com/billing/success?session_id={CHECKOUT_SESSION_ID} and /billing/cancel — the
  // design assumed the suite owned them. A customer arrives here by full page load from Stripe,
  // so both must resolve on a cold navigation, not only in-app. They title as Billing because
  // that is the page the customer is on, not as Overview.
  { path: '/billing', title: 'Billing', element: <TopUp /> },
  // B13.3 — Plus · Pro · Max, the usage meter and what a subscriber's answers earned.
  { path: '/plans', title: 'Plans', element: <Plans /> },
  { path: '/billing/success', title: 'Billing', element: <BillingSuccess /> },
  { path: '/billing/cancel', title: 'Billing', element: <BillingCancel /> },
  { path: '/keys', title: 'API keys', element: <Keys /> },
  // B19.4 — each AI agent's own wallet: balance, rules, statement, payments and approvals. B57.8: Pocket's Agents.
  // B57.19 — the agents as Pocket's w-agents, and New agent with the plan's limit said first.
  { path: '/agents', title: 'Agents', element: <Agents /> },
  // B57.16 — an agent's page and its rules: today's agent view with that agent open, until B57.20 and B57.23 draw them.
  { path: '/agents/:id', title: 'Agents', element: <AgentBank /> },
  { path: '/agents/:id/rules', title: 'Agents', element: <AgentBank /> },
  // B59.45 — every agent's card, Frozen or not, its limits, Freeze card, its purchases, and its details behind the passkey.
  { path: '/cards', title: 'Cards', element: <CardsScreen /> },
  // B20.3 — browse, use and publish agents, prompts, skills, evaluations and pipelines; what they earned.
  { path: '/marketplace/*', title: 'Marketplace', element: <MarketplaceArea /> },
  { path: '/setup', title: 'Connect an agent', element: <Setup /> },
  { path: '/spend', title: 'Spend and routing', element: <Spend /> },
  { path: '/members', title: 'Members', element: <Members /> },
  { path: '/settings', title: 'Settings', element: <Settings /> },
  // B30.116 — the owner's verification level, each check, and the level each capability needs for live money.
  { path: '/settings/verification', title: 'Verification', element: <VerificationScreen /> },
  // B55.28 — where the workspace is paid its share of a room, its marketplace sales and royalties.
  { path: '/settings/payout-details', title: 'Payout details', element: <PayoutDetailsScreen /> },
  // B30.103 — each money capability's terms, read and accepted before its first use.
  { path: '/settings/terms', title: 'Capability terms', element: <CapabilityTermsScreen /> },
  // B39.25 — a Docs workspace's owner adds, rotates and deletes its signed webhooks.
  { path: '/settings/webhooks', title: 'Webhooks', element: <DocsWebhooks /> },
  // B39.34 — a Docs workspace's owner sets the From name, header colour and logo of its Docs email.
  { path: '/settings/email-branding', title: 'Email branding', element: <DocsEmailBranding /> },
  // B40.8 — the MCP address, how to add it to each assistant, and the assistants connected, each revocable.
  { path: '/settings/connect', title: 'Connect your AI', element: <ConnectAI /> },
  // B59.28 — help and complaints, closing the account and the account's data, each answered by a person at Talyvor.
  { path: '/settings/help', title: 'Help and complaints', element: <HelpScreen /> },
  { path: '/settings/close', title: 'Close this account', element: <CloseAccountScreen /> },
  { path: '/settings/data', title: 'Your data', element: <YourDataScreen /> },
  // B59.31 — a Business account's company details and the people with control.
  { path: '/settings/company', title: 'Company details', element: <CompanyDetailsScreen /> },
  // B30.97 — invoices from an agent's currency account, each with its public pay link.
  { path: '/money/invoices', title: 'Invoices', element: <InvoicesScreen /> },
  // B30.96 — pay a saved payee, standing orders, mandates and bulk payouts, with an agent's approvals inline.
  { path: '/money/pay', title: 'Pay', element: <PayScreen /> },
  // B57.32 — Pay's standing orders, mandates, bulk payouts and bills, each on its own page reached from Also on Pay.
  { path: '/money/pay/standing-orders', title: 'Standing orders', element: <PayStandingOrdersScreen /> },
  { path: '/money/pay/mandates', title: 'Mandates', element: <PayMandatesScreen /> },
  { path: '/money/pay/bulk-payouts', title: 'Bulk payouts', element: <PayBulkPayoutsScreen /> },
  { path: '/money/pay/bills', title: 'Bills you received', element: <PayBillsScreen /> },
  // B45.37 — the page an assistant's recurring-payments link opens: its standing orders, and one passkey signature.
  { path: '/money/plans/:id', title: 'Sign recurring payments', element: <RecurringPlanScreen /> },
  // B41.20 — every recurring payment, standing order and renewing rental, with its next charge, monthly cost and reminder.
  { path: '/money/subscriptions', title: 'Subscriptions', element: <SubscriptionsScreen /> },
  // B41.39 — a weekly or monthly budget per category, its progress from the postings, and its 50/80/100% alerts.
  { path: '/money/budgets', title: 'Budgets', element: <BudgetsScreen /> },
  // B52.28 — the published Scan reports, each with its chart, sources and how it was made; Scan agents watch the data their owner picks and alert on what is unusual; the track record scores every report.
  { path: '/scan/reports', title: 'Scan reports', element: <ScanReportsScreen /> },
  { path: '/scan/reports/:id', title: 'Scan report', element: <ScanReportScreen /> },
  { path: '/scan/agents', title: 'Scan agents', element: <ScanAgentsScreen /> },
  { path: '/scan/track-record', title: 'Track record', element: <ScanTrackRecordScreen /> },
  // B53.8 — the week's and month's spending by category, budgets, subscriptions, the unusual with the Coach's sentence, notices.
  { path: '/money/spending', title: 'Spending', element: <SpendingScreen /> },
  // B53.12 — order, activate and replace the physical card; while Lens's switch is off it sends the person to Spending.
  { path: '/money/card', title: 'Talyvor Card', element: <PhysicalCardScreen /> },
  // B40.9 — the page a prepared request's approval link opens (Lens B40.3), from Chat, an assistant or a push.
  { path: '/approve/:id', title: 'Approve payments', element: <ApproveScreen /> },
  // B8.2 — every capability, what it does and costs, whether it is on, and its switch.
  { path: '/features', title: 'Gateway features', element: <Features /> },
  // B11.3 — run Tare or document conversion on your own input: no model call, no charge.
  { path: '/features/try/tare', title: 'Try Tare', element: <TryTare /> },
  { path: '/features/try/conversion', title: 'Try document conversion', element: <TryConversion /> },
  { path: '/track/*', title: 'Track', element: <TrackArea /> },
  { path: '/docs/*', title: 'Docs', element: <DocsArea /> },
  // B18.25 — every workspace's spend, held LENS and last activity; the BFF answers only OPERATOR_SUBS.
  { path: '/operator', title: 'Operator', element: <OperatorWorkspaces /> },
  // B32.63 — tax rates, registrations, each quarter's tax and the platform report.
  { path: '/operator/tax', title: 'Tax', element: <OperatorTax /> },
  // B30.104 — every capability's class and clearance, safeguarding, and the daily reconciliation with its breaks.
  { path: '/operator/compliance', title: 'Compliance', element: <OperatorCompliance /> },
]

// Built once: matchRoutes only needs the paths, and rebuilding this per render would allocate
// a table on every navigation for an answer that cannot change.
const TITLE_MATCHERS = CONSOLE_ROUTES.map(({ path }) => ({ path }))

function titleFor(pathname: string): string {
  // B17.82 — /earnings draws Royalties before its address catches up, so it is titled as Royalties.
  const matches = matchRoutes(TITLE_MATCHERS, pathname === '/earnings' ? ROYALTIES_PATH : pathname)
  const matched = matches?.[matches.length - 1]?.route.path
  return CONSOLE_ROUTES.find((r) => r.path === matched)?.title ?? NOT_FOUND_TITLE
}

/**
 * ⚠ A DESTINATION, NOT A COMMAND — AND THE RULE IS THE ONE THIS FILE ALREADY STATES BELOW FOR
 * PRIVACY AND TERMS. These ten rows were `<NavItem onClick={() => navigate(to)}>`: `<button>`s
 * with no `href`. MEASURED by driving the real app to all twelve gated addresses and clicking
 * every button on the page from a freshly mounted app — 9 or 10 of them changed the address, and
 * not one carried an href. So on every screen behind the gate, the whole product was unreachable
 * by cmd-click, by middle click (which raises `auxclick`, never `click`), by the context menu's
 * "Open link in new tab" or "Copy link address", and by a screen reader's links list, which held
 * Privacy and Terms and nothing else. See ConsoleNavLinks.test.tsx.
 *
 * ⚠ NOT A HAND-ROLLED MODIFIER CHECK. "Which clicks belong to the browser" is a rule react-router
 * already owns. `useHref` + `useLinkClickHandler` are exactly what `Link` itself is built from: the
 * handler preventDefaults and routes a plain left click, and returns untouched on a modified one,
 * so the browser opens the new tab it was asked for.
 *
 * B57.8 — drawn as Pocket's row (pocket.css .nav a): its line icon, the label, and the selected row on cloud.
 */
function NavDestination({
  to,
  label,
  icon,
  active,
  badge,
}: {
  to: string
  label: string
  icon: PocketIconName
  active: boolean
  /** B28.7 — a count beside the label (approvals waiting); nothing is drawn at zero or while unknown. */
  badge?: number | null
}) {
  const href = useHref(to)
  const onClick = useLinkClickHandler<HTMLAnchorElement>(to)
  return (
    <a
      href={href}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex items-center gap-3 rounded-tile px-2.5 py-2 text-body font-semibold',
        active ? 'bg-cloud text-ink' : 'text-ink-2',
        pocketFocusRing,
      )}
    >
      <PocketIcon name={icon} />
      <span className="min-w-0 truncate">{label}</span>
      {badge ? (
        // Your move: what waits for you (pocket.css .nav a .n), in the tangerine that may carry words.
        <span
          data-tangerine="your-move"
          className="ml-auto grid h-5.5 min-w-5.5 place-items-center rounded-pill bg-tangerine-50 px-1.5 font-figure text-caption text-tangerine-ink"
        >
          {badge}
          <span className="sr-only"> waiting</span>
        </span>
      ) : null}
    </a>
  )
}

/** A path owns itself and everything below it; `/` owns only itself. */
const under = (pathname: string, ...paths: string[]) =>
  paths.some((p) => pathname === p || (p !== '/' && pathname.startsWith(`${p}/`)))

function Sidebar() {
  const { pathname } = useLocation()
  const pending = usePendingApprovals()
  // B46.16 — the name sign-up gave the workspace, under the brand.
  const workspace = useQuery({ queryKey: WORKSPACE_NAME_KEY, queryFn: agentBankApi.workspaceName, staleTime: 60_000, retry: false })
  // B55.39 — Lens names a new workspace by its id; the sidebar never shows it.
  const workspaceLabel = !workspace.data?.name || workspace.data.name === workspace.data.id ? 'Your workspace' : workspace.data.name
  // B59.2 — a row for an area this workspace does not have is not drawn.
  const areas = useWorkspaceAreas()
  // B59.10 — the account's type and kind: its chip under the name.
  const account = useAccount()
  const item = (to: string, label: string, icon: PocketIconName, active: boolean, badge?: number | null) =>
    !areas.shows(to) ? null : <NavDestination to={to} label={label} icon={icon} active={active} badge={badge} />
  // B57.8 — Pocket's rows, and no folding groups: every page that left the sidebar is linked from the page it belongs
  // to (Billing links Overview and Ledger, the Marketplace its own pages, Settings the settings), and ⌘K finds every page.
  return (
    <nav className="flex flex-1 flex-col" aria-label="Sections">
      {/* B57.6 — the kit's small drawing at 144 px, light or dark by the theme, to Home. */}
      <Link to="/" aria-label="Talyvor, Home" className={cn('flex self-start rounded-tile px-2 pb-3.5 pt-1', pocketFocusRing)}>
        <Logo width={144} />
      </Link>
      {workspace.isPending ? null : (
        <div className="mb-2.5 flex items-center gap-2.5 rounded-inset bg-cloud p-2.5" data-testid="sidebar-workspace">
          <span aria-hidden="true" className="grid h-8.5 w-8.5 shrink-0 place-items-center rounded-tile bg-cloud-2 font-bold text-ink">
            {workspaceLabel.charAt(0).toUpperCase()}
          </span>
          <div className="grid min-w-0 justify-items-start gap-1">
            <span className="max-w-full truncate text-body font-semibold text-ink" title={workspaceLabel} data-testid="sidebar-workspace-name">
              {workspaceLabel}
            </span>
            {/* B59.10 — the switcher's chip, "Business · Hybrid", once Lens has said which. */}
            {account.account ? (
              <span className="rounded-pill bg-cloud-2 px-2 text-caption text-ink" data-testid="sidebar-account-chip">
                {accountChip(account.account)}
              </span>
            ) : null}
          </div>
        </div>
      )}
      <div className="grid gap-0.5">
        {item('/', 'Home', 'home', pathname === '/')}
        {item('/approvals', 'Approvals', 'approvals', under(pathname, '/approvals', '/approve', '/money/plans'), pending)}
        {item('/agents', 'Agents', 'agents', under(pathname, '/agents'))}
        {item('/cards', 'Cards', 'card', under(pathname, '/cards'))}
        {item('/statements', 'Statements', 'statements', under(pathname, '/statements'))}
        {item('/money/pay', 'Pay', 'payments', under(pathname, '/money/pay'))}
        {item('/money/invoices', 'Invoices', 'invoices', under(pathname, '/money/invoices'))}
        {item('/money/spending', 'Spending', 'spending', under(pathname, '/money/spending', '/money/budgets', '/money/subscriptions', '/money/card'))}
        {item('/chat', 'Chat', 'chat', under(pathname, '/chat'))}
        {item('/rooms', 'Rooms', 'rooms', under(pathname, '/rooms'))}
        {item('/marketplace', 'Marketplace', 'marketplace', under(pathname, '/marketplace'))}
        <div role="separator" className="mx-1.5 my-2.5 h-px bg-line" />
        {item('/scan/reports', 'Scan', 'scan', under(pathname, '/scan'))}
        {item('/track', 'Track and Docs', 'work', under(pathname, '/track', '/docs'))}
        {item('/setup', 'Developers', 'code', under(pathname, '/setup', '/keys', '/spend', '/features'))}
        {item('/billing', 'Billing', 'billing', under(pathname, '/billing', '/plans', '/overview', '/ledger'))}
        {item('/settings', 'Settings', 'settings', under(pathname, '/settings', '/members', '/operator'))}
      </div>
      {/* ── THE POLICIES, AND WHY HERE ────────────────────────────────────────────────
          Both routes have always resolved, and until B28 nothing inside the app linked to them: they
          appeared on the marketing page, the sign-in card and the consent screen — three surfaces a
          signed-in person has already passed and does not return to.

          NOT A PAGE FOOTER: content-heavy routes scroll, so a footer is below the fold on exactly the
          pages where a person is looking at their data. The sidebar is sticky, so this is reachable from
          any route without scrolling. Small and muted after a rule, because they are not destinations you
          visit in the course of work (pocket.css .sidefoot).

          Link, not <a href>: same-tab client-side navigation, and it keeps a real href so the
          link is a link to assistive tech and to a middle-click. */}
      <div className="mt-auto border-t border-line px-2.5 pt-3 text-caption font-normal text-ink-3">
        <Link className={inlineLink} to="/privacy">
          Privacy
        </Link>
        {' · '}
        <Link className={inlineLink} to="/terms">
          Terms
        </Link>
      </div>
    </nav>
  )
}

/** B57.8 — the avatar opens Settings, where Sign out is. The person's initial, from the address they signed in with. */
function Avatar() {
  const me = useAuthMeReader()
  const initial = (me.data?.user?.email ?? '').charAt(0).toUpperCase()
  return (
    <Link
      to="/settings"
      aria-label="Settings and sign out"
      className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-pill bg-cloud-2 text-body font-bold text-ink', pocketFocusRing)}
    >
      {initial || <PocketIcon name="settings" size={18} />}
    </Link>
  )
}

/**
 * B28.135 — the pages the command palette opens: the console's routes by their own titles, so a page cannot be added
 * without the palette finding it. Stripe's two return pages are where Stripe sends a person, not somewhere to go, and
 * the operator's are offered only to someone the BFF's operator gate admits, as in the sidebar.
 */
function palettePages(operator: boolean, shows: (path: string) => boolean): PalettePage[] {
  return CONSOLE_ROUTES.filter(
    (r) =>
      r.path !== '/billing/success' &&
      r.path !== '/billing/cancel' &&
      (operator || !r.path.startsWith('/operator')) &&
      shows(r.path),
  ).map((r) => ({ path: r.path.replace(/\/\*$/, ''), title: r.title }))
}

/** B59.10 — Members is a Business's team; a Personal account is never offered it. Its own component, told only whether
 * the account is Personal, so the account's read re-renders the palette once at most and never the whole shell. */
function Palette({ pages, trigger }: { pages: PalettePage[]; trigger: (open: () => void) => React.ReactNode }) {
  const personal = usePersonal()
  const offered = useMemo(() => (personal ? pages.filter((p) => p.path !== '/members') : pages), [pages, personal])
  return <CommandPalette pages={offered} trigger={trigger} />
}

/** B57.50 — behind the gate: a new workspace's first page in its own layout, and every other address in the console's shell. */
function AppShell() {
  return useLocation().pathname === WELCOME_PATH ? <Welcome /> : <ConsoleShell />
}

function ConsoleShell() {
  const { pathname } = useLocation()
  const operator = useAuthMeReader().data?.operator === true
  // B59.2 — and no page of an area this workspace does not have.
  const areas = useWorkspaceAreas()
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `areas.key` changes exactly when `areas.shows` answers differently
  const pages = useMemo(() => palettePages(operator, areas.shows), [operator, areas.key])
  // ONE expression, two consumers: the page's heading paints it and the browser tab is told it. They
  // cannot drift into naming different pages because there is nothing to drift between —
  // documentTitle.test.tsx asserts the tab's page half IS the heading's string, at every address.
  const page = titleFor(pathname)
  useDocumentTitle(page)
  // B47.2 — Chat has the whole page: the suite's sidebar waits off to the left until Menu asks for it.
  const chat = pathname === '/chat' || pathname.startsWith('/chat/')
  return (
    <>
    {/* B57.50 — an unnamed workspace's first page in a tab is /welcome. */}
    <WelcomeRedirect />
    {/* B57.8 — Pocket's shell: the sidebar, the top bar, the kill banner and the page's heading. B57.9 drew the ⌘K bar;
        Taly and the theme switch are still today's design until B57.159 and B57.42 draw them, and carry their own marker. */}
    <div className="contents" data-design="pocket">
    <PocketShell
      drawer={chat}
      sidebar={<Sidebar />}
      bar={
        <>
          <Palette
            pages={pages}
            trigger={(open) => (
              // pocket.css .top .search: the search that opens ⌘K (B57.9).
              // Below 840 it is the pill and its icon alone, so the bar fits 320; its words stay its name.
              <button
                type="button"
                onClick={open}
                aria-label="Search agents, payees, bills… or type a command"
                aria-keyshortcuts={ariaKeys('palette')}
                className={cn(
                  'flex h-10 min-w-0 flex-1 items-center gap-2 rounded-pill bg-cloud px-3.5 text-left text-body text-ink-3 wide:max-w-md',
                  'transition-colors duration-200 active:scale-98',
                  pocketFocusRing,
                )}
              >
                <PocketIcon name="search" size={16} />
                <span className="hidden min-w-0 flex-1 truncate wide:block">Search agents, payees, bills… or type a command</span>
                <kbd className="hidden rounded-tile bg-page px-1.5 py-1 font-figure text-caption text-ink-3 shadow-edge wide:inline">
                  {shortcutText('palette').replace('Cmd+', '⌘')}
                </kbd>
              </button>
            )}
          />
          <span className="flex-1" />
          <TeamOnly />
          {/* B57.118 — the label, top right on every screen, before Pause every agent (the launch pack's W2 to W5). */}
          <WorkspaceStatus />
          <EveryAgentSwitch />
          <Avatar />
        </>
      }
    >
      {/* B57.8 — while every agent is paused, on every page, with its own Start every agent again. */}
      <KillBanner />
      {/* ABOVE THE CONTENT, ON EVERY ROUTE. When the workspace credential dies, every panel
          below is empty for one reason; this says it once. Renders nothing when nothing is
          refused, so it costs an unbroken app a null. */}
      <SessionExpiredBar />
      {/* B55.54 — a recovery waiting, on every page for everyone in the workspace, and a recovery code Lens answered,
          shown once wherever the key was made. */}
      <KeyRecoveryNotice />
      <RecoveryCodeSheet />
      {/* THE ONE HEADING ON A GATED SCREEN. It is the same computed `page` the tab title takes, so
          the browser tab and the heading are one answer rather than two that agree today.
          ConsoleHeading.test.tsx pins the name at every address. B57.8 — Pocket sets it at the top of
          the content as the page's heading; Chat keeps the whole page, so there it is for a screen
          reader only. */}
      <PageHeading className={pathname === '/chat' ? 'sr-only' : 'mb-4.5'}>{page}</PageHeading>
      {/* B27.12 — a screen that throws while drawing shows "couldn't be read" here, with the shell
          still standing. Try again drops the failed screen's cached reads and asks for them anew. */}
      <ScreenBoundary address={pathname} onRetry={() => void queryClient.resetQueries({ type: 'inactive' })}>
        <div className="contents" data-design={designOf(pathname, ROUTE_PATHS)}>
        <Routes>
          {/* EVERY ROUTE COMES FROM CONSOLE_ROUTES, which is also what titles the page. A page
              declared here and nowhere else would be a page the heading cannot name — that was
              the state this table replaced. */}
          {CONSOLE_ROUTES.map((r) => (
            <Route key={r.path} path={r.path} element={<AreaRoute path={r.path}>{r.element}</AreaRoute>} />
          ))}
          {/* B28.10 — a retired address that still has somewhere to go. Not in CONSOLE_ROUTES for
              the catch-all's reason: a redirect is not a page, so it has no title of its own. */}
          <Route path="/earnings" element={<EarningsMoved />} />
          {/* A catch-all, added when /admin was removed. Before it, an unmatched in-app path
              rendered the shell with an EMPTY content area and no explanation — so an
              operator's /admin bookmark would have shown a blank page. A silent blank is the
              same failure class as an invented number: the page says nothing true about what
              happened. This covers every mistyped or retired path, not just that one.
              ⚠ It is NOT in CONSOLE_ROUTES: it is the absence of a page, and putting it there
              would make "no page" a page with a name, which is the lie this replaced. */}
          <Route
            path="*"
            element={
              // B57.5 — drawn in Pocket: its empty state, and the one way on.
              <div data-design="pocket" className="mx-auto max-w-3xl px-gutter py-4">
                <EmptyState
                  icon={
                    <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth={1.9} strokeLinecap="round">
                      <circle cx="11" cy="11" r="6" />
                      <path d="m20 20-4.5-4.5" />
                    </svg>
                  }
                  title="Nothing at this address"
                  line="There is no page here: pick a section from the sidebar."
                  action={
                    <PocketButton asChild size="sm" variant="secondary">
                      <Link to="/">Go to Home</Link>
                    </PocketButton>
                  }
                />
              </div>
            }
          />
        </Routes>
        </div>
      </ScreenBoundary>
      {/* B59.28 — Help and complaints, Close this account and Your data at the foot of every page; Chat has the whole page. */}
      {chat ? null : <SignedInFooter />}
      {/* B45.6 — Taly, on every signed-in page, told which page it is on. Today's design until B57.159. */}
      {/* B59.2 — Taly goes with Chat. */}
      <IfArea area="chat">
        <div className="contents" data-design="today">
          <TalyButton page={page} path={pathname} />
        </div>
      </IfArea>
      {/* B57.5 — the confirmation after an action, shown once on the next view, and the short messages. */}
      <SnackHost view={pathname} />
      {/* B57.15 — the approval sheet, over whichever page ?approval=<id> (or /approvals#approval-<id>) is on. */}
      <ApprovalSheetHost />
    </PocketShell>
    </div>
    </>
  )
}

/**
 * B57.3 — the public pages' paths, exactly as the `<Route path>`s in App() below declare them
 * (pocketPending.test.tsx reads that block and fails if the two differ).
 */
const PUBLIC_PATHS = [
  '/marketing/*', '/pricing', '/your-money', DOCUMENTATION_PATH, CLAUDE_CONNECTOR_PATH, '/privacy', '/terms', '/signup', '/signup/key', '/signin',
  '/board/:token', '/share/:token', '/pay/:token', '/docs/s/:token',
]

/** Every path the app routes, public and console, and the retired /earnings address. */
export const ROUTE_PATHS: readonly string[] = [...PUBLIC_PATHS, ...CONSOLE_ROUTES.map((r) => r.path), '/earnings']

/**
 * B57.3 — every page says which design it is held to, `data-design="pocket"` or "today", from
 * pocketPending.ts. The audits read it. `display: contents`, so it draws nothing.
 */
function DesignScope({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation()
  return (
    <div className="contents" data-design={designOf(pathname, ROUTE_PATHS)}>
      {children}
    </div>
  )
}

/**
 * ⚠ THE ONE THING A REAL NAVIGATION DID FOR FREE, AND CLIENT-SIDE ROUTING DOES NOT.
 *
 * A browser puts a newly loaded document at the top. Replacing page loads with in-app
 * navigation replaced that too, with nothing: the scroll offset of the page you left was
 * carried into the page you asked for. MEASURED IN CHROME ON THE BUILT ARTIFACT, the same
 * pair of pages from the same offset, differing only in how the navigation was made:
 *
 *     /terms at y=900  --full page load-->    /privacy   y = 0
 *     /terms at y=900  --click the link-->    /privacy   y = 900   (its maximum is 1881, so
 *                                                                   900 was carried, not clamped)
 *
 * and from the tallest gated address, /setup at its bottom, both /settings and /privacy opened
 * at their LAST line. See scrollReset.test.tsx for the full rows.
 *
 * ⚠ ON PUSH AND REPLACE ONLY — POP IS THE BROWSER'S AND IT ALREADY DOES IT RIGHT.
 * `history.scrollRestoration` is `auto` and, measured in the same session, back and forward
 * restore the offsets of these client-side entries exactly (900 and 300). A scroll-to-top on
 * every location change would break the half that works: the back button would drop a reader
 * at the top of a page they had read most of. A first mount is a POP too, so a deep link and a
 * reload are left alone as well.
 *
 * Layout effect, not effect: the reset happens before paint, so there is no frame in which the
 * new page is shown scrolled. `theme.css` never sets `scroll-behavior: smooth`, so this is an
 * instant jump rather than an animation the reader watches.
 */
function ScrollToTopOnPush() {
  const { pathname } = useLocation()
  const navigationType = useNavigationType()
  useLayoutEffect(() => {
    if (navigationType === 'POP') return
    window.scrollTo(0, 0)
  }, [pathname, navigationType])
  return null
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppMoney>
      <BrowserRouter>
        {/* ABOVE `<Routes>`, NOT INSIDE THE CONSOLE'S SHELL. The legal pages, the two front
            doors and the marketing landing are siblings of the gate, not children of it — a
            reset mounted in `AppShell` would be correct on all twelve gated addresses and
            absent from every page a stranger sees. */}
        <ScrollToTopOnPush />
        {/* B44.2 — the cookie banner and Meta pixel; it renders nothing off the public pages. */}
        <MetaPixel />
        <DesignScope>
          <Routes>
            {/* Public marketing landing — OUTSIDE the AuthGate by design. */}
            <Route path="/marketing/*" element={<Landing />} />
            {/* B5.2 — the price list, public for the same reason: a buyer reads it before signing up. */}
            <Route path="/pricing" element={<Pricing />} />
            {/* B57.62 — how your money is held, public for the same reason: a buyer reads it before signing up. */}
            <Route path="/your-money" element={<YourMoney />} />
            {/* B27.31 — what the product does, each claim linked to its screen. Public for the same
                reason as the price list. Not /docs: that is the Docs product, behind the gate. */}
            <Route path={DOCUMENTATION_PATH} element={<Documentation />} />
            {/* B40.20 — the Claude connector's page, which Claude's directory links to. Public for the same reason. */}
            <Route path={CLAUDE_CONNECTOR_PATH} element={<ClaudeConnector />} />
            {/* Legal pages are public for the same reason: someone deciding whether to sign up must
                be able to read what the service does with their data BEFORE creating an account.
                Putting these behind the gate would mean you had to agree in order to read. */}
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/terms" element={<Terms />} />
            {/* The two front doors, also OUTSIDE the gate — a signup page you must already be
                signed in to read is not a signup page. Same mechanism (/auth/login), different
                words: see areas/auth/Entry.tsx. */}
            <Route path="/signup" element={<SignUp />} />
            {/* B59.8 — sign-up's step 3, where the identity provider sends a new workspace: a passkey or the phone. */}
            <Route path="/signup/key" element={<SignUpKey />} />
            <Route path="/signin" element={<SignIn />} />
            {/* B27.30 — a Track board its workspace published as a link, read by anyone holding it.
                Outside the gate: the reader has no account. Read-only — see areas/board/PublicBoard.tsx. */}
            <Route path="/board/:token" element={<PublicBoard />} />
            {/* B28.127 — a chat its person shared as a link, read by anyone holding it until it is turned off.
                Outside the gate for the same reason. Read-only — see areas/share/SharedChat.tsx. */}
            <Route path="/share/:token" element={<SharedChat />} />
            {/* B30.97 — an invoice's pay page, opened by whoever holds its link. Outside the gate: the payer has no
                account here. See areas/pay/PayInvoice.tsx. */}
            <Route path="/pay/:token" element={<PayInvoicePage />} />
            {/* B28.447 — a Docs page its admin shared as a link, read by anyone holding it. Outside the gate for the same
                reason. Read-only — see areas/share/SharedDocsPage.tsx. */}
            <Route path="/docs/s/:token" element={<SharedDocsPage />} />
            <Route
              path="/*"
              element={
                <AuthGate>
                  <AppShell />
                </AuthGate>
              }
            />
          </Routes>
        </DesignScope>
      </BrowserRouter>
      </AppMoney>
    </QueryClientProvider>
  )
}
