// B28.288 — RATE LIMITS HOLD. Lens's rate limiter (talyvor-lens internal/ratelimit) counts each key's requests in Redis
// over a second, a minute and an hour — 100, 1,000 and 10,000 by default — and answers one past a window 429 with
// Retry-After before any handler runs. When Redis errors it lets every request through (it fails open), so a burst the
// limiter does not refuse is what that looks like from outside. One scenario, on a workspace of its own:
//   rate-limits-hold — the workspace's own token reads the workspace once (the control), then sends bursts of reads at
//        once until one is refused. A burst nothing refuses is the FAIL. Each refusal must be 429 with Retry-After in whole
//        seconds (at least one), the same seconds and the window it hit in its body, and X-RateLimit-Remaining 0; once the
//        longest Retry-After has passed, the next read is served.
// A read moves no money, so a burst costs nothing; the hour window (10,000) is never reached by the most this sends.

import { type ChildProcess, execFile, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { promisify } from 'node:util'
import { fail } from './bank.ts'
import { verdictOf } from './gateway.ts'
import { type BurstAnswer, LensClient, type SyntheticUser } from './lens.ts'
import { CannotTest, type Scenario } from './scenarios.ts'
import { freePort } from './trackEmail.ts'

const run = promisify(execFile)

/** How many reads go at once: past Lens's 100 a second a key, by half again. */
const AT_ONCE = 150
/** The most bursts sent before the limiter is judged to refuse none: 600 reads stay under the minute's 1,000. */
const BURSTS = 4
/** How long a read in a burst is given. */
const READ_MS = 20_000
/** The longest Retry-After waited out: the minute window, and the shared HA limiter's 60 s, by a second. */
const WAIT_MAX_S = 61

/** What is wrong with the refusals in `answers`: each must say when to come back, in its headers and its body. */
export function refusalFaults(answers: readonly BurstAnswer[]): string[] {
  const refused = answers.filter((a) => a.status === 429)
  const faults = new Map<string, number>()
  const add = (what: string) => faults.set(what, (faults.get(what) ?? 0) + 1)
  for (const a of refused) {
    const secs = a.retryAfter === null ? NaN : /^\d+$/.test(a.retryAfter.trim()) ? Number(a.retryAfter) : NaN
    if (a.retryAfter === null) add('carried no Retry-After')
    else if (!(secs >= 1)) add(`carried Retry-After "${a.retryAfter}", not a whole number of seconds of at least 1`)
    if (a.remaining !== '0') add(`carried X-RateLimit-Remaining ${a.remaining === null ? '(none)' : `"${a.remaining}"`}, not 0`)
    let body: { limit_type?: unknown; retry_after_seconds?: unknown } = {}
    try {
      body = JSON.parse(a.text) as typeof body
    } catch {
      add('answered no JSON body')
      continue
    }
    if (typeof body.limit_type !== 'string' || body.limit_type === '') add('named no limit_type (the window it hit)')
    if (Number.isFinite(secs) && body.retry_after_seconds !== secs) add(`said retry_after_seconds ${String(body.retry_after_seconds)} against Retry-After ${secs}`)
  }
  const out = [...faults].map(([what, n]) => `${n} of the ${refused.length} refusals ${what}`)
  const others = new Map<number, number>()
  for (const a of answers) if (a.status !== 200 && a.status !== 429 && a.status !== 0) others.set(a.status, (others.get(a.status) ?? 0) + 1)
  if (others.size > 0) out.push(`the burst was answered ${[...others].map(([s, n]) => `${s} ×${n}`).join(', ')}, neither served nor refused 429`)
  return out
}

export function rateLimitsHold(): Scenario {
  return {
    id: 'rate-limits-hold',
    owner: 'talyvor-lens',
    own: true,
    feature: 'Rate limits',
    title: `a burst of ${AT_ONCE} reads at once on the workspace's own token is refused past Lens's limit — 429 with Retry-After in whole seconds, ` +
      'the same in its body with the window it hit, X-RateLimit-Remaining 0 — never all served (as when the limiter fails open on a Redis error), and the next read once Retry-After has passed is served',
    run: async (ctx) => {
      const { lens } = ctx.env
      const { token, workspaceID } = ctx.app.user
      const path = `/v1/workspaces/${workspaceID}`
      const [control] = await lens.burst(token, path, 1, READ_MS)
      ctx.evidence.push({ note: `the control, one read of the workspace: ${control.status}, X-RateLimit-Remaining ${control.remaining ?? '(none)'}` })
      if (control.status !== 200) return fail(`one read of the workspace on its own token answered ${control.status} "${control.text}" before any burst`)

      const all: BurstAnswer[] = []
      let bursts = 0
      while (bursts < BURSTS && !all.some((a) => a.status === 429)) {
        all.push(...(await lens.burst(token, path, AT_ONCE, READ_MS)))
        bursts++
      }
      const served = all.filter((a) => a.status === 200).length
      const refused = all.filter((a) => a.status === 429)
      const lost = all.filter((a) => a.status === 0)
      ctx.evidence.push({ note: `${bursts} burst(s) of ${AT_ONCE} reads at once: ${served} served, ${refused.length} refused 429, ${lost.length} not answered` +
        (refused.length > 0 ? `; the first refusal: Retry-After ${refused[0].retryAfter ?? '(none)'}, ${refused[0].text.trim()}` : '') })
      if (lost.length > all.length / 2) throw new Error(`${lost.length} of ${all.length} reads in the burst were not answered: ${lost[0].text}`)
      if (refused.length === 0) {
        return fail(`${all.length} reads of the workspace on one token, in ${bursts} bursts of ${AT_ONCE} at once, were none of them refused (${served} served) — ` +
          "Lens's limiter (100 a second a key) let the burst through, as it does when Redis errors and it fails open")
      }
      const wrong = refusalFaults(all)

      // It lets go: once the longest Retry-After it gave has passed, the next read is served.
      const wait = Math.min(Math.max(...refused.map((a) => Number(a.retryAfter) || 1)), WAIT_MAX_S)
      await sleep(wait * 1000 + 500)
      const [after] = await lens.burst(token, path, 1, READ_MS)
      ctx.evidence.push({ note: `${wait} s later, once the longest Retry-After had passed: ${after.status}` })
      if (after.status !== 200) wrong.push(`the read ${wait} s later, once the longest Retry-After had passed, answered ${after.status} "${after.text}": the limiter does not let go`)
      return verdictOf(wrong, `of ${all.length} reads sent in ${bursts} burst(s) of ${AT_ONCE} at once, ${served} were served and ${refused.length} refused 429 with Retry-After ` +
        `(${[...new Set(refused.map((a) => a.retryAfter))].join(', ')} s), the window in the body and nothing remaining; the read ${wait} s later was served`)
    },
  }
}

// B39.35 — ONE WORKSPACE'S OWN LIMITS. An operator gives one workspace limits of its own on Lens's admin key (talyvor-lens
// B39.9, PUT /v1/admin/workspaces/{ws}/rate-limits); every instance picks them up within 30 s, and every other workspace
// keeps 100 a second and 1,000 a minute. One scenario, on two workspaces of its own:
//   workspace-limits-raised — A is raised to 200 a second and 5,000 a minute, and GET reads that back as its own. A and B
//        then each send 1,001 reads of their workspace within one minute, never 100 in a second: A's 1,001st is served and
//        B's is refused 429 for the minute. A's limits deleted, GET says it is back on the defaults.

/** What A is raised to; its hour is left at the default. */
const RAISED = { requests_per_second: 200, requests_per_minute: 5000 }
const DEFAULT_LIMITS = { requests_per_second: 100, requests_per_minute: 1000, requests_per_hour: 10_000 }
/** Reads sent at once each second: two such steps in one of Lens's one-second windows still stay under 100. */
const STEP = 40
/** Lens reloads the limits every 30 s; a minute also lets any minute window the workspaces' set-up opened run out. */
const SETTLE_MS = 61_000
/** The 1,001 reads must all fall in the minute window the first of them opened. */
const WITHIN_MS = 55_000

/** A workspace's 1,001 reads: the first 1,000, `STEP` a second, then the 1,001st alone once they are all answered. */
export interface ThousandAndOne { first: BurstAnswer[]; last: BurstAnswer }

async function thousandAndOne(lens: LensClient, user: SyntheticUser): Promise<ThousandAndOne> {
  const path = `/v1/workspaces/${user.workspaceID}`
  const first: BurstAnswer[] = []
  while (first.length < 1000) {
    const t0 = Date.now()
    first.push(...(await lens.burst(user.token, path, Math.min(STEP, 1000 - first.length), READ_MS)))
    await sleep(Math.max(0, 1000 - (Date.now() - t0)))
  }
  const [last] = await lens.burst(user.token, path, 1, READ_MS)
  return { first, last }
}

const limitTypeOf = (a: BurstAnswer): string => {
  try {
    return String((JSON.parse(a.text) as { limit_type?: unknown }).limit_type)
  } catch {
    return '(no JSON body)'
  }
}

/** What is wrong with the raised workspace's reads and the default one's: A's all served, B's 1,001st refused for the minute. */
export function raisedLimitFaults(raised: ThousandAndOne, plain: ThousandAndOne): string[] {
  const wrong: string[] = []
  const notServed = (as: BurstAnswer[]) => as.filter((a) => a.status !== 200)
  const said = (as: BurstAnswer[]) => `${as[0].status}${as[0].status === 429 ? ` (${limitTypeOf(as[0])})` : ''} "${as[0].text.trim()}"`
  for (const [who, r] of [['the raised workspace', raised], ['the default workspace', plain]] as const) {
    const off = notServed(r.first)
    if (off.length > 0) wrong.push(`${off.length} of ${who}'s first 1,000 reads, under 100 a second, were not served; the first: ${said(off)}`)
  }
  if (raised.last.status !== 200) wrong.push(`the raised workspace's 1,001st read in the minute answered ${said([raised.last])}: its 5,000 a minute is not applied`)
  if (plain.last.status !== 429) wrong.push(`the default workspace's 1,001st read in the minute answered ${plain.last.status}, not 429: raising one workspace raised another`)
  else if (limitTypeOf(plain.last) !== 'minute') wrong.push(`the default workspace's 1,001st read was refused for the window "${limitTypeOf(plain.last)}", not "minute"`)
  return wrong
}

export function workspaceLimitsRaised(): Scenario {
  return {
    id: 'workspace-limits-raised',
    owner: 'talyvor-lens',
    own: true,
    items: ['B39.9'],
    feature: 'Rate limits',
    title: "an operator raises one workspace to 5,000 requests a minute on Lens's admin key: its 1,001st read in a minute is served, " +
      "another workspace's 1,001st is refused 429 for the minute, and once deleted the workspace reads back on the default limits",
    run: async (ctx) => {
      const { lens } = ctx.env
      if (!lens.canAdmin) throw new CannotTest("needs Lens's global admin key to set a workspace's limits: LENS_API_KEY, the key Lens boots with")
      const [a, b] = await lens.createUsers(2)
      const limitsPath = `/v1/admin/workspaces/${a.workspaceID}/rate-limits`
      const limits = async (method: string, body?: unknown) => {
        const r = await lens.asAdmin(method, limitsPath, body)
        ctx.evidence.push({ note: `${method} ${limitsPath}${body === undefined ? '' : ` ${JSON.stringify(body)}`} on the admin key`, answer: `${r.status} ${r.text.trim()}` })
        if (r.status === 401) throw new CannotTest(`Lens refused the key in LENS_API_KEY as its admin key: ${r.text.trim()}`)
        return r
      }
      const wrong: string[] = []
      const readsBack = (text: string, want: object & { custom: boolean }, when: string) => {
        const got = JSON.parse(text) as Record<string, unknown>
        const off = Object.entries(want).filter(([k, v]) => got[k] !== v)
        if (off.length > 0) wrong.push(`GET ${when} read ${off.map(([k]) => `${k} ${String(got[k])}`).join(', ')}, not ${off.map(([k, v]) => `${k} ${String(v)}`).join(', ')}`)
      }

      const put = await limits('PUT', RAISED)
      if (put.status !== 200) return fail(`raising the workspace's limits on the admin key answered ${put.status} "${put.text.trim()}"`)
      const raised = await limits('GET')
      if (raised.status !== 200) return fail(`reading the raised workspace's limits answered ${raised.status} "${raised.text.trim()}"`)
      readsBack(raised.text, { custom: true, ...DEFAULT_LIMITS, ...RAISED }, 'after the raise')

      await sleep(SETTLE_MS)
      const t0 = Date.now()
      const [ra, rb] = await Promise.all([thousandAndOne(lens, a), thousandAndOne(lens, b)])
      const took = Date.now() - t0
      const lost = [...ra.first, ra.last, ...rb.first, rb.last].filter((x) => x.status === 0)
      ctx.evidence.push({ note: `1,001 reads from each workspace, ${STEP} a second, in ${(took / 1000).toFixed(1)} s: ` +
        `the raised one's 1,001st ${ra.last.status}, the default one's ${rb.last.status} ${rb.last.text.trim()}` })
      if (lost.length > 0) throw new Error(`${lost.length} of the 2,002 reads were not answered: ${lost[0].text}`)
      if (took > WITHIN_MS) throw new Error(`the 1,001 reads took ${(took / 1000).toFixed(1)} s, past the one minute window they are judged in`)
      wrong.push(...raisedLimitFaults(ra, rb))

      const del = await limits('DELETE')
      if (del.status !== 200) wrong.push(`deleting the workspace's limits answered ${del.status} "${del.text.trim()}"`)
      const after = await limits('GET')
      if (after.status !== 200) wrong.push(`reading the workspace's limits once deleted answered ${after.status} "${after.text.trim()}"`)
      else readsBack(after.text, { custom: false, ...DEFAULT_LIMITS }, 'once deleted')
      return verdictOf(wrong, `raised to ${RAISED.requests_per_second} a second and ${RAISED.requests_per_minute} a minute, the workspace's 1,001st read in ` +
        `${(took / 1000).toFixed(1)} s was served while another workspace's was refused 429 for the minute; deleted, it read back custom false at the defaults`)
    },
  }
}

// B28.288, its Redis-down leg — THE LIMITER HOLDS WITH REDIS GONE. talyvor-lens B28.251: on a Redis error each window is
// counted in the instance's own memory and lens_rate_limit_redis_errors_total moves, so the outage alerts
// (LensRateLimitRedisDown). The deployed Lens's Redis is one the run never reaches, so this Lens is the run's own:
//   rate-limits-redis-down — a Lens built from the run's checkout (--lens-src), on a Postgres, a Redis and a NATS of its
//        own in Docker, with keys this run makes. A synthetic workspace reads itself once (the control) and the counter is
//        read on the admin key; then the Redis is removed and the same bursts as rate-limits-hold are sent. A burst nothing
//        refuses is the FAIL (the limiter failed open), each refusal must say when to come back as rate-limits-hold's do,
//        and the counter must have risen by at least one for each read sent with Redis gone.

/** The images Lens's own compose file runs, unpinned: this Lens lives for one scenario. */
const LENS_PG_IMAGE = 'pgvector/pgvector:pg16'
const LENS_REDIS_IMAGE = 'redis:7-alpine'
const LENS_NATS_IMAGE = 'nats:2.10-alpine'
/** How long Postgres is given to take the migrations, and Lens to answer /healthz. */
const LENS_BOOT_MS = 180_000
const REDIS_ERRORS = 'lens_rate_limit_redis_errors_total'

/** A Prometheus counter's value in `text` (the /metrics page), summed over its labels; null when the page has none. */
export function counterOf(text: string, name: string): number | null {
  let sum: number | null = null
  for (const line of text.split('\n')) {
    const m = /^([a-zA-Z_:][\w:]*)(\{[^}]*\})?\s+(\S+)/.exec(line)
    if (m === null || m[1] !== name || !Number.isFinite(Number(m[3]))) continue
    sum = (sum ?? 0) + Number(m[3])
  }
  return sum
}

