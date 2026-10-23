import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChargeBook } from '../src/app.ts'
import { AgentBankScreen, agentPauseAll } from '../src/bank.ts'
import { SpendCap } from '../src/budget.ts'
import { type Agent, LensClient, type SyntheticUser } from '../src/lens.ts'
import type { Evidence, ScenarioCtx, Verdict } from '../src/scenarios.ts'

// B28.459 — agent-pause-all's started-again question is asked past every stored answer. From 9 Oct user 42's fresh
// workspace was served "9792" for 6235 + 3767 night after night: one wrong answer, stored once and pooled. Against the
// stub Lens with that wrong pooled answer planted (STUB_BREAK=pool-stale), a second workspace asking the same seeded
// question still gets the model's answer.

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
  vi.restoreAllMocks()
  stub?.kill()
  stub = undefined
})

/** Agent Wallets' buttons, pressed on Lens's own routes: the screen is not what this checks. */
function bankOf(base: string, lens: LensClient, user: SyntheticUser): AgentBankScreen {
  const post = async (path: string, body: unknown = {}) => {
    const res = await fetch(`${base}/v1/workspaces/${user.workspaceID}${path}`, {
      method: 'POST', headers: { Authorization: `Bearer ${user.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`)
    return res.json() as Promise<{ key?: string }>
  }
  return {
    create: async (name: string) => void (await lens.createAgent(user, name)),
    move: async (a: Agent, ulxc: number) => void (await lens.fundAgent(user, a.id, ulxc)),
    issueKey: async (a: Agent) => (await post(`/agents/${a.id}/keys`)).key ?? '',
    pauseAll: async (reason: string) => void (await post('/agents/pause-all', { reason })),
    resumeAll: async () => void (await post('/agents/resume-all')),
    close: async () => {},
  } as unknown as AgentBankScreen
}

async function pauseAllTwice(stubBreak = 'pool-stale'): Promise<{ verdict: Verdict; evidence: Evidence[] }> {
  const port = await freePort()
  const base = `http://127.0.0.1:${port}`
  stub = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', new URL('../selftest/stub-lens.ts', import.meta.url).pathname], {
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'pause-key', STUB_BREAK: stubBreak },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(base, 'pause-key')
  const users = await lens.createUsers(2)
  const run = async (user: SyntheticUser) => {
    vi.spyOn(AgentBankScreen, 'open').mockResolvedValue(bankOf(base, lens, user))
    const evidence: Evidence[] = []
    const env = { lens, judgeProvider: 'anthropic', judgeModel: 'claude-haiku-4-5', catalog: await lens.catalog(user),
      cap: new SpendCap(1), book: new ChargeBook(), usdPerLXC: await lens.usdPerLXC() }
    const ctx = { app: { user }, env, evidence } as unknown as ScenarioCtx
    return { verdict: await agentPauseAll(42).run(ctx), evidence }
  }
  await run(users[0]) // the night that stored the wrong answer
  return run(users[1])
}

describe('agent-pause-all (B28.459)', () => {
  it("asks the started-again question past a wrong pooled answer, and the model's is right", async () => {
    const { verdict, evidence } = await pauseAllTwice()
    expect(verdict).toMatchObject({ pass: true })
    expect(evidence.find((e) => e.note?.endsWith('started again'))?.served).toMatch(/^not replayed, no pooled charge/)
  }, 30_000)

  it('FAILs when the started-again question is answered from the wrong pooled answer, not the model', async () => {
    const { verdict } = await pauseAllTwice('pool-stale,bypass-ignored')
    expect(verdict).toMatchObject({ pass: false, detail: expect.stringMatching(/answered wrong: expected \d+, got "\d+"/) })
  }, 30_000)

  // B28.458 — the report names the request that served the answer; an answer Lens sends without one FAILs.
  it('names the request that served the started-again answer, and FAILs when Lens sends none', async () => {
    const { verdict, evidence } = await pauseAllTwice()
    expect(evidence.find((e) => e.note?.endsWith('started again'))?.served).toMatch(/X-Talyvor-Request-ID: req_[0-9a-f]+/)
    stub?.kill()
    expect((await pauseAllTwice('pool-stale,request-id')).verdict).toMatchObject({ pass: false, detail: expect.stringMatching(/which Lens request served/) })
    expect(verdict).toMatchObject({ pass: true })
  }, 60_000)
})
