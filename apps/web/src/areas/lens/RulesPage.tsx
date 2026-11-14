import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { type UseQueryResult, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { inlineLink } from '@talyvor/ui'
import { Button, Card, Chip, Crumb, Dialog, Icon, Input, PageHeading, Select, Switch, pocketFocusRing, showSnack } from '@talyvor/ui/pocket'
import { APPROVALS_KEY, BOOK_KEY, OnThePhone, changedBy, rulesHistoryKey, rulesKey, useKeys, useRulesChange } from './AgentBank'
import { AgentFace } from './AgentFace'
import { CATALOG_KEY } from '../marketplace/parts'
import { marketApi } from '../marketplace/marketApi'
import { isSessionExpired } from '../../lib/productState'
import { PAYEES_KEY } from './Pay'
import { useRuleChoices } from './rulePickers'
import { RULE_TEMPLATES, type RuleTemplate } from './ruleTemplates'
import { useMoneyFigures } from './money'
import {
  type Agent,
  type AgentBook,
  type AgentRules,
  type AgentRulesVersion,
  type PayeeAllowance,
  type RuleSimulation,
  agentBankApi,
  limitText,
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

const MAIN_LIMITS = [
  ['approval_above_ulxc', 'Asks you above'],
  ['max_per_request_ulxc', 'At most on one request'],
  ['daily_limit_ulxc', 'At most a day'],
  ['monthly_limit_ulxc', 'At most a month'],
] as const
const MORE_LIMITS = [
  ['hourly_limit_ulxc', 'At most an hour'],
  ['weekly_limit_ulxc', 'At most a week'],
] as const
type LimitField = (typeof MAIN_LIMITS)[number][0] | (typeof MORE_LIMITS)[number][0]
type Switched = LimitField | 'hours' | 'payees' | 'allow' | 'models' | 'listings' | 'rate'

/** The form as typed: amounts in LXC as text, and whether each switched rule is on. */
interface Draft {
  limits: Record<LimitField, string>
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
  /** payee, amount in LXC as typed, per */
  allowances: [string, string, PayeeAllowance['per']][]
  modelCaps: [string, string][]
  payeeDay: [string, string][]
  payeeMonth: [string, string][]
  pause: boolean
  instant: boolean
}

const LIMIT_FIELDS: LimitField[] = [...MAIN_LIMITS.map(([f]) => f), ...MORE_LIMITS.map(([f]) => f)]

function draftOf(r: AgentRules): Draft {
  const limits = Object.fromEntries(LIMIT_FIELDS.map((f) => [f, limitText(r[f] ?? 0)])) as Record<LimitField, string>
  const allowances = Object.entries(r.payee_allowances ?? {}).map(([id, a]) => [id, limitText(a.amount_ulxc), a.per] as [string, string, PayeeAllowance['per']])
  return {
    limits,
    on: {
      ...(Object.fromEntries(LIMIT_FIELDS.map((f) => [f, (r[f] ?? 0) > 0])) as Record<LimitField, boolean>),
      hours: !!(r.active_from || r.active_until),
      payees: (r.allowed_payees ?? []).length > 0,
      allow: allowances.length > 0,
      models: (r.allowed_models ?? []).length > 0,
      listings: (r.allowed_listings ?? []).length > 0,
      rate: (r.requests_per_minute ?? 0) > 0,
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
    allowances,
    modelCaps: Object.entries(r.model_daily_limits_ulxc ?? {}).map(([m, v]) => [m, limitText(v)]),
    payeeDay: Object.entries(r.payee_daily_limits_ulxc ?? {}).map(([id, v]) => [id, limitText(v)]),
    payeeMonth: Object.entries(r.payee_monthly_limits_ulxc ?? {}).map(([id, v]) => [id, limitText(v)]),
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

const amounts = (pairs: [string, string][]) => Object.fromEntries(pairs.map(([k, t]) => [k, parseLXC(t) ?? 0] as const).filter(([, v]) => v > 0))

/**
 * The rules body Lens takes, from the form. A rule switched off is sent as none. Always allow and Instant transfer are
 * sent only when they changed: absent, Lens keeps what it holds, so a template or a save that does not touch them keeps
 * them as they are.
 */
function bodyOf(d: Draft, was: Draft, instantShown: boolean): AgentRules {
  const limit = (f: LimitField) => (d.on[f] ? (parseLXC(d.limits[f]) ?? 0) : 0)
  const allowances = d.on.allow
    ? Object.fromEntries(
        d.allowances.map(([id, t, per]) => [id, { amount_ulxc: parseLXC(t) ?? 0, per }] as const).filter(([id, a]) => id !== '' && a.amount_ulxc > 0),
      )
    : {}
  const wasAllowances = was.on.allow ? Object.fromEntries(was.allowances.map(([id, t, per]) => [id, { amount_ulxc: parseLXC(t) ?? 0, per }])) : {}
  return {
    max_per_request_ulxc: limit('max_per_request_ulxc'),
    hourly_limit_ulxc: limit('hourly_limit_ulxc'),
    daily_limit_ulxc: limit('daily_limit_ulxc'),
    weekly_limit_ulxc: limit('weekly_limit_ulxc'),
    monthly_limit_ulxc: limit('monthly_limit_ulxc'),
    approval_above_ulxc: limit('approval_above_ulxc'),
    requests_per_minute: d.on.rate ? (parseRate(d.rate) ?? 0) : 0,
    model_daily_limits_ulxc: amounts(d.modelCaps),
    allowed_models: d.on.models ? d.models : [],
    allowed_providers: d.providers,
    allowed_listings: d.on.listings ? d.listings : [],
    allowed_payees: d.on.payees ? d.allowed : [],
    blocked_payees: d.blocked,
    payee_daily_limits_ulxc: amounts(d.payeeDay),
    payee_monthly_limits_ulxc: amounts(d.payeeMonth),
    active_from: d.on.hours ? d.from.trim() : '',
    active_until: d.on.hours ? d.until.trim() : '',
    timezone: d.timezone.trim(),
    pause_on_unusual_spend: d.pause,
    ...(JSON.stringify(allowances) !== JSON.stringify(wasAllowances) ? { payee_allowances: allowances } : {}),
    ...(instantShown && d.instant !== was.instant ? { may_instant_transfer: d.instant } : {}),
  }
}

/** "payees Research may pay" from "Payees Research may pay". */
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)

/** "London" from "Europe/London". */
const cityOf = (zone: string) => (zone ? (zone.split('/').pop() ?? zone).replace(/_/g, ' ') : 'UTC')

/** A figure as the reference writes it in a sentence: "$400.00 (4,000 LXC)", or LXC alone while no rate backs it. */
function useFigure() {
  const figures = useMoneyFigures()
  return (ulxc: number) => {
    const { cash, lxc } = figures.ulxc(ulxc)
    return cash ? `${cash} (${lxc})` : lxc
  }
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

/** Every rule this page draws that differs between two versions, in words: "Daily limit: was $400.00 (4,000 LXC), now …". */
function versionChanges(was: AgentRules, now: AgentRules, payeeName: (id: string) => string, figure: (ulxc: number) => string): string[] {
  const out: string[] = []
  const amount = (v: number | undefined) => ((v ?? 0) > 0 ? figure(v ?? 0) : 'none')
  const limits: [LimitField, string][] = [
    ['approval_above_ulxc', 'Asks you above'],
    ['max_per_request_ulxc', 'Limit per request'],
    ['hourly_limit_ulxc', 'Hourly limit'],
    ['daily_limit_ulxc', 'Daily limit'],
    ['weekly_limit_ulxc', 'Weekly limit'],
    ['monthly_limit_ulxc', 'Monthly limit'],
  ]
  for (const [f, rule] of limits) if ((was[f] ?? 0) !== (now[f] ?? 0)) out.push(`${rule}: was ${amount(was[f])}, now ${amount(now[f])}`)
  const rate = (n: number | undefined) => ((n ?? 0) > 0 ? String(n) : 'none')
  if ((was.requests_per_minute ?? 0) !== (now.requests_per_minute ?? 0)) out.push(`Requests a minute: was ${rate(was.requests_per_minute)}, now ${rate(now.requests_per_minute)}`)
  const hours = (r: AgentRules) => (r.active_from || r.active_until ? `${r.active_from || 'any time'} to ${r.active_until || 'any time'} ${cityOf(r.timezone)} time` : 'any time')
  if (hours(was) !== hours(now)) out.push(`Hours: was ${hours(was)}, now ${hours(now)}`)
  const lists: [keyof AgentRules, string, string, (id: string) => string][] = [
    ['allowed_payees', 'Who it may pay', 'anyone', payeeName],
    ['blocked_payees', 'Never pays', 'nobody', payeeName],
    ['allowed_models', 'Models', 'any', (id) => id],
    ['allowed_providers', 'Providers', 'any', (id) => id],
    ['allowed_listings', 'Marketplace listings', 'any', (id) => id],
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
  useRuleChoices()
  useKeys()
  const agent = book.data?.agents.find((a) => a.id === id)
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
  // A rollback puts other rules in force: the form starts again from them.
  const [round, setRound] = useState(0)
  if (rules.isError) return <p className="text-body text-ink-2">{isSessionExpired(rules.error) ? 'These rules can’t be read until you sign in again.' : `${agent.name}’s rules could not be read just now.`}</p>
  if (!rules.data) return <p className="text-body text-ink-3">Reading…</p>
  return <RulesEditor key={round} agent={agent} book={book} rules={rules.data} onRolledBack={() => setRound((n) => n + 1)} />
}

function RulesEditor({ agent, book, rules, onRolledBack }: { agent: Agent; book: AgentBook; rules: AgentRules; onRolledBack: () => void }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const figures = useMoneyFigures()
  const figure = useFigure()
  const payees = usePayees(agent, book)
  const choices = useRuleChoices()
  const instantShown = useAccount().shows?.instantTransfer === true
  const [was] = useState(() => draftOf(rules))
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
  const typedAmounts = [
    ...LIMIT_FIELDS.filter((f) => d.on[f]).map((f) => d.limits[f]),
    ...(d.on.allow ? d.allowances.map(([, t]) => t) : []),
    ...d.modelCaps.map(([, t]) => t),
    ...d.payeeDay.map(([, t]) => t),
    ...d.payeeMonth.map(([, t]) => t),
  ]
  const badAmount = typedAmounts.some((t) => t.trim() !== '' && parseLXC(t) === null)
  const badRate = d.on.rate && parseRate(d.rate) === null
  const bad = badAmount || badRate
  const body = bodyOf(d, was, instantShown)
  const nothing = JSON.stringify(body) === JSON.stringify(bodyOf(was, was, instantShown))
  const change = useRulesChange(agent.id)
  const judged = change.judgedFor({ rules: body })
  const history = useQuery({ queryKey: rulesHistoryKey(agent.id), queryFn: () => agentBankApi.rulesHistory(agent.id) })
  const save = useMutation({
    // signed: this save is the second press, after Lens said it loosens the rules and the passkey signs it.
    mutationFn: (_signed: boolean) => change.run({ rules: body }, (assertion) => agentBankApi.setRules(agent.id, body, assertion)),
    onSuccess: async (saved, signed) => {
      if (saved === null) return
      qc.setQueryData(rulesKey(agent.id), saved)
      await qc.invalidateQueries({ queryKey: rulesHistoryKey(agent.id) })
      const version = qc.getQueryData<{ versions: AgentRulesVersion[] | null }>(rulesHistoryKey(agent.id))?.versions?.[0]?.version
      showSnack({
        title: version ? `${agent.name}’s rules are saved as version ${version}` : `${agent.name}’s rules are saved`,
        line: signed ? 'Your passkey was asked first, because the change loosens them.' : 'Tightening is saved at once.',
      })
      navigate(`/agents/${encodeURIComponent(agent.id)}`)
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
    const next = draftOf(t.rules)
    // A template names every rule but Always allow and Instant transfer, which it leaves as they are.
    setD((x) => ({ ...next, allowances: x.allowances, on: { ...next.on, allow: x.on.allow }, instant: x.instant }))
    setFilled(t)
    setUnchanged(false)
  }
  const lxcLine = (f: LimitField) => {
    const v = d.on[f] ? parseLXC(d.limits[f]) : null
    if (v === null || v <= 0) return undefined
    const cash = figures.ulxc(v).cash
    return cash ? <span className="font-figure">{cash}</span> : undefined
  }
  const modelName = (m: string) => choices.models.flatMap((g) => g.options).find((o) => o.value === m)?.label ?? m
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
            <Button disabled={bad || save.isPending} onClick={submit}>
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
      {badAmount ? <p role="alert" className="text-body text-ink">A limit is an amount of LXC with at most six decimals, or empty.</p> : null}
      {badRate ? <p role="alert" className="text-body text-ink">Requests a minute is a whole number, or empty.</p> : null}
      {save.isError ? <p role="alert" className="text-body text-ink">{refusalText(save.error)}</p> : null}
      <div className="grid items-start gap-4 wide:grid-cols-12 [&>*]:min-w-0">
        <Card tone="white" className="wide:col-span-8" data-testid="rules-rows">
          {MAIN_LIMITS.map(([f, title]) => (
            <RuleRow key={f} title={title} line={lxcLine(f)} on={d.on[f]} onSwitch={(on) => turn(f, on)}>
              <Input
                aria-label={`${title} for ${agent.name}, in LXC`}
                inputMode="decimal"
                unit="LXC"
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
              (parseLXC(d.limits.approval_above_ulxc) ?? 0) > 0 && d.on.approval_above_ulxc
                ? (
                    <>
                      Above <span className="font-figure">{figures.ulxc(parseLXC(d.limits.approval_above_ulxc) ?? 0).cash ?? figures.ulxc(parseLXC(d.limits.approval_above_ulxc) ?? 0).lxc}</span>, up to this,
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
          <RuleRow title="Only these models" on={d.on.models} onSwitch={(on) => turn('models', on)}>
            {d.on.models ? (
              <IdList
                label={`Models ${agent.name} may use`}
                chosen={d.models}
                options={choices.models.flatMap((g) => g.options).map((o) => ({ id: o.value, name: o.label }))}
                nameOf={modelName}
                onChange={(models) => set({ models })}
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
          <RuleRow title="At most requests a minute" on={d.on.rate} onSwitch={(on) => turn('rate', on)}>
            {d.on.rate ? (
              <Input aria-label={`Requests a minute for ${agent.name}`} inputMode="numeric" placeholder="No limit" value={d.rate} onChange={(e) => set({ rate: e.target.value })} />
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
            choices={choices}
            modelName={modelName}
            filled={filled}
            onFill={fill}
          />
          <WouldItPass agent={agent} book={book} modelGroups={choices.models} providers={choices.providers} />
        </div>
      </div>
    </>
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
            aria-label={`Always allow ${payees.nameOf(id)} from ${agent.name}, in LXC a ${per}`}
            inputMode="decimal"
            unit={`LXC a ${per}`}
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
            const changes = older ? versionChanges(older.rules, v.rules, payeeName, figure) : []
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
  choices,
  modelName,
  filled,
  onFill,
}: {
  agent: Agent
  d: Draft
  set: (p: Partial<Draft>) => void
  turn: (k: Switched, on: boolean) => void
  payees: ReturnType<typeof usePayees>
  choices: ReturnType<typeof useRuleChoices>
  modelName: (m: string) => string
  filled: RuleTemplate | null
  onFill: (t: RuleTemplate) => void
}) {
  const [open, setOpen] = useState<string | null>(null)
  const limitNow = (f: LimitField) => (d.on[f] && (parseLXC(d.limits[f]) ?? 0) > 0 ? `${d.limits[f]} LXC` : 'No limit')
  const zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : []
  const capNow = (pairs: [string, string][], name: (k: string) => string) => (pairs.length > 0 ? pairs.map(([k, t]) => `${name(k)}, ${t || 0} LXC`).join('; ') : 'None')
  const items: { key: string; title: string; now: string; field: React.ReactNode }[] = [
    ...MORE_LIMITS.map(([f, title]) => ({
      key: f,
      title,
      now: limitNow(f),
      field: (
        <Input
          aria-label={`${title} for ${agent.name}, in LXC`}
          inputMode="decimal"
          unit="LXC"
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
      key: 'providers',
      title: 'Only these providers',
      now: d.providers.length > 0 ? d.providers.map((p) => choices.providers.find((x) => x.value === p)?.label ?? p).join(', ') : 'Any provider',
      field: (
        <IdList
          label={`Providers ${agent.name} may use`}
          chosen={d.providers}
          options={choices.providers.map((p) => ({ id: p.value, name: p.label }))}
          nameOf={(p) => choices.providers.find((x) => x.value === p)?.label ?? p}
          onChange={(providers) => set({ providers })}
        />
      ),
    },
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
      key: 'model-caps',
      title: 'At most a day on one model',
      now: capNow(d.modelCaps, modelName),
      field: <Caps label={`A day on one model for ${agent.name}`} pairs={d.modelCaps} nameOf={modelName} options={choices.models.flatMap((g) => g.options).map((o) => ({ id: o.value, name: o.label }))} onChange={(modelCaps) => set({ modelCaps })} />,
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
                <span className="block text-body text-ink-3">{it.now}</span>
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

/** Caps by a model or a payee: each with its amount in LXC, and one more to add. */
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
            aria-label={`${label}: ${nameOf(k)}, in LXC`}
            inputMode="decimal"
            unit="LXC"
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
 * B28.30 — Would it pass?: a question to a model or a payment to another of the workspace's agents, and an amount, judged
 * by Lens with the agent's rules as a real one is, against what it has really spent. Nothing is spent, paid or sent for
 * approval. A paused agent is refused by Lens; the page says so in the reference's words.
 */
function WouldItPass({
  agent,
  book,
  modelGroups,
  providers,
}: {
  agent: Agent
  book: AgentBook
  modelGroups: ReturnType<typeof useRuleChoices>['models']
  providers: ReturnType<typeof useRuleChoices>['providers']
}) {
  const figure = useFigure()
  const others = book.agents.filter((a) => a.id !== agent.id && !a.archived_at)
  const [what, setWhat] = useState('')
  const [amount, setAmount] = useState('')
  const micros = parseLXC(amount)
  const payee = what.startsWith('agent:') ? what.slice(6) : null
  const model = what.startsWith('model:') ? what.slice(6) : ''
  const provider = providers[modelGroups.findIndex((g) => g.options.some((o) => o.value === model))]?.value ?? ''
  const sim = useMutation({
    mutationFn: () =>
      agentBankApi.simulate(agent.id, payee ? { amount_ulxc: micros ?? 0, payee: { kind: 'agent', id: payee } } : { amount_ulxc: micros ?? 0, model, provider }),
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
          if (micros === null) return setNoAmount(true)
          if (!sim.isPending) sim.mutate()
        }}
      >
        <Select
          aria-label={`What ${agent.name} would do`}
          value={what}
          onChange={(e) => {
            setWhat(e.target.value)
            sim.reset()
          }}
        >
          <option value="">A question to any model</option>
          {modelGroups
            .filter((g) => g.options.length > 0)
            .map((g) => (
              <optgroup key={g.label} label={`A question to ${g.label}`}>
                {g.options.map((o) => (
                  <option key={o.value} value={`model:${o.value}`}>
                    {o.label}
                  </option>
                ))}
              </optgroup>
            ))}
          {others.length > 0 ? (
            <optgroup label="A payment to">
              {others.map((a) => (
                <option key={a.id} value={`agent:${a.id}`}>
                  {a.name}
                </option>
              ))}
            </optgroup>
          ) : null}
        </Select>
        <span className="flex flex-wrap gap-2">
          <Input
            className="min-w-0 flex-1"
            aria-label={`Amount in LXC to try for ${agent.name}`}
            inputMode="decimal"
            unit="LXC"
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
          Give an amount in LXC first.
        </p>
      ) : null}
      {sim.data ? <Verdict agent={agent} book={book} answer={sim.data} figure={figure} /> : null}
      {sim.isError ? (
        <p role="alert" className="mt-2 text-body text-ink">
          {refusalText(sim.error)}
        </p>
      ) : null}
    </Card>
  )
}

function Verdict({ agent, book, answer, figure }: { agent: Agent; book: AgentBook; answer: RuleSimulation; figure: (ulxc: number) => string }) {
  const sentence = (s: string) => `${s.charAt(0).toUpperCase()}${s.slice(1)}${s.endsWith('.') ? '' : '.'}`
  const why =
    answer.verdict === 'allowed'
      ? `${agent.name}’s rules would let this through.`
      : answer.verdict === 'refused' && book.all_paused_at
        ? 'Every agent is paused, so its requests are refused until you start them again.'
        : answer.verdict === 'refused' && agent.paused_at
          ? `${agent.name} is paused, so its requests are refused until you resume it.`
          : sentence(answer.reason)
  const short = answer.verdict !== 'refused' && answer.amount_ulxc > answer.balance_ulxc ? ` It holds only ${figure(answer.balance_ulxc)}, so it could not pay this until it is funded.` : ''
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
        {why}
        {short} Nothing was spent.
      </span>
    </p>
  )
}
