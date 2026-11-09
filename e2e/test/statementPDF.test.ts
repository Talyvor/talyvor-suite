import { describe, expect, it } from 'vitest'
import { lxcCell, statementPDFVerdict } from '../src/statementPDF.ts'

// statement-pdf's agent as Lens B28.328 draws it: funded 2 LXC and 0.350001 taken back today, so it opens at 0 and
// closes at 1.649999; the workspace's own account beside it in every agent's statement.
const json = [
  { account: 'agent:agt_p', opening_ulxc: 0, closing_ulxc: 1_649_999 },
  { account: 'workspace', opening_ulxc: 25_000_000_000, closing_ulxc: 24_998_350_001 },
]
const row = (account: string, word: string, balance: string) => `(9 Nov 00:00) Tj (${account}) Tj (${word}) Tj (${balance}) Tj\n`
const pdf = (closing = '1.649999 LXC') =>
  '%PDF-1.4\n(AGENT STATEMENT) Tj\n' +
  row('agent:agt_p', 'opening', '0 LXC') + row('workspace', 'opening', '25,000 LXC') +
  '(9 Nov 08:00) Tj (agent:agt_p) Tj (fund) Tj (workspace) Tj (2 LXC) Tj (2 LXC) Tj\n' +
  row('agent:agt_p', 'closing', closing) + row('workspace', 'closing', '24,998.350001 LXC') + '%%EOF\n'
const agent = { account: 'agent:agt_p', held: 1_649_999 }

describe('statement-pdf', () => {
  it('writes µLXC as Lens does', () => {
    expect([lxcCell(0), lxcCell(1_649_999), lxcCell(3_400_000_000), lxcCell(-1_234)]).toEqual(['0 LXC', '1.649999 LXC', '3,400 LXC', '-0.001234 LXC'])
  })

  it("passes when the PDF opens and closes every account at the JSON statement's balance", () => {
    const v = statementPDFVerdict({ name: 'agent-wallets-statement-2026-11-08-to-2026-11-09.pdf', text: pdf() }, json, agent)
    expect(v.detail).toContain('2 account(s)')
    expect(v.pass).toBe(true)
  })

  it("fails when the PDF closes an account at a figure that is not the JSON's", () => {
    const v = statementPDFVerdict({ name: 's.pdf', text: pdf('1.65 LXC') }, json, agent)
    expect(v.pass).toBe(false)
    expect(v.detail).toContain('closes agent:agt_p at 1.65 LXC; the JSON statement at 1.649999 LXC')
  })

  it('fails when the JSON statement does not close the agent at what the book holds', () => {
    const v = statementPDFVerdict({ name: 's.pdf', text: pdf() }, json, { ...agent, held: 2_000_000 })
    expect(v.pass).toBe(false)
    expect(v.detail).toContain("Lens's book holds 2000000")
  })

  it('fails when the file is not a PDF', () => {
    const v = statementPDFVerdict({ name: 's.pdf', text: '{"error":"Lens could not answer just now"}' }, json, agent)
    expect(v.pass).toBe(false)
    expect(v.detail).toContain('is not a PDF')
  })
})
