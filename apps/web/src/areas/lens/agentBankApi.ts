import { useQuery } from '@tanstack/react-query'
import { ApiError, getJSON } from '../../lib/api'
import { approvalInSentence, unlessHeld } from '../../lib/held'
import { isSessionExpired } from '../../lib/productState'
import { currencyText } from './money'

// agentBankApi.ts — B19.4: the Agent Bank screen's reads and writes, through the BFF's /api/agents
// routes (apps/bff/agent_bank.go) to Lens's agent accounts (B19.1), rules and approvals (B19.2) and
// payments between one company's agents (B19.3). Every amount is an integer count of µLXC.
//
// A refusal carries Lens's own sentence — which rule, what the agent holds, which approval to
// approve — and the screen shows it, because that sentence is the answer to "why not?".

/** Lens economy.Agent. */
export interface Agent {
  id: string
  name: string
  balance_ulxc: number
  spent_ulxc: number
  keys: string[]
  created_at: string
  /** B19.6 — set while the agent is paused on its own: every movement is refused until it is resumed. */
  paused_at?: string
  paused_reason?: string
  /**
   * B19.11 — the person who owns the agent; "" when it has none, and Lens then refuses to give it a
   * balance until someone claims it. Absent only from a Lens older than B19.11, which refuses nothing.
   */
  owner_user_id?: string
  /** B19.11 — its owner's workspace is verified: a completed card purchase, or Talyvor's vouch. */
  verified?: boolean
  /** B22.3 — its address besides its id, once its owner picks one. */
  handle?: string
  /** B28.21 — what the agent is for, in its owner's words. */
  description?: string
  /** B28.21 — set once it is archived: swept to zero, its keys revoked, refused every movement of its own. */
  archived_at?: string
  /** B32.32 — "room" for a room's wallet, which Lens keeps as an agent account named "Room: <title>"; else "agent". */
  kind?: string
  /** B57.10 — its face's colour, which B57.124's helper follows; absent from a Lens older than B57.10. */
  colour?: string
}

/** Lens economy.AgentArchive (B28.21): what archiving an agent did. */
export interface AgentArchive {
  agent_id: string
  /** its whole balance, moved back to the workspace in one withdraw entry */
  swept_ulxc: number
  revoked_keys: string[]
  archived_at: string
}

/**
 * B28.30 — a request to judge without making it (Lens economy.SimulatedRequest, B28.306). With a payee it is a
 * payment to that payee; without one a question to the model through the provider.
 */
export interface SimulatedRequest {
  amount_ulxc: number
  model?: string
  provider?: string
  payee?: { kind: 'agent' | 'listing' | 'company' | 'merchant'; id: string }
  /** B41.4 — judge the payment as though this allowance for its payee were saved; it is not. */
  always_allow?: PayeeAllowance
}

/** B41.4 — Lens economy.PayeeAllowance: up to this much to one payee a day or a month, without approval. */
export interface PayeeAllowance {
  amount_ulxc: number
  per: 'day' | 'month'
}

/** Lens economy.RuleSimulation (B28.306): what the agent's rules would say to it. Nothing was spent or posted. */
export interface RuleSimulation {
  verdict: 'allowed' | 'refused' | 'approval_required'
  /** why, when it is not allowed: the rule's own sentence */
  reason: string
  amount_ulxc: number
  at: string
  /** what the agent holds now; the rules do not judge it, but a request beyond it is still refused */
  balance_ulxc: number
}

/** Lens economy.AgentRulesVersion (B28.307): the agent's rules as one change left them, who changed them and how. */
export interface AgentRulesVersion {
  version: number
  rules: AgentRules
  /** the credential that changed them: "operator", or its method, user and key ("jwt:user:…"); empty when unknown */
  changed_by: string
  /** set | template <id> | rollback to <n> | before history (rules set before versions were kept) */
  change: string
  created_at: string
}

/** Lens economy.AgentRuleBoost (B28.308): one of the agent's limits raised until a time, after which it is the rules' again. */
export interface AgentRuleBoost {
  /** the limit, as AgentRules names it: daily_limit_ulxc, requests_per_minute, … */
  rule: string
  /** the limit as the rules set it when the boost was set; once the rules change it, the boost no longer applies */
  raised_from: number
  /** what it is raised to: µLXC, or requests a minute */
  value: number
  until: string
  /** the credential that set it, as a rules version names it; empty when unknown */
  created_by: string
  created_at: string
}

/** B55.14 — one change to an agent's rules, as Lens judges it (economy.RulesProposal, B55.13). */
export type RulesChange =
  | { rules: AgentRules }
  | { rollback_to: number }
  | { template: string }
  | { boost: { rule: string; value: number; until: string } }

/** Lens economy.RulesJudgement (B55.13): whether a change loosens the rules, each rule it changes in words, and the challenge a looser one is signed over. */
export interface RulesJudgement {
  looser: boolean
  changes: string[] | null
  challenge?: string
  allow_credentials: string[] | null
}

/** Lens economy.AgentBook: workspace = allocated + unallocated; spent is what the agents spent. */
export interface AgentBook {
  workspace_balance_ulxc: number
  allocated_ulxc: number
  unallocated_ulxc: number
  spent_ulxc: number
  agents: Agent[]
  /** B19.7 — set while every agent in the workspace is paused. */
  all_paused_at?: string
  all_paused_reason?: string
}

/** Lens economy.AgentSchedule (B19.8): pays another agent, or a marketplace listing (B19.17), every period. */
export interface AgentSchedule {
  id: string
  from_agent_id: string
  to_agent_id: string
  to_listing_id?: string
  /** B30.18 — a standing order: to a saved outside payee, amount_minor of currency a tick, until end_at. */
  to_payee_id?: string
  amount_minor?: number
  currency?: string
  end_at?: string
  /** to a listing: the most a tick pays, 0 for its price at the time */
  amount_ulxc: number
  memo?: string
  every: 'hour' | 'day' | 'week' | 'month'
  next_run_at: string
  active: boolean
  created_at: string
}

/** Lens economy.AgentScheduleRun: one tick, paid or refused (and why). */
export interface AgentScheduleRun {
  tick_at: string
  outcome: 'paid' | 'refused' | 'skipped'
  entry_id?: string
  use_id?: string
  /** B30.18 — a standing order's tick: the payment out it made. */
  payment_id?: string
  detail?: string
  created_at: string
}

/** Lens economy.AgentTopUp: below below_ulxc, the workspace tops the agent back up to to_ulxc. */
export interface AgentTopUp {
  agent_id: string
  below_ulxc: number
  to_ulxc: number
}

/** Lens economy.AgentSpendAlert (B19.6). */
export interface AgentSpendAlert {
  id: string
  agent_id: string
  last_hour_ulxc: number
  usual_per_hour_ulxc: number
  /** the alert paused the agent */
  paused: boolean
  created_at: string
}

/** B41.20 — Lens economy.SpendSubscription (B41.120): a card payment or payment out that recurs, to one merchant for one amount. */
export interface SpendSubscription {
  /** absent: the owner's own wallet */
  agent_id?: string
  merchant: string
  category: string
  amount_minor: number
  currency: string
  interval: 'weekly' | 'monthly'
  charges: number
  last_at: string
  next_at: string
  /** three days before next_at */
  remind_on: string
  monthly_minor: number
  yearly_minor: number
}

/** B41.39 — Lens economy.SpendBudget (B41.139): a weekly or monthly budget and how far this period has gone, from postings. */
export interface SpendBudget {
  id: string
  /** "": the owner's own wallet; "all": every wallet together; else an agent's */
  agent_id: string
  /** "": all spending */
  category: string
  period: 'week' | 'month'
  amount_minor: number
  currency: string
  timezone: string
  period_start: string
  period_end: string
  spent_minor: number
  /** below zero once it is over */
  left_minor: number
  percent: number
}

export type SpendBudgetRequest = Pick<SpendBudget, 'agent_id' | 'category' | 'period' | 'amount_minor' | 'currency' | 'timezone'>

/** B53.8 — Lens economy.SpendPayment (B53.3): one payment and the category it reads in, worked out on each read. */
export interface SpendPayment {
  entry_id: string
  kind: string
  merchant: string
  /** "": the owner's own wallet */
  agent_id?: string
  amount_minor: number
  currency: string
  category: string
  /** correction, card, merchant, payee or none */
  category_source: string
  created_at: string
}

/** B53.8 — Lens economy.Spending: the payments in [from, to), newest first, and each wallet's totals per currency. */
export interface Spending {
  from: string
  to: string
  categories: string[] | null
  payments: SpendPayment[] | null
  totals: { agent_id?: string; currency: string; total_minor: number; by_category: Record<string, number> | null }[] | null
}

/** B53.8 — Lens economy.SpendFinding (B53.5): one payment a rule found unusual, with the numbers it compared. */
export interface SpendFinding {
  rule: string
  entry_id?: string
  agent_id?: string
  merchant?: string
  category?: string
  country?: string
  amount_minor?: number
  currency?: string
  at: string
}

export interface CoachHelp {
  name: string
  url: string
  for: string
}

/** B53.8 — Lens economy.CoachLine (B53.6): one sentence and the fact it words. */
export interface CoachLine {
  fact: { kind: string; merchant?: string; category?: string; amount?: string }
  sentence: string
  source: 'model' | 'template'
  help?: CoachHelp[]
  offer?: { kind: string; text: string }
}

/** B53.8 — Lens economy.SpendNoticeSettings and SpendNotice (B53.7). */
export interface NoticeSettings {
  timezone: string
  quiet_from: string
  quiet_until: string
  off: string[] | null
}

export interface SpendNotice {
  id: string
  kind: string
  title: string
  body: string
  status: 'waiting' | 'sent' | 'dropped'
  held?: string
  created_at: string
}

/** B53.16 — Lens economy.SpendIncome (B53.15): about amount_minor of currency on day payday of each month. */
export interface SpendIncome {
  payday: number
  amount_minor: number
  currency: string
  payer?: string
  /** false: Lens's proposal from three months of money in, for the owner to confirm */
  confirmed: boolean
}

/** B53.16 — Lens economy.PlanPayment: one upcoming payment and whether the money now covers it. */
export interface PlanPayment {
  source: 'bill' | 'subscription' | 'standing_order'
  /** the bill's, the subscription's merchant, the standing order's */
  id: string
  payee: string
  agent_id?: string
  amount_minor: number
  currency: string
  /** YYYY-MM-DD in the owner's time zone */
  due: string
  covered: boolean
}

/** B53.16 — Lens economy.PlanFinding: one way the month is off plan, with its numbers and the Coach's sentence. */
export interface PlanFinding {
  kind: 'plan_uncovered' | 'plan_pace_short' | 'plan_bill_larger' | 'plan_income_late'
  urgent: boolean
  payment?: PlanPayment
  short_minor?: number
  pace_per_day_minor?: number
  keep_to_per_day_minor?: number
  usual_minor?: number
  expected_on?: string
  sentence: string
}

/** B53.16 — Lens economy.SpendPlan (B53.15): the owner's month plan, from today to the day before the next income. */
export interface SpendPlan {
  currency: string
  timezone: string
  today: string
  until: string
  next_income?: string
  days: number
  income: SpendIncome | null
  proposed_income?: SpendIncome
  money_now_minor: number
  upcoming_minor: number
  budgets_left_minor: number
  available_minor: number
  safe_per_day_minor: number
  pace_per_day_minor: number
  payments: PlanPayment[]
  findings: PlanFinding[]
}

/** B53.12 — where a physical card is posted; Lens checks it (B53.19). */
export interface CardAddress {
  line1: string
  line2: string
  city: string
  postcode: string
  country: string
}

/** B53.12 — Lens money.PhysicalCard (B53.19): the owner's physical card at the card partner. Never its number. */
export interface PhysicalCard {
  id: string
  last4: string
  state: 'inactive' | 'active' | 'frozen' | 'closed'
  design: string
  name_on_card: string
  address: CardAddress
  delivery: { status: 'ordered' | 'shipped' | 'delivered'; updated_at: string }
  /** the partner's own screen for setting or viewing the PIN; "" when it gives none */
  pin_url: string
  replaces: string
  replaced_by: string
  created_at: string
}

/** B52.28 — Lens scan.Finding (B52.24): a series' latest point against its normal, and the outlook range. */
export interface ScanFinding {
  at: string
  value: number
  unit: string
  normal_low: number
  normal_high: number
  /** the anomaly, in standard deviations */
  z: number
  outlook_at: string
  outlook_low: number
  outlook_high: number
}

/** B52.28 — Lens scan.Alert (B52.27): one alert a watch sent, with what the agent's wallet paid for it. */
export interface ScanAlert {
  id: number
  series: string
  observed_at: string
  body: string
  finding: ScanFinding
  attribution: string[] | null
  charged_ulxc: number
  created_at: string
}

