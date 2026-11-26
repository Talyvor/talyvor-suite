import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { type UseQueryResult, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { inlineLink, playSound } from '@talyvor/ui'
import { Button, Card, Chip, Crumb, Dialog, Icon, Input, Money, PageHeading, Pick, PickRow, Select, Switch, pocketFocusRing, showSnack, useDoneTick } from '@talyvor/ui/pocket'
import { APPROVALS_KEY, BOOK_KEY, OnThePhone, changedBy, rulesHistoryKey, rulesKey, useKeys, useRulesChange } from './AgentBank'
import { AgentFace } from './AgentFace'
import { CATALOG_KEY } from '../marketplace/parts'
import { marketApi } from '../marketplace/marketApi'
import { isSessionExpired } from '../../lib/productState'
import { PAYEES_KEY } from './Pay'
import { RULE_TEMPLATES, type RuleTemplate } from './ruleTemplates'
import { usePanelName } from '../../lib/pagePanel'
import { FX_KEY, fetchFX, pegQuery, useLensWords, useMoney, useMoneyFigures, type FXRates } from './money'
import { MERCHANT_CATEGORIES, merchantCategoriesText, merchantCategoryName } from './merchantCategories'
import { CURRENCY_WORDS, type MinorLimit, agentCurrency, convertDown, heldIn, parseRuleAmount, ruleAmountText } from './rulesCurrency'
import {
  type Agent,
  type AgentBook,
  type AgentRules,
  type AgentRulesSave,
  type AgentRulesVersion,
  type PayeeAllowance,
  type RuleSimulation,
  agentBankApi,
  dollarsText,
  limitText,
  parseDollars,
  parseLXC,
  refusalText,
  useAccount,
} from './agentBankApi'

// RulesPage.tsx — B57.23: /agents/:id/rules, an agent's rules on their own page, as Pocket's w-rules, w-rules-sales and
// w-rules-ops draw them. A row per rule with its value and a switch; the rules the page does not draw in rows under More
// rules; the history, where any version can be rolled back to after a confirm; and Would it pass?, which asks Lens to
// judge a request the agent has not made. Saving sends the rules body Lens takes today (PUT /api/agents/{id}/rules), and
// asks Lens first what the change does: a looser one needs the passkey (B55.14), a tighter one is saved at once. Every
// save and rollback is a new version in Lens; a save that changes nothing sends nothing.
//
// B61.87 — every amount limit is typed and shown in the account's own currency, the agent's (Lens B61.12): a save names the
// currency and each limit in its minor units, and no µLXC limit. Rules Lens still holds in another currency — dollars,
// for every agent's rules set before B61.12 — open converted at the day's rate, rounded down, for the owner to confirm,
// and that save names every limit, as Lens requires on a change of currency. Payee caps and Always allow stay in dollars
// at Lens's peg until Lens holds them in the rules' currency (B61.40). LXC is never shown. The model, provider and
// requests-a-minute rules are the parked gateway's: they are not drawn, and a save sends back what Lens holds unchanged.
//
// B61.64 — Merchants and categories (Lens B61.43): the merchant categories the agent may pay in by card, a row with its
// choices; a save names them only when they changed, and Lens judges allowing more as loosening, which asks the passkey.

const MAIN_LIMITS = [
  ['approval_above_minor', 'Asks you above'],
  ['max_per_payment_minor', 'At most on one request'],
  ['daily_limit_minor', 'At most a day'],
  ['monthly_limit_minor', 'At most a month'],
] as const
const MORE_LIMITS = [
  ['hourly_limit_minor', 'At most an hour'],
  ['weekly_limit_minor', 'At most a week'],
] as const
type LimitField = MinorLimit
type Switched = LimitField | 'hours' | 'payees' | 'allow' | 'models' | 'listings' | 'rate' | 'merchants'

/** Each limit's µLXC form, which a Lens older than B61.12 names alone: dollars at the peg. */
const ULXC_OF: Record<LimitField, keyof AgentRules> = {
  approval_above_minor: 'approval_above_ulxc',
  max_per_payment_minor: 'max_per_request_ulxc',
  daily_limit_minor: 'daily_limit_ulxc',
  monthly_limit_minor: 'monthly_limit_ulxc',
  hourly_limit_minor: 'hourly_limit_ulxc',
  weekly_limit_minor: 'weekly_limit_ulxc',
}

/** A limit as the rules hold it, in their own currency's minor units: from the µLXC form, cents at the peg, when Lens names no currency. */
function heldMinor(r: AgentRules, f: LimitField, peg: number): number {
  if (r.currency) return r[f] ?? 0
  const ulxc = (r[ULXC_OF[f]] as number | undefined) ?? 0
  return ulxc > 0 ? Math.max(Math.floor((ulxc * peg) / 10_000), 1) : 0
}

/** The form as typed: limits in the account's currency and payee amounts in dollars, as text, and whether each switched rule is on. */
interface Draft {
  /** the currency the limits are typed in: the account's */
  currency: string
  limits: Record<LimitField, string>
  /** B61.87 — each limit as the rules hold it in another currency, when the form opened them converted; null otherwise */
  converted: { from: string; minor: Record<LimitField, number> } | null
  on: Record<Switched, boolean>
  rate: string
  from: string
  until: string
  timezone: string
  models: string[]
  providers: string[]
  listings: string[]
  allowed: string[]
  blocked: string[]
  /** B61.64 — the merchant categories it may pay in by card, and those it never may */
  merchants: string[]
  blockedMerchants: string[]
  /** payee, amount in dollars as typed, per */
  allowances: [string, string, PayeeAllowance['per']][]
  modelCaps: [string, string][]
  payeeDay: [string, string][]
  payeeMonth: [string, string][]
  pause: boolean
  instant: boolean
}

const LIMIT_FIELDS: LimitField[] = [...MAIN_LIMITS.map(([f]) => f), ...MORE_LIMITS.map(([f]) => f)]

/** The form for rules r in currency: each limit converted at the day's rates (fx), rounded down, when r is held in another. */
function draftOf(r: AgentRules, peg: number, currency: string, fx: FXRates | undefined): Draft {
  const usd = (v: number) => dollarsText(v, peg)
  const from = r.currency ? heldIn(r) : 'USD'
  const held = Object.fromEntries(LIMIT_FIELDS.map((f) => [f, heldMinor(r, f, peg)])) as Record<LimitField, number>
  const minor = (f: LimitField) => (from === currency ? held[f] : (convertDown(held[f], from, currency, fx) ?? 0))
  const limits = Object.fromEntries(LIMIT_FIELDS.map((f) => [f, ruleAmountText(minor(f), currency)])) as Record<LimitField, string>
  const allowances = Object.entries(r.payee_allowances ?? {}).map(([id, a]) => [id, usd(a.amount_ulxc), a.per] as [string, string, PayeeAllowance['per']])
  return {
    currency,
    limits,
    converted: from === currency ? null : { from, minor: held },
    on: {
      ...(Object.fromEntries(LIMIT_FIELDS.map((f) => [f, held[f] > 0])) as Record<LimitField, boolean>),
      hours: !!(r.active_from || r.active_until),
      payees: (r.allowed_payees ?? []).length > 0,
      allow: allowances.length > 0,
      models: (r.allowed_models ?? []).length > 0,
      listings: (r.allowed_listings ?? []).length > 0,
      rate: (r.requests_per_minute ?? 0) > 0,
      merchants: (r.allowed_merchant_categories ?? []).length > 0,
    },
    rate: (r.requests_per_minute ?? 0) > 0 ? String(r.requests_per_minute) : '',
    from: r.active_from,
    until: r.active_until,
    timezone: r.timezone,
    models: r.allowed_models ?? [],
    providers: r.allowed_providers ?? [],
    listings: r.allowed_listings ?? [],
    allowed: r.allowed_payees ?? [],
    blocked: r.blocked_payees ?? [],
    merchants: r.allowed_merchant_categories ?? [],
    blockedMerchants: r.blocked_merchant_categories ?? [],
    allowances,
    modelCaps: Object.entries(r.model_daily_limits_ulxc ?? {}).map(([m, v]) => [m, limitText(v)]),
    payeeDay: Object.entries(r.payee_daily_limits_ulxc ?? {}).map(([id, v]) => [id, usd(v)]),
    payeeMonth: Object.entries(r.payee_monthly_limits_ulxc ?? {}).map(([id, v]) => [id, usd(v)]),
    pause: r.pause_on_unusual_spend ?? false,
    instant: r.may_instant_transfer ?? false,
  }
}

/** B28.26 — a cap on requests a minute: a whole number Lens can hold, or empty for none; null when neither. */
function parseRate(text: string): number | null {
  const t = text.trim()
  if (t === '') return 0
  if (!/^\d+$/.test(t)) return null
  const n = Number(t)
  return n <= 2_147_483_647 ? n : null
}

const amounts = (pairs: [string, string][], parse: (t: string) => number | null) =>
  Object.fromEntries(pairs.map(([k, t]) => [k, parse(t) ?? 0] as const).filter(([, v]) => v > 0))

/**
 * The rules body Lens takes, from the form: the currency and every limit in its minor units, and no µLXC limit. A rule
 * switched off is sent as none. Always allow, Instant transfer and the merchant categories are sent only when they changed: absent, Lens keeps what
 * it holds, so a template or a save that does not touch them keeps them as they are.
 */
function bodyOf(d: Draft, was: Draft, instantShown: boolean, peg: number): AgentRulesSave {
  const usd = (t: string) => parseDollars(t, peg)
  const limit = (f: LimitField) => (d.on[f] ? (parseRuleAmount(d.limits[f], d.currency) ?? 0) : 0)
  const allowances = d.on.allow
    ? Object.fromEntries(
        d.allowances.map(([id, t, per]) => [id, { amount_ulxc: usd(t) ?? 0, per }] as const).filter(([id, a]) => id !== '' && a.amount_ulxc > 0),
      )
    : {}
  const merchants = d.on.merchants ? d.merchants : []
  const sameList = (a: string[], b: string[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort())
  const merchantsChanged = !sameList(merchants, was.on.merchants ? was.merchants : []) || !sameList(d.blockedMerchants, was.blockedMerchants)
  const wasAllowances = was.on.allow ? Object.fromEntries(was.allowances.map(([id, t, per]) => [id, { amount_ulxc: usd(t) ?? 0, per }])) : {}
  return {
    currency: d.currency,
    max_per_payment_minor: limit('max_per_payment_minor'),
    hourly_limit_minor: limit('hourly_limit_minor'),
    daily_limit_minor: limit('daily_limit_minor'),
    weekly_limit_minor: limit('weekly_limit_minor'),
    monthly_limit_minor: limit('monthly_limit_minor'),
    approval_above_minor: limit('approval_above_minor'),
    requests_per_minute: d.on.rate ? (parseRate(d.rate) ?? 0) : 0,
    model_daily_limits_ulxc: amounts(d.modelCaps, parseLXC),
    allowed_models: d.on.models ? d.models : [],
    allowed_providers: d.providers,
    allowed_listings: d.on.listings ? d.listings : [],
    allowed_payees: d.on.payees ? d.allowed : [],
    blocked_payees: d.blocked,
    payee_daily_limits_ulxc: amounts(d.payeeDay, usd),
    payee_monthly_limits_ulxc: amounts(d.payeeMonth, usd),
    active_from: d.on.hours ? d.from.trim() : '',
    active_until: d.on.hours ? d.until.trim() : '',
    timezone: d.timezone.trim(),
    pause_on_unusual_spend: d.pause,
    ...(JSON.stringify(allowances) !== JSON.stringify(wasAllowances) ? { payee_allowances: allowances } : {}),
    ...(instantShown && d.instant !== was.instant ? { may_instant_transfer: d.instant } : {}),
    ...(merchantsChanged ? { allowed_merchant_categories: merchants, blocked_merchant_categories: d.blockedMerchants } : {}),
  }
}

/** "payees Research may pay" from "Payees Research may pay". */
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)

/** "London" from "Europe/London". */
const cityOf = (zone: string) => (zone ? (zone.split('/').pop() ?? zone).replace(/_/g, ' ') : 'UTC')

/** A figure as the reference writes it in a sentence: "$400.00", or "…" while no rate backs it. */
function useFigure() {
  const money = useMoney()
  return (ulxc: number) => money(ulxc) ?? '…'
}

/** Who a payee is: one of the workspace's agents, a saved payee, or its id. */
function usePayees(agent: Agent, book: AgentBook) {
  const saved = useQuery({ queryKey: PAYEES_KEY, queryFn: agentBankApi.payees, retry: false })
  const ours = book.agents.filter((a) => a.id !== agent.id && !a.archived_at).map((a) => ({ id: a.id, name: a.name }))
  const outside = (saved.data?.payees ?? []).map((p) => ({ id: p.id, name: p.name }))
  const known = [...ours, ...outside]
  // A company or a card shop the agent asked to pay is named by its approval, when no list names it.
  const approvals = useQuery({ queryKey: APPROVALS_KEY, queryFn: agentBankApi.approvals, retry: false })
  const asked = (approvals.data?.approvals ?? []).flatMap((a) => (a.payee ? [{ id: a.payee.id, name: a.payee.name }] : []))
  const nameOf = (id: string) => [...known, ...asked].find((p) => p.id === id && p.name)?.name ?? id
  return { known, nameOf }
}

/** B28.31 — how a version came to be, from Lens's change: set, template <id>, rollback to <n> or before history. */
function changeText(change: string): string {
  if (change === 'set') return 'Saved'
  if (change === 'before history') return 'As they were before history was kept'
  const template = /^template (.+)$/.exec(change)?.[1]
  if (template !== undefined) return `${RULE_TEMPLATES.find((t) => t.id === template)?.name ?? template} template applied`
  const back = /^rollback to (\d+)$/.exec(change)?.[1]
  if (back !== undefined) return `Rolled back to version ${back}`
  return change
}

/** Every rule this page draws that differs between two versions, in words: "Daily limit: was $400.00, now …". */
function versionChanges(
  was: AgentRules,
  now: AgentRules,
  payeeName: (id: string) => string,
  figure: (ulxc: number) => string,
  inMoney: (minor: number, currency: string) => string,
): string[] {
  const out: string[] = []
  const limits: [LimitField, string][] = [
    ['approval_above_minor', 'Asks you above'],
    ['max_per_payment_minor', 'Limit per request'],
    ['hourly_limit_minor', 'Hourly limit'],
    ['daily_limit_minor', 'Daily limit'],
    ['weekly_limit_minor', 'Weekly limit'],
    ['monthly_limit_minor', 'Monthly limit'],
  ]
  // B61.87 — a version kept in a currency reads in it; one kept before B61.12, by its µLXC form.
  const limit = (r: AgentRules, f: LimitField) => {
    const v = r.currency ? (r[f] ?? 0) : ((r[ULXC_OF[f]] as number | undefined) ?? 0)
    return { key: `${r.currency ?? ''}:${v}`, text: v > 0 ? (r.currency ? inMoney(v, heldIn(r)) : figure(v)) : 'none' }
  }
  for (const [f, rule] of limits) {
    const [a, b] = [limit(was, f), limit(now, f)]
    if (a.key !== b.key && a.text !== b.text) out.push(`${rule}: was ${a.text}, now ${b.text}`)
  }
  const hours = (r: AgentRules) => (r.active_from || r.active_until ? `${r.active_from || 'any time'} to ${r.active_until || 'any time'} ${cityOf(r.timezone)} time` : 'any time')
  if (hours(was) !== hours(now)) out.push(`Hours: was ${hours(was)}, now ${hours(now)}`)
  const lists: [keyof AgentRules, string, string, (id: string) => string][] = [
    ['allowed_payees', 'Who it may pay', 'anyone', payeeName],
    ['blocked_payees', 'Never pays', 'nobody', payeeName],
    ['allowed_listings', 'Marketplace listings', 'any', (id) => id],
    ['allowed_merchant_categories', 'Merchants and categories', 'any', merchantCategoryName],
    ['blocked_merchant_categories', 'Never these merchants', 'none', merchantCategoryName],
  ]
  for (const [f, rule, none, name] of lists) {
    const text = (v: AgentRules[keyof AgentRules]) => {
      const ids = [...((v as string[] | null | undefined) ?? [])].sort()
      return ids.length > 0 ? ids.map(name).join(', ') : none
    }
    if (text(was[f]) !== text(now[f])) out.push(`${rule}: was ${text(was[f])}, now ${text(now[f])}`)
  }
  const allow = (a: PayeeAllowance | undefined) => (a ? `up to ${figure(a.amount_ulxc)} a ${a.per}` : 'none')
  const [wa, na] = [was.payee_allowances ?? {}, now.payee_allowances ?? {}]
  for (const id of [...new Set([...Object.keys(wa), ...Object.keys(na)])].sort()) {
    if (wa[id]?.amount_ulxc !== na[id]?.amount_ulxc || wa[id]?.per !== na[id]?.per) out.push(`Always allows ${payeeName(id)}: was ${allow(wa[id])}, now ${allow(na[id])}`)
  }
  if (Boolean(was.pause_on_unusual_spend) !== Boolean(now.pause_on_unusual_spend))
    out.push(`Pauses if its spending looks unusual: was ${was.pause_on_unusual_spend ? 'on' : 'off'}, now ${now.pause_on_unusual_spend ? 'on' : 'off'}`)
  return out
}

/** "20 Oct", and its year when it is not this one. */
function shortDay(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) })
}

