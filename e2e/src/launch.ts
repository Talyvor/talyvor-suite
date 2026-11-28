// B61.1 — THE LAUNCH VERSION. Every scenario the testers can play names its area here, in one place: the map below. With
// E2E_LAUNCH=1 (scripts/e2e-nightly.sh sets it unless the settings file says otherwise) a run plays only the scenarios
// whose area is in the launch version (LAUNCH-PACK.md section 1) and leaves out the rest (section 2, and the LXC plans and
// credit top-ups). The night's run, the light pass, the deep pass and the Pocket problems pass all keep to the one list.
// A scenario left out is never played: it has no verdict, so it is never counted as passed and nothing is filed for it,
// and the report names it under "Launch version: N played, M left out". No scenario is deleted.
//
// The coverage map keeps to the launch version too: a screen, BFF route or Lens route of a hidden area is not counted.
// Which addresses are hidden is read from the code that hides them (B59.1, B59.2) — the web app's areaOfPath, the BFF's
// areaRoutes and Lens's internal/areas — never kept here; Track and Docs are hidden areas whole.
//
// A new scenario must be placed: a scenario missing from the map fails test/launch.test.ts.

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Inventory } from './coverage.ts'
import type { CatalogModel } from './oracles.ts'
import type { Scenario } from './scenarios.ts'

/** LAUNCH-PACK.md section 1, the launch version: these are played. */
export const LAUNCH_AREAS = [
  'sign-in', // sign-up, sign-in, passkeys, phone pairing, verification and the session
  'agents', // an account for each agent and its rules: limits, payees, pause, archive
  'wallets', // balances, top-up, withdraw, convert, and the ledger under them
  'cards', // owner and agent cards: issue, freeze, purchase
  'payments', // payments, payees, approvals, mandates, invoices and bills
  'instant-transfer',
  'activity', // activity, statements, exports, spending and notifications
  'connector', // the Claude connector (Talyvor Connect)
  'settings', // members, API keys and the other settings
  'support',
  'legal',
  'sandbox-label',
  'home', // Home and the app shell around every launch screen
  'website', // the public site: its pages, its brand and the company plans' prices
  'plans', // our plans, the two ladders (Solo, Crew, Fleet; Studio, Company, Group, Custom), and their agent limits
] as const

/** LAUNCH-PACK.md section 2, hidden from users (the web app's, the BFF's and Lens's area names), and the LXC plans and credit top-ups. */
export const LEFT_OUT_AREAS = [
  'marketplace', 'rooms', 'chat', 'track', 'docs', 'code', 'edge', 'scan', 'gateway', 'trading', 'credit', 'interest',
  'lxc-plans', 'credit-top-up',
] as const

export type Area = (typeof LAUNCH_AREAS)[number] | (typeof LEFT_OUT_AREAS)[number]

