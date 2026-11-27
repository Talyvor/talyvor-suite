import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { LensClient } from '../src/lens.ts'
import type { Evidence, ScenarioCtx, Verdict } from '../src/scenarios.ts'
import { statementJournalLens } from '../src/statementJournal.ts'

// B17.434 — statement-journal-lens against the stub Lens: it passes on a Lens whose statement with ?format=journal is a
// balanced journal debiting each account its in and crediting its out (B28.329), and FAILs when ?format=journal answers
// JSON, as before B28.329.

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
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'statement-journal-lens', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'statement-journal-lens')
  const [user] = await lens.createUsers(1)
  const evidence: Evidence[] = []
  const ctx = { env: { lens }, app: { user }, evidence } as unknown as ScenarioCtx
  return { verdict: await statementJournalLens(0).run(ctx), evidence }
}

describe('statement-journal-lens (B17.434)', () => {
  it("passes on a Lens whose journal debits each account its in and credits its out", async () => {
    const { verdict } = await runAgainstStub('')
    expect(verdict.detail).toMatch(/^agent-journal-\S+\.csv: \d+ journal\(s\), debits \d+ µLXC = credits \d+, each of 1 account\(s\) debited its in and credited its out; agent-journal-\S+\.csv: \d+ journal/)
    expect(verdict.pass).toBe(true)
  }, 60_000)

  it('FAILs when ?format=journal answers the JSON statement', async () => {
    const { verdict } = await runAgainstStub('statement-journal-off')
    expect(verdict.pass).toBe(false)
    expect(verdict.detail).toContain('is not the journal')
  }, 60_000)
})
