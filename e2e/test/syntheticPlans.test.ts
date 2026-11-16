import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { LensClient } from '../src/lens.ts'
import { cast, seat } from '../src/plans.ts'
import type { Scenario } from '../src/scenarios.ts'

// B61.90 — the testers' synthetic users on Lens's own plans (talyvor-lens B61.57). The stub Lens answers as Lens does now:
// a 5 Oct name is made on its successor and the answer names the plan made, so set-up that asks for free stops on
// "made them on business_studio", as the 01:00Z run of 16 Nov did.

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

async function stubLens(): Promise<LensClient> {
  const port = await freePort()
  stub = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', new URL('../selftest/stub-lens.ts', import.meta.url).pathname], {
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'synthetic-plans' },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  return new LensClient(`http://127.0.0.1:${port}`, 'synthetic-plans')
}

const s = (id: string, more: Partial<Scenario> = {}): Scenario => ({ id, title: id, owner: 'talyvor-lens', run: async () => ({ pass: true, detail: '' }), ...more })

describe("the testers' users on Lens's plans (B61.90)", () => {
  it('asks for each ladder step by its key and gets it: Studio, Company for agents, Group for a counterparty', async () => {
    const lens = await stubLens()
    const seated = await seat(lens, cast([[s('reads')], [s('wallet', { agents: 2 })], [s('pays-0', { agents: 1, partners: [2] })], [s('gate', { own: true, plan: 'business_company' })]]))
    expect(seated.users.map((u) => u.plan)).toEqual(['business_studio', 'business_company', 'business_group', 'business_studio'])
    for (const u of seated.users) expect((await lens.workspacePlan(u)).plan).toBe(u.plan)
    expect([...seated.own.values()].map((u) => u.plan)).toEqual(['business_company'])
  }, 30_000)

  it('still refuses a plan Lens did not make', async () => {
    const lens = await stubLens()
    await expect(lens.createUsers(1, 'free' as never, { confirm: false })).rejects.toThrow('asked Lens for 1 synthetic users on free, and it made them on business_studio')
  }, 30_000)
})
