import { describe, expect, it } from 'vitest'
import { pastStatements, pastStatementsButton } from '../src/bank.ts'

// B17.513 — B57.187 made the Your data card's button name its file ("Download JSON"), and the driver still clicked
// "Download", so agent-balance-stored ERRORed at the statement download after Lens's book already agreed.
// A stub of the card: one button named `button`; clicking it downloads, and the download wait fails without one.
function stubPage(button: string) {
  let clicked: () => void = () => undefined
  const downloaded = new Promise<string>((resolve) => (clicked = () => resolve('agent-wallets-statement.json')))
  const field = { fill: async () => undefined, selectOption: async () => [] }
  const card = {
    getByLabel: () => field,
    getByRole: (_role: string, o: { name: string; exact: boolean }) => ({
      click: async () => {
        if (o.name !== button) throw new Error(`no button named "${o.name}"`)
        clicked()
      },
    }),
  }
  return {
    goto: async () => null,
    url: () => 'https://app.talyvor.test/home',
    getByRole: () => ({ locator: () => card }),
    waitForEvent: () => Promise.race([downloaded, new Promise((_, reject) => setTimeout(() => reject(new Error('no download')), 50))]),
  }
}

describe('Your data › past statements (B17.513)', () => {
  it('downloads from the card whose button reads "Download JSON"', async () => {
    const page = stubPage('Download JSON') as unknown as Parameters<typeof pastStatements>[0]
    await expect(pastStatements(page, '2026-11-01', '2026-11-19', 'json')).resolves.toBe('agent-wallets-statement.json')
  })

  it('still fails on a card with no such button', async () => {
    const page = stubPage('Download') as unknown as Parameters<typeof pastStatements>[0]
    await expect(pastStatements(page, '2026-11-01', '2026-11-19', 'json')).rejects.toThrow()
  })

  it('names the button as the web does for every file type', () => {
    expect(['csv', 'json', 'pdf', 'journal'].map((t) => pastStatementsButton(t as 'csv'))).toEqual(['Download CSV', 'Download JSON', 'Download PDF', 'Download journal'])
  })
})
