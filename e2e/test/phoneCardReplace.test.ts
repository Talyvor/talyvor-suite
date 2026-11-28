import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { onLens, type OpenEnds } from '../src/agentCardReplace.ts'
import { LensClient } from '../src/lens.ts'
import { NO_ENDS, phoneCardReplace } from '../src/phoneCardReplace.ts'
import type { Evidence, ScenarioCtx, Verdict } from '../src/scenarios.ts'

// B17.576 — phone-card-replace against the stub Lens (selftest/stub-bank.ts): it passes there, FAILs on a Lens whose cancelled
// card the agent keeps (STUB_BREAK=card-cancel-pays), and FAILs when the phone's Cards tab draws no Replace card and Cancel card,
// the feature taken away. The presses are the owner's own Lens routes here, as the phone's BFF relays them; the nightly presses
// the phone.

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

async function runOnStub(broken: string, phone: 'drawn' | 'none' = 'drawn'): Promise<{ verdict: Verdict; evidence: Evidence[] }> {
  const port = await freePort()
  stub = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', new URL('../selftest/stub-lens.ts', import.meta.url).pathname], {
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'phone-card-replace', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'phone-card-replace')
  const [user] = await lens.createUsers(1)
  const evidence: Evidence[] = []
  const none = { ok: false as const, status: 0, error: NO_ENDS }
  const open: OpenEnds = async (ctx, agent) => {
    const ends = await onLens(ctx, agent)
    return phone === 'drawn' ? ends : { ...ends, replace: async () => none, cancel: async () => none }
  }
  const verdict = await phoneCardReplace(open).run({ app: { user }, env: { lens }, evidence } as unknown as ScenarioCtx)
  return { verdict, evidence }
}

describe('phone-card-replace (B17.576)', () => {
  it('names B28.465 in its items', () => {
    expect(phoneCardReplace().items).toEqual(['B28.465'])
  })

  it('passes on a Lens whose replaced card pays once and whose cancelled card writes no posting', async () => {
    const { verdict, evidence } = await runOnStub('')
    expect(verdict.detail).toMatch(/replaced by ic_\S+, the next paid .* one posting; cancelled, the agent held no card and a purchase was refused 404, no posting$/)
    expect(verdict.pass).toBe(true)
    expect(evidence.find((e) => e.note?.startsWith('the owner replaces'))?.answer).toMatch(/^201 /)
  })

  it('FAILs when the agent keeps its cancelled card', async () => {
    const { verdict } = await runOnStub('card-cancel-pays')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^after the cancel Card replacer \S+ must hold no card/)
  })

  it('FAILs when the phone has no Replace card and Cancel card', async () => {
    const { verdict } = await runOnStub('', 'none')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toContain(NO_ENDS)
  })
}, 60_000)
