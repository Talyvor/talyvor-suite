import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterAll, describe, expect, it } from 'vitest'
import { LensClient } from '../src/lens.ts'
import { paymentsOut } from '../src/paymentsOut.ts'
import type { ScenarioCtx, Verdict } from '../src/scenarios.ts'

// B30.127 — payments-out against the stub Lens (selftest/stub-payees.ts), whose agent payments out are judged by the agent's
// rules: it passes when the £100.00 above the approval amount waits with nothing moved and pays once approved, and FAILs when a
// payment refused for its approval moves money anyway. B30.135: and when an international payment takes only its amount from
// the company's account, not its quote's total; B30.148: and when the payment's entry leaves its fee off the revenue account.

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number }
      s.close(() => resolve(port))
    })
  })
}

const stubs: ChildProcess[] = []
afterAll(() => {
  for (const s of stubs) s.kill()
})

async function onStub(broken: string): Promise<Verdict> {
  const port = await freePort()
  const stub = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', new URL('../selftest/stub-lens.ts', import.meta.url).pathname], {
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'payments-out', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  stubs.push(stub)
  await new Promise<void>((resolve, reject) => {
    stub.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'payments-out')
  const [user] = await lens.createUsers(1)
  return paymentsOut().run({ app: { user }, env: { lens, fees: await lens.fees() }, evidence: [] } as unknown as ScenarioCtx)
}

describe('payments-out (B30.127)', () => {
  it.concurrent("passes when each payment out leaves the agent's account as the Test partner answers it and the one above the approval amount waits for the owner", async () => {
    const v = await onStub('')
    expect(v.detail).toMatch(/^from Payments out \d+'s GBP account: £20\.00 completed; £20\.13 failed and £20\.14 read returned, each leaving it whole; £100\.00 above 1,000 LXC was refused 403 on approval \S+ with nothing moved, then approved and paid under the same key; the account ended at £180\.00, its statement summing to it\. Abroad: with no quote 400, £50\.00 quoted at a fee of £5\.00 and the partner's £1\.00, £56\.00 in all, 58\.00 EUR arriving at 1\.16; another amount at the quote 409; at the quote it completed and the company's account fell by exactly £56\.00; its entry's 5 postings sum to zero in GBP and in EUR, £5\.00 to Talyvor's revenue and 58\.00 EUR arriving$/)
    expect(v.pass).toBe(true)
  })

  it.concurrent('FAILs when a payment above the approval amount moves money before it is approved', async () => {
    const v = await onStub('payment-above-moved')
    expect(v.pass).toBe(false)
    expect(v.detail).toBe('£100.00 waiting for its approval moved money: £280.00 → £180.00')
  })

  it.concurrent("FAILs when an international payment takes only its amount from the account, not its quote's total (B30.135)", async () => {
    const v = await onStub('intl-fee-off-ledger')
    expect(v.pass).toBe(false)
    expect(v.detail).toBe("the payment abroad must take its quote's total £56.00 from the account: £200.00 → £150.00, £50.00 taken")
  })

  it.concurrent("FAILs when an international payment's entry leaves its fee off Talyvor's revenue account (B30.148)", async () => {
    const v = await onStub('intl-fee-unposted')
    expect(v.pass).toBe(false)
    expect(v.detail).toBe("the payment abroad's entry is wrong: Talyvor's revenue account must gain the fee £5.00; it gains £0.00 " +
      '([["hold",-5100,"GBP"],["partner",5100,"GBP"],["partner",-5800,"EUR"],["partner",5800,"EUR"]])')
  })
}, 60_000)
