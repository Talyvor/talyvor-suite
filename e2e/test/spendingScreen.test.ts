import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { spendingScreen } from '../src/spendingScreen.ts'
import { LensClient } from '../src/lens.ts'
import type { ScenarioCtx, Verdict } from '../src/scenarios.ts'

// B53.8 — spending-screen against the stub Lens (selftest/stub-payees.ts), the app's half left out: it passes on a Lens whose merchant
// correction moves the payment's category, and FAILs on one where the correction moves only the budget.

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
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'spending-screen', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'spending-screen')
  const [user] = await lens.createUsers(1)
  return spendingScreen({ screen: false }).run({ app: { user }, env: { lens }, evidence: [] } as unknown as ScenarioCtx)
}

describe('spending-screen (B53.8)', () => {
  it('passes on a Lens whose correction moves the payment into its category', async () => {
    const verdict = await runOnStub('')
    expect(verdict.detail).toMatch(/^GBP 25\.00 to Nightly Halvorsen Kitchen \d+ moved into eating out by one correction, GBP 75\.00 of the GBP 100\.00 budget left, listed as a new merchant with the Coach's "One of your agents paid Nightly Halvorsen Kitchen \d+ for the first time: 25\.00 GBP/)
    expect(verdict.pass).toBe(true)
  })

  it('FAILs when a correction never moves the payment', async () => {
    const verdict = await runOnStub('spending-correction-ignored')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/must read eating out, from the correction; Lens reads transfers from payee/)
  })
}, 60_000)
