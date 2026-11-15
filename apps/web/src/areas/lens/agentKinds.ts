import { cardArt, type AgentCardArt } from '../../cards/cardArt'

// agentKinds.ts — B61.13: the six agents Talyvor offers, each named by what it does, with its picture (today's helper
// art) and the rules it suggests, in dollars. The helper's own name belongs to the picture's file and is never shown:
// the owner names the agent. The suggested amounts are the owner's to change before Create, and are listed for Nick
// under "Numbers to confirm" on the pull request that added them.

export type AgentKind = 'Research' | 'Sales' | 'Bookkeeping' | 'Ads' | 'Travel' | 'Support'

/** The four rules New agent asks for, in whole dollars; 0 is no rule. */
export interface SuggestedRules {
  perPayment: number
  perDay: number
  perMonth: number
  askAbove: number
}

export interface AgentKindChoice {
  kind: AgentKind
  /** one line on what it does */
  line: string
  picture: AgentCardArt
  rules: SuggestedRules
}

const art = (helper: AgentCardArt['helper']): AgentCardArt =>
  cardArt.find((c): c is AgentCardArt => c.family === 'agent' && c.helper === helper)!

export const AGENT_KINDS: readonly AgentKindChoice[] = [
  { kind: 'Research', line: 'Pays for the data, papers and tools it reads.', picture: art('Remy'), rules: { perPayment: 50, perDay: 200, perMonth: 2000, askAbove: 25 } },
  { kind: 'Sales', line: 'Pays for leads, lists and outreach tools.', picture: art('Sunny'), rules: { perPayment: 100, perDay: 300, perMonth: 3000, askAbove: 50 } },
  { kind: 'Bookkeeping', line: 'Pays the bills and keeps the books.', picture: art('Penny'), rules: { perPayment: 500, perDay: 1000, perMonth: 5000, askAbove: 100 } },
  { kind: 'Ads', line: 'Buys ads inside the budget you set.', picture: art('Max'), rules: { perPayment: 250, perDay: 1000, perMonth: 10000, askAbove: 100 } },
  { kind: 'Travel', line: 'Books trips, stays and transfers.', picture: art('Nova'), rules: { perPayment: 1500, perDay: 3000, perMonth: 6000, askAbove: 500 } },
  { kind: 'Support', line: 'Pays refunds and the tools that answer customers.', picture: art('Ollie'), rules: { perPayment: 25, perDay: 100, perMonth: 1000, askAbove: 10 } },
]

/** Lens's smallest amount. "Ask me above" it means every payment asks: Lens holds no rule that says so in other words. */
export const EVERY_PAYMENT_ASKS_ULXC = 1

/** Typed cents → µLXC at the peg (dollars per LXC), in whole integers; null while no peg backs it. */
export function ulxcForCents(cents: number, usdPerLXC: number | undefined): number | null {
  if (typeof usdPerLXC !== 'number' || !Number.isFinite(usdPerLXC) || usdPerLXC <= 0) return null
  const microUsdPerLXC = BigInt(Math.round(usdPerLXC * 1_000_000))
  if (microUsdPerLXC <= 0n) return null
  // cents × 10,000 is micro-dollars; × 1,000,000 ÷ micro-dollars per LXC is µLXC, rounded to the nearest.
  const ulxc = (BigInt(cents) * 10_000n * 1_000_000n + microUsdPerLXC / 2n) / microUsdPerLXC
  const n = Number(ulxc)
  return Number.isSafeInteger(n) ? n : null
}
