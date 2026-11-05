import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { LensClient } from '../src/lens.ts'
import type { Evidence, ScenarioCtx, Verdict } from '../src/scenarios.ts'
import { trustLayer } from '../src/trustLayer.ts'

// B45.31 — trust-layer against the stub Lens (selftest/stub-trust-layer.ts, stub-bank.ts), which checks an outside agent's money
// signature, keeps an approver agent to its own limit and signs the owner's approvals as AP2 mandates as Lens does: it passes, and
// FAILs when a forged signature is taken or an approver approves above its limit. The approval card is read from Lens's agent_trust
// here, as the card renders it; the self-test's browser reads the real one.

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
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'trust-key', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'trust-key')
  const [user] = await lens.createUsers(1)
  let shown = ''
  const page = {
    url: () => 'http://app.test/',
    goto: async (to: string) => {
      const r = await lens.act<{ agent_trust?: { label: string } }>(user, 'GET', `/v1/money/payment-requests/${to.split('/').pop()}`)
      shown = r.ok ? r.value.agent_trust?.label ?? '' : ''
    },
    getByTestId: () => ({ innerText: async () => shown }),
  }
  const evidence: Evidence[] = []
  const ctx = { env: { lens, hookTunnel: 'none' }, app: { user, page }, evidence } as unknown as ScenarioCtx
  return { verdict: await trustLayer().run(ctx), evidence }
}

describe('trust-layer (B45.31)', () => {
  it('passes on a Lens that checks the signature, holds the approver to its limit and signs the mandate', async () => {
    const { verdict, evidence } = await runAgainstStub('')
    expect(verdict).toMatchObject({ pass: true })
    expect(evidence.find((e) => e.note?.startsWith('the same request signed by another key'))?.answer).toMatch(/^401 .*does not verify/)
  })

  it('FAILs when a forged signature is taken', async () => {
    const { verdict } = await runAgainstStub('forged-signature-accepted')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^a forged signature must be refused 401 "does not verify"; Lens answered 201 /)
  })

  it('FAILs when the approver approves above its own limit', async () => {
    const { verdict } = await runAgainstStub('approver-over-limit')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/above its 200000 µLXC limit must be refused 409; Lens answered 200 /)
  })
}, 60_000)
