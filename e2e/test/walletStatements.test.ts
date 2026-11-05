import { describe, expect, it } from 'vitest'
import { type AgentMonth, type TaxExport, type WalletLine, walletStatementsVerdict } from '../src/walletStatements.ts'

// B48.29 — wallet-statements' oracle on what Lens B48.14 answers for its month: Treasury funded 10000 by a card-paid invoice
// and paying Spender's invoice of 5000; Spender charged 1234 on a card capped at 3000.
const line = (entry: string, account: string, kind: string, amount: number, after: number): WalletLine => ({
  entry_id: entry, account_id: account, kind, amount_minor: amount, balance_after_minor: after,
})
const csv = (account: string, closing: number) => [
  'entry_id,line,at,account_id,agent_id,currency,kind,amount_minor,funding,counterparty,ref,memo,balance_after_minor',
  `,,2026-11-01T00:00:00Z,${account},agt,GBP,opening,,,,,,0`,
  `ent_1,0,2026-11-05T03:00:00Z,${account},agt,GBP,invoice_payment,5000,test,"Treasury, Ltd",,Invoice INV-1,5000`,
  `,,2026-11-05T03:01:00Z,${account},agt,GBP,closing,,,,,,${closing}`,
].join('\r\n')
const pdf = (closing: string) => `%PDF-1.4\n... (Spender GBP: opening 0.00 GBP, in 6766.00 GBP, out 3000.00 GBP, closing ${closing}) Tj ...`

function months(spenderClosing = 3766): AgentMonth[] {
  const spenderLines = [line('ent_move', 'acc_s', 'invoice_payment', 5000, 5000), line('ent_hold', 'acc_s', 'card_hold', -3000, 2000),
    line('ent_charge', 'acc_s', 'card_charge', 1766, 3766)]
  const treasuryLines = [line('ent_in', 'acc_t', 'invoice_card', 10_000, 10_000), line('ent_move', 'acc_t', 'invoice_payment', -5000, 5000)]
  return [
    { name: 'Treasury', account: 'acc_t', made: [{ kind: 'invoice_card' }, { kind: 'invoice_payment', amount_minor: -5000 }],
      statement: { accounts: [{ account_id: 'acc_t', opening_minor: 0, in_minor: 10_000, out_minor: 5000, closing_minor: 5000 }], lines: treasuryLines },
      csv: csv('acc_t', 5000), pdf: pdf('50.00 GBP'), activity: [...treasuryLines].reverse() },
    { name: 'Spender', account: 'acc_s', made: [{ kind: 'invoice_payment', amount_minor: 5000 }, { kind: 'card_hold', amount_minor: -3000 }, { kind: 'card_charge', amount_minor: 1766 }],
      closing: 3766,
      statement: { accounts: [{ account_id: 'acc_s', opening_minor: 0, in_minor: 6766, out_minor: 6766 - spenderClosing, closing_minor: spenderClosing }], lines: spenderLines },
      csv: csv('acc_s', spenderClosing), pdf: pdf(`${(spenderClosing / 100).toFixed(2)} GBP`), activity: [...spenderLines].reverse() },
  ]
}
const ledger = new Map([['acc_t', 5000], ['acc_s', 3766]])
const tax: TaxExport = { currency: 'GBP', disposals: [], unpriced: [], proceeds_minor: 0, cost_basis_minor: 0, gain_minor: 0 }

describe('wallet-statements (B48.29)', () => {
  it('passes when every statement closes at the ledger in JSON, CSV, PDF and the newest activity, with nothing to cost', () => {
    const v = walletStatementsVerdict(ledger, months(), tax)
    expect(v.detail).toBe('Treasury closes at 50.00 GBP in JSON, CSV, PDF and its newest activity, as the ledger; ' +
      'Spender closes at 37.66 GBP in JSON, CSV, PDF and its newest activity, as the ledger; the tax export, in GBP, has nothing to cost')
    expect(v.pass).toBe(true)
  })

  it("FAILs when a statement's closing balance is not the ledger's", () => {
    const v = walletStatementsVerdict(ledger, months(4000), tax)
    expect(v.pass).toBe(false)
    expect(v.detail).toMatch(/Spender's statement closes acc_s at 4000; the ledger holds 3766/)
    expect(v.detail).toMatch(/Spender's CSV statement closes acc_s at 4000; the ledger holds 3766/)
    expect(v.detail).toMatch(/Spender's PDF statement does not close its GBP account at 37\.66 GBP/)
  })

  it('FAILs when a fiat month leaves something in the tax export', () => {
    const v = walletStatementsVerdict(ledger, months(), { ...tax, unpriced: [{ asset: 'ETH' }] })
    expect(v).toMatchObject({ pass: false })
    expect(v.detail).toMatch(/^with no token on a chain the tax export has nothing to cost/)
  })
})