/** /agents/:id/rules, mounted afresh for each id (AgentPageRoute.tsx). */
export function RulesPage({ id }: { id: string }) {
  const book = useQuery({ queryKey: BOOK_KEY, queryFn: agentBankApi.book })
  // Every read the page draws from starts here at once, rather than each when the part above it has drawn.
  useQuery({ queryKey: rulesKey(id), queryFn: () => agentBankApi.rules(id) })
  useQuery({ queryKey: rulesHistoryKey(id), queryFn: () => agentBankApi.rulesHistory(id) })
  useQuery({ queryKey: PAYEES_KEY, queryFn: agentBankApi.payees, retry: false })
  useKeys()
  const agent = book.data?.agents.find((a) => a.id === id)
  // B61.121 — on the web it opens in the right panel over the agent's page.
  usePanelName('Rules')
  return (
    <section data-design="pocket" className="grid gap-5 px-gutter pb-8 pt-4 wide:px-8 [&>*]:min-w-0" data-testid="rules-page">
      <Crumb
        trail={[
          { label: 'Agents', href: '/agents' },
          { label: agent?.name ?? 'Agent', href: `/agents/${encodeURIComponent(id)}` },
          { label: 'Rules' },
        ]}
      />
      {book.isError ? (
        <p className="text-body text-ink-2">{isSessionExpired(book.error) ? 'These rules can’t be read until you sign in again.' : 'These rules could not be read just now. Nothing changed.'}</p>
      ) : !book.data ? (
        <p className="text-body text-ink-3">Reading…</p>
      ) : !agent ? (
        <p className="text-body text-ink-2">There is no agent here. It may have been archived.</p>
      ) : (
        <Rules key={agent.id} agent={agent} book={book.data} />
      )}
    </section>
  )
}

