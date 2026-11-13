// B52.28 SELF-TEST — the stand-in Lens's Scan (Lens B52.26 and B52.27), as scan-agents reads and writes it:
// POST …/agents/{id}/scan-watches {series, rule, z} (201 with the watch; 400 for a series Scan does not model, a rule that is
// neither range nor z, or a z rule without a z above 0), GET …/scan-watches (newest first, each with its alerts),
// DELETE …/scan-watches/{id} ({id, active: false}), the public GET /v1/public/scan/track-record (one report scored inside
// its range, one waiting), and the public GET /v1/public/scan/reports[?family=] and …/reports/{id} (two approved reports; a pending
// one, id 3, is never listed and answers 404). Its defects:
//   scan-watch-z-dropped   — a z watch is stored as a range watch, so the owner's own measure of unusual is lost
//   scan-track-hit-outside — the scored report's outcome lies outside its range and still reads as a hit
//   scan-report-box-hollow — a published report's "How this report was made" box comes back without its method
// B52.32 adds the rehearsal Lens B52.40 serves on a test workspace with the synthetic key, kept out of the public library:
// POST /v1/synthetic/workspaces/{ws}/scan/reports {series, plant} (the writer on recorded data, `plant` a line added to "why it may
// matter" before the code rules; 201 pending, or refused with why), …/scan/reports/{id}/approve (the test reviewer; 409 unless
// pending), …/scan/reports/{id}/outcome {value} (the outcome planted at the outlook date and scored) and GET …/scan/track-record
// (the workspace's approved rehearsal reports only). Its defect:
//   scan-check-bypassed    — the code rules never run, so a planted "buy" line waits for a person like any other draft

import { randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

interface Rehearsal { id: number; ws: string; status: 'pending' | 'refused' | 'approved'; refusal?: string; report: Record<string, unknown>
  reviewed_by?: string; outcome?: number }

/** What Lens's code rules (internal/scan report.go adviceWords) refuse, in short. */
const ADVICE = /\b(buy\w*|bought|sell\w*|sold|hold|recommend\w*|should)\b/gi

interface Watch { id: string; ws: string; agent_id: string; series: string[]; rule: 'range' | 'z'; z?: number; active: boolean; created_at: string }

/** Lens internal/scan Families: the series prefixes (and suffix) Scan has a model for. */
const MODELLED: readonly [string, string][] = [['eia.stocks.', ''], ['gie.agsi.', '.full'], ['entsog.flow.', ''], ['crop.nass.', '']]
/** Lens internal/scan RehearsalSeries: the one series Lens holds recorded data for. */
const RECORDED = 'eia.stocks.us-distillate'
const modelled = (s: string) => MODELLED.some(([p, x]) => s.length > p.length + x.length && s.startsWith(p) && s.endsWith(x))

export class ScanDesk {
  private readonly watches: Watch[] = []
  private readonly rehearsals: Rehearsal[] = []
  private readonly json: (res: ServerResponse, status: number, body: unknown) => void
  private readonly body: <T>(req: IncomingMessage) => Promise<T>
  private readonly broken: (name: string) => boolean
  private readonly hasAgent: (ws: string, agentID: string) => boolean

  constructor(json: ScanDesk['json'], body: ScanDesk['body'], broken: ScanDesk['broken'], hasAgent: ScanDesk['hasAgent']) {
    this.json = json
    this.body = body
    this.broken = broken
    this.hasAgent = hasAgent
  }

  /** The workspace's Scan routes: true when `rest` was one of them. */
  async route(req: IncomingMessage, res: ServerResponse, ws: string, rest: string, now: string): Promise<boolean> {
    if (rest === '/scan-watches' && req.method === 'GET') {
      const list = this.watches.filter((w) => w.ws === ws).reverse().map(({ ws: _w, ...w }) => ({ ...w, alerts: [] }))
      return this.json(res, 200, { watches: list }), true
    }
    const stop = /^\/scan-watches\/([^/]+)$/.exec(rest)
    if (stop !== null && req.method === 'DELETE') {
      const w = this.watches.find((x) => x.ws === ws && x.id === stop[1] && x.active)
      if (w === undefined) return this.json(res, 404, { error: 'scan: no such active watch' }), true
      w.active = false
      return this.json(res, 200, { id: w.id, active: false }), true
    }
    const make = /^\/agents\/([^/]+)\/scan-watches$/.exec(rest)
    if (make === null || req.method !== 'POST') return false
    if (!this.hasAgent(ws, make[1])) return this.json(res, 404, { error: 'economy: agent not found' }), true
    const b = await this.body<{ series?: string[]; rule?: string; z?: number }>(req)
    const series = [...new Set((b.series ?? []).map((s) => s.trim()).filter((s) => s !== ''))]
    const bad = series.find((s) => !modelled(s))
    if (bad !== undefined) return this.json(res, 400, { error: `scan: bad watch: "${bad}" is not a series Scan models` }), true
    if (series.length === 0) return this.json(res, 400, { error: 'scan: bad watch: name at least one series' }), true
    if (b.rule === 'z' && !(typeof b.z === 'number' && b.z > 0)) return this.json(res, 400, { error: 'scan: bad watch: z must be a number of standard deviations above 0' }), true
    if (b.rule !== 'range' && b.rule !== 'z') return this.json(res, 400, { error: 'scan: bad watch: rule must be "range" or "z"' }), true
    const zKept = b.rule === 'z' && !this.broken('scan-watch-z-dropped')
    const w: Watch = { id: `swt_${randomBytes(8).toString('hex')}`, ws, agent_id: make[1], series, rule: zKept ? 'z' : 'range', ...(zKept ? { z: b.z } : {}), active: true, created_at: now }
    this.watches.push(w)
    const { ws: _w, ...out } = w
    return this.json(res, 201, { ...out, alerts: [] }), true
  }

  /** B52.32 — the rehearsal's synthetic routes (Lens B52.40): true when `path` was one of them. */
  async synthetic(req: IncomingMessage, res: ServerResponse, path: string, now: string): Promise<boolean> {
    const m = /^\/v1\/synthetic\/workspaces\/([^/]+)\/scan\/(reports|track-record)(?:\/(\d+)\/(approve|outcome))?$/.exec(path)
    if (m === null) return false
    const [, ws, what, id, act] = m
    if (what === 'track-record' && req.method === 'GET' && id === undefined) {
      const records = this.rehearsals.filter((r) => r.ws === ws && r.status === 'approved').map((r) => ({ report_id: r.id, series: RECORDED,
        title: r.report.title, sources: r.report.sources, published_at: now, observed_at: '2026-09-26T00:00:00Z', value: 112_000, unit: 'thousand barrels',
        normal_low: 120_000, normal_high: 140_000, outlook_at: '2026-10-24T00:00:00Z', outlook_low: 108_000, outlook_high: 118_000,
        ...(r.outcome === undefined ? {} : { outcome: r.outcome, outcome_at: '2026-10-24T00:00:00Z', hit: r.outcome >= 108_000 && r.outcome <= 118_000, scored_at: now }) }))
      return this.json(res, 200, { records, hits: records.filter((r) => r.hit === true).length, misses: records.filter((r) => r.hit === false).length,
        waiting: records.filter((r) => r.hit === undefined).length }), true
    }
    if (what !== 'reports' || req.method !== 'POST') return false
    if (id === undefined) {
      const b = await this.body<{ series?: string; plant?: string }>(req)
      if (b.series !== RECORDED) return this.json(res, 400, { error: `scan: Lens holds recorded data only for ${RECORDED}` }), true
      const report = this.distillate(b.plant ?? '')
      const said = [report.title, report.what_changed, report.why_it_matters, report.confidence, report.what_would_change].join('\n').match(ADVICE)
      const refused = said !== null && !this.broken('scan-check-bypassed')
      const r: Rehearsal = { id: 1000 + this.rehearsals.length, ws, status: refused ? 'refused' : 'pending', report, ...(refused ? { refusal: `advice or trading wording: ${said.join(', ')}` } : {}) }
      this.rehearsals.push(r)
      return this.json(res, 201, { report: this.queued(r, now) }), true
    }
    const r = this.rehearsals.find((x) => x.ws === ws && String(x.id) === id)
    if (r === undefined) return this.json(res, 404, { error: 'scan: no such report' }), true
    if (act === 'approve') {
      if (r.status !== 'pending') return this.json(res, 409, { error: 'scan: the report is not waiting for review' }), true
      Object.assign(r, { status: 'approved', reviewed_by: 'e2e test reviewer' })
      return this.json(res, 200, { report: this.queued(r, now) }), true
    }
    if (r.status !== 'approved') return this.json(res, 409, { error: 'scan: only a published report is scored' }), true
    r.outcome = (await this.body<{ value?: number }>(req)).value
    return this.json(res, 200, { scored: 1 }), true
  }

  /** The writer's draft on the recorded US distillate weeks, `plant` added to "why it may matter". */
  private distillate(plant: string): Record<string, unknown> {
    return { series: RECORDED, title: 'US oil stocks: us distillate',
      what_changed: 'US distillate stocks read 112000 thousand barrels, against a normal of 120000 to 140000 thousand barrels for the same weeks of past years.',
      why_it_matters: `A gap to the normal like this one tends to carry on: the model's likely range is 108000 to 118000 thousand barrels.${plant === '' ? '' : ` ${plant}`}`,
      confidence: 'Tested on 120 past outlooks from its own history, the model put the outcome on the right side of the normal 71% of the time.',
      what_would_change: 'The view would change if the coming readings moved back towards the normal.',
      sources: ['U.S. Energy Information Administration'],
      figures: [['value', 112_000], ['normal_low', 120_000], ['normal_high', 140_000], ['outlook_low', 108_000], ['outlook_high', 118_000]].map(([name, v]) => ({ name, text: String(v) })),
      box: { made_by: "Talyvor's agents wrote this report from Talyvor Scan's figures, and a person checked it before it was published.",
        data: ['U.S. Energy Information Administration (public domain)'], method: 'Normal: the same weeks of the past five years.', backtest: 'Backtested on 3 Nov 2026: passed.',
        conflicts: 'Talyvor holds no position in what this report covers.', track_record: '/v1/public/scan/track-record' } }
  }

  private queued(r: Rehearsal, now: string): unknown {
    return { id: r.id, series: RECORDED, finding_at: '2026-09-26T00:00:00Z', report: r.report, writer: 'template', model_check: 'passed', status: r.status,
      ...(r.refusal === undefined ? {} : { refusal: r.refusal }), created_at: now, ...(r.reviewed_by === undefined ? {} : { reviewed_by: r.reviewed_by, reviewed_at: now }) }
  }

  /** The approved reports, newest first: what GET /v1/public/scan/reports answers. */
  private published(): unknown[] {
    const box = (source: string) => ({ made_by: "Talyvor's agents wrote this report from Talyvor Scan's figures, and a person checked it before it was published.",
      data: [source], method: this.broken('scan-report-box-hollow') ? '' : 'Normal: the same weeks of the past five years.', backtest: 'Backtested on 3 Nov 2026: passed.',
      conflicts: 'Talyvor holds no position in what this report covers.', track_record: '/v1/public/scan/track-record' })
    const report = (id: number, series: string, family: string, title: string, source: string, value: number, unit: string, nl: number, nh: number, ol: number, oh: number) => ({
      id, series, family, published_at: `2026-11-0${5 - id}T09:00:00Z`, title,
      what_changed: `${title} read ${value} ${unit}, against a normal of ${nl} to ${nh} ${unit} for the same weeks of past years.`,
      why_it_matters: `A gap to the normal like this one tends to carry on: the model's likely range is ${ol} to ${oh} ${unit}.`,
      confidence: 'Tested on 120 past outlooks from its own history, the model put the outcome on the right side of the normal 71% of the time.',
      what_would_change: 'The view would change if the coming readings moved back towards the normal.',
      figures: [['value', value], ['normal_low', nl], ['normal_high', nh], ['outlook_low', ol], ['outlook_high', oh]].map(([name, v]) => ({ name, text: String(v), value: v, unit })),
      sources: [source], box: box(`${source} (licence on file)`),
    })
    return [
      report(2, 'gie.agsi.de.full', 'energy', 'EU gas storage: Germany', 'GIE AGSI+', 71, '%', 85, 93, 66, 74),
      report(1, 'eia.stocks.cushing-crude', 'oil', 'US oil stocks: crude at Cushing', 'U.S. Energy Information Administration', 21_000, 'thousand barrels', 24_000, 30_000, 20_000, 25_000),
    ]
  }

  /** GET /v1/public/scan/reports?family=. */
  reports(res: ServerResponse, family: string): void {
    if (!['', 'energy', 'oil', 'crops', 'filings'].includes(family)) return this.json(res, 400, { error: 'family is energy, oil, crops or filings' })
    this.json(res, 200, { reports: this.published().filter((r) => family === '' || (r as { family: string }).family === family) })
  }

  /** GET /v1/public/scan/reports/{id}: 404 for any report not approved. */
  report(res: ServerResponse, id: string): void {
    const r = this.published().find((x) => String((x as { id: number }).id) === id)
    if (r === undefined) return this.json(res, 404, { error: 'scan: no such report' })
    this.json(res, 200, { report: r })
  }

  /** GET /v1/public/scan/track-record. */
  trackRecord(res: ServerResponse): void {
    const outcome = this.broken('scan-track-hit-outside') ? 26_100 : 22_400
    this.json(res, 200, {
      hits: 1, misses: 0, waiting: 1,
      records: [
        { report_id: 2, series: 'gie.agsi.de.full', title: 'German gas storage behind its usual fill', sources: ['GIE AGSI+'], published_at: '2026-11-04T09:00:00Z',
          observed_at: '2026-11-04T00:00:00Z', value: 71, unit: '%', normal_low: 85, normal_high: 93, outlook_at: '2026-11-18T00:00:00Z', outlook_low: 66, outlook_high: 74 },
        { report_id: 1, series: 'eia.stocks.cushing-crude', title: 'Cushing crude stocks fall below their five-year range', sources: ['U.S. Energy Information Administration'],
          published_at: '2026-10-01T09:00:00Z', observed_at: '2026-09-26T00:00:00Z', value: 21_000, unit: 'thousand barrels', normal_low: 24_000, normal_high: 30_000,
          outlook_at: '2026-10-24T00:00:00Z', outlook_low: 20_000, outlook_high: 25_000, outcome, outcome_at: '2026-10-24T00:00:00Z', hit: true },
      ],
    })
  }
}
