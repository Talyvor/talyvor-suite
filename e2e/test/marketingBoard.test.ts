import { describe, expect, it } from 'vitest'
import { headerLockupFaults } from '../src/scenarios.ts'

describe("marketing-board's header lockup (B17.342)", () => {
  it('passes the drawn mark and wordmark without the tagline, and names each fault otherwise', () => {
    expect(headerLockupFaults({ mark: true, wordmark: true, tagline: false })).toEqual([])
    expect(headerLockupFaults({ mark: false, wordmark: false, tagline: true })).toEqual([
      'no drawn mark in the header',
      'no drawn wordmark in the header',
      'the retired tagline shows in the header',
    ])
  })
})
