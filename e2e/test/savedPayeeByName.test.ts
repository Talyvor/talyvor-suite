import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterAll, describe, expect, it } from 'vitest'
import { LensClient } from '../src/lens.ts'
import { savedPayeeByName } from '../src/savedPayeeByName.ts'
import type { ScenarioCtx, Verdict } from '../src/scenarios.ts'
import type { Post } from '../src/security.ts'

// B17.541 — pay-saved-payee-by-name against the stub Lens (selftest/stub-payees.ts), the web app's BFF calls sent to the Lens
// routes the BFF relays them to: it passes when a saved payee paid by its name writes the same entry as paying it by id, and
// FAILs on a BFF without B28.76, which dropped payee_name from a payment and its challenge on the way up.

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number }
      s.close(() => resolve(port))
    })
  })
}

const stubs: ChildProcess[] = []
afterAll(() => {
  for (const s of stubs) s.kill()
})

const toLens = (dropName: boolean): Post => async (ctx, path, body) => {
  const lensPath = path.replace(/^\/api\/agents\//, '/v1/workspaces/{ws}/agents/').replace(/^\/api\/money\//, '/v1/money/') // as the BFF relays it
  const sent = { ...(body as object) } as Record<string, unknown>
  if (dropName && /^\/api\/money\/payments/.test(path)) delete sent.payee_name
  const got = await ctx.env.lens.act(ctx.app.user, 'POST', lensPath, sent)
  return { status: got.status, text: got.ok ? JSON.stringify(got.value) : JSON.stringify({ error: got.error }) }
}

async function onStub(dropName: boolean): Promise<Verdict> {
  const port = await freePort()
  const stub = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', new URL('../selftest/stub-lens.ts', import.meta.url).pathname], {
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'pay-saved-payee-by-name', STUB_BREAK: '' },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  stubs.push(stub)
  await new Promise<void>((resolve, reject) => {
    stub.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'pay-saved-payee-by-name')
  const [user] = await lens.createUsers(1)
  return savedPayeeByName(toLens(dropName)).run({ app: { user }, env: { lens }, evidence: [] } as unknown as ScenarioCtx)
}

describe('pay-saved-payee-by-name (B17.541)', () => {
  it.concurrent('passes when a payee saved in the web app and paid there by its name writes the same entry as paying it by id', async () => {
    const v = await onStub(false)
    expect(v.detail).toMatch(/^£20\.00 to Nightly Saved By Name \d+ Ltd, saved in the web app, by its id and by " {2}NIGHTLY {2}SAVED .* LTD ", each signed with the passkey, completed to payee_\S+ with the same entry \[hold \S+ -2000 GBP; partner \S+ 2000 GBP\] and statement lines \[payment_out_hold -2000\], the account £100\.00 → £60\.00$/)
    expect(v.pass).toBe(true)
  })

  it.concurrent('FAILs on a BFF that drops payee_name (B28.76 taken away)', async () => {
    const v = await onStub(true)
    expect(v.pass).toBe(false)
    expect(v.detail).toMatch(/^£20\.00 paid to Nightly Saved By Name \d+ Ltd by the name " {2}NIGHTLY .* LTD " in the web app must answer 201 completed; it answered 400 .*a payment names its payee/)
  })
}, 60_000)