/** B52.28 — Lens scan.Watch (B52.27): what a Scan agent watches and its own idea of unusual. */
export interface ScanWatch {
  id: string
  agent_id: string
  series: string[]
  /** range: outside the five-year range; z: more than z standard deviations from the normal */
  rule: 'range' | 'z'
  z?: number
  active: boolean
  last_run_at?: string
  /** why the last run sent nothing: the agent was paused, or its wallet could not pay */
  last_refusal?: string
  created_at: string
  alerts: ScanAlert[] | null
}

/** B52.28 — Lens scan.TrackEntry (B52.26): a published report's range and, once known, its outcome. */
export interface ScanTrackEntry {
  report_id: number
  series: string
  title: string
  sources: string[] | null
  published_at: string
  observed_at: string
  value: number
  unit: string
  normal_low: number
  normal_high: number
  outlook_at: string
  outlook_low: number
  outlook_high: number
  outcome?: number
  outcome_at?: string
  /** absent until scored */
  hit?: boolean
}

/** B52.28 — Lens scan.PublishedFigure (B52.33): one number a report prints; value, unit and at come from its stored point. */
export interface ScanFigure {
  name: string
  text: string
  value?: number
  unit?: string
  at?: string
}

/** B52.28 — Lens scan.PublishedReport (B52.33): an approved Scan report as a reader sees it. */
export interface ScanReport {
  id: number
  series: string
  family: string
  published_at: string
  title: string
  what_changed: string
  why_it_matters: string
  confidence: string
  what_would_change: string
  figures: ScanFigure[] | null
  sources: string[] | null
  /** the "How this report was made" box */
  box: { made_by: string; data: string[] | null; method: string; backtest: string; conflicts: string; track_record: string }
}

export interface ScanTrackRecord {
  records: ScanTrackEntry[] | null
  hits: number
  misses: number
  waiting: number
}

/** B28.66 — one place the workspace's alerts are sent (Lens B28.338). */
export interface AlertChannel {
  id: string
  kind: 'push' | 'webhook' | 'slack'
  /** a webhook's url; a Slack hook's with all but its last four characters hidden; none for push */
  url?: string
  /** a webhook's signing secret, only in the answer that added it */
  secret?: string
  added_by?: string
  created_at: string
}

/** B28.66 — one alert sent, or to be sent, to one channel. */
export interface AlertDelivery {
  id: string
  channel_id: string
  channel_kind: AlertChannel['kind']
  alert_kind: string
  alert_id: string
  title: string
  body: string
  status: 'queued' | 'sent' | 'failed'
  attempts: number
  last_error?: string
  created_at: string
  sent_at?: string
}

/** B28.62 — spending reached 50, 80 or 100% of a budget, a card's cap or an agent's limit, once a period (Lens B28.335). */
export interface LimitAlert {
  id: string
  kind: 'budget' | 'card' | 'agent_limit'
  /** the budget's id, the card's or the agent's */
  subject: string
  agent_id?: string
  category?: string
  /** week or month for a budget; hourly, daily, weekly or monthly for an agent's limit */
  period?: string
  period_start: string
  percent: number
  spent_minor: number
  limit_minor: number
  /** LXC for an agent's limit, counted in µLXC */
  currency: string
  created_at: string
}

/**
 * Lens economy.SafeToSpend (B41.105): per currency, the balance less what is promised out of it this month — scheduled
 * payments, bills due and payments waiting for approval. LXC is in µLXC; GBP, EUR and USD in minor units.
 */
export interface SafeToSpendFigure {
  currency: string
  balance: number
  scheduled: number
  bills_due: number
  pending_approvals: number
  safe_to_spend: number
}

export interface SafeToSpend {
  company: SafeToSpendFigure[] | null
  agents: { agent_id: string; name: string; figures: SafeToSpendFigure[] | null }[] | null
}

/**
 * Lens economy.Briefing (B41.106): this morning's, decisions first — approvals waiting, what is blocked and why, bills due
 * this week, then yesterday's (UTC) payments and other spend. Each item's text is its one sentence, amount included.
 */
export interface BriefingItem {
  kind: 'approval' | 'blocked' | 'bill' | 'payment' | 'agent_spend'
  id?: string
  agent_id?: string
  name: string
  amount: number
  currency?: string
  reason?: string
  due_date?: string
  text: string
}

export interface Briefing {
  items: BriefingItem[] | null
  quiet: boolean
  line: string
}

/** Lens economy.SearchResults (B41.107): one search across the workspace, its groups in kind order, an empty kind left out. */
export type SearchKind = 'agent' | 'payee' | 'payment' | 'bill' | 'invoice' | 'rule' | 'listing'

export interface SearchResult {
  kind: SearchKind
  id: string
  title: string
  detail: string
  agent_id?: string
  amount_minor?: number
  currency?: string
  status?: string
  date?: string
}

export interface SearchResults {
  query: string
  groups: { kind: SearchKind; results: SearchResult[] }[] | null
}

/** Lens economy.SpendForecast (B19.6): this UTC month so far, run on to its end. */
export interface SpendForecast {
  at: string
  month_start: string
  month_end: string
  spent_ulxc: number
  forecast_ulxc: number
  agents:
    | {
        agent_id: string
        name: string
        spent_ulxc: number
        forecast_ulxc: number
        /** B28.94 — what the agent holds now. */
        balance_ulxc?: number
        /**
         * B28.94 — when its balance runs out at its pace so far this month, an RFC 3339 time written in the agent's own
         * time zone, so its date is the agent's date; null when it does not run out at that pace.
         */
        runs_out_at?: string | null
        /** B28.330 — runs_out_at's date in the agent's own time zone, YYYY-MM-DD; null when it does not run out. */
        runs_out_on?: string | null
        /** B28.330 — the agent's IANA time zone, "UTC" when none is set. */
        timezone?: string
      }[]
    | null
}

/** Lens economy.AgentRules. A zero limit and an empty list are "no rule". */
export interface AgentRules {
  max_per_request_ulxc: number
  /** B28.24 — spend in the clock hour; Lens always reads it, and a save without it keeps the cap. */
  hourly_limit_ulxc?: number
  daily_limit_ulxc: number
  /** B28.24 — spend in the week from Monday; Lens always reads it, and a save without it keeps the cap. */
  weekly_limit_ulxc?: number
  monthly_limit_ulxc: number
  /**
   * B28.25 — what the agent may spend on one model in a day, by the model's name; Lens reads it back
   * lower-cased and without a dated suffix. Saved, it replaces the caps whole; a save without it keeps them.
   */
  model_daily_limits_ulxc?: Record<string, number>
  /**
   * B28.26 — the requests the agent may make in any sixty seconds; the one past it is refused 429 and holds
   * nothing. Lens always reads it, zero is no cap, and a save without it keeps the cap.
   */
  requests_per_minute?: number
  approval_above_ulxc: number
  allowed_models: string[] | null
  allowed_providers: string[] | null
  /** B19.14 — the marketplace listings it may use; empty or null allows any. */
  allowed_listings?: string[] | null
  /**
   * B28.27 — who the agent may pay, and who it may not, by payee id: an agent, a listing, a company (its
   * workspace id) or a card merchant. Lens refuses a payment to a blocked payee and, once allowed_payees names
   * anyone, to a payee it does not name. Lens always reads them; a save without them keeps the lists.
   */
  allowed_payees?: string[] | null
  blocked_payees?: string[] | null
  /**
   * B28.28 — what the agent may pay one payee in a day, in µLXC, keyed by the payee's id as the lists above name it.
   * Lens refuses a payment that would take the day's total to that payee past its cap. A save without it keeps the caps.
   */
  payee_daily_limits_ulxc?: Record<string, number> | null
  /** B41.4 — payee_daily_limits_ulxc over the month (Lens B41.104). A save without it keeps the caps. */
  payee_monthly_limits_ulxc?: Record<string, number> | null
  /**
   * B41.4 — the owner's "always allow", by payee id: what the agent may pay that payee in a day or a month without
   * approval (Lens B41.104). Saved from an approval; a rules save without it keeps them.
   */
  payee_allowances?: Record<string, PayeeAllowance> | null
  active_from: string
  active_until: string
  timezone: string
  /** B19.6 — pause the agent on an unusual-spend alert. Carried back unchanged on a save. */
  pause_on_unusual_spend?: boolean
}

/** Lens economy.Payee. `name` is empty when the payee no longer exists. */
export interface ApprovalPayee {
  /** `outside`: a saved payee outside Talyvor (B30.17). */
  kind: 'agent' | 'listing' | 'company' | 'merchant' | 'outside'
  id: string
  name: string
}

/** Lens economy.AgentApproval. `model` is empty for a payment to another agent. */
export interface AgentApproval {
  id: string
  agent_id: string
  amount_ulxc: number
  model: string
  /** Why the agent asked (B19.9), when it asked through its own tools. */
  reason?: string
  /** Who a payment goes to (Lens B23.5); none for a request to a model. */
  payee?: ApprovalPayee
  /** The payment's memo. */
  memo?: string
  /** expired: not used within its 24 hours (Lens agentApprovalColumns). */
  status: 'pending' | 'approved' | 'denied' | 'used' | 'expired'
  created_at: string
  decided_at?: string
  expires_at?: string
  /** The approver agent that approved it within its own limits (Lens B45.28); none when a person decided. */
  approved_by_agent_id?: string
}

/** Every kind of agent_postings row Lens writes on an agent's account. */
export type PostingKind =
  | 'fund'
  | 'withdraw'
  | 'topup'
  | 'credit_line'
  | 'spend'
  | 'hold'
  | 'settle'
  | 'release'
  | 'pay'
  | 'transfer'
  | 'escrow'
  | 'reversal'
  | 'card'
  | 'cash_out'
  | 'pot_in'
  | 'pot_out'
  | 'platform_fee'

/** Lens economy.AgentStatementLine. */
export interface StatementLine {
  entry_id: string
  kind: PostingKind
  amount_ulxc: number
  counterparty: string
  ref?: string
  balance_after_ulxc: number
  at: string
  /** B32.11 — a platform fee line's words with its rate, "Platform fee 3%". Absent on every other kind. */
  label?: string
  /** B28.93 — on a call's lines (spend, hold, settle, release, platform_fee): the model it asked. */
  model?: string
  /** B28.93 — on a call's lines: where the call came from, in Lens's words. Chat's Recent calls shows it as it is. */
  source?: string
  /** B57.24 — what the posting was for, in Lens's words: under a model's day, its fee line's "On those requests". */
  memo?: string
  /** B57.24 — on a statement read by day (Lens B57.13): the day a model's line covers in the statement's time zone,
   *  and how many questions it is. */
  day?: string
  requests?: number
}

/** Lens economy.AgentPayment. */
export interface AgentPayment {
  entry_id: string
  from_agent_id: string
  to_agent_id: string
  amount_ulxc: number
  from_balance_ulxc: number
  to_balance_ulxc: number
  memo?: string
}

/** The key Lens issues an agent — shown once. */
export interface AgentKey {
  agent_id: string
  key: string
  id: string
  prefix: string
}

/** B28.359 — a task handed to an agent from Chat, as the BFF answers it (apps/bff/agent_task.go): the model's answer to it,
 *  on the agent's own wallet, and whether the key it ran on was revoked after. */
export interface AgentTaskReply {
  agent_id: string
  answer: string
  model?: string
  request_id?: string
  /** Lens answered from the cache: nothing was charged. */
  replayed: boolean
  usage: { input_tokens: number; output_tokens: number }
  key_revoked: boolean
}

/** B28.377 — one run of a prompt scheduled from Chat (Lens B28.125, apps/bff/prompt_schedules.go): the model's answer,
 *  asked on the agent's own wallet, or why the agent's rules refused it. */
export interface PromptScheduleRun {
  ran_at: string
  outcome: 'answered' | 'refused'
  answer?: string
  /** refused: Lens's sentence */
  detail?: string
  request_id?: string
  /** all the run took from the agent's wallet, its platform fee included */
  charged_ulxc?: number
  /** the agent's statement line the answer was charged on */
  entry_id?: string
}

/** B28.377 — a prompt scheduled from Chat: asked at first_run_at, then every day or week while it is active, on the
 *  agent's own wallet. */
export interface PromptSchedule {
  id: string
  agent_id: string
  prompt: string
  provider: string
  model: string
  every: 'once' | 'day' | 'week'
  /** absent once it will not run again */
  next_run_at?: string
  active: boolean
  created_at: string
  /** newest first */
  runs: PromptScheduleRun[] | null
}

