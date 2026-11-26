import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { CannotTest, type Evidence, type ScenarioCtx, type Verdict } from '../src/scenarios.ts'
import { LensClient } from '../src/lens.ts'
import { type CryptoRequest, agentCryptoWallet, x402Wrong } from '../src/agentCryptoWallet.ts'

// B48.21 — agent-crypto-wallet against the stub Lens (selftest/stub-crypto-wallet.ts), which keeps each crypto agent's smart
// account and its ledger as Lens and its chain indexer do: it passes, FAILs when a frozen agent's send still moves money, when a
// paid request is never matched, and when the sweep pays less than the ledger holds, and SKIPs on a Lens whose smart accounts are off.

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
  return { verdict: await agentCryptoWallet().run(ctx), evidence }
}

describe('agent-crypto-wallet (B48.21)', () => {
  it("passes on a Lens that tops up, sends, is asked and paid, freezes and sweeps an agent's crypto wallet on its ledger", async () => {
    const { verdict, evidence } = await runAgainstStub({})
    expect(verdict).toMatchObject({ pass: true })
    expect(verdict.detail).toMatch(/^topped up 62500000 by card; 10 USDC landed \(0x[0-9a-f]{64}\) and 4 USDC paid the request/)
    expect(evidence.find((e) => e.note === 'the owner sends 1 USDC from the frozen agent')?.answer).toMatch(/^refused 403: .*"status":"refused"/)
  })

  it("FAILs when a frozen agent's send still lands", async () => {
    const { verdict } = await runAgainstStub({ STUB_BREAK: 'crypto-frozen-sends' })
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^a send from a frozen agent must be refused; Lens answered 200 /)
  })

  it('FAILs when a request paid in full is never matched to its deposit', async () => {
    const { verdict } = await runAgainstStub({ STUB_BREAK: 'crypto-request-unmatched' })
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^the request paid in full must read paid, nothing remaining and no x402 requirement; Lens answered 200 \{"id":"creq_/)
  })

  it('FAILs when the sweep pays less than the ledger holds', async () => {
    const { verdict } = await runAgainstStub({ STUB_BREAK: 'crypto-sweep-short' })
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^the sweep's call must transfer the 48500000 the ledger holds to 0x0+b4821/)
  })

  it("SKIPs on a Lens whose agents' smart accounts are switched off", async () => {
    await expect(runAgainstStub({ STUB_SMART_ACCOUNTS: 'off' })).rejects.toThrow(CannotTest)
  })
}, 60_000)

describe("an open request's x402 requirement (B48.21)", () => {
  const open: CryptoRequest = { id: 'creq_1', status: 'open', pay_to: '0x00000000000000000000000000000000000000aa', network: 'base-sepolia',
    asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', amount_minor: 4_000_000, remaining_minor: 4_000_000,
    x402: { x402Version: 1, accepts: [{ scheme: 'exact', network: 'base-sepolia', maxAmountRequired: '4000000', payTo: '0x00000000000000000000000000000000000000AA', asset: '0x036cbd53842c5426634e7929541ec2318f3dcf7e' }] } }

  it('is right when it pays exactly what is due to the request\'s address, and wrong when it pays anyone else', () => {
    expect(x402Wrong(open)).toBeUndefined()
    const elsewhere = { ...open, x402: { x402Version: 1, accepts: [{ ...open.x402?.accepts?.[0], payTo: '0x00000000000000000000000000000000000000bb' }] } }
    expect(x402Wrong(elsewhere)).toMatch(/^the request's x402 requirement must be exact on base-sepolia, paying 4000000 of/)
  })
})
