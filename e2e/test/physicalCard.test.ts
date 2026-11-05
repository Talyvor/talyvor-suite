import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { physicalCard } from '../src/physicalCard.ts'
import { LensClient } from '../src/lens.ts'
import type { ScenarioCtx, Verdict } from '../src/scenarios.ts'

// B53.12 — physical-card against the stub Lens (selftest/stub-physical-cards.ts), the app's half left out: with the switch off
// it passes on Lens's 404s; on, it passes the order, ship, activate and replace, and FAILs on a lost card left active.

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

async function runOnStub(on: boolean, broken: string): Promise<Verdict> {
  const port = await freePort()
  stub = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', new URL('../selftest/stub-lens.ts', import.meta.url).pathname], {
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'physical-card', STUB_BREAK: broken, STUB_PHYSICAL_CARDS: on ? 'on' : '' },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'physical-card')
  const [user] = await lens.createUsers(1)
  return physicalCard({ screen: false }).run({ app: { user }, env: { lens }, evidence: [] } as unknown as ScenarioCtx)
}

describe('physical-card (B53.12)', () => {
  it('passes with nothing served while the switch is off', async () => {
    expect(await runOnStub(false, '')).toEqual({ pass: true, detail: 'the switch is off: Lens answers 404 to a read and an order' })
  })

  it('passes order, ship, activate and replace with the switch on', async () => {
    const verdict = await runOnStub(true, '')
    expect(verdict.detail).toMatch(/^ordered \(a bad postcode refused 422\).*reported lost: card ending \d{4} frozen, card ending \d{4} on its way to the same address$/)
    expect(verdict.pass).toBe(true)
  })

  it('FAILs when a lost card stays active', async () => {
    const verdict = await runOnStub(true, 'card-replace-unfrozen')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/must be frozen at once; Lens reads it active/)
  })
}, 60_000)
