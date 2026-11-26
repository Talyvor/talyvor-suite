import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { streamOutlives30s } from '../src/concurrency.ts'
import { LensClient } from '../src/lens.ts'
import type { Evidence, ScenarioCtx, Verdict } from '../src/scenarios.ts'

// B17.430 — stream-outlives-30s against the stub Lens, which streams the long answer for 32 s: it passes on a Lens that
// streams it to its end and bills it once, and FAILs when Lens's server ends every stream 30 s after its request (B28.79).

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
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'stream-outlives-30s', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'stream-outlives-30s')
  const [user] = await lens.createUsers(1)
  const evidence: Evidence[] = []
  const env = { lens, catalog: await lens.catalog(user), judgeModel: 'claude-haiku-4-5', judgeProvider: 'anthropic', usdPerLXC: await lens.usdPerLXC(),
    cap: { reserve: () => 0, settle: () => undefined } }
  const ctx = { env, app: { user }, evidence } as unknown as ScenarioCtx
  return { verdict: await streamOutlives30s().run(ctx), evidence }
}

describe('stream-outlives-30s (B17.430)', () => {
  it('passes on a Lens that streams a 32 s answer to message_stop and bills it once', async () => {
    const { verdict } = await runAgainstStub('')
    expect(verdict).toMatchObject({ pass: true })
    expect(verdict.detail).toMatch(/^a 3\d\.\d s stream reached message_stop \(max_tokens\) with 64000 characters, and was billed once: \d+ µLXC, one charge and one spend row$/)
  }, 120_000)

  it('FAILs when Lens ends the stream 30 s after the request', async () => {
    const { verdict } = await runAgainstStub('stream-cut-30s')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^the stream ended after 30\.\d s with no message_stop \(the connection failed: .+\), \d+ characters into the answer$/)
  }, 120_000)
})
