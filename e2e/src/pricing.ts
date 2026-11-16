// B32.15 — the approved prices, end to end. B61.90 — on Lens's own plans (talyvor-lens B61.57): synthetic workspaces
// made on Studio, Company and Group each make the same model call on their credits, and the oracle is Lens's ledger:
// the call's spend row and, beside it, one platform_fee row at the rate Lens states for the plan (GET
// /v1/public/fees), rounded up to the µLXC, never a status code. On Group the workspace then calls on its own provider
// key, and the ledger gains neither row. Studio's agent past the agents Lens states for it (GET /v1/public/plans) is
// refused naming its plan and the one that allows more; a seller's first $1.00 sale clears at 850,000 µUSD to the
// seller and 150,000 to Talyvor. B61.61 — what /pricing shows is planLadders.ts's.
//
// Each plan's agents, seats and fees are Lens's own figures, read on the night; the take and the prices below are
// the decided ones, typed here on purpose, so the run fails the night Lens charges or serves any other.

import { fail } from './bank.ts'
import { worstInputTokens } from './budget.ts'
import { platformFeeBPS } from './fees.ts'
import type { LedgerRow, MarketEarnings, PlanRefusal, Proxied, PublicPlan } from './lens.ts'
import { listPriceUSD } from './oracles.ts'
import { CannotTest, type Scenario, type ScenarioCtx, type Verdict } from './scenarios.ts'
import { buyFrom, clearedBothSides, payBill } from './trade.ts'

/** talyvor-lens B61.57 — the plans, by the keys Lens names them by: the personal ladder, then the business one. */
export type Plan = 'personal_solo' | 'personal_crew' | 'personal_fleet' | 'business_studio' | 'business_company' | 'business_group' | 'business_custom'
/** The business ladder's steps a tester's workspace is made on. */
export type TesterPlan = 'business_studio' | 'business_company' | 'business_group'

/** Talyvor's take of a marketplace sale, in basis points; the seller keeps the rest (B32.8, B32.9). */
export const MARKET_TAKE_BPS = 1500

/** Each tester plan as a scenario's title reads it; a verdict says Lens's own name (GET /v1/public/plans). */
const NAME: Readonly<Record<TesterPlan, string>> = { business_studio: 'Studio', business_company: 'Company', business_group: 'Group' }
/** A tester plan in a scenario's id: studio, company, group. */
const short = (plan: TesterPlan): string => plan.replace(/^business_/, '')
const BPS = 10_000
/** The one call every plan's workspace makes: the same model, question and length on each. */
export const PRICED_QUESTION = 'What is 417 + 268? Reply with the number only.'
const MAX_TOKENS = 16
/** How long a call's charge may take to reach the ledger; a call on an own key is waited on this long for a charge it must not make. */
const CHARGE_WAIT_MS = 15_000
/** A seller's first sale: one dollar, in µUSD. */
const DOLLAR_USD_MICROS = 1_000_000

/** The fee on a spend at bps, rounded up to the µLXC — written from the rule, not read from Lens. */
export function feeOn(spendULXC: number, bps: number): number {
  return Math.ceil((spendULXC * bps) / BPS)
}

const label = (bps: number): string => `Platform fee ${bps / 100}%`

