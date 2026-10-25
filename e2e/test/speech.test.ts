import { type ChildProcess, spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { LensClient } from '../src/lens.ts'
import type { ScenarioCtx, Verdict } from '../src/scenarios.ts'
import { speechThroughLens, wavSeconds } from '../src/speech.ts'
import { VOICE_CLIP } from '../src/voiceChat.ts'

// B40.32 — speech-through-lens against the stub Lens, which charges an agent's speech call on its statement at the catalog's
// price as Lens does: it passes with speech configured and without it, and FAILs when a call is charged twice.

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

async function runAgainstStub(speech: string, broken: string): Promise<Verdict> {
  const port = await freePort()
  stub = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', new URL('../selftest/stub-lens.ts', import.meta.url).pathname], {
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'speech', STUB_SPEECH: speech, STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'speech')
  const [user] = await lens.createUsers(1)
  const ctx = { env: { lens }, app: { user }, evidence: [] } as unknown as ScenarioCtx
  return speechThroughLens().run(ctx)
}

describe('speech-through-lens (B40.32)', () => {
  it('reads the clip as 1.91 s from its WAV header', () => {
    expect(wavSeconds(readFileSync(VOICE_CLIP))).toBeCloseTo(61238 / 32000, 9)
  })

  it('passes when each call is one charge at the catalog price', async () => {
    const verdict = await runAgainstStub('on', '')
    expect(verdict).toMatchObject({ pass: true })
    expect(verdict.detail).toMatch(/clip 1372 µLXC .* the sentence \d+ µLXC at 30\/1M chars/)
  })

  it('passes on a Lens without speech, both routes saying so', async () => {
    expect(await runAgainstStub('', '')).toMatchObject({ pass: true, detail: expect.stringMatching(/^speech is not configured on this Lens/) })
  })

  it('FAILs when a speech call is charged twice', async () => {
    const verdict = await runAgainstStub('on', 'speech-twice')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^the transcription: 2 charges on the agent's statement for one call.*the speech: 2 charges/)
  })
}, 60_000)
