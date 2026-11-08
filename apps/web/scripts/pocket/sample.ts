/**
 * B57.1 — the Pocket sample workspace (~/talyvor-queue/design/pocket/README.md, "The sample workspace") as the
 * answers pocket-shots serves to the app, in populatedBff.ts's shapes, so the app and the reference show the
 * same workspace side by side: Thursday 22 October 2026, 10:30 London, Nick's team on Free.
 *
 * A route the sample does not answer falls through to populatedBff, which answers every route a screen reads
 * (src/populatedBffCoverage.test.tsx keeps it so). Each B57 item adds its own screens' sample here.
 */
import { bodyFor } from '../../src/populatedBff'

/** The sample's clock: 10:30 London, which is 09:30 UTC on 22 October 2026 (still summer time). */
export const SAMPLE_NOW = '2026-10-22T09:30:00Z'
export const SAMPLE_TIME_ZONE = 'Europe/London'

/** LXC in micro-LXC, the unit Lens counts in. 1 LXC = $0.10. */
const lxc = (n: number) => n * 1_000_000

const AGENTS = [
  { id: 'agt_research', name: 'Research', balance_ulxc: lxc(16_500), spent_ulxc: lxc(12_400), keys: ['key_research'], created_at: '2026-09-14T09:00:00Z', owner_user_id: 'usr_nick', verified: true },
  { id: 'agt_sales', name: 'Sales', balance_ulxc: lxc(12_000), spent_ulxc: lxc(11_000), keys: ['key_sales'], created_at: '2026-10-05T09:00:00Z', owner_user_id: 'usr_nick', verified: true },
  { id: 'agt_ops', name: 'Ops', balance_ulxc: lxc(5_400), spent_ulxc: lxc(4_600), keys: ['key_ops'], created_at: '2026-10-09T09:00:00Z', owner_user_id: 'usr_nick', verified: true, paused_at: '2026-10-21T17:00:00Z' },
]

const RULES = (r: { above: number; perRequest: number; daily: number; monthly: number; models: string[]; hours?: [string, string] }) => ({
  max_per_request_ulxc: lxc(r.perRequest),
  daily_limit_ulxc: lxc(r.daily),
  monthly_limit_ulxc: lxc(r.monthly),
  approval_above_ulxc: lxc(r.above),
  allowed_models: r.models,
  allowed_providers: null,
  active_from: r.hours?.[0] ?? '',
  active_until: r.hours?.[1] ?? '',
  timezone: r.hours ? SAMPLE_TIME_ZONE : '',
})

