// B56.29 — a currency conversion is charged its plan's FX margin, once (talyvor-lens B56.23), on a workspace of its own.
//
// currency-convert-margin, on Lens's API: the owner opens the company's GBP and USD accounts and one agent's GBP and USD accounts
// under them, and clears the agent's money limits, so the conversion is judged on its margin alone. A quote far above anything
// the agent sells reads how much the plan still converts free this month (B61.58: free_minor, the margin is on the rest), so the
// conversion sells exactly £100.00 above it. The owner puts that much Sandbox money into the company's GBP account and gives it to
// the agent, never through Stripe's form, so a launch run plays it. The agent quotes it to USD and converts under one
// Idempotency-Key: the quote's margin is the plan's fx_margin_bps as Lens's public fees state it, of the £100.00 above the free
// part, rounded up; the conversion is one fx_conversion entry, a line of −sell on the agent's GBP account and of +buy on its USD
// account, and what it buys is the rest after the margin at the Test partner's reference rate, so the margin stayed in GBP
// with Talyvor (its revenue account is no account a workspace reads). The same key again answers the same conversion, and
// there is still one entry. Judged on the accounts' statements and balances, never a status code alone.

import { randomBytes } from 'node:crypto'
import { fail } from './bank.ts'
import { RUN_SALT } from './oracles.ts'
import { CannotTest, type Scenario } from './scenarios.ts'
import { call, said } from './settings.ts'

/** What the conversion sells above what the plan converts free: £100.00. */
const ABOVE_FREE_MINOR = 10_000
/** A quote far above anything the agent sells, to read what of the month's free conversions is left: £100,000.00. */
const PROBE_MINOR = 10_000_000

/** A conversion as Lens answers it (economy.Conversion): the quote, and once converted, the entry that moved both legs. */
export interface Conversion {
  id: string
  agent_id: string
  from_account_id: string
  to_account_id: string
  sell_minor: number
  sell_currency: string
  margin_bps: number
  margin_minor: number
  free_minor: number
  buy_minor: number
  buy_currency: string
  reference_rate: string
  rate: string
  status: string
  entry_id?: string
}

/** One line of a currency account's statement (economy.MoneyStatementLine). */
export interface StatementLine {
  entry_id: string
  kind: string
  amount_minor: number
}

/**
 * What is wrong with a quote to sell `sellMinor` of GBP for USD, of which `freeMinor` converts free, on a plan whose margin is
 * `marginBps`: the margin is on the rest, rounded up, and what it buys is what is left after it at the reference rate, rounded
 * down to the cent.
 */
export function conversionFaults(q: Conversion, sellMinor: number, freeMinor: number, marginBps: number): string[] {
  const faults: string[] = []
  if (q.sell_minor !== sellMinor || q.sell_currency !== 'GBP' || q.buy_currency !== 'USD') {
    faults.push(`the quote must sell ${sellMinor} GBP for USD; it sells ${q.sell_minor} ${q.sell_currency} for ${q.buy_currency}`)
  }
  if (q.margin_bps !== marginBps) faults.push(`the quote's margin must be the plan's ${marginBps} basis points; it is ${q.margin_bps}`)
  if (q.free_minor !== freeMinor) faults.push(`the quote must convert the ${freeMinor} the month leaves free; its free_minor is ${q.free_minor}`)
  const margin = Math.ceil(((sellMinor - freeMinor) * marginBps) / 10_000)
  if (q.margin_minor !== margin) {
    faults.push(`the margin is ${marginBps} basis points of the ${sellMinor - freeMinor} above the ${freeMinor} that converts free, rounded up: ${margin}; the quote takes ${q.margin_minor}`)
  }
  const rate = Number(q.reference_rate)
  if (!(rate > 0)) {
    faults.push(`the quote must show the partner's reference rate; it shows "${q.reference_rate}"`)
  } else {
    const buy = Math.floor((sellMinor - margin) * rate)
    if (q.buy_minor !== buy) faults.push(`the ${sellMinor - margin} left after the margin buys ${buy} USD at ${q.reference_rate}; the quote buys ${q.buy_minor}`)
  }
  return faults
}

