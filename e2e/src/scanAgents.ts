// B52.28 — Scan in the app (Lens B52.26 and B52.27), once a run, on a workspace of its own. On Lens's API the owner makes an
// agent and gives it a watch on German gas storage, unusual at more than 2.5 standard deviations from its normal; the watch reads
// back with that measure, a series Scan does not model is refused, and stopping the watch leaves it inactive. The public track
// record's every scored report is a hit exactly when its outcome is inside its range, and its counts add up. In the app, Scan
// agents shows the watch and Track record shows the counts.

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fail } from './bank.ts'
import { RUN_SALT } from './oracles.ts'
import type { Scenario } from './scenarios.ts'
import { call, said } from './settings.ts'

const TIMEOUT_MS = 30_000
const SERIES = 'gie.agsi.de.full'

interface Watch { id: string; agent_id: string; series: string[]; rule: string; z?: number; active: boolean }
interface Track { report_id: number; outlook_low: number; outlook_high: number; outcome?: number; hit?: boolean }

/** `screen` false leaves out the app's half, for the unit test on the stub Lens. */
export function scanAgents({ screen = true }: { screen?: boolean } = {}): Scenario {
  return {
    id: 'scan-agents',
    owner: 'talyvor-suite',
    own: true,
    items: ['B52.28', 'B52.26', 'B52.27'],
    feature: 'Scan',
    title: 'Scan agents: a watch keeps the owner\'s own measure of unusual and stops when told, the track record scores a hit only inside its ' +
      'range, and the app shows both',
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

      // 3. In the app: Scan agents shows the watch with its measure; Track record shows the counts.
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
          await mkdir(ctx.env.outDir, { recursive: true })
          const viewport = page.viewportSize()
          for (const [path, width] of [['/scan/agents', 1440], ['/scan/agents', 390], ['/scan/track-record', 1440], ['/scan/track-record', 390]] as const) {
            await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
            await page.goto(new URL(path, page.url()).toString())
            await page.waitForLoadState('networkidle')
            const file = join(ctx.env.outDir, `scan-${path.split('/')[2]}-${width}px-user${ctx.app.user.index}.png`)
            await page.screenshot({ path: file, fullPage: true })
            ctx.evidence.push({ note: `${path} at ${width}px: ${file}` })
          }
          if (viewport !== null) await page.setViewportSize(viewport)
        } finally {
          await page.close()
        }
      }

      // 4. Stopped, the watch stays listed and reads inactive.
      const stopped = await step('DELETE', `/v1/workspaces/{ws}/scan-watches/${watchID}`, undefined, 'the watch stopped')
      if (stopped.status !== 200) return fail(`stopping the watch answered ${said(stopped)}`)
      const after = await step<{ watches: Watch[] | null }>('GET', '/v1/workspaces/{ws}/scan-watches', undefined, 'the watches after the stop')
      if ((after.value?.watches ?? []).find((w) => w.id === watchID)?.active !== false) return fail(`a stopped watch must read inactive; Lens answers ${said(after)}`)
      return { pass: true, detail: `a watch on ${SERIES} past 2.5 standard deviations read back as set and stopped; ${records.length} track-record reports, ` +
        `${hits} hits and ${misses} misses, each scored by its range` }
    },
  }
}
