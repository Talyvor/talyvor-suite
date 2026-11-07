import { describe, expect, it } from 'vitest'
import { formatMinor } from './agentBankApi'

// B55.26 — formatMinor knows each currency's decimals: Lens keeps USDC to six, and Intl refuses its code.
describe('formatMinor', () => {
  it('writes pounds, euros and dollars to two decimals', () => {
    expect(formatMinor(2000, 'GBP')).toBe('£20.00')
    expect(formatMinor(2000, 'EUR')).toBe('€20.00')
  })

  it('writes USDC to between two and six decimals, never through Intl currency', () => {
    expect(formatMinor(1500000, 'USDC')).toBe('1.50 USDC')
    expect(formatMinor(1234567, 'USDC')).toBe('1.234567 USDC')
    expect(formatMinor(12500000, 'USDC')).toBe('12.50 USDC')
  })

  it('writes a code it does not know as the amount and the code, and never throws', () => {
    expect(formatMinor(1250, 'XYZ1')).toBe('12.50 XYZ1')
  })
})
