import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterAll, describe, expect, it } from 'vitest'
import { LensClient } from '../src/lens.ts'
import { moneyAccounts } from '../src/moneyAccounts.ts'
import type { ScenarioCtx, Verdict } from '../src/scenarios.ts'

// B30.107 — money-accounts against the stub Lens (selftest/stub-payees.ts and stub-launch.ts): it passes when every step posts,
// and FAILs when a payment completes without its posting on the account.

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
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'money-accounts', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  stubs.push(stub)
  await new Promise<void>((resolve, reject) => {
    stub.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'money-accounts')
  const [user] = await lens.createUsers(1)
  return moneyAccounts().run({ app: { user }, env: { lens }, evidence: [] } as unknown as ScenarioCtx)
}

describe('money-accounts (B30.107)', () => {
  it.concurrent('passes when every account opens at zero and each payment in, payment out, funding and conversion posts', async () => {
    const v = await onStub('')
    expect(v.detail).toMatch(/^the company's GBP and EUR accounts and Accounts \w+'s opened at zero; £50\.00 came in as payment_in; £20\.00 to a saved payee completed, 2000 held off the account; £10\.00 to Accounts \w+ converted to \d+ EUR cents in entry ment_\S+; all four statements hold exactly those postings and close on what their accounts hold: GBP 2000, EUR 0, agent GBP 0, agent EUR \d+$/)
    expect(v.pass).toBe(true)
  })

  it.concurrent('FAILs when a payment completes without its posting on the account', async () => {
    const v = await onStub('payment-account-unmoved')
    expect(v.pass).toBe(false)
    expect(v.detail).toMatch(/^the company's GBP account's statement must hold \[payment_in 5000, payment_out_hold -2000, agent_funding -1000\]; it holds \[payment_in 5000, agent_funding -1000\]/)
  })
}, 60_000)
