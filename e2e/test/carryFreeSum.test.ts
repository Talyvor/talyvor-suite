import { describe, expect, it } from 'vitest'
import { carryFreeSum } from '../src/bank.ts'
import { seeded } from '../src/oracles.ts'

// B17.295 — agent-model-limit asks a sum with no carries, so user 72 is no longer failed on claude-sonnet-5's arithmetic.
describe('carryFreeSum', () => {
  it('asks user 72, and every other seed, a four-digit sum whose digit pairs never carry', () => {
    for (let seed = 0; seed < 200; seed++) {
      const { q, want } = carryFreeSum(seeded(seed * 41 + 13))
      const [, a, b] = /What is (\d+) \+ (\d+)\?/.exec(q) ?? []
      expect(a).toHaveLength(4)
      expect(b).toHaveLength(4)
      expect(Number(a) + Number(b)).toBe(want)
      for (let i = 0; i < 4; i++) expect(Number(a[i]) + Number(b[i])).toBeLessThan(10)
    }
    expect(carryFreeSum(seeded(72 * 41 + 13)).q).not.toBe('What is 5312 + 8686? Reply with the number only.')
  })
})