/** Every scenario the testers can play, by its area. A scenario is in exactly one. */
export const SCENARIO_AREAS: Record<Area, readonly string[]> = {
  'sign-in': [
    'csrf-every-write', 'csrf-refused', 'device-key-approval', 'device-keys-bff', 'passkey-enrol-signed', 'passkey-recovery', 'phone-bearer',
    'phone-key-web', 'session-sign-out', 'signin-board', 'verification-levels', 'verification-screen', 'wallet-onboarding', 'identity-gate',
    'pocket-01', 'pocket-11', 'pocket-22', 'door-join', 'door-passcode', 'door-passkey', 'door-wrong-passcode',
    'door-phone-lock', 'door-security', 'door-wait',
  ],
  agents: [
    'agent-archive', 'agent-hourly-limit', 'agent-limit', 'agent-limit-boost', 'agent-model-limit', 'agent-open-fund',
    'agent-pause-all', 'agent-payee-daily-cap', 'agent-payee-lists', 'agent-request-rate', 'agent-resume-signed',
    'agent-rule-simulator', 'agent-rule-template', 'agent-rules-rollback', 'agent-rules-unbypassable', 'agent-wallets-empty',
    'first-agent', 'kya-credential', 'mcp-body-bounded', 'request-body-bounded', 'sdk-wallet-quickstart', 'pocket-02', 'pocket-09', 'pocket-10',
    'phone-widget-pause', 'phone-stop-everything',
  ],
  wallets: [
    'agent-balance-stored', 'agent-funding', 'agent-crypto-spend-permission', 'agent-crypto-wallet', 'agent-wallet', 'agent-wallet-kinds', 'b30-capabilities', 'capability-terms', 'currency-convert-margin',
    'daily-reconciliation', 'ledger-call-once', 'ledger-moves-at-once', 'money-accounts', 'money-layer-contract', 'openapi-wallets', 'status-money-rails',
    'status-truth', 'terms-credential-screens', 'wallet-brand', 'wallet-cash-out', 'wallet-currency', 'wallet-fx', 'wallet-pots', 'pocket-20',
  ],
  cards: ['agent-card-replace', 'agent-cards', 'card-dispute-screen', 'physical-card', 'single-use-card-screen', 'wallet-card', 'wallet-card-freeze', 'wallet-card-purchase'],
  payments: [
    'agent-approval', 'agent-approval-denied', 'agent-approval-push', 'approval-own-request', 'approval-reused', 'approval-stopped-payee', 'approvals-badge',
    'approvals-inbox', 'approve-always-allow', 'batch-approval-pays-once', 'bills-duplicate-changed-details', 'bills-inbox',
    'bills-pay-all-due', 'compliance', 'invoice-pay-link', 'invoices-screen', 'mcp-pay-retried-once', 'mcp-sdk-agent-pay',
    'monitoring', 'money-tampered', 'outside-payees', 'pay-screen', 'pay-payee-by-name', 'pay-saved-payee-by-name', 'payee-cooling-off', 'payee-details-lock', 'payment-request-batch', 'payments-out', 'bulk-payouts', 'money-mandates', 'standing-orders', 'agent-allowances', 'agent-card-account',
    'permission-mandate', 'screening-travel-rule', 'second-approver', 'subscriptions-view', 'trust-layer', 'wallet-give-back', 'wallet-handle-pause',
    'wallet-recurring', 'wallet-request', 'wallet-request-keyed', 'wallet-requests-answered', 'wallet-schedule-topup-pot', 'wallet-send-refund',
    'xss-shown-back', 'pocket-03', 'pocket-04', 'pocket-05', 'pocket-06', 'pocket-08', 'pocket-13', 'pocket-15', 'pocket-16',
    'pocket-17', 'phone-approve', 'phone-pay-payee',
  ],
  'instant-transfer': ['instant-transfer-offered', 'instant-transfer-quote', 'instant-transfer-send'],
  activity: [
    'account-statements', 'agent-analytics', 'agent-analytics-lens', 'alert-channels', 'budgets-by-category', 'coach-week', 'daily-briefing',
    'ledger-reads-correctly', 'limit-alerts', 'low-balance-alert', 'month-plan', 'spend-notice-push', 'spending-screen', 'statement-journal', 'statement-journal-lens',
    'statement-line-kinds', 'statement-paging', 'statement-pdf', 'statement-pdf-lens', 'statement-reconciles', 'statement-search', 'wallet-statements', 'pocket-21',
    'pocket-23', 'pocket-24', 'pocket-25',
  ],
  connector: ['connect-approve', 'connect-contact', 'connect-mcp', 'connect-oauth', 'connect-pay', 'connect-recurring'],
  settings: [
    'api-key-revoke', 'console-screens-draw', 'keys-unlisted', 'operator-compliance-boundary', 'seats-company', 'seats-studio', 'workspace-roles', 'workspace-roles-lens',
    'phone-team-roles', 'second-approver-picker',
  ],
  support: ['help-complaint', 'help-no-dead-control', 'help-request', 'your-data-request'],
  legal: ['legal-pages-whole'],
  'sandbox-label': ['sandbox-label-every-screen'],
  home: [
    'agent-runs-out-date', 'app-shell', 'brand-planes', 'every-screen', 'home-cards', 'home-daily-briefing', 'one-search',
    'sidebar-unnamed-workspace', 'wallet-first-nav', 'wallet-home', 'pocket-07',
  ],
  website: [
    'brand-icons', 'brand-logo', 'brand-visual', 'company-line', 'hero-fade', 'honest-pages', 'marketing-board', 'pricing-approved',
    'pricing-board', 'pricing-truth', 'reading-pages', 'site-truth', 'social-preview', 'waitlist-join', 'wallet-docs', 'wallet-hero',
  ],
  plans: ['billing-return-pages', 'plan-agents-company', 'plan-agents-group', 'plan-change', 'plan-personal', 'plan-solo-free-exchange', 'pricing-studio-agents'],

  marketplace: [
    'buyer-protection', 'buyer-tax-profile', 'company-payment', 'lineage', 'market-abuse', 'market-agent-commitment',
    'market-agent-mcp', 'market-ask-screen', 'market-bill-invoices', 'market-bill-refund', 'market-bill-tax', 'market-brand',
    'market-buyer-currency', 'market-compare-screen', 'market-content-filter', 'market-discover-screen', 'market-discovery',
    'market-earnings-payout', 'market-held-seller', 'market-journal', 'market-listing-as-model', 'market-offers', 'market-payout',
    'market-payout-connect', 'market-privacy-label', 'market-receipts', 'market-remix-licence', 'market-rent', 'market-review',
    'market-takedown', 'market-trial', 'market-trust', 'market-versions', 'marketplace-sale', 'platform-report',
    'pricing-seller-split', 'self-billed-invoice', 'seller-tax-details', 'seller-week-statement', 'tax-and-payouts',
    'wallet-escrow', 'wallet-escrow-lens', 'pocket-14',
  ],
  rooms: [
    'room-agent-mcp', 'room-contribution-record', 'room-contributions', 'room-decide-run', 'room-earnings-payout', 'room-from-issue',
    'room-invite-limits', 'room-invite-screen', 'room-messages', 'room-objections', 'room-points', 'room-prizes', 'room-rate-card',
    'room-reviews', 'room-runs', 'room-shared-ownership', 'room-spec', 'room-takeover', 'room-tasks', 'room-wallet',
    'rooms-moderation', 'rooms-private', 'pocket-12', 'pocket-18',
  ],
  chat: [
    'agent-spend-question', 'blank-retry-cut-off', 'charged-after-hang-up', 'chat-agent-task', 'chat-answer-versions', 'chat-approval-face-id',
    'chat-ask-above', 'chat-auto', 'chat-brand', 'chat-budget', 'chat-canvas', 'chat-card-freeze', 'chat-charged', 'chat-cheaper',
    'chat-compare-models', 'chat-connectors', 'chat-continue-cut-off', 'chat-custom-instructions', 'chat-docs-page',
    'chat-edit-resend', 'chat-export-import', 'chat-feature-spend', 'chat-file-bug', 'chat-files', 'chat-first-message',
    'chat-forecast-answer', 'chat-help-in-full', 'chat-history-sync', 'chat-launch-agent', 'chat-listing', 'chat-live-statement',
    'chat-memory', 'chat-meter', 'chat-money-requests', 'chat-paid-by', 'chat-payment-card', 'chat-pinned-survives-reload',
    'chat-plain-rule', 'chat-pool-off', 'chat-project-instructions', 'chat-prompt-library', 'chat-recent-calls', 'chat-rich-answer',
    'chat-run-code', 'chat-safe-to-spend', 'chat-savings', 'chat-scheduled-prompt', 'chat-share-link', 'chat-sidebar-hidden',
    'chat-statement', 'chat-temporary', 'chat-tool-guard', 'chat-total', 'chat-track-issue', 'chat-wallet-alerts',
    'chat-wallet-buttons', 'chat-web-search', 'command-palette', 'cost-preview', 'document-in-chat', 'image-in-chat',
    'injection-exfil', 'injection-exfil-room-message', 'injection-exfil-web-page', 'pdf-dropped-in-chat', 'refusal-reasons',
    'repeat-new-chat', 'script-inert', 'search-among-500', 'sent-before-identity', 'sidebar-stays-hidden', 'stopped-then-answers',
    'streaming', 'taly-button', 'taly-intro', 'voice-chat-mic', 'voice-chat-pay', 'wrong-answer-stored', 'pocket-19',
  ],
  track: [
    'track-ai', 'track-assign-email', 'track-enter', 'track-export', 'track-project', 'track-search-cycle-board',
    'track-webhook-signed', 'track-workspace-restore',
    'screens-brand', // Features, Track, Docs, Developers, Billing and Settings: Features, Track and Docs are hidden
  ],
  docs: ['brand-docs', 'docs-ai', 'docs-approval-email', 'docs-share-collab', 'docs-team-grant', 'docs-tools', 'docs-webhook-signed'],
  code: [],
  edge: [],
  scan: ['scan-agents', 'scan-report'],
  // The old gateway: priced answers, the cache and the pool, routing, the model catalog, Tare, guardrails, stored
  // answers, Lens's own settings and the LENS token.
  gateway: [
    'across-accounts', 'brand-roi', 'budget-ids-validated', 'byok-addon', 'capital', 'every-model', 'features-switches', 'features-wallets-first',
    'file-bomb-bounded', 'follow-up-not-cached', 'gateway-auth', 'gateway-keys', 'gateway-mcp', 'gateway-providers',
    'gateway-sessions', 'injection-blocked', 'keys-not-forwarded', 'known-answer', 'lens-convert', 'lens-reads', 'lens-tokens',
    'lxc-convert-bonds', 'named-ids-isolated', 'nodes', 'one-digit-trap', 'outputs-attribution', 'pattern-mining-switch',
    'personal-data-not-pooled', 'pool-isolation', 'pooled-royalty', 'povi', 'pricing-fee-company', 'pricing-fee-group',
    'pricing-fee-studio', 'pricing-own-key', 'provider-key-hidden', 'provider-keys', 'rate-limits-hold', 'rate-limits-redis-down', 'rephrase-same-account', 'royalties-not-headline',
    'settings-config-budgets', 'settings-guardrails', 'settings-operator-only', 'settings-prompts', 'settings-stored-answers',
    'settings-switches', 'settings-tare-distill', 'speech-through-lens', 'spend-plain-words', 'spend-platform-fee',
    'spending-limit', 'ssrf-refused', 'stream-outlives-30s', 'tare-model', 'tare-training', 'try-conversion', 'try-tare', 'workspace-limits-raised',
    'evals',
  ],
  trading: ['wallet-trading-sim'],
  credit: ['cross-company-test-money', 'wallet-loan', 'wallet-loan-default', 'wallet-loan-repay', 'wallet-loans-answered'],
  interest: [],
  'lxc-plans': ['plan-cancel-resume', 'plan-test-card', 'plans-earn-sentence', 'plans-included-usage'],
  'credit-top-up': ['credits-top-up', 'webhook-replayed', 'webhook-unsigned'],
}

