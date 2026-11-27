import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { LensClient } from '../src/lens.ts'
import type { ScenarioCtx, Verdict } from '../src/scenarios.ts'
import { workspaceRolesLens } from '../src/workspaceRolesLens.ts'

// B17.545 — workspace-roles-lens against the stub Lens (selftest/stub-second-approver.ts), which holds what each role may do as
// Lens B28.342 does: it passes there, and FAILs on a Lens whose Finance role also decides approvals (STUB_BREAK=role-finance-approves).

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
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'roles-lens-key', STUB_PROVISION_SECRET: 'provision-secret', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'roles-lens-key')
  const [user] = await lens.createUsers(1)
  return workspaceRolesLens().run({ app: { user }, env: { lens, provisionSecret: 'provision-secret' }, evidence: [] } as unknown as ScenarioCtx)
}

describe('workspace-roles-lens (B28.342)', () => {
  it("passes on a Lens where only Finance funds, only the Approver approves and Admin cannot give a role", async () => {
    const verdict = await runOnStub('')
    expect(verdict.detail).toMatch(/the Approver's approved it and the payment posted -2000000 µLXC on .* and 2000000 µLXC on .*; the Admin's try at giving a role was refused 403$/)
    expect(verdict.pass).toBe(true)
  })

  it('FAILs when Finance also decides approvals', async () => {
    const verdict = await runOnStub('role-finance-approves')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^the finance's approval of \S+ must be refused 403 and leave it pending; Lens answered 200/)
  })
}, 60_000)
