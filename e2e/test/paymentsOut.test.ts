import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterAll, describe, expect, it } from 'vitest'
import { LensClient } from '../src/lens.ts'
import { paymentsOut } from '../src/paymentsOut.ts'
import type { ScenarioCtx, Verdict } from '../src/scenarios.ts'

// B30.127 — payments-out against the stub Lens (selftest/stub-payees.ts), whose agent payments out are judged by the agent's
// rules: it passes when the £100.00 above the approval amount waits with nothing moved and pays once approved, and FAILs when a
// payment refused for its approval moves money anyway.

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
  return paymentsOut().run({ app: { user }, env: { lens }, evidence: [] } as unknown as ScenarioCtx)
}

describe('payments-out (B30.127)', () => {
  it.concurrent("passes when each payment out leaves the agent's account as the Test partner answers it and the one above the approval amount waits for the owner", async () => {
    const v = await onStub('')
    expect(v.detail).toMatch(/^from Payments out \d+'s GBP account: £20\.00 completed; £20\.13 failed and £20\.14 read returned, each leaving it whole; £100\.00 above 1,000 LXC was refused 403 on approval \S+ with nothing moved, then approved and paid under the same key; the account ended at £180\.00, its statement summing to it$/)
    expect(v.pass).toBe(true)
  })

  it.concurrent('FAILs when a payment above the approval amount moves money before it is approved', async () => {
    const v = await onStub('payment-above-moved')
    expect(v.pass).toBe(false)
    expect(v.detail).toBe('£100.00 waiting for its approval moved money: £280.00 → £180.00')
  })
}, 60_000)
