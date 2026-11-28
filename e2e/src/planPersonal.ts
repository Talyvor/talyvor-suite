// B17.555 — a Personal account's plan, played by the testers on a synthetic person of its own (talyvor-lens B61.92).
//
// Two scenarios beside B61.61's plan-change, each on a Solo account made as a person:
//   plan-personal — Lens holds the account to Solo as a personal one, and Settings, Plan draws the person's ladder as Lens
//   states it (Solo, Crew and Fleet, each with its agents and people), and no plan of the company ladder.
//   plan-solo-free-exchange — Solo's free exchange line (talyvor-lens B61.58): an agent's conversion of exactly what the month
//   converts free, as Lens's public fees state it, takes no margin and buys all of it at the reference rate; the next one takes
//   the plan's margin, once, on all of it. Judged on the agent's GBP and USD statements and balances, never a status code.

import { randomBytes } from 'node:crypto'
import { ACTION_TIMEOUT_MS, fail } from './bank.ts'
import { type Conversion, type StatementLine, conversionFaults } from './currencyConvert.ts'
import { RUN_SALT } from './oracles.ts'
import { cardsIn, decidedLaddersVerdict, planPageLadderVerdict } from './planLadders.ts'
import { CannotTest, type Scenario, type ScenarioCtx, type Verdict } from './scenarios.ts'
import { call, said } from './settings.ts'

/** The plan a person starts on: the person's ladder's first. */
const SOLO = 'personal_solo'
/** What the second conversion sells, all of it above the free line: £100.00. */
const ABOVE_FREE_MINOR = 10_000
/** A quote far above anything the agent sells, to read what of the month's free conversions is left: £100,000.00. */
const PROBE_MINOR = 10_000_000

/** Lens holds the account to Solo as a personal account. */
export function soloPersonalVerdict(on: { plan: string; account_type?: string }): Verdict {
  if (on.plan !== SOLO || on.account_type !== 'personal') {
    return fail(`a synthetic person made on ${SOLO} is held to ${on.plan} as a ${on.account_type ?? '(no type)'} account, not ${SOLO} as a personal one`)
  }
  return { pass: true, detail: `Lens holds the person to ${SOLO} as a personal account` }
}

export function planPersonal(): Scenario {
  return {
    id: 'plan-personal',
    owner: 'talyvor-suite',
    items: ['B17.555', 'B61.92', 'B61.61'],
    plan: SOLO,
    own: true,
    title: "on Settings, Plan a person sees the person's ladder, Solo, Crew and Fleet, each with the agents and people Lens states, and no company plan",
    feature: 'Plans',
    run: async (ctx) => {
      const { env, app } = ctx
      const served = await env.lens.publicPlans()
      const decided = decidedLaddersVerdict(served)
      if (!decided.pass) return decided
      const on = await env.lens.workspacePlan(app.user)
      ctx.evidence.push({ note: `Lens holds the account to ${on.plan} as a ${on.account_type ?? '(no type)'} account` })
      const solo = soloPersonalVerdict(on)
      if (!solo.pass) return solo
      const page = await app.tab('/billing')
      try {
        const cards = await cardsIn(page, 'plan-settings', 'ladder-')
        ctx.evidence.push({ note: `Settings, Plan draws ${cards.map((c) => c.id).join(', ') || 'no plan'}` })
        const ladder = planPageLadderVerdict(served, 'personal', cards)
        if (!ladder.pass) return ladder
        const name = served.personal[0].name
        const current = (await page.getByTestId('plan-current').innerText({ timeout: ACTION_TIMEOUT_MS }).catch(() => '')).trim()
        if (!current.includes(`You are on ${name}.`)) return fail(`Lens holds the person to ${name}, and Settings, Plan reads ${JSON.stringify(current)}`)
        return { pass: true, detail: `${solo.detail}; ${ladder.detail}; it reads "You are on ${name}."` }
      } finally {
        await page.close()
      }
    },
  }
}

