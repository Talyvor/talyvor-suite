import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { payeeDetailsLock } from '../src/payeeDetailsLock.ts'
import { LensClient } from '../src/lens.ts'
import type { ScenarioCtx, Verdict } from '../src/scenarios.ts'
import type { Post } from '../src/security.ts'

// B41.12 — payee-details-lock against the stub Lens (selftest/stub-payees.ts), the web app's BFF calls sent to the Lens routes
// the BFF relays them to: it passes on a Lens that changes a payee's bank details only with a passkey over them and holds
// payments to it for 24 hours after, and FAILs on one that pays it at once.

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

const toLens: Post = async (ctx, path, body) => {
  const lensPath = path.replace(/^\/api\/agents\//, '/v1/workspaces/{ws}/agents/').replace(/^\/api\/money\//, '/v1/money/') // as the BFF relays it
  const got = await ctx.env.lens.act(ctx.app.user, 'POST', lensPath, body as object)
  return { status: got.status, text: got.ok ? JSON.stringify(got.value) : JSON.stringify({ error: got.error }) }
}

async function runOnStub(broken: string, post: Post = toLens): Promise<Verdict> {
  const port = await freePort()
  stub = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', new URL('../selftest/stub-lens.ts', import.meta.url).pathname], {
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'details-lock', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'details-lock')
  const [user] = await lens.createUsers(1)
  return payeeDetailsLock(post).run({ app: { user }, env: { lens }, evidence: [] } as unknown as ScenarioCtx)
}

describe('payee-details-lock (B41.12)', () => {
  it('passes on a Lens that changes the details only with a passkey and holds the next payment', async () => {
    const verdict = await runOnStub('')
    expect(verdict.detail).toMatch(/^Nightly Details Joinery .*'s account number change was refused unsigned \(403\) and signed for other details \(403\); signed, it changed and a payment within 24 hours was held \(409\) and nothing moved, the account 250000 minor$/)
    expect(verdict.pass).toBe(true)
  })

  // B17.355 — production's clock ran ahead of the runner's, so held_until read a little more than 24 hours on.
  it('passes when Lens\'s clock is a second ahead of the runner\'s', async () => {
    const ahead: Post = async (ctx, path, body) => {
      const got = await toLens(ctx, path, body)
      if (!/\/details$/.test(path) || got.status !== 200) return got
      const p = JSON.parse(got.text) as Record<string, string>
      for (const k of ['checked_at', 'details_changed_at', 'held_until']) p[k] = new Date(Date.parse(p[k]) + 1000).toISOString()
      return { status: got.status, text: JSON.stringify(p) }
    }
    const verdict = await runOnStub('', ahead)
    expect(verdict.detail).toMatch(/signed, it changed and a payment within 24 hours was held \(409\)/)
    expect(verdict.pass).toBe(true)
  })

  it('FAILs when a payment to a payee whose details changed moments ago is paid', async () => {
    const verdict = await runOnStub('details-hold-skipped')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/must be refused 409 for the hold; Lens answered 201/)
  })
}, 60_000)
