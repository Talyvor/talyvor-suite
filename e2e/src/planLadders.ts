// B61.61 — the testers play our own plans (talyvor-lens B61.57, suite B61.59). Nick, 15 Nov 2026: two ladders replace the
// 5 Oct price card, with names of our own and agents per plan 3, 10 and 25 for a person, 3, 25 and unlimited for a
// company. Those names and counts are the decided ones, typed here on purpose, so the run fails the night Lens serves
// any other ladder (the 5 Oct four, Free, Team, Business and Enterprise, above all). Every price and every count of
// people is Lens's own, read on the night from GET /v1/public/plans, and the screens are held to that read.
//
// Two scenarios, each mended from one that judged by the 5 Oct plans:
//   pricing-approved — /pricing shows both ladders as Lens states them, and no other plan.
//   plan-change — on Settings, Plan, a company sees its own ladder as Lens states it; Change plan moves it at once,
//   and the agents Lens lets it have follow at once; a move down under too many agents is refused in Lens's words.

import type { Page } from 'playwright'
import { ACTION_TIMEOUT_MS, fail } from './bank.ts'
import type { PublicPlan, PublicPlans, WorkspacePlan } from './lens.ts'
import { CannotTest, type Scenario, type ScenarioCtx, type Verdict } from './scenarios.ts'

/** One step of a decided ladder: Lens's key, the name people read and the agents it allows, -1 unlimited. */
export interface DecidedPlan {
  id: string
  name: string
  agents: number
}

/** The two ladders Nick decided on 15 Nov 2026 (BUILD.md B61.57), each from its smallest plan up. */
export const DECIDED_LADDERS: Readonly<Record<'personal' | 'business', readonly DecidedPlan[]>> = {
  personal: [
    { id: 'personal_solo', name: 'Solo', agents: 3 },
    { id: 'personal_crew', name: 'Crew', agents: 10 },
    { id: 'personal_fleet', name: 'Fleet', agents: 25 },
  ],
  business: [
    { id: 'business_studio', name: 'Studio', agents: 3 },
    { id: 'business_company', name: 'Company', agents: 25 },
    { id: 'business_group', name: 'Group', agents: -1 },
    { id: 'business_custom', name: 'Custom', agents: -1 },
  ],
}

const TYPES = ['personal', 'business'] as const
const ladderLine = (ladder: readonly { id: string; name: string; agents: number }[]): string =>
  ladder.map((p) => `${p.name} (${p.id}, ${p.agents === -1 ? 'unlimited' : p.agents} agents)`).join(', ') || 'no plan'

/** Lens's two ladders are the decided ones: the same plans in the same order, each by its name and its agents. */
export function decidedLaddersVerdict(served: Partial<PublicPlans>): Verdict {
  const wrong = TYPES.flatMap((type) => {
    const got = served[type] ?? []
    const want = DECIDED_LADDERS[type]
    const same = got.length === want.length && want.every((w, i) => got[i].id === w.id && got[i].name === w.name && got[i].agents === w.agents)
    return same ? [] : [`Lens's ${type} ladder is ${ladderLine(got)}, not ${ladderLine(want)}`]
  })
  if (wrong.length > 0) return fail(wrong.join('; '))
  return { pass: true, detail: `Lens serves the decided ladders: ${TYPES.map((t) => ladderLine(DECIDED_LADDERS[t])).join('; ')}` }
}

/** "£10 · €10 · $10" for a plan priced 1000 in each, as /pricing writes it (apps/web pricingApi formatMinor). */
export function pricesShown(plan: Pick<PublicPlan, 'price_minor'>, currencies: readonly string[]): string {
  if (plan.price_minor === null) return 'By contract'
  return currencies.filter((c) => typeof plan.price_minor?.[c] === 'number').map((c) => {
    const minor = plan.price_minor?.[c] ?? 0
    return (minor / 100).toLocaleString('en-US', { style: 'currency', currency: c, minimumFractionDigits: minor % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 })
  }).join(' · ')
}

/** A count a plan allows, as the screens write it: "Unlimited" for -1, else the number. */
const limit = (n: number): string => (n < 0 ? 'Unlimited' : n.toLocaleString('en-US'))

/** What one plan's card on /pricing shows: its name, its prices, its agents and its people. */
export interface PricingCard {
  name: string
  price: string
  agents: string
  people: string
}

/**
 * /pricing against Lens's read: each ladder shows exactly Lens's plans, in its order, each with Lens's name, its prices
 * in every currency Lens prices it in, and the agents and people Lens states; and no card for any plan Lens did not
 * state. `shown` is each ladder's cards by plan id, in the order the page draws them.
 */
