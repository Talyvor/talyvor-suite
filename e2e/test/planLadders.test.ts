import { describe, expect, it } from 'vitest'
import type { PublicPlan, PublicPlans } from '../src/lens.ts'
import { changedVerdict, decidedLaddersVerdict, moveDownSentence, moveDownVerdict, planPageLadderVerdict, pricesShown, pricingPageVerdict } from '../src/planLadders.ts'

// B61.61 — the two ladders as the stub Lens serves them (selftest/stub-lens.ts, Lens's defaults since B61.57), and the
// 5 Oct four as STUB_BREAK=old-plans serves them.
const plan = (id: string, name: string, agents: number, people: number, minor: number | null): PublicPlan => ({
  id: id as PublicPlan['id'], name, price_minor: minor === null ? null : { GBP: minor, EUR: minor, USD: minor },
  ...(minor === null ? { by_contract: true } : {}), agents, people,
  gates: { agents, seats: people, own_provider_keys: 'none', slack_teams_approvals: false },
})
const OURS: PublicPlans & { currencies: string[] } = {
  currencies: ['GBP', 'EUR', 'USD'],
  personal: [plan('personal_solo', 'Solo', 3, 1, 0), plan('personal_crew', 'Crew', 10, 1, 399), plan('personal_fleet', 'Fleet', 25, 1, 799)],
  business: [plan('business_studio', 'Studio', 3, 1, 1000), plan('business_company', 'Company', 25, 5, 3500), plan('business_group', 'Group', -1, 25, 12500),
    plan('business_custom', 'Custom', -1, -1, null)],
}
const OLD_FOUR = {
  currencies: ['GBP', 'EUR', 'USD'],
  personal: [],
  business: [plan('free', 'Free', 3, 1, 0), plan('team', 'Team', 25, 5, 4900), plan('business', 'Business', -1, 25, 29900), plan('enterprise', 'Enterprise', -1, -1, null)],
} as unknown as PublicPlans & { currencies: string[] }

const limit = (n: number) => (n < 0 ? 'Unlimited' : String(n))
const pricingShown = (served: typeof OURS) => ({
  personal: served.personal.map((p) => ({ id: p.id, name: p.name, price: pricesShown(p, served.currencies), agents: limit(p.agents), people: limit(p.people) })),
  business: served.business.map((p) => ({ id: p.id, name: p.name, price: pricesShown(p, served.currencies), agents: limit(p.agents), people: limit(p.people) })),
})
const agents = (n: number) => (n < 0 ? 'Unlimited agents' : `${n} agents`)
const people = (n: number) => (n < 0 ? 'Unlimited people' : n === 1 ? '1 person' : `${n} people`)
const planCards = (ladder: readonly PublicPlan[]) => ladder.map((p) => ({ id: p.id, text: `${p.name}\nYour plan\n£10 a month\n${agents(p.agents)}\n${people(p.people)}\nChange plan` }))

describe('B61.61 — the testers play our own plans', () => {
  it('holds Lens to the decided ladders, and fails the 5 Oct four', () => {
    expect(decidedLaddersVerdict(OURS).pass).toBe(true)
    expect(decidedLaddersVerdict(OLD_FOUR).pass).toBe(false)
    // A decided count moved: Crew allows 5 agents.
    expect(decidedLaddersVerdict({ ...OURS, personal: [OURS.personal[0], { ...OURS.personal[1], agents: 5 }, OURS.personal[2]] }).pass).toBe(false)
  })

  it("passes /pricing showing both ladders as Lens states them, and fails a missing plan, a wrong price or the old four", () => {
    expect(pricesShown(OURS.personal[1], OURS.currencies)).toBe('£3.99 · €3.99 · $3.99')
    expect(pricesShown(OURS.business[0], OURS.currencies)).toBe('£10 · €10 · $10')
    expect(pricingPageVerdict(OURS, pricingShown(OURS)).pass).toBe(true)
    const shown = pricingShown(OURS)
    expect(pricingPageVerdict(OURS, { ...shown, personal: shown.personal.slice(1) }).pass).toBe(false)
    expect(pricingPageVerdict(OURS, { ...shown, business: shown.business.map((c) => (c.id === 'business_company' ? { ...c, price: '$49' } : c)) }).pass).toBe(false)
    expect(pricingPageVerdict(OLD_FOUR, pricingShown(OLD_FOUR)).pass).toBe(false)
  })

  it("passes Settings, Plan drawing the company ladder as Lens states it, and fails the person's ladder or the old four", () => {
    expect(planPageLadderVerdict(OURS, 'business', planCards(OURS.business)).pass).toBe(true)
    expect(planPageLadderVerdict(OURS, 'business', planCards([...OURS.personal, ...OURS.business])).pass).toBe(false)
    expect(planPageLadderVerdict(OURS, 'business', planCards(OURS.business.map((p) => (p.id === 'business_group' ? { ...p, people: 5 } : p)))).pass).toBe(false)
    expect(planPageLadderVerdict(OLD_FOUR, 'business', planCards(OLD_FOUR.business)).pass).toBe(false)
  })

  it('passes a change Lens holds at once with the new plan’s agents, and fails one it did not make', () => {
    const company = OURS.business[1]
    expect(changedVerdict({ plan: 'business_company', gates: { agents: 25 } }, company).pass).toBe(true)
    expect(changedVerdict({ plan: 'business_studio', gates: { agents: 3 } }, company).pass).toBe(false)
    expect(changedVerdict({ plan: 'business_company', gates: { agents: 3 } }, company).pass).toBe(false)
  })

  it("passes a move down refused in Lens's words with the account kept, and fails one let through or said otherwise", () => {
    const [studio, company] = OURS.business
    const said = moveDownSentence(studio, 4)
    expect(said).toBe('Studio allows 3 agents, and this account has 4. Archive 1 agent first.')
    expect(moveDownVerdict(said, { plan: 'business_company' }, company, studio, 4).pass).toBe(true)
    expect(moveDownVerdict('', { plan: 'business_studio' }, company, studio, 4).pass).toBe(false)
    expect(moveDownVerdict('Your plan was not changed. You can try again.', { plan: 'business_company' }, company, studio, 4).pass).toBe(false)
  })
})
