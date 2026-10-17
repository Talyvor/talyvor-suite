// B39.26 — TRACK EMAILS A MEMBER WHEN AN ISSUE IS ASSIGNED TO THEM. B39.15 (talyvor-track internal/email) writes one
// notification_outbox row per mail and sends it over SMTP. One scenario, once a run:
//   track-assign-email — a Track built from the run's Track checkout (--track-src), on a Postgres of its own in Docker,
//     started with TRACK_EMAIL_ENABLED=true and its SMTP pointed at a stub this run serves on loopback (never
//     Cloudflare). The owner assigns an issue to a second member: exactly one outbox row for that member, sent_at set,
//     and exactly one mail at the stub, to their address. The member then turns issue.assigned off
//     (PUT …/notification-preferences/issue.assigned {"email":false}), the owner reassigns the issue to them, and no new
//     row is written and no mail sent.
// The deployed Track's outbox is in a database the run never connects to, so this Track is the run's own.

import { type ChildProcess, execFile, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { type AddressInfo, createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { CannotTest, type Scenario } from './scenarios.ts'

const run = promisify(execFile)
/** The image Track's own real-Postgres tests use: its migrations create the vector extension. */
const PG_IMAGE = 'pgvector/pgvector:pg16'
/** How long Postgres is given to take a connection, and Track to answer /healthz. */
const BOOT_MS = 120_000
/** Track's sink sends at once when a row is queued and every 30 s besides (cmd/track/main.go). */
const MAIL_MS = 60_000
/** After the reassignment, this long for a row or a mail that must not come — past one 30 s sweep. */
const QUIET_MS = 35_000

export interface Mail { from: string; to: string[]; data: string }

/** A plain SMTP server on loopback that keeps every message: no STARTTLS, which Track allows only to a loopback host. */
export async function smtpStub(): Promise<{ port: number; got: Mail[]; close: () => Promise<void> }> {
  const got: Mail[] = []
  const server = createServer((sock) => {
    let buf = ''
    let mail: Mail = { from: '', to: [], data: '' }
    let inData = false
    const say = (line: string) => sock.write(`${line}\r\n`)
    say('220 e2e-smtp-stub')
    sock.on('data', (chunk: Buffer) => {
      buf += chunk.toString('utf8')
      for (;;) {
        if (inData) {
          const end = buf.indexOf('\r\n.\r\n')
          if (end < 0) return
          mail.data = buf.slice(0, end).replace(/^\.\./gm, '.')
          buf = buf.slice(end + 5)
          got.push(mail)
          mail = { from: '', to: [], data: '' }
          inData = false
          say('250 kept')
          continue
        }
        const nl = buf.indexOf('\r\n')
        if (nl < 0) return
        const line = buf.slice(0, nl)
        buf = buf.slice(nl + 2)
        const verb = line.slice(0, 4).toUpperCase()
        if (verb === 'EHLO' || verb === 'HELO') say('250 e2e-smtp-stub')
        else if (verb === 'MAIL') { mail.from = /<([^>]*)>/.exec(line)?.[1] ?? ''; say('250 ok') }
        else if (verb === 'RCPT') { mail.to.push(/<([^>]*)>/.exec(line)?.[1] ?? ''); say('250 ok') }
        else if (verb === 'DATA') { inData = true; say('354 go on') }
        else if (verb === 'QUIT') { say('221 bye'); sock.end() }
        else say('250 ok')
      }
    })
    sock.on('error', () => undefined)
  })
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok))
  return { port: (server.address() as AddressInfo).port, got, close: () => new Promise((ok) => server.close(() => ok())) }
}

interface Who { email: string; sub: string }

