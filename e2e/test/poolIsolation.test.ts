import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { ChargeBook } from '../src/app.ts'
import { SpendCap } from '../src/budget.ts'
import { LensClient } from '../src/lens.ts'
import { poolIsolation } from '../src/pool.ts'
import { CannotTest, type ScenarioCtx, type Verdict } from '../src/scenarios.ts'

// B58.15 — pool-isolation against the stub Lens (selftest/stub-lens.ts) reads whether pooling is on first (Lens B58.14,
// GET /v1/pooling). Pooling off: it cannot test, and says Lens's reason. Pooling on and the reader not served from the
// pool: FAIL. Pooling on and served: the leak checks run as before.

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

async function runOnStub(broken: string): Promise<Verdict> {
  const port = await freePort()
  stub = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', new URL('../selftest/stub-lens.ts', import.meta.url).pathname], {
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'pool-key', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'pool-key')
  const [user] = await lens.createUsers(1)
  const env = { lens, judgeProvider: 'anthropic', judgeModel: 'claude-haiku-4-5', catalog: await lens.catalog(user),
    cap: new SpendCap(1), book: new ChargeBook(), usdPerLXC: await lens.usdPerLXC(), fees: await lens.fees() }
  return poolIsolation().run({ app: { user }, env, evidence: [] } as unknown as ScenarioCtx)
}

describe('pool-isolation (B58.15)', () => {
  it('cannot test when pooling is off for the deployment, and says why as Lens does', async () => {
    const run = runOnStub('pool-off')
    await expect(run).rejects.toThrow(CannotTest)
    await expect(run).rejects.toThrow(/^pooling is off on this deployment \(flag\): LENS_CACHE_POOLABLE_ENABLED is off on this deployment$/)
  })

  it('FAILs when Lens says pooling is on and the reader is not served from the pool', async () => {
    const verdict = await runOnStub('pool-dead')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/Lens says pooling is on, and the reader asking a question the contributor shared was asked afresh, not served from the pool$/)
  })

  it('runs the leak checks when pooling is on and the pool serves the reader', async () => {
    const verdict = await runOnStub('')
    expect(verdict.detail).toMatch(/^the pool served the reader a shared answer at \d+ µLXC; a question asked while not sharing was asked afresh for the reader/)
    expect(verdict.pass).toBe(true)
  })
}, 60_000)