/** One conversion as the agent's statements and balances read it after it: its quote, the entry it posted and both legs. */
export interface Converted {
  quote: Conversion
  entry: string
  /** The fx_conversion lines of the agent's GBP and USD statements after it, every conversion so far. */
  gbp: StatementLine[]
  usd: StatementLine[]
  /** The agent's GBP and USD balances before and after it. */
  before: { gbp: number; usd: number }
  after: { gbp: number; usd: number }
}

/**
 * Solo's free exchange line: `first` sells exactly the `freeLine` the month converts free and takes no margin, every penny
 * bought at the reference rate; `second`, the next, sells `ABOVE_FREE_MINOR` with nothing left free and takes the plan's
 * `marginBps` on all of it, once. Each posted one entry, its line of −sell on the GBP statement and +buy on the USD one, and
 * the balances moved by exactly those.
 */
export function freeLineVerdict(first: Converted, second: Converted, freeLine: number, marginBps: number): Verdict {
  const wrong = [
    ...conversionFaults(first.quote, freeLine, freeLine, marginBps).map((f) => `inside the free line: ${f}`),
    ...conversionFaults(second.quote, ABOVE_FREE_MINOR, 0, marginBps).map((f) => `the next one: ${f}`),
  ]
  for (const [n, c, upTo] of [['the first', first, 1], ['the next', second, 2]] as const) {
    const sold = c.quote.sell_minor
    const gbp = c.gbp.filter((l) => l.entry_id === c.entry)
    const usd = c.usd.filter((l) => l.entry_id === c.entry)
    if (c.gbp.length !== upTo || gbp.length !== 1 || gbp[0].amount_minor !== -sold) {
      wrong.push(`after ${n} conversion the GBP statement must show ${upTo} fx_conversion line${upTo === 1 ? '' : 's'}, one of entry ${c.entry} for −${sold}; it shows ${JSON.stringify(c.gbp)}`)
    }
    if (c.usd.length !== upTo || usd.length !== 1 || usd[0].amount_minor !== c.quote.buy_minor) {
      wrong.push(`after ${n} conversion the USD statement must show ${upTo} fx_conversion line${upTo === 1 ? '' : 's'}, one of entry ${c.entry} for +${c.quote.buy_minor}; it shows ${JSON.stringify(c.usd)}`)
    }
    if (c.after.gbp !== c.before.gbp - sold || c.after.usd !== c.before.usd + c.quote.buy_minor) {
      wrong.push(`${n} conversion must move the agent's accounts by −${sold} GBP and +${c.quote.buy_minor} USD: GBP ${c.before.gbp} → ${c.after.gbp}, USD ${c.before.usd} → ${c.after.usd}`)
    }
  }
  if (wrong.length > 0) return fail(wrong.join('; '))
  return {
    pass: true,
    detail: `${freeLine} pence, the month's free line, converted with no margin in entry ${first.entry} for ${first.quote.buy_minor} cents at ${first.quote.reference_rate}; ` +
      `the next ${ABOVE_FREE_MINOR} took the plan's ${marginBps} bps once, ${second.quote.margin_minor} pence, in entry ${second.entry} for ${second.quote.buy_minor} cents; ` +
      `GBP ${first.before.gbp} → ${second.after.gbp}, USD ${first.before.usd} → ${second.after.usd}`,
  }
}

export function planSoloFreeExchange(): Scenario {
  return {
    id: 'plan-solo-free-exchange',
    owner: 'talyvor-lens',
    items: ['B17.555', 'B61.58', 'B61.92'],
    plan: SOLO,
    own: true,
    agents: 1,
    feature: 'Currency conversion',
    title: "on Solo, a person's agent converts the month's free line with no margin, and the next conversion is charged Solo's margin once",
    run: async (ctx) => runFreeLine(ctx),
  }
}

