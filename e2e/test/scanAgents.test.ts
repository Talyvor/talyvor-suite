import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { scanAgents } from '../src/scanAgents.ts'
import { LensClient } from '../src/lens.ts'
import type { ScenarioCtx, Verdict } from '../src/scenarios.ts'

// B52.28 — scan-agents against the stub Lens (selftest/stub-scan.ts), the app's half left out: it passes on a Lens that keeps a
// watch's measure and scores a hit only inside its range, and FAILs on one that drops the z or calls an outcome outside a hit.

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
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'scan-agents', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'scan-agents')
  const [user] = await lens.createUsers(1)
  return scanAgents({ screen: false }).run({ app: { user }, env: { lens }, evidence: [] } as unknown as ScenarioCtx)
}

describe('scan-agents (B52.28)', () => {
  it('passes on a Lens that keeps the measure and scores by the range', async () => {
    const verdict = await runOnStub('')
    expect(verdict.detail).toBe('a watch on gie.agsi.de.full past 2.5 standard deviations read back as set and stopped; 2 track-record reports, 1 hits and 0 misses, each scored by its range')
    expect(verdict.pass).toBe(true)
  })

  it('FAILs when a z watch is stored as a range watch', async () => {
    const verdict = await runOnStub('scan-watch-z-dropped')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/must read back as the owner set it/)
  })

  it('FAILs when an outcome outside its range reads as a hit', async () => {
    const verdict = await runOnStub('scan-track-hit-outside')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/report 1 reads a hit with outcome 26100 against its range 20000–25000/)
  })
}, 60_000)
