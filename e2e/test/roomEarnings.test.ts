import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { LensClient } from '../src/lens.ts'
import type { Evidence, ScenarioCtx, Verdict } from '../src/scenarios.ts'
import { roomEarnings } from '../src/roomEarnings.ts'

// B46.21 — room-earnings-payout against the stub Lens (selftest/stub-earnings.ts): it passes on a Lens that pays a Room's split
// once, held for the member without verified details, and FAILs when the same payout again pays everyone a second time.
// The room wallet's funding invoice is paid through the stub's own card checkout, as the pay page's browser would.

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
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'room-earnings', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(base, 'room-earnings')
  const [user] = await lens.createUsers(1, 'team')
  const evidence: Evidence[] = []
  const ctx = { env: { lens }, app: { user }, evidence } as unknown as ScenarioCtx
  const byCard = async (_: ScenarioCtx, token: string) => {
    const { url } = await (await fetch(`${base}/v1/pay/${token}/card`, { method: 'POST' })).json() as { url: string }
    const paid = await fetch(url, { method: 'POST', redirect: 'manual', body: new URLSearchParams({ card: '4242 4242 4242 4242' }) })
    return paid.status === 303 ? undefined : `the stub checkout answered ${paid.status}`
  }
  return { verdict: await roomEarnings(byCard).run(ctx), evidence }
}

describe('room-earnings-payout (B46.21)', () => {
  it("passes on a Lens that pays a Room's equal split once, the member without verified details held", async () => {
    const { verdict } = await runAgainstStub('')
    expect(verdict).toMatchObject({ pass: true })
    expect(verdict.detail).toMatch(/as 334 completed, 333 completed, 333 held under "room \S+ terms v1 equal"; the wallet's account 1000 → 0 minor/)
  })

  it('FAILs when the same payout again pays the split a second time', async () => {
    const { verdict } = await runAgainstStub('room-payout-twice')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/the same payout again changed the rows/)
  })
}, 60_000)
