import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { STOPPED_PAYEE, approvalStoppedPayee } from '../src/approvalStopped.ts'
import { LensClient, type SyntheticUser } from '../src/lens.ts'
import type { Evidence, ScenarioCtx, Verdict } from '../src/scenarios.ts'

// B17.558 — approval-stopped-payee against the stub Lens (selftest/stub-bank.ts), which stops a payment re-pointed at another payee
// after its approval and keeps why, as Lens B62.1 and B62.9 do: it passes there, FAILs on a Lens that stops it and keeps nothing
// (STUB_BREAK=stopped-not-kept), and SKIPs on a Lens without the synthetic re-point (talyvor-lens B62.12). Approvals' Decided row
// is read here from Lens's list as the web app draws it (WalletScreens.tsx); the self-test reads the screen.

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

/** The Decided row's sentence as the web app draws it from Lens's approvals list. */
function fromList(lens: LensClient, user: SyntheticUser) {
  return async (_ctx: ScenarioCtx, id: string) => {
    const a = (await lens.agentApprovals(user)).find((x) => x.id === id) as { stopped?: { changed: string } } | undefined
    return a === undefined ? '' : a.stopped?.changed === 'payee' ? `Approved · ${STOPPED_PAYEE}` : 'Approved'
  }
}

async function runAgainstStub(broken: string, repoint = true): Promise<{ verdict: Verdict; evidence: Evidence[] }> {
  const port = await freePort()
  stub = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', new URL('../selftest/stub-lens.ts', import.meta.url).pathname], {
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'stopped-key', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'stopped-key')
  if (!repoint) lens.repointApproval = async () => ({ ok: false, status: 404, error: 'not found' })
  const [user] = await lens.createUsers(1)
  const evidence: Evidence[] = []
  const ctx = { env: { lens }, app: { user }, evidence } as unknown as ScenarioCtx
  return { verdict: await approvalStoppedPayee(fromList(lens, user)).run(ctx), evidence }
}

describe('approval-stopped-payee (B17.558)', () => {
  it('passes on a Lens that stops the changed payment with nothing posted and keeps why', async () => {
    const { verdict } = await runAgainstStub('')
    expect(verdict).toMatchObject({ pass: true })
    expect(verdict.detail).toMatch(/was stopped 403 with nothing on the ledger .*holds £300\.00.*stopped because the payee changed, and Approvals says "Stopped: the payee changed after you approved\."/)
  })

  it('FAILs when the stop is not kept', async () => {
    const { verdict } = await runAgainstStub('stopped-not-kept')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^the stopped payment's approval must read back still approved and stopped \{changed: "payee"\}/)
  })

  it('SKIPs on a Lens that cannot re-point an approval', async () => {
    await expect(runAgainstStub('', false)).rejects.toThrow(/talyvor-lens B62\.12/)
  })
}, 60_000)
