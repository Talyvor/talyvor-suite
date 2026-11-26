import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterAll, describe, expect, it } from 'vitest'
import { LensClient } from '../src/lens.ts'
import { moneyMandates } from '../src/moneyMandates.ts'
import type { ScenarioCtx, Verdict } from '../src/scenarios.ts'

// B30.128 — money-mandates against the stub Lens (selftest/stub-payees.ts), which serves an outside business's pulls on its
// mandate's key: it passes when each pull within both maxima moves the agent's account into the mandate's hold and is paid
// out, a retry moves nothing, and the pulls over the monthly maximum and on the revoked mandate are refused with nothing
// moved; it FAILs when Lens posts a pull over the monthly maximum.

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
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'money-mandates', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  stubs.push(stub)
  await new Promise<void>((resolve, reject) => {
    stub.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'money-mandates')
  const [user] = await lens.createUsers(1)
  return moneyMandates().run({ app: { user }, env: { lens }, evidence: [] } as unknown as ScenarioCtx)
}

describe('money-mandates (B30.128)', () => {
  it.concurrent('passes when pulls within both maxima move the money once and the ones over the month or after the revoke move nothing', async () => {
    const v = await onStub('')
    expect(v.detail).toMatch(/^on its key the business pulled £20\.00 twice from Mandates \d+'s GBP account, each one entry into the mandate's hold paid out to the saved payee, the account 6000 → 4000 → 2000; the retry under the same key answered the same entry and moved nothing; a third £20\.00 over the £50\.00 monthly maximum was refused 403 and, revoked, a pull 409, the account still 2000; Lens records it revoked with £40\.00 pulled this month$/)
    expect(v.pass).toBe(true)
  })

  it.concurrent('FAILs when Lens posts a pull over the monthly maximum', async () => {
    const v = await onStub('mandate-month-ignored')
    expect(v.pass).toBe(false)
    expect(v.detail).toContain('a third £20.00, £60.00 this month over the £50.00 maximum, must be refused 403 naming the monthly maximum; Lens answered 201')
  })
}, 60_000)
