import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { chargedAfterHangUp } from '../src/concurrency.ts'
import { LensClient } from '../src/lens.ts'
import type { Evidence, ScenarioCtx, Verdict } from '../src/scenarios.ts'

// B17.532 — charged-after-hang-up against the stub Lens: it passes on a Lens that charges a question its client hung up on the
// moment the answer arrived, and FAILs when the charge runs on the request's own life after the answer is written (B28.242).

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
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'charged-after-hang-up', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'charged-after-hang-up')
  const [user] = await lens.createUsers(1)
  const evidence: Evidence[] = []
  const env = { lens, catalog: await lens.catalog(user), judgeModel: 'claude-haiku-4-5', judgeProvider: 'anthropic', usdPerLXC: await lens.usdPerLXC(),
    cap: { reserve: () => 0, settle: () => undefined } }
  const ctx = { env, app: { user }, evidence } as unknown as ScenarioCtx
  return { verdict: await chargedAfterHangUp().run(ctx), evidence }
}

describe('charged-after-hang-up (B17.532)', () => {
  it('passes on a Lens that charges a question its client hung up on', async () => {
    const { verdict } = await runAgainstStub('')
    expect(verdict).toMatchObject({ pass: true })
    expect(verdict.detail).toMatch(/^the question hung up on the moment its answer arrived was charged as one asked staying connected is: one spend row, \d+ µLXC debited/)
  }, 60_000)

  it('FAILs when the charge dies with the connection', async () => {
    const { verdict } = await runAgainstStub('hangup-answer-unbilled')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^hung up on the moment its answer arrived, the question left no spend row on the ledger: the answer went free/)
  }, 150_000)
})
