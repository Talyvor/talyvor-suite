import type { Locator } from 'playwright'
import { describe, expect, it } from 'vitest'
import { bandBalance, csvClosing } from '../src/accountStatements.ts'

// B17.471 — the band's Balance now draws the figure with the account's currency on a line under it (the design's band):
// <dd><span data-money>£25.00</span><span>GBP</span></dd>. The balance is the figure, not the cell's whole text.
type Node = { text: string; parts?: Record<string, Node>; items?: Node[] }
interface Fake { locator: (sel: string) => Fake; nth: (i: number) => Fake; textContent: () => Promise<string> }
const fake = (n: Node): Fake => ({
  locator: (sel: string) => fake(n.parts?.[sel] ?? { text: '' }),
  nth: (i: number) => fake(n.items?.[i] ?? { text: '' }),
  textContent: async () => n.text,
})

describe('account-statements (B17.471)', () => {
  it("reads the band's Balance now as its figure alone, without the currency line under it", async () => {
    const cell = (figure: string): Node => ({ text: `${figure}GBP`, parts: { '[data-money]': { text: figure } } })
    const dds: Node = { text: '', items: [cell('£0.00'), cell('+£25.00'), cell('£0.00'), cell('£25.00')] }
    const band = fake({ text: '', parts: { dd: dds } }) as unknown as Pick<Locator, 'locator'>
    expect(await bandBalance(band)).toBe('£25.00')
  })
})

// B17.502 — Lens's statement CSV has columns after balance_after_minor (task, state), so its closing row ends ",2500,,".
// The production run of 19 Nov read that file, whose closing is 2500, as not closing on 2500.
describe('account-statements (B17.502)', () => {
  const csv = [
    'entry_id,line,at,kind,amount_minor,currency,funding,counterparty,memo,partner_ref,balance_after_minor,task,state',
    ',,2026-11-01T00:00:00Z,opening,,GBP,,,,,0,,',
    'mle_28e1d1b7,2,2026-11-19T02:07:20.460961Z,payment_in,2500,GBP,test,Talyvor,"Money added, by hand",,2500,,',
    ',,2026-11-20T00:00:00Z,closing,,GBP,,,,,2500,,',
  ].join('\n') + '\n'

  it("reads the closing balance of Lens's CSV by its column name", () => {
    expect(csvClosing(csv)).toBe(2500)
  })

  it('finds no closing when the last row is not the closing one', () => {
    expect(csvClosing(csv.trim().split('\n').slice(0, 3).join('\n'))).toBeUndefined()
  })
})
