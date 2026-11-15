import { describe, expect, it } from 'vitest'
import { dollarsCell, statementPDFVerdict } from '../src/statementPDF.ts'

// statement-pdf's agent as Lens B28.328 draws it: funded $0.20 and $0.0350001 taken back today, so it opens at 0 and
// closes at $0.1649999; the workspace's own account beside it in every agent's statement. B61.16: in dollars alone.
const json = [
  { account: 'agent:agt_p', opening_ulxc: 0, closing_ulxc: 1_649_999 },
  { account: 'workspace', opening_ulxc: 25_000_000_000, closing_ulxc: 24_998_350_001 },
]
const row = (account: string, word: string, balance: string) => `(9 Nov 00:00) Tj (${account}) Tj (${word}) Tj (${balance}) Tj\n`
const pdf = (closing = '$0.1649999') =>
  '%PDF-1.4\n(AGENT STATEMENT) Tj\n' +
  row('agent:agt_p', 'opening', '$0.00') + row('workspace', 'opening', '$2,500.00') +
  '(9 Nov 08:00) Tj (agent:agt_p) Tj (fund) Tj (workspace) Tj ($0.20) Tj ($0.20) Tj\n' +
  row('agent:agt_p', 'closing', closing) + row('workspace', 'closing', '$2,499.8350001') + '%%EOF\n'
const agent = { account: 'agent:agt_p', held: 1_649_999 }

describe('statement-pdf', () => {
  it('writes µLXC as Lens does, its dollars alone (economy.LXCMoney, B61.16)', () => {
    expect([dollarsCell(0), dollarsCell(1), dollarsCell(1_649_999), dollarsCell(2_000_000), dollarsCell(3_400_000_000), dollarsCell(-1_234)])
      .toEqual(['$0.00', '$0.0000001', '$0.1649999', '$0.20', '$340.00', '-$0.0001234'])
  })

  it("passes when the PDF opens and closes every account at the JSON statement's balance", () => {
    const v = statementPDFVerdict({ name: 'agent-wallets-statement-2026-11-08-to-2026-11-09.pdf', text: pdf() }, json, agent)
    expect(v.detail).toContain('2 account(s)')
    expect(v.pass).toBe(true)
  })

  it('reads past the empty WITH and AMOUNT cells Lens draws on an opening or closing row', () => {
    // Lens's table PDF (B48.14) draws every cell, so an opening row is its date, account, word, two empty cells, then
    // the balance — the cells the 2026-11-10 run read as "".
    const drawn = pdf().replaceAll(/\((opening|closing)\) Tj /g, '($1) Tj () Tj () Tj ')
    const v = statementPDFVerdict({ name: 's.pdf', text: drawn }, json, agent)
    expect(v.detail).toContain('2 account(s)')
    expect(v.pass).toBe(true)
  })

  it("fails when the PDF closes an account at a figure that is not the JSON's", () => {
    const v = statementPDFVerdict({ name: 's.pdf', text: pdf('$0.165') }, json, agent)
    expect(v.pass).toBe(false)
    expect(v.detail).toContain('closes agent:agt_p at $0.165; the JSON statement at $0.1649999')
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