/** Why a launch-area scenario a launch run cannot play is left out of it (B61.63): each by name, once. */
const NEEDS_A_MODEL = 'its agent asks a model, through the old gateway, which the launch version hides (a launch run reads no catalog, B61.49)'
const NEEDS_STRIPE_FORM = 'it waits for Stripe’s hosted card form (#cardNumber), which the launch run of 15 Nov 15:07Z never drew'
const LEDGER_PARKED = 'it reads the Ledger page (ledger-balance), which the launch version hides while LXC is parked (B61.17)'
/**
 * B61.86 — its steps press or read an LXC control or figure that B61.14 took off every launch account: the agent page's
 * credit rows (Send or request, Requests, Transfers, Recurring transfer, Pots, Escrow, Cash out, Automatic top-up) are the
 * parked gateway's, and Home and Agents name no LXC total. Found by playing the launch self-test against that web.
 * B17.495 — statement-paging reads an agent's credit statement, which B61.55 took off the agent page and Statements.
 * B17.548 — statement-pdf and statement-journal download one agent's credit statement for a period from that same card, and
 * wallet-fx reads an agent's credit balance in pounds and euros, which no launch screen draws since B61.55.
 */
export const LXC_PARKED = 'LXC is parked: its steps need an LXC control or figure B61.14 took off every launch screen'
const NO_HERO_PHOTO = 'it measures the homepage hero photograph’s fade, and the homepage has had no photograph since B57.60 (Pocket’s hero, the approval sheet’s picture)'
export const LAUNCH_CANNOT_PLAY: Readonly<Record<string, string>> = {
  'ledger-reads-correctly': LEDGER_PARKED,
  'hero-fade': NO_HERO_PHOTO,
  ...Object.fromEntries([
    'agent-analytics', 'agent-archive', 'agent-hourly-limit', 'agent-limit', 'agent-limit-boost', 'agent-model-limit', 'agent-pause-all',
    'agent-request-rate', 'agent-rules-unbypassable', 'first-agent', 'keys-unlisted', 'ledger-call-once', 'ledger-moves-at-once',
    'sdk-wallet-quickstart', 'statement-reconciles', 'wallet-currency', 'wallet-home', 'wallet-onboarding',
  ].map((id) => [id, NEEDS_A_MODEL])),
  ...Object.fromEntries([
    'agent-approval', 'agent-approval-push', 'agent-payee-daily-cap', 'agent-payee-lists', 'agent-runs-out-date', 'approvals-badge',
    'approvals-inbox', 'approve-always-allow', 'home-daily-briefing', 'statement-journal', 'statement-line-kinds', 'statement-paging',
    'statement-pdf', 'wallet-cash-out', 'wallet-fx', 'wallet-give-back', 'wallet-pots', 'wallet-recurring', 'wallet-request',
    'wallet-send-refund',
  ].map((id) => [id, LXC_PARKED])),
  ...Object.fromEntries([
    'agent-cards', 'agent-wallet-kinds', 'batch-approval-pays-once', 'coach-week', 'invoices-screen', 'money-layer-contract', 'pay-screen',
    'pocket-10', 'wallet-statements',
  ].map((id) => [id, NEEDS_STRIPE_FORM])),
}