export function pricingPageVerdict(served: PublicPlans & { currencies?: string[] }, shown: Readonly<Record<'personal' | 'business', readonly (PricingCard & { id: string })[]>>): Verdict {
  const decided = decidedLaddersVerdict(served)
  if (!decided.pass) return decided
  const currencies = served.currencies ?? []
  const wrong = TYPES.flatMap((type) => {
    const lens = served[type]
    const page = shown[type]
    const order = page.map((c) => c.id).join(', ')
    if (order !== lens.map((p) => p.id).join(', ')) return [`/pricing's ${type} ladder draws ${order || 'no plan'}, not Lens's ${lens.map((p) => p.id).join(', ')}`]
    return lens.flatMap((p, i) => {
      const c = page[i]
      const want = { name: p.name, price: pricesShown(p, currencies), agents: limit(p.agents), people: limit(p.people) }
      return (Object.keys(want) as (keyof typeof want)[]).flatMap((k) => (c[k] === want[k] ? [] : [`${p.id}'s ${k} reads "${c[k]}", not Lens's "${want[k]}"`]))
    })
  })
  if (wrong.length > 0) return fail(`/pricing: ${wrong.join('; ')}`)
  return { pass: true, detail: `/pricing shows both ladders as Lens states them: ${TYPES.map((t) => served[t].map((p) => `${p.name} ${pricesShown(p, currencies)}`).join(', ')).join('; ')}` }
}

/** "3 agents", "1 agent", "Unlimited agents": a plan's agents as Settings, Plan writes them. */
const agentsLine = (n: number): string => (n < 0 ? 'Unlimited agents' : `${n.toLocaleString('en-US')} ${n === 1 ? 'agent' : 'agents'}`)
/** "5 people", "1 person", "Unlimited people". */
const peopleLine = (n: number): string => (n < 0 ? 'Unlimited people' : `${n.toLocaleString('en-US')} ${n === 1 ? 'person' : 'people'}`)

/**
 * Settings, Plan against Lens's read: the ladder it draws is exactly the account's own type's, in Lens's order, each
 * card naming its plan and the agents and people Lens states; no plan of the other ladder is drawn. `cards` is each
 * card's id (from `ladder-<id>`) and its text, in the order the page draws them.
 */
export function planPageLadderVerdict(served: PublicPlans, type: 'personal' | 'business', cards: readonly { id: string; text: string }[]): Verdict {
  const decided = decidedLaddersVerdict(served)
  if (!decided.pass) return decided
  const lens = served[type]
  const drawn = cards.map((c) => c.id).join(', ')
  if (drawn !== lens.map((p) => p.id).join(', ')) return fail(`Settings, Plan draws ${drawn || 'no plan'} for a ${type} account, not Lens's ${type} ladder ${lens.map((p) => p.id).join(', ')}`)
  const wrong = lens.flatMap((p, i) => {
    const lines = cards[i].text.split('\n').map((l) => l.trim())
    return [p.name, agentsLine(p.agents), peopleLine(p.people)].flatMap((w) => (lines.includes(w) ? [] : [`${p.id}'s card does not read "${w}" (it reads ${JSON.stringify(cards[i].text)})`]))
  })
  if (wrong.length > 0) return fail(`Settings, Plan: ${wrong.join('; ')}`)
  return { pass: true, detail: `Settings, Plan draws the ${type} ladder as Lens states it: ${lens.map((p) => `${p.name}, ${agentsLine(p.agents).toLowerCase()}`).join('; ')}` }
}

/** "1 agent", "4 agents": as Lens counts in its refusals (internal/plans count). */
const count = (n: number): string => `${n.toLocaleString('en-US')} ${n === 1 ? 'agent' : 'agents'}`

/** Lens's refusal of a move down to `to` while the account has `has` agents (internal/plans Change). */
export function moveDownSentence(to: Pick<PublicPlan, 'name' | 'agents'>, has: number): string {
  return `${to.name} allows ${count(to.agents)}, and this account has ${has.toLocaleString('en-US')}. Archive ${count(has - to.agents)} first.`
}

