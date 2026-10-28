import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { LensClient } from '../src/lens.ts'
import type { Evidence, ScenarioCtx, Verdict } from '../src/scenarios.ts'
import { agentWalletKinds } from '../src/agentWalletKinds.ts'

// B48.23 — agent-wallet-kinds against the stub Lens, which serves B48.1's routes (selftest/stub-bank.ts): it passes on a Lens
// that refuses to close a wallet holding money, and FAILs when that refusal is removed (STUB_BREAK=wallet-kind-closes-full).
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
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'wallet-kinds', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(base, 'wallet-kinds')
  const [user] = await lens.createUsers(1)
  const evidence: Evidence[] = []
  const ctx = { env: { lens }, app: { user }, evidence } as unknown as ScenarioCtx
  const byCard = async (_: ScenarioCtx, token: string) => {
    const { url } = await (await fetch(`${base}/v1/pay/${token}/card`, { method: 'POST' })).json() as { url: string }
    const paid = await fetch(url, { method: 'POST', redirect: 'manual', body: new URLSearchParams({ card: '4242 4242 4242 4242' }) })
    return paid.status === 303 ? undefined : `the stub checkout answered ${paid.status}`
  }
  return { verdict: await agentWalletKinds(byCard).run(ctx), evidence }
}

describe('agent-wallet-kinds (B48.23)', () => {
  it('passes on a Lens whose agents own one wallet of each kind and which keeps a funded wallet open', async () => {
    const { verdict, evidence } = await runAgainstStub('')
    expect(verdict).toMatchObject({ pass: true })
    expect(evidence.find((e) => e.note === 'the owner makes the funded fiat agent crypto')?.answer).toMatch(/^refused 409: /)
    expect(evidence.filter((e) => e.note?.startsWith('the owner archives agent ')).length).toBe(3)
  })

  it('FAILs when removing a kind closes the wallet with its money in it', async () => {
    const { verdict } = await runAgainstStub('wallet-kind-closes-full')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/must answer 409; Lens answered 200 .*not still open holding 2500 minor/)
  })
}, 60_000)
