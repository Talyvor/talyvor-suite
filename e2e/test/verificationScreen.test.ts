import { describe, expect, it } from 'vitest'
import { type VerificationScreenRead, verificationScreenFaults } from '../src/verificationScreen.ts'

// B17.486 — the Verification screen as B61.20 and B57.173 draw it, read after a Business passed every check on the Test
// provider: the scenario passes on it, and FAILs when a Test pass counts live (STUB_BREAK=test-pass-live) or payments_out
// is listed as needing L0 (STUB_BREAK=level-needed-wrong).

const confirmed = (): VerificationScreenRead => ({
  steps: {
    contact: 'Email and phone Passed in Sandbox',
    person: 'Who you are Passed in Sandbox',
    company: 'Your company Passed in Sandbox',
  },
  checks: [
    'Your company Passed in Sandbox 18 Nov, 22:40 Reference for support test_kyb_3c1f',
    'Who you are · Nightly Screen Owner Passed in Sandbox 18 Nov, 22:40 Reference for support test_kyc_1eb2',
    'Email and phone Passed in Sandbox 18 Nov, 22:40 Reference for support test_kyc_f092',
  ],
  needs: {
    L0: { state: 'Reached for live money', capabilities: ['talyvor_spend', 'marketplace_buy'] },
    L2: { state: 'Reached in Sandbox', capabilities: ['payments_out', 'cards'] },
    L3: { state: 'Reached in Sandbox', capabilities: ['b2b_credit'] },
  },
  body: 'Verification Confirm who you are You’re confirmed. Your account is open.',
})

describe('verification-screen (B17.486)', () => {
  it('passes on the screen once a Business passed every check in Sandbox', () => {
    expect(verificationScreenFaults(confirmed())).toBeUndefined()
  })

  it('FAILs when a Test pass counts for live money', () => {
    const read = confirmed()
    read.needs.L2.state = 'Reached for live money'
    expect(verificationScreenFaults(read)).toBe('the L2 card says "Reached for live money", not "Reached in Sandbox": a Test pass must not count for live money')
  })

  it('FAILs when payments_out is listed as needing L0', () => {
    const read = confirmed()
    read.needs.L2.capabilities = ['cards']
    read.needs.L0.capabilities.push('payments_out')
    expect(verificationScreenFaults(read)).toBe('the screen lists payments_out under L0; its live money needs L2')
  })

  it('FAILs when a check on the record shows no reference for support', () => {
    const read = confirmed()
    read.checks[1] = 'Who you are · Nightly Screen Owner Passed in Sandbox 18 Nov, 22:40'
    expect(verificationScreenFaults(read)).toMatch(/^the L2 check on the record shows no reference for support/)
  })
})
