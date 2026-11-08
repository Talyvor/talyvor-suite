import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { scanReport } from '../src/scanReport.ts'
import { LensClient } from '../src/lens.ts'
import type { ScenarioCtx, Verdict } from '../src/scenarios.ts'

// B52.32 — scan-report against the stub Lens (selftest/stub-scan.ts): it passes on a Lens whose compliance check refuses a planted
// "buy" line, and FAILs on one where the check is bypassed.

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
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'scan-report', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'scan-report')
  const [user] = await lens.createUsers(1)
  return scanReport().run({ app: { user }, env: { lens }, evidence: [] } as unknown as ScenarioCtx)
}

describe('scan-report (B52.32)', () => {
  it('passes on a Lens that refuses the planted line and publishes only on approval', async () => {
    const verdict = await runOnStub('')
    expect(verdict.detail).toBe('report 1000 drafted from recorded eia.stocks.us-distillate data with its box, the planted "buy" line refused ' +
      '("advice or trading wording: Buy") and never approvable, published only on the reviewer\'s approval, and scored a hit at 113000')
    expect(verdict.pass).toBe(true)
  })

  it('FAILs when the compliance check is bypassed', async () => {
    const verdict = await runOnStub('scan-check-bypassed')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/the compliance check must refuse a draft saying "Buy Cushing crude now\."/)
  })
}, 60_000)
