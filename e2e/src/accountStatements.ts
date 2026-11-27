// B56.15 — a currency account's statement in the app, once a run, on a workspace of its own. On Lens's API the owner
// opens the company's GBP account and puts £25.00 of test money in it. Through the app's BFF, the account's statement
// for this month is Lens's own (Lens B56.14): the same opening, in, out and closing, opening + in − out = closing, the
// closing what the account holds, and the £25.00 one line of it. Download CSV is Lens's file and closes on the same
// figure. B17.579 — Statements is one sheet of paper (B61.134, Statements S4): under Statement for the owner chooses the
// British pound balance, the paper's band reads that balance, and its PDF and Excel each download under DESIGN.md 16.1's
// name, talyvor-statement-GBP-YYYY-MM, answered 200 as their own type.

import { randomBytes } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Locator, Page } from 'playwright'
import { fail } from './bank.ts'
import type { Scenario } from './scenarios.ts'
import { call, said } from './settings.ts'

const TIMEOUT_MS = 30_000
const FUND_MINOR = 2500

/** B17.579 — the paper's two other files, as the Download card names them, each sent as its own type and opening as one. */
export const PAPER_FILES = [
  { name: 'PDF', format: 'pdf', type: 'application/pdf', magic: '%PDF-' },
  { name: 'Excel', format: 'xlsx', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', magic: 'PK\u0003\u0004' },
] as const

interface Account { id: string; purpose: string; currency: string; balance_minor: number }
interface Statement { account_id: string; currency: string; opening_minor: number; in_minor: number; out_minor: number; closing_minor: number
  lines: { entry_id: string; amount_minor: number; balance_after_minor: number }[] | null }

/** A GET the page's own script makes through the BFF: the status, the content type and the body as text. */
async function fromPage(page: Page, path: string): Promise<{ status: number; type: string; text: string }> {
  return page.evaluate(async (p) => {
    const res = await fetch(p, { credentials: 'same-origin' })
    return { status: res.status, type: res.headers.get('Content-Type') ?? '', text: await res.text() }
  }, path)
}

const day = (d: Date) => d.toISOString().slice(0, 10)

/** The band's Balance now: its figure alone. Under each figure the band names the currency ("GBP"), as the design's band
 * puts a second line under each figure, so the figure is read from its <Money> ([data-money]), not the whole <dd>. */
export async function bandBalance(band: Pick<Locator, 'locator'>): Promise<string> {
  return ((await band.locator('dd').nth(3).locator('[data-money]').textContent()) ?? '').trim()
}

/** One CSV row's fields; a quoted field may hold commas and doubled quotes. */
function fields(row: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < row.length; i++) {
    const c = row[i]
    if (quoted) {
      if (c === '"' && row[i + 1] === '"') { cur += '"'; i++ } else if (c === '"') quoted = false
      else cur += c
    } else if (c === '"') quoted = true
    else if (c === ',') { out.push(cur); cur = '' } else cur += c
  }
  out.push(cur)
  return out
}

/** The closing balance Lens's statement CSV ends on: the last row, its kind "closing", read by the header's own column
 * names. Lens adds columns after balance_after_minor (task, state), so the figure is found by name, not by position. */
export function csvClosing(text: string): number | undefined {
  const rows = text.trim().split(/\r?\n/)
  if (rows.length < 2) return undefined
  const head = fields(rows[0])
  const last = fields(rows[rows.length - 1])
  const kind = head.indexOf('kind')
  const balance = head.indexOf('balance_after_minor')
  if (kind < 0 || balance < 0 || last[kind] !== 'closing' || !/^-?\d+$/.test(last[balance] ?? '')) return undefined
  return Number(last[balance])
}

