import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { LensClient } from '../src/lens.ts'
import { monitoring } from '../src/monitoring.ts'
import type { Evidence, ScenarioCtx, Verdict } from '../src/scenarios.ts'

// B30.119 — monitoring against the stub Lens (selftest/stub-payees.ts), which runs Lens's round_amounts rule on each payment
// out it completes: it passes with one case opened by the third £100.00 and extended by the fourth, and FAILs when no payment
// is judged or when a hit moves money.

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

async function runAgainstStub(broken: string, operatorReadKey = 'operator-read-key'): Promise<{ verdict: Verdict; evidence: Evidence[] }> {
  const port = await freePort()
  stub = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', new URL('../selftest/stub-lens.ts', import.meta.url).pathname], {
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'monitoring-key', STUB_OPERATOR_READ_KEY: 'operator-read-key', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'monitoring-key')
  const evidence: Evidence[] = []
  const ctx = { env: { lens, operatorReadKey }, evidence } as unknown as ScenarioCtx
  return { verdict: await monitoring().run(ctx), evidence }
}

describe('monitoring (B30.119)', () => {
  it('passes on a Lens whose third round payment opens a monitoring case, the fourth extends it and no money moves for it', async () => {
    const { verdict, evidence } = await runAgainstStub('')
    expect(verdict.detail).toBe('two £100.00 payments out opened no case; the third within the hour opened a monitoring case with one round_amounts alert ' +
      'naming the three payments and judging the third, and the fourth added a second alert naming all four to the same case; £12.34, £23.45, ' +
      '£34.56 and £45.67 opened no case and raised no alert; both statements hold exactly £2,000.00 in and each payment out, and each account ' +
      'what came in less what was paid')
    expect(verdict.pass).toBe(true)
    expect(evidence.find((e) => e.note?.includes('after the third round payment') && e.note.includes('alerts'))?.answer).toMatch(/^200 .*"rule":"round_amounts"/)
  })

  it('FAILs when round payments open no case', async () => {
    const { verdict } = await runAgainstStub('monitoring-unwatched')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^the third £100\.00 within the hour must open one monitoring case on the workspace; the open monitoring cases are \[\]$/)
  })

  it('FAILs when a hit moves money', async () => {
    const { verdict } = await runAgainstStub('monitoring-hit-moves')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^the watched account's statement must hold the £2000\.00 in and one line out for each payment/)
  })

  it('SKIPs without the operator read key', async () => {
    await expect(monitoring().run({ env: { operatorReadKey: '' }, evidence: [] } as unknown as ScenarioCtx)).rejects.toThrow(/no LENS_OPERATOR_READ_KEY/)
  })
}, 60_000)
