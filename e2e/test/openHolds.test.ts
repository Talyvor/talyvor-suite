import { describe, expect, it } from 'vitest'
import { openHolds } from '../src/bank.ts'
import type { AgentLine } from '../src/lens.ts'

const line = (kind: string, ref: string, amount_ulxc: number): AgentLine =>
  ({ entry_id: `${kind}-${ref}`, kind, amount_ulxc, counterparty: '', ref, balance_after_ulxc: 0, at: '' })

// B17.284 — wallet-home read user 88's spend while the call's 2472 µLXC hold was open, before Lens settled it.
describe('openHolds', () => {
  it('names a hold until its settle or release lands', () => {
    expect(openHolds([line('fund', 'f', 1e6), line('hold', 'r1', -2472)])).toEqual(['r1'])
    expect(openHolds([line('hold', 'r1', -2472), line('settle', 'r1', 1582)])).toEqual([])
    expect(openHolds([line('hold', 'r1', -2472), line('release', 'r1', 2472), line('hold', 'r2', -2472)])).toEqual(['r2'])
  })
})
