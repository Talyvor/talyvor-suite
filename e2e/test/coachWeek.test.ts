import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { coachWeek } from '../src/coachWeek.ts'
import { LensClient } from '../src/lens.ts'
import type { ScenarioCtx, Verdict } from '../src/scenarios.ts'

// B53.14 — coach-week against the stub Lens (selftest/stub-payees.ts), the funding invoice paid through the stub's own card
// checkout: it passes on a Lens whose Coach keeps only sentences that pass its validator, and FAILs when that is bypassed.

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

async function runOnStub(broken: string): Promise<Verdict> {
  const port = await freePort()
  const base = `http://127.0.0.1:${port}`
  stub = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', new URL('../selftest/stub-lens.ts', import.meta.url).pathname], {
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'coach-week', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(base, 'coach-week')
  const [user] = await lens.createUsers(1)
  const byCard = async (_: ScenarioCtx, token: string) => {
    const { url } = await (await fetch(`${base}/v1/pay/${token}/card`, { method: 'POST' })).json() as { url: string }
    const paid = await fetch(url, { method: 'POST', redirect: 'manual', body: new URLSearchParams({ card: '4242 4242 4242 4242' }) })
    return paid.status === 303 ? undefined : `the stub checkout answered ${paid.status}`
  }
  return coachWeek(byCard).run({ app: { user }, env: { lens }, evidence: [] } as unknown as ScenarioCtx)
}

describe('coach-week (B53.14)', () => {
  it('passes on a Lens whose Coach sentences pass its validator', async () => {
    const verdict = await runOnStub('')
    expect(verdict.detail).toMatch(/^6 card payments in their categories .*the second Tesco a duplicate and Lisbon a new country; \d+ Coach sentences passed the validator; a loan question got StepChange, National Debtline, MoneyHelper and no product$/)
    expect(verdict.pass).toBe(true)
  })

  it('FAILs when the Coach validator is bypassed', async () => {
    const verdict = await runOnStub('coach-validator-bypassed')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/model sentence for its duplicate line must pass its validator, but it says 48\.00/)
  })
}, 60_000)
