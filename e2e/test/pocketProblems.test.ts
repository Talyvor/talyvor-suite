import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { POCKET_USERS, parseConfig } from '../src/config.ts'
import { itemsFor, pocketItemsFor } from '../src/filing.ts'
import { pocketJourneys } from '../src/pocketProblems/index.ts'
import { POCKET, pocketLine, pocketRows, renderPocket, unlistedFixes } from '../src/pocketProblems/problems.ts'
import { type ReportedRun, renderRun, renderSummary } from '../src/report.ts'

// B55.44 — Pocket's 25 app problems, each pressed in the real app every night: one scenario each, named by its fix
// items; a FAIL while an item is not DONE is reported only, and with every item DONE it is back and files one item at the
// top of B55, once.

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../..')
const who = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }
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

  // B55.52 — a problem whose fix was split later names every item, so it never reads back while one is still open.
  it('names every item that fixes a problem, the ones split off later too', () => {
    const later = [1, 8, 11, 15, 20, 23, 24].map((n) => POCKET.find((p) => p.n === n)?.items.filter((i) => i === 'B55.6' || Number(i.slice(4)) >= 45))
    expect(later).toEqual([['B55.6', 'B55.50'], ['B55.46', 'B55.50', 'B55.51'], ['B55.6', 'B55.48'], ['B55.47'], ['B55.49'], ['B55.45'], ['B55.46']])
    const q = `## B55.12 — Lens: lock-screen Approve\nrepo: talyvor-lens · deps: none · status: DONE abc\n\n` +
      '## B55.47 — Phone: the lock-screen Approve button\nrepo: talyvor-mobile · deps: B55.12 · status: OPEN\n'
    const fail15 = { scenario: 'pocket-15', status: 'FAIL' as const, detail: 'no Approve on the lock screen' }
    expect(pocketRows(q, [fail15]).find((r) => r.n === 15)?.state).toBe('fixing')
  })

  it('catches an open B55 item whose FOUND line names a problem problems.ts does not list it under, and keeps that problem fixing', () => {
    const later = '\n## B55.60 — A later fix\nrepo: talyvor-suite · deps: none · status: OPEN\nFOUND (audit): found while verifying problems 21 and 3.\n'
    expect(unlistedFixes(queue('DONE abc', later))).toEqual([{ id: 'B55.60', n: 21 }, { id: 'B55.60', n: 3 }])
    const rows = pocketRows(queue('DONE abc', later), [fail21])
    expect(rows.find((r) => r.n === 21)?.state).toBe('fixing')
    expect(pocketLine(rows)[0]).toContain('; problems.ts does not list: B55.60 for 3, 21')
    // Listed, DONE, or the pass's own item: nothing to catch.
    expect(unlistedFixes(queue('DONE abc', later.replace('status: OPEN', 'status: DONE x')))).toEqual([])
    expect(unlistedFixes(queue('DONE abc', '\n## B55.52 — The pass\nrepo: talyvor-suite · deps: none · status: OPEN\nFOUND: problem 15 names B55.12.\n'))).toEqual([])
    expect(unlistedFixes(queue('OPEN', '\nFOUND: problem 21.\n'))).toEqual([])
  })

  it('runs on a light night, and a pass that cannot report says so in TESTERS.md', () => {
    const dir = mkdtempSync(join(tmpdir(), 'e2e-pocket-'))
    const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, env: { ...process.env, ...who }, encoding: 'utf8' }).trim()
    try {
      git(dir, 'init', '-q', '--bare', '-b', 'main', 'origin.git')
      const seed = join(dir, 'seed')
      mkdirSync(join(seed, 'scripts'), { recursive: true })
      cpSync(join(REPO, 'scripts/e2e-nightly.sh'), join(seed, 'scripts/e2e-nightly.sh'))
      cpSync(join(REPO, 'e2e/src'), join(seed, 'e2e/src'), { recursive: true })
      // A run that throws before it can write anything.
      writeFileSync(join(seed, 'e2e/src/run.ts'), "throw new Error('the Pocket pass broke')\n")
      git(seed, 'init', '-q', '-b', 'main')
      git(seed, 'add', '.')
      git(seed, 'commit', '-qm', 'the harness')
      git(seed, 'push', '-q', join(dir, 'origin.git'), 'main')
      git(dir, 'clone', '-q', join(dir, 'origin.git'), 'testers')
      const bin = join(dir, 'bin')
      mkdirSync(bin)
      writeFileSync(join(bin, 'pnpm'), '#!/bin/sh\nexit 0\n')
      chmodSync(join(bin, 'pnpm'), 0o755)
      const testersMd = join(dir, 'TESTERS.md')
      writeFileSync(join(dir, 'e2e.env'), ['LENS_SYNTHETIC_KEY=k', 'E2E_APP_URL=http://127.0.0.1:9', 'E2E_LENS_URL=http://127.0.0.1:9',
        'E2E_LENS_SRC=none', `E2E_TESTERS_MD=${testersMd}`, 'E2E_BUILD_MD=none'].join('\n') + '\n')
      const r = spawnSync('bash', [join(dir, 'testers/scripts/e2e-nightly.sh'), '--light'],
        { env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, E2E_ENV_FILE: join(dir, 'e2e.env') }, encoding: 'utf8', timeout: 60_000 })

      expect(r.status).toBe(1)
      const log = readFileSync(join(dir, 'testers/e2e/out/nightly.log'), 'utf8')
      expect(log).toMatch(/light pass starting[^\n]*\n(?:.*\n)*?.*Pocket problems pass starting/)
      expect(readFileSync(testersMd, 'utf8')).toMatch(
        /\n## \S+ — Pocket problems pass: not run\n\n- \*\*Pocket problems\*\*: not run, the pass exited 1 without writing its section: Error: the Pocket pass broke\.\n/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