function Rules({ agent, book }: { agent: Agent; book: AgentBook }) {
  const rules = useQuery({ queryKey: rulesKey(agent.id), queryFn: () => agentBankApi.rules(agent.id) })
  const peg = useQuery(pegQuery)
  // A rollback puts other rules in force: the form starts again from them.
  const [round, setRound] = useState(0)
  if (rules.isError) return <p className="text-body text-ink-2">{isSessionExpired(rules.error) ? 'These rules can’t be read until you sign in again.' : `${agent.name}’s rules could not be read just now.`}</p>
  if (peg.isError) return <p className="text-body text-ink-2">{isSessionExpired(peg.error) ? 'These rules can’t be read until you sign in again.' : `${agent.name}’s rules could not be read just now.`}</p>
  if (!rules.data || peg.data?.usd_per_lxc === undefined) return <p className="text-body text-ink-3">Reading…</p>
  return <InCurrency key={round} agent={agent} book={book} rules={rules.data} peg={peg.data.usd_per_lxc} onRolledBack={() => setRound((n) => n + 1)} />
}

/** B61.87 — the rules in the account's currency: the day's rates are read first when they are held in another and a rate is needed. */
function InCurrency({ agent, book, rules, peg, onRolledBack }: { agent: Agent; book: AgentBook; rules: AgentRules; peg: number; onRolledBack: () => void }) {
  const currency = agentCurrency(agent) ?? heldIn(rules)
  const from = rules.currency ? heldIn(rules) : 'USD'
  const needsRate = convertDown(1, from, currency, undefined) === null
  const fx = useQuery({ queryKey: FX_KEY, queryFn: fetchFX, retry: false, staleTime: 60 * 60_000, enabled: needsRate })
  if (needsRate && fx.isError)
    return (
      <p className="text-body text-ink-2">
        {agent.name}’s rules are held in {CURRENCY_WORDS[from]}, and today’s rate to {CURRENCY_WORDS[currency]} could not be read just now. Nothing changed.
      </p>
    )
  if (needsRate && !fx.data) return <p className="text-body text-ink-3">Reading…</p>
  return <RulesEditor agent={agent} book={book} rules={rules} peg={peg} currency={currency} fx={fx.data} onRolledBack={onRolledBack} />
}

