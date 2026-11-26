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
// charges it again on the retry. B30.133: the payer's agent is funded through a signed payment in quoting its payment
// reference; the scenario FAILs when the money lands in the company's account instead, and when Lens marks the invoice
// paid by a funded agent without moving the money. B30.134: under a monthly limit below the invoice the funded payer is
// refused 403 and nothing moves; the scenario FAILs when Lens pays it anyway, and when the refusal still takes the money.

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

const MONEY_SECRET = 'invoice-money-secret'

async function runAgainstStub(broken: string, moneyWebhookSecret = MONEY_SECRET): Promise<{ verdict: Verdict; evidence: Evidence[] }> {
  const port = await freePort()
  stub = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', new URL('../selftest/stub-lens.ts', import.meta.url).pathname], {
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'invoice-key', STUB_BREAK: broken, STUB_MONEY_WEBHOOK_SECRET: MONEY_SECRET },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'invoice-key')
  const evidence: Evidence[] = []
  // The rate stub-lens.ts states at /v1/public/fees, as the run reads it once (B35.7).
  const ctx = { env: { lens, fees: { merchant_a2a_fee_bps: 100 }, moneyWebhookSecret }, evidence } as unknown as ScenarioCtx
  return { verdict: await invoicePayLink().run(ctx), evidence }
}

describe('invoice-pay-link (B30.130, B56.28, B30.134)', () => {
  it('passes on a Lens that sends the invoice, serves its pay page to anyone, refuses an unfunded payer and charges a paid one\'s issuer its fee once', async () => {
    const { verdict, evidence } = await runAgainstStub('')
    expect(verdict.detail).toBe("a GBP invoice of £145.00 (two lines, 20% VAT on one) issued from the agent's account and sent, with a number, a reference and a pay link; " +
      "its pay page read with no credential, with no notice and no transfer to the Test partner's details, naming no issuer id; " +
      "another company's agent holding £0.00 refused 409; the invoice still sent with £145.00 due and no payment, both agents' accounts still 0; " +
      'funded with £145.00 through a payment in quoting its payment reference; under a monthly limit of £100.00 refused 403 naming it, nothing moved; ' +
      'the limit raised to £200.00, the agent paid it twice and was taken once; ' +
      "the issuer charged one acceptance_fee of 145 minor (1%), shown as the payment's fee_minor, its agent account holding 14355")
    expect(verdict.pass).toBe(true)
    expect(evidence.find((e) => e.note?.includes('payment in of 14500'))?.answer).toBe('200 ')
    expect(evidence.find((e) => e.note?.includes('issues and sends'))?.answer).toMatch(/^201 .*"number":"INV-000001"/)
    expect(evidence.find((e) => e.note?.includes('no credential'))?.answer).toMatch(/^200 \{"card":/)
    expect(evidence.find((e) => e.note?.includes('empty GBP account'))?.answer).toMatch(/^refused 409: .*holds GBP 0\.00/)
  })

  it('without the sandbox webhook secret, funds the payer with test money and says so', async () => {
    const { verdict } = await runAgainstStub('', '')
    expect(verdict.pass).toBe(true)
    expect(verdict.detail).toContain('funded with £145.00 of test money (LENS_MONEY_SANDBOX_WEBHOOK_SECRET not given, so not through a payment in)')
  })

  it("FAILs when a payment in quoting an agent's payment reference lands in the company's account", async () => {
    const { verdict } = await runAgainstStub('payment-in-unrouted')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toContain("the agent's must hold 14500 and the company's 0; they hold 0 and 14500")
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

  it('FAILs when Lens marks an invoice paid by a funded agent without moving the money', async () => {
    const { verdict } = await runAgainstStub('invoice-paid-unmoved')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toContain("the issuer's agent account holds the total less the fee, 14355; it holds 0")
    expect(verdict.detail).toContain("the payer's agent account paid all it held and holds 0; it holds 14500")
  })

  it("FAILs when Lens pays an invoice the payer's rules refuse (B30.134)", async () => {
    const { verdict } = await runAgainstStub('invoice-rules-ignored')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toContain("an invoice of £145.00 over the payer's agent's monthly limit of £100.00 must be refused 403 naming the limit; Lens answered 200")
  })

  it('FAILs when a payment the rules refuse still takes the money (B30.134)', async () => {
    const { verdict } = await runAgainstStub('invoice-refused-moved')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toContain("after a payment its rules refused, the payer's agent account must still hold 14500 test and 0 live; it reads")
  })
}, 60_000)
