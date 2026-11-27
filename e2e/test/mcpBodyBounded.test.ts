import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { LensClient } from '../src/lens.ts'
import type { Evidence, ScenarioCtx, Verdict } from '../src/scenarios.ts'
import { mcpBodyBounded } from '../src/surface.ts'

// B17.466 — mcp-body-bounded against the stub Lens: it passes on a Lens whose /mcp refuses a message over the 4 MiB it
// reads of one with 413 (B28.435), and FAILs on one that decodes and answers it whatever its size.

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
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'mcp-body', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'mcp-body')
  const [user] = await lens.createUsers(1)
  const evidence: Evidence[] = []
  const ctx = { env: { lens }, app: { user }, evidence } as unknown as ScenarioCtx
  return { verdict: await mcpBodyBounded().run(ctx), evidence }
}

describe('mcp-body-bounded (B17.466)', () => {
  it('passes on a Lens whose /mcp refuses an oversized message 413', async () => {
    const { verdict, evidence } = await runAgainstStub('')
    expect(verdict.detail).toMatch(/^\/mcp lists its tools; a \d+-byte message refused 413 in \d+ ms; and \/mcp lists its tools after$/)
    expect(verdict.pass).toBe(true)
    expect(evidence).toHaveLength(3)
  }, 30_000)

  it('FAILs on a Lens that decodes and answers it whatever its size', async () => {
    const { verdict } = await runAgainstStub('mcp-unbounded')
    expect(verdict.pass).toBe(false)
    expect(verdict.detail).toMatch(/^a \d+-byte message to \/mcp, over the 4194304 bytes Lens reads of one, answered 200 .*: decoded and answered with the tools$/)
  }, 30_000)
})