const AREA_OF = new Map(Object.entries(SCENARIO_AREAS).flatMap(([area, ids]) => ids.map((id) => [id, area as Area] as const)))
const LAUNCH = new Set<Area>(LAUNCH_AREAS)

/** The area a scenario is in, or undefined when the map does not place it. */
export const areaOf = (id: string): Area | undefined => AREA_OF.get(id)

/**
 * Whether a scenario is played in the launch version. One the map does not place is played: nothing is left out unseen.
 * One a launch run cannot play (LAUNCH_CANNOT_PLAY) is left out with its reason, never left to time out.
 */
export const inLaunch = (id: string): boolean => {
  const area = AREA_OF.get(id)
  return (area === undefined || LAUNCH.has(area)) && !(id in LAUNCH_CANNOT_PLAY)
}

/** What a launch run leaves out: the scenarios not played, by id, once each. */
export interface LaunchCut {
  played: number
  left_out: string[]
  /** B61.56 — of the run's explorers, how many took a step on the launch pages; absent until they have run. */
  explorers?: { explored: number; of: number }
}

/** Each journey with the scenarios outside the launch version taken out, and what that played and left out. */
export function launchCut(journeys: readonly Scenario[][]): { journeys: Scenario[][]; cut: LaunchCut } {
  const played = new Set<string>()
  const left = new Set<string>()
  const kept = journeys.map((j) => j.filter((s) => {
    const keep = inLaunch(s.id)
    ;(keep ? played : left).add(s.id)
    return keep
  }))
  return { journeys: kept, cut: { played: played.size, left_out: [...left].sort() } }
}

