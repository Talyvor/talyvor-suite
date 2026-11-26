import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterAll, describe, expect, it } from 'vitest'
import { agentCardAccount } from '../src/agentCardAccount.ts'
import { LensClient } from '../src/lens.ts'
import { CannotTest, type ScenarioCtx, type Verdict } from '../src/scenarios.ts'

// B30.139 — agent-card-account against the stub Lens (selftest/stub-bank.ts), whose agent cards may draw on the agent's account: it
// passes when the purchase is held on the account and its capture gives the rest of the hold back at once, and FAILs when the capture
// keeps the rest or the purchase spends the agent's credits instead of the account.

const SECRET = 'whsec_selftest'

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
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'agent-card-account', STUB_BREAK: broken, STUB_WEBHOOK_SECRET: SECRET },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  stubs.push(stub)
  await new Promise<void>((resolve, reject) => {
    stub.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'agent-card-account')
  const [user] = await lens.createUsers(1)
  return agentCardAccount().run({ app: { user }, env: { lens, webhookSecret: SECRET }, evidence: [] } as unknown as ScenarioCtx)
}

describe('agent-card-account (B30.139)', () => {
  it.concurrent('passes when the purchase is held on the account and its capture gives the rest back at once', async () => {
    const v = await onStub('')
    expect(v.detail).toMatch(/^Card account \S+'s GBP card, switched to draw on its account, held a £25\.00 purchase there \(card_hold −£25\.00, £475\.00 left\); captured at £24\.00, card_charge gave £1\.00 back at once, leaving £476\.00; sent again it moved nothing; its \d+ µLXC of credits never moved$/)
    expect(v.pass).toBe(true)
  }, 30_000)

  it.concurrent('FAILs when the capture keeps what it did not take of the hold', async () => {
    const v = await onStub('card-capture-unreleased')
    expect(v.pass).toBe(false)
    expect(v.detail).toMatch(/^captured at £24\.00, the £1\.00 no longer held must come back .*; it holds card_hold −£25\.00, card_charge none and a balance of £475\.00$/)
  }, 30_000)

  it.concurrent("FAILs when the purchase spends the agent's credits instead of the account", async () => {
    const v = await onStub('card-account-credits')
    expect(v.pass).toBe(false)
    expect(v.detail).toMatch(/^the purchase must be held on Card account \S+'s account: .*; it holds card_hold none, card_charge none and a balance of £500\.00$/)
  }, 30_000)

  it('SKIPs without the test-mode webhook secret, as no capture can be signed', async () => {
    await expect(agentCardAccount().run({ env: { webhookSecret: '' }, evidence: [] } as unknown as ScenarioCtx)).rejects.toBeInstanceOf(CannotTest)
  })
})
