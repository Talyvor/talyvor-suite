import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { agentCardReplace } from '../src/agentCardReplace.ts'
import { LensClient } from '../src/lens.ts'
import type { ScenarioCtx, Verdict } from '../src/scenarios.ts'

// B17.543 — agent-card-replace against the stub Lens (selftest/stub-bank.ts), which replaces and cancels an agent's card as Lens
// B28.321 does: it passes there, and FAILs on a Lens whose cancelled card the agent keeps (STUB_BREAK=card-cancel-pays).

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
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'agent-card-replace', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'agent-card-replace')
  const [user] = await lens.createUsers(1)
  return agentCardReplace().run({ app: { user }, env: { lens }, evidence: [] } as unknown as ScenarioCtx)
}

describe('agent-card-replace (B28.321)', () => {
  it('passes on a Lens whose replaced card pays once and whose cancelled card writes no posting', async () => {
    const verdict = await runOnStub('')
    expect(verdict.detail).toMatch(/replaced by ic_\S+, the next paid .* one posting; cancelled, the agent held no card and a purchase was refused 404, no posting$/)
    expect(verdict.pass).toBe(true)
  })

  it('FAILs when the agent keeps its cancelled card', async () => {
    const verdict = await runOnStub('card-cancel-pays')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^after the cancel Card replacer \S+ must hold no card/)
  })
}, 60_000)
