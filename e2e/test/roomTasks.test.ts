import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { LensClient } from '../src/lens.ts'
import { roomTasks } from '../src/roomTasks.ts'
import type { Evidence, ScenarioCtx, Verdict } from '../src/scenarios.ts'

// B41.52 — room-tasks against the stub Lens (selftest/stub-rooms.ts): it passes on a Lens whose board shows one member's
// claim to another and refuses an assignee; it FAILs when a task body's assignee is taken, and when a held task is
// claimed from under its claimant.

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
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'tasks-key', STUB_MODERATOR_KEY: 'tlv_mod_tasks', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'tasks-key', undefined, undefined, undefined, 'tlv_mod_tasks')
  const [user] = await lens.createUsers(1)
  const evidence: Evidence[] = []
  const ctx = { app: { user }, env: { lens }, evidence } as unknown as ScenarioCtx
  return { verdict: await roomTasks(4).run(ctx), evidence }
}

describe('room-tasks (B41.52)', () => {
  it("passes on a Lens whose board shows one member's claim to another and refuses an assignee", async () => {
    const { verdict, evidence } = await runAgainstStub('')
    expect(verdict.pass).toBe(true)
    expect(evidence.map((e) => e.note).join('\n')).toMatch(/a task with assignee_workspace_id: 400/)
  })

  it('FAILs when a task body naming an assignee is taken', async () => {
    const { verdict } = await runAgainstStub('room-task-assign')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^a task body carrying assignee_workspace_id was answered 201/)
  })

  it('FAILs when a member claims a task another holds', async () => {
    const { verdict } = await runAgainstStub('room-task-steal')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^a member claiming a task another holds was answered 200/)
  })
}, 60_000)
