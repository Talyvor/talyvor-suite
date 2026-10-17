// B40.6 — AN ASSISTANT SIGNS IN TO TALYVOR THE WAY CLAUDE'S CONNECTOR DOES. One scenario, once a run, on a workspace of
// its own:
//   connect-oauth — POST /mcp with no token is a 401 whose WWW-Authenticate names the protected-resource metadata; that
//     document names the app as the authorization server, whose metadata names every endpoint, S256 only and the iss
//     parameter. A client registered by DCR, and one by CIMD (its client_id the https address of a document this run
//     serves), each take the person through the consent screen in the browser — the three scopes in plain words — and
//     back to a loopback callback with the code, the state and iss; the code and its PKCE verifier buy an access token
//     /mcp takes. The refresh token rotates, a rotated one sent again ends the connection, and a revoked token is refused.
// A CIMD document must be at a public https address, so it is served through a Cloudflare quick tunnel; with
// --hook-tunnel none (the self-test) a second DCR client takes its place and the evidence says so.

import type { ChildProcess } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Scenario } from './scenarios.ts'
import { tunnel } from './trackWebhooks.ts'

const SCOPE_WORDS = ['See your wallets and bills', 'Draft invoices and payees', 'Prepare payments for you to approve']

interface Tokens { access_token: string; refresh_token: string; token_type: string; expires_in: number; scope: string }

/** A form POST from this machine, as an assistant's server makes one: no cookie, no Origin. */
async function form(url: string, fields: Record<string, string>): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields) })
  const text = await res.text()
  let json: Record<string, unknown> = {}
  try { json = JSON.parse(text) as Record<string, unknown> } catch { json = { text } }
  return { status: res.status, json }
}

const mcp = (origin: string, token?: string): Promise<Response> => fetch(`${origin}/mcp`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }) },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
})

