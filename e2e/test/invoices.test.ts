import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { LensClient } from '../src/lens.ts'
import type { Evidence, ScenarioCtx, Verdict } from '../src/scenarios.ts'
import { invoicePayLink } from '../src/invoices.ts'

// B30.130 — invoice-pay-link against the stub Lens (selftest/stub-payees.ts), which pays an invoice from an agent's account
// only when it holds what is due: it passes when the unfunded payer is refused 409 and nothing moves, and FAILs when Lens
// marks the invoice paid without moving the money. B56.28: funded, the payer pays twice, and the issuer is charged its fee
// for accepting the payment once — the scenario FAILs on a Lens without B56.21, which charges none, and on one that
// charges it again on the retry.

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
  stub = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', new URL('../selftest/stub-lens.ts', import.meta.url).pathname], {
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'invoice-key', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'invoice-key')
  const evidence: Evidence[] = []
  // The rate stub-lens.ts states at /v1/public/fees, as the run reads it once (B35.7).
  const ctx = { env: { lens, fees: { merchant_a2a_fee_bps: 100 } }, evidence } as unknown as ScenarioCtx
  return { verdict: await invoicePayLink().run(ctx), evidence }
}

describe('invoice-pay-link (B30.130, B56.28)', () => {
  it('passes on a Lens that sends the invoice, serves its pay page to anyone, refuses an unfunded payer and charges a paid one\'s issuer its fee once', async () => {
    const { verdict, evidence } = await runAgainstStub('')
    expect(verdict.detail).toBe("a GBP invoice of £145.00 (two lines, 20% VAT on one) issued from the agent's account and sent, with a number, a reference and a pay link; " +
      "its pay page read with no credential, with no notice and no transfer to the Test partner's details, naming no issuer id; " +
      "another company's agent holding £0.00 refused 409; the invoice still sent with £145.00 due and no payment, both agents' accounts still 0; " +
      'funded with £145.00, the agent paid it twice and was taken once; the issuer charged one acceptance_fee of 145 minor (1%), ' +
      "shown as the payment's fee_minor, its agent account holding 14355")
    expect(verdict.pass).toBe(true)
    expect(evidence.find((e) => e.note?.includes('issues and sends'))?.answer).toMatch(/^201 .*"number":"INV-000001"/)
    expect(evidence.find((e) => e.note?.includes('no credential'))?.answer).toMatch(/^200 \{"card":/)
    expect(evidence.find((e) => e.note?.includes('empty GBP account'))?.answer).toMatch(/^refused 409: .*holds GBP 0\.00/)
  })

  it('FAILs on a Lens without B56.21, which charges the issuer no fee for accepting the payment', async () => {
    const { verdict } = await runAgainstStub('acceptance-fee-uncharged')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toContain("the issuer's agent account's statement holds exactly one acceptance_fee line of -145 (1% of 14500); it holds none")
    expect(verdict.detail).toContain('the invoice shows one agent payment of 14500 with fee_minor 145')
  })

  it('FAILs when a retried payment charges the fee again', async () => {
    const { verdict } = await runAgainstStub('acceptance-fee-twice')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/exactly one acceptance_fee line of -145 .*; it holds \[.*"amount_minor":-145.*"amount_minor":-145/)
  })

  it('FAILs when Lens marks an invoice paid without moving the money', async () => {
    const { verdict } = await runAgainstStub('invoice-paid-unmoved')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^paying an invoice from an account holding 0 must be refused 409; Lens answered 200 /)
  })
}, 60_000)
