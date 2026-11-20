import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { LensClient } from '../src/lens.ts'
import type { Evidence, ScenarioCtx, Verdict } from '../src/scenarios.ts'
import { agentCards } from '../src/agentCards.ts'

// B46.20 — agent-cards against the stub Lens, whose card desk holds a batch's total once on its approval as Lens's does
// (selftest/stub-payees.ts): it passes on a Lens that holds once, and FAILs when approving again holds the total again.
// B17.508 — and whose issuer's charge on a card pays once: it FAILs when a used card's second charge is approved.
// The funding invoice is paid through the stub's own card checkout, as the pay page's browser would. B17.512 — and it judges
// "closing within 24 hours" on the stub's clock, which may run ahead of the runner's, and FAILs on cards that close in 25.
// B17.510 — and whose card disputes credit a won dispute once: it FAILs when a won dispute credits nothing, or credits twice.

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

async function runAgainstStub(broken: string, aheadMs = 0): Promise<{ verdict: Verdict; evidence: Evidence[] }> {
  const port = await freePort()
  const base = `http://127.0.0.1:${port}`
  stub = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', new URL('../selftest/stub-lens.ts', import.meta.url).pathname], {
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'agent-cards', STUB_BREAK: broken, STUB_CLOCK_AHEAD_MS: String(aheadMs) },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(base, 'agent-cards')
  const [user] = await lens.createUsers(1)
  const evidence: Evidence[] = []
  const ctx = { env: { lens }, app: { user }, evidence } as unknown as ScenarioCtx
  const byCard = async (_: ScenarioCtx, token: string) => {
    const { url } = await (await fetch(`${base}/v1/pay/${token}/card`, { method: 'POST' })).json() as { url: string }
    const paid = await fetch(url, { method: 'POST', redirect: 'manual', body: new URLSearchParams({ card: '4242 4242 4242 4242' }) })
    return paid.status === 303 ? undefined : `the stub checkout answered ${paid.status}`
  }
  return { verdict: await agentCards(byCard).run(ctx), evidence }
}

describe('agent-cards (B46.20)', () => {
  it('passes on a Lens whose one approval issues three locked, capped cards and holds their total once', async () => {
    const { verdict } = await runAgainstStub('')
    expect(verdict).toMatchObject({ pass: true })
    expect(verdict.detail).toMatch(/50000 → 10000 minor \(one card_hold of 40000\); approved again it stayed at 10000; /)
    expect(verdict.detail).toMatch(/the British Airways card charged 18000 wrote one card_charge, the account 10000 → 12000; charged again it was declined and stayed at 12000; /)
    expect(verdict.detail).toMatch(/disputed \(cdsp_[^)]+\) it stayed at 12000, won it came back to 30000 and stayed at 30000 on the same outcome again$/)
  })

  it('FAILs when approving the cards again holds their total again', async () => {
    const { verdict } = await runAgainstStub('card-hold-twice')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/approving the cards again held more: the agent's account went from 10000 to -30000 minor$/)
  })

  it('FAILs when a used single-use card pays a second charge', async () => {
    const { verdict } = await runAgainstStub('card-pays-twice')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/a second charge on a single-use card must be declined "it pays once"/)
    expect(verdict.detail).toMatch(/a declined second charge must write no card_charge: Lens lists 2 for the agent/)
  })

  // B17.510 — a won dispute is the charge back, once.
  it('FAILs when a won dispute credits nothing back', async () => {
    const { verdict } = await runAgainstStub('dispute-won-uncredited')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/a won dispute of the 18000 minor charge must read won, 18000 credited/)
  })

  it('FAILs when the same won outcome credits the charge again', async () => {
    const { verdict } = await runAgainstStub('dispute-won-twice')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/the same won outcome again must credit nothing more: the agent's account went from 30000 to 48000 minor$/)
  })

  // B17.512 — the 24 hours are Lens's, read from its Date headers, not the runner's clock.
  it("passes on a Lens whose clock runs 200 ms ahead of the runner's", async () => {
    const { verdict } = await runAgainstStub('', 200)
    expect(verdict).toMatchObject({ pass: true })
  })

  it('FAILs when the cards close in 25 hours', async () => {
    const { verdict } = await runAgainstStub('card-life-25h')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/the British Airways card must be active, locked to British Airways, capped at 20000 GBP and closing within 24 hours/)
  })
}, 60_000)
