import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { LensClient } from '../src/lens.ts'
import type { Evidence, ScenarioCtx, Verdict } from '../src/scenarios.ts'
import { batchApproval } from '../src/batchApproval.ts'

// B40.29 — batch-approval-pays-once against the stub Lens (selftest/stub-payment-requests.ts), which pays an approved batch from
// the agent's account as Lens does: it passes on a Lens that refuses a replayed approval, and FAILs when a replay pays again.
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
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'batch-approval', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(base, 'batch-approval')
  const [user] = await lens.createUsers(1)
  const evidence: Evidence[] = []
  const ctx = { env: { lens }, app: { user }, evidence } as unknown as ScenarioCtx
  const byCard = async (_: ScenarioCtx, token: string) => {
    const { url } = await (await fetch(`${base}/v1/pay/${token}/card`, { method: 'POST' })).json() as { url: string }
    const paid = await fetch(url, { method: 'POST', redirect: 'manual', body: new URLSearchParams({ card: '4242 4242 4242 4242' }) })
    return paid.status === 303 ? undefined : `the stub checkout answered ${paid.status}`
  }
  return { verdict: await batchApproval(byCard).run(ctx), evidence }
}

describe('batch-approval-pays-once (B40.29)', () => {
  it('passes on a Lens that pays an approved batch once and refuses the replay', async () => {
    const { verdict, evidence } = await runAgainstStub('')
    expect(verdict).toMatchObject({ pass: true })
    expect(evidence.find((e) => e.note === 'the owner sends the same approval again')?.answer).toMatch(/^refused 409: /)
  })

  it('FAILs when a replayed approval pays again', async () => {
    const { verdict } = await runAgainstStub('batch-approval-replay-pays')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^the replayed approval must answer 409; Lens answered 200 .*; the replayed approval moved money: 2 → 4 payments out/)
  })
}, 60_000)
