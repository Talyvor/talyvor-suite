import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { LensClient } from '../src/lens.ts'
import { marketPayouts, shares } from '../src/marketPayouts.ts'
import { CannotTest, type Evidence, type ScenarioCtx, type Verdict } from '../src/scenarios.ts'

// B46.24 — market-earnings-payout against the stub Lens (selftest/stub-bank.ts, stub-earnings.ts): it passes on a Lens whose
// weekly run pays a seller's sale and its original's royalty on the money layer, the seller without verified details held; it
// FAILs when the royalty is paid as a sale, and SKIPs on a run that still pays such a seller by Stripe.

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

async function runAgainstStub(broken: string): Promise<Verdict> {
  const port = await freePort()
  stub = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', new URL('../selftest/stub-lens.ts', import.meta.url).pathname], {
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'market-payouts', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'market-payouts')
  const evidence: Evidence[] = []
  const ctx = { env: { lens, judgeModel: 'claude-haiku-4-5', fees: { market_take_bps: 1500 } }, evidence } as unknown as ScenarioCtx
  return marketPayouts().run(ctx)
}

describe('market-earnings-payout (B46.24)', () => {
  it('splits a $100.00 remix rent at a 15% take and a 30% royalty, and a $30.00 rent', () => {
    expect(shares(1500)).toEqual({ seller: 59_500_000, creator: 25_500_000, third: 25_500_000 })
  })

  it("passes on a Lens whose weekly run pays the sale and the original's royalty on the money layer, the pending seller held", async () => {
    const verdict = await runAgainstStub('')
    expect(verdict.detail).toMatch(/under market:\d{4}-W\d{2}: the seller's sale 5950 completed, the creator's royalty 2550 completed, the third seller's sale 2550 held$/)
    expect(verdict.pass).toBe(true)
  })

  it('FAILs when the lineage royalty is paid out as a sale', async () => {
    const verdict = await runAgainstStub('royalty-paid-as-sale')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^the creator must have one earnings_payout under market:\S+, a royalty of 2550 USD minor completed/)
  })

  it('SKIPs on a Lens whose synthetic run still pays such a seller by Stripe', async () => {
    const run = runAgainstStub('payout-run-ignores-money')
    await expect(run).rejects.toThrow(CannotTest)
    await expect(run).rejects.toThrow(/by stripe, not on the money layer.*talyvor-lens B46\.25/)
  })
}, 60_000)