export function trackAssignEmail(seed: number): Scenario {
  return {
    id: 'track-assign-email',
    owner: 'talyvor-track',
    items: ['B39.15', 'B39.26'],
    feature: 'Track assignment email',
    title: 'Track assignment email: an issue assigned to a second member writes exactly one outbox row, sent, and one mail ' +
      'at the SMTP stub; once they turn issue.assigned off, a reassignment writes no row and sends nothing',
    run: async (ctx) => {
      const src = ctx.env.trackSrc
      if (src === 'none' || !existsSync(join(src, 'cmd', 'track', 'main.go'))) throw new CannotTest(`no Track checkout at ${src} (--track-src)`)
      await run('docker', ['info', '--format', '{{.ServerVersion}}']).catch(() => { throw new CannotTest('Docker is not running on this machine, so no Postgres for the run\'s own Track') })
      await run('go', ['version']).catch(() => { throw new CannotTest('Go is not on the PATH, so Track cannot be built') })

      const probe = randomBytes(6).toString('hex')
      const pg = `e2e-track-mail-${probe}`
      const dir = await mkdtemp(join(tmpdir(), 'e2e-track-mail-'))
      const smtp = await smtpStub()
      let track: ChildProcess | undefined
      let log = ''
      try {
        await run('docker', ['run', '-d', '--rm', '--name', pg, '-e', 'POSTGRES_PASSWORD=e2e', '-e', 'POSTGRES_DB=track', '-p', '127.0.0.1::5432', PG_IMAGE])
        const pgPort = (await run('docker', ['port', pg, '5432/tcp'])).stdout.trim().split('\n')[0].split(':').pop()
        const dbURL = `postgres://postgres:e2e@127.0.0.1:${pgPort}/track?sslmode=disable`
        const bin = join(dir, 'track')
        await run('go', ['build', '-o', bin, './cmd/track'], { cwd: src, maxBuffer: 16 * 1024 * 1024 })
        // The port answers before the image's first-boot init is done, so the migration is tried until it takes.
        const until = Date.now() + BOOT_MS
        for (;;) {
          const m = await run(bin, ['migrate', 'up'], { env: { ...process.env, TRACK_DATABASE_URL: dbURL } }).then(() => '', (e: { stderr?: string }) => e.stderr ?? String(e))
          if (m === '') break
          if (Date.now() > until) return { pass: false, detail: `Track's migrations did not apply: ${m.slice(-300)}` }
          await new Promise((ok) => setTimeout(ok, 2_000))
        }

        const secret = randomBytes(32).toString('hex')
        const listen = await freePort()
        const base = `http://127.0.0.1:${listen}`
        track = spawn(bin, [], {
          env: {
            ...process.env, TRACK_DATABASE_URL: dbURL, GATEWAY_AUTH_SECRET: secret, TRACK_LISTEN_ADDR: `127.0.0.1:${listen}`,
            TRACK_EMAIL_ENABLED: 'true', TRACK_SMTP_HOST: '127.0.0.1', TRACK_SMTP_PORT: String(smtp.port), TRACK_EMAIL_FROM: 'notifications@talyvor.test',
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        })
        track.stdout?.on('data', (d: Buffer) => { log = (log + d.toString()).slice(-4_000) })
        track.stderr?.on('data', (d: Buffer) => { log = (log + d.toString()).slice(-4_000) })
        while (await fetch(`${base}/healthz`).then((r) => !r.ok, () => true)) {
          if (Date.now() > until || track.exitCode !== null) return { pass: false, detail: `Track did not come up: ${log.slice(-400)}` }
          await new Promise((ok) => setTimeout(ok, 1_000))
        }

        const call = async <T>(who: Who, method: string, path: string, body?: unknown): Promise<{ status: number; value: T; text: string }> => {
          const r = await fetch(`${base}/v1${path}`, {
            method,
            headers: { 'X-Gateway-Auth': secret, 'X-User-Email': who.email, 'X-User-Id': who.sub, 'X-Auth-Iss': 'e2e', 'Content-Type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body),
          })
          const text = await r.text()
          let value: T
          try { value = JSON.parse(text) as T } catch { value = undefined as T }
          return { status: r.status, value, text: text.slice(0, 300) }
        }
        const sql = async (q: string) => (await run('docker', ['exec', pg, 'psql', '-U', 'postgres', '-d', 'track', '-tAc', q])).stdout.trim()

        const owner: Who = { email: `owner-${probe}@e2e.talyvor.test`, sub: `owner-${probe}` }
        const second: Who = { email: `member-${probe}@e2e.talyvor.test`, sub: `member-${probe}` }
        const boot = await call<{ workspace_id: string }>(owner, 'POST', '/bootstrap')
        if (boot.status !== 200) return { pass: false, detail: `the owner's workspace was not made: ${boot.status} ${boot.text}` }
        const ws = encodeURIComponent(boot.value.workspace_id)
        const added = await call<{ id: string }>(owner, 'POST', `/workspaces/${ws}/members`, { email: second.email, role: 'member' })
        if (added.status !== 201 && added.status !== 200) return { pass: false, detail: `the second member was not added: ${added.status} ${added.text}` }
        const roster = await call<{ id: string; email: string }[]>(owner, 'GET', `/workspaces/${ws}/members`)
        const ownerID = roster.value?.find((m) => m.email === owner.email)?.id
        const memberID = added.value.id
        if (ownerID === undefined || !/^[0-9a-f-]{36}$/.test(memberID)) return { pass: false, detail: `the roster does not name both members: ${roster.text}` }
        const issue = await call<{ id: string }>(owner, 'POST', `/workspaces/${ws}/issues`, { title: `Assigned by e2e ${seed} ${probe}` })
        if (issue.status !== 201 && issue.status !== 200) return { pass: false, detail: `the issue was not made: ${issue.status} ${issue.text}` }
        const assign = (to: string) => call<{ assignee_id?: string }>(owner, 'PATCH', `/workspaces/${ws}/issues/${encodeURIComponent(issue.value.id)}`, { assignee_id: to })
        const rows = async () => {
          const [n, sent] = (await sql(`SELECT count(*), count(sent_at) FROM notification_outbox WHERE member_id = '${memberID}'`)).split('|').map(Number)
          return { n, sent }
        }

        const first = await assign(memberID)
        if (first.status !== 200 || first.value?.assignee_id !== memberID) return { pass: false, detail: `the issue was not assigned to the second member: ${first.status} ${first.text}` }
        const sentAt = Date.now()
        let r = await rows()
        while ((r.sent < 1 || smtp.got.length < 1) && Date.now() - sentAt < MAIL_MS) {
          await new Promise((ok) => setTimeout(ok, 1_000))
          r = await rows()
        }
        ctx.evidence.push({ note: `after the assignment: ${r.n} outbox row(s) for the member, ${r.sent} sent; ${smtp.got.length} mail(s) at the stub: ` +
          smtp.got.map((m) => `from ${m.from} to ${m.to.join(',')} ${/^Subject: .*$/m.exec(m.data)?.[0] ?? ''}`).join(' | ') })
        if (r.n !== 1 || r.sent !== 1) return { pass: false, detail: `one assignment wrote ${r.n} outbox row(s) for the member, ${r.sent} sent — not exactly one, sent. Track: ${log.slice(-300)}` }
        if (smtp.got.length !== 1 || smtp.got[0].to.join(',') !== second.email) {
          return { pass: false, detail: `the stub got ${smtp.got.length} mail(s) (to ${smtp.got.map((m) => m.to.join(',')).join('; ')}), not exactly one to ${second.email}` }
        }

        const off = await call<{ email: boolean }>(second, 'PUT', `/workspaces/${ws}/notification-preferences/issue.assigned`, { email: false })
        if (off.status !== 200 || off.value?.email !== false) return { pass: false, detail: `the member could not turn issue.assigned off: ${off.status} ${off.text}` }
        const away = await assign(ownerID)
        const back = await assign(memberID)
        if (away.status !== 200 || back.status !== 200 || back.value?.assignee_id !== memberID) {
          return { pass: false, detail: `the reassignment did not take: ${away.status} ${away.text}; ${back.status} ${back.text}` }
        }
        await new Promise((ok) => setTimeout(ok, QUIET_MS))
        r = await rows()
        ctx.evidence.push({ note: `after turning issue.assigned off and the reassignment: ${r.n} outbox row(s) for the member; ${smtp.got.length} mail(s) at the stub` })
        if (r.n !== 1) return { pass: false, detail: `with issue.assigned off, the reassignment still wrote ${r.n - 1} new outbox row(s)` }
        if (smtp.got.length !== 1) return { pass: false, detail: `with issue.assigned off, the stub got ${smtp.got.length - 1} more mail(s)` }
        return { pass: true, detail: `one assignment, one outbox row sent and one mail to ${second.email}; with issue.assigned off, a reassignment wrote no row and sent nothing` }
      } finally {
        track?.kill()
        await run('docker', ['rm', '-f', pg]).catch(() => undefined)
        await smtp.close()
        await rm(dir, { recursive: true, force: true })
      }
    },
  }
}

async function freePort(): Promise<number> {
  const s = createServer()
  await new Promise<void>((ok) => s.listen(0, '127.0.0.1', ok))
  const { port } = s.address() as AddressInfo
  await new Promise((ok) => s.close(ok))
  return port
}