/** Lens economy.AgentCard (B19.12): an agent's virtual card, Stripe Issuing in test mode. The number stays at Stripe. */
export interface AgentCard {
  id: string
  agent_id: string
  last4: string
  exp_month: number
  exp_year: number
  /** lower-case ISO code — gbp: Talyvor is a UK platform */
  currency: string
  livemode: boolean
  created_at: string
  /** B28.360 — frozen: Lens declines every purchase on it until it is unfrozen */
  frozen?: boolean
  frozen_at?: string
}

/** Lens economy.CardAuthorizationRecord: one purchase on the card, approved or declined by the agent's rules. */
export interface CardAuthorization {
  id: string
  authorization_id: string
  approved: boolean
  /** Lens's sentence: why it was declined, or what approved it */
  reason: string
  approval_id?: string
  /** in the card's currency, minor units (pence) */
  amount_minor: number
  currency: string
  merchant_name: string
  merchant_category: string
  /** the ECB reference day it was converted at, and the two figures the ECB published that day */
  rate_date?: string
  ecb_usd_per_eur?: string
  ecb_currency_per_eur?: string
  amount_usd_micros?: number
  amount_ulxc?: number
  created_at: string
}

/** Lens agentcard.Cardholder: the person the card is issued to, and the billing address a merchant may ask for. */
export interface Cardholder {
  first_name: string
  last_name: string
  email: string
  /** E.164, e.g. +447700900123; Lens falls back to an unallocated number in test mode when empty (B27.21) */
  phone_number: string
  line1: string
  line2: string
  city: string
  postal_code: string
  /** ISO 3166-1 alpha-2; Lens takes GB when empty */
  country: string
}

/** A refusal, with the sentence Lens gave for it. */
export class AgentBankError extends ApiError {
  constructor(
    status: number,
    path: string,
    readonly sentence: string,
    /** B58.1: the approval a payment waits on, when Lens answered it held */
    readonly approvalID = '',
  ) {
    super(status, path)
  }
}

async function send<T>(method: string, path: string, body: object = {}, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    let sentence = ''
    try {
      sentence = ((await res.json()) as { error?: string }).error ?? ''
    } catch {
      // a body that is not JSON carries no sentence
    }
    throw new AgentBankError(res.status, path, sentence)
  }
  if (res.status === 204) return undefined as T // B28.32: ending a boost answers nothing
  return (await res.json()) as T
}

const e = encodeURIComponent

/** B30.103 — a read whose refusal carries Lens's sentence: a frozen agent's credential is a 409 saying why it has none. */
async function getSaid<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { Accept: 'application/json' } })
  if (!res.ok) {
    let sentence = ''
    try {
      sentence = ((await res.json()) as { error?: string }).error ?? ''
    } catch {
      // a body that is not JSON carries no sentence
    }
    throw new AgentBankError(res.status, path, sentence)
  }
  return (await res.json()) as T
}

/** B30.116 — where each level's check is sent. */
const VERIFY_PATH: Record<VerificationBody['kind'], string> = {
  contact: '/api/verification/contact',
  identity: '/api/verification/identity',
  company: '/api/verification/company',
}

/** A fresh Idempotency-Key for one Fund or Take back, or one move into or out of a pot. */
export function newMoveKey(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2)
}

/**
 * B17.26 — whether a Fund or Take back (or, B17.33, a pot's Move in or Move out) met the seconds the app
 * or Lens restarts on a deploy (502, 503, 504, or no answer at all), so it is sent again under its
 * Idempotency-Key: Lens moves the LXC once however many times the key arrives. Sent again up to six times
 * over about fifteen seconds (the card's retryDelay); a refusal is final.
 */
export function retryMoveThroughRestart(failures: number, err: unknown): boolean {
  return failures < 6 && (err instanceof TypeError || (err instanceof AgentBankError && [502, 503, 504].includes(err.status)))
}

/**
 * B28.55 — a statement file's type: the CSV, the JSON or the PDF Lens writes (Lens B28.328), or (B28.56) the period as
 * a CSV of double-entry journal lines Xero and QuickBooks import, each agent its cost centre (Lens B28.329).
 */
export type StatementFormat = 'csv' | 'json' | 'pdf' | 'journal'

const STATEMENT_ACCEPT: Record<StatementFormat, string> = { csv: 'text/csv', json: 'application/json', pdf: 'application/pdf', journal: 'text/csv' }

/**
 * B19.22 — a statement for the period [from, to) (YYYY-MM-DD, midnight UTC) as the file Lens writes:
 * one agent's account, or with no agent every account in the bank. A refusal carries Lens's sentence.
 */
async function statementFile(agentID: string | null, from: string, to: string, format: StatementFormat): Promise<Blob> {
  const query = new URLSearchParams({ from, to, format })
  const path = agentID ? `/api/agents/${e(agentID)}/statement?${query}` : `/api/agents/statement?${query}`
  const res = await fetch(path, { headers: { Accept: STATEMENT_ACCEPT[format] } })
  if (!res.ok) {
    let sentence = ''
    try {
      sentence = ((await res.json()) as { error?: string }).error ?? ''
    } catch {
      // a body that is not JSON carries no sentence
    }
    throw new AgentBankError(res.status, path, sentence)
  }
  return res.blob()
}

/**
 * B56.15 — a currency account's statement for [from, to) as the CSV Lens writes (Lens B56.14). A refusal carries
 * Lens's sentence.
 */
async function accountStatementFile(accountID: string, from: string, to: string): Promise<Blob> {
  const path = `/api/money/accounts/${e(accountID)}/statement?${new URLSearchParams({ from, to, format: 'csv' })}`
  const res = await fetch(path, { headers: { Accept: 'text/csv' } })
  if (!res.ok) {
    let sentence = ''
    try {
      sentence = ((await res.json()) as { error?: string }).error ?? ''
    } catch {
      // a body that is not JSON carries no sentence
    }
    throw new AgentBankError(res.status, path, sentence)
  }
  return res.blob()
}

/** B28.51 — what a statement page is read for: the lines of these kinds whose words hold q, any case. */
export interface StatementSearch {
  kinds: readonly PostingKind[]
  q: string
}

/** B28.51 — one page of an agent's statement, newest first: `to` is the period's end, the same on every page. */
export interface StatementPage {
  to?: string
  lines: StatementLine[] | null
  /** The cursor of the page after this one; absent on the last. */
  next_cursor?: string
}

/** B28.51 — how many lines one page of the Statement card holds. */
export const STATEMENT_PAGE_LINES = 100

/**
 * B28.51 — a page of the agent's statement from `from` (its first day) to `to` (now, on the first page; the first
 * page's `to` after it), searched and filtered by Lens, newest first. `cursor` is the page before's next_cursor.
 */
function statementPage(agentID: string, from: string, search: StatementSearch, after?: { to?: string; cursor: string }): Promise<StatementPage> {
  const query = new URLSearchParams({ from, limit: String(STATEMENT_PAGE_LINES) })
  if (search.kinds.length > 0) query.set('kind', search.kinds.join(','))
  if (search.q.trim() !== '') query.set('q', search.q.trim())
  if (after) {
    if (after.to) query.set('to', after.to)
    query.set('cursor', after.cursor)
  }
  return getJSON<StatementPage>(`/api/agents/${e(agentID)}/statement?${query}`, { lines: 'list' })
}

/** Lens economy.StatementAccount: one account's totals over the period, opening + in − out = closing. */
export interface StatementAccount {
  account: string
  opening_ulxc: number
  in_ulxc: number
  out_ulxc: number
  closing_ulxc: number
}

/** B57.24 — one page of an agent's statement read by model and day (Lens B57.13), newest first. Its accounts are the
 *  whole period's on every page; `to` is the period's end, the same on every page. */
export interface DayStatementPage {
  to?: string
  accounts?: StatementAccount[] | null
  lines: StatementLine[] | null
  /** The zone the days are counted in: the agent's rules', else UTC. */
  time_zone?: string
  next_cursor?: string
}

/**
 * B57.24 — a page of the agent's statement from `from`, read by model and day: each model's questions on a day one
 * line, its platform fee the line under it. `after` is the first page's `to` and the page before's next_cursor.
 * B57.110: with `search`, Lens keeps only the lines of those kinds whose words hold q.
 */
function statementByDay(
  agentID: string,
  from: string,
  limit: number,
  after?: { to?: string; cursor: string },
  search?: StatementSearch,
): Promise<DayStatementPage> {
  const query = new URLSearchParams({ from, group: 'day', limit: String(limit) })
  if (search && search.kinds.length > 0) query.set('kind', search.kinds.join(','))
  if (search && search.q.trim() !== '') query.set('q', search.q.trim())
  if (after) {
    if (after.to) query.set('to', after.to)
    query.set('cursor', after.cursor)
  }
  return getJSON<DayStatementPage>(`/api/agents/${e(agentID)}/statement?${query}`, { lines: 'list' })
}

/** B28.53 — what one agent sent to one destination for one model on one day (Lens B28.326), in µLXC. */
export interface SpendBucket {
  /** YYYY-MM-DD in the analytics' time zone. */
  day: string
  /** Empty for a movement that was not a request. */
  model: string
  /** The account the money went to, as the statement names it: spend, held, workspace, agent:<id>, escrow:<id>, pot:<id>. */
  destination: string
  out_ulxc: number
  /** A hold's unused part, back on the day it came back. */
  returned_ulxc: number
  spent_ulxc: number
  postings: number
}

/** B28.53 — one agent's spend for a period: the buckets' out_ulxc sum to its statement's out_ulxc for the same period. */
export interface SpendAnalytics {
  agent_id: string
  time_zone: string
  out_ulxc: number
  returned_ulxc: number
  spent_ulxc: number
  buckets: SpendBucket[] | null
}

export const WORKSPACE_NAME_KEY = ['workspace-name']

