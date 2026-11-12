import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { queueItems } from '../src/b28.ts'
import { BUILDING_FILE, type BuildingEntry, type LabelSources, buildingLabelsLine, buildingLabelsReport, labelFaults, renderBuildingLabels } from '../src/buildingLabels.ts'
import { buildingLabelItemsFor, fileBuildingLabelItems } from '../src/filing.ts'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const QUEUE = `# queue

## B56.17 — Approvals in Slack and Teams
repo: talyvor-lens · deps: none · status: OPEN

## B56.19 — Single sign-on
repo: talyvor-lens · deps: none · status: CLAIMED bld-x 2026-11-10T00:00:00Z

## B56.23 — Currency conversion's margin
repo: talyvor-lens · deps: none · status: BLOCKED — held

## B52.15 — Counter
repo: talyvor-suite · deps: none · status: MERGED 1a2b3c4 — shipped
`

const ENTRIES: BuildingEntry[] = [
  { key: 'slack_teams_approvals', feature: 'Approvals in Slack and Teams', item: 'B56.17' },
  { key: 'sso', feature: 'Single sign-on', item: 'B56.19' },
  { key: 'fx_margin', feature: 'Currency conversion', item: 'B56.23' },
]

/** Today's facts: every entry still building, nothing built or charged, every label sandbox, every rail in test. */
const clean = (): LabelSources => ({
  entries: ENTRIES,
  queue: queueItems(QUEUE),
  built: { agents: true, slack_teams_approvals: false, sso: false, edge: false },
  charged: { market_take_bps: true, fx_margin_bps: false, merchant_fee_bps: false },
  labels: { spend_on_talyvor: 'sandbox', fx: 'sandbox' },
  cardPayments: 'test',
  rails: [{ service: 'account', mode: 'test' }, { service: 'fx', mode: 'test' }],
  pages: [{ path: '/pricing', chips: ['slack_teams_approvals', 'sso', 'fx_margin'] }, { path: '/marketing', chips: [] }],
})

describe('B56.13 — every Building label is true to what it states', () => {
  it('passes when every entry is still building, nothing it stands for is built or charged, and no live label rides a test rail', () => {
    expect(labelFaults(clean())).toEqual([])
    const live = { ...clean(), labels: { spend_on_talyvor: 'live' }, cardPayments: 'live' }
    expect(labelFaults(live)).toEqual([])
  })

  it('fails an entry that names no item', () => {
    const s = { ...clean(), entries: [...ENTRIES, { key: 'counter', feature: 'Counter', item: '' }] }
    expect(labelFaults(s).map((f) => [f.kind, f.key, f.repo])).toEqual([['no-item', 'counter', 'talyvor-suite']])
  })

  it('fails an entry whose item the queue lacks', () => {
    const s = { ...clean(), entries: [...ENTRIES, { key: 'counter', feature: 'Counter', item: 'B52.99' }] }
    expect(labelFaults(s).map((f) => [f.kind, f.key])).toEqual([['not-in-queue', 'counter']])
  })

  it('fails an entry whose item is no longer OPEN, CLAIMED or BLOCKED', () => {
    const s = { ...clean(), entries: [...ENTRIES, { key: 'counter', feature: 'Counter', item: 'B52.15' }] }
    const [f] = labelFaults(s)
    expect([f.kind, f.key]).toEqual(['shipped', 'counter'])
    expect(f.detail).toContain('MERGED')
  })

  it('fails an entry whose switch Lens reports built', () => {
    const s = { ...clean(), built: { ...clean().built, sso: true } }
    expect(labelFaults(s).map((f) => [f.kind, f.key])).toEqual([['built', 'sso']])
  })

  it('fails an entry one of whose fees Lens reports charged', () => {
    const s = { ...clean(), charged: { ...clean().charged, fx_margin_bps: true } }
    expect(labelFaults(s).map((f) => [f.kind, f.key])).toEqual([['charged', 'fx_margin']])
  })

  it("fails a capability Lens labels live while its rail on /status.json is in test, as Lens's", () => {
    const s = { ...clean(), labels: { fx: 'live', spend_on_talyvor: 'sandbox' } }
    const [f] = labelFaults(s)
    expect([f.kind, f.key, f.repo]).toEqual(['live-on-test', 'fx', 'talyvor-lens'])
    expect(f.detail).toContain('the fx rail in test')
  })

  it('fails a Building chip on a public page whose key building.json does not have, once for every page that draws it', () => {
    const s = { ...clean(), pages: [{ path: '/pricing', chips: ['sso', 'scan'] }, { path: '/marketing', chips: ['scan'] }] }
    const fs = labelFaults(s)
    expect(fs.map((f) => [f.kind, f.key])).toEqual([['unknown-chip', 'scan']])
    expect(fs[0].detail).toContain('/pricing, /marketing')
  })

  it('judges nothing from a source it could not read, and says so', () => {
    const s: LabelSources = { entries: ENTRIES, pages: [] }
    const r = buildingLabelsReport(s, ['/v1/public/labels answered 503'])
    expect(r.faults).toEqual([])
    expect(renderBuildingLabels(r).join('\n')).toContain('Not read, so not judged: /v1/public/labels answered 503.')
  })

  it("this checkout's building.json names an item for every entry", () => {
    const entries = JSON.parse(readFileSync(BUILDING_FILE, 'utf8')) as BuildingEntry[]
    expect(labelFaults({ entries, pages: [] })).toEqual([])
  })
})

