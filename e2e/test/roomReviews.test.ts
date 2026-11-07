import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { LensClient } from '../src/lens.ts'
import { roomReviews } from '../src/roomReviews.ts'
import type { Evidence, ScenarioCtx, Verdict } from '../src/scenarios.ts'

// B41.44 — room-reviews against the stub Lens (selftest/stub-rooms.ts): it passes on a Lens that draws two plain members,
// never the author, refuses the author's own score and sets quality to the median; it FAILs when the author picks itself.

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
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'reviews-key', STUB_MODERATOR_KEY: 'tlv_mod_reviews', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'reviews-key', undefined, undefined, undefined, 'tlv_mod_reviews')
  const [user] = await lens.createUsers(1)
  const evidence: Evidence[] = []
  const ctx = { app: { user }, env: { lens }, evidence } as unknown as ScenarioCtx
  return { verdict: await roomReviews(4).run(ctx), evidence }
}

describe('room-reviews (B41.44)', () => {
  it('passes on a Lens that seats two plain members and sets quality to the median of their scores', async () => {
    const { verdict, evidence } = await runAgainstStub('')
    expect(verdict.pass).toBe(true)
    expect(evidence.map((e) => e.note).join('\n')).toMatch(/the author reads the reviews: .*"quality_bps":13000/)
  })

  it('FAILs when the author picks itself as a reviewer', async () => {
    const { verdict } = await runAgainstStub('room-review-pick')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^the reviewers seated are \["/)
  })
}, 60_000)
