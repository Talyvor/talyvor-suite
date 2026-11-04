import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { LensClient } from '../src/lens.ts'
import { roomTakeover } from '../src/roomTakeover.ts'
import type { Evidence, ScenarioCtx, Verdict } from '../src/scenarios.ts'

// B41.48 — room-takeover against the stub Lens (selftest/stub-rooms.ts): it passes on a Lens that hands a room to a
// member and refuses notice to an owner active today; it FAILs when the hand-over leaves the room's owner the old one.

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
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'takeover-key', STUB_MODERATOR_KEY: 'tlv_mod_takeover', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'takeover-key', undefined, undefined, undefined, 'tlv_mod_takeover')
  const [user] = await lens.createUsers(1)
  const evidence: Evidence[] = []
  const ctx = { app: { user }, env: { lens }, evidence } as unknown as ScenarioCtx
  return { verdict: await roomTakeover(4).run(ctx), evidence }
}

describe('room-takeover (B41.48)', () => {
  it('passes on a Lens that hands a room to a member and refuses notice to an owner active today', async () => {
    const { verdict, evidence } = await runAgainstStub('')
    expect(verdict.pass).toBe(true)
    expect(evidence.map((e) => e.note).join('\n')).toMatch(/notice to an owner active today: 409 .*; a vote: 409; a fork: 409/)
  })

  it('FAILs when the hand-over leaves the room its old owner', async () => {
    const { verdict } = await runAgainstStub('room-owner')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^after the hand-over Lens reads the room's owner as /)
  })
}, 60_000)