/** What is wrong with a Lens whose Redis is gone: it must still refuse past the limit, and count every Redis error. */
export function redisDownFaults(answers: readonly BurstAnswer[], before: number | null, after: number | null): string[] {
  const wrong: string[] = []
  const reads = answers.filter((a) => a.status !== 0).length
  if (!answers.some((a) => a.status === 429)) {
    wrong.push(`with Redis gone, ${answers.length} reads of the workspace on one token were none of them refused ` +
      `(${answers.filter((a) => a.status === 200).length} served): the limiter fails open`)
  }
  wrong.push(...refusalFaults(answers))
  if (before === null || after === null) wrong.push(`the admin key's /metrics carried no ${REDIS_ERRORS} ${before === null ? 'before' : 'after'} Redis went`)
  else if (after - before < reads) wrong.push(`${REDIS_ERRORS} rose by ${after - before} over ${reads} reads with Redis gone, not at least one a read: the outage would not alert`)
  return wrong
}

export function rateLimitsRedisDown(): Scenario {
  return {
    id: 'rate-limits-redis-down',
    owner: 'talyvor-lens',
    items: ['B28.251', 'B28.288'],
    feature: 'Rate limits',
    title: `with its Redis gone, a Lens of the run's own still refuses a burst of ${AT_ONCE} reads at once on one token past its limit — 429 with ` +
      `Retry-After, never all served — and ${REDIS_ERRORS} rises by at least one for each read`,
    run: async (ctx) => {
      const src = ctx.env.lensSrc
      if (src === 'none' || !existsSync(join(src, 'cmd', 'lens', 'main.go'))) throw new CannotTest(`no Lens checkout at ${src} (--lens-src)`)
      await run('docker', ['info', '--format', '{{.ServerVersion}}']).catch(() => { throw new CannotTest("Docker is not running on this machine, so no Redis for the run's own Lens") })
      await run('go', ['version']).catch(() => { throw new CannotTest('Go is not on the PATH, so Lens cannot be built') })

      const probe = randomBytes(6).toString('hex')
      const name = (what: string) => `e2e-lens-rl-${probe}-${what}`
      const dir = await mkdtemp(join(tmpdir(), 'e2e-lens-rl-'))
      const containers: string[] = []
      const start = async (what: string, image: string, port: number, opts: string[] = [], cmd: string[] = []): Promise<string> => {
        await run('docker', ['run', '-d', '--rm', '--name', name(what), '-p', `127.0.0.1::${port}`, ...opts, image, ...cmd])
        containers.push(name(what))
        return (await run('docker', ['port', name(what), `${port}/tcp`])).stdout.trim().split('\n')[0].split(':').pop() ?? ''
      }
      let lensProc: ChildProcess | undefined
      let log = ''
      try {
        const pgPort = await start('pg', LENS_PG_IMAGE, 5432, ['-e', 'POSTGRES_PASSWORD=e2e', '-e', 'POSTGRES_DB=lens'])
        const redisPort = await start('redis', LENS_REDIS_IMAGE, 6379)
        const natsPort = await start('nats', LENS_NATS_IMAGE, 4222, [], ['-js'])
        const bin = join(dir, 'lens')
        await run('go', ['build', '-o', bin, './cmd/lens'], { cwd: src, maxBuffer: 16 * 1024 * 1024 })

        // Nothing of the run's own Lens settings reaches this one: every LENS_ variable it boots with is set here.
        const adminKey = randomBytes(24).toString('hex')
        const syntheticKey = randomBytes(24).toString('hex')
        const listen = await freePort()
        const base = `http://127.0.0.1:${listen}`
        const env: NodeJS.ProcessEnv = {
          ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('LENS_'))),
          LENS_DATABASE_URL: `postgres://postgres:e2e@127.0.0.1:${pgPort}/lens?sslmode=disable`,
          LENS_REDIS_URL: `redis://127.0.0.1:${redisPort}`,
          LENS_NATS_URL: `nats://127.0.0.1:${natsPort}`,
          LENS_LISTEN_ADDR: `127.0.0.1:${listen}`,
          LENS_API_KEY: adminKey,
          LENS_SYNTHETIC_KEY: syntheticKey,
          // No call reaches a provider: the keys are required and never used, and the catalog poller is off.
          LENS_OPENAI_API_KEY: 'sk-e2e-unused',
          LENS_ANTHROPIC_API_KEY: 'sk-ant-e2e-unused',
          LENS_MODEL_WATCH_ENABLED: 'false',
        }
        // The port answers before the image's first-boot init is done, so the migration is tried until it takes.
        const until = Date.now() + LENS_BOOT_MS
        for (;;) {
          const m = await run(bin, ['migrate', 'up'], { env, maxBuffer: 16 * 1024 * 1024 }).then(() => '', (e: { stderr?: string }) => e.stderr ?? String(e))
          if (m === '') break
          if (Date.now() > until) return fail(`the run's own Lens's migrations did not apply: ${m.slice(-300)}`)
          await sleep(2_000)
        }
        lensProc = spawn(bin, [], { env, stdio: ['ignore', 'pipe', 'pipe'] })
        const keep = (d: Buffer) => { log = (log + d.toString()).slice(-4_000) }
        lensProc.stdout?.on('data', keep)
        lensProc.stderr?.on('data', keep)
        while (await fetch(`${base}/healthz`).then((r) => !r.ok, () => true)) {
          if (Date.now() > until || lensProc.exitCode !== null) return fail(`the run's own Lens did not come up: ${log.slice(-400)}`)
          await sleep(1_000)
        }

        const lens = new LensClient(base, syntheticKey, undefined, { scenario: 'rate-limits-redis-down', user: -1 }, new Map(), '', adminKey)
        const [user] = await lens.createUsers(1, undefined, { confirm: false })
        const path = `/v1/workspaces/${user.workspaceID}`
        // Asked unencoded: Lens's /metrics, asked for gzip, answers it gzipped twice (FOUND.md, 26 Nov).
        const errors = async () => {
          const m = await lens.as(adminKey, 'GET', '/metrics', undefined, { 'Accept-Encoding': 'identity' })
          if (m.status !== 200) throw new Error(`GET /metrics on the run's own Lens's admin key answered ${m.status} ${m.text.slice(0, 200)}`)
          return counterOf(m.text, REDIS_ERRORS)
        }
        const [control] = await lens.burst(user.token, path, 1, READ_MS)
        if (control.status !== 200) return fail(`one read of the workspace on its own token answered ${control.status} "${control.text}" with Redis up`)
        const before = await errors()
        ctx.evidence.push({ note: `with Redis up: the control read ${control.status}, ${REDIS_ERRORS} ${before ?? '(not on /metrics)'}` })

        await run('docker', ['rm', '-f', name('redis')])
        const all: BurstAnswer[] = []
        let bursts = 0
        while (bursts < BURSTS && !all.some((a) => a.status === 429)) {
          all.push(...(await lens.burst(user.token, path, AT_ONCE, READ_MS)))
          bursts++
        }
        const after = await errors()
        const refused = all.filter((a) => a.status === 429)
        const lost = all.filter((a) => a.status === 0)
        ctx.evidence.push({ note: `with Redis gone, ${bursts} burst(s) of ${AT_ONCE} reads at once: ${all.filter((a) => a.status === 200).length} served, ` +
          `${refused.length} refused 429, ${lost.length} not answered; ${REDIS_ERRORS} ${after ?? '(not on /metrics)'}` +
          (refused.length > 0 ? `; the first refusal: Retry-After ${refused[0].retryAfter ?? '(none)'}, ${refused[0].text.trim()}` : '') })
        if (lost.length > all.length / 2) throw new Error(`${lost.length} of ${all.length} reads in the burst were not answered: ${lost[0].text}`)
        return verdictOf(redisDownFaults(all, before, after), `with Redis gone, of ${all.length} reads sent in ${bursts} burst(s) of ${AT_ONCE} at once ` +
          `${all.length - refused.length} were served and ${refused.length} refused 429 with Retry-After, and ${REDIS_ERRORS} rose from ${before} to ${after}`)
      } finally {
        lensProc?.kill()
        for (const c of containers) await run('docker', ['rm', '-f', c]).catch(() => undefined)
        await rm(dir, { recursive: true, force: true })
      }
    },
  }
}