/** The rows one call charged to credits wrote: its spend, and one platform_fee row of `bps` beside it. */
export function feeVerdict(fresh: readonly LedgerRow[], bps: number): Verdict {
  const spends = fresh.filter((r) => r.type === 'spend')
  const fees = fresh.filter((r) => r.type === 'platform_fee')
  if (spends.length !== 1) return fail(`one call charged to credits wrote ${spends.length} spend rows`)
  const spend = -spends[0].amount_ulxc
  if (!(spend > 0)) return fail(`the call's spend row debits ${spend} µLXC`)
  const want = feeOn(spend, bps)
  if (fees.length === 0) return fail(`Lens charged ${spend} µLXC for the call and wrote no platform_fee row; at ${bps} basis points the fee is ${want} µLXC`)
  if (fees.length > 1) return fail(`one call wrote ${fees.length} platform_fee rows: ${fees.map((f) => f.amount_ulxc).join(', ')} µLXC`)
  const f = fees[0]
  const wrong = [
    -f.amount_ulxc === want ? '' : `it debits ${-f.amount_ulxc} µLXC, not ${want} (${bps} basis points of ${spend}, rounded up)`,
    f.metadata?.platform_fee_bps === bps ? '' : `it names ${String(f.metadata?.platform_fee_bps)} basis points, not ${bps}`,
    f.metadata?.spend_ulxc === spend ? '' : `it is on a spend of ${String(f.metadata?.spend_ulxc)} µLXC, not the call's ${spend}`,
    f.balance_after_ulxc === spends[0].balance_after_ulxc - want ? '' : `its balance after is ${f.balance_after_ulxc}, not the spend row's ${spends[0].balance_after_ulxc} less ${want}`,
    f.description === label(bps) ? '' : `it reads "${f.description}", not "${label(bps)}"`,
  ].filter((w) => w !== '')
  if (wrong.length > 0) return fail(`the platform_fee row on a ${spend} µLXC spend: ${wrong.join('; ')}`)
  return { pass: true, detail: `one ${spend} µLXC spend row and beside it one −${want} µLXC "${label(bps)}" row: ${bps} basis points of the spend, rounded up` }
}

/** A call on the workspace's own provider key: Lens sent it on that key, and charged it nothing. */
export function ownKeyVerdict(asked: Proxied, fresh: readonly LedgerRow[]): Verdict {
  const charged = fresh.filter((r) => r.type === 'spend' || r.type === 'platform_fee')
  if (!asked.ownKey) return fail(`Lens did not send the call on the workspace's own key (no X-Talyvor-BYOK: own-key); it answered ${asked.status}${asked.error === undefined ? '' : ` "${asked.error}"`}`)
  if (charged.length > 0) return fail(`a call on the workspace's own key wrote ${charged.map((r) => `${r.type} ${r.amount_ulxc} µLXC`).join(' and ')}`)
  return {
    pass: true,
    detail: asked.reply !== undefined
      ? "answered on the workspace's own key, and the ledger gained no spend row and no platform_fee row"
      : `sent on the workspace's own key, which the provider refused (${asked.status}: the harness holds no real provider key, only a placeholder), and the ledger gained no spend row and no platform_fee row`,
  }
}

type Made = { status: number; agent?: { id: string }; refusal?: PlanRefusal }

/** The business ladder as Lens states it (GET /v1/public/plans), and `plan` on it; a ladder without it cannot be tested. */
export async function businessStep(ctx: ScenarioCtx, plan: TesterPlan): Promise<{ ladder: PublicPlan[]; step: PublicPlan }> {
  const ladder = (await ctx.env.lens.publicPlans()).business ?? []
  const step = ladder.find((p) => p.id === plan)
  if (step === undefined) throw new CannotTest(`Lens's public plans name no ${plan} on the business ladder: ${ladder.map((p) => p.id).join(', ') || 'none'}`)
  ctx.evidence.push({ note: `Lens states the business ladder: ${ladder.map((p) => `${p.name} (${p.id}) ${p.agents === -1 ? 'unlimited' : p.agents} agents, ${p.people === -1 ? 'unlimited' : p.people} people`).join('; ')}` })
  return { ladder, step }
}

/** The first plan above `plan` on its ladder that allows more than its `count`, as Lens's refusal looks for one (plans.Allowing). */
export function allowingMore(ladder: readonly PublicPlan[], plan: PublicPlan, count: (p: PublicPlan) => number): PublicPlan | undefined {
  const limit = count(plan)
  return ladder.slice(ladder.findIndex((p) => p.id === plan.id) + 1).find((p) => count(p) === -1 || count(p) > limit)
}

