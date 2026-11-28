import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { LensClient } from '../src/lens.ts'
import { type ApproveAsked, mandateAsked } from '../src/mandateAsked.ts'
import { softPasskey } from '../src/payees.ts'
import { step } from '../src/pocketProblems/press.ts'
import type { Evidence, ScenarioCtx, Verdict } from '../src/scenarios.ts'

// B17.559 — mandate-asked against the stub Lens (selftest/stub-payees.ts), which records an agent's own ask requested and lets
// the company it names pull only once the owner approved it, signed, as Lens B55.24 does: it passes there, and FAILs on a Lens
// that makes the ask active at once (STUB_BREAK=mandate-ask-active). The owner's approval is made here with a software passkey
// as the web app's Approve sends it (AgentBank.tsx); the nightly presses Approve on Approvals.

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

/** The owner registers a software passkey, Lens refuses the unsigned approval, and the approval goes up signed over its challenge. */
const withPasskey: ApproveAsked = async (ctx, id, _asker, unsigned) => {
  const reg = await step<{ challenge: string; rp_id: string }>(ctx, 'POST', '/v1/workspaces/{ws}/agents/passkeys/challenge', {}, 'the owner asks to register a passkey')
  if (!reg.ok) return `the passkey registration challenge was refused: ${reg.error}`
  const key = softPasskey(reg.value.rp_id)
  const registered = await step(ctx, 'POST', '/v1/workspaces/{ws}/agents/passkeys', key.register(reg.value.challenge, 'Nightly software passkey'), 'the owner registers a passkey')
  if (registered.status !== 201) return `registering a passkey answered ${registered.status}`
  const refused = await unsigned()
  if (refused !== undefined) return refused
  const ch = await step<{ challenge: string }>(ctx, 'POST', '/v1/money/mandates/challenge', { mandate_id: id }, "the approval's challenge")
  if (!ch.ok) return `the approval's challenge was refused: ${ch.error}`
  const ok = await step(ctx, 'POST', `/v1/money/mandates/${id}/approve`, { assertion: key.assert(ch.value.challenge) }, 'the owner approves, signed')
  return ok.ok ? undefined : `the signed approval answered ${ok.status}`
}

async function runAgainstStub(broken: string): Promise<{ verdict: Verdict; evidence: Evidence[] }> {
  const port = await freePort()
  stub = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', new URL('../selftest/stub-lens.ts', import.meta.url).pathname], {
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'asked-key', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'asked-key')
  const [user] = await lens.createUsers(1)
  const evidence: Evidence[] = []
  const ctx = { env: { lens }, app: { user }, evidence } as unknown as ScenarioCtx
  return { verdict: await mandateAsked(withPasskey).run(ctx), evidence }
}

describe('mandate-asked (B17.559)', () => {
  it('passes on a Lens that records the ask requested and lets the payee pull only once the owner approved it, signed', async () => {
    const { verdict } = await runAgainstStub('')
    expect(verdict).toMatchObject({ pass: true })
    expect(verdict.detail).toMatch(/the £5\.00 pull moved the agent's account 10000 → 9500 and the payee's 0 → 500$/)
  })

  it('FAILs when the agent\'s ask is active at once', async () => {
    const { verdict } = await runAgainstStub('mandate-ask-active')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^the agent's ask must be recorded requested; Lens answered 201, active/)
  })
}, 60_000)
