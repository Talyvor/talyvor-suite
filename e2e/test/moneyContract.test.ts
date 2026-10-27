import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { LensClient } from '../src/lens.ts'
import type { Evidence, ScenarioCtx, Verdict } from '../src/scenarios.ts'
import { moneyLayerContract } from '../src/moneyContract.ts'

// B46.12 — money-layer-contract against the stub Lens, whose Test partner refuses an amount ending in 13 as Lens's sandbox does
// (selftest/stub-payees.ts): it passes on a Lens that releases a refused payment's hold, and FAILs when the money stays out.
// The funding invoice is paid through the stub's own card checkout, as the pay page's browser would.

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

async function runAgainstStub(broken: string): Promise<{ verdict: Verdict; evidence: Evidence[] }> {
  const port = await freePort()
  const base = `http://127.0.0.1:${port}`
  stub = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', new URL('../selftest/stub-lens.ts', import.meta.url).pathname], {
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'money-contract', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(base, 'money-contract')
  const [user] = await lens.createUsers(1)
  const evidence: Evidence[] = []
  const ctx = { env: { lens }, app: { user }, evidence } as unknown as ScenarioCtx
  const byCard = async (_: ScenarioCtx, token: string) => {
    const { url } = await (await fetch(`${base}/v1/pay/${token}/card`, { method: 'POST' })).json() as { url: string }
    const paid = await fetch(url, { method: 'POST', redirect: 'manual', body: new URLSearchParams({ card: '4242 4242 4242 4242' }) })
    return paid.status === 303 ? undefined : `the stub checkout answered ${paid.status}`
  }
  return { verdict: await moneyLayerContract(byCard).run(ctx), evidence }
}

describe('money-layer-contract (B46.12)', () => {
  it('passes on a Lens whose wallet, approval, single payment and refused payment keep the contract', async () => {
    const { verdict, evidence } = await runAgainstStub('')
    expect(verdict).toMatchObject({ pass: true })
    expect(evidence.find((e) => e.note === 'the owner sends the same approval again')?.answer).toMatch(/^refused 409: /)
  })

  it('FAILs when a payment the partner refused keeps its money out of the account', async () => {
    const { verdict } = await runAgainstStub('refused-payment-held')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/after the partner refused £20\.13 the agent's account holds 987 minor, not the 3000 it held before$/)
  })
}, 60_000)