/**
 * Lens's answer to one agent past what `plan` allows: the plan's refusal (402) in Lens's plain sentence
 * (internal/plans RefuseCount, B55.29), naming the plan on its ladder that allows more, with LENS_PLAN_GATES in its
 * `setting` and never in the words. Every figure and name is Lens's own (GET /v1/public/plans).
 */
export function pastAgentsVerdict(r: Made, ladder: readonly PublicPlan[], plan: PublicPlan, ordinal: string): Verdict {
  const limit = plan.agents
  if (r.agent !== undefined) return fail(`a ${plan.name} workspace with ${limit} agents made a ${ordinal}, ${r.agent.id}`)
  const said = r.refusal?.error ?? ''
  if (r.status !== 402) return fail(`the ${ordinal} agent was refused ${r.status} "${said}", not by the plan (402)`)
  const allows = allowingMore(ladder, plan, (p) => p.agents)
  const more = allows === undefined ? ' A contract with Talyvor sets more.' : allows.agents === -1 ? ` ${allows.name} allows unlimited agents.` : ` ${allows.name} allows ${allows.agents}.`
  const want = `${plan.name} allows ${limit} agents, and all ${limit} are in use.${more}`
  if (said !== want) return fail(`the refusal "${said}" is not Lens's "${want}"`)
  const got: Partial<PlanRefusal> = r.refusal ?? {}
  if (got.setting !== 'LENS_PLAN_GATES') return fail(`the refusal's setting is ${got.setting === undefined ? 'missing' : `"${got.setting}"`}, not LENS_PLAN_GATES`)
  if (got.plan !== plan.id || got.gate !== 'agents' || got.limit !== limit || (got.allows ?? '') !== (allows?.id ?? '')) {
    return fail(`the refusal reads plan ${got.plan}, gate ${got.gate}, limit ${got.limit}, allowing ${got.allows}; not ${plan.id}, agents, ${limit}, ${allows?.id ?? 'none'}`)
  }
  return { pass: true, detail: `the ${ordinal} agent was refused in Lens's words: "${said}"` }
}

/** A seller's first sale of a dollar, cleared: the seller's share and Talyvor's take of the price before tax. */
export function splitVerdict(e: NonNullable<MarketEarnings['earnings']>[number] | undefined): Verdict {
  if (e === undefined) return fail('the bill was paid, but the seller has no earning from the sale')
  const keep = BPS - MARKET_TAKE_BPS
  const share = Math.floor((DOLLAR_USD_MICROS * keep) / BPS)
  const take = DOLLAR_USD_MICROS - share
  if (e.gross_usd_micros !== DOLLAR_USD_MICROS || e.share_usd_micros !== share || e.fee_usd_micros !== take) {
    return fail(`a $1.00 sale cleared at gross ${e.gross_usd_micros}, the seller's share ${e.share_usd_micros} and Talyvor's ${e.fee_usd_micros} µUSD; want ${DOLLAR_USD_MICROS}, ${share} and ${take}`)
  }
  return { pass: true, detail: `the $1.00 sale cleared at ${share} µUSD to the seller and ${take} µUSD to Talyvor, ${keep / 100}% and ${MARKET_TAKE_BPS / 100}% of the price before tax` }
}

// ─── reaching each figure ────────────────────────────────────────────────────

export async function within<T>(read: () => Promise<T>, done: (v: T) => boolean, ms: number): Promise<T> {
  const end = Date.now() + ms
  for (;;) {
    const v = await read()
    if (done(v) || Date.now() > end) return v
    await new Promise((r) => setTimeout(r, 2000))
  }
}

/**
 * One call through Lens's proxy on the workspace's account, its worst case held against the cap first, and the
 * ledger rows it wrote — read until `done` holds of them or `ms` pass. Its spend is booked for the read-back.
 */
