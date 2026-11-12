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
  '/api/workspace/account': { account_type: 'business', money_kind: 'hybrid' },
  // B55.38 — Lens's peg, so the shots draw each LXC figure with its dollars first.
  '/api/lxc/topup-options': { allowed_usd_cents: [1000], billing_enabled: true, usd_per_lxc: 0.1 },
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
      // B28.57 — each runs out at its pace so far this month, on that day in London (Lens B28.330).
      { agent_id: 'agt_research', name: 'Research', spent_ulxc: lxc(12_400), forecast_ulxc: lxc(17_966), balance_ulxc: lxc(16_500),
        runs_out_at: '2026-11-19T20:47:10Z', runs_out_on: '2026-11-19', timezone: SAMPLE_TIME_ZONE },
      { agent_id: 'agt_sales', name: 'Sales', spent_ulxc: lxc(11_000), forecast_ulxc: lxc(15_938), balance_ulxc: lxc(12_000),
        runs_out_at: '2026-11-14T17:40:54Z', runs_out_on: '2026-11-14', timezone: SAMPLE_TIME_ZONE },
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
  // B56.15 — each account's statement this month, as README's "Statements for currency accounts" tells it.
  '/api/money/accounts/macc_company_usd/statement': {
    account_id: 'macc_company_usd', currency: 'USD', from: '2026-10-01T00:00:00Z', to: '2026-10-21T00:00:00Z',
    opening_minor: 365_000, in_minor: 0, out_minor: 45_000, closing_minor: 320_000,
    lines: [{ entry_id: 'ment_kite', line: 1, at: '2026-10-01T09:00:00Z', kind: 'payment_out', amount_minor: -45_000, funding: 'test', counterparty: 'Kite Accounting', memo: 'October bookkeeping', balance_after_minor: 320_000 }],
  },
  '/api/money/accounts/macc_research_usd/statement': {
    account_id: 'macc_research_usd', agent_id: 'agt_research', currency: 'USD', from: '2026-10-01T00:00:00Z', to: '2026-10-21T00:00:00Z',
    opening_minor: 0, in_minor: 40_000, out_minor: 0, closing_minor: 40_000,
    lines: [{ entry_id: 'ment_fennel', line: 1, at: '2026-10-12T14:20:00Z', kind: 'invoice_payment', amount_minor: 40_000, funding: 'test', counterparty: 'Fennel Labs', memo: 'INV-000001', balance_after_minor: 40_000 }],
  },
  '/api/money/accounts/macc_room_usd/statement': {
    account_id: 'macc_room_usd', agent_id: 'agt_room', currency: 'USD', from: '2026-10-01T00:00:00Z', to: '2026-10-21T00:00:00Z',
    opening_minor: 0, in_minor: 25_000, out_minor: 0, closing_minor: 25_000,
    lines: [{ entry_id: 'ment_team', line: 1, at: '2026-10-15T09:00:00Z', kind: 'payment_in', amount_minor: 25_000, funding: 'test', counterparty: 'Nick’s team', balance_after_minor: 25_000 }],
  },
  // B57.24 — the catalog names the sample's two models, as the statements write them.
  '/api/models': [
    ...(bodyFor('/api/models') as object[]),
    { id: 'claude-sonnet-5', provider: 'anthropic', display_name: 'Claude Sonnet 5', input_per_1m: 3, output_per_1m: 15, release_date: '2026-09-01', tier: 'balanced' },
    { id: 'claude-haiku-4-5', provider: 'anthropic', display_name: 'Claude Haiku 4.5', input_per_1m: 1, output_per_1m: 5, release_date: '2025-10-15', tier: 'fast' },
  ],
  // B57.24 — each agent's statement this month by model and day, as w-stmt-research, w-stmt-sales and w-stmt-ops draw
  // it: the newest lines, then (Show all) the month's older ones.
  ...agentStatement('agt_research', { opening: 18_900, in: 10_000, out: 12_400 }, [
    modelDay('rs1', '2026-10-22T09:24:00Z', 'claude-sonnet-5', 312, -420, -23.1),
    modelDay('rh1', '2026-10-21T10:12:00Z', 'claude-haiku-4-5', 88, -20, -1.1),
    funded('rf1', '2026-10-20T17:30:00Z', 10_000),
  ], [modelDay('rs0', '2026-10-14T15:00:00Z', 'claude-sonnet-5', 2_604, -11_313.6, -622.2)]),
  ...agentStatement('agt_sales', { opening: 0, in: 23_000, out: 11_000 }, [
    modelDay('sh1', '2026-10-22T08:52:00Z', 'claude-haiku-4-5', 410, -120, -6.6),
  ], [modelDay('sh0', '2026-10-15T12:00:00Z', 'claude-haiku-4-5', 9_870, -10_306, -567.4), funded('sf0', '2026-10-05T09:10:00Z', 23_000)]),
  ...agentStatement('agt_ops', { opening: 0, in: 10_000, out: 4_600 }, [
    modelDay('oh1', '2026-10-20T16:05:00Z', 'claude-haiku-4-5', 140, -40, -2.2),
  ], [modelDay('oh0', '2026-10-12T11:00:00Z', 'claude-haiku-4-5', 4_200, -4_320, -237.8), funded('of0', '2026-10-09T09:10:00Z', 10_000)]),
  // B57.31 — README's payees: both by routing and account number, Kite last paid $450.00 on 1 Oct, Northwind not paid yet.
  '/api/money/payees': {
    payees: [
      { id: 'payee_kite', name: 'Kite Accounting', country: 'US', routing_number: '011000015', account_number: '000000000', check: 'exact_match', checked_by: 'test', checked_at: '2026-10-01T08:00:00Z', needs_confirmation: false, created_at: '2026-09-20T09:00:00Z' },
      { id: 'payee_northwind', name: 'Northwind Data', country: 'US', routing_number: '011000015', account_number: '000000000', check: 'exact_match', checked_by: 'test', checked_at: '2026-10-09T09:00:00Z', needs_confirmation: false, created_at: '2026-10-09T09:00:00Z' },
    ],
  },
  '/api/money/payments': {
    payments: [
      { id: 'mpay_kite', account_id: 'macc_company_usd', payee_id: 'payee_kite', payee_name: 'Kite Accounting', amount_minor: 45_000, currency: 'USD', funding: 'test', reference: 'October bookkeeping', idempotency_key: 'k_kite', status: 'completed', created_at: '2026-10-01T09:00:00Z', updated_at: '2026-10-01T09:00:05Z' },
    ],
  },
  // w-pay's payee Claude asked to add, today at 09:05; nothing else waits for the person on Pay.
  '/api/money/assistant-requests': {
    requests: [
      { id: 'ar_larch', kind: 'payee', assistant: 'Claude', created_at: '2026-10-22T08:05:00Z', confirm_url: '/money/pay', status: 'pending_confirmation',
        details: { name: 'Larch Labs', country: 'US', routing_number: '011000015', account_number: '000000000' } },
    ],
  },
  '/api/money/bills': {
    bills: [
      { id: 'bill_kite', source: 'email', supplier: 'Kite Accounting', invoice_number: 'KA-1001', amount_minor: 45_000, currency: 'USD', due_date: '2026-10-01', payee_id: 'payee_kite', payee_match: 'matched', status: 'paid', missing: [], created_at: '2026-09-28T09:00:00Z' },
    ],
  },
  // B57.97 — no Talyvor Card yet, as w-card opens.
  '/api/money/physical-cards': { cards: [] },
  // B57.55 — Developers: the address tools are pointed at, and the workspace's two keys, as w-dev-keys lists them.
  '/api/context': { workspace_id: 'ws_nicks_team', lens_base_url: 'http://lens:8080', lens_public_base_url: 'https://lens.talyvor.com' },
  '/api/keys': [
    { id: 'key_setup', workspace_id: 'ws_nicks_team', key_prefix: 'tlv_ws_7f3a5b12', name: 'Setup', scopes: ['proxy'], created_at: '2026-09-14T09:00:00Z', last_used_at: '2026-10-22T08:40:00Z' },
    { id: 'key_ci', workspace_id: 'ws_nicks_team', key_prefix: 'tlv_ws_c21d7e90', name: 'CI pipeline', scopes: ['proxy'], created_at: '2026-10-02T09:00:00Z', last_used_at: '2026-10-21T16:20:00Z' },
  ],
  // B56.11 — every money capability Sandbox for this workspace, as Lens answers in production today (talyvor-lens B56.7).
  '/api/wallets/capabilities': {
    capabilities: [
      ...['spend_on_talyvor', 'buy_marketplace_listings', 'rent_and_subscribe_listings', 'move_between_own_agents', 'company_credit_line', 'pay_another_owner', 'loans_between_companies', 'escrow', 'cash_out', 'invest_and_trade', 'agent_card', 'currency_accounts', 'account_details', 'payments_in', 'payments_out', 'fx'].map((capability) => ({ capability, name: capability, class: 'RED', real_money: false, label: 'sandbox' })),
      { capability: 'rules_approvals_statements_pots', name: 'Rules, approvals, statements and pots', class: 'GREEN', real_money: true },
    ],
  },
}

