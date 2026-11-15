import { describe, expect, it } from 'vitest'
import { boostEndedRefusal } from '../src/bank.ts'

// B17.459 — after the boost ends Lens refuses by the daily limit in its own wording, dollars first (agent_rules.go).
describe('boostEndedRefusal', () => {
  it("reads Lens's refusal by the rules' 0.000001 LXC daily limit as that refusal", () => {
    const lens = "economy: the agent's spending rules refuse this request: the agent has spent $0.00 (0 LXC) of its daily limit of $0.00 (0.000001 LXC), and this request would cost up to $0.01 (0.06 LXC)"
    expect(boostEndedRefusal.test(lens)).toBe(true)
  })
})