export function connectOAuth(): Scenario {
  return {
    id: 'connect-oauth',
    owner: 'talyvor-suite',
    own: true,
    items: ['B40.6'],
    feature: 'Talyvor Connect',
    title: 'an assistant signs in the way Claude does: a 401 naming resource_metadata, discovery, a client by DCR and one by CIMD, ' +
      'PKCE and the consent screen in the browser, the token and a rotating refresh — and a revoked token is refused',
    run: async (ctx) => {
      const origin = new URL(ctx.app.page.url()).origin
      const wrong: string[] = []
      const probe = `e2e-${randomBytes(8).toString('hex')}`
      let cimdID = ''
      const server = createServer((req, res) => {
        const path = new URL(req.url ?? '/', 'http://x').pathname
        if (path === `/${probe}`) return res.writeHead(200).end(probe)
        if (path === '/client.json') {
          return res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
            client_id: cimdID, client_name: 'e2e assistant (CIMD)', redirect_uris: [callback], token_endpoint_auth_method: 'none' }))
        }
        res.writeHead(path === '/callback' ? 200 : 404, { 'Content-Type': 'text/plain' }).end('back at the assistant')
      })
      await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok))
      const port = (server.address() as AddressInfo).port
      const callback = `http://127.0.0.1:${port}/callback`
      let proc: ChildProcess | undefined
      try {
        // 1. The 401 and discovery.
        const anon = await mcp(origin)
        const challenge = anon.headers.get('www-authenticate') ?? ''
        ctx.evidence.push({ note: `POST /mcp with no token: ${anon.status} WWW-Authenticate: ${challenge}` })
        const prmURL = `${origin}/.well-known/oauth-protected-resource/mcp`
        if (anon.status !== 401 || !challenge.includes(`resource_metadata="${prmURL}"`)) wrong.push(`POST /mcp with no token answered ${anon.status} "${challenge}", not a 401 naming ${prmURL}`)
        const prm = await (await fetch(prmURL)).json() as { resource?: string; authorization_servers?: string[] }
        const asm = await (await fetch(`${origin}/.well-known/oauth-authorization-server`)).json() as Record<string, unknown>
        ctx.evidence.push({ note: `protected-resource metadata: ${JSON.stringify(prm)}; authorization-server metadata: ${JSON.stringify(asm).slice(0, 600)}` })
        if (prm.resource !== `${origin}/mcp` || prm.authorization_servers?.[0] !== origin) wrong.push(`the protected-resource metadata names ${prm.resource} and ${prm.authorization_servers?.join(',')}`)
        if (asm.issuer !== origin || JSON.stringify(asm.code_challenge_methods_supported) !== '["S256"]' || asm.authorization_response_iss_parameter_supported !== true || asm.client_id_metadata_document_supported !== true) {
          wrong.push('the authorization-server metadata does not name this issuer, S256 alone, the iss parameter and CIMD')
        }
        if (wrong.length > 0) return { pass: false, detail: wrong.join('; ') }

        // 2. The clients: one by DCR, and one by CIMD when a public address can be had (else a second by DCR).
        const register = async (how: string): Promise<{ how: string; id: string } | string> => {
          const reg = await fetch(String(asm.registration_endpoint), { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ client_name: `e2e assistant (${how})`, redirect_uris: [callback] }) })
          const dcr = await reg.json() as { client_id?: string; token_endpoint_auth_method?: string }
          ctx.evidence.push({ note: `${how}: ${reg.status} ${JSON.stringify(dcr)}` })
          return reg.status === 201 && dcr.client_id !== undefined ? { how, id: dcr.client_id } : `${how} answered ${reg.status}: ${JSON.stringify(dcr)}`
        }
        const first = await register('DCR')
        if (typeof first === 'string') return { pass: false, detail: first }
        const clients = [first]
        if (ctx.env.hookTunnel !== 'none') {
          const t = await tunnel(port, probe)
          proc = t.proc
          cimdID = `${t.url}/client.json`
          clients.push({ how: 'CIMD', id: cimdID })
        } else {
          ctx.evidence.push({ note: 'CIMD left out: --hook-tunnel none gives this run no public https address for its client document' })
          const second = await register('DCR-2')
          if (typeof second === 'string') return { pass: false, detail: second }
          clients.push(second)
        }

        // 3. Each client through the browser's consent screen to its token.
        const tokens: Record<string, Tokens> = {}
        for (const c of clients) {
          const verifier = randomBytes(32).toString('base64url')
          const state = randomBytes(8).toString('hex')
          const q = new URLSearchParams({ response_type: 'code', client_id: c.id, redirect_uri: callback, state,
            code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
            scope: 'wallets:read invoices:draft payments:prepare', resource: `${origin}/mcp` })
          const page = ctx.app.page
          await page.goto(`${String(asm.authorization_endpoint)}?${q}`)
          const text = await page.locator('main').innerText()
          ctx.evidence.push({ note: `${c.how} consent screen: ${text.replace(/\s+/g, ' ').slice(0, 400)}` })
          const missing = SCOPE_WORDS.filter((w) => !text.includes(w))
          if (missing.length > 0) { wrong.push(`${c.how}: the consent screen does not say ${missing.join(', ')}`); continue }
          await Promise.all([page.waitForURL((u) => u.href.startsWith(callback), { timeout: 30_000 }), page.getByRole('button', { name: 'Allow' }).click()])
          const back = new URL(page.url())
          ctx.evidence.push({ note: `${c.how} back at the callback with state ${back.searchParams.get('state')}, iss ${back.searchParams.get('iss')}, a code: ${back.searchParams.has('code')}` })
          if (back.searchParams.get('state') !== state || back.searchParams.get('iss') !== origin || !back.searchParams.get('code')) {
            wrong.push(`${c.how}: the callback came back as ${back.search.replace(/code=[^&]+/, 'code=…')}`)
            continue
          }
          const tok = await form(String(asm.token_endpoint), { grant_type: 'authorization_code', code: back.searchParams.get('code') ?? '',
            redirect_uri: callback, client_id: c.id, code_verifier: verifier, resource: `${origin}/mcp` })
          ctx.evidence.push({ note: `${c.how} token: ${tok.status} ${tok.json.token_type} for ${tok.json.expires_in} s, scope ${tok.json.scope}` })
          if (tok.status !== 200) { wrong.push(`${c.how}: the token endpoint answered ${tok.status} ${JSON.stringify(tok.json)}`); continue }
          tokens[c.how] = tok.json as unknown as Tokens
          const used = await mcp(origin, tokens[c.how].access_token)
          if (used.status === 401) wrong.push(`${c.how}: /mcp refused a fresh access token`)
        }
        await ctx.app.page.goto(origin)
        if (wrong.length > 0 || tokens.DCR === undefined) return { pass: false, detail: wrong.join('; ') || 'no DCR token' }

        // 4. Refresh rotates, and replay ends the connection.
        const refresh = (rt: string): ReturnType<typeof form> => form(String(asm.token_endpoint), { grant_type: 'refresh_token', refresh_token: rt, client_id: clients[0].id })
        const rot = await refresh(tokens.DCR.refresh_token)
        const next = rot.json as unknown as Tokens
        const replay = await refresh(tokens.DCR.refresh_token)
        const afterReplay = await mcp(origin, next.access_token)
        ctx.evidence.push({ note: `refresh: ${rot.status}, a new refresh token: ${next.refresh_token !== tokens.DCR.refresh_token}; the old one again: ${replay.status} ${replay.json.error}; the new access token after that: ${afterReplay.status}` })
        if (rot.status !== 200 || next.refresh_token === tokens.DCR.refresh_token) wrong.push(`refresh answered ${rot.status} without rotating the refresh token`)
        if (replay.status !== 400 || afterReplay.status !== 401) wrong.push(`a rotated refresh token sent again answered ${replay.status}, and the connection then answered ${afterReplay.status}, not 400 and 401`)

        // 5. Revoked, a token is refused — on the other client's connection, which nothing above has ended.
        const other = clients[1]
        const last = tokens[other.how]
        if (last === undefined) return { pass: false, detail: `no ${other.how} token to revoke` }
        const live = await mcp(origin, last.access_token)
        const rev = await form(String(asm.revocation_endpoint), { token: last.refresh_token, client_id: other.id })
        const dead = await mcp(origin, last.access_token)
        ctx.evidence.push({ note: `${other.how}: /mcp before revoking ${live.status}, revoke ${rev.status}, /mcp after ${dead.status} ${dead.headers.get('www-authenticate')}` })
        if (live.status === 401) wrong.push(`the ${other.how} access token was refused before it was revoked`)
        if (rev.status !== 200 || dead.status !== 401) wrong.push(`revoking answered ${rev.status} and /mcp then answered ${dead.status}, not 200 and 401`)

        return wrong.length > 0 ? { pass: false, detail: wrong.join('; ') }
          : { pass: true, detail: `${clients.map((c) => c.how).join(' and ')} clients signed in through the consent screen; refresh rotated, replay and revocation were refused` }
      } finally {
        proc?.kill()
        server.closeAllConnections()
        server.close()
      }
    },
  }
}
