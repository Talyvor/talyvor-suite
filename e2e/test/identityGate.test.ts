import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { CONFIRM_SENTENCE, identityGate } from '../src/identityGate.ts'
import { LensClient } from '../src/lens.ts'
import type { Evidence, ScenarioCtx, Verdict } from '../src/scenarios.ts'

// B17.554 — identity-gate against the stub Lens: with STUB_IDENTITY_GATE=on it refuses money below L3 as Lens B61.52 does, and
// the scenario passes; off, it is a Lens that moves money for an account that has not confirmed who it is, and the scenario FAILs.

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

async function runAgainstStub(gate: 'on' | 'off'): Promise<{ verdict: Verdict; evidence: Evidence[] }> {
  const port = await freePort()
  stub = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', new URL('../selftest/stub-lens.ts', import.meta.url).pathname], {
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'gate-key', STUB_IDENTITY_GATE: gate, STUB_BREAK: '' },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'gate-key')
  // A workspace of its own starts unconfirmed (UNCONFIRMED_SCENARIOS), as the run seats it.
  const [user] = await lens.createUsers(1, undefined, { confirm: false })
  const evidence: Evidence[] = []
  const ctx = { env: { lens }, app: { user }, evidence } as unknown as ScenarioCtx
  return { verdict: await identityGate().run(ctx), evidence }
}

describe('identity-gate (B17.554)', () => {
  it('passes on a Lens that refuses money below the level, and the move posts once after the check', async () => {
    const { verdict, evidence } = await runAgainstStub('on')
    expect(verdict).toMatchObject({ pass: true })
    expect(verdict.detail).toMatch(/at L0 was refused 403 VERIFICATION_NEEDED .* and again at L2; at L3 the same 1000000 µLXC posted one fund line/)
    expect(evidence.find((e) => e.note?.endsWith('into the agent at L2'))?.answer).toContain(CONFIRM_SENTENCE)
  })

  it('FAILs on a Lens that moves money for an account that has not confirmed who it is', async () => {
    const { verdict } = await runAgainstStub('off')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^a business account at L0, below the L3 it needs, must be refused 403 VERIFICATION_NEEDED .*Lens answered 200 .*1 fund line/)
  })
}, 60_000)
