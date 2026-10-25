import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { LensClient } from '../src/lens.ts'
import type { Evidence, ScenarioCtx, Verdict } from '../src/scenarios.ts'
import { deviceKeyApproval } from '../src/deviceKeyApproval.ts'

// B40.28 — device-key-approval against the stub Lens (selftest/stub-device-keys.ts), which verifies a device's signature as
// Lens does: it passes on a Lens that refuses a revoked key, and FAILs when a revoked device's signature is accepted.

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
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'device-key', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'device-key')
  const [user] = await lens.createUsers(1)
  const evidence: Evidence[] = []
  const ctx = { env: { lens }, app: { user }, evidence } as unknown as ScenarioCtx
  return { verdict: await deviceKeyApproval().run(ctx), evidence }
}

describe('device-key-approval (B40.28)', () => {
  it('passes on a Lens that takes the device signature and refuses it once revoked', async () => {
    const { verdict, evidence } = await runAgainstStub('')
    expect(verdict).toMatchObject({ pass: true })
    expect(evidence.find((e) => e.note === 'the owner approves with the revoked device key')?.answer).toMatch(/^refused 403: /)
  })

  it("FAILs when a revoked device's signature is accepted", async () => {
    const { verdict } = await runAgainstStub('device-revoked-accepted')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^the revoked device's signature on approval \S+ must be refused 403; Lens answered 200/)
  })
}, 60_000)
