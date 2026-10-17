// B39.28 — DOCS EMAILS EACH REVIEWER WHEN THEIR APPROVAL IS REQUESTED. B39.16 (talyvor-docs internal/email) writes one
// notification_outbox row per reviewer and sends it over SMTP. One scenario, once a run:
//   docs-approval-email — a Docs built from the run's Docs checkout (--docs-src), on a Postgres of its own in Docker,
//     started with DOCS_EMAIL_ENABLED=true and its SMTP pointed at the stub track-assign-email uses (never Cloudflare).
//     The author asks two reviewers to approve a page: exactly two outbox rows, both sent_at set, and exactly two mails
//     at the stub, one to each reviewer. The author then comments on the page, and no new row is written.
//   B39.33 — then, on the same Docs, the author's own email switches (B39.32, …/notification-preferences): the defaults
//     read approval.requested on and freshness.digest off, freshness.digest is turned on and reads back on, an unknown
//     kind is refused 400, and a workspace the author is not a member of is refused 403.
// Docs keeps no roster of its own: workspace_members mirrors Track's, so the run seeds that mirror in its own database
// the way Docs' tests do, in place of the sync from a Track this run does not start.

import { type ChildProcess, execFile, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { CannotTest, type Scenario } from './scenarios.ts'
import { freePort, smtpStub } from './trackEmail.ts'

const run = promisify(execFile)
/** The image Docs' own real-Postgres tests use: its migrations create the vector extension. */
const PG_IMAGE = 'pgvector/pgvector:pg16'
/** How long Postgres is given to take a connection, and Docs to answer /healthz. */
const BOOT_MS = 120_000
/** Docs' sink sweeps every 30 s (cmd/docs/main.go); two mails are given this long. */
const MAIL_MS = 60_000
/** After the comment, this long for a row or a mail that must not come — past one 30 s sweep. */
const QUIET_MS = 35_000

interface Who { email: string; id: string }

export function docsApprovalEmail(seed: number): Scenario {
  return {
    id: 'docs-approval-email',
    owner: 'talyvor-docs',
    items: ['B39.16', 'B39.28', 'B39.32', 'B39.33'],
    feature: 'Docs approval-request email',
    title: 'Docs approval-request email: asking two reviewers to approve a page writes exactly two outbox rows, both sent, ' +
      'and two mails at the SMTP stub, one to each; a comment on the page writes no row; a member switches the stale-page ' +
      'digest on and reads it back, and is refused an unknown kind (400) and another workspace (403)',
    run: async (ctx) => {
      const src = ctx.env.docsSrc
      if (src === 'none' || !existsSync(join(src, 'cmd', 'docs', 'main.go'))) throw new CannotTest(`no Docs checkout at ${src} (--docs-src)`)
      await run('docker', ['info', '--format', '{{.ServerVersion}}']).catch(() => { throw new CannotTest('Docker is not running on this machine, so no Postgres for the run\'s own Docs') })
      await run('go', ['version']).catch(() => { throw new CannotTest('Go is not on the PATH, so Docs cannot be built') })

      const probe = randomBytes(6).toString('hex')
      const pg = `e2e-docs-mail-${probe}`
      const dir = await mkdtemp(join(tmpdir(), 'e2e-docs-mail-'))
      const smtp = await smtpStub()
      let docs: ChildProcess | undefined
      let log = ''
      try {
        await run('docker', ['run', '-d', '--rm', '--name', pg, '-e', 'POSTGRES_PASSWORD=e2e', '-e', 'POSTGRES_DB=docs', '-p', '127.0.0.1::5432', PG_IMAGE])
        const pgPort = (await run('docker', ['port', pg, '5432/tcp'])).stdout.trim().split('\n')[0].split(':').pop()
        const dbURL = `postgres://postgres:e2e@127.0.0.1:${pgPort}/docs?sslmode=disable`
        const bin = join(dir, 'docs')
        // Built as Docs' Dockerfile builds it, cgo off: no C toolchain (or its licence) is needed on the testers' machine.
        await run('go', ['build', '-o', bin, './cmd/docs'], { cwd: src, env: { ...process.env, CGO_ENABLED: '0' }, maxBuffer: 16 * 1024 * 1024 })
        // The port answers before the image's first-boot init is done, so the migration is tried until it takes.
        const until = Date.now() + BOOT_MS
        for (;;) {
          const m = await run(bin, ['migrate'], { env: { ...process.env, DOCS_DATABASE_URL: dbURL } }).then(() => '', (e: { stderr?: string }) => e.stderr ?? String(e))
          if (m === '') break
          if (Date.now() > until) return { pass: false, detail: `Docs' migrations did not apply: ${m.slice(-300)}` }
          await new Promise((ok) => setTimeout(ok, 2_000))
        }
        const sql = async (q: string) => (await run('docker', ['exec', pg, 'psql', '-U', 'postgres', '-d', 'docs', '-tAc', q])).stdout.trim()

        const ws = `ws_e2e_${probe}`
        const [author, carol, dave]: Who[] = ['author', 'carol', 'dave'].map((n) => ({ email: `${n}-${probe}@e2e.talyvor.test`, id: `mbr_${n}_${probe}` }))
        await sql(`INSERT INTO workspace_members (workspace_id, email, role, member_id) VALUES ${
          [author, carol, dave].map((m) => `('${ws}', '${m.email}', 'member', '${m.id}')`).join(', ')}`)

        const secret = randomBytes(32).toString('hex')
        const listen = await freePort()
        const base = `http://127.0.0.1:${listen}`
        docs = spawn(bin, [], {
          env: {
            ...process.env, DOCS_DATABASE_URL: dbURL, GATEWAY_AUTH_SECRET: secret, DOCS_LISTEN_ADDR: `127.0.0.1:${listen}`,
            DOCS_EMAIL_ENABLED: 'true', DOCS_SMTP_HOST: '127.0.0.1', DOCS_SMTP_PORT: String(smtp.port), DOCS_EMAIL_FROM: 'docs@talyvor.test',
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        })
        docs.stdout?.on('data', (d: Buffer) => { log = (log + d.toString()).slice(-4_000) })
        docs.stderr?.on('data', (d: Buffer) => { log = (log + d.toString()).slice(-4_000) })
        while (await fetch(`${base}/healthz`).then((r) => !r.ok, () => true)) {
          if (Date.now() > until || docs.exitCode !== null) return { pass: false, detail: `Docs did not come up: ${log.slice(-400)}` }
          await new Promise((ok) => setTimeout(ok, 1_000))
        }

        const call = async <T>(method: string, path: string, body: unknown): Promise<{ status: number; value: T; text: string }> => {
          const r = await fetch(`${base}/v1${path}`, {
            method,
            headers: { 'X-Gateway-Auth': secret, 'X-User-Email': author.email, 'X-User-Id': `sub-${probe}`, 'X-Auth-Iss': 'e2e', 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
          const text = await r.text()
          let value: T
          try { value = JSON.parse(text) as T } catch { value = undefined as T }
          return { status: r.status, value, text: text.slice(0, 300) }
        }
        const rows = async () => {
          const [n, sent] = (await sql(`SELECT count(*), count(sent_at) FROM notification_outbox WHERE workspace_id = '${ws}'`)).split('|').map(Number)
          return { n, sent }
        }

        const space = await call<{ id: string }>('POST', '/spaces', { workspace_id: ws, name: `Approvals ${seed} ${probe}` })
        if (space.status !== 201) return { pass: false, detail: `the space was not made: ${space.status} ${space.text}` }
        const pages = `/spaces/${encodeURIComponent(space.value.id)}/pages`
        const page = await call<{ id: string }>('POST', pages, { title: `Sign-off ${seed}` })
        if (page.status !== 201 && page.status !== 200) return { pass: false, detail: `the page was not made: ${page.status} ${page.text}` }
        const onPage = `${pages}/${encodeURIComponent(page.value.id)}`

        const asked = await call('POST', `${onPage}/approval`, { reviewers: [carol.id, dave.id], message: `please check, e2e ${probe}` })
        if (asked.status !== 201) return { pass: false, detail: `approval was not requested: ${asked.status} ${asked.text}` }
        const askedAt = Date.now()
        let r = await rows()
        while ((r.sent < 2 || smtp.got.length < 2) && Date.now() - askedAt < MAIL_MS) {
          await new Promise((ok) => setTimeout(ok, 1_000))
          r = await rows()
        }
        ctx.evidence.push({ note: `after the request: ${r.n} outbox row(s), ${r.sent} sent; ${smtp.got.length} mail(s) at the stub: ` +
          smtp.got.map((m) => `from ${m.from} to ${m.to.join(',')} ${/^Subject: .*$/m.exec(m.data)?.[0] ?? ''}`).join(' | ') })
        if (r.n !== 2 || r.sent !== 2) return { pass: false, detail: `a request to two reviewers wrote ${r.n} outbox row(s), ${r.sent} sent — not exactly two, sent. Docs: ${log.slice(-300)}` }
        const to = smtp.got.map((m) => m.to.join(',')).sort()
        const want = [carol.email, dave.email].sort()
        if (to.join(';') !== want.join(';')) return { pass: false, detail: `the stub got ${smtp.got.length} mail(s) to ${to.join('; ')}, not one each to ${want.join(' and ')}` }

        const said = await call('POST', `${onPage}/comments`, { content: `a comment from e2e ${probe}` })
        if (said.status !== 201) return { pass: false, detail: `the comment was not posted: ${said.status} ${said.text}` }
        await new Promise((ok) => setTimeout(ok, QUIET_MS))
        r = await rows()
        ctx.evidence.push({ note: `after the comment: ${r.n} outbox row(s); ${smtp.got.length} mail(s) at the stub` })
        if (r.n !== 2) return { pass: false, detail: `the comment wrote ${r.n - 2} new outbox row(s)` }
        if (smtp.got.length !== 2) return { pass: false, detail: `after the comment the stub got ${smtp.got.length - 2} more mail(s)` }

        // B39.33 — the member's own switches, as Settings → Notifications will read and set them.
        type Prefs = Record<string, boolean>
        const prefs = `/workspaces/${encodeURIComponent(ws)}/notification-preferences`
        const before = await call<Prefs>('GET', prefs, undefined)
        const turned = await call<Prefs>('PUT', prefs, { 'freshness.digest': true })
        const after = await call<Prefs>('GET', prefs, undefined)
        const unknown = await call('PUT', prefs, { 'page.deleted': true })
        const elsewhere = await call('GET', `/workspaces/ws_e2e_other_${probe}/notification-preferences`, undefined)
        ctx.evidence.push({ note: `preferences: defaults ${before.status} ${before.text.trim()}; on ${turned.status} ${turned.text.trim()}; ` +
          `read back ${after.status} ${after.text.trim()}; unknown kind ${unknown.status}; another workspace ${elsewhere.status}` })
        if (before.status !== 200 || before.value?.['approval.requested'] !== true || before.value?.['freshness.digest'] !== false) {
          return { pass: false, detail: `the defaults are not approval.requested on, freshness.digest off: ${before.status} ${before.text}` }
        }
        if (turned.status !== 200 || turned.value?.['freshness.digest'] !== true) return { pass: false, detail: `freshness.digest was not turned on: ${turned.status} ${turned.text}` }
        if (after.status !== 200 || after.value?.['freshness.digest'] !== true || after.value?.['approval.requested'] !== true) {
          return { pass: false, detail: `reading back did not show freshness.digest on and approval.requested still on: ${after.status} ${after.text}` }
        }
        if (unknown.status !== 400) return { pass: false, detail: `an unknown kind answered ${unknown.status}, not 400: ${unknown.text}` }
        if (elsewhere.status !== 403) return { pass: false, detail: `a workspace the author is not a member of answered ${elsewhere.status}, not 403: ${elsewhere.text}` }
        return { pass: true, detail: `one request to two reviewers, two outbox rows sent and one mail each to ${want.join(' and ')}; a comment wrote no row and sent nothing; ` +
          'the digest switched on and read back on, an unknown kind 400, another workspace 403' }
      } finally {
        docs?.kill()
        await run('docker', ['rm', '-f', pg]).catch(() => undefined)
        await smtp.close()
        await rm(dir, { recursive: true, force: true })
      }
    },
  }
}
