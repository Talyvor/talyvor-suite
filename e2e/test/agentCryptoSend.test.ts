import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { CannotTest, type Evidence, type ScenarioCtx, type Verdict } from '../src/scenarios.ts'
import { LensClient } from '../src/lens.ts'
import { type AppCall, agentCryptoSend } from '../src/agentCryptoSend.ts'

// B17.561 — agent-crypto-send against the stub Lens (selftest/stub-crypto-wallet.ts), the app's /api/agents/{id}/crypto-sends
// routes relayed to Lens as the BFF relays them (apps/bff/crypto_sends.go): it passes, FAILs when Send pressed again under the
// same key sends a second time and when a decline still sends, and SKIPs on a Lens whose smart accounts are off.

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
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'wallet-key', STUB_BREAK: '', ...env },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'wallet-key')
  const [user] = await lens.createUsers(1)
  const evidence: Evidence[] = []
  const ctx = { env: { lens }, app: { user }, evidence } as unknown as ScenarioCtx
  // As agentBankRelay answers: a 2xx as Lens wrote it, a 4xx as its sentence alone, anything else 502.
  const relay: AppCall = async (method, path, body, headers) => {
    const r = await lens.as(user.token, method, path.replace(/^\/api\/agents\//, `/v1/workspaces/${user.workspaceID}/agents/`), body, headers)
    if (r.status < 300) return { status: r.status, text: r.text }
    if (r.status >= 500) return { status: 502, text: JSON.stringify({ error: 'Lens could not answer just now' }) }
    let error = ''
    try { error = (JSON.parse(r.text) as { error?: string }).error ?? '' } catch { /* no sentence */ }
    return { status: r.status, text: JSON.stringify({ error: error === '' ? 'Lens refused this' : error }) }
  }
  return { verdict: await agentCryptoSend(() => relay).run(ctx), evidence }
}

describe('agent-crypto-send (B17.561)', () => {
  it('passes on a Lens that sends once per key, holds an agent\'s send to a new address for the owner, and sends nothing declined', async () => {
    const { verdict, evidence } = await runAgainstStub({})
    expect(verdict).toMatchObject({ pass: true })
    expect(verdict.detail).toMatch(/^10 USDC landed once \(0x[0-9a-f]{64}\) though Send was pressed twice; .* the ledger holds 46500000$/)
    expect(evidence.find((e) => e.note === 'the agent sends 5 USDC to a new address on its own key')?.answer).toMatch(/^202 .*"status":"awaiting_owner"/)
  })

  it('FAILs when Send pressed again under the same key sends a second time', async () => {
    const { verdict } = await runAgainstStub({ STUB_BREAK: 'crypto-send-twice' })
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^Send pressed again under the same key must answer the same landed send csnd_/)
  })

  it('FAILs when the owner\'s decline still sends the agent\'s payment', async () => {
    const { verdict } = await runAgainstStub({ STUB_BREAK: 'crypto-decline-sends' })
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^a declined send must be refused \(403\); the app answered 200 /)
  })

  it("SKIPs on a Lens whose agents' smart accounts are switched off", async () => {
    await expect(runAgainstStub({ STUB_SMART_ACCOUNTS: 'off' })).rejects.toThrow(CannotTest)
  })
}, 90_000)
