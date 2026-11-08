import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { LensClient } from '../src/lens.ts'
import { roomContributionRecord } from '../src/roomContributionRecord.ts'
import type { Evidence, ScenarioCtx, Verdict } from '../src/scenarios.ts'

// B40.23 — room-contribution-record against the stub Lens (selftest/stub-rooms.ts): it passes on a Lens whose ledger
// multiplies each task's size by its reviewers' quality and whose identity-checked members share the whole pool; it FAILs
// when the ledger ignores the reviewers, and when the leaderboard leaves a holder off.

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number }
      s.close(() => resolve(port))
    })
  })
}

let stub: ChildProcess | undefined
afterEach(() => {
  stub?.kill()
  stub = undefined
})

async function runAgainstStub(broken: string): Promise<{ verdict: Verdict; evidence: Evidence[] }> {
  const port = await freePort()
  stub = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', new URL('../selftest/stub-lens.ts', import.meta.url).pathname], {
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'record-key', STUB_MODERATOR_KEY: 'tlv_mod_record', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'record-key', undefined, undefined, undefined, 'tlv_mod_record')
  const [user] = await lens.createUsers(1)
  const evidence: Evidence[] = []
  const ctx = { app: { user }, env: { lens }, evidence } as unknown as ScenarioCtx
  return { verdict: await roomContributionRecord(4).run(ctx), evidence }
}

describe('room-contribution-record (B40.23)', () => {
  it("passes on a Lens whose ledger reads size × the reviewers' quality and whose leaderboard shares add up to 100%", async () => {
    const { verdict, evidence } = await runAgainstStub('')
    expect(verdict).toMatchObject({ pass: true })
    expect(evidence.map((e) => e.note).join('\n')).toMatch(/a caller with no key is refused all of/)
  })

  it("FAILs when an accepted row ignores the reviewers' quality", async () => {
    const { verdict } = await runAgainstStub('room-points-quality')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/accepted row reads .* quality its reviews read/)
  })

  it('FAILs when the leaderboard leaves a holder off', async () => {
    const { verdict } = await runAgainstStub('room-leaderboard-holder')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^the leaderboard lists /)
  })
}, 60_000)