describe('B56.13 — the report section and its items', () => {
  const stale = () => buildingLabelsReport({ ...clean(), built: { ...clean().built, sso: true }, labels: { fx: 'live' } }, [], '2026-11-10T03:00:00Z')

  it('writes a Building labels section that passes on a clean night and fails by name on a stale one', () => {
    const ok = renderBuildingLabels(buildingLabelsReport(clean(), [])).join('\n')
    expect(ok).toContain('### Building labels')
    expect(ok).toContain('**PASS**: 3 entries in building.json')
    expect(ok).toContain('| `sso` | Single sign-on | B56.19 | CLAIMED | PASS |')
    const bad = renderBuildingLabels(stale()).join('\n')
    expect(bad).toContain('**FAIL** 2')
    expect(bad).toContain('| `sso` | Single sign-on | B56.19 | CLAIMED | **FAIL** built |')
    expect(buildingLabelsLine(stale())[0]).toBe('- **Building labels**: FAIL — built `sso`, live-on-test `fx`.')
  })

  it('files one item per untrue label, Building ones for the suite and Live ones for Lens, and none twice', async () => {
    const f = buildingLabelItemsFor(QUEUE, stale(), 'docs/e2e/report-2026-11-10.md')
    expect(f.filed.map((x) => x.scenario)).toEqual(['building-labels-built-sso', 'building-labels-live-on-test-fx'])
    expect(f.append).toContain('## B17.1 — Take Building off Single sign-on\nrepo: talyvor-suite · deps: none · status: OPEN')
    expect(f.append).toContain('## B17.2 — Take Live off fx\nrepo: talyvor-lens · deps: none · status: OPEN')
    expect(f.append).toContain('e2e-scenario: building-labels-built-sso')

    const dir = await mkdtemp(join(tmpdir(), 'labels-'))
    const path = join(dir, 'BUILD.md')
    await writeFile(path, QUEUE)
    const first = stale()
    await fileBuildingLabelItems(path, first, 'r.md')
    expect(first.faults.map((x) => x.item)).toEqual(['B17.1', 'B17.2'])
    const again = stale()
    const second = await fileBuildingLabelItems(path, again, 'r.md')
    expect(second?.filed).toEqual([])
    expect(again.faults.map((x) => x.item)).toEqual(['B17.1', 'B17.2'])
    expect((await readFile(path, 'utf8')).match(/^## B17\./gm)).toHaveLength(2)
  })
})
