import { describe, expect, it } from 'vitest'
import { planButtonFault } from '../src/scenarios.ts'

const want = { button: 'Choose Team', href: '/plans' }
const choose = [{ text: 'Choose Team', href: '/plans', teal: true }]

describe('pricing-board plan buttons (B51.3)', () => {
  it('wants one teal button while a card can be charged', () => {
    expect(planButtonFault('Team', choose, want, 'live')).toBe('')
    expect(planButtonFault('Team', [], want, 'live')).toContain('not one teal "Choose Team"')
  })

  it('wants no button while it cannot', () => {
    expect(planButtonFault('Team', [], want, 'test')).toBe('')
    expect(planButtonFault('Team', [], want, undefined)).toBe('')
    expect(planButtonFault('Team', choose, want, 'off')).toContain('while card_payments is "off", not none')
  })
})