/** The report's and TESTERS.md's line. */
export function launchLine(cut: LaunchCut): string {
  const why = (id: string) => (id in LAUNCH_CANNOT_PLAY ? `: ${LAUNCH_CANNOT_PLAY[id]}` : '')
  const parked = cut.left_out.filter((id) => LAUNCH_CANNOT_PLAY[id] === LXC_PARKED).length
  return `Launch version: ${cut.played} played, ${cut.left_out.length} left out` + (parked === 0 ? '' : `, ${parked} of them because LXC is parked`) +
    (cut.left_out.length === 0 ? '' : ` (${cut.left_out.map((id) => `\`${id}\`${why(id)}`).join(', ')})`) +
    (cut.explorers === undefined ? '' : `; ${cut.explorers.explored} of ${cut.explorers.of} explorers explored the launch pages`)
}

// ── THE COVERAGE MAP, LAUNCH SCREENS AND ROUTES ONLY ────────────────────────────────────────────────

/** The addresses the launch version hides, as each layer's own code lists them. */
export interface HiddenPaths {
  /** The web app's AREA_PATHS (apps/web/src/lib/workspaceAreas.tsx). */
  screens: string[]
  /** The BFF's areaRoutes and agentAreaRoutes (apps/bff/areas.go). */
  bff: string[]
  bffAgentSegments: string[]
  /** Lens's routes (internal/areas/areas.go), each parameter written {}. */
  lens: string[]
}

/** Reads the hidden addresses from the web app's and the BFF's source and Lens's checkout. A list it cannot read is empty. */
export async function hiddenPaths(repo: string, lensSrc: string): Promise<HiddenPaths> {
  const read = (path: string): Promise<string> => readFile(path, 'utf8').catch(() => '')
  const [web, bff, lens] = await Promise.all([
    read(join(repo, 'apps/web/src/lib/workspaceAreas.tsx')), read(join(repo, 'apps/bff/areas.go')),
    lensSrc === 'none' ? Promise.resolve('') : read(join(lensSrc, 'internal/areas/areas.go')),
  ])
  return hiddenPathsFrom(web, bff, lens)
}

export function hiddenPathsFrom(web: string, bff: string, lens: string): HiddenPaths {
  const all = (src: string, re: RegExp): string[] => [...src.matchAll(re)].map((m) => m[1])
  // From the declaration to the line that is only its closing brace (a struct's own "}{" is not it).
  const block = (src: string, start: string): string => {
    const at = src.indexOf(start)
    if (at < 0) return ''
    const end = src.indexOf('\n}\n', at)
    return src.slice(at, end < 0 ? undefined : end)
  }
  return {
    screens: all(web, /\{\s*path:\s*'([^']+)',\s*area:\s*'[^']+'\s*\}/g),
    bff: all(block(bff, 'var areaRoutes'), /\{"([^"]+)",\s*"[^"]+"\}/g),
    bffAgentSegments: all(block(bff, 'var agentAreaRoutes'), /"([^"]+)":\s*"[^"]+"/g),
    lens: all(block(lens, 'var routes'), /\{"([^"]+)",\s*\w+\}/g),
  }
}

const params = (p: string): string => p.replace(/\{[^}]*\}|:\w+/g, '{}')
const under = (path: string, prefix: string): boolean => path === prefix || path.startsWith(`${prefix}/`)

/** The BFF's areaOfPath (apps/bff/areas.go), for a registered pattern. */
function bffHidden(path: string, h: HiddenPaths): boolean {
  const agent = path.startsWith('/api/agents/') ? path.slice('/api/agents/'.length).split('/') : []
  if (agent.slice(0, 2).some((seg) => h.bffAgentSegments.includes(seg))) return true
  return h.bff.some((p) => (p.endsWith('/') ? path.startsWith(p) : under(path, p) || path.startsWith(`${p}-`)))
}

/** B61.56 — whether the web app hides a screen's address (its AREA_PATHS), the address's query and fragment aside. */
export function hiddenScreen(path: string, h: HiddenPaths): boolean {
  const at = path.split(/[?#]/)[0].replace(/(.)\/$/, '$1')
  return h.screens.some((p) => under(at, p))
}

/** The inventory with every hidden screen and route taken out, Track's and Docs' routes with it. */
export function launchInventory(inv: Inventory, h: HiddenPaths): Inventory {
  const why = 'left out: Track and Docs are not in the launch version'
  return {
    ...inv,
    screens: inv.screens.filter((e) => !h.screens.some((p) => under(e.path.replace(/\/\*$/, ''), p))),
    bff: inv.bff.filter((e) => !bffHidden(e.path, h)),
    lens: inv.lens.filter((e) => !h.lens.some((p) => under(params(e.path), p))),
    track: [],
    docs: [],
    trackMissing: why,
    docsMissing: why,
  }
}

// ── THE RUN'S SET-UP ────────────────────────────────────────────────────────────────────────────────

/**
 * B61.49 — the model catalog the run's set-up reads, and the model it must hold. The catalog is the old gateway's (Lens
 * internal/areas: /v1/catalog), which a launch workspace does not have, so a launch run never asks for it and goes on with
 * none: a launch scenario that still needs a model's price fails itself on it. Any other run reads it as before.
 */
export async function setUpCatalog(launch: boolean, read: () => Promise<CatalogModel[]>, model: string): Promise<CatalogModel[]> {
  if (launch) return []
  const catalog = await read()
  if (!catalog.some((m) => m.display_name === model)) throw new Error(`the catalog has no model named "${model}"`)
  return catalog
}