const SAMPLE: Record<string, unknown> = {
  '/auth/me': {
    mode: 'oidc',
    authenticated: true,
    user: { sub: 'usr_nick', name: 'Nick', email: 'nick@example.com' },
    workspace_id: 'ws_nicks_team',
    cache_poolable: false,
    needs_pooling_choice: false,
    signup_open: true,
  },
  '/api/workspace/name': { id: 'ws_nicks_team', name: 'Nick’s team' },
  '/api/agents': {
    workspace_balance_ulxc: lxc(124_800),
    allocated_ulxc: lxc(33_900),
    unallocated_ulxc: lxc(90_900),
    spent_ulxc: lxc(28_000),
    agents: AGENTS,
  },
  // The two requests waiting at 10:30.
  '/api/agents/approvals': {
    approvals: [
      {
        id: 'apr_acme', agent_id: 'agt_research', amount_ulxc: lxc(3_400), model: '', status: 'pending', created_at: '2026-10-22T08:17:00Z', expires_at: '2026-10-23T08:17:00Z',
        payee: { kind: 'outside', id: 'payee_acme', name: 'Acme Hosting' }, memo: 'October hosting invoice',
      },
      {
        id: 'apr_lead', agent_id: 'agt_sales', amount_ulxc: lxc(900), model: '', status: 'pending', created_at: '2026-10-22T07:41:00Z', expires_at: '2026-10-23T07:41:00Z',
        payee: { kind: 'listing', id: 'lst_lead_finder', name: 'Lead finder' },
        memo: 'One use of Lead finder (version 3), $90.00 (900 LXC) on your monthly marketplace bill',
      },
    ],
  },
  '/api/agents/briefing': {
    items: [
      { kind: 'approval', id: 'apr_acme', agent_id: 'agt_research', name: 'Acme Hosting', amount: lxc(3_400), currency: 'LXC', text: '3,400 LXC waits for your approval' },
      { kind: 'approval', id: 'apr_lead', agent_id: 'agt_sales', name: 'Lead finder', amount: lxc(900), currency: 'LXC', text: '900 LXC waits for your approval' },
    ],
    spent_yesterday: [{ currency: 'LXC', amount: 21_100_000 }],
    quiet: false,
    line: '2 approvals waiting, spent yesterday 21.1 LXC.',
  },
  '/api/agents/safe-to-spend': {
    company: [{ currency: 'LXC', balance: lxc(90_900), scheduled: 0, bills_due: 0, pending_approvals: 0, safe_to_spend: lxc(90_900) }],
    agents: [
      { agent_id: 'agt_research', name: 'Research', figures: [{ currency: 'LXC', balance: lxc(16_500), scheduled: 0, bills_due: 0, pending_approvals: lxc(3_400), safe_to_spend: lxc(13_100) }] },
      { agent_id: 'agt_sales', name: 'Sales', figures: [{ currency: 'LXC', balance: lxc(12_000), scheduled: 0, bills_due: 0, pending_approvals: lxc(900), safe_to_spend: lxc(11_100) }] },
      { agent_id: 'agt_ops', name: 'Ops', figures: [{ currency: 'LXC', balance: lxc(5_400), scheduled: 0, bills_due: 0, pending_approvals: 0, safe_to_spend: lxc(5_400) }] },
    ],
  },
  '/api/agents/forecast': {
    at: SAMPLE_NOW,
    month_start: '2026-10-01T00:00:00Z',
    month_end: '2026-11-01T00:00:00Z',
    spent_ulxc: lxc(28_000),
    forecast_ulxc: lxc(40_569),
    agents: [
      { agent_id: 'agt_research', name: 'Research', spent_ulxc: lxc(12_400), forecast_ulxc: lxc(17_966) },
      { agent_id: 'agt_sales', name: 'Sales', spent_ulxc: lxc(11_000), forecast_ulxc: lxc(15_938) },
    ],
  },
  '/api/agents/agt_research/rules': RULES({ above: 2_500, perRequest: 10_000, daily: 5_000, monthly: 20_000, models: ['claude-sonnet-5', 'claude-haiku-4-5'], hours: ['08:00', '20:00'] }),
  '/api/agents/agt_sales/rules': RULES({ above: 500, perRequest: 1_000, daily: 2_000, monthly: 15_000, models: ['claude-haiku-4-5'] }),
  '/api/agents/agt_ops/rules': RULES({ above: 1_000, perRequest: 0, daily: 0, monthly: 10_000, models: ['claude-haiku-4-5'] }),
  // The dollar accounts: the company's, Research's and the room wallet's.
  '/api/money/accounts': {
    accounts: [
      { id: 'macc_company_usd', agent_id: '', currency: 'USD', purpose: 'company', status: 'open', name: 'US dollar account', balance_minor: 320_000, test_minor: 320_000, live_minor: 0 },
      { id: 'macc_research_usd', agent_id: 'agt_research', currency: 'USD', purpose: 'agent', status: 'open', name: 'US dollar account', balance_minor: 40_000, test_minor: 40_000, live_minor: 0 },
      { id: 'macc_room_usd', agent_id: 'agt_room', currency: 'USD', purpose: 'agent', status: 'open', name: 'US dollar account', balance_minor: 25_000, test_minor: 25_000, live_minor: 0 },
    ],
  },
  '/api/money/payees': {
    payees: [
      { id: 'payee_kite', name: 'Kite Accounting', country: 'US', check: 'exact_match', checked_by: 'test', checked_at: '2026-10-01T08:00:00Z', needs_confirmation: false, created_at: '2026-09-20T09:00:00Z' },
      { id: 'payee_northwind', name: 'Northwind Data', country: 'US', check: 'exact_match', checked_by: 'test', checked_at: '2026-10-09T09:00:00Z', needs_confirmation: false, created_at: '2026-10-09T09:00:00Z' },
    ],
  },
}

/** The sample's answer for a URL, else populatedBff's, else undefined (pocket-shots answers 404). */
export function sampleBodyFor(url: string): unknown {
  const path = url.split('?')[0]
  if (url in SAMPLE) return SAMPLE[url]
  if (path in SAMPLE) return SAMPLE[path]
  return bodyFor(url)
}
