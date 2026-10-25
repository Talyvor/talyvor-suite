import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { LensClient } from '../src/lens.ts'
import type { Evidence, ScenarioCtx, Verdict } from '../src/scenarios.ts'
import { permissionMandate } from '../src/permissionMandates.ts'

// B40.26 — permission-mandate against the stub Lens (selftest/stub-permission-mandates.ts), which verifies a mandate's passkey
// signature as Lens does: it passes on Lens's evaluator, and FAILs when a payment asked for by voice is allowed.

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
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'mandate-key', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'mandate-key')
  const evidence: Evidence[] = []
  const ctx = { env: { lens }, evidence } as unknown as ScenarioCtx
  return { verdict: await permissionMandate().run(ctx), evidence }
}

describe('permission-mandate (B40.26)', () => {
  it('passes on a Lens that keeps the signed mandate and judges allow, needs approval and block', async () => {
    const { verdict, evidence } = await runAgainstStub('')
    expect(verdict).toMatchObject({ pass: true })
    expect(evidence.find((e) => e.note === 'the owner signs a mandate altered to £999 a payment')?.answer).toMatch(/^refused 400: /)
  })

  it('FAILs when the evaluator allows a payment asked for by voice', async () => {
    const { verdict } = await runAgainstStub('mandate-voice-allowed')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^the same £90 asked for by voice: want needs_approval by clients.voice, Lens answered 200 .*"decision":"allow"/)
  })
}, 60_000)