async function call(ctx: ScenarioCtx, question: string, done: (rows: LedgerRow[]) => boolean): Promise<{ asked: Proxied; fresh: LedgerRow[] }> {
  const { env, app } = ctx
  const model = env.catalog.find((m) => m.id === env.judgeModel)
  if (model === undefined) throw new Error(`the catalog has no model ${env.judgeModel}`)
  const before = new Set((await env.lens.ledger(app.user)).map((r) => r.id))
  const hold = env.cap.reserve(listPriceUSD(model, worstInputTokens(question.length), MAX_TOKENS))
  let asked: Proxied
  try {
    asked = await env.lens.ask(app.user, env.judgeProvider, env.judgeModel, question, MAX_TOKENS)
  } catch (e) {
    env.cap.settle(hold, undefined)
    throw e
  }
  const fresh = await within(async () => (await env.lens.ledger(app.user)).filter((r) => !before.has(r.id)), done, CHARGE_WAIT_MS)
  const spends = fresh.filter((r) => r.type === 'spend')
  env.cap.settle(hold, (spends.reduce((s, r) => s - r.amount_ulxc, 0) / 1e6) * env.usdPerLXC)
  for (const r of spends) env.book.add(app.user.workspaceID, -r.amount_ulxc)
  ctx.evidence.push({
    note: `asked ${env.judgeModel}${asked.ownKey ? ' on the own key' : ''}: ${asked.status}${asked.reply?.replayed ? ', replayed' : ''}${asked.reply?.pooledULXC !== undefined ? ', from the pool' : ''}`,
    question,
    answer: asked.reply?.text,
    error: asked.error,
    ledger: fresh.map((r) => ({ type: r.type, amount_ulxc: r.amount_ulxc, created_at: r.created_at })),
  })
  return { asked, fresh }
}

const charged = (rows: LedgerRow[]): boolean => rows.some((r) => r.type === 'spend') && rows.some((r) => r.type === 'platform_fee')

// ─── the scenarios ───────────────────────────────────────────────────────────

export function pricingFee(plan: TesterPlan): Scenario {
  return {
    id: `pricing-fee-${short(plan)}`,
    owner: 'talyvor-lens',
    // B35.7 — on a workspace of its own; B61.90 — made on the plan itself (talyvor-lens B61.57).
    plan,
    own: true,
    title: `on ${NAME[plan]}, a model call charged to credits writes its spend row and one platform_fee row at the rate Lens states for ${NAME[plan]}, rounded up to the µLXC`,
    feature: 'Pricing',
    run: async (ctx) => {
      const on = await ctx.env.lens.workspacePlan(ctx.app.user)
      ctx.evidence.push({ note: `Lens holds the workspace to ${on.plan}` })
      if (on.plan !== plan) return fail(`a test workspace made on ${plan} is on ${on.plan}`)
      const bps = platformFeeBPS(ctx.env.fees, plan)
      ctx.evidence.push({ note: `Lens states the platform fee on ${plan} at ${bps} basis points (GET /v1/public/fees)` })
      const { asked, fresh } = await call(ctx, PRICED_QUESTION, charged)
      if (asked.reply === undefined) return fail(`the call was refused: ${asked.status} ${asked.error}`)
      if (asked.reply.replayed) throw new Error("Lens replayed the workspace's own earlier answer, which costs nothing: there is no fee to judge")
      return feeVerdict(fresh, bps)
    },
  }
}

/**
 * On Group, which includes own provider keys, the workspace saves one and asks a question nobody has asked,
 * so neither its cache nor the pool can answer it and Lens must send it on that key. The harness holds no real
 * provider key, so the provider refuses the placeholder: the oracles are Lens's own-key header and a ledger
 * that gains no spend row and no platform_fee row. The key is deleted after.
 */
