import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { alertChannels } from '../src/alertChannels.ts'
import { LensClient } from '../src/lens.ts'
import type { ScenarioCtx, Verdict } from '../src/scenarios.ts'

// B28.66 — alert-channels against the stub Lens (selftest/stub-payees.ts), the app's half left out: it passes on a Lens that
// queues each alert once to every channel, and FAILs on one that queues it to the first channel only.

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
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'alert-channels', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'alert-channels')
  const [user] = await lens.createUsers(1)
  return alertChannels({ screen: false }).run({ app: { user }, env: { lens }, evidence: [] } as unknown as ScenarioCtx)
}

describe('alert-channels (B28.66)', () => {
  it('passes on a Lens that queues each alert once to every channel', async () => {
    const verdict = await runOnStub('')
    expect(verdict.detail).toBe('2 alerts × 2 channels: first read: 4 deliveries (queued, queued, queued, queued); second read: 4 deliveries (queued, queued, queued, queued); email refused')
    expect(verdict.pass).toBe(true)
  })

  it('FAILs when an alert is queued to the first channel only', async () => {
    const verdict = await runOnStub('alert-delivery-once')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/must be queued exactly once to channel ach_.*read a first time, Lens lists it 0 times/)
  })
}, 60_000)
