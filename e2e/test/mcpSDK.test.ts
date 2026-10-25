import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { LensClient } from '../src/lens.ts'
import { mcpSDKAgentPay } from '../src/mcpSDK.ts'
import type { Evidence, ScenarioCtx, Verdict } from '../src/scenarios.ts'

// B40.25 — mcp-sdk-agent-pay against the stub Lens (selftest/stub-bank.ts agentMCP), through the real
// @modelcontextprotocol/sdk client: it passes on a Lens whose agent_pay posts its entry to both agents' statements, and
// FAILs when agent_pay answers an entry and posts nothing.

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

async function runAgainstStub(broken: string): Promise<{ verdict: Verdict; evidence: Evidence[] }> {
  const port = await freePort()
  stub = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', new URL('../selftest/stub-lens.ts', import.meta.url).pathname], {
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'mcp-sdk-key', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'mcp-sdk-key')
  const [user] = await lens.createUsers(1)
  const evidence: Evidence[] = []
  const ctx = { app: { user }, env: { lens }, evidence } as unknown as ScenarioCtx
  return { verdict: await mcpSDKAgentPay(7).run(ctx), evidence }
}

describe('mcp-sdk-agent-pay (B40.25)', () => {
  it("passes on a Lens whose agent_pay posts its entry to both agents' statements", async () => {
    const { verdict } = await runAgainstStub('')
    expect(verdict.detail).toMatch(/^the MCP SDK client listed 2 tools, each annotated; agent_balance read 1000000 µLXC and agent_pay's entry \S+ is two postings, −250000 on SDK payer 7's statement and \+250000 on SDK payee 7's, summing to zero$/)
    expect(verdict.pass).toBe(true)
  })

  it('FAILs when agent_pay answers an entry and posts nothing', async () => {
    const { verdict } = await runAgainstStub('agent-pay-unposted')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^agent_pay's entry ent_\w+ is 0 posting\(s\) summing to 0 \(\[\]\)/)
  })
}, 60_000)
