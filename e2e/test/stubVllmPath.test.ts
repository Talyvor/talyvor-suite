import { type ChildProcess, spawn } from 'node:child_process'
import { createServer as createHttpServer, type Server } from 'node:http'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { LensClient } from '../src/lens.ts'

// B43.2 — the stub Lens's vLLM provider forwards only the paths vLLM serves: a path a caller names past them is answered
// 404 and never reaches the upstream.

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number }
      s.close(() => resolve(port))
    })
  })
}

let stub: ChildProcess | undefined
let upstream: Server | undefined
afterEach(() => {
  stub?.kill()
  upstream?.close()
  stub = upstream = undefined
})

describe('stub Lens vLLM paths (B43.2)', () => {
  it('forwards chat completions and refuses any other path before it leaves', async () => {
    const hits: string[] = []
    const up = createHttpServer((req, res) => {
      hits.push(req.url ?? '')
      res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}')
    })
    upstream = up
    const upPort = await new Promise<number>((resolve) => up.listen(0, '127.0.0.1', () => resolve((up.address() as { port: number }).port)))
    const port = await freePort()
    stub = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', new URL('../selftest/stub-lens.ts', import.meta.url).pathname], {
      env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'vllm-key', LENS_VLLM_BASE_URL: `http://127.0.0.1:${upPort}`, STUB_BREAK: '' },
      stdio: ['ignore', 'pipe', 'inherit'],
    })
    await new Promise<void>((resolve, reject) => {
      stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
      stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
    })
    const [user] = await new LensClient(`http://127.0.0.1:${port}`, 'vllm-key').createUsers(1)
    const post = (path: string) =>
      fetch(`http://127.0.0.1:${port}/v1/proxy/vllm/${path}`, { method: 'POST', headers: { Authorization: `Bearer ${user.token}` }, body: '{}' }).then((r) => r.status)

    expect(await post('v1/chat/completions')).toBe(200)
    expect(await post('admin/shutdown')).toBe(404)
    expect(await post('v1/chat/completions%2F..%2F..%2Fadmin')).toBe(404)
    expect(hits).toEqual(['/v1/chat/completions'])
  })
})