export function pricingOwnKey(seed: number): Scenario {
  return {
    id: 'pricing-own-key',
    owner: 'talyvor-lens',
    plan: 'business_group',
    own: true,
    title: "on Group, a model call on the workspace's own provider key goes on that key, and the ledger gains no spend row and no platform_fee row",
    feature: 'Pricing',
    run: async (ctx) => {
      const { env, app } = ctx
      const on = await env.lens.workspacePlan(app.user)
      if (on.plan !== 'business_group') return fail(`a test workspace made on business_group is on ${on.plan}`)
      const provider = env.judgeProvider
      const saved = await env.lens.putProviderKey(app.user, provider, `sk-talyvor-e2e-placeholder-${seed}-${Date.now().toString(36)}`)
      ctx.evidence.push({ note: `save an own ${provider} key: ${saved.status}${saved.ok ? '' : ` ${saved.error}`}` })
      if (!saved.ok && saved.status === 404) throw new CannotTest('Lens holds no provider keys on this deployment (LENS_PROVIDER_SECRET_KEK unset), so no call can be made on one')
      if (!saved.ok) return fail(`on Group, saving an own provider key was refused: ${saved.status} ${saved.error}`)
      try {
        const nonce = Date.now().toString(36)
        const { asked, fresh } = await call(ctx, `What is 512 + 291? Reply with the number only. (${nonce})`, () => false)
        return ownKeyVerdict(asked, fresh)
      } finally {
        await env.lens.deleteProviderKey(app.user, provider)
      }
    },
  }
}

/** Makes agents on the workspace until it has `upTo`, or why one was refused. */
async function agentsUpTo(ctx: ScenarioCtx, from: number, upTo: number, plan: string, label: string): Promise<string | undefined> {
  for (let n = from + 1; n <= upTo; n++) {
    const made = await ctx.env.lens.tryCreateAgent(ctx.app.user, `${label}-${n}`)
    if (made.agent === undefined) return `on ${plan}, agent ${n} of ${upTo} was refused: ${made.status} "${made.refusal?.error}"`
  }
  return undefined
}

export function pricingStudioAgents(seed: number): Scenario {
  return {
    id: 'pricing-studio-agents',
    owner: 'talyvor-lens',
    // B35.7 — Studio's own gate, on a workspace of its own: nothing else run by its user fills it first.
    plan: 'business_studio',
    own: true,
    title: "a Studio workspace makes the agents Lens states Studio allows; the next is refused in Lens's words, naming Studio and the plan that allows more, and the workspace keeps what it had",
    feature: 'Agent Wallets',
    run: async (ctx) => {
      const { env, app } = ctx
      const { ladder, step } = await businessStep(ctx, 'business_studio')
      const on = await env.lens.workspacePlan(app.user)
      ctx.evidence.push({ note: `Lens holds the workspace to ${on.plan}, with ${on.agents_used} agent(s)` })
      if (on.plan !== step.id) return fail(`a test workspace made on ${step.id} is on ${on.plan}`)
      if (step.agents === -1) throw new CannotTest(`Lens states ${step.name} allows unlimited agents, so there is no agent past it to refuse`)
      if (on.agents_used > step.agents) return fail(`a ${step.name} workspace already has ${on.agents_used} agents, more than its ${step.agents}`)
      const refused = await agentsUpTo(ctx, on.agents_used, step.agents, step.name, `Allowed ${seed}`)
      if (refused !== undefined) return fail(refused)
      const next = await env.lens.tryCreateAgent(app.user, `Past ${seed}`)
      ctx.evidence.push({ note: `create agent ${step.agents + 1}: ${next.status}`, answer: JSON.stringify(next.refusal ?? next.agent) })
      const v = pastAgentsVerdict(next, ladder, step, `${step.agents + 1}th`)
      if (!v.pass) return v
      const after = await env.lens.workspacePlan(app.user)
      if (after.agents_used !== step.agents) return fail(`refused, yet Lens counts ${after.agents_used} agents on the workspace, not ${step.agents}`)
      return v
    },
  }
}

/**
 * B35.7 — each paid plan's own gate, on a workspace of its own made on it (talyvor-lens B35.1): Company makes agents up
 * to what Lens states it allows and is refused the next, naming Company and the plan that allows more; Group makes
 * that next one. Each offers Slack and Teams approvals, as Lens's read of the workspace's plan says.
 */
