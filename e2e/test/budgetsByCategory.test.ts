import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { budgetsByCategory } from '../src/budgetsByCategory.ts'
import { LensClient } from '../src/lens.ts'
import type { ScenarioCtx, Verdict } from '../src/scenarios.ts'

// B41.39 — budgets-by-category against the stub Lens (selftest/stub-payees.ts), the app's half left out: it passes on a Lens whose
// category budget spends only its category's payments, and FAILs on one that spends every payment in its currency.

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
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'budgets-by-category', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'budgets-by-category')
  const [user] = await lens.createUsers(1)
  return budgetsByCategory({ screen: false }).run({ app: { user }, env: { lens }, evidence: [] } as unknown as ScenarioCtx)
}

describe('budgets-by-category (B41.39)', () => {
  it('passes on a Lens whose category budget spends only its category', async () => {
    const verdict = await runOnStub('')
    expect(verdict.detail).toBe('GBP 85.00 of a GBP 100.00 AI and software budget, GBP 30.00 of stationery not counted: one 50% alert, one 80% alert raised by the payment that crossed GBP 80.00, still one when read again')
    expect(verdict.pass).toBe(true)
  })

  it('FAILs when a category budget spends every payment', async () => {
    const verdict = await runOnStub('budget-category-ignored')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/Lens lists 1 at 50% and 1 at 80%/)
  })
}, 60_000)
