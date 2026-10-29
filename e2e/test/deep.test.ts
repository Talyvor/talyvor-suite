import { describe, expect, it } from 'vitest'
import { parseConfig } from '../src/config.ts'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deepJourneys, redTeamChain, roundOf } from '../src/deep.ts'
import { fileItems, itemsFor } from '../src/filing.ts'
import { cast } from '../src/plans.ts'
import { type ReportedRun, renderRun, renderSummary, SECURITY_SCENARIOS } from '../src/report.ts'
import { journeyFor } from '../src/scenarios.ts'

// B28.292, B50.7 — the deep red-team pass, every night: fresh attackers play every red-team scenario back to back, under the
// run's cap, and a FAIL is filed as a SECURITY item under B50 and reported first.

const RED_TEAM = ['ledger-moves-at-once', 'ledger-call-once', 'webhook-unsigned', 'webhook-replayed', 'agent-rules-unbypassable',
  'market-abuse', 'pool-isolation', 'injection-exfil', 'ssrf-refused', 'file-bomb-bounded', 'csrf-refused', 'script-inert',
  'keys-unlisted', 'keys-not-forwarded', 'rate-limits-hold', 'cross-company-test-money',
  'money-tampered', 'mcp-pay-retried-once', 'approval-reused', 'approval-own-request', 'passkey-enrol-signed', 'agent-resume-signed', 'injection-exfil-web-page', 'injection-exfil-room-message', 'csrf-every-write', 'xss-shown-back']

