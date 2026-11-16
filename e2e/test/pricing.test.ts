import { describe, expect, it } from 'vitest'
import type { LedgerRow, PublicPlan } from '../src/lens.ts'
import { feeOn, feeVerdict, ownKeyVerdict, pastAgentsVerdict, splitVerdict } from '../src/pricing.ts'

// One call's rows as Lens writes them (talyvor-lens economy.SpendLXCMeta, B32.11): the spend, then its fee.
function call(spend: number, fee: number, bps: number, start = 50_000_000): LedgerRow[] {
  const at = '2026-10-06T03:00:00Z'
  return [
    { id: 's', amount_ulxc: -spend, balance_after_ulxc: start - spend, type: 'spend', description: 'chat: answer', created_at: at },
    { id: 'f', amount_ulxc: -fee, balance_after_ulxc: start - spend - fee, type: 'platform_fee', description: `Platform fee ${bps / 100}%`,
      metadata: { platform_fee_bps: bps, spend_ulxc: spend }, created_at: at },
  ]
}

describe('the approved prices (B32.15)', () => {
  it("passes B32.11's rows: a 10 LXC call's fee at 5.5%, 3% and 1%", () => {
    expect(feeVerdict(call(10_000_000, 550_000, 550), 550).pass).toBe(true)
    expect(feeVerdict(call(10_000_000, 300_000, 300), 300).pass).toBe(true)
    expect(feeVerdict(call(10_000_000, 100_000, 100), 100).pass).toBe(true)
  })

  it('fails when the fee row is missing, or off by one µLXC', () => {
    expect(feeVerdict(call(10_000_000, 300_000, 300).slice(0, 1), 300)).toEqual({ pass: false, detail: expect.stringContaining('wrote no platform_fee row') })
    // 1,234,567 × 5.5% = 67,901.185: rounded up, never down.
    expect(feeOn(1_234_567, 550)).toBe(67_902)
    expect(feeVerdict(call(1_234_567, 67_902, 550), 550).pass).toBe(true)
    expect(feeVerdict(call(1_234_567, 67_901, 550), 550)).toEqual({ pass: false, detail: expect.stringContaining('debits 67901 µLXC, not 67902') })
    // Team's rate charged on a Free workspace.
    expect(feeVerdict(call(10_000_000, 300_000, 300), 550).pass).toBe(false)
  })

  it("fails a call on the workspace's own key that is charged, or not sent on that key", () => {
    expect(ownKeyVerdict({ status: 401, ownKey: true, error: 'invalid x-api-key' }, []).pass).toBe(true)
    expect(ownKeyVerdict({ status: 401, ownKey: true }, call(10_000_000, 100_000, 100))).toEqual({ pass: false, detail: expect.stringContaining('platform_fee -100000') })
    expect(ownKeyVerdict({ status: 200, ownKey: false }, []).pass).toBe(false)
  })

  it("passes Lens's refusal of a Studio workspace's agent past its gate, in the figures Lens states, and fails one made (B61.90)", () => {
    const plan = (id: PublicPlan['id'], name: string, agents: number): PublicPlan =>
      ({ id, name, price_minor: null, agents, people: 1, gates: { agents, seats: 1, own_provider_keys: 'none', slack_teams_approvals: false } })
    const ladder = [plan('business_studio', 'Studio', 3), plan('business_company', 'Company', 25), plan('business_group', 'Group', -1)]
    const refusal = { error: 'Studio allows 3 agents, and all 3 are in use. Company allows 25.', setting: 'LENS_PLAN_GATES', plan: 'business_studio', gate: 'agents', limit: 3, allows: 'business_company' }
    expect(pastAgentsVerdict({ status: 402, refusal }, ladder, ladder[0], '4th').pass).toBe(true)
    expect(pastAgentsVerdict({ status: 201, agent: { id: 'agt_4' } }, ladder, ladder[0], '4th').pass).toBe(false)
    // Lens's figure moved: Studio now allows 5, and the 5 Oct sentence is not Lens's.
    expect(pastAgentsVerdict({ status: 402, refusal }, ladder, { ...ladder[0], agents: 5 }, '6th').pass).toBe(false)
  })

  it("passes a first $1.00 sale at 850,000 and 150,000 µUSD, and fails the seller keeping it all", () => {
    const sale = { use_id: 'u', payable_at: '', gross_usd_micros: 1_000_000 }
    expect(splitVerdict({ ...sale, share_usd_micros: 850_000, fee_usd_micros: 150_000 }).pass).toBe(true)
    expect(splitVerdict({ ...sale, share_usd_micros: 1_000_000, fee_usd_micros: 0 }).pass).toBe(false)
  })
})
