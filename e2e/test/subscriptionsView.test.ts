import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { subscriptionsView } from '../src/subscriptionsView.ts'
import { LensClient } from '../src/lens.ts'
import type { ScenarioCtx, Verdict } from '../src/scenarios.ts'

// B41.20 — subscriptions-view against the stub Lens (selftest/stub-bank.ts), the app's half left out: it passes on a Lens that
// holds a monthly standing order and a renewing listing subscription billed once, and FAILs on one whose subscription does not renew.

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
  stub = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', new URL('../selftest/stub-lens.ts', import.meta.url).pathname], {
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'subscriptions-view', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'subscriptions-view')
  const [user] = await lens.createUsers(1)
  return subscriptionsView({ screen: false }).run({ app: { user }, env: { lens }, evidence: [] } as unknown as ScenarioCtx)
}

describe('subscriptions-view (B41.20)', () => {
  it('passes on a Lens that holds the standing order and a renewing subscription billed once', async () => {
    const verdict = await runOnStub('')
    expect(verdict.detail).toMatch(/^the standing order next pays .+, the subscription renews .+, billed once$/)
    expect(verdict.pass).toBe(true)
  })

  it('FAILs when a monthly subscription does not renew', async () => {
    const verdict = await runOnStub('subscribe-not-renewing')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/must read active and renewing/)
  })

  it('FAILs when a subscription taken today reads idle (B41.76)', async () => {
    const verdict = await runOnStub('fresh-licence-idle')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/must not read idle/)
  })
}, 60_000)
