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

const NORTHWIND_REQUEST = {
  id: 'preq_northwind', status: 'pending_approval', summary: 'Pay Northwind Data $180.00', client: 'chat', totals: { USD: 18_000 }, created_at: '2026-10-22T09:31:00Z',
  items: [
    { position: 1, payee_id: 'payee_northwind', payee_name: 'Northwind Data', currency: 'USD', amount_minor: 18_000, reference: 'Invoice 1042', decision: 'needs_approval',
      reason: 'no permission you signed covers it', flags: [{ code: 'first_payment', detail: 'the first payment to Northwind Data' }] },
  ],
}

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
  // B57.44 — Members: Nick alone, the owner, on Free's one seat; the plan gates as Lens's internal/plans sets them.
  '/api/members': [{ id: 'mem_nick', name: 'Nick', email: 'nick@example.com', role: 'owner', avatar_url: '' }],
  '/api/pricing': {
    ...(bodyFor('/api/pricing') as object),
    plan_gates: {
      order: ['free', 'team', 'business', 'enterprise'],
      plans: {
        free: { agents: 3, seats: 1, own_provider_keys: 'none', live_money: false, slack_teams_approvals: false, sso: false, audit_export: false, edge: false },
        team: { agents: 25, seats: 5, own_provider_keys: 'add_on', live_money: true, slack_teams_approvals: true, sso: false, audit_export: false, edge: false },
        business: { agents: -1, seats: 25, own_provider_keys: 'included', live_money: true, slack_teams_approvals: true, sso: true, audit_export: true, edge: false },
        enterprise: { agents: -1, seats: -1, own_provider_keys: 'included', live_money: true, slack_teams_approvals: true, sso: true, audit_export: true, edge: true },
      },
    },
  },
  '/api/workspace/account': { account_type: 'business', money_kind: 'hybrid' },
  // B57.139 — what was sent from Help and complaints and Your data, so their lists draw rows rather than the empty state.
  '/api/workspace/requests': {
    requests: [
      { id: 3, kind: 'complaint', state: 'in_progress', reference: 'C-7KQ2-M4XD', message: 'A card payment was taken twice.', answer: '', filed_at: '2026-11-11T09:12:00Z', updated_at: '2026-11-11T09:12:00Z' },
      { id: 2, kind: 'data_export', state: 'done', reference: '', message: '', answer: 'Your copy is ready.', filed_at: '2026-11-09T14:30:00Z', updated_at: '2026-11-10T10:05:00Z' },
      { id: 1, kind: 'support', state: 'done', reference: '', message: 'How do I add an agent?', answer: 'From Agents, press New agent.', filed_at: '2026-11-08T16:40:00Z', updated_at: '2026-11-09T08:15:00Z' },
    ],
  },
  // B55.38 — Lens's peg, so the shots draw each LXC figure with its dollars first.
  '/api/lxc/topup-options': { allowed_usd_cents: [1000], billing_enabled: true, usd_per_lxc: 0.1 },
  '/api/agents': {
    workspace_balance_ulxc: lxc(124_800),
    allocated_ulxc: lxc(33_900),
    unallocated_ulxc: lxc(90_900),
    spent_ulxc: lxc(28_000),
    agents: AGENTS,
  },
  // B57.15 — the workspace's keys, as the sheet reads them: a passkey on this browser and the phone's key, so it signs here.
  '/api/agents/passkeys': { passkeys: [{ credential_id: 'Y3JlZF9tYWM', name: 'This Mac', created_at: '2026-10-03T08:00:00Z' }] },
  '/api/money/devices': { devices: [{ id: 'dk_iphone', name: 'iPhone, Talyvor app', created_at: '2026-10-04T09:00:00Z' }] },
  // The two requests waiting at 10:30.
  '/api/agents/approvals': {
    approvals: [
      {
        id: 'apr_acme', agent_id: 'agt_research', amount_ulxc: lxc(3_400), model: '', status: 'pending', created_at: '2026-10-22T08:17:00Z', expires_at: '2026-10-23T08:17:00Z',
        payee: { kind: 'outside', id: 'payee_acme', name: 'Acme Hosting' }, memo: 'October hosting invoice',
        // B57.15 — what the sheet says, as w-home+sheet-A: Lens B57.11's paid_from, the amount it asks above and the budget left.
        paid_from: { kind: 'account', account_id: 'acc_research_usd', name: 'Research’s US dollar account', currency: 'USD', amount_minor: 34_000, balance_minor: 40_000 },
        asks_above_ulxc: lxc(2_500), budget_left_after_ulxc: lxc(4_200),
      },
      {
        id: 'apr_lead', agent_id: 'agt_sales', amount_ulxc: lxc(900), model: '', status: 'pending', created_at: '2026-10-22T07:41:00Z', expires_at: '2026-10-23T07:41:00Z',
        payee: { kind: 'listing', id: 'lst_lead_finder', name: 'Lead finder' },
        memo: 'One use of Lead finder (version 3), $90.00 (900 LXC) on your monthly marketplace bill',
        paid_from: { kind: 'marketplace_bill', account_id: 'ws_1', name: 'Your monthly marketplace bill', currency: 'USD', amount_minor: 9_000, balance_minor: null },
        asks_above_ulxc: lxc(500), budget_left_after_ulxc: lxc(3_100),
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
  // B57.90 — the two alerts w-agents shows: Research and Sales each past half their month's limit.
  '/api/money/budgets/alerts': {
    alerts: [
      { id: 'sal_research', kind: 'agent_limit', subject: 'agt_research', agent_id: 'agt_research', period: 'monthly', period_start: '2026-10-01T00:00:00Z',
        percent: 50, spent_minor: lxc(10_120), limit_minor: lxc(20_000), currency: 'LXC', created_at: '2026-10-16T10:40:00Z' },
      { id: 'sal_sales', kind: 'agent_limit', subject: 'agt_sales', agent_id: 'agt_sales', period: 'monthly', period_start: '2026-10-01T00:00:00Z',
        percent: 50, spent_minor: lxc(7_610), limit_minor: lxc(15_000), currency: 'LXC', created_at: '2026-10-13T14:22:00Z' },
    ],
  },
  // B57.115 — Where alerts go below them: alerts pushed to the owner's phones and posted to a Slack channel, and what was sent.
  '/api/money/alerts/channels': {
    channels: [
      { id: 'ach_push', kind: 'push', created_at: '2026-09-14T09:10:00Z' },
      { id: 'ach_slack', kind: 'slack', url: 'https://hooks.slack.com/…t7Qa', created_at: '2026-10-02T11:00:00Z' },
    ],
  },
  '/api/money/alerts/deliveries': {
    deliveries: [
      { id: 'adl_research_push', channel_id: 'ach_push', channel_kind: 'push', alert_kind: 'limit', alert_id: 'sal_research', title: 'Agent limit',
        body: 'Research has used 50% of its monthly limit', status: 'sent', attempts: 1, created_at: '2026-10-16T10:40:00Z', sent_at: '2026-10-16T10:40:20Z' },
      { id: 'adl_research_slack', channel_id: 'ach_slack', channel_kind: 'slack', alert_kind: 'limit', alert_id: 'sal_research', title: 'Agent limit',
        body: 'Research has used 50% of its monthly limit', status: 'failed', attempts: 5, last_error: 'Slack answered 404', created_at: '2026-10-16T10:40:00Z' },
      { id: 'adl_sales_push', channel_id: 'ach_push', channel_kind: 'push', alert_kind: 'limit', alert_id: 'sal_sales', title: 'Agent limit',
        body: 'Sales has used 50% of its monthly limit', status: 'sent', attempts: 1, created_at: '2026-10-13T14:22:00Z', sent_at: '2026-10-13T14:22:15Z' },
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
      // B57.18 — the company's USDC account, so a Hybrid Home draws both sides.
      { id: 'macc_company_usdc', agent_id: '', currency: 'USDC', purpose: 'company', status: 'open', name: 'USDC account', balance_minor: 1_500_000_000, test_minor: 1_500_000_000, live_minor: 0 },
    ],
  },
  // B57.18 — every agent's wallet, opened with the agent (Lens B46.4), as Home reads each one's stablecoin balance.
  '/api/agents/agt_research/wallet': { account_id: 'macc_research', agent_id: 'agt_research', asset: 'USDC', partner: 'sandbox', balance_minor: 300_000_000, receive: { asset: 'USDC' }, mode: 'TEST' },
  '/api/agents/agt_sales/wallet': { account_id: 'macc_sales', agent_id: 'agt_sales', asset: 'USDC', partner: 'sandbox', balance_minor: 80_000_000, receive: { asset: 'USDC' }, mode: 'TEST' },
  '/api/agents/agt_ops/wallet': { account_id: 'macc_ops', agent_id: 'agt_ops', asset: 'USDC', partner: 'sandbox', balance_minor: 0, receive: { asset: 'USDC' }, mode: 'TEST' },
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
  // B57.27 — README's "Prepared by Chat" (10:31): $180.00 to Northwind Data, invoice 1042, from the company's dollar account;
  // no permission you signed covers it. Declined, Lens cancels it and says the payment was left out.
  '/api/money/payment-requests/preq_northwind': NORTHWIND_REQUEST,
  '/api/money/payment-requests/preq_northwind/cancel': {
    ...NORTHWIND_REQUEST,
    status: 'cancelled',
    items: NORTHWIND_REQUEST.items.map((it) => ({ ...it, pay_status: 'not_approved' })),
  },
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
  // B59.45 — Research's card (pounds) declined Compute shop, £24.00, yesterday: not one of its payees (README's sample).
  '/api/agents/agt_research/card': {
    card: { id: 'ic_research', agent_id: 'agt_research', last4: '4242', exp_month: 9, exp_year: 2029, currency: 'gbp', livemode: false, created_at: '2026-09-28T09:00:00Z' },
    authorizations: [
      { id: 'cauth_compute', authorization_id: 'iauth_compute', approved: false, reason: 'Compute shop is not one of its payees.', amount_minor: 2_400, currency: 'gbp', merchant_name: 'Compute shop', merchant_category: 'computer_software_stores', created_at: '2026-10-21T15:20:00Z' },
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
  // B57.94 — what may act for the workspace, as w-dev-keys lists it: Claude connected on 3 October, the passkeys on the
  // iPhone and This Mac (3 October) and the phone's key in the Talyvor app (4 October).
  '/api/connect/assistants': {
    assistants: [
      { id: 'grant_claude', name: 'Claude', scopes: ['wallets:read', 'invoices:draft', 'payments:prepare'], connected_at: '2026-10-03T09:00:00Z', last_used_at: '2026-10-22T08:15:00Z',
        calls: [{ tool: 'get_balances', args_sha256: 'a'.repeat(64), result: 'done', at: '2026-10-22T08:15:00Z' }] },
    ],
  },
  '/api/money/access': {
    items: [
      { kind: 'device', id: 'dk_iphone', name: 'iPhone, Talyvor app', may: 'sign approvals and mandates', created_at: '2026-10-04T09:00:00Z', last_used_at: '2026-10-22T09:00:00Z', expires_at: null, status: 'active', revoke: '/v1/money/devices/dk_iphone/revoke' },
      { kind: 'passkey', id: 'cred_iphone', name: 'iPhone', may: 'sign approvals and mandates', created_at: '2026-10-03T09:00:00Z', last_used_at: '2026-10-22T09:00:00Z', expires_at: null, status: 'active', revoke: '' },
      { kind: 'passkey', id: 'cred_mac', name: 'This Mac', may: 'sign approvals and mandates', created_at: '2026-10-03T08:00:00Z', last_used_at: '2026-10-20T09:00:00Z', expires_at: null, status: 'active', revoke: '' },
    ],
  },
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