/** B57.24 — a model's questions on one day (Lens B57.13's ?group=day), and its platform fee the line under it. */
function modelDay(id: string, at: string, model: string, requests: number, amount: number, fee: number) {
  const line = { counterparty: 'spend', balance_after_ulxc: 0, at, model, day: at.slice(0, 10) }
  return [
    { ...line, entry_id: id, kind: 'spend', requests, amount_ulxc: Math.round(lxc(amount)) },
    { ...line, entry_id: `${id}_fee`, kind: 'platform_fee', label: 'Platform fee 5.5%', memo: 'On those requests', amount_ulxc: Math.round(lxc(fee)) },
  ]
}

function funded(id: string, at: string, amount: number) {
  return [{ entry_id: id, kind: 'fund', counterparty: 'workspace', balance_after_ulxc: 0, at, amount_ulxc: lxc(amount) }]
}

/** An agent's statement this month: its newest lines, and the page Show all reads after them. */
function agentStatement(agent: string, band: { opening: number; in: number; out: number }, newest: object[][], older: object[][]) {
  const page = (lines: object[][], next?: string) => ({
    agent_id: agent, from: '2026-10-01T00:00:00Z', to: SAMPLE_NOW, group: 'day', time_zone: SAMPLE_TIME_ZONE,
    accounts: [{ account: `agent:${agent}`, opening_ulxc: lxc(band.opening), in_ulxc: lxc(band.in), out_ulxc: lxc(band.out), closing_ulxc: lxc(band.opening + band.in - band.out) }],
    lines: lines.flat(),
    ...(next ? { next_cursor: next } : {}),
  })
  return {
    [`/api/agents/${agent}/statement`]: page(newest, `${agent}.older`),
    [`/api/agents/${agent}/statement?from=2026-10-01&group=day&limit=500&to=${encodeURIComponent(SAMPLE_NOW)}&cursor=${agent}.older`]: page(older),
  }
}

/** B57.8 — Pause every agent pauses the sample's agents until Start every agent again, so the shots draw the kill banner. */
let allPaused = false

/** Each page the shots open starts with the agents running. */
export function sampleReset(): void {
  allPaused = false
}

/** The sample's answer for a URL, else populatedBff's, else undefined (pocket-shots answers 404). */
export function sampleBodyFor(url: string): unknown {
  const path = url.split('?')[0]
  if (path === '/api/agents/pause-all') return (allPaused = true), { all_paused: true }
  if (path === '/api/agents/resume-all') return (allPaused = false), { all_paused: false }
  if (path === '/api/agents' && allPaused) return { ...(SAMPLE[path] as object), all_paused_at: SAMPLE_NOW, all_paused_reason: 'paused from the top bar' }
  if (url in SAMPLE) return SAMPLE[url]
  if (path in SAMPLE) return SAMPLE[path]
  return bodyFor(url)
}
