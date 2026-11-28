import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterAll, describe, expect, it } from 'vitest'
import { LensClient } from '../src/lens.ts'
import { planSoloFreeExchange, soloPersonalVerdict } from '../src/planPersonal.ts'
import type { ScenarioCtx, Verdict } from '../src/scenarios.ts'

// B17.555 — a Personal account's plan and Solo's free exchange line, played against the stub Lens (selftest/stub-lens.ts) made
// as a person on Solo: each passes on a sound copy and FAILs with its feature taken away.

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number }
      s.close(() => resolve(port))
    })
  })
}

const stubs: ChildProcess[] = []
afterAll(() => {
  for (const s of stubs) s.kill()
})

/** A stub Lens with `broken` planted, and one synthetic person on Solo made on it, as the run seats plan-personal's own. */
async function soloOnStub(broken: string) {
  const port = await freePort()
  const stub = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', new URL('../selftest/stub-lens.ts', import.meta.url).pathname], {
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'plan-personal', STUB_BREAK: broken, STUB_IDENTITY_GATE: 'on' },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  stubs.push(stub)
  await new Promise<void>((resolve, reject) => {
    stub.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'plan-personal')
  const [user] = await lens.createUsers(1, 'personal_solo')
  return { lens, user }
}

async function freeLineOnStub(broken: string): Promise<Verdict> {
  const { lens, user } = await soloOnStub(broken)
  return planSoloFreeExchange().run({ app: { user }, env: { lens, fees: await lens.fees() }, evidence: [] } as unknown as ScenarioCtx)
}

describe('plan-solo-free-exchange (B17.555)', () => {
  it.concurrent("passes when the free line converts with no margin and the next conversion takes Solo's margin once", async () => {
    const v = await freeLineOnStub('')
    expect(v.detail).toMatch(/^Lens holds the person to personal_solo as a personal account; 100000 pence, the month's free line, converted with no margin in entry ment_\S+ for 125000 cents at 1\.25000000; the next 10000 took the plan's 100 bps once, 100 pence, in entry ment_\S+ for 12375 cents; GBP 110000 → 0, USD 0 → 137375$/)
    expect(v.pass).toBe(true)
  })
  it.concurrent('FAILs when the margin is taken on the free line too', async () => {
    const v = await freeLineOnStub('fx-margin-on-free')
    expect(v.pass).toBe(false)
    expect(v.detail).toMatch(/^inside the free line: the margin is 100 basis points of the 0 above the 100000 that converts free, rounded up: 0; the quote takes 1000/)
  })
}, 120_000)

describe('plan-personal (B17.555)', () => {
  it.concurrent('reads a person made on Solo as a personal account, and FAILs on a Lens that names it a business', async () => {
    const sound = await soloOnStub('')
    expect(soloPersonalVerdict(await sound.lens.workspacePlan(sound.user))).toEqual({ pass: true, detail: 'Lens holds the person to personal_solo as a personal account' })
    const broken = await soloOnStub('personal-as-business')
    expect(soloPersonalVerdict(await broken.lens.workspacePlan(broken.user)))
      .toEqual({ pass: false, detail: 'a synthetic person made on personal_solo is held to personal_solo as a business account, not personal_solo as a personal one' })
  })
}, 120_000)
