import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { LensClient } from '../src/lens.ts'
import { walletRequestKeyed } from '../src/routes.ts'
import type { ScenarioCtx, Verdict } from '../src/scenarios.ts'

// B17.521 — wallet-request-keyed against the stub Lens (selftest/stub-bank.ts): it passes on a Lens that answers a retried ask
// and a retried accept under the same Idempotency-Key with what each first did, and FAILs on one that ignores the key.

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
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'wallet-request-keyed', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'wallet-request-keyed')
  const [user] = await lens.createUsers(1)
  return walletRequestKeyed(0).run({ app: { user }, env: { lens }, evidence: [] } as unknown as ScenarioCtx)
}

describe('wallet-request-keyed (B28.72)', () => {
  it('passes on a Lens that answers a retry under the same key with what it first did', async () => {
    const verdict = await runOnStub('')
    expect(verdict.detail).toMatch(/^asked twice under one key: one request, mrq_\S+; the key with another amount: 409; accepted twice under one key: one transfer/)
    expect(verdict.pass).toBe(true)
  })

  it('FAILs when the Idempotency-Key is ignored', async () => {
    const verdict = await runOnStub('idempotency-ignored')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/the same ask under the same key must answer request mrq_\S+ again/)
  })
}, 60_000)
