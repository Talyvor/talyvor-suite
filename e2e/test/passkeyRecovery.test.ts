import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { passkeyRecovery } from '../src/passkeyRecovery.ts'
import { LensClient } from '../src/lens.ts'
import type { ScenarioCtx, Verdict } from '../src/scenarios.ts'

// B17.544 — passkey-recovery against the stub Lens (selftest/stub-bank.ts), which removes passkeys, locks a workspace down and
// recovers it with the recovery code as Lens B28.340 does: it passes there, and FAILs on a Lens whose removed passkey still
// signs (STUB_BREAK=removed-passkey-signs).

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

async function runOnStub(broken: string): Promise<Verdict> {
  const port = await freePort()
  stub = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', new URL('../selftest/stub-lens.ts', import.meta.url).pathname], {
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'passkey-recovery', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'passkey-recovery')
  const [user] = await lens.createUsers(1)
  return passkeyRecovery().run({ app: { user }, env: { lens }, evidence: [] } as unknown as ScenarioCtx)
}

describe('passkey-recovery (B28.340)', () => {
  it('passes on a Lens where a removed and a locked-out passkey cannot approve and a recovery passkey can', async () => {
    const verdict = await runOnStub('')
    expect(verdict.detail).toMatch(/after the lift a passkey added with the recovery code approved it, and the payment posted -2000000 µLXC on .* and 2000000 µLXC on .*$/)
    expect(verdict.pass).toBe(true)
  })

  it('FAILs when a removed passkey still approves', async () => {
    const verdict = await runOnStub('removed-passkey-signs')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^the removed passkey's signature on approval \S+ must be refused and leave it pending/)
  })
}, 60_000)