/** A move down under too many agents: refused on the page in Lens's words, and Lens keeps the account where it was. */
export function moveDownVerdict(said: string, after: Pick<WorkspacePlan, 'plan'>, from: PublicPlan, to: PublicPlan, has: number): Verdict {
  const want = moveDownSentence(to, has)
  if (after.plan !== from.id) return fail(`with ${has} agents, the account was moved down to ${after.plan}: ${to.name} allows ${to.agents}`)
  if (said !== want) return fail(`the move down to ${to.name} with ${has} agents reads "${said || '(nothing)'}" on Settings, Plan, not Lens's "${want}"`)
  return { pass: true, detail: `a move down to ${to.name} with ${has} agents was refused on Settings, Plan in Lens's words: "${said}"; Lens keeps the account on ${from.name}` }
}

/** A change of plan: Lens holds the account to `to` at once, and lets it have the agents `to` allows. */
export function changedVerdict(after: Pick<WorkspacePlan, 'plan' | 'gates'>, to: PublicPlan): Verdict {
  if (after.plan !== to.id) return fail(`Change to ${to.name} was pressed and confirmed on Settings, Plan, and Lens holds the account to ${after.plan}`)
  if (after.gates.agents !== to.agents) return fail(`on ${to.name} Lens lets the account have ${after.gates.agents} agents, not the ${to.agents} it states for ${to.name}`)
  return { pass: true, detail: `Lens holds the account to ${to.name} at once, with ${agentsLine(to.agents).toLowerCase()}` }
}

// ─── the screens ─────────────────────────────────────────────────────────────

/** Each `<prefix><id>` card inside `scope`, by id and its text, in the order the page draws them. */
async function cardsIn(page: Page, scope: string, prefix: string): Promise<{ id: string; text: string }[]> {
  const cards = page.getByTestId(scope).locator(`[data-testid^="${prefix}"]`)
  await cards.first().waitFor({ state: 'visible', timeout: ACTION_TIMEOUT_MS }).catch(() => undefined)
  const out: { id: string; text: string }[] = []
  for (let i = 0; i < (await cards.count()); i++) {
    const c = cards.nth(i)
    out.push({ id: ((await c.getAttribute('data-testid')) ?? '').slice(prefix.length), text: (await c.innerText()).trim() })
  }
  return out
}

/** One /pricing card's name, prices, agents and people, as its `<dt>`s label them. */
async function pricingCard(page: Page, id: string): Promise<PricingCard> {
  const card = page.getByTestId(`ladder-plan-${id}`)
  const row = async (label: string) => (await card.locator('dt', { hasText: label }).locator('xpath=following-sibling::dd[1]').innerText().catch(() => '(not shown)')).trim()
  const price = card.getByTestId(`price-${id}`)
  return {
    name: (await card.locator('p').first().innerText()).trim(),
    price: (await price.count()) > 0 ? (await price.innerText()).trim() : (await card.getByText('By contract', { exact: true }).count()) > 0 ? 'By contract' : '(not shown)',
    agents: await row('Agents'),
    people: await row('People'),
  }
}

export function pricingApproved(): Scenario {
  return {
    id: 'pricing-approved',
    owner: 'talyvor-suite',
    items: ['B61.57', 'B61.59'],
    title: '/pricing shows our two ladders, for a person and for a company, each plan by its name with the prices, agents and people Lens states, and no other plan',
    feature: 'Plans',
    run: async (ctx) => {
      const served = (await ctx.env.lens.publicPlans()) as PublicPlans & { currencies?: string[] }
      ctx.evidence.push({ note: `Lens states: ${TYPES.map((t) => `${t} ${ladderLine(served[t] ?? [])}`).join('; ')}` })
      const decided = decidedLaddersVerdict(served)
      if (!decided.pass) return decided
      const page = await ctx.app.tab('/pricing')
      const shown: Record<'personal' | 'business', (PricingCard & { id: string })[]> = { personal: [], business: [] }
      try {
        for (const type of TYPES) {
          for (const { id } of await cardsIn(page, `ladder-${type}`, 'ladder-plan-')) shown[type].push({ id, ...(await pricingCard(page, id)) })
        }
      } finally {
        await page.close()
      }
      ctx.evidence.push({ note: `/pricing shows ${JSON.stringify(shown)}` })
      return pricingPageVerdict(served, shown)
    },
  }
}

/** Opens Settings, Plan, presses Change plan on `to` and confirms it: what the dialog said when it closed or refused. */
async function changeOnPage(page: Page, to: PublicPlan): Promise<{ refused?: string }> {
  await page.getByTestId(`ladder-${to.id}`).getByRole('button', { name: 'Change plan', exact: true }).click({ timeout: ACTION_TIMEOUT_MS })
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: `Change to ${to.name}`, exact: true }).click({ timeout: ACTION_TIMEOUT_MS })
  const refusal = dialog.getByTestId('plan-change-refusal')
  await refusal.or(page.getByText(`You are on ${to.name}`, { exact: true })).first().waitFor({ timeout: ACTION_TIMEOUT_MS }).catch(() => undefined)
  if ((await refusal.count()) === 0) return {}
  const refused = (await refusal.innerText()).trim()
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click().catch(() => undefined)
  return { refused }
}

