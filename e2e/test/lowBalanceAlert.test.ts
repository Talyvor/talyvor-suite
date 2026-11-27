import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { lowBalanceAlert } from '../src/lowBalanceAlert.ts'
import { LensClient } from '../src/lens.ts'
import type { ScenarioCtx, Verdict } from '../src/scenarios.ts'

// B17.515 — low-balance-alert against the stub Lens (selftest/stub-payees.ts), the app's half left out: it passes on a Lens that
// raises one alert an hour while an agent's balance is below its threshold, and FAILs on one that raises none, or one a read.

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
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'low-balance-alert', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'low-balance-alert')
  const [user] = await lens.createUsers(1)
  return lowBalanceAlert({ screen: false }).run({ app: { user }, env: { lens }, evidence: [] } as unknown as ScenarioCtx)
}

describe('low-balance-alert (B28.61)', () => {
  it('passes on a Lens that raises one alert an hour', async () => {
    const verdict = await runOnStub('')
    expect(verdict.detail).toBe('GBP 20.00 against a GBP 25.00 low-balance alert: read 3 times, one alert for each of the 1 hour(s) it was read in, 2000 below 2500')
    expect(verdict.pass).toBe(true)
  })

  it('FAILs when a balance below its threshold raises no alert', async () => {
    const verdict = await runOnStub('low-balance-unwatched')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/read 3 times, must raise one alert for each hour it was read in; Lens lists 0 in 0 hour/)
  })

  it('FAILs when an alert is raised again on every read', async () => {
    const verdict = await runOnStub('low-balance-every-read')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/Lens lists 3 in 1 hour/)
  })
}, 60_000)