export function currencyConvertMargin(): Scenario {
  return {
    id: 'currency-convert-margin',
    owner: 'talyvor-lens',
    own: true,
    agents: 1,
    items: ['B56.29', 'B56.23'],
    feature: 'Currency conversion',
    title: "currency conversion: £100.00 above the month's free part converts to USD as one entry, charged the plan's FX margin in GBP, and the same key again converts nothing more",
    run: async (ctx) => {
      const step = async <T>(method: string, path: string, body: unknown, note: string) => {
        const r = await call<T>(ctx, method, path, body)
        ctx.evidence.push({ note, answer: said(r) })
        return r
      }
      const { lens } = ctx.env
      const user = ctx.app.user
      // 1. The terms, the company's GBP and USD accounts, and the agent's under them.
      const terms = await step<{ terms: { capability: string; version: number; accepted?: unknown }[] | null }>('GET', '/v1/workspaces/{ws}/terms', undefined, 'the owner reads the terms')
      for (const t of (terms.value?.terms ?? []).filter((x) => x.accepted == null)) {
        const ok = await step('POST', `/v1/workspaces/{ws}/terms/${t.capability}/accept`, { version: t.version }, `the owner accepts ${t.capability}'s terms`)
        if (ok.status !== 201) return fail(`accepting ${t.capability}'s terms answered ${said(ok)}`)
      }
      const company: Record<string, string> = {}
      for (const currency of ['GBP', 'USD']) {
        const opened = await step<{ id: string }>('POST', '/v1/money/accounts', { currency }, `the company's ${currency} account`)
        if (opened.status !== 201 || opened.value === undefined) return fail(`opening the company's ${currency} account answered ${said(opened)}`)
        company[currency] = opened.value.id
      }
      const agent = await lens.createAgent(user, `Converter ${RUN_SALT}`)
      const own: Record<string, string> = {}
      for (const currency of ['GBP', 'USD']) {
        const opened = await step<{ id: string }>('POST', '/v1/money/accounts', { currency, agent_id: agent.id }, `${agent.name}'s ${currency} account`)
        if (opened.status !== 201 || opened.value === undefined) return fail(`opening ${agent.name}'s ${currency} account answered ${said(opened)}`)
        own[currency] = opened.value.id
      }
      const rules = await step('PUT', `/v1/workspaces/{ws}/agents/${agent.id}/rules`, { ...await lens.agentRules(user, agent.id), max_per_request_ulxc: 0,
        hourly_limit_ulxc: 0, daily_limit_ulxc: 0, weekly_limit_ulxc: 0, monthly_limit_ulxc: 0, approval_above_ulxc: 0 }, `${agent.name}'s money limits cleared`)
      if (rules.status !== 200) return fail(`clearing ${agent.name}'s money limits answered ${said(rules)}`)

      // 2. What the plan converts free this month, and its margin as Lens's public fees state it.
      const base = `/v1/workspaces/{ws}/agents/${agent.id}/money/convert`
      const quote = (sell: number, note: string) => step<Conversion>('POST', `${base}/quote`, { sell_currency: 'GBP', buy_currency: 'USD', sell_minor: sell }, note)
      const probe = await quote(PROBE_MINOR, 'a quote far above what the agent sells, for what converts free this month')
      if (probe.status !== 201 || probe.value === undefined) return fail(`a quote to convert GBP to USD must answer 201; Lens answered ${said(probe)}`)
      const plan = (await lens.workspacePlan(user)).plan
      const marginBps = ctx.env.fees.fx_margin_bps?.[plan]
      if (marginBps === undefined) return fail(`Lens's public fees state no fx_margin_bps for the plan ${plan}`)
      if (marginBps === 0) throw new CannotTest(`the plan ${plan} converts with no margin, so no margin can be charged`)
      const free = probe.value.free_minor
      if (free >= PROBE_MINOR) throw new CannotTest(`the plan ${plan} converts ${PROBE_MINOR} pence free this month, so no margin is charged on what an agent sells`)
      const sell = free + ABOVE_FREE_MINOR

      // 3. That much Sandbox money, given to the agent.
      const topped = await step('POST', `/v1/money/accounts/${company.GBP}/test-money`, { amount_minor: sell, idempotency_key: `e2e-${RUN_SALT}-fx-company` },
        `${sell} pence of Sandbox money into the company's GBP account`)
      if (topped.status !== 201) return fail(`Sandbox money into the company's GBP account answered ${said(topped)}`)
      const funded = await step('POST', `/v1/money/accounts/${own.GBP}/funding`, { direction: 'to_agent', amount_minor: sell, idempotency_key: `e2e-${RUN_SALT}-fx-agent` },
        `the owner gives ${agent.name} ${sell} pence from the company's GBP account`)
      if (funded.status !== 201) return fail(`giving ${agent.name} ${sell} pence from the company's GBP account answered ${said(funded)}`)

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
      const convert = async (quoteID: string, key: string, note: string) => {
        const r = await lens.as(user.token, 'POST', base.replace('{ws}', user.workspaceID), { quote_id: quoteID }, { 'Idempotency-Key': key })
        ctx.evidence.push({ note, answer: `${r.status} ${r.text.slice(0, 300)}` })
        let value: Conversion | undefined
        try {
          value = JSON.parse(r.text) as Conversion
        } catch {
          value = undefined
        }
        return { status: r.status, value, text: r.text }
      }

      try {
        // 4. The quote: the plan's margin on the £100.00 above the free part, and the rest bought at the reference rate.
        const start = await balances(`${agent.name}'s accounts before the conversion`)
        if (start.gbp !== sell || start.usd !== 0) return fail(`given ${sell} pence, ${agent.name}'s accounts hold ${start.gbp} GBP and ${start.usd} USD`)
        const quoted = await quote(sell, `${agent.name} quotes ${sell} pence to USD`)
        if (quoted.status !== 201 || quoted.value === undefined) return fail(`a quote of ${sell} pence to USD answered ${said(quoted)}`)
        const q = quoted.value
        const faults = conversionFaults(q, sell, free, marginBps)
        if (faults.length > 0) return fail(faults.join('; '))

        // 5. Converted under one key: one fx_conversion entry, −sell on the GBP account and +buy on the USD account.
        const key = `e2e-${randomBytes(8).toString('hex')}`
        const done = await convert(q.id, key, `${agent.name} converts at the quote`)
        if (done.status !== 200 || done.value?.status !== 'converted' || !done.value.entry_id) {
          return fail(`converting at quote ${q.id} must answer the conversion, converted, with its entry; Lens answered ${done.status} ${done.text.slice(0, 200)}`)
        }
        const c = done.value
        const entry = c.entry_id ?? ''
        const after = await balances(`${agent.name}'s accounts after the conversion`)
        const gbpLines = await lines(own.GBP, `${agent.name}'s GBP statement`)
        const usdLines = await lines(own.USD, `${agent.name}'s USD statement`)
        const wrong: string[] = []
        if (gbpLines.length !== 1 || gbpLines[0].entry_id !== entry || gbpLines[0].amount_minor !== -sell) {
          wrong.push(`${agent.name}'s GBP statement must show one fx_conversion line of entry ${entry} for −${sell}; it shows ${JSON.stringify(gbpLines)}`)
        }
        if (usdLines.length !== 1 || usdLines[0].entry_id !== entry || usdLines[0].amount_minor !== q.buy_minor) {
          wrong.push(`${agent.name}'s USD statement must show one fx_conversion line of entry ${entry} for +${q.buy_minor}; it shows ${JSON.stringify(usdLines)}`)
        }
        if (after.gbp !== start.gbp - sell || after.usd !== start.usd + q.buy_minor) {
          wrong.push(`${agent.name}'s accounts must move by −${sell} GBP and +${q.buy_minor} USD: GBP ${start.gbp} → ${after.gbp}, USD ${start.usd} → ${after.usd}`)
        }
        if (wrong.length > 0) return fail(wrong.join('; '))

        // 6. The same key again answers the same conversion, and there is still one entry.
        const again = await convert(q.id, key, `${agent.name} converts again under the same Idempotency-Key`)
        const still = await balances(`${agent.name}'s accounts after the same key again`)
        const gbpAgain = await lines(own.GBP, `${agent.name}'s GBP statement after the same key again`)
        if (again.value?.id !== c.id || again.value.entry_id !== entry) {
          return fail(`the same Idempotency-Key again must answer conversion ${c.id} of entry ${entry}; Lens answered ${again.status} ${again.text.slice(0, 200)}`)
        }
        if (gbpAgain.length !== 1 || still.gbp !== after.gbp || still.usd !== after.usd) {
          return fail(`the same Idempotency-Key again converted again: ${gbpAgain.length} fx_conversion lines on the GBP statement, GBP ${after.gbp} → ${still.gbp}, USD ${after.usd} → ${still.usd}`)
        }
        return {
          pass: true,
          detail: `${sell} pence (${free} free this month) converted once in entry ${entry}: a margin of ${q.margin_minor} pence (${marginBps} bps of the ${ABOVE_FREE_MINOR} above) ` +
            `kept in GBP, ${q.buy_minor} cents bought at ${q.reference_rate}; GBP ${start.gbp} → ${after.gbp}, USD ${start.usd} → ${after.usd}; the same key again answered ${c.id} and moved nothing`,
        }
      } catch (e) {
        return fail((e as Error).message)
      }
    },
  }
}
