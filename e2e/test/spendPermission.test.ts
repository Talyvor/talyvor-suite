import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { CannotTest, type Evidence, type ScenarioCtx, type Verdict } from '../src/scenarios.ts'
import { LensClient } from '../src/lens.ts'
import { agentCryptoSpendPermission } from '../src/spendPermission.ts'

// B48.38 — agent-crypto-spend-permission against the stub Lens (selftest/stub-spend-permissions.ts), which keeps the owner's
// signed spend permission and judges each of the agent's crypto sends against it as Lens's gate does: it passes, FAILs when the
// gate forgets what was already paid today, and SKIPs on a Lens whose smart accounts are switched off.

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

async function runAgainstStub(env: Record<string, string>): Promise<{ verdict: Verdict; evidence: Evidence[] }> {
  const port = await freePort()
  stub = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', new URL('../selftest/stub-lens.ts', import.meta.url).pathname], {
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'spend-key', STUB_BREAK: '', ...env },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'spend-key')
  const [user] = await lens.createUsers(1)
  const evidence: Evidence[] = []
  const ctx = { env: { lens }, app: { user }, evidence } as unknown as ScenarioCtx
  return { verdict: await agentCryptoSpendPermission().run(ctx), evidence }
}

describe('agent-crypto-spend-permission (B48.38)', () => {
  it("passes on a Lens whose gate holds an agent's crypto sends to the owner's signed spend permission", async () => {
    const { verdict, evidence } = await runAgainstStub({})
    expect(verdict).toMatchObject({ pass: true })
    expect(evidence.find((e) => e.note === 'the owner approves the 10 USDC to the shop with the passkey')?.answer).toMatch(/^200 .*"status":"landed"/)
    expect(evidence.find((e) => e.note === 'the agent pays the shop 1 USDC after the permission ended')?.answer).toMatch(/^403 .*"status":"refused"/)
  })

  it('FAILs when the gate forgets what the agent already paid today', async () => {
    const { verdict } = await runAgainstStub({ STUB_BREAK: 'spend-allowance-forgets' })
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^the agent pays the shop 20 USDC, over the day's allowance with 10 paid must be refused 403 by the permission \(over the allowance\); Lens answered 200 /)
  })

  it("SKIPs on a Lens whose agents' smart accounts are switched off", async () => {
    await expect(runAgainstStub({ STUB_SMART_ACCOUNTS: 'off' })).rejects.toThrow(CannotTest)
  })
}, 60_000)
