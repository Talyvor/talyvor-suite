import { describe, expect, it } from 'vitest'
import { AgentBankError, approvalNamedIn, formatMinor } from './agentBankApi'

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

// B58.1 — B55.51 changed Lens's sentence to "… Approval apr_… must be approved …", capital A, and the web stopped seeing the
// hold: the approval is found whatever the sentence's case.
describe('approvalNamedIn', () => {
  it("finds the approval in Lens's sentence whatever its case", () => {
    const said = (s: string) => new AgentBankError(403, '/api/agents/agt_1/pay', s)
    expect(approvalNamedIn(said("economy: payment of 3 LXC is above the agent's approval amount. Approval apr_x must be approved before it is sent"))).toBe('apr_x')
    expect(approvalNamedIn(said("this request would cost up to 3 LXC, above the agent's approval amount — approval apr_y must be approved"))).toBe('apr_y')
    expect(approvalNamedIn(said("economy: the agent's spending rules refuse this request"))).toBeNull()
  })
})
