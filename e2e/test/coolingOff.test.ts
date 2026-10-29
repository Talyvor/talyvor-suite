import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { payeeCoolingOff } from '../src/coolingOff.ts'
import { LensClient } from '../src/lens.ts'
import type { ScenarioCtx, Verdict } from '../src/scenarios.ts'
import type { Post } from '../src/security.ts'

// B41.11 — payee-cooling-off against the stub Lens (selftest/stub-payees.ts), the web app's BFF calls sent to the Lens routes
// the BFF relays them to: it passes on a Lens that holds a large first payment to a new payee until the owner signs "I called
// them", and FAILs on one that pays it at once.

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

async function runOnStub(broken: string): Promise<Verdict> {
  const port = await freePort()
  stub = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', new URL('../selftest/stub-lens.ts', import.meta.url).pathname], {
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'cooling-off', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'cooling-off')
  const [user] = await lens.createUsers(1)
  return payeeCoolingOff(toLens).run({ app: { user }, env: { lens }, evidence: [] } as unknown as ScenarioCtx)
}

describe('payee-cooling-off (B41.11)', () => {
  it('passes on a Lens that holds the first large payment until the owner signs "I called them"', async () => {
    const verdict = await runOnStub('')
    expect(verdict.detail).toMatch(/^the GBP 2,000.00 payment to .* was refused for its 24-hour cooling-off and nothing moved; "I called them" unsigned was refused \(403\); signed, .* the account 100000 minor$/)
    expect(verdict.pass).toBe(true)
  })

  it('FAILs when a large payment to a payee saved moments ago is paid at once', async () => {
    const verdict = await runOnStub('cooling-off-skipped')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^a GBP 2,000.00 payment to a payee saved moments ago must be refused 409 for its cooling-off; Lens answered 201/)
  })
}, 60_000)
