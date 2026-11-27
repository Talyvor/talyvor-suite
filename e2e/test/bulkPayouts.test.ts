import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterAll, describe, expect, it } from 'vitest'
import { bulkPayouts } from '../src/bulkPayouts.ts'
import { LensClient } from '../src/lens.ts'
import type { ScenarioCtx, Verdict } from '../src/scenarios.ts'

// B30.136 — bulk-payouts against the stub Lens (selftest/stub-payees.ts), which validates a payouts CSV row by row and pays a
// batch once on its approval, each row past the month's 10 free local payments at 20p (B17.577): it passes when the upload
// moves nothing and two approvals pay each row once at its stated fee, and FAILs when the upload moves money before approval,
// the batch states no fees, or a second approval pays the rows again.

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
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'bulk-payouts', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  stubs.push(stub)
  await new Promise<void>((resolve, reject) => {
    stub.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'bulk-payouts')
  const [user] = await lens.createUsers(1)
  return bulkPayouts().run({ app: { user }, env: { lens }, evidence: [] } as unknown as ScenarioCtx)
}

describe('bulk-payouts (B30.136)', () => {
  it.concurrent('passes when the upload moves nothing and the batch pays each valid row once, however often it is approved', async () => {
    const v = await onStub('')
    expect(v.detail).toBe('a CSV of 50 payouts read 48 valid and 2 invalid — the unknown payee ("no such payee") and "ten pounds" ("amount "ten pounds" is not a ' +
      'positive decimal amount with up to 2 decimal places, such as 12.34") — and moved nothing; approved once, 48 payments out took £592.80 and £7.60 of fees ' +
      "from the company's account, £1000.00 → £399.60; approved again, still 48 and £399.60")
    expect(v.pass).toBe(true)
  })

  it.concurrent('FAILs when an upload moves money before it is approved', async () => {
    const v = await onStub('payout-upload-moved')
    expect(v.pass).toBe(false)
    expect(v.detail).toBe('an upload awaiting approval moved money: the account £1000.00 → £407.20, with 1 payments out on its statement')
  })

  it.concurrent('FAILs when a batch states no fees beside its total', async () => {
    const v = await onStub('payout-fees-unstated')
    expect(v.pass).toBe(false)
    expect(v.detail).toBe('the uploaded batch is wrong: it must state its fees beside its total (fees_minor); it states none')
  })

  it.concurrent('FAILs when approving a batch twice pays its rows twice', async () => {
    const v = await onStub('payout-approved-twice')
    expect(v.pass).toBe(false)
    expect(v.detail).toMatch(/^approving batch mpob_\S+ again paid rows twice: the account £399\.60 → £12\.20, with 81 payments out on its statement where the first approval left 48 \(the second approval answered 200 /)
  })
}, 60_000)