function RulesEditor({
  agent,
  book,
  rules,
  peg,
  currency,
  fx,
  onRolledBack,
}: {
  agent: Agent
  book: AgentBook
  rules: AgentRules
  peg: number
  currency: string
  fx: FXRates | undefined
  onRolledBack: () => void
}) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const figure = useFigure()
  const payees = usePayees(agent, book)
  const instantShown = useAccount().shows?.instantTransfer === true
  const [was] = useState(() => draftOf(rules, peg, currency, fx))
  const inMoney = useMoneyFigures().minor
  const words = CURRENCY_WORDS[currency] ?? currency
  const [d, setD] = useState(was)
  const [filled, setFilled] = useState<RuleTemplate | null>(null)
  const [unchanged, setUnchanged] = useState(false)
  const set = (patch: Partial<Draft>) => {
    setUnchanged(false)
    setD((x) => ({ ...x, ...patch }))
  }
  const turn = (k: Switched, on: boolean) => {
    setUnchanged(false)
    setD((x) => ({ ...x, on: { ...x.on, [k]: on } }))
  }
  const badLimit = LIMIT_FIELDS.some((f) => d.on[f] && parseRuleAmount(d.limits[f], currency) === null)
  const typedAmounts = [...(d.on.allow ? d.allowances.map(([, t]) => t) : []), ...d.payeeDay.map(([, t]) => t), ...d.payeeMonth.map(([, t]) => t)]
  const badAmount = typedAmounts.some((t) => parseDollars(t, peg) === null)
  const bad = badLimit || badAmount
  const body = bodyOf(d, was, instantShown, peg)
  // Rules opened converted from another currency are a change by themselves: saving them holds them in this one.
  const nothing = was.converted === null && JSON.stringify(body) === JSON.stringify(bodyOf(was, was, instantShown, peg))
  const change = useRulesChange(agent.id)
  const judged = change.judgedFor({ rules: body })
  const history = useQuery({ queryKey: rulesHistoryKey(agent.id), queryFn: () => agentBankApi.rulesHistory(agent.id) })
  // B61.129 — a save that asked for no passkey is a small job: Save rules ticks, then the page goes back to the agent.
  const tick = useDoneTick()
  const save = useMutation({
    // signed: this save is the second press, after Lens said it loosens the rules and the passkey signs it.
    mutationFn: (_signed: boolean) => change.run({ rules: body }, (assertion) => agentBankApi.setRules(agent.id, body, assertion)),
    onSuccess: async (saved, signed) => {
      if (saved === null) return
      playSound('moved')
      qc.setQueryData(rulesKey(agent.id), saved)
      await qc.invalidateQueries({ queryKey: rulesHistoryKey(agent.id) })
      const version = qc.getQueryData<{ versions: AgentRulesVersion[] | null }>(rulesHistoryKey(agent.id))?.versions?.[0]?.version
      showSnack({
        title: version ? `${agent.name}’s rules are saved as version ${version}` : `${agent.name}’s rules are saved`,
        line: signed ? 'Your passkey was asked first, because the change loosens them.' : 'Tightening is saved at once.',
      })
      const back = () => navigate(`/agents/${encodeURIComponent(agent.id)}`)
      if (signed) back()
      else tick.finish(back)
    },
  })
  const submit = () => {
    if (bad || save.isPending) return
    if (nothing) {
      setUnchanged(true)
      return
    }
    save.mutate(judged?.signs === true)
  }
  const fill = (t: RuleTemplate) => {
    const next = draftOf(t.rules, peg, currency, fx)
    // A template names every rule but Always allow, Instant transfer and the merchant categories, which it leaves as they are.
    setD((x) => ({
      ...next,
      converted: x.converted,
      allowances: x.allowances,
      merchants: x.merchants,
      blockedMerchants: x.blockedMerchants,
      on: { ...next.on, allow: x.on.allow, merchants: x.on.merchants },
      instant: x.instant,
    }))
    setFilled(t)
    setUnchanged(false)
  }
  const catalog = useQuery({ queryKey: [...CATALOG_KEY, ''], queryFn: () => marketApi.catalog(''), enabled: d.on.listings })
  const listingName = (l: string) => catalog.data?.find((x) => x.id === l)?.title ?? l
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <AgentFace agent={agent} size={52} />
          <PageHeading line="Turn on the rules you want. Every change is kept in the history.">{agent.name}’s rules</PageHeading>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <Button asChild variant="secondary">
            <Link to={`/agents/${encodeURIComponent(agent.id)}`}>Cancel</Link>
          </Button>
          {judged?.phone ? null : (
            <Button disabled={bad || save.isPending} done={tick.done} onClick={submit}>
              {save.isPending ? 'Saving…' : judged?.signs ? 'Save with your passkey' : 'Save rules'}
            </Button>
          )}
        </div>
      </div>
      {judged?.signs ? (
        <Card tight className="text-body text-ink" data-testid="rules-loosen">
          This loosens {agent.name}’s rules: {judged.changes.join('. ')}. It needs your passkey. Tightening is saved at once.
        </Card>
      ) : judged?.phone ? (
        <OnThePhone>Loosen {agent.name}’s rules with a passkey on this browser: add this browser first.</OnThePhone>
      ) : null}
      {unchanged ? (
        <p role="status" className="text-body text-ink">
          Nothing changed. {agent.name}’s rules are as they were, so no new version was kept.
        </p>
      ) : null}
      {was.converted ? (
        <Card tight className="text-body text-ink" data-testid="rules-currency">
          {agent.name}’s rules are still held in {CURRENCY_WORDS[was.converted.from]}. Each limit below is in {words} at today’s rate, rounded down: check them, then save to hold the rules in {words}.
        </Card>
      ) : null}
      {badLimit ? <p role="alert" className="text-body text-ink">A limit is an amount in {words}, or empty.</p> : null}
      {badAmount ? <p role="alert" className="text-body text-ink">A payee’s amount is an amount in dollars, or empty.</p> : null}
      {save.isError ? <p role="alert" className="text-body text-ink">{refusalText(save.error)}</p> : null}
      <div className="grid items-start gap-4 wide:grid-cols-12 [&>*]:min-w-0">
        <Card tone="white" className="wide:col-span-8" data-testid="rules-rows">
          {MAIN_LIMITS.map(([f, title]) => (
            <RuleRow key={f} title={title} line={convertedLine(was, f, inMoney)} on={d.on[f]} onSwitch={(on) => turn(f, on)}>
              <Input
                aria-label={`${title} for ${agent.name}, in ${words}`}
                inputMode="decimal"
                unit={currency}
                placeholder="No limit"
                disabled={!d.on[f]}
                value={d.limits[f]}
                onChange={(e) => set({ limits: { ...d.limits, [f]: e.target.value } })}
              />
            </RuleRow>
          ))}
          <RuleRow title="Only at certain hours" line={`${cityOf(d.timezone)} time`} on={d.on.hours} onSwitch={(on) => turn('hours', on)}>
            <span className="flex items-center gap-2">
              <Input type="time" aria-label={`${agent.name} works from`} disabled={!d.on.hours} value={d.from} onChange={(e) => set({ from: e.target.value })} />
              <span className="text-body text-ink-3">to</span>
              <Input type="time" aria-label={`${agent.name} works until`} disabled={!d.on.hours} value={d.until} onChange={(e) => set({ until: e.target.value })} />
            </span>
          </RuleRow>
          <RuleRow title="Only these payees" line="Card shops count as payees" on={d.on.payees} onSwitch={(on) => turn('payees', on)}>
            {d.on.payees ? (
              <IdList
                label={`Payees ${agent.name} may pay`}
                chosen={d.allowed}
                options={payees.known}
                nameOf={payees.nameOf}
                byId
                onChange={(allowed) => set({ allowed, blocked: d.blocked.filter((b) => !allowed.includes(b)) })}
              />
            ) : null}
          </RuleRow>
          <RuleRow
            title="Always allow a payee"
            line={
              (parseRuleAmount(d.limits.approval_above_minor, currency) ?? 0) > 0 && d.on.approval_above_minor
                ? (
                    <>
                      Above <Money minor={parseRuleAmount(d.limits.approval_above_minor, currency) ?? 0} currency={currency} />, up to this,
                      without asking
                    </>
                  )
                : 'Up to this, without asking'
            }
            on={d.on.allow}
            onSwitch={(on) => turn('allow', on)}
          >
            {d.on.allow ? <Allowances agent={agent} d={d} payees={payees} onChange={(allowances) => set({ allowances })} /> : null}
          </RuleRow>
          <RuleRow title="Merchants and categories" line={merchantsLine(d)} on={d.on.merchants} onSwitch={(on) => turn('merchants', on)}>
            {d.on.merchants ? (
              <MerchantChoices
                label={`Merchants and categories ${agent.name} may pay in`}
                chosen={d.merchants}
                onChange={(merchants) => set({ merchants, blockedMerchants: d.blockedMerchants.filter((b) => !merchants.includes(b)) })}
              />
            ) : null}
          </RuleRow>
          <RuleRow title="Only these marketplace listings" on={d.on.listings} onSwitch={(on) => turn('listings', on)}>
            {d.on.listings ? (
              <IdList
                label={`Marketplace listings ${agent.name} may use`}
                chosen={d.listings}
                options={(catalog.data ?? []).map((l) => ({ id: l.id, name: l.title }))}
                nameOf={listingName}
                onChange={(listings) => set({ listings })}
              />
            ) : null}
          </RuleRow>
          <RuleRow title="Pauses if its spending looks unusual" line="When an hour’s spend reaches 5 times its usual rate" on={d.pause} onSwitch={(pause) => set({ pause })} />
          {instantShown ? (
            <RuleRow
              title="Can use Instant transfer"
              line={`Off by default. When it’s on, ${agent.name} can send Instant transfers inside these rules. Anything outside them waits for your yes.`}
              on={d.instant}
              onSwitch={(instant) => set({ instant })}
            />
          ) : null}
        </Card>
        <div className="grid gap-4 wide:col-span-4 [&>*]:min-w-0">
          <History agent={agent} payeeName={payees.nameOf} figure={figure} history={history} onRolledBack={onRolledBack} />
          <MoreRules
            agent={agent}
            d={d}
            set={set}
            turn={turn}
            payees={payees}
            peg={peg}
            filled={filled}
            onFill={fill}
          />
          {book.agents.some((a) => a.id !== agent.id && !a.archived_at) ? <WouldItPass agent={agent} book={book} currency={currency} /> : null}
        </div>
      </div>
    </>
  )
}

