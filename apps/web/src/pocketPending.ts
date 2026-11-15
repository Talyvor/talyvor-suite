import { matchRoutes } from 'react-router-dom'

/**
 * B57.3 — THE ROUTES STILL DRAWN IN TODAY'S DESIGN. This list only shrinks.
 *
 * The design guards (figureAudit, eyebrowAudit, planeAudit, fieldFaceAudit and the four brand
 * tests) hold every screen to Pocket's rules, except on the routes named here, which are still
 * held to today's. So no guard is switched off while screens move over: each B57 item that
 * redraws a screen takes its routes out of this list in the same merge, and B57.88 fails while
 * the list names anything.
 *
 * Entries are exactly the strings `<Route path>` receives (App.tsx's PUBLIC_ROUTES and
 * CONSOLE_ROUTES), plus '/earnings' (the redirect to Royalties) and '*', the page an address with
 * no route shows. pocketPending.test.ts fails on an entry that is not a route.
 *
 * A new page is added here when it is built in today's design (Pocket rule 9), and taken out by
 * the item that draws it in Pocket.
 */
export const POCKET_PENDING: readonly string[] = [
  // The public pages.
  '/board/:token',
  '/share/:token',
  '/docs/s/:token',
  // The console.
  '/statements',
  '/overview',
  '/ledger',
  '/statements/royalties',
  '/chat',
  '/chat/help',
  '/chat/compare',
  '/chat/instructions',
  '/chat/prompts',
  '/chat/scheduled',
  '/chat/memory',
  '/chat/files',
  '/chat/connectors',
  '/rooms/*',
  '/billing',
  '/plans',
  '/billing/success',
  '/billing/cancel',
  // B57.20 draws the agent's page above today's view, which stays under it until B57.21 and B57.22 redraw the rest.
  // B57.23 draws /agents/:id/rules.
  '/agents/:id',
  '/marketplace/*',
  '/spend',
  '/settings/payout-details',
  '/money/invoices',
  '/money/subscriptions',
  '/money/budgets',
  '/scan/reports',
  '/scan/reports/:id',
  '/scan/agents',
  '/scan/track-record',
  '/money/spending',
  '/features',
  '/features/try/tare',
  '/features/try/conversion',
  '/track/*',
  '/docs/*',
  '/operator',
  '/operator/tax',
  '/operator/compliance',
  '/earnings',
  '*',
]

/** The attribute App.tsx sets around every page, and its two values. */
export const DESIGN_ATTR = 'data-design'
export type Design = 'pocket' | 'today'

/**
 * Which design an address is held to. `routes` is every path the app routes; an address that
 * matches none of them is the '*' page. Matching uses react-router's own ranking, so '/docs/s/x'
 * is the shared Docs page and not '/docs/*'.
 */
export function designOf(pathname: string, routes: readonly string[], pending: readonly string[] = POCKET_PENDING): Design {
  const matches = matchRoutes(
    routes.map((path) => ({ path })),
    pathname,
  )
  const route = matches?.[matches.length - 1]?.route.path ?? '*'
  return pending.includes(route) ? 'today' : 'pocket'
}

/**
 * Is this element on a page held to Pocket's rules? A screen rendered without App (most unit
 * tests) has no marker and is held to today's, the same as a pending route. A screen that is drawn
 * in Pocket can put `data-design="pocket"` on its own root so its unit tests hold it to Pocket's.
 */
export function inPocket(el: Element | null): boolean {
  return el?.closest(`[${DESIGN_ATTR}]`)?.getAttribute(DESIGN_ATTR) === 'pocket'
}