export const agentBankApi = {
  book: () => getJSON<AgentBook>('/api/agents', {
      workspace_balance_ulxc: 'number',
      allocated_ulxc: 'number',
      unallocated_ulxc: 'number',
      spent_ulxc: 'number',
      agents: 'array',
    }),
  /** B57.124 — with the colour of the helper its owner picked; without one, Lens picks. */
  create: (name: string, colour?: string) => send<Agent>('POST', '/api/agents', colour ? { name, colour } : { name }),
  /** B46.16 — the workspace's name (Lens B46.15): asked at sign-up on Home's first-agent card, shown in the sidebar. */
  workspaceName: () => getJSON<{ id: string; name: string }>('/api/workspace/name', { name: 'string' }),
  setWorkspaceName: (name: string) => send<{ id: string; name: string }>('PUT', '/api/workspace/name', { name }),
  fund: (id: string, amount_ulxc: number, key: string) =>
    send<{ balance_ulxc: number }>('POST', `/api/agents/${e(id)}/fund`, { amount_ulxc }, { 'Idempotency-Key': key }),
  withdraw: (id: string, amount_ulxc: number, key: string) =>
    send<{ balance_ulxc: number }>('POST', `/api/agents/${e(id)}/withdraw`, { amount_ulxc }, { 'Idempotency-Key': key }),
  issueKey: (id: string, name: string) => send<AgentKey>('POST', `/api/agents/${e(id)}/keys`, { name }),
  /** B28.359 — runs a task on the agent's own wallet: the BFF issues it a key for the task, and revokes it after. */
  task: (id: string, body: { task: string; provider: string; model: string }) => send<AgentTaskReply>('POST', `/api/agents/${e(id)}/tasks`, body),
  rules: (id: string) => getJSON<AgentRules>(`/api/agents/${e(id)}/rules`, {
      max_per_request_ulxc: 'number',
      daily_limit_ulxc: 'number',
      monthly_limit_ulxc: 'number',
      approval_above_ulxc: 'number',
    }),
  /** B55.14: a looser save carries the passkey's assertion beside the rules (Lens B55.13). */
  setRules: (id: string, rules: AgentRules, assertion?: PasskeyAssertion) =>
    send<AgentRules>('PUT', `/api/agents/${e(id)}/rules`, assertion ? { rules, assertion } : rules),
  /** B55.14 — what a change would do to the agent's rules, and the challenge a looser one is signed over; saves nothing. */
  rulesChallenge: (id: string, change: RulesChange) => send<RulesJudgement>('POST', `/api/agents/${e(id)}/rules-challenge`, change),
  /** B28.30 — would the agent's rules let this request through? Lens judges it and moves nothing. */
  simulate: (id: string, req: SimulatedRequest) => send<RuleSimulation>('POST', `/api/agents/${e(id)}/rules/simulate`, req),
  /** B28.31 — every version of the agent's rules, newest first: the first is the rules in force. */
  rulesHistory: (id: string) =>
    getJSON<{ versions: AgentRulesVersion[] | null }>(`/api/agents/${e(id)}/rules/history`, { versions: 'list' }),
  /** B28.31 — put the agent's rules back exactly as they were at version; Lens records that as a new version. */
  rollbackRules: (id: string, version: number, assertion?: PasskeyAssertion) =>
    send<AgentRules>('POST', `/api/agents/${e(id)}/rules/rollback`, { version, ...(assertion ? { assertion } : {}) }),
  /** B28.32 — the agent's limits raised for now, the soonest to end first. */
  boosts: (id: string) => getJSON<{ boosts: AgentRuleBoost[] | null }>(`/api/agents/${e(id)}/rules/boosts`, { boosts: 'list' }),
  /** B28.32 — raise one of the agent's limits to value until a time; from then on it is the rules' limit again by itself. */
  boost: (id: string, b: { rule: string; value: number; until: string }, assertion?: PasskeyAssertion) =>
    send<AgentRuleBoost>('POST', `/api/agents/${e(id)}/rules/boosts`, { ...b, ...(assertion ? { assertion } : {}) }),
  /** B28.32 — end the agent's boost on that limit now, before its time. */
  endBoost: (id: string, rule: string) => send<void>('DELETE', `/api/agents/${e(id)}/rules/boosts/${e(rule)}`),
  statement: (id: string) => getJSON<{ lines: StatementLine[] | null }>(`/api/agents/${e(id)}/statement`, { lines: 'list' }),
  statementPage,
  statementByDay,
  /** B28.53 — the agent's spend from `from` (YYYY-MM-DD) to now, by day, model and destination. */
  analytics: (id: string, from: string) =>
    getJSON<SpendAnalytics>(`/api/agents/${e(id)}/analytics?${new URLSearchParams({ from })}`, { buckets: 'list', out_ulxc: 'number', returned_ulxc: 'number', spent_ulxc: 'number' }),
  /** B46.9 — the agent's wallet on the money layer (Lens B46.4): its balance and how to pay into it. */
  wallet: (id: string) => getSaid<AgentMoneyWallet>(`/api/agents/${e(id)}/wallet`),
  statementFile,
  /** B56.15 — what the agent put on its company's marketplace bill in [from, to) (Lens B56.14); its balance moves not. */
  marketplaceBill: (id: string, from: string, to: string) =>
    getJSON<{ marketplace_bill?: MarketplaceBillLine[] | null }>(`/api/agents/${e(id)}/statement?${new URLSearchParams({ from, to, format: 'json' })}`),
  /** B56.15 — a currency account's statement for [from, to) (YYYY-MM-DD): opening, in, out, closing and every posting; a
   *  refusal (only the owner or an admin reads the company's accounts) carries Lens's sentence. */
  accountStatement: (id: string, from: string, to: string) =>
    getSaid<MoneyStatement>(`/api/money/accounts/${e(id)}/statement?${new URLSearchParams({ from, to })}`),
  accountStatementFile,
  /** B19.24 — the agent's test-mode card and every purchase on it; null when it has none (Lens answers 404). */
  card: async (id: string): Promise<{ card: AgentCard; authorizations: CardAuthorization[] | null } | null> => {
    try {
      return await getJSON<{ card: AgentCard; authorizations: CardAuthorization[] | null }>(`/api/agents/${e(id)}/card`, {
        card: 'object',
        authorizations: 'list',
      })
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return null
      throw err
    }
  },
  issueCard: (id: string, holder: Cardholder) => send<AgentCard>('POST', `/api/agents/${e(id)}/card`, holder),
  /** B28.360 — every purchase on the agent's card refused until it is unfrozen; Lens answers the card. */
  freezeCard: (id: string) => send<AgentCard>('POST', `/api/agents/${e(id)}/card/freeze`),
  unfreezeCard: (id: string) => send<AgentCard>('POST', `/api/agents/${e(id)}/card/unfreeze`),
  /** B28.21 — renames the agent and/or sets what it is for, and (B57.124) its helper's colour; Lens answers the agent. */
  update: (id: string, change: { name?: string; description?: string; colour?: string }) => send<Agent>('PATCH', `/api/agents/${e(id)}`, change),
  /** B28.21 — retires the agent: its balance back to the workspace, its keys revoked, its top-up and schedules stopped. */
  archive: (id: string) => send<AgentArchive>('POST', `/api/agents/${e(id)}/archive`),
  /** B19.23 — the signed-in person becomes the owner of an agent that has none. */
  claim: (id: string) => send<{ agent_id: string; owner_user_id: string }>('POST', `/api/agents/${e(id)}/claim`),
  pay: (id: string, to_agent_id: string, amount_ulxc: number, memo: string) =>
    unlessHeld(send<AgentPayment>('POST', `/api/agents/${e(id)}/pay`, { to_agent_id, amount_ulxc, memo }),
      (h) => new AgentBankError(202, `/api/agents/${e(id)}/pay`, h.message ?? '', h.approval_id)),
  approvals: () => getJSON<{ approvals: AgentApproval[] | null }>('/api/agents/approvals', { approvals: 'list' }),
  // B19.21 — scheduled payments and automatic top-ups.
  schedules: () => getJSON<{ schedules: AgentSchedule[] | null }>('/api/agents/schedules', { schedules: 'list' }),
  schedule: (id: string, body: ScheduleRequest) => send<AgentSchedule>('POST', `/api/agents/${e(id)}/schedules`, body),
  scheduleRuns: (sid: string) => getJSON<{ runs: AgentScheduleRun[] | null }>(`/api/agents/schedules/${e(sid)}/runs`, { runs: 'list' }),
  stopSchedule: (sid: string) => send<{ active: boolean }>('POST', `/api/agents/schedules/${e(sid)}/stop`),
  // B28.377 — prompts scheduled from Chat, each asked at its time on an agent's wallet.
  promptSchedules: () => getJSON<{ schedules: PromptSchedule[] | null }>('/api/agents/prompt-schedules', { schedules: 'list' }),
  schedulePrompt: (id: string, body: { prompt: string; provider: string; model: string; every: PromptSchedule['every']; first_run_at: string }) =>
    send<PromptSchedule>('POST', `/api/agents/${e(id)}/prompt-schedules`, body),
  stopPromptSchedule: (sid: string) => send<{ active: boolean }>('POST', `/api/agents/prompt-schedules/${e(sid)}/stop`),
  /** Null when the agent has none (Lens answers 404). */
  topUp: async (id: string): Promise<AgentTopUp | null> => {
    try {
      return await getJSON<AgentTopUp>(`/api/agents/${e(id)}/topup`, { below_ulxc: 'number', to_ulxc: 'number' })
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return null
      throw err
    }
  },
  setTopUp: (id: string, below_ulxc: number, to_ulxc: number) =>
    send<AgentTopUp>('PUT', `/api/agents/${e(id)}/topup`, { below_ulxc, to_ulxc }),
  removeTopUp: (id: string) => send<unknown>('DELETE', `/api/agents/${e(id)}/topup`),
  // B19.20 — stop every agent or one, and what they are spending.
  alerts: () => getJSON<{ alerts: AgentSpendAlert[] | null; rule: string }>('/api/agents/alerts', { alerts: 'list' }),
  subscriptions: () => getJSON<{ subscriptions: SpendSubscription[] | null }>('/api/money/spending/subscriptions', { subscriptions: 'list' }),
  limitAlerts: () => getJSON<{ alerts: LimitAlert[] | null }>('/api/money/budgets/alerts', { alerts: 'list' }),
  alertChannels: () => getJSON<{ channels: AlertChannel[] | null }>('/api/money/alerts/channels', { channels: 'list' }),
  addAlertChannel: (kind: AlertChannel['kind'], url: string) => send<AlertChannel>('POST', '/api/money/alerts/channels', { kind, url }),
  removeAlertChannel: (id: string) => send<{ deleted: string }>('DELETE', `/api/money/alerts/channels/${e(id)}`),
  alertDeliveries: () => getJSON<{ deliveries: AlertDelivery[] | null }>('/api/money/alerts/deliveries', { deliveries: 'list' }),
  budgets: () => getJSON<{ budgets: SpendBudget[] | null }>('/api/money/budgets', { budgets: 'list' }),
  setBudget: (b: SpendBudgetRequest) => send<SpendBudget>('PUT', '/api/money/budgets', b),
  deleteBudget: (id: string) => send<{ deleted: string }>('DELETE', `/api/money/budgets/${e(id)}`),
  scanReports: (family: string) =>
    getJSON<{ reports: ScanReport[] | null }>(`/api/scan/reports${family ? `?family=${e(family)}` : ''}`, { reports: 'list' }),
  scanReport: (id: string) => getJSON<{ report: ScanReport }>(`/api/scan/reports/${e(id)}`, { report: 'object' }),
  scanTrackRecord: () => getJSON<ScanTrackRecord>('/api/scan/track-record', { records: 'list', hits: 'number', misses: 'number', waiting: 'number' }),
  scanWatches: () => getJSON<{ watches: ScanWatch[] | null }>('/api/scan/watches', { watches: 'list' }),
  scanWatch: (agentID: string, w: { series: string[]; rule: ScanWatch['rule']; z?: number }) =>
    send<ScanWatch>('POST', `/api/agents/${e(agentID)}/scan-watches`, w),
  stopScanWatch: (id: string) => send<{ id: string; active: boolean }>('DELETE', `/api/scan/watches/${e(id)}`),
  spending: (from: string, to: string) =>
    getJSON<Spending>(`/api/money/spending?${new URLSearchParams({ from, to }).toString()}`, { payments: 'list', totals: 'list' }),
  unusual: (from: string, to: string) =>
    getJSON<{ findings: SpendFinding[] | null }>(`/api/money/spending/unusual?${new URLSearchParams({ from, to }).toString()}`, { findings: 'list' }),
  setSpendCategory: (merchant: string, category: string) =>
    send<{ merchant: string; category: string }>('PUT', '/api/money/spending/merchants', { merchant, category }),
  coach: () => getJSON<{ lines: CoachLine[] | null; review: CoachLine[] | null }>('/api/money/coach', { lines: 'list', review: 'list' }),
  notices: () => getJSON<{ settings: NoticeSettings; notices: SpendNotice[] | null }>('/api/money/notices', { notices: 'list' }),
  setNoticeSettings: (s: NoticeSettings) => send<NoticeSettings>('PUT', '/api/money/notices/settings', s),
  plan: () => getJSON<SpendPlan>('/api/money/plan', { payments: 'list', findings: 'list', safe_per_day_minor: 'number' }),
  setIncome: (i: Pick<SpendIncome, 'payday' | 'amount_minor' | 'currency' | 'payer'>) => send<SpendPlan>('PUT', '/api/money/plan/income', i),
  /** B53.12 — the owner's physical cards; null while Lens's switch is off (it answers 404), so nothing shows. */
  physicalCards: async (): Promise<PhysicalCard[] | null> => {
    try {
      return (await getJSON<{ cards: PhysicalCard[] | null }>('/api/money/physical-cards', { cards: 'list' })).cards ?? []
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return null
      throw err
    }
  },
  orderPhysicalCard: (o: { name_on_card: string; address: CardAddress }) => send<PhysicalCard>('POST', '/api/money/physical-cards', o),
  activatePhysicalCard: (id: string, last4: string) => send<PhysicalCard>('POST', `/api/money/physical-cards/${e(id)}/activate`, { last4 }),
  replacePhysicalCard: (id: string, reason: 'lost' | 'stolen' | 'damaged') =>
    send<{ old: PhysicalCard; card: PhysicalCard }>('POST', `/api/money/physical-cards/${e(id)}/replace`, { reason }),
  safeToSpend: () => getJSON<SafeToSpend>('/api/agents/safe-to-spend', { agents: 'list' }),
  briefing: () => getJSON<Briefing>('/api/agents/briefing', { items: 'list', quiet: 'boolean', line: 'string' }),
  forecast: () => getJSON<SpendForecast>('/api/agents/forecast', { spent_ulxc: 'number', forecast_ulxc: 'number', agents: 'list' }),
  pauseAll: (reason: string) => send<{ all_paused: boolean }>('POST', '/api/agents/pause-all', { reason }),
  /** B41.8: once the workspace has a passkey, resuming carries an assertion over its own challenge (Lens B41.108). */
  resumeAll: (assertion?: PasskeyAssertion) => send<{ all_paused: boolean }>('POST', '/api/agents/resume-all', assertion ? { assertion } : undefined),
  resumeAllChallenge: () => send<{ challenge: string; allow_credentials: string[] | null }>('POST', '/api/agents/resume-all/challenge'),
  pause: (id: string, reason: string) => send<{ paused: boolean }>('POST', `/api/agents/${e(id)}/pause`, { reason }),
  resume: (id: string, assertion?: PasskeyAssertion) => send<{ paused: boolean }>('POST', `/api/agents/${e(id)}/resume`, assertion ? { assertion } : undefined),
  resumeChallenge: (id: string) => send<{ challenge: string; allow_credentials: string[] | null }>('POST', `/api/agents/${e(id)}/resume-challenge`),
  /** B19.10: once the workspace has a passkey, a decision carries an assertion over the approval's challenge. */
  /** B41.4 — approving with always_allow also saves that allowance for the approval's payee. */
  decide: (approvalID: string, decision: 'approve' | 'deny', assertion?: PasskeyAssertion, alwaysAllow?: PayeeAllowance) =>
    decision === 'approve'
      ? send<AgentApproval>('POST', `/api/agents/approvals/${e(approvalID)}/approve`, { ...(assertion ? { assertion } : {}), ...(alwaysAllow ? { always_allow: alwaysAllow } : {}) })
      : send<AgentApproval>('POST', `/api/agents/approvals/${e(approvalID)}/deny`, assertion ? { assertion } : {}),
  // B19.10 — passkeys and push, kept by Lens (B19.16).
  passkeys: () => getJSON<{ passkeys: Passkey[] | null }>('/api/agents/passkeys', { passkeys: 'list' }),
  // B55.2 — the phone keys Lens holds for the workspace (revoked ones included): the phone signs approvals too.
  devices: () => getJSON<{ devices: DeviceKey[] | null }>('/api/money/devices', { devices: 'list' }),
  passkeyChallenge: () => send<{ challenge: string; rp_id: string; credential_ids?: string[] | null }>('POST', '/api/agents/passkeys/challenge'),
  // B55.3: with a key on the phone alone, Lens keeps an unsigned passkey waiting (202) until the phone lets it in (Lens B55.1).
  registerPasskey: (body: PasskeyRegistration) => send<Passkey | { enrolment: EnrolmentWaiting }>('POST', '/api/agents/passkeys', body),
  enrolments: () => getJSON<{ enrolments: KeyEnrolment[] | null }>('/api/agents/keys/enrolments', { enrolments: 'list' }),
  enrolment: (id: string) => getJSON<KeyEnrolment>(`/api/agents/keys/enrolments/${e(id)}`, { status: 'string' }),
  enrolmentChallenge: (id: string) =>
    send<{ challenge: string; allow_credentials: string[] | null }>('POST', `/api/agents/keys/enrolments/${e(id)}/challenge`),
  approveEnrolment: (id: string, assertion: PasskeyAssertion) => send<KeyEnrolment>('POST', `/api/agents/keys/enrolments/${e(id)}/approve`, { assertion }),
  declineEnrolment: (id: string) => send<KeyEnrolment>('POST', `/api/agents/keys/enrolments/${e(id)}/decline`),
  // B55.54 — a recovery code, and a key back when every key of the workspace was removed (Lens B55.48).
  recoveryCodeChallenge: () => send<{ challenge: string; allow_credentials: string[] | null }>('POST', '/api/agents/keys/recovery-code/challenge'),
  newRecoveryCode: (assertion: PasskeyAssertion) => send<{ recovery_code: string }>('POST', '/api/agents/keys/recovery-code', { assertion }),
  waitingRecovery: () => getJSON<{ recovery: KeyRecovery | null }>('/api/agents/keys/recover'),
  recoverWithCode: (code: string, passkey: RecoveryPasskey) => send<RecoveredKey>('POST', '/api/agents/keys/recover', { code, passkey }),
  startRecovery: () => send<{ recovery: KeyRecovery }>('POST', '/api/agents/keys/recover/start'),
  cancelRecovery: () => send<{ recovery: KeyRecovery }>('POST', '/api/agents/keys/recover/cancel'),
  completeRecovery: (passkey: RecoveryPasskey) => send<RecoveredKey>('POST', '/api/agents/keys/recover/complete', { passkey }),
  /** B54.34 — approving with always_allow signs that allowance too, so the challenge is asked for with it (Lens B54.29). */
  approvalChallenge: (approvalID: string, alwaysAllow?: PayeeAllowance) =>
    send<{ challenge: string; allow_credentials: string[] | null }>(
      'POST',
      `/api/agents/approvals/${e(approvalID)}/challenge`,
      alwaysAllow ? { always_allow: alwaysAllow } : undefined,
    ),
  pushPublicKey: () => getJSON<{ public_key: string }>('/api/agents/push/public-key', { public_key: 'string' }),
  subscribePush: (sub: PushSubscriptionBody) => send<{ endpoint: string }>('POST', '/api/agents/push/subscriptions', sub),
  // B22.10 — money between owners (Lens B22.1, B22.3, B22.4, B22.5).
  capabilities: () => getJSON<{ capabilities: WalletCapability[] | null }>('/api/wallets/capabilities', { capabilities: 'list' }),
  // B30.116 — the owner's verification levels (Lens B30.4).
  verification: () =>
    getJSON<WorkspaceVerification>('/api/verification', { level: 'string', live_level: 'string', checks: 'list' }),
  verify: ({ kind, ...body }: VerificationBody) => send<VerificationAnswer>('POST', VERIFY_PATH[kind], body),
  // B30.103 — each capability's terms (Lens B30.9), and each agent's Know Your Agent credential (Lens B30.5).
  terms: () => getJSON<{ terms: WorkspaceTerms[] | null }>('/api/terms', { terms: 'list' }),
  termsFor: (capability: string) =>
    getJSON<WorkspaceTerms>(`/api/terms/${e(capability)}`, { capability: 'string', version: 'number', body: 'string' }),
  acceptTerms: (capability: string, version: number) =>
    send<{ acceptance: TermsAcceptance }>('POST', `/api/terms/${e(capability)}/accept`, { version }),
  credential: (id: string) => getSaid<KYACredential>(`/api/agents/${e(id)}/credential`),
  verifyCredential: (credential: string) => send<KYAVerification>('POST', '/api/kya/verify', { credential }),
  address: (address: string) => getJSON<WalletAddress>(`/api/wallets/address/${e(address)}`, { wallet_id: 'string', name: 'string' }),
  setHandle: (id: string, handle: string) => send<WalletAddress>('PUT', `/api/agents/${e(id)}/handle`, { handle }),
  send: (id: string, to: string, amount_ulxc: number, memo: string) =>
    send<AgentTransfer>('POST', `/api/agents/${e(id)}/send`, { to, amount_ulxc, memo }),
  request: (id: string, from: string, amount_ulxc: number, memo: string) =>
    send<MoneyRequest>('POST', `/api/agents/${e(id)}/requests`, { from, amount_ulxc, memo }),
  transfers: (id: string) => getJSON<{ transfers: AgentTransfer[] | null }>(`/api/agents/${e(id)}/transfers`, { transfers: 'list' }),
  moneyRequests: () => getJSON<{ requests: MoneyRequest[] | null }>('/api/wallets/requests', { requests: 'list' }),
  answerRequest: (rid: string, accept: boolean) =>
    send<MoneyRequest>('POST', `/api/wallets/requests/${e(rid)}/${accept ? 'accept' : 'decline'}`),
  // B28.23 — give back a transfer one of the workspace's agents received (Lens B22.3, B28.299).
  refundTransfer: (tid: string) => send<AgentTransfer>('POST', `/api/wallets/transfers/${e(tid)}/refund`),
  creditLine: async (): Promise<CreditLine | null> => {
    try {
      return await getJSON<CreditLine>('/api/wallets/credit-line', {
        limit_ulxc: 'number',
        used_ulxc: 'number',
        available_ulxc: 'number',
        invoices: 'array',
      })
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return null
      throw err
    }
  },
  loans: () => getJSON<{ loans: Loan[] | null }>('/api/wallets/loans', { loans: 'list' }),
  offerLoan: (id: string, body: LoanOffer) => send<Loan>('POST', `/api/agents/${e(id)}/loans`, body),
  acceptLoan: (lid: string) => send<Loan>('POST', `/api/wallets/loans/${e(lid)}/accept`),
  declineLoan: (lid: string) => send<Loan>('POST', `/api/wallets/loans/${e(lid)}/decline`),
  withdrawLoan: (lid: string) => send<{ status: string }>('POST', `/api/wallets/loans/${e(lid)}/withdraw`),
  // B22.12 — escrow, pots, simulated investing and cash-out (Lens B22.6, B22.7, B22.8, B22.9).
  escrows: () => getJSON<{ escrows: Escrow[] | null }>('/api/wallets/escrows', { escrows: 'list' }),
  payIntoEscrow: (id: string, body: { to: string; amount_ulxc: number; release_at: string; memo: string }) =>
    send<Escrow>('POST', `/api/agents/${e(id)}/escrows`, body),
  confirmEscrow: (eid: string) => send<Escrow>('POST', `/api/wallets/escrows/${e(eid)}/confirm`),
  disputeEscrow: (eid: string, reason: string) => send<Escrow>('POST', `/api/wallets/escrows/${e(eid)}/dispute`, { reason }),
  pots: (id: string) => getJSON<{ pots: Pot[] | null }>(`/api/agents/${e(id)}/pots`, { pots: 'list' }),
  createPot: (id: string, body: { name: string; kind: Pot['kind']; target_ulxc: number; locked_until: string | null }) =>
    send<Pot>('POST', `/api/agents/${e(id)}/pots`, body),
  movePot: (id: string, pid: string, dir: 'in' | 'out', amount_ulxc: number, key: string) =>
    dir === 'in'
      ? send<Pot>('POST', `/api/agents/${e(id)}/pots/${e(pid)}/in`, { amount_ulxc }, { 'Idempotency-Key': key })
      : send<Pot>('POST', `/api/agents/${e(id)}/pots/${e(pid)}/out`, { amount_ulxc }, { 'Idempotency-Key': key }),
  lockPot: (id: string, pid: string, locked_until: string | null) => send<Pot>('PUT', `/api/agents/${e(id)}/pots/${e(pid)}/lock`, { locked_until }),
  quotes: () => getJSON<SimQuotes>('/api/wallets/quotes', { quotes: 'list' }),
  portfolios: (id: string) => getJSON<{ portfolios: Portfolio[] | null; notice: string }>(`/api/agents/${e(id)}/portfolios`, {
      portfolios: 'list',
    }),
  openPortfolio: (id: string, name: string, cash_uusd: number) => send<Portfolio>('POST', `/api/agents/${e(id)}/portfolios`, { name, cash_uusd }),
  placeOrder: (id: string, pfid: string, body: SimOrderInput) => send<SimOrder>('POST', `/api/agents/${e(id)}/portfolios/${e(pfid)}/orders`, body),
  cancelOrder: (id: string, pfid: string, oid: string) =>
    send<SimOrder>('POST', `/api/agents/${e(id)}/portfolios/${e(pfid)}/orders/${e(oid)}/cancel`),
  cashOuts: () => getJSON<{ cash_outs: CashOut[] | null }>('/api/wallets/cash-outs', { cash_outs: 'list' }),
  requestCashOut: (id: string, amount_ulxc: number, destination: string) =>
    send<CashOut>('POST', `/api/agents/${e(id)}/cash-outs`, { amount_ulxc, destination }),
  // B30.97 — invoices from an agent's currency account and their pay page (Lens B30.20), and the accounts they are paid into (B30.13).
  moneyAccounts: () => getJSON<{ accounts: CurrencyAccount[] | null }>('/api/money/accounts', { accounts: 'list' }),
  openMoneyAccount: (currency: string, agent_id: string) => send<CurrencyAccount>('POST', '/api/money/accounts', { currency, agent_id }),
  invoices: () => getJSON<{ invoices: Invoice[] | null }>('/api/money/invoices', { invoices: 'list' }),
  createInvoice: (body: InvoiceRequest) => send<Invoice>('POST', '/api/money/invoices', body),
  sendInvoice: (id: string) => send<Invoice>('POST', `/api/money/invoices/${e(id)}/send`),
  voidInvoice: (id: string) => send<Invoice>('POST', `/api/money/invoices/${e(id)}/void`),
  payInvoiceByAgent: (token: string, agent_id: string) => send<PaidInvoice>('POST', `/api/money/pay/${e(token)}/agent`, { agent_id }),
  // B30.96 — the Pay screen: saved payees (Lens B30.16), payments out (B30.17), mandates (B30.19) and bulk payouts (B30.21).
  payees: () => getJSON<{ payees: OutsidePayee[] | null }>('/api/money/payees', { payees: 'list' }),
  createPayee: (body: PayeeRequest) => send<OutsidePayee>('POST', '/api/money/payees', body),
  payeeChallenge: (id: string) => send<{ challenge: string; allow_credentials: string[] | null }>('POST', `/api/money/payees/${e(id)}/challenge`),
  confirmPayee: (id: string, assertion: PasskeyAssertion) => send<OutsidePayee>('POST', `/api/money/payees/${e(id)}/confirm`, { assertion }),
  /** B41.11 — the owner's passkey says they called the new payee on a number they already had: its cooling-off ends. */
  payeeCalledChallenge: (id: string) => send<{ challenge: string; allow_credentials: string[] | null }>('POST', `/api/money/payees/${e(id)}/called/challenge`),
  confirmPayeeCalled: (id: string, assertion: PasskeyAssertion) => send<OutsidePayee>('POST', `/api/money/payees/${e(id)}/called`, { assertion }),
  /** B41.12 — changing a payee's bank details is signed over a challenge for exactly the new details; every payment to it is then held for 24 hours. */
  payeeDetailsChallenge: (id: string, details: PayeeDetails) =>
    send<{ challenge: string; allow_credentials: string[] | null; notice: string }>('POST', `/api/money/payees/${e(id)}/details/challenge`, details),
  changePayeeDetails: (id: string, details: PayeeDetails, assertion: PasskeyAssertion) =>
    send<OutsidePayee>('POST', `/api/money/payees/${e(id)}/details`, { ...details, assertion }),
  payments: () => getJSON<{ payments: OutsidePayment[] | null }>('/api/money/payments', { payments: 'list' }),
  // B41.7 — one search box across agents, payees, payments, bills, invoices, rules and listings (Lens B41.107).
  search: (q: string) => getJSON<SearchResults>(`/api/money/search?q=${e(q)}`, { groups: 'list' }),
  /** B54.35 — the challenge a person's payment is signed over, naming exactly this payment (Lens B54.33). */
  paymentChallenge: (body: OutsidePaymentRequest) =>
    send<{ challenge: string; allow_credentials: string[] | null }>('POST', '/api/money/payments/challenge', body),
  payOutside: (body: OutsidePaymentRequest, assertion?: PasskeyAssertion) =>
    send<OutsidePayment>('POST', '/api/money/payments', assertion ? { ...body, assertion } : body),
  // B40.35 — payees and permission mandates an assistant asked for, saved or signed only by the person.
  assistantRequests: () => getJSON<{ requests: AssistantRequest[] | null }>('/api/money/assistant-requests', { requests: 'list' }),
  dismissAssistantRequest: (id: string) => send<void>('POST', `/api/money/assistant-requests/${e(id)}/dismiss`),
  prepareAssistantMandate: (id: string) =>
    send<{ canonical: string; challenge: string; allow_credentials: string[] | null }>('POST', `/api/money/assistant-requests/${e(id)}/prepare`),
  signAssistantMandate: (id: string, canonical: string, assertion: PasskeyAssertion) =>
    send<unknown>('POST', `/api/money/assistant-requests/${e(id)}/sign`, { canonical, assertion }),
  // B40.9 — a prepared request (Lens B40.3) and its one approval with a passkey over the statement Lens writes (B40.5).
  /** B40.12 — a payment Chat prepared, from voice or typed, for the person to approve; nothing is paid here. */
  prepareRequest: (body: { voice: boolean; items: { payee_id: string; currency: string; amount_minor: number; reference: string }[] }, key: string) =>
    send<PaymentRequest>('POST', '/api/money/payment-requests', body, { 'Idempotency-Key': key }),
  paymentRequest: (id: string) => getSaid<PaymentRequest>(`/api/money/payment-requests/${e(id)}`),
  /** B55.10 — every prepared request still waiting for the person (Lens B40.39; an expired one is left out, B55.9). */
  pendingPaymentRequests: () =>
    getJSON<{ requests: PaymentRequest[] | null }>('/api/money/payment-requests?status=pending_approval', { requests: 'list' }),
  /** B41.3 — `reason` is why ticked items flagged a duplicate or changed bank details are paid; Lens signs it into the statement. */
  requestApproval: (id: string, positions: number[], reason = '') =>
    send<{ statement: string; challenge: string; allow_credentials: string[] | null }>('POST', `/api/money/payment-requests/${e(id)}/approval`,
      reason ? { positions, reason } : { positions }),
  approveRequest: (id: string, statement: string, assertion: PasskeyAssertion) =>
    send<PaymentRequest>('POST', `/api/money/payment-requests/${e(id)}/approve`, { statement, assertion }),
  /** B45.2 — declined: Lens cancels the request and pays none of it. */
  cancelRequest: (id: string) => send<PaymentRequest>('POST', `/api/money/payment-requests/${e(id)}/cancel`),
  mandates: () => getJSON<{ granted: Mandate[] | null; received: Mandate[] | null }>('/api/money/mandates', { granted: 'list', received: 'list' }),
  grantMandate: (body: MandateGrant) => send<Mandate>('POST', '/api/money/mandates', body),
  revokeMandate: (id: string) => send<Mandate>('POST', `/api/money/mandates/${e(id)}/revoke`),
  payouts: () => getJSON<{ payouts: PayoutBatch[] | null }>('/api/money/payouts', { payouts: 'list' }),
  payout: (id: string) => getSaid<PayoutBatch>(`/api/money/payouts/${e(id)}`),
  /** The CSV as the person chose it, under one Idempotency-Key: Lens parses and validates every row. */
  uploadPayouts: async (csv: string, key: string) => {
    const res = await fetch('/api/money/payouts', { method: 'POST', headers: { 'Content-Type': 'text/csv', Accept: 'application/json', 'Idempotency-Key': key }, body: csv })
    if (!res.ok) {
      let sentence = ''
      try {
        sentence = ((await res.json()) as { error?: string }).error ?? ''
      } catch {
        // a body that is not JSON carries no sentence
      }
      throw new AgentBankError(res.status, '/api/money/payouts', sentence)
    }
    return (await res.json()) as PayoutBatch
  },
  /** B58.6 — the challenge approving a batch is signed over, naming it as it stands: its id, its rows and its totals (Lens B58.5). */
  payoutChallenge: (id: string) =>
    send<{ challenge: string; allow_credentials: string[] | null; payout: { id: string; rows_total: number; rows_valid: number; totals_minor: Record<string, number> | null } }>(
      'POST', `/api/money/payouts/${e(id)}/approve/challenge`),
  approvePayout: (id: string, assertion?: PasskeyAssertion) =>
    send<PayoutBatch>('POST', `/api/money/payouts/${e(id)}/approve`, assertion ? { assertion } : {}),
  // B41.1 — the bills inbox (Lens B41.101): an invoice uploaded as it is, read into a bill; created is false when it was there already.
  bills: () => getJSON<{ bills: Bill[] | null }>('/api/money/bills', { bills: 'list' }),
  uploadBill: async (file: File) => {
    const path = `/api/money/bills?source=upload&filename=${e(file.name)}`
    const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream', Accept: 'application/json' }, body: file })
    if (!res.ok) {
      let sentence = ''
      try {
        sentence = ((await res.json()) as { error?: string }).error ?? ''
      } catch {
        // a body that is not JSON carries no sentence
      }
      throw new AgentBankError(res.status, '/api/money/bills', sentence)
    }
    return { bill: (await res.json()) as Bill, created: res.status === 201 }
  },
  /** B41.2 — the ticked bills as one payment request (Lens B41.102), for one approval on /approve/<id>; nothing is paid here. */
  payBills: (billIDs: string[], key: string) => send<PaymentRequest>('POST', '/api/money/bills/pay', { bill_ids: billIDs }, { 'Idempotency-Key': key }),
}

