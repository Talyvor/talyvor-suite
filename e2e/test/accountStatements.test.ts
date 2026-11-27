import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Locator } from 'playwright'
import { describe, expect, it } from 'vitest'
import { accountStatements, bandBalance, csvClosing } from '../src/accountStatements.ts'
import type { ScenarioCtx } from '../src/scenarios.ts'

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

// B17.579 — Statements is one sheet of paper (B61.134, Statements S4): no tabs, but a Statement for card whose Balance
// radios choose the account, and a Download card of PDF, Excel and CSV. The whole scenario runs against a page with S4's
// roles only, so the old getByRole('tab', { name: 'Company · GBP' }) times out on it as it did in the nightly of 27 Nov.
describe('account-statements (B17.579)', () => {
  const ID = 'acct_gbp'
  const month = new Date().toISOString().slice(0, 7)
  const STATEMENT = { account_id: ID, currency: 'GBP', opening_minor: 0, in_minor: 2500, out_minor: 0, closing_minor: 2500,
    lines: [{ entry_id: 'mle_1', amount_minor: 2500, balance_after_minor: 2500 }] }
  const CSV = ['entry_id,line,at,kind,amount_minor,currency,funding,counterparty,memo,partner_ref,balance_after_minor,task,state',
    `,,${month}-01T00:00:00Z,opening,,GBP,,,,,0,,`, `mle_1,1,${month}-02T09:00:00Z,payment_in,2500,GBP,test,Talyvor,Money added,,2500,,`,
    `,,${month}-03T00:00:00Z,closing,,GBP,,,,,2500,,`].join('\n') + '\n'
  const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

  const lens = {
    as: async (_token: string, method: string, path: string) => {
      const answer = (status: number, body: unknown) => ({ status, text: JSON.stringify(body) })
      if (path === '/v1/workspaces/ws_1/terms') return answer(200, { terms: [] })
      if (method === 'POST' && path === '/v1/money/accounts') return answer(201, { id: ID, purpose: 'company', currency: 'GBP', balance_minor: 0 })
      if (method === 'POST' && path === `/v1/money/accounts/${ID}/test-money`) return answer(201, {})
      if (path.startsWith(`/v1/money/accounts/${ID}/statement?`)) return answer(200, STATEMENT)
      if (path === '/v1/money/accounts') return answer(200, { accounts: [{ id: ID, purpose: 'company', currency: 'GBP', balance_minor: 2500 }] })
      return answer(404, { error: `no route ${method} ${path}` })
    },
  }

  type Files = Record<string, { type: string; body: string; name: string }>
  const files = (over: Partial<Files> = {}): Files => ({
    pdf: { type: 'application/pdf', body: '%PDF-1.7\n', name: `talyvor-statement-GBP-${month}.pdf` },
    xlsx: { type: XLSX, body: 'PK\u0003\u0004…', name: `talyvor-statement-GBP-${month}.xlsx` },
    ...over,
  })

  /** A page with Statements S4's roles: the Balance radios, the paper's band and the Download card; nothing else. */
  function s4(served: Files) {
    let url = 'https://app.test/statements'
    let chosen = false
    const waiting: { download?: (d: unknown) => void; response?: { match: (r: unknown) => boolean; resolve: (r: unknown) => void } } = {}
    const missing = (what: string) => {
      const timeout = async () => { throw new Error(`locator: Timeout 30000ms exceeded.\nwaiting for ${what}`) }
      return { waitFor: timeout, click: timeout, getAttribute: timeout, textContent: timeout, getByRole: () => missing(what), locator: () => missing(what), nth: () => missing(what) }
    }
    const found = { waitFor: async () => undefined }
    const page = {
      url: () => url,
      goto: async (to: string) => { url = to },
      evaluate: async (_fn: unknown, path: string) => {
        if (!path.startsWith(`/api/money/accounts/${ID}/statement?`)) return { status: 404, type: 'application/json', text: '{}' }
        return path.includes('format=csv') ? { status: 200, type: 'text/csv; charset=utf-8', text: CSV } : { status: 200, type: 'application/json', text: JSON.stringify(STATEMENT) }
      },
      getByRole: (role: string, o: { name: string }) => role !== 'radiogroup' || o.name !== 'Balance' ? missing(`getByRole('${role}', { name: '${o.name}' })`) : {
        getByRole: (r: string, n: { name: string; exact?: boolean }) => r !== 'radio' || n.name !== 'British pound' ? missing(`getByRole('${r}', { name: '${n.name}' })`) : {
          ...found,
          click: async () => { chosen = true; url = `https://app.test/statements?wallet=${ID}&period=month` },
          getAttribute: async (a: string) => (a === 'aria-checked' ? String(chosen) : null),
        },
      },
      waitForURL: async (ok: (u: URL) => boolean) => { if (!ok(new URL(url))) throw new Error(`waitForURL: Timeout 30000ms exceeded at ${url}`) },
      locator: (sel: string) => {
        if (sel === '[data-testid="account-statement-band"]') {
          const cell = { locator: () => ({ textContent: async () => '£25.00' }) }
          return { ...found, textContent: async () => 'Opening balance£0.00Money in£25.00Money out£0.00Balance now£25.00', locator: () => ({ nth: () => cell }) }
        }
        if (sel !== '[data-testid="statement-download"]') return missing(`locator('${sel}')`)
        return {
          getByRole: (r: string, n: { name: string }) => {
            const format = { 'Download PDF': 'pdf', 'Download Excel': 'xlsx', 'Download CSV': 'csv' }[n.name]
            const f = format === undefined || format === 'csv' ? undefined : served[format]
            if (r !== 'button' || f === undefined || format === undefined) return missing(`getByRole('${r}', { name: '${n.name}' })`)
            return {
              click: async () => {
                const res = { url: () => `https://app.test/api/money/accounts/${ID}/statement?from=${month}-01&to=${month}-28&format=${format}`,
                  status: () => 200, headers: () => ({ 'content-type': f.type }) }
                const saved = join(await mkdtemp(join(tmpdir(), 'account-statements-')), f.name)
                await writeFile(saved, f.body, 'latin1')
                if (waiting.response?.match(res)) waiting.response.resolve(res)
                waiting.download?.({ suggestedFilename: () => f.name, path: async () => saved })
              },
            }
          },
        }
      },
      waitForEvent: (_e: 'download') => new Promise((resolve) => { waiting.download = resolve }),
      waitForResponse: (match: (r: unknown) => boolean) => new Promise((resolve) => { waiting.response = { match, resolve } }),
      viewportSize: () => ({ width: 1280, height: 900 }),
      setViewportSize: async () => undefined,
      screenshot: async () => undefined,
      close: async () => undefined,
    }
    return page
  }

  const run = (served: Files) => accountStatements().run({
    app: { user: { token: 'tok', workspaceID: 'ws_1', index: 7 }, tab: async () => s4(served) },
    env: { lens, outDir: join(tmpdir(), `account-statements-${process.pid}`) },
    evidence: [],
  } as unknown as ScenarioCtx)

  it("passes on S4's paper: British pound chosen under Statement for, its band, and its PDF and Excel under 16.1's name", async () => {
    const v = await run(files())
    expect(v.detail).toBe(`£25.00 in is the one line; the app's statement is Lens's (0 2500 0 2500), closing on what the account holds; the CSV closes on it; ` +
      `British pound reads £25.00; its PDF and Excel saved as talyvor-statement-GBP-${month}`)
    expect(v.pass).toBe(true)
  })

  it('FAILs when the paper\'s Excel comes back as something other than a workbook', async () => {
    const v = await run(files({ xlsx: { type: 'application/json', body: '{"error":"no"}', name: `talyvor-statement-GBP-${month}.xlsx` } }))
    expect(v).toEqual({ pass: false, detail: `Download Excel must answer 200 as ${XLSX}; it answered 200 application/json, starting "{\\"er"` })
  })

  it("FAILs when a file is saved under another name than DESIGN.md 16.1's", async () => {
    const v = await run(files({ pdf: { type: 'application/pdf', body: '%PDF-1.7\n', name: 'statement.pdf' } }))
    expect(v).toEqual({ pass: false, detail: `Download PDF must save talyvor-statement-GBP-${month}.pdf; it saved statement.pdf` })
  })
})
