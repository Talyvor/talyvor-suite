import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { LensClient, type SyntheticUser } from '../src/lens.ts'
import type { Evidence, ScenarioCtx, Verdict } from '../src/scenarios.ts'
import { ROLE_NAME, type Team, workspaceRoles } from '../src/workspaceRoles.ts'

// B17.540 — workspace-roles against the stub Lens (selftest/stub-second-approver.ts), which holds what each role may do as Lens
// B28.342 does: it passes there, FAILs on a Lens where a Viewer's fund moves the money (STUB_BREAK=role-viewer-funds), and SKIPs
// without the provisioning secret. Team and roles is the owner's own Lens routes here; the self-test presses the screen.

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

/** Team and roles on the Lens routes the BFF relays it to, its row in the screen's words. */
function onLens(lens: LensClient, user: SyntheticUser): Team {
  const ws = `/v1/workspaces/${user.workspaceID}/roles`
  return {
    give: async (email, role) => {
      const r = await lens.as(user.token, 'PUT', ws, { email, role })
      return { status: r.status, text: r.text }
    },
    row: async (email) => {
      const r = await lens.as(user.token, 'GET', ws)
      const got = (JSON.parse(r.text) as { items: { email: string; role: keyof typeof ROLE_NAME; signed_in: boolean }[] }).items.find((i) => i.email === email)
      return got === undefined ? undefined : `${got.email} ${got.signed_in ? 'Has signed in' : 'Hasn’t signed in yet'} ${ROLE_NAME[got.role]} Remove`
    },
    remove: async (email) => (await lens.as(user.token, 'DELETE', `${ws}?email=${encodeURIComponent(email)}`)).status,
    close: async () => undefined,
  }
}

async function runAgainstStub(broken: string, secret = 'provision-secret'): Promise<{ verdict: Verdict; evidence: Evidence[] }> {
  const port = await freePort()
  stub = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', new URL('../selftest/stub-lens.ts', import.meta.url).pathname], {
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'roles-key', STUB_PROVISION_SECRET: 'provision-secret', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'roles-key')
  const [user] = await lens.createUsers(1)
  const evidence: Evidence[] = []
  const ctx = { env: { lens, provisionSecret: secret }, app: { user }, evidence } as unknown as ScenarioCtx
  return { verdict: await workspaceRoles(async () => onLens(lens, user)).run(ctx), evidence }
}

describe('workspace-roles (B17.540)', () => {
  it("passes on a Lens where a Viewer's fund is refused and Finance's posts", async () => {
    const { verdict, evidence } = await runAgainstStub('')
    expect(verdict).toMatchObject({ pass: true })
    expect(evidence.find((e) => e.note?.startsWith('the Viewer funds'))?.answer).toMatch(/^403 .*fund lines 1 → 1/)
  })

  it("FAILs when a Viewer's fund moves the money", async () => {
    const { verdict } = await runAgainstStub('role-viewer-funds')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^a Viewer's fund must be refused 403 and write no posting; Lens answered 200/)
  })

  it('SKIPs without the provisioning secret', async () => {
    await expect(runAgainstStub('', '')).rejects.toThrow(/LENS_PROVISION_SECRET/)
  })
}, 60_000)
