import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { LensClient } from '../src/lens.ts'
import { scheduledPromptLoggingNone } from '../src/scheduledPromptLoggingNone.ts'
import type { Evidence, ScenarioCtx, Verdict } from '../src/scenarios.ts'

// B17.574 — scheduled-prompt-logging-none against the stub Lens: it passes on a Lens that asks and charges a scheduled
// prompt under logging none and keeps no answer from it (B28.265), and FAILs on one that keeps the answer
// (STUB_BREAK=schedule-answer-kept) or charges nothing (STUB_BREAK=schedule-free).

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

async function runAgainstStub(broken: string): Promise<{ verdict: Verdict; evidence: Evidence[]; logging: string | undefined }> {
  const port = await freePort()
  stub = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', new URL('../selftest/stub-lens.ts', import.meta.url).pathname], {
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'scheduled-logging-none', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'scheduled-logging-none')
  const [user] = await lens.createUsers(1)
  const evidence: Evidence[] = []
  const env = {
    lens, catalog: await lens.catalog(user), judgeProvider: 'anthropic', judgeModel: 'claude-haiku-4-5', usdPerLXC: 0.1,
    cap: { reserve: () => 0, settle: () => undefined }, book: { add: () => undefined },
  }
  const ctx = { env, app: { user }, evidence } as unknown as ScenarioCtx
  const verdict = await scheduledPromptLoggingNone(0).run(ctx)
  const ws = (await lens.as(user.token, 'GET', `/v1/workspaces/${user.workspaceID}`)).text
  return { verdict, evidence, logging: (JSON.parse(ws) as { logging_policy?: string }).logging_policy }
}

describe('scheduled-prompt-logging-none (B17.574)', () => {
  it('passes on a Lens that charges the run on the agent and keeps no answer, and sets logging back', async () => {
    const { verdict, logging } = await runAgainstStub('')
    expect(verdict.detail).toMatch(/^with Request logging none, "What is \d+ \+ \d+\? Reply with the number only\." was asked at .* and charged \d+ µLXC on Unlogged scheduler 0's statement .*its run keeps the request req_\w+ and no answer$/)
    expect(verdict.pass).toBe(true)
    expect(logging).toBe('full')
  }, 60_000)

  it('FAILs on a Lens that keeps the answer under logging none', async () => {
    const { verdict } = await runAgainstStub('schedule-answer-kept')
    expect(verdict.pass).toBe(false)
    expect(verdict.detail).toMatch(/^the workspace's Request logging is none, yet Lens kept the scheduled prompt's answer on its run/)
  }, 60_000)

  it('FAILs on a Lens that charges the agent nothing for it', async () => {
    const { verdict } = await runAgainstStub('schedule-free')
    expect(verdict.pass).toBe(false)
    expect(verdict.detail).toMatch(/^the scheduled prompt was answered, but its charge is not on Unlogged scheduler 0's statement/)
  }, 60_000)
})