/** What a schedule asks for: a payment to another agent or a listing in µLXC, or (B30.18) a standing order to a saved outside payee. */
export interface ScheduleRequest {
  to_agent_id: string
  to_listing_id: string
  to_payee_id?: string
  amount_ulxc: number
  amount_minor?: number
  currency?: string
  memo: string
  every: AgentSchedule['every']
  first_run_at?: string
  end_at?: string
}

/** Lens economy.OutsidePayee (B30.16): a saved payee outside Talyvor, with what its bank said of the name. */
/** Lens economy.AgentWallet (B46.4): what the agent's wallet holds, and the details its partner gives for paying into it. */
export interface AgentMoneyWallet {
  account_id: string
  agent_id: string
  /** USDC, kept to six decimal places */
  asset: string
  partner: string
  balance_minor: number
  receive: { asset: string; holder?: string; iban?: string; bic?: string; network?: string; address?: string }
  /** TEST while the sandbox serves it: its details are made up and there is nothing to pay into */
  mode: 'TEST' | 'LIVE'
  notice?: string
}

export interface OutsidePayee {
  id: string
  name: string
  country: string
  sort_code?: string
  account_number?: string
  iban?: string
  bic?: string
  routing_number?: string
  /** exact_match, close_match (with suggested_name) or no_match */
  check: string
  suggested_name?: string
  checked_by: string
  checked_at: string
  /** a close or no match cannot be paid until the owner confirms it with a passkey */
  needs_confirmation: boolean
  confirmed_at?: string
  created_at: string
  /** B41.11 (Lens B41.111): until then a payment of more than 1,000 to this new payee waits, unless the owner confirms they called it */
  cooling_off_until?: string
  called_at?: string
  /** B41.12 (Lens B41.112): its bank details changed, so until held_until every payment to it is held; notice says what to do meanwhile */
  details_changed_at?: string
  held_until?: string
  notice?: string
  /** set while screening holds the payee for an operator */
  screening?: string
}

