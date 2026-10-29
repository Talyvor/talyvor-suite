import { type ChildProcess, spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { LensClient } from '../src/lens.ts'
import type { ScenarioCtx, Verdict } from '../src/scenarios.ts'
import { agentResumeSigned, approvalOwnRequest, type Decide, ORIGIN_EXEMPT, passkeyEnrolSigned, type Post, writeRoutes } from '../src/security.ts'

// B50.7 — csrf-every-write sends one cross-site write to every write route the BFF registers.
describe('the BFF write routes csrf-every-write attacks (B50.7)', () => {
  it('are every writing registration in apps/bff lens.go, ids filled in, and no read', () => {
    const routes = writeRoutes(readFileSync(new URL('../../apps/bff/lens.go', import.meta.url), 'utf8'))
    const named = routes.map((r) => `${r.method} ${r.path}`)
    expect(routes.length).toBeGreaterThan(20)
    expect(named).toContain('POST /api/keys')
    expect(routes.every((r) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(r.method) && !r.path.includes('{'))).toBe(true)
    expect(writeRoutes('mux.HandleFunc("GET /api/context", a.handleContext)\nmux.HandleFunc("DELETE /api/keys/{id}", a.del)')).toEqual([{ method: 'DELETE', path: '/api/keys/b507' }])
    expect(ORIGIN_EXEMPT.has('/mcp')).toBe(true)
  })
})

// B50.19 — approval-own-request against the stub Lens (selftest/stub-bank.ts), deciding through Lens's approve route where the
// nightly taps Approvals: it passes on a Lens that approves only the request tapped, and FAILs when an approval also
// approves its look-alike or when "always allow" lets the waiting one through.
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

const byAPI: Decide = async (ctx, memo, allowLXC) => {
  const a = (await ctx.env.lens.agentApprovals(ctx.app.user)).find((x) => x.memo === memo && x.status === 'pending')
  const got = await ctx.env.lens.act(ctx.app.user, 'POST', `/v1/workspaces/{ws}/agents/approvals/${a?.id}/approve`,
    allowLXC === undefined ? {} : { always_allow: { amount_ulxc: allowLXC * 1e6, per: 'month' } })
  return got.ok ? 'Approved' : `refused ${got.status}`
}

async function onStub(broken: string): Promise<ScenarioCtx> {
  const port = await freePort()
  stub = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', new URL('../selftest/stub-lens.ts', import.meta.url).pathname], {
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'approval-own', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'approval-own')
  const [user] = await lens.createUsers(1)
  return { app: { user }, env: { lens }, evidence: [] } as unknown as ScenarioCtx
}

const ownRequestOn = async (broken: string): Promise<Verdict> => approvalOwnRequest(byAPI).run(await onStub(broken))

describe('approval-own-request (B50.19)', () => {
  it('passes on a Lens that approves only the request tapped, before and after always allow', async () => {
    const verdict = await ownRequestOn('')
    expect(verdict.detail).toMatch(/^A approved on Approvals paid; .* holds 300000 twice, nothing of B's$/)
    expect(verdict.pass).toBe(true)
  })

  it('FAILs when approving one also approves its look-alike', async () => {
    const verdict = await ownRequestOn('approval-approves-alike')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^after A was approved, B sent again was paid: /)
  })

  it('FAILs when always allow lets the waiting one through', async () => {
    const verdict = await ownRequestOn('allow-releases-waiting')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^after C was approved with always allow, B sent again was paid: /)
  })
}, 60_000)

// B50.22 — passkey-enrol-signed against the stub Lens, sending the web app's BFF calls straight to the Lens routes the BFF
// relays them to: it passes on a Lens that wants a second passkey signed by the first, and FAILs on one that does not.
const toLens: Post = async (ctx, path, body) => {
  const lensPath = path.replace(/^\/api\/agents\//, '/v1/workspaces/{ws}/agents/').replace(/\/resume-challenge$/, '/resume/challenge') // as the BFF relays it
  const got = await ctx.env.lens.act(ctx.app.user, 'POST', lensPath, body as object)
  return { status: got.status, text: got.ok ? JSON.stringify(got.value) : JSON.stringify({ error: got.error }) }
}

describe('passkey-enrol-signed (B50.22)', () => {
  it('passes on a Lens that registers a second passkey only signed by the first', async () => {
    const verdict = await passkeyEnrolSigned(toLens).run(await onStub(''))
    expect(verdict.detail).toMatch(/^passkey B with no signature refused and not listed; .* the payment landed once \(200000 µLXC\)$/)
    expect(verdict.pass).toBe(true)
  })

  it('FAILs when a second passkey registers with no signature', async () => {
    const verdict = await passkeyEnrolSigned(toLens).run(await onStub('enrol-unsigned'))
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^passkey B with no signature answered 201, not a refusal; passkey B, sent with no signature, is listed on the workspace; an approval signed by the refused passkey B answered 200/)
  })
}, 60_000)

// B41.8 — agent-resume-signed against the stub Lens, the web app's BFF calls sent to the Lens routes the BFF relays them
// to: it passes on a Lens that resumes only signed, and FAILs on one that lets an unsigned resume through.
describe('agent-resume-signed (B41.8)', () => {
  it('passes on a Lens that pauses unsigned and resumes only signed', async () => {
    const verdict = await agentResumeSigned(toLens).run(await onStub(''))
    expect(verdict.detail).toMatch(/^pausing .* took no signature; unsigned, both resumes were refused, .* the payment landed once \(150000 µLXC\)$/)
    expect(verdict.pass).toBe(true)
  })

  it('FAILs when an unsigned resume starts the agent again', async () => {
    const verdict = await agentResumeSigned(toLens).run(await onStub('resume-unsigned'))
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^resuming Resume payer .* with no signature answered 200, not a refusal; after an unsigned resume, the book no longer reads/)
  })
}, 60_000)
