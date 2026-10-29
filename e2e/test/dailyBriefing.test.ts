import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { LensClient } from '../src/lens.ts'
import type { Evidence, ScenarioCtx, Verdict } from '../src/scenarios.ts'
import { dailyBriefing } from '../src/dailyBriefing.ts'

// B41.206 — daily-briefing against the stub Lens, whose briefing reads its approvals, bills and postings as Lens's DailyBriefing
// does (selftest/stub-bank.ts): it passes on a briefing that names all four, and FAILs when the bill due is left out.

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
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'daily-briefing', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'daily-briefing')
  const [user] = await lens.createUsers(1)
  const evidence: Evidence[] = []
  const ctx = { env: { lens }, app: { user }, evidence } as unknown as ScenarioCtx
  return { verdict: await dailyBriefing().run(ctx), evidence }
}

describe('daily-briefing (B41.206)', () => {
  it("passes on a Lens whose next-morning briefing names the approval, the bill and both payments, and a new workspace's is quiet", async () => {
    const { verdict } = await runAgainstStub('')
    expect(verdict).toMatchObject({ pass: true })
    expect(verdict.detail).toMatch(/spent yesterday 75000 LXC — "1 approval waiting, 1 bill due this week, 2 payments yesterday, spent yesterday 0.075 LXC."$/)
  })

  it('FAILs when the briefing leaves out the bill due', async () => {
    const { verdict } = await runAgainstStub('briefing-no-bill')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^the briefing must list the approval, the bill, then both payments: want approval \S+ 200000 LXC; bill \S+ 4200 GBP; /)
  })
}, 60_000)
