import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { LensClient, type SyntheticUser } from '../src/lens.ts'
import { NO_TEAM, phoneTeamRoles } from '../src/phoneTeamRoles.ts'
import type { Evidence, ScenarioCtx, Verdict } from '../src/scenarios.ts'
import { ROLE_NAME, type Team } from '../src/workspaceRoles.ts'

// B17.552 — phone-team-roles against the stub Lens (selftest/stub-second-approver.ts): it passes there, FAILs on a Lens where a
// Viewer's fund moves the money (STUB_BREAK=role-viewer-funds), and FAILs when the phone's Settings draws no Your team, the
// feature taken away. Your team is the owner's own Lens routes here, as the phone's BFF relays them; the nightly presses the phone.

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

/** Your team on the Lens routes the BFF relays the phone's requests to, its row as the phone draws it. */
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
      return got === undefined ? undefined : `${got.email} ${got.signed_in ? 'Has signed in' : 'Hasn’t signed in yet'} ${ROLE_NAME[got.role]}`
    },
    remove: async (email) => (await lens.as(user.token, 'DELETE', `${ws}?email=${encodeURIComponent(email)}`)).status,
    close: async () => undefined,
  }
}

async function runAgainstStub(broken: string, phone: 'drawn' | 'none' = 'drawn'): Promise<{ verdict: Verdict; evidence: Evidence[] }> {
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
  const ctx = { env: { lens, provisionSecret: 'provision-secret' }, app: { user }, evidence } as unknown as ScenarioCtx
  const team = onLens(lens, user)
  const open = async () => (phone === 'drawn' ? team : { ...team, give: async () => ({ status: 0, text: NO_TEAM }) })
  return { verdict: await phoneTeamRoles(open).run(ctx), evidence }
}

describe('phone-team-roles (B17.552)', () => {
  it('names B28.463 in its items', () => {
    expect(phoneTeamRoles().items).toEqual(['B28.463'])
  })

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

  it('FAILs when the phone has no Team and roles', async () => {
    const { verdict } = await runAgainstStub('', 'none')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toContain(NO_TEAM)
  })
}, 60_000)
