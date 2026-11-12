import { describe, expect, it } from 'vitest'
import { honestPageFaults } from '../src/scenarios.ts'

describe('honest-pages /pricing (B28.3, B17.449)', () => {
  it('passes the Pocket pricing page, whose paid plans each say "a month"', () => {
    const text = 'Plans\nFree\n$0\nTeam\n$49\na month\nEnterprise\nFrom\n$3,000\na month'
    expect(honestPageFaults('/pricing', text)).toEqual([])
  })

  it('fails a page that never says a paid plan recurs, or says nothing recurs', () => {
    expect(honestPageFaults('/pricing', 'Plans\nFree\n$0\nTeam\n$49')).toHaveLength(1)
    expect(honestPageFaults('/pricing', 'Team\n$49\na month\nNothing recurs.')).toEqual(['/pricing still says "Nothing recurs"'])
  })
})