describe('the deep red-team pass (B28.292, B50.7)', () => {
  it('plays none unless told how many rounds (the nightly tells it every night)', () => {
    const env = { LENS_SYNTHETIC_KEY: 'k', E2E_APP_URL: 'http://app', E2E_LENS_URL: 'http://lens' }
    expect(parseConfig([], env).deepRounds).toBe(0)
    expect(parseConfig([], { ...env, E2E_DEEP_ROUNDS: '3' }).deepRounds).toBe(3)
  })

  it('is, each round, a fresh attacker playing every red-team scenario the night plays, against a counterparty of its own', () => {
    const night = Array.from({ length: 10 }, (_, i) => journeyFor(i, 10, []))
    const deep = deepJourneys(10, 2)
    expect(deep.map((j) => j.length)).toEqual([RED_TEAM.length, 0, RED_TEAM.length, 0])
    expect(deep[0].map((s) => s.id)).toEqual(RED_TEAM)
    // The report's list of security scenarios is the chain, so every one of them is filed as SECURITY and reported first.
    expect([...SECURITY_SCENARIOS]).toEqual(redTeamChain(0, 1).map((s) => s.id))
    // Every one of them is a scenario the night itself plays, by the same id, so its FAIL is filed under the same marker.
    const played = new Set(night.flat().map((s) => s.id))
    expect(RED_TEAM.filter((id) => !played.has(id))).toEqual([])
    // Attackers 10 and 12 trade with counterparties 11 and 13, created on Business; every other attack has a fresh workspace.
    expect(deep[0].find((s) => s.id === 'cross-company-test-money')?.partners).toEqual([11])
    expect(deep[2].find((s) => s.id === 'cross-company-test-money')?.partners).toEqual([13])
    const c = cast([...night, ...deep])
    expect([c.plans[11], c.plans[13]]).toEqual(['business', 'business'])
    expect(c.own.filter((o) => o.user >= 10).map((o) => o.scenario)).toEqual([...RED_TEAM, ...RED_TEAM].filter((id) => id !== 'cross-company-test-money'))
    expect([9, 10, 11, 12, 13].map((i) => roundOf(i, 10))).toEqual([undefined, 1, 1, 2, 2])
  })

  const run = (outcomes: ReportedRun['outcomes']): ReportedRun => ({
    started_at: '2026-10-11T01:00:00.000Z', finished_at: '2026-10-11T03:00:00.000Z', app: 'https://app', lens: 'https://lens',
    users: 14, model: 'Claude Haiku 4.5', cap_usd: 5, spent_usd: 4.2, stopped_at_cap: false, deep_rounds: 2,
    counts: { PASS: 2, FAIL: 1, SKIP: 1, ERROR: 0 }, outcomes,
  })
  const outcomes: ReportedRun['outcomes'] = [
    { scenario: 'rate-limits-hold', title: 'a burst past the limit is refused', user: 7, workspace: 'ws7', status: 'PASS', detail: 'held', evidence: [] },
    { scenario: 'rate-limits-hold', title: 'a burst past the limit is refused', user: 10, workspace: 'ws10', status: 'FAIL', deep: 1,
      detail: 'all 150 reads at once were served: nothing refused past the limit', evidence: [] },
    { scenario: 'rate-limits-hold', title: 'a burst past the limit is refused', user: 12, workspace: 'ws12', status: 'PASS', deep: 2, detail: 'held', evidence: [] },
    { scenario: 'csrf-refused', title: 'a write from another site is refused', user: 12, workspace: 'ws12', status: 'SKIP', deep: 2, detail: 'spend cap reached', evidence: [] },
  ]

  it('files a FAIL only the deep pass found as a SECURITY item under B50, naming the round', () => {
    const f = itemsFor('# queue\n', run(outcomes), 'docs/e2e/report-2026-10-11.md')
    expect(f.filed).toEqual([{ id: 'B50.1', scenario: 'rate-limits-hold', repo: 'talyvor-lens' }])
    expect(f.append).toBe('')
    expect(f.security).toContain('## B50.1 — SECURITY: a burst past the limit is refused\nrepo: talyvor-lens · deps: none · status: OPEN\n')
    expect(f.security).toContain("The deep red-team pass (B28.292, B50.7) caught it, in round 1: nothing else that night FAILED it, so it slipped through the nightly's own run.")
    expect(f.security).toContain('\ne2e-scenario: rate-limits-hold\n')
  })

  it('puts a planted finding right under the B50 heading, numbered next in B50, with no key in it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'b507-'))
    const path = join(dir, 'BUILD.md')
    const intro = '# B50 — SECURITY FIRST\n\nNick, 28 Oct: every check tested.\n\n'
    writeFileSync(path, `# queue\n\n${intro}## B50.13 — SECURITY: an older one\nrepo: talyvor-lens · deps: none · status: OPEN\n\n# B44 — next\n`)
    const planted: ReportedRun['outcomes'] = [{ scenario: 'xss-shown-back', title: 'a payee name never runs', user: 3, workspace: 'ws3', status: 'FAIL',
      detail: '/money/pay ran the payload: payee name; the page also showed tlv_abcdefghijklmnopqrstu', evidence: [] }]
    try {
      const f = await fileItems(path, run(planted), 'docs/e2e/report.md')
      expect(f?.filed).toEqual([{ id: 'B50.14', scenario: 'xss-shown-back', repo: 'talyvor-suite' }])
      const md = readFileSync(path, 'utf8')
      expect(md.indexOf('## B50.14 — SECURITY: a payee name never runs')).toBe(md.indexOf(intro) + intro.length)
      expect(md.indexOf('## B50.13')).toBeGreaterThan(md.indexOf('## B50.14'))
      expect(md).not.toContain('tlv_abcdefghijklmnopqrstu')
      expect(md).toContain('<a key, withheld>')
      // Filed once: the next night's same FAIL is covered by it.
      expect(itemsFor(md, run(planted), 'docs/e2e/report.md').covered).toEqual([{ scenario: 'xss-shown-back', by: 'B50.14' }])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reports the security results first: the night and each round, the item a FAIL is filed in, and the first line for the morning', () => {
    const r = { ...run(outcomes), filed: { 'rate-limits-hold': 'B50.1' } }
    const md = renderRun(r)
    expect(md.indexOf('### Security')).toBeGreaterThan(0)
    expect(md.indexOf('### Security')).toBeLessThan(md.indexOf('| Scenario | Pass | Fail |'))
    expect(md).toContain('| `rate-limits-hold` | PASS | FAIL | PASS | B50.1 |')
    expect(md).toContain('| `csrf-refused` | — | — | SKIP |  |')
    expect(md).toContain('FAIL rate-limits-hold — user 10, deep round 1:')
    const summary = renderSummary(r, 'report.md', ['B50.1'])
    expect(summary.split('\n')[2]).toBe('- **Security**: the night and 2 deep round(s); 2 of 4 verdicts passed, 1 skipped; FAILED: `rate-limits-hold` (round 1, B50.1).')
  })
})
