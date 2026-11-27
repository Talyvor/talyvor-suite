import { type ChildProcess, spawn } from 'node:child_process'
import { type Server, createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { LensClient, type SyntheticUser } from '../src/lens.ts'
import type { Evidence, ScenarioCtx, Verdict } from '../src/scenarios.ts'
import { requestBodyBounded } from '../src/surface.ts'

// B17.462 — request-body-bounded against the stub Lens, behind an app that relays /api/agents to it as the BFF does: it
// passes when the app reads at most 64 KiB of a new agent (apps/bff agent_bank.go), and FAILs with the bound taken away.

let stub: ChildProcess | undefined
let app: Server | undefined
afterEach(() => {
  stub?.kill()
  app?.close()
  stub = app = undefined
})

async function listen(s: Server): Promise<string> {
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r))
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}`
}

/** The app's /api/agents for `user`, relayed to Lens; `bounded` reads at most 64 KiB of a body, as the BFF does. */
function fakeApp(lensURL: string, user: SyntheticUser, bounded: boolean): Server {
  return createServer(async (req, res) => {
    const chunks: Buffer[] = []
    let read = 0
    for await (const c of req as AsyncIterable<Buffer>) {
      read += c.length
      if (!bounded || read <= 64 << 10) chunks.push(c)
    }
    if (bounded && read > 64 << 10) return res.writeHead(400, { 'Content-Type': 'application/json' }).end('{"error":"invalid JSON body"}')
    const up = await fetch(`${lensURL}/v1/workspaces/${user.workspaceID}/agents`, {
      method: req.method,
      headers: { Authorization: `Bearer ${user.token}`, 'Content-Type': 'application/json' },
      body: req.method === 'GET' ? undefined : Buffer.concat(chunks),
    })
    res.writeHead(up.status, { 'Content-Type': 'application/json' }).end(await up.text())
  })
}

async function runAgainstStub(bounded: boolean): Promise<{ verdict: Verdict; evidence: Evidence[] }> {
  const probe = createServer()
  const port = Number(new URL(await listen(probe)).port)
  await new Promise((r) => probe.close(r))
  stub = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', new URL('../selftest/stub-lens.ts', import.meta.url).pathname], {
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'request-body-bounded' },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lensURL = `http://127.0.0.1:${port}`
  const lens = new LensClient(lensURL, 'request-body-bounded')
  const [user] = await lens.createUsers(1)
  app = fakeApp(lensURL, user, bounded)
  const base = await listen(app)
  // The page's script, run here with its paths on the app.
  const page = {
    evaluate: async <A, R>(fn: (a: A) => Promise<R>, arg: A): Promise<R> => {
      const real = globalThis.fetch
      globalThis.fetch = ((p: string, init?: RequestInit) => real(new URL(p, base), init)) as typeof fetch
      try {
        return await fn(arg)
      } finally {
        globalThis.fetch = real
      }
    },
  }
  const evidence: Evidence[] = []
  const ctx = { env: { lens }, app: { user, page }, evidence } as unknown as ScenarioCtx
  return { verdict: await requestBodyBounded().run(ctx), evidence }
}

describe('request-body-bounded (B17.462)', () => {
  it('passes when the app reads at most 64 KiB of a new agent', async () => {
    const { verdict } = await runAgainstStub(true)
    expect(verdict).toMatchObject({ pass: true })
    expect(verdict.detail).toMatch(/^"bounded \d+" added and held by Lens; a 1048576-byte name refused 400 in \d+ ms, Lens holds no agent of it, and the app still lists \d+ agent\(s\)$/)
  }, 60_000)

  it('FAILs when the app reads the whole body', async () => {
    const { verdict } = await runAgainstStub(false)
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/an agent with a 1048576-byte name was taken: 20\d .*Lens holds 1 agent\(s\) with the oversized name, 10485\d\d characters long; Lens held 1 agent\(s\) before the oversized add and 2 after$/)
  }, 60_000)
})
