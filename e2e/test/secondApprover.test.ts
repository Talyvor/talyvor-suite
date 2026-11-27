import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { LensClient } from '../src/lens.ts'
import type { Evidence, ScenarioCtx, Verdict } from '../src/scenarios.ts'
import { secondApprover } from '../src/secondApprover.ts'

// B17.537 — second-approver against the stub Lens (selftest/stub-second-approver.ts), which holds a payment over the second-approver
// line for two people as Lens B28.315 does: it passes there, FAILs on a Lens where the first approval pays
// (STUB_BREAK=second-approver-one-approval), and SKIPs without the provisioning secret.

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

async function runAgainstStub(broken: string, secret = 'provision-secret'): Promise<{ verdict: Verdict; evidence: Evidence[] }> {
  const port = await freePort()
  stub = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', new URL('../selftest/stub-lens.ts', import.meta.url).pathname], {
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'second-key', STUB_PROVISION_SECRET: 'provision-secret', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'second-key')
  const [user] = await lens.createUsers(1)
  const evidence: Evidence[] = []
  const ctx = { env: { lens, provisionSecret: secret }, app: { user }, evidence } as unknown as ScenarioCtx
  return { verdict: await secondApprover().run(ctx), evidence }
}

describe('second-approver (B17.537)', () => {
  it("passes on a Lens where a payment over the line needs the owner's and the second approver's approval", async () => {
    const { verdict, evidence } = await runAgainstStub('')
    expect(verdict).toMatchObject({ pass: true })
    expect(evidence.find((e) => e.note?.includes('the first of two'))?.answer).toMatch(/^200 .*"status":"pending"/)
  })

  it("FAILs when the owner's one approval pays it", async () => {
    const { verdict } = await runAgainstStub('second-approver-one-approval')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^the owner's approval above the line must answer 200 with the approval still pending/)
  })

  it('SKIPs without the provisioning secret', async () => {
    await expect(runAgainstStub('', '')).rejects.toThrow(/LENS_PROVISION_SECRET/)
  })
}, 60_000)
