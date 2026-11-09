// B52.32 — a Scan report end to end, once a run, on a workspace of its own, with the synthetic key (Lens B52.40): Scan's writer runs on
// its recorded US distillate weeks and drafts a report that waits for a person, with its sources and the whole "How this report was
// made" box and no trade wording; the same draft with a planted "buy" line is refused by the compliance check and can never be
// approved; nothing is published until the test reviewer approves, and once the planted outcome arrives inside the report's range the
// track record scores it a hit.

import { fail } from './bank.ts'
import type { Answered, ScanTrackRecord } from './lens.ts'
import { said } from './routes.ts'
import { CannotTest, type Scenario } from './scenarios.ts'

// Lens records only US distillate (B52.40): Scan's model refuses Cushing crude, and the check refuses the plant by its word.
const SERIES = 'eia.stocks.us-distillate'
const PLANT = 'Buy Cushing crude now.'
const TRADE = /\b(buy|buys|buying|sell|sells|selling)\b/i

export function scanReport(): Scenario {
  return {
    id: 'scan-report',
    owner: 'talyvor-lens',
    own: true,
    items: ['B52.32', 'B52.40'],
    feature: 'Scan',
    title: 'a Scan report end to end: the writer drafts one from recorded data, the compliance check refuses a planted "buy" line, the ' +
      'report publishes only once a test reviewer approves it, and the track record scores it when the planted outcome arrives',
    run: async (ctx) => {
      const { lens } = ctx.env
      const user = ctx.app.user
      const step = async <T>(got: Promise<Answered<T>>, note: string): Promise<Answered<T>> => {
        const r = await got
        ctx.evidence.push({ note, answer: said(r) })
        return r
      }
      const published = async (id: number) => {
        const t = await step(lens.scanRehearsalTrackRecord(user), 'the workspace\'s track record')
        if (!t.ok) throw new Error(`reading the workspace's track record answered ${said(t)}`)
        return { record: (t.value.records ?? []).find((r) => r.report_id === id), all: t.value as ScanTrackRecord }
      }

      // 1. The writer on recorded data: a draft waiting for a person, with its sources and the whole box, and no trade wording.
      const clean = await step(lens.rehearseScanReport(user, SERIES), `Scan's writer on the recorded ${SERIES} weeks`)
      if (!clean.ok && clean.status === 404 && /page not found/i.test(clean.error)) {
        throw new CannotTest('Lens has no Scan rehearsal on a test workspace yet (POST /v1/synthetic/workspaces/{ws}/scan/reports, B52.40)')
      }
      if (!clean.ok || clean.status !== 201) return fail(`the writer on recorded data answered ${said(clean)}`)
      const draft = clean.value.report
      if (draft.status !== 'pending') return fail(`a clean draft must wait for a person; it reads ${draft.status} ${draft.refusal ?? ''}`)
      const b = draft.report.box
      if ([b.made_by, b.method, b.backtest, b.conflicts, b.track_record].some((x) => !x) || !(b.data ?? []).length || !(draft.report.sources ?? []).length) {
        return fail(`the draft must carry its sources and the whole "How this report was made" box; it reads ${JSON.stringify(draft.report).slice(0, 400)}`)
      }
      const words = [draft.report.title, draft.report.what_changed, draft.report.why_it_matters, draft.report.confidence, draft.report.what_would_change].join(' ')
      if (TRADE.test(words)) return fail(`the writer's own draft carries trade wording: "${words.match(TRADE)?.[0]}"`)

      // 2. The same report with a planted "buy" line: refused by the compliance check, and never approvable.
      const planted = await step(lens.rehearseScanReport(user, SERIES, PLANT), `the writer with "${PLANT}" planted`)
      if (!planted.ok || planted.status !== 201) return fail(`the planted draft answered ${said(planted)}`)
      if (planted.value.report.status !== 'refused' || !/buy/i.test(planted.value.report.refusal ?? '')) {
        return fail(`the compliance check must refuse a draft saying "${PLANT}", naming the word; it reads ${planted.value.report.status} ` +
          `"${planted.value.report.refusal ?? ''}"`)
      }
      const forced = await step(lens.approveScanRehearsal(user, planted.value.report.id), 'the test reviewer tries to approve the refused draft')
      if (forced.status !== 409) return fail(`a refused draft must never be approved (409); Lens answered ${said(forced)}`)

      // 3. Nothing is published before the reviewer approves; after, the report is on the track record, waiting for its outcome.
      if ((await published(draft.id)).record !== undefined) return fail(`report ${draft.id} is on the track record before anyone approved it`)
      const approved = await step(lens.approveScanRehearsal(user, draft.id), 'the test reviewer approves the clean draft')
      if (!approved.ok || approved.value.report.status !== 'approved' || !approved.value.report.reviewed_by) {
        return fail(`the reviewer's approval must publish the report and name them; Lens answered ${said(approved)}`)
      }
      const waiting = await published(draft.id)
      if (waiting.record === undefined || waiting.record.hit !== undefined) {
        return fail(`once approved, report ${draft.id} must be on the track record waiting for its outcome; it reads ${JSON.stringify(waiting.record)}`)
      }
      if ((await published(planted.value.report.id)).record !== undefined) return fail('the refused draft is on the track record')

      // 4. The planted outcome inside the report's range: scored a hit, and counted.
      const { outlook_low: low, outlook_high: high } = waiting.record
      const outcome = Math.round((low + high) / 2)
      const scored = await step(lens.plantScanOutcome(user, draft.id, outcome), `the outcome arrives: ${outcome}, inside ${low}–${high}`)
      if (!scored.ok) return fail(`planting the outcome answered ${said(scored)}`)
      const after = await published(draft.id)
      if (after.record?.hit !== true || after.record.outcome !== outcome) {
        return fail(`an outcome of ${outcome} inside ${low}–${high} must score report ${draft.id} a hit; it reads ${JSON.stringify(after.record)}`)
      }
      if (after.all.hits !== (after.all.records ?? []).filter((r) => r.hit === true).length) {
        return fail(`the track record's ${after.all.hits} hits must count its scored records`)
      }
      return { pass: true, detail: `report ${draft.id} drafted from recorded ${SERIES} data with its box, the planted "buy" line refused ` +
        `("${planted.value.report.refusal}") and never approvable, published only on the reviewer's approval, and scored a hit at ${outcome}` }
    },
  }
}
