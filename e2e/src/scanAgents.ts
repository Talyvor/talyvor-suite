// B52.28 — Scan in the app (Lens B52.26 and B52.27), once a run, on a workspace of its own. On Lens's API the owner makes an
// agent and gives it a watch on German gas storage, unusual at more than 2.5 standard deviations from its normal; the watch reads
// back with that measure, a series Scan does not model is refused, and stopping the watch leaves it inactive. The public track
// record's every scored report is a hit exactly when its outcome is inside its range, and its counts add up. Every published report
// opens with its sources and the whole "How this report was made" box, a family lists only its own, an unpublished id answers 404,
// and no report carries buy or sell wording. In the app, Scan agents shows the watch, Track record shows the counts, and a report
// opens with its sources and box.

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fail } from './bank.ts'
import { RUN_SALT } from './oracles.ts'
import type { Scenario } from './scenarios.ts'
import { call, said } from './settings.ts'

const TIMEOUT_MS = 30_000
const SERIES = 'gie.agsi.de.full'
const TRADE = /\b(buy|buys|buying|sell|sells|selling)\b/i

interface Watch { id: string; agent_id: string; series: string[]; rule: string; z?: number; active: boolean }
interface Report { id: number; series: string; family: string; sources: string[] | null
  box: { made_by: string; data: string[] | null; method: string; backtest: string; conflicts: string; track_record: string } }
interface Track { report_id: number; outlook_low: number; outlook_high: number; outcome?: number; hit?: boolean }

