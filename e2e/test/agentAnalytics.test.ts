import { describe, expect, it } from 'vitest'
import type { AnalyticsShown } from '../src/bank.ts'
import type { AgentLine, AgentSpendAnalytics } from '../src/lens.ts'
import { agentAnalyticsVerdict } from '../src/agentAnalytics.ts'

// agent-analytics' agent as Lens posts it: funded 3 LXC, paid Paid 0.5, asked one question (held 0.01, settled 0.002
// back, a platform fee), had 0.25 taken back. Its analytics, statement and card as B28.326 and B28.53 give them.
const line = (kind: string, amount_ulxc: number, counterparty: string, model?: string): AgentLine =>
  ({ entry_id: `ent_${kind}`, kind, amount_ulxc, counterparty, balance_after_ulxc: 0, at: '2026-11-09T04:00:00Z', ...(model ? { model } : {}) })
const lines = [
  line('withdraw', -250_000, 'workspace'),
  line('platform_fee', -50, 'spend', 'gpt-5-mini'),
  line('settle', 2_000, 'held', 'gpt-5-mini'),
  line('hold', -10_000, 'held', 'gpt-5-mini'),
  line('pay', -500_000, 'agent:agt_s'),
  line('fund', 3_000_000, 'workspace'),
]
const analytics: AgentSpendAnalytics = {
  agent_id: 'agt_n', time_zone: 'UTC', out_ulxc: 760_050, returned_ulxc: 2_000, spent_ulxc: 758_050,
  buckets: [
    { day: '2026-11-09', model: '', destination: 'agent:agt_s', out_ulxc: 500_000, returned_ulxc: 0, spent_ulxc: 500_000, postings: 1 },
    { day: '2026-11-09', model: '', destination: 'workspace', out_ulxc: 250_000, returned_ulxc: 0, spent_ulxc: 250_000, postings: 1 },
    { day: '2026-11-09', model: 'gpt-5-mini', destination: 'held', out_ulxc: 10_000, returned_ulxc: 2_000, spent_ulxc: 8_000, postings: 2 },
    { day: '2026-11-09', model: 'gpt-5-mini', destination: 'spend', out_ulxc: 50, returned_ulxc: 0, spent_ulxc: 50, postings: 1 },
  ],
}
const shown: AnalyticsShown = {
  out: '0.76005 LXC',
  days: ['Mon 9 Nov 4 movements 0.76005 LXC'],
  models: ['Not a request 2 movements 0.75 LXC', 'gpt-5-mini 3 movements · 0.002 LXC returned unused 0.01005 LXC'],
  destinations: ['Paid 1 movement 0.5 LXC', 'The workspace 1 movement 0.25 LXC', 'Held for requests 2 movements 0.01 LXC', 'Requests and card 1 movement 0.00005 LXC'],
}
const made = { paidTo: { id: 'agt_s', name: 'Paid' }, paid: 500_000, takenBack: 250_000 }

describe('agent-analytics', () => {
  it('passes when the buckets sum to the statement’s out and the card shows them', () => {
    const v = agentAnalyticsVerdict(analytics, 760_050, lines, made, shown)
    expect(v.detail).toContain('sum to 0.76005 LXC out')
    expect(v.pass).toBe(true)
  })

  it('fails when a posting out is in no bucket', () => {
    const v = agentAnalyticsVerdict({ ...analytics, buckets: analytics.buckets!.slice(1) }, 760_050, lines, made, shown)
    expect(v.pass).toBe(false)
    expect(v.detail).toContain('the agent\'s statement says out 760050')
  })

  it('fails when the card names the account instead of the agent', () => {
    const v = agentAnalyticsVerdict(analytics, 760_050, lines, made, { ...shown, destinations: ['agent:agt_s 0.5 LXC'] })
    expect(v.pass).toBe(false)
    expect(v.detail).toContain('does not name Paid')
  })
})
