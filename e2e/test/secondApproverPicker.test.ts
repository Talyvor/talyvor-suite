import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { LensClient, type SyntheticUser } from '../src/lens.ts'
import type { Evidence, ScenarioCtx, Verdict } from '../src/scenarios.ts'
import { NO_CHOOSE, type Picker, secondApproverPicker } from '../src/secondApproverPicker.ts'

// B17.553 — second-approver-picker against the stub Lens (selftest/stub-second-approver.ts), whose roles list names who took each
// role up as Lens B28.464 does: it passes there, FAILs on a Lens whose roles list names nobody (STUB_BREAK=roles-no-user-id), and
// SKIPs without the provisioning secret. Team and roles is the owner's own Lens routes here, Who offering what the screen offers
// (TeamRoles.tsx SecondApprover: Approvers and Admins with a user_id); the self-test presses the screen.

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

function onLens(lens: LensClient, user: SyntheticUser): Picker {
  const ws = `/v1/workspaces/${user.workspaceID}`
  return {
    give: async (email) => {
      const r = await lens.as(user.token, 'PUT', `${ws}/roles`, { email, role: 'approver' })
      return { status: r.status, text: r.text }
    },
    who: async () => {
      const r = await lens.as(user.token, 'GET', `${ws}/roles`)
      const items = (JSON.parse(r.text) as { items: { email: string; role: string; user_id: string }[] }).items
      const people = items.filter((i) => ['approver', 'admin'].includes(i.role) && !!i.user_id).map((i) => ({ email: i.email, user_id: i.user_id }))
      return people.length === 0 ? NO_CHOOSE : people
    },
    save: async (userID) => {
      const r = await lens.as(user.token, 'PUT', `${ws}/second-approver`, { user_id: userID, above_minor: 1, currency: 'USD' })
      return { status: r.status, text: r.text }
    },
    close: async () => undefined,
  }
}

async function runAgainstStub(broken: string, secret = 'provision-secret'): Promise<{ verdict: Verdict; evidence: Evidence[] }> {
  const port = await freePort()
  stub = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', new URL('../selftest/stub-lens.ts', import.meta.url).pathname], {
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'picker-key', STUB_PROVISION_SECRET: 'provision-secret', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'picker-key')
  const [user] = await lens.createUsers(1)
  const evidence: Evidence[] = []
  const ctx = { env: { lens, provisionSecret: secret }, app: { user }, evidence } as unknown as ScenarioCtx
  return { verdict: await secondApproverPicker(async () => onLens(lens, user)).run(ctx), evidence }
}

describe('second-approver-picker (B17.553)', () => {
  it("passes on a Lens whose roles list names who took the role up, and the picked person's approval posts once", async () => {
    const { verdict, evidence } = await runAgainstStub('')
    expect(verdict).toMatchObject({ pass: true })
    expect(evidence.find((e) => e.note === 'the owner reads the roles list')?.answer).toMatch(/"email":"waiting-[^"]*","role":"approver","user_id":""/)
  })

  it('FAILs when the roles list names nobody who took a role up', async () => {
    const { verdict } = await runAgainstStub('roles-no-user-id')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^the roles list must name picked-.* by a user id/)
  })

  it('SKIPs without the provisioning secret', async () => {
    await expect(runAgainstStub('', '')).rejects.toThrow(/LENS_PROVISION_SECRET/)
  })
}, 60_000)
