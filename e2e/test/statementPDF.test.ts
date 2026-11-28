import { describe, expect, it } from 'vitest'
import { dollarsCell, pdfBalances, statementPDFVerdict } from '../src/statementPDF.ts'

// statement-pdf's agent as Lens B28.328 draws it: funded $0.20 and $0.0350001 taken back today, so it opens at 0 and
// closes at $0.1649999; the workspace's own account beside it in every agent's statement. B61.16: in dollars alone.
const json = [
  { account: 'agent:agt_p', opening_ulxc: 0, closing_ulxc: 1_649_999 },
  { account: 'workspace', opening_ulxc: 25_000_000_000, closing_ulxc: 24_998_350_001 },
]
// One section as Lens B61.131 draws it (internal/market/statement_pdf.go): the band, the table's opening and closing
// rows, then how it adds up — every cell a `(…) Tj`, as in the PDF the 2026-11-28 run downloaded.
const cells = (...c: string[]) => c.map((t) => `BT /F2 9.50 Tf 0.00 Tc 0 0 0 rg 40.00 500.00 Td (${t}) Tj ET\n`).join('')
const section = (account: string, opening: string, moneyIn: string, out: string, closing: string) =>
  cells('AGENT STATEMENT', account, 'OPENING BALANCE', opening, 'MONEY IN', moneyIn, 'MONEY OUT', out, 'CLOSING BALANCE', closing) +
  cells('Opening balance', opening.slice(1), '9 Nov 08:00', 'fund', moneyIn.slice(1), 'Closing balance', out.slice(1), moneyIn.slice(1), closing.slice(1)) +
  cells(opening, 'opening', '+', moneyIn, 'in', '\u2013', out, 'out', '=', closing, 'closing', 'Page 1 of 1')
const pdf = (closing = '$0.1649999') =>
  '%PDF-1.4\n' + section('agent:agt_p', '$0.00', '$0.20', '$0.0350001', closing) +
  section('workspace', '$2,500.00', '$0.0350001', '$0.20', '$2,499.8350001') + '%%EOF\n'
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

  it("reads each section's opening and closing from its band, not the table or how it adds up (B17.583)", () => {
    // The cells the 2026-11-28 run read as "+" and "Page 1 of 1": the word "opening" or "closing" in HOW THIS ADDS UP.
    const one = '%PDF-1.4\n' + section('agent:agt_p', '$0.00', '$0.20', '$0.0350001', '$0.1649999') + '%%EOF\n'
    expect(pdfBalances(one)).toEqual({ opening: ['$0.00'], closing: ['$0.1649999'] })
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
