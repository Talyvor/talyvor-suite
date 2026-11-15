import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseConfig } from '../src/config.ts'
import type { Entry, Inventory } from '../src/coverage.ts'
import { deepJourneys } from '../src/deep.ts'
import { LAUNCH_CANNOT_PLAY, SCENARIO_AREAS, areaOf, hiddenPaths, hiddenPathsFrom, launchCut, launchInventory, launchLine, setUpCatalog } from '../src/launch.ts'
import { lightJourneys } from '../src/light.ts'
import { pocketJourneys } from '../src/pocketProblems/index.ts'
import { type ReportedRun, renderRun, renderSummary } from '../src/report.ts'
import { journeyFor } from '../src/scenarios.ts'

// B61.1 — the testers play the launch version only.

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../..')
const STREAMABLE = ['openai', 'anthropic', 'google', 'mistral', 'groq', 'bedrock', 'vllm']
const night = () => [...Array.from({ length: 100 }, (_, i) => journeyFor(i, 100, STREAMABLE)), ...deepJourneys(100, 3)]
const every = () => [...night(), ...lightJourneys(), ...pocketJourneys()]

describe('every scenario names its area (B61.1)', () => {
  it('places every scenario the night, the deep pass, the light pass and the Pocket pass can play, once, and nothing else', () => {
    const ids = new Set(every().flat().map((s) => s.id))
    const placed = Object.values(SCENARIO_AREAS).flat()
    expect([...ids].filter((id) => areaOf(id) === undefined), 'a new scenario must be placed in SCENARIO_AREAS (src/launch.ts)').toEqual([])
    expect(placed.filter((id, i) => placed.indexOf(id) !== i), 'placed twice').toEqual([])
    expect(placed.filter((id) => !ids.has(id)), 'no scenario has this id').toEqual([])
  })
})

describe('a launch run (B61.1)', () => {
  it('leaves out Chat, the Marketplace and Rooms and plays wallets, cards and payments', () => {
    const { journeys, cut } = launchCut(night())
    const played = new Set(journeys.flat().map((s) => s.id))
    for (const id of ['chat-first-message', 'marketplace-sale', 'rooms-private']) {
      expect(played.has(id)).toBe(false)
      expect(cut.left_out).toContain(id)
    }
    for (const id of ['agent-wallet', 'wallet-card', 'outside-payees']) expect(played.has(id)).toBe(true)
    expect(cut.left_out).not.toContain('agent-wallet')
    expect(cut.played).toBe(played.size)
  })

  it('keeps the light pass and the Pocket pass to the same list', () => {
    expect(launchCut(lightJourneys()).cut.left_out).toEqual([
      'agent-limit', 'agent-rules-unbypassable', 'capital', 'cross-company-test-money', 'keys-unlisted', 'known-answer', 'ledger-call-once',
      'ledger-moves-at-once', 'script-inert', 'spending-limit', 'webhook-unsigned',
    ])
    expect(launchCut(pocketJourneys()).cut.left_out).toEqual(['pocket-10', 'pocket-12', 'pocket-14', 'pocket-18', 'pocket-19'])
  })

  it('B61.63: leaves out a launch scenario it cannot play, and the report says why', () => {
    const { journeys, cut } = launchCut(night())
    expect(journeys.flat().some((s) => s.id === 'agent-limit')).toBe(false)
    expect(Object.keys(LAUNCH_CANNOT_PLAY).filter((id) => areaOf(id) === undefined), 'a scenario left out must be one the map places').toEqual([])
    expect(launchLine(cut)).toContain('`agent-limit`: its agent asks a model, through the old gateway')
    expect(journeys.flat().some((s) => s.id === 'agent-open-fund')).toBe(true)
  })

  it('is on with E2E_LAUNCH=1 or --launch, and off without', () => {
    const env = { E2E_APP_URL: 'http://app', E2E_LENS_URL: 'http://lens', LENS_SYNTHETIC_KEY: 'k' }
    expect(parseConfig([], { ...env, E2E_LAUNCH: '1' }).launch).toBe(true)
    expect(parseConfig(['--launch'], env).launch).toBe(true)
    expect(parseConfig([], env).launch).toBe(false)
  })

  it('says what it played and what it left out, in the report and in TESTERS.md', () => {
    const run: ReportedRun = {
      started_at: '2026-11-16T03:00:00.000Z', finished_at: '2026-11-16T03:40:00.000Z', app: 'https://app', lens: 'https://lens', users: 100,
      model: 'Claude Haiku 4.5', cap_usd: 5, spent_usd: 0.5, stopped_at_cap: false, counts: { PASS: 1, FAIL: 0, SKIP: 0, ERROR: 0 },
      outcomes: [{ scenario: 'pay-screen', title: 'pays', user: 0, workspace: 'ws0', status: 'PASS', detail: '', evidence: [] }],
      launch: { played: 1, left_out: ['chat-first-message', 'rooms-private'] },
    }
    expect(renderRun(run)).toContain('Launch version: 1 played, 2 left out (`chat-first-message`, `rooms-private`).')
    expect(renderSummary(run, 'r.md', [])).toContain('- **Launch version**: 1 played, 2 left out (`chat-first-message`, `rooms-private`).')
  })

  it('counts launch screens and routes only on the coverage map', async () => {
    const e = (kind: Entry['kind'], path: string): Entry => ({ kind, path, method: 'GET', feature: '' })
    const inv: Inventory = {
      screens: [e('screen', '/chat/*'), e('screen', '/rooms/:id'), e('screen', '/agents'), e('screen', '/pay')],
      bff: [e('bff', '/api/chat/conversations'), e('bff', '/api/rooms-directory'), e('bff', '/api/agents/{id}/loans'), e('bff', '/api/agents/{id}'), e('bff', '/api/payees')],
      lens: [e('lens', '/v1/rooms/{roomID}/messages'), e('lens', '/v1/workspaces/{ws}/marketplace/listings'), e('lens', '/v1/agents/{id}')],
      track: [e('track', '/v1/issues')], docs: [e('docs', '/v1/pages')], unreadCalls: [],
    }
    const app = await hiddenPaths(REPO, 'none')
    const lens = hiddenPathsFrom('', '', 'var routes = []struct {\n\tprefix string\n}{\n\t{"/v1/rooms", Rooms},\n\t{"/v1/workspaces/{}/marketplace", Marketplace},\n}\n').lens
    const kept = launchInventory(inv, { ...app, lens })
    expect(kept.screens.map((x) => x.path)).toEqual(['/agents', '/pay'])
    expect(kept.bff.map((x) => x.path)).toEqual(['/api/agents/{id}', '/api/payees'])
    expect(kept.lens.map((x) => x.path)).toEqual(['/v1/agents/{id}'])
    expect([kept.track, kept.docs]).toEqual([[], []])
  })
})

