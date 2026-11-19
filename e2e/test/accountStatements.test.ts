import type { Locator } from 'playwright'
import { describe, expect, it } from 'vitest'
import { bandBalance } from '../src/accountStatements.ts'

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