/** Lens economy.PermissionMandateTerms (B40.2), as an assistant drafted them, so any part may be missing: amounts are minor units by currency. */
export interface MandateTerms {
  clients: string[]
  scope: { payees?: string[] | null; payee_categories?: string[] | null; sellers?: string[] | null; rooms?: string[] | null; currencies?: string[] | null }
  limits?: { per_payment?: Record<string, number> | null; per_day?: Record<string, number> | null; per_month?: Record<string, number> | null; batch_total?: Record<string, number> | null; payments_per_hour?: number }
  requires_approval_above?: Record<string, number> | null
  new_payee: { policy: string; cooling_off_hours?: number }
  expires_at: string
}

/** Lens economy.PaymentRequest (B40.3): each item auto, needs_approval or blocked, with the rule that decided it. */
export interface PaymentRequest {
  id: string
  /** pending_approval | auto | blocked | approved | cancelled */
  status: string
  summary: string
  client: string
  agent_id?: string
  /** B45.25 — an outside agent's request carries who Talyvor takes it to be: Lens's agentsig.Result (B45.24, B45.29). */
  agent_trust?: AgentTrust
  totals: Record<string, number>
  items: PaymentRequestItem[]
  created_at: string
}

/** Lens agentsig.Result: verified — the signing domain belongs to a business Talyvor checked; signed — only the domain is known. */
export interface AgentTrust {
  level: 'verified' | 'signed' | 'unverified'
  label?: string
  domain?: string
  business?: string
}

export interface PaymentRequestItem {
  position: number
  payee_id: string
  payee_name: string
  listing_id?: string
  currency: string
  amount_minor: number
  reference: string
  /** auto | needs_approval | blocked */
  decision: string
  reason: string
  rule?: string
  /** The payment out that paid it, once one did. */
  payment_id?: string
  pay_status?: string
  pay_detail?: string
  /** B41.3 (Lens B41.103) — duplicate | bank_details_changed | first_payment | unusual_amount, each with Lens's words. */
  flags?: { code: string; detail: string }[]
}

/** Lens economy.ApprovalStatement (B40.5): exactly what the passkey signs. */
export interface ApprovalStatement {
  request_id: string
  items: { position: number; payee_id: string; currency: string; amount_minor: number; reference: string; overrides?: string[] }[]
  totals: Record<string, number>
  /** B41.3 — why the flagged items it overrides are approved. */
  reason?: string
  expires_at: string
}

/** B40.35 — what an assistant asked for that only the person may do (BFF mcp_drafts.go). */
export type AssistantRequest = { id: string; assistant: string; created_at: string; status: string } & (
  | { kind: 'payee'; details: PayeeRequest }
  | { kind: 'mandate'; details: MandateTerms }
  | { kind: 'plan'; details: RecurringPlan }
)

/** B45.37 — Lens economy.RecurringPlan (B45.13): standing orders that run once the person signs their mandate. */
export interface RecurringPlan {
  id: string
  /** awaiting_signature | signed */
  status: string
  schedules: (AgentSchedule & { awaiting_signature?: boolean })[]
  /** canonical is the mandate's terms, MandateTerms as JSON: exactly what the passkey signs */
  mandate: { id: string; canonical: string; challenge: string; credential_ids: string[] | null }
  created_at: string
}

export interface PayeeRequest {
  name: string
  country: string
  sort_code?: string
  account_number?: string
  iban?: string
  bic?: string
  routing_number?: string
}

/** B41.12 — a payee's new bank details: one set, as a payee is saved with. */
export type PayeeDetails = Omit<PayeeRequest, 'name'>

/** Lens economy.OutsidePayment (B30.17): money sent to a saved payee through the account partner. */
export interface OutsidePayment {
  id: string
  account_id: string
  agent_id?: string
  payee_id: string
  payee_name: string
  amount_minor: number
  currency: string
  funding: string
  reference: string
  idempotency_key: string
  /** pending | sent | completed | failed | returned */
  status: string
  detail?: string
  created_at: string
  updated_at: string
}

