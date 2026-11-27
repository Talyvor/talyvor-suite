import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { LensClient } from '../src/lens.ts'
import type { Evidence, ScenarioCtx, Verdict } from '../src/scenarios.ts'
import { providerKeyHidden } from '../src/providerKeyHidden.ts'

// B17.464 — provider-key-hidden against the stub Lens: it passes on a Lens that cuts the key it sent and the provider's
// address out of a provider's refusal on both copies of the proxy (B28.250), and FAILs on one that passes the refusal on
// as it came, buffered or streamed.

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
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'provider-key', STUB_PROVIDER_KEYS: '1', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'provider-key')
  const [user] = await lens.createUsers(1)
  const evidence: Evidence[] = []
  const ctx = { env: { lens, judgeProvider: 'anthropic', judgeModel: 'claude-haiku-4-5' }, app: { user }, evidence } as unknown as ScenarioCtx
  return { verdict: await providerKeyHidden().run(ctx), evidence }
}

describe('provider-key-hidden (B17.464)', () => {
  it("passes on a Lens that cuts the key and the provider's address out of a refusal", async () => {
    const { verdict, evidence } = await runAgainstStub('')
    expect(verdict.detail).toMatch(/^the provider refused the placeholder anthropic key on both the buffered and the streamed call/)
    expect(verdict.pass).toBe(true)
    expect(evidence.map((e) => e.note).join('\n')).toContain('401 on the own key')
  }, 30_000)

  it('FAILs on a Lens that passes the buffered refusal on as it came', async () => {
    const { verdict, evidence } = await runAgainstStub('provider-key-echo')
    expect(verdict.pass).toBe(false)
    expect(verdict.detail).toContain('the buffered refusal shows the tenant the provider key Lens sent')
    expect(verdict.detail).toContain("the buffered refusal shows the tenant the provider's address api.anthropic.com")
    expect(verdict.detail).not.toContain('streamed')
    expect(evidence.map((e) => e.note).join('\n')).not.toMatch(/sk-talyvor-e2e-placeholder-\d/)
  }, 30_000)

  it('FAILs on a Lens that passes the streamed refusal on as it came', async () => {
    const { verdict } = await runAgainstStub('provider-key-echo-stream')
    expect(verdict.pass).toBe(false)
    expect(verdict.detail).toContain('the streamed refusal shows the tenant the provider key Lens sent')
    expect(verdict.detail).not.toContain('buffered')
  }, 30_000)
})