/** `screen` false leaves out the app's half, for the unit test on the stub Lens. */
export function scanAgents({ screen = true }: { screen?: boolean } = {}): Scenario {
  return {
    id: 'scan-agents',
    owner: 'talyvor-suite',
    own: true,
    items: ['B52.28', 'B52.26', 'B52.27', 'B52.33'],
    feature: 'Scan',
    title: 'Scan agents: a watch keeps the owner\'s own measure of unusual and stops when told, the track record scores a hit only inside its ' +
      'range, every published report carries its sources and how it was made, and the app shows all three',
    run: async (ctx) => {
      const step = async <T>(method: string, path: string, body: unknown, note: string) => {
        const r = await call<T>(ctx, method, path, body)
        ctx.evidence.push({ note, answer: said(r) })
        return r
      }
      // 1. On Lens's API: an agent, a refused watch on a series Scan does not model, and the watch on German gas storage.
      const agent = await step<{ id: string }>('POST', '/v1/workspaces/{ws}/agents', { name: `Scan watch ${RUN_SALT}` }, 'a Scan agent')
      if (agent.status !== 201 || agent.value === undefined) return fail(`making the agent answered ${said(agent)}`)
      const watchPath = `/v1/workspaces/{ws}/agents/${agent.value.id}/scan-watches`
      const refused = await step('POST', watchPath, { series: ['sec.form4.cluster.nobody'], rule: 'range' }, 'a watch on filings, which Scan does not model')
      if (refused.status !== 400) return fail(`a watch on a series Scan has no model for must be refused 400; Lens answered ${said(refused)}`)
      const made = await step<Watch>('POST', watchPath, { series: [SERIES], rule: 'z', z: 2.5 }, 'a watch on German gas storage, unusual past 2.5 standard deviations')
      if (made.status !== 201 || made.value === undefined) return fail(`giving the agent its watch answered ${said(made)}`)
      const watchID = made.value.id
      const list = await step<{ watches: Watch[] | null }>('GET', '/v1/workspaces/{ws}/scan-watches', undefined, 'the workspace\'s watches')
      const mine = (list.value?.watches ?? []).find((w) => w.id === watchID)
      if (list.status !== 200 || mine === undefined) return fail(`the new watch must be listed; Lens answers ${said(list)}`)
      if (mine.rule !== 'z' || mine.z !== 2.5 || !mine.active || mine.series.join() !== SERIES || mine.agent_id !== agent.value.id) {
        return fail(`the watch must read back as the owner set it — ${SERIES}, more than 2.5 standard deviations, active, on its agent; it reads ` +
          `${JSON.stringify(mine)}`)
      }

      // 2. The public track record: a hit exactly when the outcome is inside the range, and the counts add up.
      const track = await step<{ records: Track[] | null; hits: number; misses: number; waiting: number }>('GET', '/v1/public/scan/track-record', undefined, 'the public track record')
      if (track.status !== 200 || track.value === undefined) return fail(`reading the track record answered ${said(track)}`)
      const records = track.value.records ?? []
      for (const r of records.filter((x) => x.hit !== undefined)) {
        const inside = r.outcome !== undefined && r.outcome >= r.outlook_low && r.outcome <= r.outlook_high
        if (r.hit !== inside) {
          return fail(`report ${r.report_id} reads ${r.hit ? 'a hit' : 'a miss'} with outcome ${r.outcome} against its range ${r.outlook_low}–${r.outlook_high}`)
        }
      }
      const { hits, misses, waiting } = track.value
      if (hits !== records.filter((r) => r.hit === true).length || misses !== records.filter((r) => r.hit === false).length ||
        waiting !== records.filter((r) => r.hit === undefined).length) {
        return fail(`the track record's counts (${hits} hits, ${misses} misses, ${waiting} waiting) must count its ${records.length} records`)
      }

      // 3. The published reports: each opens with its sources and the whole box, a family lists only its own, an unpublished id
      // answers 404, and nothing reads as a trade.
      const lib = await step<{ reports: Report[] | null }>('GET', '/v1/public/scan/reports', undefined, 'the published Scan reports')
      if (lib.status !== 200) return fail(`reading the published reports answered ${said(lib)}`)
      const reports = lib.value?.reports ?? []
      const oil = await step<{ reports: Report[] | null }>('GET', '/v1/public/scan/reports?family=oil', undefined, 'the published oil reports')
      const strays = (oil.value?.reports ?? []).filter((r) => r.family !== 'oil' || !r.series.startsWith('eia.stocks.'))
      if (oil.status !== 200 || strays.length > 0) return fail(`the oil family must list only oil reports; Lens answers ${said(oil)}`)
      for (const r of reports) {
        const one = await step<{ report: Report }>('GET', `/v1/public/scan/reports/${r.id}`, undefined, `published report ${r.id}`)
        const b = one.value?.report.box
        if (one.status !== 200 || b === undefined || [b.made_by, b.method, b.backtest, b.conflicts, b.track_record].some((x) => !x) || !(b.data ?? []).length ||
          !(one.value?.report.sources ?? []).length) {
          return fail(`report ${r.id} must open with its sources and the whole "How this report was made" box; Lens answers ${said(one)}`)
        }
        if (TRADE.test(one.text)) return fail(`report ${r.id} carries buy or sell wording: ${one.text.match(TRADE)?.[0]}`)
      }
      const unpublished = await step('GET', '/v1/public/scan/reports/999999999', undefined, 'a report id nobody published')
      if (unpublished.status !== 404) return fail(`a report that is not published must answer 404; Lens answered ${said(unpublished)}`)

      // 4. In the app: Scan agents shows the watch with its measure; Track record shows the counts; a report opens with its
      // sources and box, or the library says none is published yet.
      if (screen) {
        const page = await ctx.app.tab('/scan/agents')
        try {
          const row = page.locator(`[data-testid="scan-watch-${watchID}"]`)
          const shown = await row.waitFor({ timeout: TIMEOUT_MS }).then(async () => ((await row.textContent()) ?? '').replace(/\s+/g, ' '), () => '')
          ctx.evidence.push({ note: 'the Scan agents card for the watch', answer: shown })
          for (const want of ['EU gas storage (how full) · Germany', 'more than 2.5 standard deviations from its normal']) {
            if (!shown.includes(want)) return fail(`Scan agents must show "${want}" on the watch; its card reads "${shown.slice(0, 300)}"`)
          }
          await page.goto(new URL('/scan/track-record', page.url()).toString())
          const summary = page.locator('[data-testid="scan-track-summary"]')
          const counts = await summary.waitFor({ timeout: TIMEOUT_MS }).then(async () => (await summary.textContent()) ?? '', () => '')
          if (!counts.includes(`${hits} inside the range`) || !counts.includes(`${waiting} waiting`)) {
            return fail(`Track record must show ${hits} inside the range and ${waiting} waiting; it reads "${counts}"`)
          }
          const first = reports[0]
          await page.goto(new URL(first === undefined ? '/scan/reports' : `/scan/reports/${first.id}`, page.url()).toString())
          if (first === undefined) {
            const empty = page.getByText('No report has been published yet.')
            if (!(await empty.waitFor({ timeout: TIMEOUT_MS }).then(() => true, () => false))) return fail('Scan reports must say no report is published yet')
          } else {
            const box = page.locator('[data-testid="scan-report-box"]')
            const boxText = await box.waitFor({ timeout: TIMEOUT_MS }).then(async () => (await box.textContent()) ?? '', () => '')
            const sources = (await page.locator('[data-testid="scan-report-sources"]').textContent()) ?? ''
            ctx.evidence.push({ note: `report ${first.id} in the app`, answer: `${sources} | ${boxText.slice(0, 200)}` })
            if (!boxText.includes(first.box.made_by) || !sources.includes((first.sources ?? [])[0] ?? '\u0000')) {
              return fail(`report ${first.id} must show its sources and "How this report was made" box; the box reads "${boxText.slice(0, 200)}"`)
            }
          }
          for (const path of ['/scan/reports', '/scan/agents', '/scan/track-record']) {
            await page.goto(new URL(path, page.url()).toString())
            await page.waitForLoadState('networkidle')
            const said = (await page.locator('main').textContent()) ?? ''
            if (TRADE.test(said)) return fail(`${path} carries buy or sell wording: "${said.match(TRADE)?.[0]}"`)
          }
          await mkdir(ctx.env.outDir, { recursive: true })
          const viewport = page.viewportSize()
          const shots = ['/scan/reports', ...(first === undefined ? [] : [`/scan/reports/${first.id}`]), '/scan/agents', '/scan/track-record']
          for (const [path, width] of shots.flatMap((s) => [[s, 1440], [s, 390]] as const)) {
            await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
            await page.goto(new URL(path, page.url()).toString())
            await page.waitForLoadState('networkidle')
            const file = join(ctx.env.outDir, `scan-${path.split('/').slice(2).join('-')}-${width}px-user${ctx.app.user.index}.png`)
            await page.screenshot({ path: file, fullPage: true })
            ctx.evidence.push({ note: `${path} at ${width}px: ${file}` })
          }
          if (viewport !== null) await page.setViewportSize(viewport)
        } finally {
          await page.close()
        }
      }

      // 5. Stopped, the watch stays listed and reads inactive.
      const stopped = await step('DELETE', `/v1/workspaces/{ws}/scan-watches/${watchID}`, undefined, 'the watch stopped')
      if (stopped.status !== 200) return fail(`stopping the watch answered ${said(stopped)}`)
      const after = await step<{ watches: Watch[] | null }>('GET', '/v1/workspaces/{ws}/scan-watches', undefined, 'the watches after the stop')
      if ((after.value?.watches ?? []).find((w) => w.id === watchID)?.active !== false) return fail(`a stopped watch must read inactive; Lens answers ${said(after)}`)
      return { pass: true, detail: `a watch on ${SERIES} past 2.5 standard deviations read back as set and stopped; ${records.length} track-record reports, ` +
        `${hits} hits and ${misses} misses, each scored by its range; ${reports.length} published reports, each with its sources and box` }
    },
  }
}
