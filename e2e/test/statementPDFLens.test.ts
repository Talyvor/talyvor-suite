import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { LensClient } from '../src/lens.ts'
import type { Evidence, ScenarioCtx, Verdict } from '../src/scenarios.ts'
import { statementPDFLens } from '../src/statementPDF.ts'

// B17.433 — statement-pdf-lens against the stub Lens: it passes on a Lens whose statement with ?format=pdf opens and
// closes each account at the JSON statement's balance (B28.328), and FAILs when ?format=pdf answers JSON, as before B28.328.

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
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'statement-pdf-lens', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'statement-pdf-lens')
  const [user] = await lens.createUsers(1)
  const evidence: Evidence[] = []
  const ctx = { env: { lens }, app: { user }, evidence } as unknown as ScenarioCtx
  return { verdict: await statementPDFLens(0).run(ctx), evidence }
}

describe('statement-pdf-lens (B17.433)', () => {
  it("passes on a Lens whose PDF statement opens and closes each account at the JSON's balance", async () => {
    const { verdict } = await runAgainstStub('')
    expect(verdict.detail).toMatch(/^agent-statement-\S+\.pdf: 1 account\(s\), each opening and closing at the JSON statement's balance; agent-statement-\S+\.pdf: \d+ account\(s\), each opening/)
    expect(verdict.pass).toBe(true)
  }, 60_000)

  it('FAILs when ?format=pdf answers the JSON statement', async () => {
    const { verdict } = await runAgainstStub('statement-pdf-off')
    expect(verdict.pass).toBe(false)
    expect(verdict.detail).toContain('is not a PDF')
  }, 60_000)
})
