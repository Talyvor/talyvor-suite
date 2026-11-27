import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { LensClient } from '../src/lens.ts'
import type { Evidence, ScenarioCtx, Verdict } from '../src/scenarios.ts'
import { budgetIdsValidated } from '../src/budgetIds.ts'

// B17.463 — budget-ids-validated against the stub Lens: it passes on a Lens that answers 400 to a budget id that is not a
// UUID and 404 to deleting a budget the workspace does not have (B28.246), and FAILs on one that answers as Lens did
// before: the driver's cast error in a 500, and a false 200.

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
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'budget-ids', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'budget-ids')
  const [user] = await lens.createUsers(1)
  const evidence: Evidence[] = []
  const ctx = { env: { lens }, app: { user }, evidence } as unknown as ScenarioCtx
  return { verdict: await budgetIdsValidated().run(ctx), evidence }
}

describe('budget-ids-validated (B17.463)', () => {
  it('passes on a Lens that validates budget ids and answers 404 to a missing one', async () => {
    const { verdict } = await runAgainstStub('')
    expect(verdict.detail).toMatch(/^GET, PATCH and DELETE of \/budgets\/abc each answered 400/)
    expect(verdict.pass).toBe(true)
  }, 30_000)

  it("FAILs on a Lens that hands a bad id to the database and answers 200 to deleting nothing", async () => {
    const { verdict } = await runAgainstStub('budget-ids-off')
    expect(verdict.pass).toBe(false)
    expect(verdict.detail).toContain('GET /budgets/abc answered 500')
    expect(verdict.detail).toContain("GET /budgets/abc shows the database's words")
    expect(verdict.detail).toMatch(/deleting [0-9a-f-]{36}, a budget the workspace does not have, answered 200/)
    expect(verdict.detail).toContain('deleting the budget a second time answered 200')
  }, 30_000)
})
