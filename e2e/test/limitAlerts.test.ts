import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { limitAlerts } from '../src/limitAlerts.ts'
import { LensClient } from '../src/lens.ts'
import type { ScenarioCtx, Verdict } from '../src/scenarios.ts'

// B28.62 — limit-alerts against the stub Lens (selftest/stub-payees.ts), the app's half left out: it passes on a Lens that
// raises the 80% alert of a budget once a period, and FAILs on one that raises it again on every read.

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
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'limit-alerts', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'limit-alerts')
  const [user] = await lens.createUsers(1)
  return limitAlerts({ screen: false }).run({ app: { user }, env: { lens }, evidence: [] } as unknown as ScenarioCtx)
}

describe('limit-alerts (B28.62)', () => {
  it('passes on a Lens that raises one 80% alert a period', async () => {
    const verdict = await runOnStub('')
    expect(verdict.detail).toBe('GBP 8.00 of a GBP 10.00 monthly budget: first read: one at 50%, one at 80%; second read: one at 50%, one at 80%')
    expect(verdict.pass).toBe(true)
  })

  it('FAILs when an alert is raised again on every read', async () => {
    const verdict = await runOnStub('limit-alert-twice')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/read a second time, Lens lists 2 at 50%, 2 at 80% and 0 at 100%/)
  })
}, 60_000)
