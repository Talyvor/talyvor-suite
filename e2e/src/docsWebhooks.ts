// B39.24 — DOCS' APPROVAL WEBHOOKS REACH THE OWNER'S URL, SIGNED. B39.14 (talyvor-docs internal/webhooks) sends a
// workspace's approval and comment events to the URLs its owner registered, signed the Standard Webhooks way. One
// scenario, once a run:
//   docs-webhook-signed — the owner registers a receiver this run serves (POST /api/docs/webhooks, the whsec_ secret kept
//     from the answer), for approval.requested only, and asks for approval on a page it made before: the receiver gets
//     exactly one POST, approval.requested for that page, whose webhook-signature verifies — v1, base64 HMAC-SHA256 of
//     "<webhook-id>.<webhook-timestamp>.<body>", keyed with the base64 part of the secret.
//   B39.25 (Settings → Webhooks): before asking, the list names the hook with no secret on it, and a rotate answers a new
//     whsec_ secret, the one the delivery must then verify under.
// Docs refuses a private address, so the receiver is reached the way track-webhook-signed's is (--hook-tunnel).

import type { ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { bff, said } from './routes.ts'
import { CannotTest, type Scenario } from './scenarios.ts'
import { receiver, tunnel, verifies } from './trackWebhooks.ts'

/** Docs' sink sends at once after an event is queued (cmd/docs/main.go); a delivery is given this long to arrive. */
const DELIVERY_MS = 90_000
/** After the first delivery, this long more for a second one that must not come. */
const QUIET_MS = 20_000
/** How long Docs' resolver is given to see a new quick tunnel's name. */
const RESOLVE_MS = 180_000
/** Standard Webhooks' replay window: a timestamp further than this from the receiver's clock is refused. */
const TOLERANCE_S = 300

interface Hook { id: string; url: string; events: string[]; secret: string }

export function docsWebhookSigned(seed: number): Scenario {
  return {
    id: 'docs-webhook-signed',
    owner: 'talyvor-docs',
    items: ['B39.14', 'B39.24', 'B39.25'],
    feature: 'Docs webhooks',
    title: 'Docs webhooks: the owner registers a URL for approval.requested and asks for approval on a page; the URL gets ' +
      'exactly one POST, for that page, whose webhook-signature verifies the Standard Webhooks way under the secret its rotate gave',
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

        // The page is made before the webhook, so the one event the receiver may see is the approval request.
        const space = await bff<{ id: string }>(ctx, 'POST', '/api/docs/spaces', { name: `Webhooks ${seed} ${probe}` })
        if (!space.ok) return { pass: false, detail: `the space was not made: ${said(space)}` }
        const page = await bff<{ id: string }>(ctx, 'POST', `/api/docs/spaces/${encodeURIComponent(space.value.id)}/pages`, { title: `Sign-off ${seed}` })
        if (!page.ok) return { pass: false, detail: `the page was not made: ${said(page)}` }
        const roster = await bff<{ id: string }[]>(ctx, 'GET', '/api/members')
        const reviewer = roster.ok ? roster.value[0]?.id : undefined
        if (reviewer === undefined) return { pass: false, detail: `the workspace roster named no one to review: ${said(roster)}` }

        // A quick tunnel's name can take a moment to resolve from Docs: BAD_HOST is asked again until it does.
        const until = Date.now() + RESOLVE_MS
        let reg = await bff<Hook>(ctx, 'POST', '/api/docs/webhooks', { url: to, events: ['approval.requested'] })
        while (!reg.ok && reg.status === 400 && /resolve/i.test(reg.error) && Date.now() < until) {
          await new Promise((ok) => setTimeout(ok, 5_000))
          reg = await bff<Hook>(ctx, 'POST', '/api/docs/webhooks', { url: to, events: ['approval.requested'] })
        }
        ctx.evidence.push({ note: `registered: ${reg.ok ? `${reg.status} id ${reg.value.id}, events ${reg.value.events.join(',')}, a ${reg.value.secret?.slice(0, 6)}… secret` : said(reg)}` })
        // Docs mounts no webhook route at all until DOCS_WEBHOOK_ENCRYPTION_KEY is set (cmd/docs/main.go).
        if (!reg.ok && reg.status === 404) throw new CannotTest(`Docs has no webhooks route (404): DOCS_WEBHOOK_ENCRYPTION_KEY is not set on this Docs`)
        if (!reg.ok) return { pass: false, detail: `Docs did not register the webhook: ${said(reg)}` }
        hook = reg.value
        if (!/^whsec_[A-Za-z0-9+/=]+$/.test(hook.secret ?? '')) return { pass: false, detail: `Docs' create answer carried no whsec_ secret: ${JSON.stringify(hook).slice(0, 200)}` }

        // B39.25 — what Settings → Webhooks reads and does: the list carries no secret, and a rotate replaces it.
        const listed = await bff<Array<Record<string, unknown>>>(ctx, 'GET', '/api/docs/webhooks')
        if (!listed.ok) return { pass: false, detail: `the webhooks were not listed: ${said(listed)}` }
        const row = listed.value.find((x) => x.id === hook?.id)
        if (row === undefined || row.url !== to) return { pass: false, detail: `the list does not name ${hook.id} at ${to}: ${JSON.stringify(listed.value).slice(0, 200)}` }
        if (JSON.stringify(listed.value).includes('whsec_')) return { pass: false, detail: 'the webhook list carries a secret, which Docs gives only on create and rotate' }
        const rotated = await bff<{ secret: string }>(ctx, 'POST', `/api/docs/webhooks/${encodeURIComponent(hook.id)}/rotate`)
        if (!rotated.ok || !/^whsec_[A-Za-z0-9+/=]+$/.test(rotated.value.secret ?? '') || rotated.value.secret === hook.secret) {
          return { pass: false, detail: `the rotate did not answer a new whsec_ secret: ${rotated.ok ? 'the same or none' : said(rotated)}` }
        }
        ctx.evidence.push({ note: `listed without a secret; rotated to a ${rotated.value.secret.slice(0, 6)}… secret` })
        hook = { ...hook, secret: rotated.value.secret }

        const asked = await bff<{ id: string }>(ctx, 'POST', `/api/docs/spaces/${encodeURIComponent(space.value.id)}/pages/${encodeURIComponent(page.value.id)}/approval`,
          { reviewers: [reviewer], message: `Please sign off ${seed}` })
        if (!asked.ok) return { pass: false, detail: `approval was not requested: ${said(asked)}` }
        const sent = Date.now()

        while (rx.got.length === 0 && Date.now() - sent < DELIVERY_MS) await new Promise((ok) => setTimeout(ok, 1_000))
        if (rx.got.length > 0) await new Promise((ok) => setTimeout(ok, QUIET_MS))
        ctx.evidence.push({ note: `${rx.got.length} POST(s) in ${Math.round((Date.now() - sent) / 1000)} s: ` +
          rx.got.map((d) => `${d.headers['webhook-id']} at ${d.headers['webhook-timestamp']} sig ${String(d.headers['webhook-signature']).slice(0, 12)}… ${d.body.slice(0, 200)}`).join(' | ') })
        if (rx.got.length !== 1) return { pass: false, detail: `the receiver got ${rx.got.length} POSTs for one approval request, not exactly one` }

        const [d] = rx.got
        const id = String(d.headers['webhook-id'] ?? '')
        const ts = String(d.headers['webhook-timestamp'] ?? '')
        const failures: string[] = []
        if (id === '' || !/^\d+$/.test(ts)) failures.push(`webhook-id "${id}", webhook-timestamp "${ts}"`)
        else if (Math.abs(Number(ts) - d.at / 1000) > TOLERANCE_S) failures.push(`webhook-timestamp ${ts} is more than ${TOLERANCE_S} s from when it arrived`)
        if (!verifies(hook.secret, id, ts, d.body, String(d.headers['webhook-signature'] ?? ''))) failures.push('its webhook-signature does not verify under the secret the rotate gave')
        let event: { type?: string; data?: { page_id?: string; request_id?: string } } = {}
        try { event = JSON.parse(d.body) } catch { failures.push('its body is not JSON') }
        if (event.type !== 'approval.requested' || event.data?.page_id !== page.value.id || event.data?.request_id !== asked.value.id) {
          failures.push(`it is ${event.type} for page ${event.data?.page_id} (request ${event.data?.request_id}), not approval.requested for ${page.value.id} (request ${asked.value.id})`)
        }
        return failures.length === 0
          ? { pass: true, detail: `one signed approval.requested for page ${page.value.id}, verified under the rotated whsec_ secret` }
          : { pass: false, detail: failures.join('; ') }
      } finally {
        if (hook !== undefined) await bff(ctx, 'DELETE', `/api/docs/webhooks/${encodeURIComponent(hook.id)}`).catch(() => undefined)
        proc?.kill()
        await rx.close()
      }
    },
  }
}
