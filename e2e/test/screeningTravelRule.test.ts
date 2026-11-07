import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { LensClient } from '../src/lens.ts'
import type { Evidence, ScenarioCtx, Verdict } from '../src/scenarios.ts'
import { screeningTravelRule, selfHostedKey, signerOf } from '../src/screeningTravelRule.ts'

// B48.27 — screening-travel-rule against the stub Lens (selftest/stub-payees.ts), which screens and applies the Travel Rule to an agent's
// USDC payments as Lens B48.7 does with B48.31's test addresses: it passes there, and FAILs when the flagged address is paid
// (STUB_BREAK=address-unscreened) or a self-hosted address is paid past 1,000 USDC unproved (STUB_BREAK=self-hosted-unproved).

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
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'str-key', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'str-key')
  const [user] = await lens.createUsers(1)
  const evidence: Evidence[] = []
  const ctx = { env: { lens }, app: { user }, evidence } as unknown as ScenarioCtx
  return { verdict: await screeningTravelRule().run(ctx), evidence }
}

describe('screening-travel-rule (B48.27)', () => {
  it("signs a proof message as a wallet's personal_sign, recovered to its own address and no other", () => {
    const k = selfHostedKey()
    expect(signerOf('proof', k.sign('proof'))).toBe(k.address)
    expect(signerOf('other', k.sign('proof'))).not.toBe(k.address)
  })

  it("passes on a Lens that screens an agent's USDC payments by address and applies the Travel Rule", async () => {
    const { verdict, evidence } = await runAgainstStub('')
    expect(verdict).toMatchObject({ pass: true })
    expect(evidence.find((e) => e.note?.includes('not yet proved'))?.answer).toMatch(/^409 .*more than 1,000 USDC in all to a self-hosted address/)
  })

  it('FAILs when the flagged address is paid', async () => {
    const { verdict } = await runAgainstStub('address-unscreened')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^a payment to a flagged address must be refused 403 with nothing held; Lens answered 201 .* holds went from 1 to 2$/)
  })

  it('FAILs when more than 1,000 USDC goes to a self-hosted address without the proof', async () => {
    const { verdict } = await runAgainstStub('self-hosted-unproved')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^more than 1000 USDC to a self-hosted address not proved must answer 409 with nothing held; Lens answered 201 /)
  })
}, 60_000)