export function planAgents(plan: 'business_company' | 'business_group', seed: number): Scenario {
  return {
    id: `plan-agents-${short(plan)}`,
    owner: 'talyvor-lens',
    plan,
    own: true,
    title: plan === 'business_company'
      ? "a Company workspace makes the agents Lens states Company allows and is refused the next in Lens's words, naming Company and the plan that allows more; Company offers Slack and Teams approvals"
      : "a Group workspace makes one agent past what Lens states Company allows; Group offers Slack and Teams approvals",
    feature: 'Agent Wallets',
    run: async (ctx) => {
      const { env, app } = ctx
      const { ladder, step: company } = await businessStep(ctx, 'business_company')
      if (company.agents === -1) throw new CannotTest('Lens states Company allows unlimited agents, so there is no agent past it')
      const past = company.agents + 1
      const on = await env.lens.workspacePlan(app.user)
      ctx.evidence.push({ note: `Lens holds the workspace to ${on.plan}, with ${on.agents_used} agent(s); its gates ${JSON.stringify(on.gates)}` })
      if (on.plan !== plan) return fail(`a test workspace made on ${plan} is on ${on.plan}`)
      if (on.gates.slack_teams_approvals !== true) return fail(`Lens's read of a ${NAME[plan]} workspace's plan does not offer Slack and Teams approvals: slack_teams_approvals is ${String(on.gates.slack_teams_approvals)}`)
      const refused = await agentsUpTo(ctx, on.agents_used, company.agents, NAME[plan], `Gate ${seed}`)
      if (refused !== undefined) return fail(refused)
      const last = await env.lens.tryCreateAgent(app.user, `Gate ${seed}-${past}`)
      ctx.evidence.push({ note: `create agent ${past}: ${last.status}`, answer: JSON.stringify(last.refusal ?? last.agent) })
      const after = await env.lens.workspacePlan(app.user)
      if (plan === 'business_group') {
        if (last.agent === undefined) return fail(`on Group, agent ${past} was refused: ${last.status} "${last.refusal?.error}"`)
        if (after.agents_used !== past) return fail(`agent ${past} was made, yet Lens counts ${after.agents_used} agents on the workspace`)
        return { pass: true, detail: `on Group the workspace made its ${past}th agent, past Company's ${company.agents}, and Lens offers it Slack and Teams approvals` }
      }
      const v = pastAgentsVerdict(last, ladder, company, `${past}th`)
      if (!v.pass) return v
      if (after.agents_used !== company.agents) return fail(`refused, yet Lens counts ${after.agents_used} agents on the workspace, not ${company.agents}`)
      return { pass: true, detail: `${v.detail}; the workspace still has ${company.agents}, and Lens offers it Slack and Teams approvals` }
    },
  }
}

/** The seller (`seller`) has sold nothing before; the buyer buys nothing else, so paying its whole bill clears this sale alone. */
export function pricingSellerSplit(seed: number, seller: number): Scenario {
  return {
    id: 'pricing-seller-split',
    owner: 'talyvor-lens',
    title: "a seller's first $1.00 sale, its buyer's bill paid, clears at 850,000 µUSD to the seller and 150,000 µUSD to Talyvor",
    feature: 'Marketplace',
    run: async (ctx) => {
      const { env } = ctx
      const before = await env.lens.marketEarnings(env.userAt(seller))
      if (before.lifetime_gross_usd_micros !== 0) throw new Error(`the seller has sold ${before.lifetime_gross_usd_micros} µUSD before, so this would not be its first sale`)
      const bought = await buyFrom(ctx, seller, seed, Math.round(DOLLAR_USD_MICROS / env.usdPerLXC))
      if (typeof bought === 'string') return fail(bought)
      const paid = await payBill(ctx)
      if (typeof paid === 'string') return fail(paid)
      const cleared = await clearedBothSides(ctx, bought)
      if (typeof cleared === 'string') return fail(cleared)
      return splitVerdict((cleared.earned.earnings ?? []).find((x) => x.use_id === bought.line.use_id))
    },
  }
}
