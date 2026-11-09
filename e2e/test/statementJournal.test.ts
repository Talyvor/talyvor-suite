import { describe, expect, it } from 'vitest'
import { csvRows, journalULXC, statementJournalVerdict } from '../src/statementJournal.ts'

// statement-journal's agent as Lens B28.329 writes it: funded 3 LXC and 1.250001 taken back today, the workspace's own
// account beside it in every agent's statement.
const json = [
  { account: 'agent:agt_j', in_ulxc: 3_000_000, out_ulxc: 1_250_001, closing_ulxc: 1_749_999 },
  { account: 'workspace', in_ulxc: 1_250_001, out_ulxc: 3_000_000, closing_ulxc: 24_998_250_001 },
]
const HEAD = 'journal_no,date,account,description,debit_lxc,credit_lxc,cost_centre,ref\r\n'
const journal = (back = '1.250001') =>
  HEAD +
  'ent_1,2026-11-09,agent:agt_j,fund,3.000000,,agt_j,\r\n' +
  'ent_1,2026-11-09,workspace,fund,,3.000000,agt_j,\r\n' +
  `ent_2,2026-11-09,agent:agt_j,"withdraw, by owner",,${back},agt_j,\r\n` +
  'ent_2,2026-11-09,workspace,"withdraw, by owner",1.250001,,agt_j,\r\n'
const agent = { account: 'agent:agt_j', held: 1_749_999 }

describe('statement-journal', () => {
  it('reads Lens’s amounts and quoted cells', () => {
    expect([journalULXC(''), journalULXC('1.250001'), journalULXC('3000.000000'), journalULXC('1.25')]).toEqual([0, 1_250_001, 3_000_000_000, undefined])
    expect(csvRows('a,"b, ""c"""\r\nd,\r\n')).toEqual([['a', 'b, "c"'], ['d', '']])
  })

  it("passes when debits equal credits equal the JSON statement's in and out", () => {
    const v = statementJournalVerdict({ name: 'agent-wallets-journal-2026-11-08-to-2026-11-09.csv', text: journal() }, json, agent)
    expect(v.detail).toContain('2 journal(s), debits 4250001 µLXC = credits 4250001')
    expect(v.pass).toBe(true)
  })

  it('fails when a journal does not balance', () => {
    const v = statementJournalVerdict({ name: 'j.csv', text: journal('1.250000') }, json, agent)
    expect(v.pass).toBe(false)
    expect(v.detail).toContain('journal ent_2 does not balance by 1 µLXC')
    expect(v.detail).toContain('credits agent:agt_j 1250000 µLXC; the JSON statement has 1250001 out')
  })

  it('fails when the JSON statement does not close the agent at what the book holds', () => {
    const v = statementJournalVerdict({ name: 'j.csv', text: journal() }, json, { ...agent, held: 3_000_000 })
    expect(v.pass).toBe(false)
    expect(v.detail).toContain("Lens's book holds 3000000")
  })

  it('fails when the file is not the journal', () => {
    const v = statementJournalVerdict({ name: 'j.csv', text: 'posting_id,entry_id,at,account\r\n' }, json, agent)
    expect(v.pass).toBe(false)
    expect(v.detail).toContain('is not the journal')
  })
})