export interface OutsidePaymentRequest {
  account_id: string
  payee_id: string
  amount_minor: number
  currency: string
  reference: string
  idempotency_key: string
}

/** Lens economy.MandateGrant (B30.19): on an agent's account, to a Talyvor company or an outside business with a saved payee. */
export interface MandateGrant {
  account_id: string
  payee_workspace_id: string
  payee_business_id: string
  payee_id: string
  payee_name: string
  max_per_pull_minor: number
  max_per_month_minor: number
  expires_at: string
}

/** Lens economy.Mandate (B30.19). */
export interface Mandate {
  id: string
  agent_id: string
  account_id: string
  currency: string
  payee_workspace_id?: string
  payee_business_id?: string
  payee_name: string
  payee_id?: string
  max_per_pull_minor: number
  max_per_month_minor: number
  pulled_this_month_minor: number
  expires_at: string
  /** active | revoked */
  status: string
  revoked_at?: string
  created_at: string
  /** an outside business's key, answered once, when granted */
  pull_key?: string
}

/** Lens economy.PayoutRow (B30.21): one line of a batch, valid or invalid at upload, then its payment's state. */
export interface PayoutRow {
  line: number
  payee_id: string
  payee_name?: string
  amount_minor: number
  currency: string
  reference: string
  status: string
  payment_id?: string
  detail?: string
}

/** Lens economy.Bill (B41.101): an invoice the workspace received; the printed bank details are shown, never paid on their own. */
export interface Bill {
  id: string
  source: string
  filename?: string
  supplier: string
  invoice_number: string
  amount_minor: number
  currency: string
  /** YYYY-MM-DD */
  due_date?: string
  sort_code?: string
  account_number?: string
  iban?: string
  bic?: string
  routing_number?: string
  payee_id?: string
  /** matched | bank_details_differ | new_payee */
  payee_match: string
  /** due | paid */
  status: string
  /** the fields reading the invoice could not find */
  missing: string[] | null
  created_at: string
}

/** Lens economy.PayoutBatch (B30.21): rows only when one batch is read. */
export interface PayoutBatch {
  id: string
  agent_id?: string
  funding: string
  /** awaiting_approval | approved | … */
  status: string
  rows?: PayoutRow[] | null
  rows_total: number
  rows_valid: number
  rows_invalid: number
  totals_minor: Record<string, number> | null
  approved_by?: string
  approved_at?: string
  created_at: string
}

/** Lens economy.Escrow (B22.6): credits held between a paying and a paid agent. */
export interface Escrow {
  id: string
  payer_workspace_id: string
  payer_agent_id: string
  payee_workspace_id: string
  payee_agent_id: string
  amount_ulxc: number
  memo?: string
  class: 'GREEN' | 'AMBER'
  test_funded_ulxc: number
  release_at: string
  status: 'held' | 'disputed' | 'released' | 'returned'
  created_at: string
  decided_at?: string
  events: { kind: 'held' | 'disputed' | 'released' | 'returned'; actor: 'payer' | 'deadline' | 'operator'; operator?: string; detail?: string; at: string }[]
}

/** Lens economy.Pot (B22.7): credits an agent set aside. */
export interface Pot {
  id: string
  agent_id: string
  name: string
  kind: 'goal' | 'budget' | 'reserve'
  target_ulxc?: number
  locked_until?: string
  balance_ulxc: number
  created_at: string
}

/** Lens economy.Quotes (B22.8): every instrument the simulator trades, in US dollars per unit. */
export interface SimQuotes {
  simulated: boolean
  market_data: string
  rate_date?: string
  quotes: { instrument: string; price_usd: string; rate_date: string }[] | null
}

/** What an order asks for (Lens economy.SimOrderInput). Never a mode: every order here is simulated. */
export interface SimOrderInput {
  instrument: string
  side: 'buy' | 'sell'
  type: 'market' | 'limit'
  quantity_micros: number
  limit_price_usd?: string
}

/** Lens economy.SimOrder (B22.8). */
export interface SimOrder extends SimOrderInput {
  id: string
  portfolio_id: string
  status: 'open' | 'filled' | 'cancelled' | 'rejected'
  fill_price_usd?: string
  fill_rate_date?: string
  cash_uusd: number
  reason?: string
  simulated: boolean
  created_at: string
  decided_at?: string
}

/** Lens economy.Portfolio (B22.8): simulated US dollars and positions, valued at the quotes. */
export interface Portfolio {
  id: string
  agent_id: string
  name: string
  simulated: boolean
  notice: string
  market_data: string
  rate_date?: string
  starting_cash_uusd: number
  cash_uusd: number
  positions: { instrument: string; quantity_micros: number; price_usd: string; value_uusd: number }[] | null
  value_uusd: number
  orders: SimOrder[] | null
  created_at: string
}

/** Lens economy.CashOut (B22.9): credits turned into money through a partner. */
export interface CashOut {
  id: string
  workspace_id: string
  agent_id: string
  amount_ulxc: number
  amount_uusd: number
  test_funded_ulxc: number
  destination: string
  partner: string
  partner_ref?: string
  status: 'held' | 'submitted' | 'paid' | 'failed'
  detail?: string
  created_at: string
  decided_at?: string
}

/** Lens economy.CapabilityStatus (B22.1): what a wallet can do, its class, and whether it takes real money now. */
export interface WalletCapability {
  capability: string
  name: string
  class: 'GREEN' | 'AMBER' | 'RED'
  real_money: boolean
  clearance?: {
    by: string
    reference: string
    at: string
    licence_reference?: string
    partner?: string
    countries?: string[] | null
    expires_at?: string
  }
  /** B30.4: the verification level its live money needs, "L0" to "L3". */
  level_needed?: string
  /** B56.9: live or sandbox for this workspace (talyvor-lens B56.7), on each capability that moves money. For StatusLabel. */
  label?: string
}

/** Lens economy.VerificationCheck (B30.4): one check, as the provider that made it answered. */
export interface VerificationCheck {
  level: string
  subject: string
  /** The provider that checked. */
  method: string
  /** Checked by the Test provider: it counts for test money only. */
  test: boolean
  status: 'pending' | 'completed' | 'failed' | 'returned'
  evidence_ref: string
  verified_name?: string
  country?: string
  company_number?: string
  detail?: string
  started_at: string
  checked_at: string
}

/** Lens economy.WorkspaceVerification (B30.4): the level the checks reach, the level live money is judged by, every check. */
export interface WorkspaceVerification {
  level: string
  meaning: string
  live_level: string
  live_meaning: string
  checks: VerificationCheck[] | null
}

/** What a check answers: the check, and the record after it. */
export interface VerificationAnswer {
  check: VerificationCheck
  verification: WorkspaceVerification
}

/** What each level's check is asked to confirm (Lens economy.VerificationRequest). */
export type VerificationBody =
  | { kind: 'contact'; email: string; phone: string }
  | { kind: 'identity'; name: string; country: string; date_of_birth: string }
  | { kind: 'company'; name: string; country: string; company_number: string; directors: string[]; people_with_significant_control: string[] }

/** Lens economy.TermsAcceptance (B30.9): who accepted which version of a capability's terms, and when. */
export interface TermsAcceptance {
  capability: string
  version: number
  person: string
  accepted_at: string
}

/** Lens economy.WorkspaceTerms (B30.9): a capability's latest terms, and whether this workspace has accepted them. */
export interface WorkspaceTerms {
  capability: string
  name: string
  class: 'GREEN' | 'AMBER' | 'RED'
  version: number
  published_at: string
  /** The text, in Markdown; only on the read of one capability's terms. */
  body?: string
  /** Of the latest version; absent until it is accepted. */
  accepted?: TermsAcceptance
  /** The latest earlier version this workspace accepted, while it has not accepted this one. */
  previously_accepted_version?: number
}

/** Lens kya claims (docs/kya.md): what an agent's credential says about it. */
export interface KYAClaims {
  iss: string
  sub: string
  jti: string
  iat: number
  exp: number
  agent: { id: string; name: string }
  owner: { workspace_id: string; name?: string; level: string; live_level: string }
  capabilities: { capability: string; money: string }[] | null
  limits: Record<string, number | string | boolean>
}

/** Lens kya.Credential (B30.5): the signed credential an agent shows, and where any platform checks it. */
export interface KYACredential {
  id: string
  credential: string
  claims: KYAClaims
  issued_at: string
  expires_at: string
  jwks_url: string
  verify_url: string
}

/** Lens kya.Verification (B30.5): Talyvor's answer on a credential. */
export interface KYAVerification {
  valid: boolean
  reason?: string
  claims?: KYAClaims
}

/** Lens economy.WalletAddress (B22.3): what a wallet ID or @handle is. */
export interface WalletAddress {
  wallet_id: string
  handle?: string
  name: string
}

/** Lens economy.AgentTransfer (B22.3): credits moved between two agents, of one owner (GREEN) or two (AMBER). */
export interface AgentTransfer {
  id: string
  from_workspace_id: string
  from_agent_id: string
  to_workspace_id: string
  to_agent_id: string
  amount_ulxc: number
  memo?: string
  class: 'GREEN' | 'AMBER'
  test_funded_ulxc: number
  request_id?: string
  schedule_id?: string
  refund_of?: string
  loan_id?: string
  created_at: string
  /** B28.299: the refund that gave this transfer back, if one did */
  refunded_by?: string
  /** B28.299: this agent received it and may still give it back (not a refund, a loan's movement or given back) */
  refundable?: boolean
}

/** Lens economy.MoneyRequest (B22.3): from_* asked to_* for credits. */
export interface MoneyRequest {
  id: string
  from_workspace_id: string
  from_agent_id: string
  to_workspace_id: string
  to_agent_id: string
  amount_ulxc: number
  memo?: string
  status: 'pending' | 'accepted' | 'declined'
  transfer_id?: string
  created_at: string
  decided_at?: string
}

/** Lens economy.CreditLine (B22.4): a company's credit line. */
export interface CreditLine {
  workspace_id: string
  limit_ulxc: number
  used_ulxc: number
  available_ulxc: number
  paused: boolean
  paused_reason?: string
  invoices: {
    id: string
    period_end: string
    amount_ulxc: number
    amount_cents: number
    due_at: string
    paid_at?: string
    late: boolean
  }[]
}

/** What a lender offers (Lens B22.5). interest_bps is on the principal over the whole term: 1000 is 10%. */
export interface LoanOffer {
  to: string
  principal_ulxc: number
  interest_bps: number
  instalments: number
  every: 'day' | 'week' | 'month'
  late_fee_ulxc: number
  memo: string
}

/** Lens economy.Loan (B22.5). */
export interface Loan {
  id: string
  lender_workspace_id: string
  lender_agent_id: string
  borrower_workspace_id: string
  borrower_agent_id: string
  principal_ulxc: number
  interest_bps: number
  instalments: number
  every: 'day' | 'week' | 'month'
  late_fee_ulxc: number
  memo?: string
  status: 'offered' | 'declined' | 'withdrawn' | 'active' | 'late' | 'defaulted' | 'repaid'
  paid_instalments: number
  next_due_at?: string
  offered_at: string
  decided_at?: string
  events: {
    kind: 'payout' | 'instalment' | 'missed' | 'late' | 'defaulted'
    instalment?: number
    principal_ulxc?: number
    interest_ulxc?: number
    late_fee_ulxc?: number
    transfer_id?: string
    detail?: string
    at: string
  }[]
}

/** A passkey the workspace's owner registered (B19.16). */
export interface Passkey {
  credential_id: string
  name: string
  created_at: string
  last_used_at?: string
  /** B41.116: revoked by a lockdown, it signs nothing. */
  revoked_at?: string
  /** B55.54: answered once, with the workspace's first key (Lens B55.48). */
  recovery_code?: string
}

/** B55.54 — a recovery started without the code (Lens economy.KeyRecovery): a key can be added from ready_at. */
export interface KeyRecovery {
  id: string
  status: 'waiting' | 'cancelled' | 'completed' | 'expired'
  created_at: string
  ready_at: string
  expires_at: string
  /** started by the person asking, who alone adds its key */
  mine: boolean
}

/** B55.54 — the new passkey a recovery adds, as POST /api/agents/passkeys takes it. */
export type RecoveryPasskey = Omit<PasskeyRegistration, 'assertion'>

/** B55.54 — the key a recovery added and the workspace's new recovery code, shown this once. */
export interface RecoveredKey {
  key: { kind: 'passkey' | 'device'; id: string; name: string }
  recovery_code: string
}