/** B61.87 — under a limit opened converted, what the rules hold it at: "Held at $500.00, rounded down at today’s rate". */
function convertedLine(was: Draft, f: LimitField, inMoney: (minor: number, currency: string) => string): string | undefined {
  const c = was.converted
  return c && c.minor[f] > 0 ? `Held at ${inMoney(c.minor[f], c.from)}, rounded down at today’s rate` : undefined
}

/** B61.64 — what the Merchants and categories row says now: "Software, hosting, freight", or any merchant; and those it never pays in. */
function merchantsLine(d: Draft): string {
  const allowed = d.on.merchants && d.merchants.length > 0 ? merchantCategoriesText(d.merchants) : 'Any merchant'
  return d.blockedMerchants.length > 0 ? `${allowed}. Never ${merchantCategoriesText(d.blockedMerchants).toLowerCase()}` : allowed
}

/** B61.64 — the merchant categories as Pocket's ticked choices (B57.198), each ticked to allow it; a code Lens holds that is not one of them is a choice too. */
function MerchantChoices({ label, chosen, onChange }: { label: string; chosen: string[]; onChange: (ids: string[]) => void }) {
  const choices = [...MERCHANT_CATEGORIES.map((c) => c.id), ...chosen.filter((id) => !MERCHANT_CATEGORIES.some((c) => c.id === id))]
  return (
    <PickRow label={label}>
      {choices.map((id) => (
        <Pick key={id} checked={chosen.includes(id)} onCheckedChange={(on) => onChange(on ? [...chosen, id] : chosen.filter((x) => x !== id))}>
          {merchantCategoryName(id)}
        </Pick>
      ))}
    </PickRow>
  )
}

/** A rule: its name over its line, its value, and the switch that turns it on. */
function RuleRow({ title, line, on, onSwitch, children }: { title: string; line?: React.ReactNode; on: boolean; onSwitch: (on: boolean) => void; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-line py-3 first:border-t-0 wide:flex-nowrap">
      <div className="min-w-0 basis-full wide:basis-2/5">
        <div className="font-semibold text-ink">{title}</div>
        {line ? <div className="text-body text-ink-3">{line}</div> : null}
      </div>
      <div className="min-w-0 flex-1">{children}</div>
      <Switch checked={on} aria-label={title} onCheckedChange={onSwitch} />
    </div>
  )
}

