import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { LensClient } from '../src/lens.ts'
import { CannotTest, type Evidence, type ScenarioCtx, type Verdict } from '../src/scenarios.ts'
import { agentAnalyticsLens } from '../src/agentAnalytics.ts'

// B17.432 — agent-analytics-lens against the stub Lens: it passes on a Lens whose analytics put every posting out of the
// agent in one bucket by day, model and destination (B28.326), and FAILs when there are none, as before B28.326.
// B17.581 — it asks on a model the run's catalog lists, and is skipped with its reason when the catalog lists none.

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

async function runAgainstStub(broken: string, opts: { judgeModel?: string; noCatalog?: boolean } = {}): Promise<{ verdict: Verdict; evidence: Evidence[] }> {
  const port = await freePort()
  stub = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', new URL('../selftest/stub-lens.ts', import.meta.url).pathname], {
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'agent-analytics-lens', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'agent-analytics-lens')
  const [user] = await lens.createUsers(1)
  const evidence: Evidence[] = []
  const env = {
    lens, catalog: opts.noCatalog ? [] : await lens.catalog(user), judgeProvider: 'anthropic', judgeModel: opts.judgeModel ?? 'claude-haiku-4-5', usdPerLXC: 0.1,
    cap: { reserve: () => 0, settle: () => undefined }, book: { add: () => undefined },
  }
  const ctx = { env, app: { user }, evidence } as unknown as ScenarioCtx
  return { verdict: await agentAnalyticsLens(0).run(ctx), evidence }
}

describe('agent-analytics-lens (B17.432)', () => {
  it("passes on a Lens whose analytics sum to the agent's statement's out", async () => {
    const { verdict } = await runAgainstStub('')
    expect(verdict.detail).toMatch(/^\d+ bucket\(s\) sum to 0\.75\d* LXC out, the statement's out and the agent's postings out; Paid on Lens 0, the workspace and claude-haiku-4-5 each hold theirs$/)
    expect(verdict.pass).toBe(true)
  }, 60_000)

  it("asks on a model the run's catalog lists when it does not list the run's judge model (B17.581)", async () => {
    const { verdict } = await runAgainstStub('', { judgeModel: 'claude-sonnet-9' })
    expect(verdict.detail).toMatch(/^\d+ bucket\(s\) sum to 0\.75\d* LXC out, .* and claude-haiku-4-5 each hold theirs$/)
    expect(verdict.pass).toBe(true)
  }, 60_000)

  it('is skipped with its reason when the run lists no model, as a launch run does (B17.581)', async () => {
    const run = runAgainstStub('', { noCatalog: true })
    await expect(run).rejects.toBeInstanceOf(CannotTest)
    await expect(run).rejects.toThrow(/the run's catalog lists no anthropic model to ask/)
  }, 60_000)

  it('FAILs on a Lens with no analytics', async () => {
    const { verdict } = await runAgainstStub('agent-analytics-off')
    expect(verdict.pass).toBe(false)
    expect(verdict.detail).toContain("GET Analysed on Lens 0's analytics answered 404")
  }, 60_000)
})
