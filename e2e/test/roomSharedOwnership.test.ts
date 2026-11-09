import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { LensClient } from '../src/lens.ts'
import { roomSharedOwnership } from '../src/roomSharedOwnership.ts'
import type { Evidence, ScenarioCtx, Verdict } from '../src/scenarios.ts'

// B41.41 — room-shared-ownership against the stub Lens (selftest/stub-rooms.ts): it passes on a Lens where only the
// owner sets shared ownership and members read it with the notice; it FAILs when any member can set it.

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
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'ownership-key', STUB_MODERATOR_KEY: 'tlv_mod_ownership', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'ownership-key', undefined, undefined, undefined, 'tlv_mod_ownership')
  const [user] = await lens.createUsers(1)
  const evidence: Evidence[] = []
  const ctx = { app: { user }, env: { lens }, evidence } as unknown as ScenarioCtx
  return { verdict: await roomSharedOwnership(4).run(ctx), evidence }
}

describe('room-shared-ownership (B41.41)', () => {
  it('passes on a Lens where only the owner sets shared ownership and members read it with the notice', async () => {
    const { verdict, evidence } = await runAgainstStub('')
    expect(verdict.pass).toBe(true)
    expect(evidence.map((e) => e.note).join('\n')).toMatch(/a company that is not a member reads it: 404; a caller with no key: 401/)
  })

  it('FAILs when a member that is not the owner can set it', async () => {
    const { verdict } = await runAgainstStub('room-ownership')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^a member that is not the owner setting shared ownership was answered 200/)
  })
}, 60_000)