/** Lens's plan read, until it names `plan` or `ms` pass. */
async function planUntil(ctx: ScenarioCtx, plan: string, ms = 10_000): Promise<WorkspacePlan> {
  const end = Date.now() + ms
  for (;;) {
    const on = await ctx.env.lens.workspacePlan(ctx.app.user)
    if (on.plan === plan || Date.now() > end) return on
    await new Promise((r) => setTimeout(r, 1000))
  }
}

/**
 * On a Studio workspace of its own: Settings, Plan draws the company ladder as Lens states it; Change plan to Company
 * moves it, and the agents Lens lets it have follow at once (one past Studio's is made); then Change plan to Studio is
 * refused in Lens's words, saying how many agents to archive, and Lens keeps it on Company.
 */
export function planChange(seed: number): Scenario {
  return {
    id: 'plan-change',
    owner: 'talyvor-suite',
    items: ['B61.57', 'B61.59'],
    plan: 'business_studio',
    own: true,
    title: "on Settings, Plan a company sees its own ladder as Lens states it; Change plan to Company moves it at once with Company's agents; a move back down to Studio with more agents than Studio allows is refused in Lens's words",
    feature: 'Plans',
    run: async (ctx) => {
      const { env, app } = ctx
      const served = await env.lens.publicPlans()
      ctx.evidence.push({ note: `Lens states the business ladder: ${ladderLine(served.business ?? [])}` })
      const decided = decidedLaddersVerdict(served)
      if (!decided.pass) return decided
      const [studio, company] = served.business
      const start = await env.lens.workspacePlan(app.user)
      if (start.plan !== studio.id) return fail(`a test workspace made on ${studio.id} is on ${start.plan}`)
      if (start.agents_used > studio.agents) return fail(`a ${studio.name} workspace already has ${start.agents_used} agents, more than its ${studio.agents}`)

      const page = await app.tab('/billing')
      try {
        const cards = await cardsIn(page, 'plan-settings', 'ladder-')
        ctx.evidence.push({ note: `Settings, Plan draws ${cards.map((c) => c.id).join(', ') || 'no plan'}` })
        const ladder = planPageLadderVerdict(served, 'business', cards)
        if (!ladder.pass) return ladder

        const up = await changeOnPage(page, company)
        ctx.evidence.push({ note: `Change to ${company.name}: ${up.refused === undefined ? 'confirmed' : `refused "${up.refused}"`}` })
        if (up.refused?.includes('cannot be chosen yet')) throw new CannotTest(`Lens takes no paid plan on this deployment: "${up.refused}"`)
        if (up.refused !== undefined) return fail(`Change to ${company.name} on Settings, Plan was refused: "${up.refused}"`)
        const moved = changedVerdict(await planUntil(ctx, company.id), company)
        if (!moved.pass) return moved
        const shown = (await page.getByTestId('plan-current').innerText({ timeout: ACTION_TIMEOUT_MS }).catch(() => '')).trim()
        if (!shown.includes(`You are on ${company.name}.`)) return fail(`Lens moved the account to ${company.name}, and Settings, Plan still reads ${JSON.stringify(shown)}`)

        const has = studio.agents + 1
        for (let n = start.agents_used + 1; n <= has; n++) {
          const made = await env.lens.tryCreateAgent(app.user, `Plan ${seed}-${n}`)
          if (made.agent === undefined) return fail(`on ${company.name}, agent ${n} (past ${studio.name}'s ${studio.agents}) was refused: ${made.status} "${made.refusal?.error}"`)
        }
        ctx.evidence.push({ note: `made agents up to ${has} on ${company.name}` })

        const down = await changeOnPage(page, studio)
        const after = await env.lens.workspacePlan(app.user)
        ctx.evidence.push({ note: `Change to ${studio.name} with ${has} agents: ${down.refused === undefined ? 'confirmed' : `refused "${down.refused}"`}; Lens holds ${after.plan}` })
        const v = moveDownVerdict(down.refused ?? '', after, company, studio, has)
        return v.pass ? { pass: true, detail: `${ladder.detail}; ${moved.detail}, and made its ${has}th agent; ${v.detail}` } : v
      } finally {
        await page.close()
      }
    },
  }
}