describe("the run's set-up and the old gateway's catalog (B61.49)", () => {
  const model = { id: 'm', provider: 'p', display_name: 'Model', input_per_1m: 1, output_per_1m: 2 }
  const gone = (): Promise<never> => Promise.reject(new Error('GET /v1/catalog/models: Lens answered 404: 404 page not found'))

  it('a launch run never asks for the catalog, and goes on with none', async () => {
    let asked = 0
    await expect(setUpCatalog(true, () => (asked++, gone()), 'Model')).resolves.toEqual([])
    expect(asked).toBe(0)
  })

  it('any other run reads it as before, and stops without its model', async () => {
    await expect(setUpCatalog(false, async () => [model], 'Model')).resolves.toEqual([model])
    await expect(setUpCatalog(false, async () => [model], 'Other')).rejects.toThrow('the catalog has no model named "Other"')
    await expect(setUpCatalog(false, gone, 'Model')).rejects.toThrow('Lens answered 404')
  })
})

it('the nightly plays the launch version unless its settings say otherwise (B61.1)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'e2e-launch-'))
  const who = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }
  const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, env: { ...process.env, ...who }, encoding: 'utf8' }).trim()
  try {
    git(dir, 'init', '-q', '--bare', '-b', 'main', 'origin.git')
    const seed = join(dir, 'seed')
    mkdirSync(join(seed, 'scripts'), { recursive: true })
    cpSync(join(REPO, 'scripts/e2e-nightly.sh'), join(seed, 'scripts/e2e-nightly.sh'))
    git(seed, 'init', '-q', '-b', 'main')
    git(seed, 'add', '.')
    git(seed, 'commit', '-qm', 'the harness')
    git(seed, 'push', '-q', join(dir, 'origin.git'), 'main')
    git(dir, 'clone', '-q', join(dir, 'origin.git'), 'testers')
    // node and pnpm stand in: node writes down what each pass was given.
    const bin = join(dir, 'bin')
    mkdirSync(bin)
    writeFileSync(join(bin, 'pnpm'), '#!/bin/sh\nexit 0\n')
    writeFileSync(join(bin, 'node'), `#!/bin/sh\necho "E2E_LAUNCH=\${E2E_LAUNCH-unset}" >>"${join(dir, 'passes')}"\necho 'summary: stub'\n`)
    chmodSync(join(bin, 'pnpm'), 0o755)
    chmodSync(join(bin, 'node'), 0o755)
    const night = (settings: string[]): string[] => {
      rmSync(join(dir, 'passes'), { force: true })
      writeFileSync(join(dir, 'e2e.env'), ['LENS_SYNTHETIC_KEY=k', ...settings].join('\n') + '\n')
      const r = spawnSync('bash', [join(dir, 'testers/scripts/e2e-nightly.sh'), '--now'],
        { env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, E2E_ENV_FILE: join(dir, 'e2e.env'), E2E_LAUNCH: '' }, encoding: 'utf8', timeout: 60_000 })
      expect(r.status).toBe(0)
      return readFileSync(join(dir, 'passes'), 'utf8').trim().split('\n')
    }
    // The Pocket problems pass and the night's run.
    expect(night([])).toEqual(['E2E_LAUNCH=1', 'E2E_LAUNCH=1'])
    expect(night(['E2E_LAUNCH=0'])).toEqual(['E2E_LAUNCH=0', 'E2E_LAUNCH=0'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
