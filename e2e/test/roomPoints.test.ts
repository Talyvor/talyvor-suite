import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { LensClient } from '../src/lens.ts'
import { roomPoints } from '../src/roomPoints.ts'
import type { Evidence, ScenarioCtx, Verdict } from '../src/scenarios.ts'

// B41.43 — room-points against the stub Lens (selftest/stub-rooms.ts): it passes on a Lens that writes an accepted row of
// size × quality, credits a fork's original the remix share and withdraws on a later rejection; it FAILs when a fork
// credits its original nothing, and (B41.50) when work accepted before its author signs the contributor agreement earns.

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
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'points-key', STUB_MODERATOR_KEY: 'tlv_mod_points', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'points-key', undefined, undefined, undefined, 'tlv_mod_points')
  const [user] = await lens.createUsers(1)
  const evidence: Evidence[] = []
  const ctx = { app: { user }, env: { lens }, evidence } as unknown as ScenarioCtx
  return { verdict: await roomPoints(4).run(ctx), evidence }
}

describe('room-points (B41.43)', () => {
  it("passes on a Lens that earns M's points in an accepted row and credits a fork's original the remix share", async () => {
    const { verdict, evidence } = await runAgainstStub('')
    expect(verdict.pass).toBe(true)
    expect(evidence.map((e) => e.note).join('\n')).toMatch(/the ledger after: .*"reason":"withdrawn"/)
  })

  it('FAILs when work accepted before its author signs the contributor agreement earns points (B41.50)', async () => {
    const { verdict } = await runAgainstStub('room-agreement-unsigned')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^work accepted before its author signed the contributor agreement earned /)
  })

  it('FAILs when a fork credits its original nothing', async () => {
    const { verdict } = await runAgainstStub('room-points-remix')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^the fork's remix_share row reads undefined/)
  })

  it('FAILs when the leaderboard leaves a holder off (B41.45)', async () => {
    const { verdict } = await runAgainstStub('room-leaderboard-holder')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^the leaderboard lists /)
  })

  it('FAILs when Lens saves a lower Gate threshold (B41.46)', async () => {
    const { verdict } = await runAgainstStub('room-gate-lower')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^lowering a Gate threshold must answer 409/)
  })
}, 60_000)
