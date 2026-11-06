import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { LensClient } from '../src/lens.ts'
import type { Evidence, ScenarioCtx, Verdict } from '../src/scenarios.ts'
import { connectPay } from '../src/connectPay.ts'

// B52.34 — connect-pay against the stub Lens (selftest/stub-bank.ts connect), which treats a Connect token as Lens B52.4 does: it
// passes on a Lens where the token pays only inside its agent's rules, FAILs when the token can approve (STUB_BREAK=connect-approves),
// and SKIPs without the mint credential.

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

async function runAgainstStub(broken: string, mintKey = 'connect-mint'): Promise<{ verdict: Verdict; evidence: Evidence[] }> {
  const port = await freePort()
  stub = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', new URL('../selftest/stub-lens.ts', import.meta.url).pathname], {
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'connect-key', STUB_CONNECT_MINT_KEY: 'connect-mint', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'connect-key')
  const [user] = await lens.createUsers(1)
  const evidence: Evidence[] = []
  const ctx = { env: { lens, connectMintKey: mintKey }, app: { user }, evidence } as unknown as ScenarioCtx
  return { verdict: await connectPay().run(ctx), evidence }
}

describe('connect-pay (B52.34)', () => {
  it("passes on a Lens where the Connect token pays only inside its agent's rules", async () => {
    const { verdict, evidence } = await runAgainstStub('')
    expect(verdict).toMatchObject({ pass: true })
    expect(evidence.find((e) => e.note?.includes('above the approval amount'))?.answer).toMatch(/^202 .*"pending_approval"/)
  })

  it('FAILs when the Connect token can approve its own pending payment', async () => {
    const { verdict } = await runAgainstStub('connect-approves')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^POST \/agents\/approvals\/\S+\/approve on the Connect token must be refused 403; Lens answered 200/)
    expect(verdict.detail).toMatch(/approval \S+ is approved, not pending/)
  })

  it('SKIPs without the mint credential', async () => {
    await expect(runAgainstStub('', '')).rejects.toThrow(/LENS_CONNECT_MINT_KEY/)
  })
}, 60_000)