/** Chosen ids as removable chips, and a list that adds one more; with byId, an id typed in too (a card shop's). */
function IdList({
  label,
  chosen,
  options,
  nameOf,
  onChange,
  byId = false,
}: {
  label: string
  chosen: string[]
  options: { id: string; name: string }[]
  nameOf: (id: string) => string
  onChange: (ids: string[]) => void
  byId?: boolean
}) {
  const left = options.filter((o) => !chosen.includes(o.id))
  const lower = lowerFirst(label)
  return (
    <div className="grid gap-2" role="group" aria-label={label}>
      {chosen.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {chosen.map((c) => (
            <li key={c}>
              <button
                type="button"
                aria-label={`Take ${nameOf(c)} off`}
                className={`inline-flex items-center gap-1.5 rounded-pill bg-cloud-2 px-3 py-1 text-body text-ink disabled:opacity-50 ${pocketFocusRing}`}
                onClick={() => onChange(chosen.filter((x) => x !== c))}
              >
                {nameOf(c)}
                <Icon name="x" size={14} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {left.length > 0 ? (
        <Select aria-label={`Add to ${lower}`} value="" onChange={(e) => e.target.value && onChange([...chosen, e.target.value])}>
          <option value="">Add…</option>
          {left.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </Select>
      ) : null}
      {byId ? <AddById label={lower} onAdd={(id) => !chosen.includes(id) && onChange([...chosen, id])} /> : null}
    </div>
  )
}

/** A payee by its id — a company's, its agent's or a card shop's — added to a list, or said to be missing. */
function AddById({ label, onAdd }: { label: string; onAdd: (id: string) => void }) {
  const [typed, setTyped] = useState('')
  const [bad, setBad] = useState(false)
  const id = typed.trim()
  return (
    <>
      <span className="flex gap-2">
        <Input
          aria-label={`A payee’s id to add to ${label}`}
          placeholder="Payee id"
          value={typed}
          onChange={(e) => {
            setTyped(e.target.value)
            setBad(false)
          }}
        />
        <Button
          variant="secondary"
          onClick={() => {
            if (id === '' || /\s/.test(id)) return setBad(true)
            onAdd(id)
            setTyped('')
          }}
        >
          Add
        </Button>
      </span>
      {bad ? <p role="alert" className="text-body text-ink">Type a payee’s id first, with no spaces in it.</p> : null}
    </>
  )
}

/** B41.4 — Always allow, as a field: each payee with what it may be paid without asking, and one more to add. */
function Allowances({
  agent,
  d,
  payees,
  onChange,
}: {
  agent: Agent
  d: Draft
  payees: ReturnType<typeof usePayees>
  onChange: (a: Draft['allowances']) => void
}) {
  const [who, setWho] = useState('')
  const [noWho, setNoWho] = useState(false)
  const left = payees.known.filter((p) => !d.allowances.some(([id]) => id === p.id))
  return (
    <div className="grid gap-2">
      {d.allowances.map(([id, text, per], i) => (
        <span key={id} className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-body text-ink">{payees.nameOf(id)}</span>
          <Input
            aria-label={`Always allow ${payees.nameOf(id)} from ${agent.name}, in dollars a ${per}`}
            inputMode="decimal"
            unit={`USD a ${per}`}
            className="w-44"
            value={text}
            onChange={(e) => onChange(d.allowances.map((a, j) => (j === i ? [id, e.target.value, per] : a)))}
          />
          <button
            type="button"
            aria-label={`Stop always allowing ${payees.nameOf(id)}`}
            className={`rounded-pill p-1 text-ink-3 disabled:opacity-50 ${pocketFocusRing}`}
            onClick={() => onChange(d.allowances.filter((_, j) => j !== i))}
          >
            <Icon name="x" size={16} />
          </button>
        </span>
      ))}
      {left.length > 0 ? (
        <span className="flex gap-2">
          <Select aria-label={`A payee ${agent.name} always may pay`} value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="">Choose a payee…</option>
            {left.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          <Button
            variant="secondary"
            onClick={() => {
              if (who === '') return setNoWho(true)
              onChange([...d.allowances, [who, '', 'month']])
              setWho('')
            }}
          >
            Add
          </Button>
        </span>
      ) : null}
      {noWho && who === '' ? <p role="alert" className="text-body text-ink">Choose a payee first.</p> : null}
    </div>
  )
}

function History({
  agent,
  payeeName,
  figure,
  history,
  onRolledBack,
}: {
  agent: Agent
  payeeName: (id: string) => string
  figure: (ulxc: number) => string
  history: UseQueryResult<{ versions: AgentRulesVersion[] | null }>
  onRolledBack: () => void
}) {
  const qc = useQueryClient()
  const inMoney = useMoneyFigures().minor
  const versions = history.data?.versions ?? []
  const change = useRulesChange(agent.id)
  const [asking, setAsking] = useState<number | null>(null)
  const ask = useMutation({ mutationFn: (version: number) => change.judge({ rollback_to: version }) })
  const rollback = useMutation({
    mutationFn: ({ version }: { version: number; signed: boolean }) =>
      change.commit({ rollback_to: version }, (assertion) => agentBankApi.rollbackRules(agent.id, version, assertion)),
    onSuccess: (back, { version, signed }) => {
      const kept = (versions[0]?.version ?? 0) + 1
      setAsking(null)
      qc.setQueryData(rulesKey(agent.id), back)
      void qc.invalidateQueries({ queryKey: rulesHistoryKey(agent.id) })
      showSnack({
        title: `${agent.name}’s rules are back as they were at version ${version}`,
        line: signed ? `Your passkey was asked first, because this loosens them. The rollback is kept as version ${kept}.` : `The rollback is kept as version ${kept}.`,
      })
      onRolledBack()
    },
  })
  const judged = asking === null ? null : change.judgedFor({ rollback_to: asking })
  const close = () => {
    setAsking(null)
    change.reset()
    rollback.reset()
    ask.reset()
  }
  const kept = (versions[0]?.version ?? 0) + 1
  return (
    <Card data-testid="rules-history">
      <h2 className="font-display text-reading font-bold text-ink">History</h2>
      {history.isError ? (
        <p className="mt-2 text-body text-ink-2">{`${agent.name}’s rules history could not be read just now.`}</p>
      ) : !history.isSuccess ? (
        <p className="mt-2 text-body text-ink-3">Reading…</p>
      ) : versions.length === 0 ? (
        <p className="mt-2 text-body text-ink-2">{agent.name}’s rules have not been changed yet. Every save will be kept here.</p>
      ) : (
        <ol className="mt-2" aria-label={`Versions of ${agent.name}’s rules`}>
          {versions.map((v, i) => {
            const older = versions[i + 1]
            const changes = older ? versionChanges(older.rules, v.rules, payeeName, figure, inMoney) : []
            const what = older === undefined ? (v.version === 1 ? 'The first rules' : 'Older versions are not shown') : changes.length > 0 ? changes.join('. ') : 'Only rules this page does not show changed'
            return (
              <li key={v.version} className="grid gap-0.5 border-t border-line py-3" data-testid={`rules-version-${v.version}`}>
                <span className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-ink">Version {v.version}</span>
                  {i === 0 ? (
                    <Chip tone="good">In force</Chip>
                  ) : (
                    <button
                      type="button"
                      className={`text-body ${inlineLink}`}
                      aria-label={`Roll ${agent.name}’s rules back to version ${v.version}`}
                      disabled={rollback.isPending}
                      onClick={() => {
                        setAsking(v.version)
                        ask.mutate(v.version)
                      }}
                    >
                      Roll back to this
                    </button>
                  )}
                </span>
                <span className="text-body text-ink-3">
                  {changeText(v.change)}
                  {changedBy(v.changed_by)}, {shortDay(v.created_at)} · {what}
                </span>
              </li>
            )
          })}
        </ol>
      )}
      <Dialog
        open={asking !== null}
        onClose={close}
        title={`Roll ${agent.name}’s rules back to version ${asking ?? ''}?`}
        actions={
          <>
            <Button variant="secondary" disabled={rollback.isPending} onClick={close}>
              Cancel
            </Button>
            {judged === null || judged.phone ? null : (
              <Button disabled={rollback.isPending} onClick={() => asking !== null && rollback.mutate({ version: asking, signed: judged.signs })}>
                {rollback.isPending ? 'Rolling back…' : judged.signs ? 'Roll back with your passkey' : 'Roll back'}
              </Button>
            )}
          </>
        }
      >
        <div data-testid="rules-rollback-ask" className="grid gap-2">
          {ask.isError ? (
            <p role="alert">{refusalText(ask.error)}</p>
          ) : judged === null ? (
            <p>Reading…</p>
          ) : judged.looser ? (
            <p>
              This loosens {agent.name}’s rules: {judged.changes.join('. ')}.{judged.signs || judged.phone ? ' It needs your passkey.' : ''}
            </p>
          ) : (
            <p>{judged.changes.length > 0 ? `${judged.changes.join('. ')}.` : 'Nothing this page shows changes.'}</p>
          )}
          {judged === null ? null : judged.phone ? (
            <OnThePhone>Loosen {agent.name}’s rules with a passkey on this browser: add this browser first.</OnThePhone>
          ) : (
            <p className="text-body text-ink-3">
              {judged.signs ? 'Your passkey asks first. ' : judged.looser ? '' : 'This tightens them, so it is saved at once. '}The rollback is kept as version {kept}, so you can see it in the history.
            </p>
          )}
          {rollback.isError ? <p role="alert">{refusalText(rollback.error)}</p> : null}
        </div>
      </Dialog>
    </Card>
  )
}

/** The rules the rows do not draw, each opened in place: a row with what is set now, and its field under it. */
function MoreRules({
  agent,
  d,
  set,
  turn,
  payees,
  peg,
  filled,
  onFill,
}: {
  agent: Agent
  d: Draft
  set: (p: Partial<Draft>) => void
  turn: (k: Switched, on: boolean) => void
  payees: ReturnType<typeof usePayees>
  peg: number
  filled: RuleTemplate | null
  onFill: (t: RuleTemplate) => void
}) {
  const [open, setOpen] = useState<string | null>(null)
  const money = useMoney()
  const dollars = (t: string) => money(parseDollars(t, peg) ?? 0) ?? '…'
  const typedLimit = (f: LimitField) => parseRuleAmount(d.limits[f], d.currency) ?? 0
  const inMoney = useMoneyFigures().minor
  const limitNow = (f: LimitField) => (d.on[f] && typedLimit(f) > 0 ? inMoney(typedLimit(f), d.currency) : 'No limit')
  const zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : []
  const capNow = (pairs: [string, string][], name: (k: string) => string) => (pairs.length > 0 ? pairs.map(([k, t]) => `${name(k)}, ${dollars(t)}`).join('; ') : 'None')
  const items: { key: string; title: string; now: string; field: React.ReactNode }[] = [
    ...MORE_LIMITS.map(([f, title]) => ({
      key: f,
      title,
      now: limitNow(f),
      field: (
        <Input
          aria-label={`${title} for ${agent.name}, in ${CURRENCY_WORDS[d.currency] ?? d.currency}`}
          inputMode="decimal"
          unit={d.currency}
          placeholder="No limit"
          value={d.on[f] ? d.limits[f] : ''}
          onChange={(e) => {
            set({ limits: { ...d.limits, [f]: e.target.value } })
            turn(f, e.target.value.trim() !== '')
          }}
        />
      ),
    })),
    {
      key: 'blocked',
      title: 'Never these payees',
      now: d.blocked.length > 0 ? d.blocked.map(payees.nameOf).join(', ') : 'None',
      field: (
        <IdList
          label={`Payees ${agent.name} may never pay`}
          chosen={d.blocked}
          options={payees.known}
          nameOf={payees.nameOf}
          byId
          onChange={(blocked) => set({ blocked, allowed: d.allowed.filter((a) => !blocked.includes(a)) })}
        />
      ),
    },
    {
      key: 'payee-day',
      title: 'At most a day to one payee',
      now: capNow(d.payeeDay, payees.nameOf),
      field: <Caps label={`A day to one payee from ${agent.name}`} pairs={d.payeeDay} nameOf={payees.nameOf} options={payees.known} byId onChange={(payeeDay) => set({ payeeDay })} />,
    },
    {
      key: 'payee-month',
      title: 'At most a month to one payee',
      now: capNow(d.payeeMonth, payees.nameOf),
      field: <Caps label={`A month to one payee from ${agent.name}`} pairs={d.payeeMonth} nameOf={payees.nameOf} options={payees.known} byId onChange={(payeeMonth) => set({ payeeMonth })} />,
    },
    {
      key: 'timezone',
      title: 'Time zone',
      now: cityOf(d.timezone),
      field: (
        <Select aria-label={`Time zone for ${agent.name}`} value={d.timezone || 'UTC'} onChange={(e) => set({ timezone: e.target.value })}>
          {[...new Set(['UTC', ...(d.timezone ? [d.timezone] : []), ...zones])].map((z) => (
            <option key={z} value={z}>
              {z.replace(/_/g, ' ')}
            </option>
          ))}
        </Select>
      ),
    },
    {
      key: 'templates',
      title: 'Start from a template',
      now: filled ? `${filled.name}: ${filled.summary} Save rules to apply it.` : 'Fills every rule; nothing changes until you save',
      field: (
        <div className="flex flex-wrap gap-2" role="group" aria-label={`Rule templates for ${agent.name}`}>
          {RULE_TEMPLATES.map((t) => (
            <Button key={t.id} variant="secondary" size="sm" aria-pressed={filled?.id === t.id} onClick={() => onFill(t)}>
              {t.name}
            </Button>
          ))}
        </div>
      ),
    },
  ]
  return (
    <Card tone="white" data-testid="more-rules">
      <h2 className="font-display text-reading font-bold text-ink">More rules</h2>
      <ul className="mt-2">
        {items.map((it) => (
          <li key={it.key} className="border-t border-line first:border-t-0">
            <a
              href={`#more-${it.key}`}
              aria-expanded={open === it.key}
              className={`flex w-full items-center gap-3 rounded-control py-2.5 text-left ${pocketFocusRing}`}
              onClick={(e) => {
                e.preventDefault()
                setOpen((o) => (o === it.key ? null : it.key))
              }}
            >
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-ink">{it.title}</span>
                <span className={`block text-body text-ink-3 ${/\d/.test(it.now) ? 'font-figure' : ''}`}>{it.now}</span>
              </span>
              <Icon name="chev" size={16} className={`shrink-0 text-ink-3 transition-transform duration-200 ${open === it.key ? 'rotate-90' : ''}`} />
            </a>
            {open === it.key ? <div className="pb-3">{it.field}</div> : null}
          </li>
        ))}
      </ul>
    </Card>
  )
}

/** Caps by a payee: each with its amount in dollars, and one more to add. */
function Caps({
  label,
  pairs,
  nameOf,
  options,
  onChange,
  byId = false,
}: {
  label: string
  pairs: [string, string][]
  nameOf: (k: string) => string
  options: { id: string; name: string }[]
  onChange: (p: [string, string][]) => void
  byId?: boolean
}) {
  const left = options.filter((o) => !pairs.some(([k]) => k === o.id))
  return (
    <div className="grid gap-2" role="group" aria-label={label}>
      {pairs.map(([k, t], i) => (
        <span key={k} className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-body text-ink">{nameOf(k)}</span>
          <Input
            aria-label={`${label}: ${nameOf(k)}, in dollars`}
            inputMode="decimal"
            unit="USD"
            className="w-36"
            value={t}
            onChange={(e) => onChange(pairs.map((p, j) => (j === i ? [k, e.target.value] : p)))}
          />
          <button type="button" aria-label={`Take ${nameOf(k)} off`} className={`rounded-pill p-1 text-ink-3 ${pocketFocusRing}`} onClick={() => onChange(pairs.filter((_, j) => j !== i))}>
            <Icon name="x" size={16} />
          </button>
        </span>
      ))}
      {left.length > 0 ? (
        <Select aria-label={`Add to ${lowerFirst(label)}`} value="" onChange={(e) => e.target.value && onChange([...pairs, [e.target.value, '']])}>
          <option value="">Add…</option>
          {left.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </Select>
      ) : null}
      {byId ? <AddById label={lowerFirst(label)} onAdd={(id) => !pairs.some(([k]) => k === id) && onChange([...pairs, [id, '']])} /> : null}
    </div>
  )
}

/**
 * B28.30 — Would it pass?: a payment to another of the workspace's agents (B61.14: a question to a model is the parked
 * gateway's), and an amount in the account's currency (B61.87), judged
 * by Lens with the agent's rules as a real one is, against what it has really spent. Nothing is spent, paid or sent for
 * approval. A paused agent is refused by Lens; the page says so in the reference's words.
 */
function WouldItPass({ agent, book, currency }: { agent: Agent; book: AgentBook; currency: string }) {
  const others = book.agents.filter((a) => a.id !== agent.id && !a.archived_at)
  const [payee, setPayee] = useState(others[0]?.id ?? '')
  const [amount, setAmount] = useState('')
  const typed = parseRuleAmount(amount, currency)
  const minor = typed !== null && typed > 0 ? typed : null
  const words = CURRENCY_WORDS[currency] ?? currency
  const sim = useMutation({
    // B61.87 — a payment from the agent's account, in its currency's minor units (Lens B61.12).
    mutationFn: () => agentBankApi.simulate(agent.id, { amount_ulxc: 0, amount_minor: minor ?? 0, currency, payee: { kind: 'agent', id: payee } }),
  })
  const [noAmount, setNoAmount] = useState(false)
  return (
    <Card tone="white" data-testid="would-it-pass">
      <h2 className="font-display text-reading font-bold text-ink">Would it pass?</h2>
      <p className="mt-1 text-body text-ink-3">Ask whether these rules would let a request through, counting what it has really spent. Nothing is spent, paid or sent for approval.</p>
      <form
        className="mt-3 grid gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (minor === null) return setNoAmount(true)
          if (!sim.isPending) sim.mutate()
        }}
      >
        <Select
          aria-label={`Who ${agent.name} would pay`}
          value={payee}
          onChange={(e) => {
            setPayee(e.target.value)
            sim.reset()
          }}
        >
          <optgroup label="A payment to">
            {others.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </optgroup>
        </Select>
        <span className="flex flex-wrap gap-2">
          <Input
            className="min-w-0 flex-1"
            aria-label={`Amount in ${words} to try for ${agent.name}`}
            inputMode="decimal"
            unit={currency}
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value)
              setNoAmount(false)
            }}
          />
          <Button type="submit" variant="secondary" disabled={sim.isPending}>
            {sim.isPending ? 'Asking…' : 'Would it pass?'}
          </Button>
        </span>
      </form>
      {noAmount ? (
        <p role="alert" className="mt-2 text-body text-ink">
          Give an amount in {words} first.
        </p>
      ) : null}
      {sim.data ? <Verdict agent={agent} book={book} answer={sim.data} /> : null}
      {sim.isError ? (
        <p role="alert" className="mt-2 text-body text-ink">
          {refusalText(sim.error)}
        </p>
      ) : null}
    </Card>
  )
}

function Verdict({ agent, book, answer }: { agent: Agent; book: AgentBook; answer: RuleSimulation }) {
  const words = useLensWords()
  const sentence = (s: string) => `${s.charAt(0).toUpperCase()}${s.slice(1)}${s.endsWith('.') ? '' : '.'}`
  const why =
    answer.verdict === 'allowed'
      ? `${agent.name}’s rules would let this through.`
      : answer.verdict === 'refused' && book.all_paused_at
        ? 'Every agent is paused, so its requests are refused until you start them again.'
        : answer.verdict === 'refused' && agent.paused_at
          ? `${agent.name} is paused, so its requests are refused until you resume it.`
          : sentence(words(answer.reason))
  return (
    <p role={answer.verdict === 'allowed' ? 'status' : 'alert'} className="mt-3 flex flex-wrap items-center gap-2 text-body text-ink" data-testid="rule-verdict">
      {answer.verdict === 'allowed' ? (
        <Chip tone="good" dot>
          Allowed
        </Chip>
      ) : answer.verdict === 'refused' ? (
        <Chip tone="bad" dot>
          Refused
        </Chip>
      ) : (
        <Chip tone="wait" dot>
          Asks you first
        </Chip>
      )}
      <span>
        {why} Nothing was spent.
      </span>
    </p>
  )
}
