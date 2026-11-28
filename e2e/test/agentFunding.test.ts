import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { type Press, agentFunding } from '../src/agentFunding.ts'
import { LensClient, type SyntheticUser } from '../src/lens.ts'
import type { Evidence, ScenarioCtx, Verdict } from '../src/scenarios.ts'

// B17.557 — agent-funding against the stub Lens (selftest/stub-payees.ts and stub-second-approver.ts), which moves money between
// the company's account and an agent's as Lens B61.66 does and refuses a Viewer: it passes there, FAILs on a Lens that lets a
// Viewer move it (STUB_BREAK=funding-any-role), and SKIPs without the provisioning secret. Add money and Take back are the Lens
// route the BFF relays them to here; the self-test presses the agent's page.

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

/** Add money and Take back on the Lens route the BFF relays them to, for the agent's USD account. */
function onLens(lens: LensClient, user: SyntheticUser): Press {
  return async (agent, direction, amount) => {
    const list = await lens.as(user.token, 'GET', '/v1/money/accounts')
    const id = (JSON.parse(list.text) as { accounts: { id: string; currency: string; agent_id?: string }[] }).accounts.find((a) => a.agent_id === agent.id && a.currency === 'USD')?.id
    const r = await lens.as(user.token, 'POST', `/v1/money/accounts/${id}/funding`, { direction, amount_minor: Math.round(Number(amount) * 100), idempotency_key: `t-${direction}-${amount}` })
    return { status: r.status, text: r.text }
  }
}

async function runAgainstStub(broken: string, secret = 'provision-secret'): Promise<{ verdict: Verdict; evidence: Evidence[] }> {
  const port = await freePort()
  stub = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', new URL('../selftest/stub-lens.ts', import.meta.url).pathname], {
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'funding-key', STUB_PROVISION_SECRET: 'provision-secret', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'funding-key')
  const [user] = await lens.createUsers(1)
  const evidence: Evidence[] = []
  const ctx = { env: { lens, provisionSecret: secret }, app: { user }, evidence } as unknown as ScenarioCtx
  return { verdict: await agentFunding(async () => ({ press: onLens(lens, user), close: async () => undefined })).run(ctx), evidence }
}

describe('agent-funding (B17.557)', () => {
  it("passes on a Lens that adds and takes back once on both statements and refuses a Viewer", async () => {
    const { verdict } = await runAgainstStub('')
    expect(verdict).toMatchObject({ pass: true })
    expect(verdict.detail).toMatch(/Add money \$10\.00 posted one agent_funding on each statement and Take back \$4\.00 one agent_funding_back on each; .*\$14\.00 .*\$6\.00; a Viewer's \$1\.00 was refused 403/)
  })

  it("FAILs when a Viewer's session moves the money", async () => {
    const { verdict } = await runAgainstStub('funding-any-role')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^a Viewer moving \$1\.00 .* must be refused 403 with nothing posted .*Lens answered 201.*statement must hold/)
  })

  it('SKIPs without the provisioning secret', async () => {
    await expect(runAgainstStub('', '')).rejects.toThrow(/LENS_PROVISION_SECRET/)
  })
}, 60_000)
