import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterAll, describe, expect, it } from 'vitest'
import { LensClient } from '../src/lens.ts'
import { payeeByName } from '../src/payeeByName.ts'
import type { ScenarioCtx, Verdict } from '../src/scenarios.ts'

// B17.534 — pay-payee-by-name against the stub Lens (selftest/stub-payees.ts): it passes when a saved payee paid by its name
// writes the same entry as paying it by id, and FAILs on a Lens without B28.346, which does not read payee_name.

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
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'pay-payee-by-name', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  stubs.push(stub)
  await new Promise<void>((resolve, reject) => {
    stub.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'pay-payee-by-name')
  const [user] = await lens.createUsers(1)
  return payeeByName().run({ app: { user }, env: { lens }, evidence: [] } as unknown as ScenarioCtx)
}

describe('pay-payee-by-name (B17.534)', () => {
  it.concurrent('passes when a payee paid by its name writes the same entry as paying it by id, and a part of a name or a shared one moves nothing', async () => {
    const v = await onStub('')
    expect(v.detail).toMatch(/^£20\.00 to Nightly Paid By Name \d+ Ltd by its id and by " {2}nightly {3}paid .* ltd " each completed to payee_\S+ with the same entry \[hold \S+ -2000 GBP; partner \S+ 2000 GBP\] and statement lines \[payment_out_hold -2000\], the account £100\.00 → £60\.00; "Nightly Paid By" was refused 404 and Nightly Shared Name \d+ Ltd 409, nothing moved$/)
    expect(v.pass).toBe(true)
  })

  it.concurrent('FAILs on a Lens that does not read payee_name (B28.346 taken away)', async () => {
    const v = await onStub('payee-name-unread')
    expect(v.pass).toBe(false)
    expect(v.detail).toMatch(/^£20\.00 paid to Nightly Paid By Name \d+ Ltd by name must answer 201 completed; Lens answered 400 "economy: invalid payment: a payment names its payee/)
  })
}, 60_000)
