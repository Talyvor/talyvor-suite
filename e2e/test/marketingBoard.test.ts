import { describe, expect, it } from 'vitest'
import { headerLockupFaults } from '../src/scenarios.ts'

describe("marketing-board's header lockup (B17.342, B61.83)", () => {
  it("passes the kit's logo without the tagline, and names each fault otherwise", () => {
    expect(headerLockupFaults({ logo: true, tagline: false })).toEqual([])
    expect(headerLockupFaults({ logo: false, tagline: true })).toEqual([
      'no logo from the kit (/brand/logo) in the header',
      'the retired tagline shows in the header',
    ])
  })
})
