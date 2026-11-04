import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { monthPlan } from '../src/monthPlan.ts'
import { LensClient } from '../src/lens.ts'
import type { ScenarioCtx, Verdict } from '../src/scenarios.ts'

// B53.16 — month-plan against the stub Lens (selftest/stub-payees.ts), the app's half left out: it passes on a Lens whose plan
// counts the last seven days' pace, and FAILs on one that reads only the money now against the payments due.

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
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'month-plan', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'month-plan')
  const [user] = await lens.createUsers(1)
  return monthPlan({ screen: false }).run({ app: { user }, env: { lens }, evidence: [] } as unknown as ScenarioCtx)
}

describe('month-plan (B53.16)', () => {
  it('passes on a Lens whose plan counts the pace', async () => {
    const verdict = await runOnStub('')
    expect(verdict.detail).toMatch(/^payday in 25 days and GBP 730\.00 of bills: GBP 26\.80 a day; after a GBP 400\.00 spree the rent is short by GBP 201\.40, one notice: "At this pace, 57\.14 GBP a day, the 700\.00 GBP payment to Nightly Landlord \d+ on \d+ \w+ is short by 201\.40 GBP; keeping to 37\.00 GBP a day until then covers it\."$/)
    expect(verdict.pass).toBe(true)
  })

  it('FAILs when the plan ignores the pace', async () => {
    const verdict = await runOnStub('plan-pace-ignored')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/must raise plan_pace_short on it/)
  })
}, 60_000)
