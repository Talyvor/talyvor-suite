import { describe, expect, it } from 'vitest'
import { ladderButtonFault } from '../src/scenarios.ts'

const talk = [{ text: 'Custom: talk to us', href: 'mailto:hello@talyvor.com', outlined: true }]

describe('pricing-board plan buttons (B61.61)', () => {
  it('wants Custom’s one outlined button to an email', () => {
    expect(ladderButtonFault('Custom', talk, true)).toBe('')
    expect(ladderButtonFault('Custom', [], true)).toContain('not one outlined "Custom: talk to us"')
    expect(ladderButtonFault('Custom', [{ ...talk[0], href: '/plans' }], true)).toContain('to an email')
  })

  it('wants no button on a plan chosen on Settings, Plan', () => {
    expect(ladderButtonFault('Company', [], false)).toBe('')
    expect(ladderButtonFault('Team', [{ text: 'Choose Team', href: '/plans', outlined: true }], false)).toContain('not none')
  })
})
