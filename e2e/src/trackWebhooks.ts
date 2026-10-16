// B39.23 — TRACK'S ISSUE WEBHOOKS REACH THE OWNER'S URL, SIGNED. B39.13 (talyvor-track internal/webhooks) sends a
// workspace's issue events to the URLs its owner registered, signed the Standard Webhooks way. One scenario, once a run:
//   track-webhook-signed — the owner registers a receiver this run serves (POST /api/track/webhooks, the whsec_ secret
//     kept from the answer), for issue.updated only, and moves an issue it made before: the receiver gets exactly one
//     POST, issue.updated for that issue, whose webhook-signature verifies — v1, base64 HMAC-SHA256 of
//     "<webhook-id>.<webhook-timestamp>.<body>", keyed with the base64 part of the secret.
// Track refuses a private address, so against a deployed Track the receiver is reached through a Cloudflare quick tunnel
// (`cloudflared`, no account); --hook-tunnel none hands Track the receiver's loopback address, for the self-test's stub.

import { type ChildProcess, spawn } from 'node:child_process'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { type IncomingHttpHeaders, createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { bff, said } from './routes.ts'
import { CannotTest, type Scenario } from './scenarios.ts'

/** Track's sink looks for due deliveries every 10 s (cmd/track/main.go); a delivery is given this long to arrive. */
const DELIVERY_MS = 90_000
/** After the first delivery, this long more for a second one that must not come. */
const QUIET_MS = 20_000
/** How long a quick tunnel is given to come up and answer, and Track's resolver to see its name. */
const TUNNEL_MS = 180_000
/** Standard Webhooks' replay window: a timestamp further than this from the receiver's clock is refused. */
const TOLERANCE_S = 300

interface Delivery { at: number; headers: IncomingHttpHeaders; body: string }

/** Whether `header` (space-separated "v1,<base64>" signatures) holds the Standard Webhooks signature of the message. */
export function verifies(secret: string, id: string, timestamp: string, body: string, header: string): boolean {
  const want = createHmac('sha256', Buffer.from(secret.replace(/^whsec_/, ''), 'base64')).update(`${id}.${timestamp}.${body}`).digest()
  return header.split(' ').some((sig) => {
    const [v, b64] = sig.split(',', 2)
    const got = Buffer.from(b64 ?? '', 'base64')
    return v === 'v1' && got.length === want.length && timingSafeEqual(got, want)
  })
}

/** A receiver on loopback: each POST is kept and answered 204; GET /<probe> answers the probe, to find the tunnel up. */
async function receiver(probe: string): Promise<{ port: number; got: Delivery[]; close: () => Promise<void> }> {
  const got: Delivery[] = []
  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      if (req.method === 'POST') got.push({ at: Date.now(), headers: req.headers, body: Buffer.concat(chunks).toString('utf8') })
      res.writeHead(req.method === 'POST' ? 204 : req.url === `/${probe}` ? 200 : 404).end(req.method === 'GET' ? probe : undefined)
    })
  })
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok))
  return { port: (server.address() as AddressInfo).port, got, close: () => new Promise((ok) => { server.closeAllConnections(); server.close(() => ok()) }) }
}

