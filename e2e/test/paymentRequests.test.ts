import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { LensClient } from '../src/lens.ts'
import type { Evidence, ScenarioCtx, Verdict } from '../src/scenarios.ts'
import { paymentRequestBatch } from '../src/paymentRequests.ts'

// B40.27 — payment-request-batch against the stub Lens (selftest/stub-payment-requests.ts), which judges a prepared batch
// against the saved payees and the signed mandate as Lens does: it passes, and FAILs when the same Idempotency-Key with a
// changed amount is taken as a new request.

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
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'request-key', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'request-key')
  const evidence: Evidence[] = []
  const ctx = { env: { lens }, evidence } as unknown as ScenarioCtx
  return { verdict: await paymentRequestBatch().run(ctx), evidence }
}

describe('payment-request-batch (B40.27)', () => {
  it('passes on a Lens that judges the batch, keeps its key and moves no money', async () => {
    const { verdict, evidence } = await runAgainstStub('')
    expect(verdict).toMatchObject({ pass: true })
    expect(evidence.find((e) => e.note === 'chat prepares £90 to the plumber with an iban in the arguments')?.answer).toMatch(/^refused 400: .*payee details supplied by the assistant \(iban\)/)
  })

  // B17.302 — the stub refuses an account until currency_accounts' terms are accepted, as Lens does; the scenario accepts them first.
  it("accepts the accounts terms before it opens the GBP account", async () => {
    const { evidence } = await runAgainstStub('')
    const notes = evidence.map((e) => e.note)
    expect(notes.indexOf("the owner accepts currency_accounts's terms")).toBeGreaterThan(-1)
    expect(notes.indexOf("the owner accepts currency_accounts's terms")).toBeLessThan(notes.indexOf('the owner opens a GBP account on test money'))
    expect(evidence.find((e) => e.note === 'the owner opens a GBP account on test money')?.answer).toMatch(/^201/)
  })

  it('FAILs when an acceptance is recorded nowhere, so Lens still refuses the account', async () => {
    const { verdict } = await runAgainstStub('terms-accept-ignored')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^opening a GBP account must answer 201; Lens answered refused 403: .*needs its terms accepted/)
  })

  it('FAILs when the same key with a changed amount is accepted', async () => {
    const { verdict } = await runAgainstStub('payment-request-key-reused')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^the same key with a changed amount must answer 409; Lens answered 201 /)
  })
}, 60_000)
