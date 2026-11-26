import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterAll, describe, expect, it } from 'vitest'
import { LensClient } from '../src/lens.ts'
import type { ScenarioCtx, Verdict } from '../src/scenarios.ts'
import { standingOrders } from '../src/standingOrders.ts'

// B30.132 — standing-orders against the stub Lens (selftest/stub-bank.ts, stub-payees.ts), whose tick pays a standing order's due
// tick as a payment out under the tick's key: it passes when the tick pays once and the skip moves nothing, and FAILs when a
// tick pays without a payment, pays twice, or a skipped tick moves money.

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
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'standing-orders', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  stubs.push(stub)
  await new Promise<void>((resolve, reject) => {
    stub.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'standing-orders')
  const [user] = await lens.createUsers(1)
  return standingOrders({ waitMs: 10_000, pollMs: 500 }).run({ app: { user }, env: { lens }, evidence: [] } as unknown as ScenarioCtx)
}

describe('standing-orders (B30.132)', () => {
  it.concurrent("passes when the due tick pays once as a payment out and the skipped one moves nothing", async () => {
    const v = await onStub('')
    expect(v.detail).toMatch(/^a weekly £20\.00 order from Standing orders \d+'s GBP account paid its due tick once, as completed payment mpay_\S+ with one payment_out_hold on the account; the skipped tick a week on moved nothing and the order next pays \S+; cancelled, it reads inactive and the account holds £80\.00$/)
    expect(v.pass).toBe(true)
  })

  it.concurrent('FAILs when a tick pays without a payment', async () => {
    const v = await onStub('standing-order-unrecorded')
    expect(v.pass).toBe(false)
    expect(v.detail).toMatch(/^the paid tick names payment mpay_\S+, and Lens has no such payment: 404/)
  })

  it.concurrent('FAILs when a tick pays twice', async () => {
    const v = await onStub('standing-order-twice')
    expect(v.pass).toBe(false)
    expect(v.detail).toMatch(/^the one due tick, \S+, must run once, paid, naming its payment; the order's runs are \[.*"outcome":"paid".*"outcome":"paid"/)
  })

  it.concurrent('FAILs when a skipped tick moves money', async () => {
    const v = await onStub('standing-order-skip-pays')
    expect(v.pass).toBe(false)
    expect(v.detail).toBe('a skipped tick must move nothing: the account went £80.00 → £60.00, with 2 payment_out_hold lines')
  })
}, 60_000)
