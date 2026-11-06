import { describe, expect, it } from 'vitest'
import { POCKET_USERS, parseConfig } from '../src/config.ts'
import { itemsFor, pocketItemsFor } from '../src/filing.ts'
import { pocketJourneys } from '../src/pocketProblems/index.ts'
import { POCKET, pocketRows, renderPocket } from '../src/pocketProblems/problems.ts'
import { type ReportedRun, renderRun, renderSummary } from '../src/report.ts'

// B55.44 — Pocket's 25 app problems, each pressed in the real app every night: one scenario each, named by its fix
// items; a FAIL while an item is not DONE is reported only, and with every item DONE it is back and files one item at the
// top of B55, once.

const env = { LENS_SYNTHETIC_KEY: 'k', E2E_APP_URL: 'http://app', E2E_LENS_URL: 'http://lens' }

/** A queue with B55's heading and problem 21's item in `status21`, every other item of problem 21 absent. */
const queue = (status21: string, more = '') => `# B55 — FIX THE PRODUCT FIRST
On 1 Nov 2026 Nick approved Pocket.

## B55.43 — A spending notice in the browser says what it is
repo: talyvor-suite · deps: none · status: ${status21}
${more}
## B55.44 — Pocket's 25 app problems
repo: talyvor-e2e · deps: none · status: CLAIMED t
`

const fail21 = { scenario: 'pocket-21', status: 'FAIL' as const, detail: 'the notice showed Approve' }

describe('the Pocket problems pass (B55.44)', () => {
  it('is 25 problems, one user and one scenario each, named by the items that fix it', () => {
    expect(POCKET.map((p) => p.n)).toEqual(Array.from({ length: 25 }, (_, i) => i + 1))
    const journeys = pocketJourneys()
    expect(journeys.length).toBe(POCKET_USERS)
    expect(journeys.map((j) => [j.length, j[0].id, j[0].items])).toEqual(POCKET.map((p) => [1, `pocket-${String(p.n).padStart(2, '0')}`, p.items]))
    expect(POCKET.filter((p) => p.byCode).map((p) => p.n)).toEqual([1, 7, 10, 13, 17, 21, 22, 23])
    const c = parseConfig(['--pocket'], { ...env, E2E_USERS: '100', E2E_EXPLORERS: '10', E2E_DEEP_ROUNDS: '3' })
    expect([c.pocket, c.light, c.users, c.explorers, c.deepRounds, c.hostilePRs, c.codeRepo, c.edgeRepo]).toEqual([true, false, 25, 0, 0, false, 'none', 'none'])
    expect(parseConfig([], { ...env, E2E_POCKET: '1' }).pocket).toBe(true)
  })

  it('reports a FAIL while an item is being built, and calls it back once every item is DONE', () => {
    expect(pocketRows(queue('MERGED'), [fail21]).find((r) => r.n === 21)?.state).toBe('fixing')
    expect(pocketRows(queue('DONE abc'), [fail21]).find((r) => r.n === 21)?.state).toBe('back')
    expect(pocketRows(undefined, [fail21]).find((r) => r.n === 21)?.state).toBe('fixing')
    const rows = pocketRows(queue('DONE abc'), [{ scenario: 'pocket-19', status: 'PASS', detail: 'all seven' }, { scenario: 'pocket-02', status: 'SKIP', detail: 'phone' }])
    expect(rows.filter((r) => r.state !== 'not run').map((r) => [r.n, r.state])).toEqual([[2, 'cannot press'], [19, 'passes']])
  })

  it('files a back problem once, at the top of B55, naming its items; never as a B17 item', () => {
    const rows = pocketRows(queue('DONE abc'), [fail21])
    const f = pocketItemsFor(queue('DONE abc'), rows, '2026-11-07', 'docs/e2e/report-2026-11-07.md')
    expect(f.filed).toEqual([{ id: 'B55.45', scenario: 'pocket-21' }])
    expect(f.append).toContain('## B55.45 — Pocket problem 21 is back: Spending notice reads as an approval\nrepo: talyvor-suite · deps: none · status: OPEN')
    expect(f.append).toContain('every item that fixed it is DONE (B55.43)')
    expect(rows.find((r) => r.n === 21)?.filed).toBe('B55.45')
    // Already filed and still open: nothing new.
    const again = pocketRows(queue('DONE abc', '\n## B55.45 — Pocket problem 21 is back\nrepo: talyvor-suite · deps: none · status: OPEN\ne2e-scenario: pocket-21\n'), [fail21])
    expect(pocketItemsFor(queue('DONE abc', '\n## B55.45 — x\nrepo: talyvor-suite · deps: none · status: OPEN\ne2e-scenario: pocket-21\n'), again, 'd', 'r').covered)
      .toEqual([{ scenario: 'pocket-21', by: 'B55.45' }])
    const run = { outcomes: [{ ...fail21, title: 't', user: 0, workspace: 'ws', evidence: [] }], started_at: '2026-11-07T01:00:00Z' } as unknown as ReportedRun
    expect(itemsFor('# queue\n', run, 'r').filed).toEqual([])
  })

  it('gives the report 25 rows, pass or fail, with the items, and TESTERS.md one line', () => {
    const rows = pocketRows(queue('DONE abc'), [fail21, { scenario: 'pocket-19', status: 'PASS', detail: 'all seven' }])
    const section = renderPocket(rows)
    expect(section.filter((l) => /^\| \d+ \|/.test(l))).toHaveLength(25)
    expect(section.join('\n')).toContain('| 21 | Spending notice reads as an approval | **BACK** — every item is DONE and it failed again | B55.43 DONE |')
    expect(section.join('\n')).toContain('| 19 | Chat\'s help names two providers | pass | B55.37 not in the queue |')
    // What a screen said can hold a pipe or a backslash; neither breaks the table.
    expect(renderPocket(pocketRows(undefined, [{ scenario: 'pocket-08', status: 'FAIL', detail: 'a\\|b' }])).find((l) => l.startsWith('| 8 |'))).toContain('a\\\\\\|b')
    const run: ReportedRun = {
      started_at: '2026-11-07T01:00:00.000Z', finished_at: '2026-11-07T01:20:00.000Z', app: 'https://app', lens: 'https://lens', users: 25,
      model: 'Claude Haiku 4.5', cap_usd: 5, spent_usd: 0, stopped_at_cap: false, counts: { PASS: 1, FAIL: 1, SKIP: 0, ERROR: 0 }, outcomes: [], pocket: rows,
    }
    expect(renderRun(run)).toContain('## Pocket problems pass started 2026-11-07T01:00:00.000Z')
    expect(renderRun(run)).toContain('### Pocket problems (B55.44)')
    expect(renderSummary(run, 'r.md', [])).toContain('- **Pocket problems**: 1 of 25 pass; BACK: 21.')
  })
})
