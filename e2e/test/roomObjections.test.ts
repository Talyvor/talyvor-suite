import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { LensClient } from '../src/lens.ts'
import { roomObjections } from '../src/roomObjections.ts'
import type { Evidence, ScenarioCtx, Verdict } from '../src/scenarios.ts'

// B41.47 — room-objections against the stub Lens (selftest/stub-rooms.ts): it passes on a Lens that seats three members
// linked to neither side and writes an upheld objection's row; it FAILs when the panel ignores a shared card, and when an
// upheld objection changes no points.

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
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'objections-key', STUB_MODERATOR_KEY: 'tlv_mod_objections', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'objections-key', undefined, undefined, undefined, 'tlv_mod_objections')
  const [user] = await lens.createUsers(1)
  const evidence: Evidence[] = []
  const ctx = { app: { user }, env: { lens }, evidence } as unknown as ScenarioCtx
  return { verdict: await roomObjections(4).run(ctx), evidence }
}

describe('room-objections (B41.47)', () => {
  it('passes on a Lens that seats three members linked to neither side and writes an upheld objection row', async () => {
    const { verdict, evidence } = await runAgainstStub('')
    expect(verdict.pass).toBe(true)
    expect(evidence.map((e) => e.note).join('\n')).toMatch(/the ledger after: .*"reason":"objection"/)
  })

  it('FAILs when the panel is drawn ignoring a card shared with the author', async () => {
    const { verdict } = await runAgainstStub('room-objection-linked')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^Lens seated a panel when only two members are linked to neither side/)
  })

  it('FAILs when an upheld objection changes no points', async () => {
    const { verdict } = await runAgainstStub('room-objection-unwritten')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^the upheld objection wrote \[\]/)
  })
}, 60_000)
