import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { LensClient } from '../src/lens.ts'
import type { Evidence, ScenarioCtx, Verdict } from '../src/scenarios.ts'
import { statementSearch } from '../src/statementSearch.ts'

// B17.431 — statement-search against the stub Lens: it passes on a Lens whose agent statement takes ?kind=, ?q=, ?limit=
// and ?cursor= (B28.324), and FAILs when the statement ignores them, as Lens did before B28.324.

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
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'statement-search', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'statement-search')
  const [user] = await lens.createUsers(1)
  const evidence: Evidence[] = []
  const ctx = { env: { lens }, app: { user }, evidence } as unknown as ScenarioCtx
  return { verdict: await statementSearch().run(ctx), evidence }
}

describe('statement-search (B17.431)', () => {
  it('passes on a Lens that filters, searches and pages the agent statement', async () => {
    const { verdict } = await runAgainstStub('')
    expect(verdict.detail).toBe("the agent's statement holds the 10 moves made; kind=fund came 3 + 3 + 1 newest first, each page below the last; " +
      'kind=withdraw only the 3 withdrawals; q= found the one funding it names, and none under kind=withdraw')
    expect(verdict.pass).toBe(true)
  }, 60_000)

  it('FAILs when the statement ignores kind, q, limit and cursor', async () => {
    const { verdict } = await runAgainstStub('statement-search-off')
    expect(verdict.pass).toBe(false)
    expect(verdict.detail).toContain('kind=fund pages of 3 came as [10')
    expect(verdict.detail).toContain('kind=withdraw returned [fund 40001')
    expect(verdict.detail).toContain('want the one funding it names')
  }, 60_000)
})