/** B55.2 — a phone's key (Lens GET /v1/money/devices); one revoked signs nothing. */
export interface DeviceKey {
  id: string
  platform: string
  name: string
  revoked_at?: string
}

/** B55.3 — a key registered on one device, waiting for a key on the other to let it in (Lens B55.1). */
export interface EnrolmentWaiting {
  id: string
  code: string
  expires_at: string
}

export interface KeyEnrolment extends EnrolmentWaiting {
  kind: 'passkey' | 'device'
  name: string
  platform?: string
  status: 'waiting' | 'approved' | 'declined' | 'expired'
  created_at: string
}

/** A new passkey, as the browser's ceremony gives it — all base64url. */
export interface PasskeyRegistration {
  credential_id: string
  name: string
  public_key: string
  client_data_json: string
  authenticator_data: string
  /** B50.22: an existing passkey's signature over this registration's challenge, once the workspace has one. */
  assertion?: PasskeyAssertion
}

/** A passkey's signature over an approval's challenge — all base64url. */
export interface PasskeyAssertion {
  credential_id: string
  client_data_json: string
  authenticator_data: string
  signature: string
}

/** A device's push subscription, as PushSubscription.toJSON() gives it. */
export interface PushSubscriptionBody {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

/** `12.5` → 12,500,000 µLXC. Null for anything that is not a positive amount with at most six decimals. */
export function parseLXC(text: string): number | null {
  const m = /^\s*(\d+)(?:\.(\d{1,6}))?\s*$/.exec(text)
  if (!m) return null
  const micros = Number(m[1]) * 1_000_000 + Number((m[2] ?? '').padEnd(6, '0'))
  return Number.isSafeInteger(micros) && micros > 0 ? micros : null
}

/** 12,500,000 µLXC → `12.5 LXC`: every µLXC shown, no trailing zeros. */
export function formatULXC(micros: number): string {
  return `${(micros / 1_000_000).toLocaleString('en-US', { maximumFractionDigits: 6 })} LXC`
}

/** A limit field's text: empty for "no limit". */
export function limitText(micros: number): string {
  return micros > 0 ? String(micros / 1_000_000) : ''
}

/** The approval a payment filed: Lens's held answer names it (B58.2), or its refusal's sentence does, in any case. */
export function approvalNamedIn(err: unknown): string | null {
  return err instanceof AgentBankError ? err.approvalID || approvalInSentence(err.sentence) : null
}

/** Why a write did not happen, in Lens's words where Lens gave some. */
export function refusalText(err: unknown): string {
  if (isSessionExpired(err)) return 'Nothing changed. Sign in again.'
  if (err instanceof AgentBankError && err.status < 500 && err.sentence) {
    const s = err.sentence.replace(/^economy: (spending: )?/, '')
    return `${s.charAt(0).toUpperCase()}${s.slice(1)}${s.endsWith('.') ? '' : '.'}`
  }
  return 'Nothing changed. You can try again.'
}

/** Lens economy.CurrencyAccount (B30.13): the company's or an agent's account in GBP, EUR, USD or USDC. */
export interface CurrencyAccount {
  id: string
  /** "" for the company's own */
  agent_id?: string
  currency: string
  purpose: 'company' | 'agent'
  status: string
  name: string
  balance_minor: number
  test_minor: number
  live_minor: number
}

/** B56.15 — one posting to a currency account (Lens economy.MoneyStatementLine): money in positive, out negative. */
export interface MoneyStatementLine {
  entry_id: string
  line: number
  at: string
  /** the entry's: payment_in, invoice_payment, mandate_pull, card_charge, … */
  kind: string
  amount_minor: number
  funding: string
  /** who an outside payment was from or to; else the other account, or "workspace:<id>" */
  counterparty: string
  memo?: string
  partner_ref?: string
  balance_after_minor: number
}

/** B56.15 — a currency account over [from, to) (Lens economy.MoneyStatement): opening + in − out = closing. */
export interface MoneyStatement {
  account_id: string
  agent_id?: string
  currency: string
  from: string
  to: string
  opening_minor: number
  in_minor: number
  out_minor: number
  closing_minor: number
  lines: MoneyStatementLine[] | null
}

/** B56.15 — one use or payment an agent put on its company's monthly marketplace bill (Lens economy.MarketplaceBillLine). */
export interface MarketplaceBillLine {
  use_id: string
  at: string
  /** pay, for a payment to another company's agent; else use, buy, rent, subscribe or renewal */
  kind: string
  listing_id?: string
  payee_agent_id?: string
  amount_ulxc: number
  memo?: string
  /** "on the marketplace bill" */
  label: string
}

/** One line of an invoice (Lens economy.InvoiceLine): a quantity at a unit price in minor units, with its VAT rate in basis points. */
export interface InvoiceLine {
  description: string
  quantity: number
  unit_amount_minor: number
  vat_rate_bps: number
  net_minor?: number
  vat_minor?: number
}

/** What issues an invoice (Lens economy.InvoiceRequest, B30.20); the account names the currency. */
export interface InvoiceRequest {
  account_id: string
  customer_name: string
  customer_email: string
  customer_address: string
  customer_vat_number: string
  seller_vat_number: string
  lines: InvoiceLine[]
  /** YYYY-MM-DD */
  due_date: string
  remind_days_before: number
  memo: string
  /** sent at once, its pay link open, rather than kept as a draft */
  send: boolean
}

/** Lens economy.Invoice (B30.20). Its ids and pay token are absent from the payer's view (PayPage). */
export interface Invoice {
  id: string
  agent_id?: string
  account_id?: string
  issuer: string
  /** INV-000001, the workspace's own */
  number: string
  /** quoted with a transfer, it marks the invoice paid */
  reference: string
  pay_url?: string
  currency: string
  customer_name: string
  customer_email?: string
  customer_address?: string
  customer_vat_number?: string
  seller_vat_number?: string
  lines: InvoiceLine[]
  subtotal_minor: number
  vat_minor: number
  total_minor: number
  paid_minor: number
  due_minor: number
  due_date: string
  remind_days_before: number
  memo?: string
  status: 'draft' | 'sent' | 'overdue' | 'paid' | 'void'
  sent_at?: string
  paid_at?: string
  voided_at?: string
  created_at: string
  payments?: { entry_id: string; method: 'card' | 'transfer' | 'agent'; amount_minor: number; paid_at: string }[] | null
  reminders?: { kind: string; sent_to?: string; message: string; sent_at: string }[] | null
}

/** What a Talyvor agent's payment of an invoice did (Lens economy.PaidInvoice): the invoice as it now reads, and the entry. */
export interface PaidInvoice {
  invoice: Invoice
  entry: { id: string }
}

/** The pay page as Lens serves it to whoever holds the link (GET /v1/pay/{token}, B30.20). */
export interface PayPage {
  notice: string
  invoice: Invoice
  /** a card may pay what is due (Lens has a Stripe test-mode key and the invoice is sent or overdue) */
  card: boolean
  transfer?: {
    details: { holder: string; currency: string; sort_code?: string; account_number?: string; iban?: string; bic?: string; routing_number?: string }
    mode: string
    reference: string
  }
}

/** The currencies a company or agent account holds and a bank payee or invoice takes; an agent's USDC wallet is not one. */
export const FIATS: readonly string[] = ['GBP', 'EUR', 'USD']

/**
 * 12345 GBP → "£123.45", 1500000 USDC → "1.50 USDC": minor units in the currency's own figures. Lens keeps USDC to six
 * decimals and Intl refuses its code (B55.26); a code it does not know reads "12.50 XYZ" and never throws.
 */
export function formatMinor(minor: number, currency: string): string {
  if (currency === 'USDC') return `${(minor / 1e6).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 6 })} USDC`
  if (!FIATS.includes(currency)) return `${(minor / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`
  return currencyText(minor / 100, currency)
}

/** "12.50" → 1250: an amount typed in the currency's major units, to the minor unit; null when it is not a positive amount. */
export function minorOf(text: string): number | null {
  const m = /^\s*(\d+)(?:\.(\d{1,2}))?\s*$/.exec(text)
  if (m === null) return null
  const minor = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'))
  return Number.isSafeInteger(minor) && minor > 0 ? minor : null
}

// B59.10 — a workspace is Business or Personal, and Fiat only, Stablecoin and crypto only, or Hybrid (Lens
// B59.6), and each screen renders only what its type and kind have — SPEC 3.3 and 3.4, the launch pack's two tables.
// Hidden means not rendered, never greyed out. Lens refuses a money route of the wrong kind on its own (B59.7); this is
// what the screens draw.

export type AccountType = 'business' | 'personal'
export type MoneyKind = 'fiat' | 'stablecoin' | 'hybrid'
export interface WorkspaceAccount {
  account_type: AccountType
  money_kind: MoneyKind
}

export const ACCOUNT_KEY = ['workspace-account'] as const

/** GET /api/workspace/account — the workspace's type and kind of money (Lens B59.6). */
export function readWorkspaceAccount(): Promise<WorkspaceAccount> {
  return getJSON<WorkspaceAccount>('/api/workspace/account', { account_type: 'string', money_kind: 'string' })
}

/** What a workspace's type and kind show. */
export interface Shows {
  /** Bank transfers in and out: payees by their bank details, IBANs to pay in. Not for Stablecoin. */
  bankTransfers: boolean
  /** Wallet addresses, on-chain send and receive. Not for Fiat. */
  onChain: boolean
  /** Convert between the two sides. Hybrid only. */
  convert: boolean
  /** Instant transfer. Hybrid only. */
  instantTransfer: boolean
  /** Team, roles and a second approver. Business only. */
  team: boolean
  /** Payout batches. Business only. */
  payoutBatches: boolean
  /** The owner's card tiers, lowest first. */
  cardTiers: readonly string[]
  /** The agents' heading: "Your agents", or "Your team’s agents". */
  agents: string
  /** The owner's own account, where a payment names it: "Your account", or "The company". */
  owner: string
}

export function shows({ account_type, money_kind }: WorkspaceAccount): Shows {
  const business = account_type === 'business'
  return {
    bankTransfers: money_kind !== 'stablecoin',
    onChain: money_kind !== 'fiat',
    convert: money_kind === 'hybrid',
    instantTransfer: money_kind === 'hybrid',
    team: business,
    payoutBatches: business,
    cardTiers: business ? ['Team', 'Business', 'Enterprise'] : ['Daily', 'Premium', 'Platinum'],
    agents: business ? 'Your team’s agents' : 'Your agents',
    owner: business ? 'The company' : 'Your account',
  }
}

export const TYPE_LABEL: Record<AccountType, string> = { business: 'Business', personal: 'Personal' }
export const KIND_LABEL: Record<MoneyKind, string> = { fiat: 'Fiat only', stablecoin: 'Stablecoin and crypto only', hybrid: 'Hybrid' }
export const KIND_LINE: Record<MoneyKind, string> = {
  fiat: 'Your agents pay ordinary bills with cards and bank transfers.',
  stablecoin: 'Your agents work on chain.',
  hybrid: 'Both side by side, under one set of rules.',
}
const KIND_CHIP: Record<MoneyKind, string> = { fiat: 'Fiat', stablecoin: 'Stablecoin', hybrid: 'Hybrid' }

/** The account's chip, as the switcher shows it: "Business · Hybrid". */
export const accountChip = (a: WorkspaceAccount) => `${TYPE_LABEL[a.account_type]} · ${KIND_CHIP[a.money_kind]}`

/** Every workspace Lens had before B59.6 became Business and Hybrid, so nothing it used disappeared. */
const AS_MIGRATED: WorkspaceAccount = { account_type: 'business', money_kind: 'hybrid' }

/**
 * The session's workspace's type and kind, and what they show. While the read is in flight `shows` is null and a
 * screen renders nothing that depends on it. A read that failed draws the screens as every existing workspace was
 * migrated, Business and Hybrid, so a failed read never empties someone's money screens; `account` stays null, so
 * nothing claims to know the type or kind.
 */
export function useAccount(): { account: WorkspaceAccount | null; shows: Shows | null } {
  const q = useQuery({ queryKey: ACCOUNT_KEY, queryFn: readWorkspaceAccount, staleTime: 60_000, retry: false })
  if (q.isPending) return { account: null, shows: null }
  if (q.isError) return { account: null, shows: shows(AS_MIGRATED) }
  return { account: q.data, shows: shows(q.data) }
}

/**
 * Whether the account is known to be Personal: false while it is read and when the read fails. It re-renders its caller
 * once at most, when a Personal account's answer arrives, so the shell and every route can ask it.
 */
export function usePersonal(): boolean {
  return (
    useQuery({
      queryKey: ACCOUNT_KEY,
      queryFn: readWorkspaceAccount,
      staleTime: 60_000,
      retry: false,
      select: (a) => a.account_type === 'personal',
      notifyOnChangeProps: ['data'],
    }).data === true
  )
}
