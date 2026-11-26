import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterAll, describe, expect, it } from 'vitest'
import { allowances } from '../src/allowances.ts'
import { LensClient } from '../src/lens.ts'
import { CannotTest, type ScenarioCtx, type Verdict } from '../src/scenarios.ts'

// B30.138 — agent-allowances against the stub Lens (selftest/stub-payees.ts), whose tick pays an agent's monthly allowance on its
// day: it passes when the month is paid once with the agent's own money swept back first, and FAILs when a month that already ran
// is paid again or the agent is paid without the company's account being debited. On the 29th to the 31st the stub's clock and the
// scenario's run four days ahead, so the allowance's day is one it can have.

const AHEAD_MS = new Date().getUTCDate() > 28 ? 4 * 86_400_000 : 0

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

async function onStub(broken: string): Promise<Verdict> {
  const port = await freePort()
  const stub = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', new URL('../selftest/stub-lens.ts', import.meta.url).pathname], {
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'agent-allowances', STUB_BREAK: broken, STUB_CLOCK_AHEAD_MS: String(AHEAD_MS) },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  stubs.push(stub)
  await new Promise<void>((resolve, reject) => {
    stub.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'agent-allowances')
  const [user] = await lens.createUsers(1)
  return allowances({ waitMs: 10_000, pollMs: 500, now: () => new Date(Date.now() + AHEAD_MS) }).run({ app: { user }, env: { lens }, evidence: [] } as unknown as ScenarioCtx)
}

describe('agent-allowances (B30.138)', () => {
  it.concurrent("passes when the month is paid once, the agent's own money swept back first", async () => {
    const v = await onStub('')
    expect(v.detail).toMatch(/^Allowances \d+'s £20\.00 a month on day \d+ ran once for \d{4}-\d\d: the £7\.50 it held swept back, then £20\.00 in from the company's account, one line of each on both statements, leaving £20\.00 and £480\.00; stopped, it shows stopped_at; set again, the month ran again and paid nothing twice; then stopped for good$/)
    expect(v.pass).toBe(true)
  })

  it.concurrent('FAILs when a month that already ran is paid again', async () => {
    const v = await onStub('allowance-twice')
    expect(v.pass).toBe(false)
    expect(v.detail).toMatch(/^set again in a month that already ran, the allowance paid again: its runs are \[\{.*"status":"funded".*\},\{.*; Allowances \d+'s statement must hold one allowance of £20\.00 .*it holds allowance £20\.00, £20\.00/)
  })

  it.concurrent("FAILs when the agent is paid without the company's account being debited", async () => {
    const v = await onStub('allowance-unfunded')
    expect(v.pass).toBe(false)
    expect(v.detail).toMatch(/^the month's allowance is wrong on the ledger: the company's statement must hold one allowance of −£20\.00 .*it holds allowance none.*the balances must be £20\.00 for Allowances \d+ and £480\.00 for the company; they are £20\.00 and £500\.00$/)
  })

  it('SKIPs on the 29th to the 31st, when no allowance is due', async () => {
    await expect(allowances({ now: () => new Date('2026-12-30T12:00:00Z') }).run({ evidence: [] } as unknown as ScenarioCtx)).rejects.toBeInstanceOf(CannotTest)
  })
})
