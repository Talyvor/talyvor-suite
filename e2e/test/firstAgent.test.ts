import { describe, expect, it } from 'vitest'
import { type FirstAgentSeen, STARTER_ROW, firstAgentVerdict } from '../src/firstAgent.ts'
import { CannotTest } from '../src/scenarios.ts'

// B45.36 — the first-agent verdict: the first sign-in returns the agent and its key, a request on the key is a line on its
// statement, its starting test money is one starter_test_money row, and a second sign-in makes no second agent.

const agent = { id: 'agt_1', name: 'My first agent' }
const SEEN: FirstAgentSeen = {
  first: { workspace_id: 'u1', created: true, token: 't', expires_at: '', first_agent: { agent, key: 'tlv_k', key_id: 'key_1', template: 'support-bot', test_money_ulxc: 1_000_000 } },
  asked: { status: 200, error: '' },
  lines: [
    { entry_id: 'e2', kind: 'spend', amount_ulxc: -40, counterparty: 'spend', balance_after_ulxc: 999_960, at: '' },
    { entry_id: 'e1', kind: 'fund', amount_ulxc: 1_000_000, counterparty: 'workspace', balance_after_ulxc: 1_000_000, at: '' },
  ],
  ledger: [{ id: 'r1', amount_ulxc: 1_000_000, balance_after_ulxc: 1_000_000, type: STARTER_ROW, description: '', metadata: { funding: 'test' }, created_at: '' }],
  second: { workspace_id: 'u1', created: false, token: 't2', expires_at: '' },
  agentsAfter: 1,
}

describe('first-agent (B45.36)', () => {
  it('passes on a started workspace whose agent was served and charged', () => {
    expect(firstAgentVerdict(SEEN).pass).toBe(true)
  })

  it('fails with no first_agent, no request line, a missing starter row, or a second first agent', () => {
    expect(firstAgentVerdict({ ...SEEN, first: { ...SEEN.first, first_agent: undefined } }).pass).toBe(false)
    expect(firstAgentVerdict({ ...SEEN, lines: SEEN.lines.slice(1) }).pass).toBe(false)
    expect(firstAgentVerdict({ ...SEEN, ledger: [] }).pass).toBe(false)
    expect(firstAgentVerdict({ ...SEEN, second: SEEN.first }).pass).toBe(false)
    expect(firstAgentVerdict({ ...SEEN, agentsAfter: 2 }).pass).toBe(false)
  })

  it('skips, rather than fails, a 402 while Lens gives no starting test money; any other refusal fails', () => {
    const none = { ...SEEN, first: { ...SEEN.first, first_agent: { ...SEEN.first.first_agent!, test_money_ulxc: 0 } }, asked: { status: 402, error: 'insufficient' } }
    expect(() => firstAgentVerdict(none)).toThrow(CannotTest)
    expect(firstAgentVerdict({ ...none, asked: { status: 401, error: 'unauthorized' } }).pass).toBe(false)
    expect(firstAgentVerdict({ ...SEEN, asked: { status: 402, error: 'insufficient' } }).pass).toBe(false)
  })
})
