import { describe, expect, it } from 'vitest'
import { boostEndedRefusal } from '../src/bank.ts'

// B17.459 — after the boost ends Lens refuses by the daily limit in its own wording (agent_rules.go); B61.16: in dollars
// alone, to the last µLXC below a cent.
describe('boostEndedRefusal', () => {
  it("reads Lens's refusal by the rules' 1 µLXC daily limit as that refusal", () => {
    const lens = "economy: the agent's spending rules refuse this request: the agent has spent $0.00 of its daily limit of $0.0000001, and this request would cost up to $0.006"
    expect(boostEndedRefusal.test(lens)).toBe(true)
    expect(boostEndedRefusal.test(lens.replace('$0.0000001', '$0.10'))).toBe(false)
  })
})