export function accountStatements(): Scenario {
  return {
    id: 'account-statements',
    owner: 'talyvor-suite',
    own: true,
    items: ['B56.15'],
    feature: 'Agent wallets',
    title: "a currency account's statement on Statements: £25.00 paid in is its one line, the app's statement is Lens's, " +
      'opening + in − out = closing = what the account holds, the CSV closes on it, Statement for › British pound shows it, and its PDF and Excel download',
    run: async (ctx) => {
      const step = async <T>(method: string, path: string, body: unknown, note: string) => {
        const r = await call<T>(ctx, method, path, body)
        ctx.evidence.push({ note, answer: said(r) })
        return r
      }
      // 1. On Lens's API: the company's GBP account, and £25.00 of test money in it.
      const terms = await step<{ terms: { capability: string; version: number; accepted?: unknown }[] | null }>('GET', '/v1/workspaces/{ws}/terms', undefined, 'the owner reads the terms')
      for (const t of (terms.value?.terms ?? []).filter((x) => ['currency_accounts', 'payments_in'].includes(x.capability) && x.accepted == null)) {
        const ok = await step('POST', `/v1/workspaces/{ws}/terms/${t.capability}/accept`, { version: t.version }, `the owner accepts ${t.capability}'s terms`)
        if (ok.status !== 201) return fail(`accepting ${t.capability}'s terms answered ${said(ok)}`)
      }
      const account = await step<Account>('POST', '/v1/money/accounts', { currency: 'GBP' }, 'the company GBP account')
      if (account.status !== 201 || account.value === undefined) return fail(`opening the company GBP account answered ${said(account)}`)
      const id = account.value.id
      const funded = await step('POST', `/v1/money/accounts/${id}/test-money`, { amount_minor: FUND_MINOR, idempotency_key: `e2e-${randomBytes(8).toString('hex')}` }, 'GBP 25.00 in it')
      if (funded.status !== 201) return fail(`putting GBP 25.00 in the company GBP account answered ${said(funded)}`)

      // 2. This month's statement, through the app and from Lens, and what the account holds.
      const now = new Date()
      const period = `from=${day(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)))}&to=${day(new Date(now.getTime() + 86_400_000))}`
      const lens = await step<Statement>('GET', `/v1/money/accounts/${id}/statement?${period}`, undefined, "Lens's statement for this month")
      if (lens.status !== 200 || lens.value === undefined) return fail(`Lens's statement answered ${said(lens)}`)
      const listed = await step<{ accounts: Account[] | null }>('GET', '/v1/money/accounts', undefined, 'the accounts')
      const holds = (listed.value?.accounts ?? []).find((a) => a.id === id)?.balance_minor
      const page = await ctx.app.tab('/statements')
      try {
        const shown = await fromPage(page, `/api/money/accounts/${id}/statement?${period}`)
        ctx.evidence.push({ note: "the app's statement for this month", answer: `${shown.status} ${shown.text.slice(0, 600)}` })
        if (shown.status !== 200) return fail(`the app's statement answered ${shown.status}: ${shown.text.slice(0, 200)}`)
        const st = JSON.parse(shown.text) as Statement
        const figures = (s: Statement) => [s.opening_minor, s.in_minor, s.out_minor, s.closing_minor].join(' ')
        if (figures(st) !== figures(lens.value) || (st.lines ?? []).length !== (lens.value.lines ?? []).length) {
          return fail(`the app's statement must be Lens's; the app reads ${figures(st)} with ${(st.lines ?? []).length} lines, Lens ${figures(lens.value)} with ${(lens.value.lines ?? []).length}`)
        }
        if (st.opening_minor + st.in_minor - st.out_minor !== st.closing_minor) return fail(`opening + in − out must be the closing; the statement reads ${figures(st)}`)
        if (st.closing_minor !== holds) return fail(`the statement closes on ${st.closing_minor}; the account holds ${holds}`)
        const lines = st.lines ?? []
        if (lines.length !== 1 || lines[0].amount_minor !== FUND_MINOR || lines[0].balance_after_minor !== st.closing_minor) {
          return fail(`£25.00 paid in must be the new account's one line, its balance after the closing; the statement's lines read ${JSON.stringify(lines)}`)
        }

        // 3. Download CSV: Lens's file, closing on the same figure.
        const csv = await fromPage(page, `/api/money/accounts/${id}/statement?${period}&format=csv`)
        const closing = csv.text.trim().split('\n').at(-1) ?? ''
        ctx.evidence.push({ note: 'the CSV', answer: `${csv.status} ${csv.type} ${csv.text.slice(0, 400)}` })
        if (csv.status !== 200 || !csv.type.startsWith('text/csv') || csvClosing(csv.text) !== st.closing_minor) {
          return fail(`Download CSV must be Lens's file closing on ${st.closing_minor}; it answered ${csv.status} ${csv.type}, last line "${closing}"`)
        }

        // 4. On Statements: Statement for › Balance › British pound, the paper's band the closing.
        await page.goto(new URL('/statements', page.url()).toString())
        const pound = page.getByRole('radiogroup', { name: 'Balance' }).getByRole('radio', { name: 'British pound', exact: true })
        if (!(await pound.waitFor({ timeout: TIMEOUT_MS }).then(() => true, () => false))) return fail("Statements' Statement for must offer the British pound balance; it does not")
        await pound.click()
        if ((await pound.getAttribute('aria-checked')) !== 'true') return fail('British pound must be the balance chosen under Statement for')
        if (!(await page.waitForURL((u) => u.searchParams.get('wallet') === id, { timeout: TIMEOUT_MS }).then(() => true, () => false))) {
          return fail(`choosing British pound must open the company GBP account's paper (?wallet=${id}); the page is ${page.url()}`)
        }
        const band = page.locator('[data-testid="account-statement-band"]')
        if (!(await band.waitFor({ timeout: TIMEOUT_MS }).then(() => true, () => false))) return fail("Statements must show the company GBP account's band; it does not")
        const balance = await bandBalance(band)
        const want = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(st.closing_minor / 100)
        ctx.evidence.push({ note: 'the band', answer: ((await band.textContent()) ?? '').replace(/\s+/g, ' ') })
        if (balance !== want) return fail(`the band's Balance must read ${want}; it reads "${balance}"`)

        // 5. The paper's PDF and Excel: each 200 as its own type, saved under DESIGN.md 16.1's name for this month.
        const month = day(now).slice(0, 7)
        const downloads = page.locator('[data-testid="statement-download"]')
        for (const f of PAPER_FILES) {
          const wantName = `talyvor-statement-GBP-${month}.${f.format}`
          const got = await Promise.all([
            page.waitForEvent('download', { timeout: TIMEOUT_MS }),
            page.waitForResponse((r) => r.url().includes(`/api/money/accounts/${id}/statement?`) && new URL(r.url()).searchParams.get('format') === f.format, { timeout: TIMEOUT_MS }),
            downloads.getByRole('button', { name: `Download ${f.name}`, exact: true }).click({ timeout: TIMEOUT_MS }),
          ]).catch((e: unknown) => e instanceof Error ? e : new Error(String(e)))
          if (got instanceof Error) return fail(`Download ${f.name} must save the paper's ${f.name}; it did not: ${got.message.split('\n')[0]}`)
          const [download, res] = got
          const type = res.headers()['content-type'] ?? ''
          // The file as saved: the page reads the response as a blob, after which Playwright gives its body back empty.
          const head = (await readFile(await download.path())).subarray(0, f.magic.length).toString('latin1')
          ctx.evidence.push({ note: `Download ${f.name}`, answer: `${res.status()} ${type}, saved as ${download.suggestedFilename()}` })
          if (res.status() !== 200 || !type.startsWith(f.type) || head !== f.magic) {
            return fail(`Download ${f.name} must answer 200 as ${f.type}; it answered ${res.status()} ${type || 'with no type'}, starting "${JSON.stringify(head).slice(1, -1)}"`)
          }
          if (download.suggestedFilename() !== wantName) return fail(`Download ${f.name} must save ${wantName}; it saved ${download.suggestedFilename()}`)
        }
        await mkdir(ctx.env.outDir, { recursive: true })
        const viewport = page.viewportSize()
        for (const width of [1440, 390]) {
          const path = join(ctx.env.outDir, `account-statements-${width}px-user${ctx.app.user.index}.png`)
          await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
          await page.screenshot({ path, fullPage: true })
          ctx.evidence.push({ note: `Statements at ${width}px: ${path}` })
        }
        if (viewport !== null) await page.setViewportSize(viewport)
        return { pass: true, detail: `£25.00 in is the one line; the app's statement is Lens's (${figures(st)}), closing on what the account holds; the CSV closes on it; British pound reads ${want}; its PDF and Excel saved as talyvor-statement-GBP-${month}` }
      } finally {
        await page.close()
      }
    },
  }
}