/** A Cloudflare quick tunnel to `port`: its https URL once it answers `probe`, or why not. */
async function tunnel(port: number, probe: string): Promise<{ url: string; proc: ChildProcess }> {
  const proc = spawn('cloudflared', ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`], { stdio: ['ignore', 'ignore', 'pipe'] })
  const url = await new Promise<string>((ok, no) => {
    let log = ''
    const t = setTimeout(() => no(new Error(`cloudflared named no tunnel in ${TUNNEL_MS / 1000} s: ${log.slice(-300)}`)), TUNNEL_MS)
    proc.on('error', (e: NodeJS.ErrnoException) => {
      clearTimeout(t)
      no(e.code === 'ENOENT' ? new CannotTest('cloudflared is not installed on this machine (brew install cloudflared), so no public receiver') : e)
    })
    proc.stderr?.on('data', (d: Buffer) => {
      log += d.toString()
      const m = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(log)
      if (m !== null) { clearTimeout(t); ok(m[0]) }
    })
  }).catch((e: unknown) => { proc.kill(); throw e })
  const until = Date.now() + TUNNEL_MS
  while (Date.now() < until) {
    const r = await fetch(`${url}/${probe}`).then((x) => x.text(), () => '')
    if (r === probe) return { url, proc }
    await new Promise((ok) => setTimeout(ok, 2_000))
  }
  proc.kill()
  throw new Error(`the tunnel ${url} did not reach the receiver in ${TUNNEL_MS / 1000} s`)
}

interface Hook { id: string; url: string; events: string[]; secret: string }
interface TrackIssue { id: string; title: string; status: string }

export function trackWebhookSigned(seed: number): Scenario {
  return {
    id: 'track-webhook-signed',
    owner: 'talyvor-track',
    items: ['B39.13', 'B39.23'],
    feature: 'Track webhooks',
    title: 'Track webhooks: the owner registers a URL for issue.updated and moves an issue; the URL gets exactly one POST, ' +
      'for that issue, whose webhook-signature verifies the Standard Webhooks way under the secret Track gave once',
    run: async (ctx) => {
      const probe = `e2e-${randomBytes(8).toString('hex')}`
      const rx = await receiver(probe)
      let proc: ChildProcess | undefined
      let hook: Hook | undefined
      try {
        let to = `http://127.0.0.1:${rx.port}/hook`
        if (ctx.env.hookTunnel !== 'none') {
          const t = await tunnel(rx.port, probe)
          proc = t.proc
          to = `${t.url}/hook`
        }
        ctx.evidence.push({ note: `the receiver: ${to}` })

        // The issue is made before the webhook, so the one event the receiver may see is the update.
        const teams = await bff<{ id: string }[]>(ctx, 'GET', '/api/track/teams')
        if (!teams.ok || teams.value[0] === undefined) return { pass: false, detail: `Track named no team to file an issue in: ${said(teams)}` }
        const made = await bff<TrackIssue>(ctx, 'POST', '/api/track/issues', { title: `Webhook ${seed} ${probe}`, team_id: teams.value[0].id })
        if (!made.ok) return { pass: false, detail: `the issue was not made: ${said(made)}` }

        // A quick tunnel's name can take a moment to resolve from Track: BAD_HOST is asked again until it does.
        const until = Date.now() + TUNNEL_MS
        let reg = await bff<Hook>(ctx, 'POST', '/api/track/webhooks', { url: to, events: ['issue.updated'] })
        while (!reg.ok && reg.status === 400 && /resolve/i.test(reg.error) && Date.now() < until) {
          await new Promise((ok) => setTimeout(ok, 5_000))
          reg = await bff<Hook>(ctx, 'POST', '/api/track/webhooks', { url: to, events: ['issue.updated'] })
        }
        ctx.evidence.push({ note: `registered: ${reg.ok ? `${reg.status} id ${reg.value.id}, events ${reg.value.events.join(',')}, a ${reg.value.secret?.slice(0, 6)}… secret` : said(reg)}` })
        if (!reg.ok) return { pass: false, detail: `Track did not register the webhook: ${said(reg)}` }
        hook = reg.value
        if (!/^whsec_[A-Za-z0-9+/=]+$/.test(hook.secret ?? '')) return { pass: false, detail: `Track's create answer carried no whsec_ secret: ${JSON.stringify(hook).slice(0, 200)}` }

        const moved = await bff<TrackIssue>(ctx, 'PATCH', `/api/track/issues/${encodeURIComponent(made.value.id)}`, { status: 'in_progress' })
        if (!moved.ok) return { pass: false, detail: `the issue was not moved: ${said(moved)}` }
        const sent = Date.now()

        while (rx.got.length === 0 && Date.now() - sent < DELIVERY_MS) await new Promise((ok) => setTimeout(ok, 1_000))
        if (rx.got.length > 0) await new Promise((ok) => setTimeout(ok, QUIET_MS))
        ctx.evidence.push({ note: `${rx.got.length} POST(s) in ${Math.round((Date.now() - sent) / 1000)} s: ` +
          rx.got.map((d) => `${d.headers['webhook-id']} at ${d.headers['webhook-timestamp']} sig ${String(d.headers['webhook-signature']).slice(0, 12)}… ${d.body.slice(0, 200)}`).join(' | ') })
        if (rx.got.length !== 1) return { pass: false, detail: `the receiver got ${rx.got.length} POSTs for one issue update, not exactly one` }

        const [d] = rx.got
        const id = String(d.headers['webhook-id'] ?? '')
        const ts = String(d.headers['webhook-timestamp'] ?? '')
        const failures: string[] = []
        if (id === '' || !/^\d+$/.test(ts)) failures.push(`webhook-id "${id}", webhook-timestamp "${ts}"`)
        else if (Math.abs(Number(ts) - d.at / 1000) > TOLERANCE_S) failures.push(`webhook-timestamp ${ts} is more than ${TOLERANCE_S} s from when it arrived`)
        if (!verifies(hook.secret, id, ts, d.body, String(d.headers['webhook-signature'] ?? ''))) failures.push('its webhook-signature does not verify under the secret Track gave')
        let event: { type?: string; data?: { issue_id?: string } } = {}
        try { event = JSON.parse(d.body) } catch { failures.push('its body is not JSON') }
        if (event.type !== 'issue.updated' || event.data?.issue_id !== made.value.id) {
          failures.push(`it is ${event.type} for ${event.data?.issue_id}, not issue.updated for ${made.value.id}`)
        }
        return failures.length === 0
          ? { pass: true, detail: `one signed issue.updated for ${made.value.id}, verified under the whsec_ secret` }
          : { pass: false, detail: failures.join('; ') }
      } finally {
        if (hook !== undefined) await bff(ctx, 'DELETE', `/api/track/webhooks/${encodeURIComponent(hook.id)}`).catch(() => undefined)
        proc?.kill()
        await rx.close()
      }
    },
  }
}
