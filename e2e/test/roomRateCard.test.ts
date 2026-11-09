import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { LensClient } from '../src/lens.ts'
import { roomRateCard } from '../src/roomRateCard.ts'
import type { Evidence, ScenarioCtx, Verdict } from '../src/scenarios.ts'

// B41.42 — room-rate-card against the stub Lens (selftest/stub-rooms.ts): it passes on a Lens that fixes a size's points
// on a contribution and refuses a raise once it is decided; it FAILs when a decided contribution's points can be raised.

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
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'rate-card-key', STUB_MODERATOR_KEY: 'tlv_mod_rate_card', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'rate-card-key', undefined, undefined, undefined, 'tlv_mod_rate_card')
  const [user] = await lens.createUsers(1)
  const evidence: Evidence[] = []
  const ctx = { app: { user }, env: { lens }, evidence } as unknown as ScenarioCtx
  return { verdict: await roomRateCard(4).run(ctx), evidence }
}

describe('room-rate-card (B41.42)', () => {
  it("passes on a Lens that fixes M's points on a contribution and refuses a raise once it is accepted", async () => {
    const { verdict, evidence } = await runAgainstStub('')
    expect(verdict.pass).toBe(true)
    expect(evidence.map((e) => e.note).join('\n')).toMatch(/raising the accepted contribution to L: the owner 409 .*; the author 409/)
  })

  it("FAILs when an accepted contribution's points can be raised", async () => {
    const { verdict } = await runAgainstStub('room-rate-raise')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^the owner raising an accepted contribution's points was answered 200/)
  })
}, 60_000)