async function runFreeLine(ctx: ScenarioCtx): Promise<Verdict> {
  const step = async <T>(method: string, path: string, body: unknown, note: string) => {
    const r = await call<T>(ctx, method, path, body)
    ctx.evidence.push({ note, answer: said(r) })
    return r
  }
  const { lens } = ctx.env
  const user = ctx.app.user
  const on = await lens.workspacePlan(user)
  const solo = soloPersonalVerdict(on)
  if (!solo.pass) return solo
  const freeLine = ctx.env.fees.fx_free_minor?.[SOLO]
  const marginBps = ctx.env.fees.fx_margin_bps?.[SOLO]
  ctx.evidence.push({ note: `Lens's public fees state Solo converts ${freeLine ?? '(not stated)'} free a month, then ${marginBps ?? '(not stated)'} bps` })
  if (freeLine === undefined || marginBps === undefined) return fail(`Lens's public fees must state Solo's fx_free_minor and fx_margin_bps; they state ${freeLine} and ${marginBps}`)
  if (freeLine <= 0) throw new CannotTest(`Solo's fx_free_minor is ${freeLine}, so it has no free line below a fee`)
  if (marginBps === 0) throw new CannotTest('Solo converts with no margin, so nothing above the free line is charged')

  // 1. The terms, the person's GBP and USD accounts, one agent's under them, and its money limits cleared.
  const terms = await step<{ terms: { capability: string; version: number; accepted?: unknown }[] | null }>('GET', '/v1/workspaces/{ws}/terms', undefined, 'the person reads the terms')
  for (const t of (terms.value?.terms ?? []).filter((x) => x.accepted == null)) {
    const ok = await step('POST', `/v1/workspaces/{ws}/terms/${t.capability}/accept`, { version: t.version }, `the person accepts ${t.capability}'s terms`)
    if (ok.status !== 201) return fail(`accepting ${t.capability}'s terms answered ${said(ok)}`)
  }
  const mine: Record<string, string> = {}
  for (const currency of ['GBP', 'USD']) {
    const opened = await step<{ id: string }>('POST', '/v1/money/accounts', { currency }, `the person's ${currency} account`)
    if (opened.status !== 201 || opened.value === undefined) return fail(`opening the person's ${currency} account answered ${said(opened)}`)
    mine[currency] = opened.value.id
  }
  const agent = await lens.createAgent(user, `Solo converter ${RUN_SALT}`)
  const own: Record<string, string> = {}
  for (const currency of ['GBP', 'USD']) {
    const opened = await step<{ id: string }>('POST', '/v1/money/accounts', { currency, agent_id: agent.id }, `${agent.name}'s ${currency} account`)
    if (opened.status !== 201 || opened.value === undefined) return fail(`opening ${agent.name}'s ${currency} account answered ${said(opened)}`)
    own[currency] = opened.value.id
  }
  const rules = await step('PUT', `/v1/workspaces/{ws}/agents/${agent.id}/rules`, { ...await lens.agentRules(user, agent.id), max_per_request_ulxc: 0,
    hourly_limit_ulxc: 0, daily_limit_ulxc: 0, weekly_limit_ulxc: 0, monthly_limit_ulxc: 0, approval_above_ulxc: 0 }, `${agent.name}'s money limits cleared`)
  if (rules.status !== 200) return fail(`clearing ${agent.name}'s money limits answered ${said(rules)}`)

  // 2. A fresh Solo account converts Lens's whole free line this month.
  const base = `/v1/workspaces/{ws}/agents/${agent.id}/money/convert`
  const quote = (sell: number, note: string) => step<Conversion>('POST', `${base}/quote`, { sell_currency: 'GBP', buy_currency: 'USD', sell_minor: sell }, note)
  const probe = await quote(PROBE_MINOR, 'a quote far above what the agent sells, for what converts free this month')
  if (probe.status !== 201 || probe.value === undefined) return fail(`a quote to convert GBP to USD must answer 201; Lens answered ${said(probe)}`)
  if (probe.value.free_minor !== freeLine) return fail(`a Solo account that has converted nothing this month must have its whole free line of ${freeLine} left; Lens's quote leaves ${probe.value.free_minor}`)

  // 3. Enough Sandbox money for both, given to the agent.
  const total = freeLine + ABOVE_FREE_MINOR
  const topped = await step('POST', `/v1/money/accounts/${mine.GBP}/test-money`, { amount_minor: total, idempotency_key: `e2e-${RUN_SALT}-solo-fx-person` },
    `${total} pence of Sandbox money into the person's GBP account`)
  if (topped.status !== 201) return fail(`Sandbox money into the person's GBP account answered ${said(topped)}`)
  const funded = await step('POST', `/v1/money/accounts/${own.GBP}/funding`, { direction: 'to_agent', amount_minor: total, idempotency_key: `e2e-${RUN_SALT}-solo-fx-agent` },
    `the person gives ${agent.name} ${total} pence from their GBP account`)
  if (funded.status !== 201) return fail(`giving ${agent.name} ${total} pence answered ${said(funded)}`)

  const balances = async (note: string): Promise<{ gbp: number; usd: number }> => {
    const r = await step<{ accounts: { id: string; test_minor: number }[] | null }>('GET', '/v1/money/accounts', undefined, note)
    const of = (id: string) => (r.value?.accounts ?? []).find((a) => a.id === id)?.test_minor
    const got = { gbp: of(own.GBP), usd: of(own.USD) }
    if (got.gbp === undefined || got.usd === undefined) throw new Error(`the accounts read back without ${agent.name}'s GBP and USD accounts: ${said(r)}`)
    return got as { gbp: number; usd: number }
  }
  const lines = async (account: string, note: string): Promise<StatementLine[]> => {
    const r = await step<{ lines: StatementLine[] | null }>('GET', `/v1/money/accounts/${account}/statement`, undefined, note)
    if (r.status !== 200) throw new Error(`the statement of ${account} answered ${said(r)}`)
    return (r.value?.lines ?? []).filter((l) => l.kind === 'fx_conversion')
  }
  // One conversion: quoted, converted under a key of its own, then read back on both statements and the balances.
  const convertOnce = async (sell: number, label: string): Promise<Converted | Verdict> => {
    const before = await balances(`${agent.name}'s accounts before ${label}`)
    const quoted = await quote(sell, `${agent.name} quotes ${sell} pence to USD, ${label}`)
    if (quoted.status !== 201 || quoted.value === undefined) return fail(`a quote of ${sell} pence to USD, ${label}, answered ${said(quoted)}`)
    const r = await lens.as(user.token, 'POST', base.replace('{ws}', user.workspaceID), { quote_id: quoted.value.id }, { 'Idempotency-Key': `e2e-${randomBytes(8).toString('hex')}` })
    ctx.evidence.push({ note: `${agent.name} converts at the quote, ${label}`, answer: `${r.status} ${r.text.slice(0, 300)}` })
    let done: Conversion | undefined
    try {
      done = JSON.parse(r.text) as Conversion
    } catch {
      done = undefined
    }
    if (r.status !== 200 || done?.status !== 'converted' || !done.entry_id) {
      return fail(`converting at quote ${quoted.value.id}, ${label}, must answer the conversion, converted, with its entry; Lens answered ${r.status} ${r.text.slice(0, 200)}`)
    }
    return { quote: quoted.value, entry: done.entry_id, gbp: await lines(own.GBP, `${agent.name}'s GBP statement after ${label}`),
      usd: await lines(own.USD, `${agent.name}'s USD statement after ${label}`), before, after: await balances(`${agent.name}'s accounts after ${label}`) }
  }

  try {
    // 4. Exactly the free line, then the next £100.00 above it.
    const first = await convertOnce(freeLine, 'inside the free line')
    if ('pass' in first) return first
    const second = await convertOnce(ABOVE_FREE_MINOR, 'the next one, above the free line')
    if ('pass' in second) return second
    const v = freeLineVerdict(first, second, freeLine, marginBps)
    return v.pass ? { pass: true, detail: `${solo.detail}; ${v.detail}` } : v
  } catch (e) {
    return fail((e as Error).message)
  }
}
