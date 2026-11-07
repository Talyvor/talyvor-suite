// B40.6 — AN ASSISTANT SIGNS IN TO TALYVOR THE WAY CLAUDE'S CONNECTOR DOES. One scenario, once a run, on a workspace of
// its own:
//   connect-oauth — POST /mcp with no token is a 401 whose WWW-Authenticate names the protected-resource metadata; that
//     document names the app as the authorization server, whose metadata names every endpoint, S256 only and the iss
//     parameter. A client registered by DCR, and one by CIMD (its client_id the https address of a document this run
//     serves), each take the person through the consent screen in the browser — the three scopes in plain words — and
//     back to a loopback callback with the code, the state and iss; the code and its PKCE verifier buy an access token
//     /mcp takes. The refresh token rotates, a rotated one sent again ends the connection, and a revoked token is refused.
//     B40.8: a third client shows on Settings → Connect your AI with its last use. B41.15: it is revoked from its row
//     on Keys, the page says so, and its next tool call is refused as not connected. B52.3: before that, a tool call it
//     makes is listed under its row on Settings, from the BFF's audit trail. B52.2: Claude Code's own published
//     client document (claude.ai's, which registers port-less loopback callbacks) signs in back to this run's random
//     port, and its connection is then revoked. B52.5: the Settings client is granted wallets:read alone; it still lists
//     prepare_payment with the scope it needs, and calling it answers 403 insufficient_scope asking for that scope.
// A CIMD document must be at a public https address, so it is served through a Cloudflare quick tunnel; with
// --hook-tunnel none (the self-test) a second DCR client takes its place and the evidence says so.

import type { ChildProcess } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Scenario, ScenarioCtx } from './scenarios.ts'
import { softPasskey } from './payees.ts'
import { call, said } from './settings.ts'
import { tunnel } from './trackWebhooks.ts'

// B52.2: the document Claude Code names as its client_id; it registers http://localhost/callback and http://127.0.0.1/callback.
const CLAUDE_CODE = 'https://claude.ai/oauth/claude-code-client-metadata'

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
    items: ['B40.6', 'B40.8', 'B41.15', 'B52.2', 'B52.3', 'B52.5'],
    feature: 'Talyvor Connect',
    title: 'an assistant signs in the way Claude does: a 401 naming resource_metadata, discovery, a client by DCR and one by CIMD, ' +
      'PKCE and the consent screen in the browser, the token and a rotating refresh — and a revoked token is refused, ' +
      'by the revocation endpoint and by its button on Settings → Connect your AI',
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
        const fromSettings = await register('Settings')
        if (typeof fromSettings === 'string') return { pass: false, detail: fromSettings }
        clients.push(fromSettings)
        clients.push({ how: 'Claude Code', id: CLAUDE_CODE })

        // 3. Each client through the browser's consent screen to its token.
        const tokens: Record<string, Tokens> = {}
        for (const c of clients) {
          const readOnly = c.how === 'Settings' // B52.5: the one connection given less than every scope
          const verifier = randomBytes(32).toString('base64url')
          const state = randomBytes(8).toString('hex')
          const q = new URLSearchParams({ response_type: 'code', client_id: c.id, redirect_uri: callback, state,
            code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
            scope: readOnly ? 'wallets:read' : 'wallets:read invoices:draft payments:prepare', resource: `${origin}/mcp` })
          const page = ctx.app.page
          await page.goto(`${String(asm.authorization_endpoint)}?${q}`)
          const text = await page.locator('main').innerText()
          ctx.evidence.push({ note: `${c.how} consent screen: ${text.replace(/\s+/g, ' ').slice(0, 400)}` })
          const missing = (readOnly ? SCOPE_WORDS.slice(0, 1) : SCOPE_WORDS).filter((w) => !text.includes(w))
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
        const cc = tokens['Claude Code']
        if (cc !== undefined) await form(String(asm.revocation_endpoint), { token: cc.refresh_token, client_id: CLAUDE_CODE })

        // 6. B40.8: the third connection is on Settings → Connect your AI with its last use, and its button revokes it.
        const page = ctx.app.page
        const name = 'e2e assistant (Settings)'
        const held = tokens.Settings
        if (held === undefined) return { pass: false, detail: 'no Settings token to revoke from the page' }
        // B52.3: a tool call is written to the connection's audit trail, which the row shows.
        const audited = await fetch(`${origin}/mcp`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${held.access_token}` },
          body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_balances', arguments: {} } }),
        })
        // B52.5: the tool it was not given is listed with its scope, and answers 403 asking for it.
        const call = (method: string, params: unknown): Promise<Response> => fetch(`${origin}/mcp`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${held.access_token}` },
          body: JSON.stringify({ jsonrpc: '2.0', id: 4, method, params }),
        })
        const list = await (await call('tools/list', {})).json() as { result?: { tools?: { name: string; securitySchemes?: { type: string; scopes: string[] }[] }[] } }
        const scheme = list.result?.tools?.find((t) => t.name === 'prepare_payment')?.securitySchemes
        const schemes = JSON.stringify(scheme)
        const up = await call('tools/call', { name: 'prepare_payment', arguments: { idempotency_key: `e2e-${probe}`, payee_id: 'none', currency: 'GBP', amount_minor: 100 } })
        const upChallenge = up.headers.get('www-authenticate') ?? ''
        const upBody = await up.json() as { result?: { isError?: boolean; _meta?: Record<string, unknown> } }
        ctx.evidence.push({ note: `B52.5: prepare_payment on a wallets:read connection is listed with ${schemes} and answered ${up.status} "${upChallenge}", _meta ${JSON.stringify(upBody.result?._meta)}` })
        if (scheme?.length !== 1 || scheme[0].type !== 'oauth2' || scheme[0].scopes.join() !== 'payments:prepare') wrong.push(`prepare_payment is listed to a read-only connection with securitySchemes ${schemes}`)
        if (up.status !== 403 || !upChallenge.includes('error="insufficient_scope"') || !upChallenge.includes('payments:prepare') ||
          upBody.result?.isError !== true || JSON.stringify(upBody.result?._meta?.['mcp/www_authenticate']) !== JSON.stringify([upChallenge])) {
          wrong.push(`prepare_payment on a read-only connection answered ${up.status} "${upChallenge}", not 403 insufficient_scope with the same challenge in _meta`)
        }
        await page.goto(`${origin}/settings/connect`)
        const row = page.locator('li').filter({ hasText: name })
        await row.waitFor({ timeout: 15_000 })
        const rowText = (await row.innerText()).replace(/\s+/g, ' ')
        const trail = row.getByRole('list', { name: 'Its latest tool calls' })
        if (await row.getByText(/What it did/).count() > 0) await row.getByText(/What it did/).click()
        const trailText = (await trail.count()) > 0 ? (await trail.innerText()).replace(/\s+/g, ' ') : ''
        ctx.evidence.push({ note: `B52.3: get_balances answered ${audited.status}; the row's audit trail reads "${trailText}"` })
        if (!trailText.includes('get_balances')) wrong.push(`Settings does not list the get_balances call in the connection's audit trail: "${rowText}"`)
        const address = await page.getByText(`${origin}/mcp`, { exact: true }).count()
        ctx.evidence.push({ note: `Settings → Connect your AI: address shown ${address > 0}; row "${rowText}"` })
        if (address === 0) wrong.push(`the page does not show the address ${origin}/mcp`)
        if (!/Last used (?!never)/.test(rowText)) wrong.push(`the connected assistant's row does not show its last use: "${rowText}"`)
        // B41.15: revoked from Keys, where everything that may act for the workspace is listed.
        await page.goto(`${origin}/keys`)
        const onKeys = page.locator('li').filter({ hasText: name })
        await onKeys.waitFor({ timeout: 15_000 })
        await page.getByRole('button', { name: `Revoke ${name}` }).click()
        await onKeys.waitFor({ state: 'detached', timeout: 15_000 })
        const shown = await page.getByRole('status').filter({ hasText: `${name} is disconnected` }).count()
        const toolCall = await fetch(`${origin}/mcp`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${held.access_token}` },
          body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_wallets', arguments: {} } }),
        })
        const refusal = await toolCall.text()
        ctx.evidence.push({ note: `Keys: revoked from its row, the page says so ${shown > 0}; its next tool call ${toolCall.status} ${refusal}` })
        if (shown === 0) wrong.push('Keys does not show the revocation after its Revoke button')
        if (toolCall.status !== 401 || !refusal.includes('not connected')) wrong.push(`a tool call on a token revoked from Keys answered ${toolCall.status} ${refusal}, not 401 not connected`)
        await page.goto(origin)

        return wrong.length > 0 ? { pass: false, detail: wrong.join('; ') }
          : { pass: true, detail: `${clients.map((c) => c.how).join(', ')} clients signed in through the consent screen; refresh rotated, replay and revocation were refused, and Settings listed it and Keys revoked it` }
      } finally {
        proc?.kill()
        server.closeAllConnections()
        server.close()
      }
    },
  }
}

// B52.9 — SIGN OUT EVERYWHERE ENDS EVERY ASSISTANT. One scenario, once a run, on a workspace of its own:
//   connect-sign-out-everywhere — two assistants are allowed through the consent screen and /mcp takes both tokens; on
//     Settings → Connect your AI the person presses Sign out everywhere and confirms. This browser is signed out, and
//     /mcp refuses both assistants' tokens as not connected.
export function connectSignOutEverywhere(): Scenario {
  return {
    id: 'connect-sign-out-everywhere',
    owner: 'talyvor-suite',
    own: true,
    items: ['B52.9'],
    feature: 'Talyvor Connect',
    title: 'two connected assistants, then Sign out everywhere on Settings → Connect your AI: this browser is signed out and /mcp refuses both tokens',
    run: async (ctx) => {
      const origin = new URL(ctx.app.page.url()).origin
      const tokens: string[] = []
      for (const name of ['e2e Claude', 'e2e ChatGPT']) {
        const t = await connectAssistant(ctx, origin, name)
        if (typeof t !== 'string') return t
        tokens.push(t)
      }
      const before = await Promise.all(tokens.map(async (t) => (await mcp(origin, t)).status))
      if (before.some((s) => s !== 200)) return { pass: false, detail: `before signing out everywhere /mcp answered ${before.join(', ')}` }

      const page = ctx.app.page
      await page.goto(`${origin}/settings/connect`)
      await page.getByRole('button', { name: 'Sign out everywhere' }).click()
      await Promise.all([
        page.waitForResponse((r) => r.url().endsWith('/auth/logout-everywhere'), { timeout: 30_000 }),
        page.getByRole('button', { name: 'Yes, sign out everywhere' }).click(),
      ])
      const me = await page.evaluate(async () => (await (await fetch('/auth/me')).json()) as { authenticated?: boolean })
      const after = await Promise.all(tokens.map(async (t) => {
        const r = await mcp(origin, t)
        return `${r.status} ${await r.text()}`
      }))
      ctx.evidence.push({ note: `after signing out everywhere: /auth/me authenticated=${String(me.authenticated)}; /mcp on each token: ${after.join(' | ')}` })
      const wrong: string[] = []
      if (me.authenticated !== false) wrong.push('this browser is still signed in')
      for (const a of after) if (!a.startsWith('401') || !a.includes('not connected')) wrong.push(`an assistant's token answered ${a.slice(0, 120)}, not 401 not connected`)
      return wrong.length > 0 ? { pass: false, detail: wrong.join('; ') }
        : { pass: true, detail: 'Sign out everywhere signed this browser out, and /mcp refused both connected assistants as not connected' }
    },
  }
}

/** What /mcp answers a JSON-RPC message with: a tool's result, the server's description or its tools. */
interface RPCResult {
  isError?: boolean
  error?: unknown
  structuredContent?: Record<string, unknown>
  serverInfo?: { name?: string }
  tools?: { name: string; annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean } }[]
}

/** An assistant registered by DCR and allowed through the consent screen in the browser: its access token, or the failure. */
async function connectAssistant(ctx: ScenarioCtx, origin: string, name: string): Promise<string | { pass: false; detail: string }> {
  const server = createServer((_req, res) => res.writeHead(200, { 'Content-Type': 'text/plain' }).end('back at the assistant'))
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok))
  const callback = `http://127.0.0.1:${(server.address() as AddressInfo).port}/callback`
  try {
    const reg = await (await fetch(`${origin}/oauth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_name: name, redirect_uris: [callback] }) })).json() as { client_id?: string }
    if (reg.client_id === undefined) return { pass: false, detail: `registering the assistant answered ${JSON.stringify(reg)}` }
    const verifier = randomBytes(32).toString('base64url')
    const q = new URLSearchParams({ response_type: 'code', client_id: reg.client_id, redirect_uri: callback, state: 's',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
      scope: 'wallets:read invoices:draft payments:prepare', resource: `${origin}/mcp` })
    await ctx.app.page.goto(`${origin}/oauth/authorize?${q}`)
    await Promise.all([ctx.app.page.waitForURL((u) => u.href.startsWith(callback), { timeout: 30_000 }), ctx.app.page.getByRole('button', { name: 'Allow' }).click()])
    const code = new URL(ctx.app.page.url()).searchParams.get('code') ?? ''
    const tok = await form(`${origin}/oauth/token`, { grant_type: 'authorization_code', code, redirect_uri: callback, client_id: reg.client_id, code_verifier: verifier })
    const token = String(tok.json.access_token ?? '')
    return token !== '' ? token : { pass: false, detail: `the token endpoint answered ${tok.status} ${JSON.stringify(tok.json)}` }
  } finally {
    server.close()
    await ctx.app.page.goto(origin)
  }
}

/** JSON-RPC to /mcp on token, each message and its answer kept as evidence. */
function mcpTools(ctx: ScenarioCtx, origin: string, token: string) {
  let id = 0
  const rpc = async (method: string, params?: unknown): Promise<RPCResult> => {
    const res = await fetch(`${origin}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'MCP-Protocol-Version': '2025-06-18' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) })
    const body = await res.json() as { result?: RPCResult; error?: unknown }
    ctx.evidence.push({ note: `${method} ${JSON.stringify(params ?? {}).slice(0, 200)}: ${res.status} ${JSON.stringify(body).slice(0, 600)}` })
    return body.result ?? { isError: true, error: body.error }
  }
  return { rpc, tool: (name: string, args: Record<string, unknown>) => rpc('tools/call', { name, arguments: args }) }
}

// B40.7 — AN ASSISTANT USES TALYVOR'S MCP SERVER, AND IT PREPARES AND NEVER PAYS. One scenario, once a run, on a workspace
// of its own:
//   connect-mcp — on Lens's API the owner opens a GBP account for an agent and saves two payees. An assistant registered by
//     DCR is allowed through the consent screen in the browser; on its token /mcp lists the tools with their annotations
//     (get_balances read-only, prepare_batch destructive, nothing that pays), get_balances reads the GBP account,
//     draft_invoice keeps a draft, and prepare_batch for the two payees answers pending approval with the approval link
//     and the talyvor:// deep link, and still reads pending after. B40.35: create_payee_request is no payee on Lens until
//     the person presses Save on the Pay screen, where it waits; draft_mandate reads there in plain words and is no
//     mandate on Lens until it is signed with a passkey (this run's software passkey, through the screen's own two BFF
//     calls). B40.9: the approval link opens one card with both payments and their total, and with the second unticked
//     the statement the passkey would sign names only the first. B40.36: with one bill on Lens (its bank details printed
//     on it), bills_due lists that one bill and its total and never the bank details, and safe_to_spend counts it in the
//     company's GBP bills due. The money: no payment out, every account's test money and the workspace's ledger exactly as they were
//     before the assistant connected, but for ask_taly's own model charge (its spend and platform_fee rows). B45.39: a second bill, from a saved payee, arrives; bills_due lists both, and
//     prepare_bills_payment with no bill_ids prepares one request pending approval for both, the stranger's blocked. The
//     person's one passkey approval then posts exactly one payment out, to that payee at the bill's amount with its invoice
//     number, the company's account down by it; the same approval again is refused 409 and pays nothing. B45.41: the batch is
//     in list_approvals with its link and amount, and ask_taly answers a question.
export function connectMCP(): Scenario {
  return {
    id: 'connect-mcp',
    owner: 'talyvor-suite',
    own: true,
    agents: 1,
    items: ['B40.7', 'B40.35', 'B40.9', 'B40.36', 'B45.39', 'B45.41'],
    feature: 'Talyvor Connect',
    title: 'an assistant on /mcp lists the tools with their annotations, reads a balance, drafts an invoice and prepares a two-payee ' +
      'batch that stays pending approval; the payee and the mandate it asks for exist only once the person saves and signs them — ' +
      'no payment out, and the accounts and the ledger unchanged; then the bills due, prepared over /mcp as one request and approved once, ' +
      'pay exactly the bill from a saved payee',
    run: async (ctx) => {
      const origin = new URL(ctx.app.page.url()).origin
      const lensCall = async <T>(method: string, path: string, body: unknown, note: string) => {
        const r = await call<T>(ctx, method, path, body)
        ctx.evidence.push({ note, answer: said(r) })
        return r
      }
      // 1. On Lens's API: the terms, an agent with a GBP account, and two saved payees.
      const terms = await lensCall<{ terms: { capability: string; version: number; accepted?: unknown }[] | null }>('GET', '/v1/workspaces/{ws}/terms', undefined, 'the owner reads the terms')
      for (const t of (terms.value?.terms ?? []).filter((x) => ['currency_accounts', 'payments_in', 'payments_out'].includes(x.capability) && x.accepted == null)) {
        const ok = await lensCall('POST', `/v1/workspaces/{ws}/terms/${t.capability}/accept`, { version: t.version }, `the owner accepts ${t.capability}'s terms`)
        if (ok.status !== 201) return { pass: false, detail: `accepting ${t.capability}'s terms answered ${said(ok)}` }
      }
      const company = await lensCall<{ id: string }>('POST', '/v1/money/accounts', { currency: 'GBP' }, 'the company GBP account')
      if (company.status !== 201 || company.value === undefined) return { pass: false, detail: `the company GBP account answered ${said(company)}` }
      const funded = await lensCall('POST', `/v1/money/accounts/${company.value.id}/test-money`, { amount_minor: 5000, idempotency_key: `e2e-${randomBytes(8).toString('hex')}` }, 'the owner puts GBP 50.00 of test money in the company account')
      if (funded.status !== 201) return { pass: false, detail: `putting test money in the company GBP account answered ${said(funded)}` }
      const agent = await lensCall<{ id: string }>('POST', '/v1/workspaces/{ws}/agents', { name: `MCP agent ${randomBytes(3).toString('hex')}` }, 'an agent')
      if (agent.value?.id === undefined) return { pass: false, detail: `making an agent answered ${said(agent)}` }
      const account = await lensCall<{ id: string }>('POST', '/v1/money/accounts', { currency: 'GBP', agent_id: agent.value.id }, "the agent's GBP account")
      if (account.status !== 201 || account.value === undefined) return { pass: false, detail: `the agent's GBP account answered ${said(account)}` }
      const payees: string[] = []
      for (const [name, number] of [['Nightly MCP Supplier One Ltd', '12345678'], ['Nightly MCP Supplier Two Ltd', '23456789']]) {
        const p = await lensCall<{ id: string }>('POST', '/v1/money/payees', { name, country: 'GB', sort_code: '040004', account_number: number }, `the payee ${name}`)
        if (p.status !== 201 || p.value === undefined) return { pass: false, detail: `saving ${name} answered ${said(p)}` }
        payees.push(p.value.id)
      }
      const billNumber = `MCP-${randomBytes(3).toString('hex').toUpperCase()}` // Lens reads an invoice number upper-cased
      const bill = await ctx.env.lens.raw(ctx.app.user.token, 'POST', '/v1/money/bills?source=photo', ['From: Nightly MCP Bill Ltd', 'INVOICE',
        `Invoice number: ${billNumber}`, `Due date: ${new Date().toISOString().slice(0, 10)}`, 'Total due: GBP 42.00', 'Sort code: 04-00-04', 'Account number: 87654321'].join('\n'), 'text/plain')
      ctx.evidence.push({ note: 'one bill, its bank details printed on it', answer: `${bill.status} ${bill.text.slice(0, 160)}` })
      if (bill.status !== 201) return { pass: false, detail: `adding the bill answered ${bill.status} ${bill.text.slice(0, 160)}` }
      const money = async () => {
        const accounts = await call<{ accounts: { id: string; test_minor: number }[] | null }>(ctx, 'GET', '/v1/money/accounts')
        const payments = await call<{ payments: unknown[] | null }>(ctx, 'GET', '/v1/money/payments')
        // ask_taly is one model call, billed on the chat key like any Chat question (a spend and a platform_fee row,
        // prepaid credits paying for Talyvor's own service); every other row must stay exactly as it was.
        const rows = await ctx.env.lens.ledger(ctx.app.user)
        const charge = rows.filter((r) => (r.type === 'spend' || r.type === 'platform_fee') && r.amount_ulxc <= 0)
        const ledger = rows.filter((r) => !charge.includes(r))
        return { accounts: JSON.stringify((accounts.value?.accounts ?? []).map((a) => [a.id, a.test_minor])), payments: (payments.value?.payments ?? []).length,
          ledger: ledger.length, rows: JSON.stringify(ledger.map((r) => r.id).sort()), charged: charge.length }
      }
      const before = await money()
      ctx.evidence.push({ note: `before the assistant: accounts ${before.accounts}, ${before.payments} payments out, ${before.ledger} ledger rows` })

      // 2. An assistant connects through the consent screen.
      const token = await connectAssistant(ctx, origin, 'e2e assistant (MCP)')
      if (typeof token !== 'string') return token

      // 3. The tools.
      const { rpc, tool } = mcpTools(ctx, origin, token)
      const wrong: string[] = []
      const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } })
      if (init.serverInfo?.name !== 'talyvor') wrong.push(`initialize answered ${JSON.stringify(init)}`)
      const listed = (await rpc('tools/list')).tools ?? []
      const ann = (n: string) => listed.find((t) => t.name === n)?.annotations
      if (ann('get_balances')?.readOnlyHint !== true || ann('prepare_batch')?.destructiveHint !== true) wrong.push(`the tools are not listed with their annotations: ${JSON.stringify(listed.map((t) => [t.name, t.annotations]))}`)
      const payers = listed.filter((t) => /(^|_)(pay|approve|transfer|payout)(_|$)/.test(t.name))
      if (payers.length > 0) wrong.push(`/mcp lists tools that pay: ${payers.map((t) => t.name).join(', ')}`)

      const bal = await tool('get_balances', {})
      if (bal.isError !== false || !JSON.stringify(bal.structuredContent ?? {}).includes(account.value.id)) wrong.push(`get_balances does not read the agent's GBP account: ${JSON.stringify(bal).slice(0, 300)}`)
      const inv = await tool('draft_invoice', { account_id: account.value.id, customer_name: 'Nightly Customer Ltd', customer_email: 'customer@example.com',
        due_date: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10), lines: [{ description: 'Research', quantity: 2, unit_amount_minor: 5000, vat_rate_bps: 2000 }] })
      if (inv.isError !== false || inv.structuredContent?.status !== 'draft') wrong.push(`draft_invoice did not keep a draft: ${JSON.stringify(inv).slice(0, 300)}`)
      const items = payees.map((p, i) => ({ payee_id: p, currency: 'GBP', amount_minor: 1000 * (i + 1), reference: `MCP bill ${i + 1}` }))
      const batch = await tool('prepare_batch', { idempotency_key: `e2e-${randomBytes(8).toString('hex')}`, items })
      const pr = (batch.structuredContent ?? {}) as { id?: string; status?: string; approval_url?: string; deep_link?: string; items?: unknown[] }
      if (batch.isError !== false || pr.status !== 'pending_approval' || pr.items?.length !== 2 || !pr.approval_url?.includes(`/approve/${pr.id}`) || pr.deep_link !== `talyvor://approve/${pr.id}`) {
        wrong.push(`prepare_batch did not answer a two-item request pending approval with both links: ${JSON.stringify(batch).slice(0, 400)}`)
      }
      const status = await tool('get_request_status', { request_id: pr.id ?? '' })
      if (status.structuredContent?.status !== 'pending_approval') wrong.push(`the prepared batch then read ${JSON.stringify(status.structuredContent?.status)}, not pending_approval`)

      // B45.41 — what the desktop app uses: the batch is among the approvals waiting, with its link, and Taly answers
      //    with Chat's tools (the money check below holds that nothing moved).
      const waiting = ((await tool('list_approvals', {})).structuredContent?.approvals ?? []) as { id: string; approval_url: string; amount_minor: number }[]
      const ours = waiting.find((w) => w.id === pr.id)
      if (ours === undefined || ours.approval_url !== pr.approval_url || ours.amount_minor !== 3000) wrong.push(`list_approvals does not list the batch of GBP 30.00 with its link: ${JSON.stringify(waiting).slice(0, 400)}`)
      const taly = await tool('ask_taly', { message: 'What accounts does this workspace have?', thread: [] })
      if (taly.isError !== false || String(taly.structuredContent?.reply ?? '').trim() === '') wrong.push(`ask_taly did not answer: ${JSON.stringify(taly).slice(0, 400)}`)

      // 3a. B40.36 — the bill due and the safe-to-spend figure.
      const due = await tool('bills_due', {})
      const dueBills = (due.structuredContent?.bills ?? []) as { invoice_number?: string; amount_minor?: number }[]
      if (due.isError !== false || dueBills.length !== 1 || dueBills[0].invoice_number !== billNumber || dueBills[0].amount_minor !== 4200 ||
        (due.structuredContent?.totals as Record<string, number> | undefined)?.GBP !== 4200) {
        wrong.push(`bills_due does not list the one bill of GBP 42.00: ${JSON.stringify(due).slice(0, 400)}`)
      }
      if (/87654321|sort_code|account_number/.test(JSON.stringify(due))) wrong.push(`bills_due shows the bank details printed on the bill: ${JSON.stringify(due).slice(0, 400)}`)
      const safe = await tool('safe_to_spend', {})
      const companyGBP = ((safe.structuredContent?.company ?? []) as { currency: string; bills_due: number; safe_to_spend: number }[]).find((f) => f.currency === 'GBP')
      if (safe.isError !== false || companyGBP?.bills_due !== 4200 || typeof companyGBP.safe_to_spend !== 'number') {
        wrong.push(`safe_to_spend does not count the GBP 42.00 bill in the company's figure: ${JSON.stringify(safe).slice(0, 400)}`)
      }
      ctx.evidence.push({ note: `bills_due: ${dueBills.length} bill; safe_to_spend, the company's GBP: ${JSON.stringify(companyGBP)}` })

      // 3b. B40.35 — a payee and a mandate the assistant asks for wait for the person, on the Pay screen.
      const askedName = `Nightly MCP Asked Supplier ${randomBytes(3).toString('hex')} Ltd`
      const askedPayees = async () => ((await call<{ payees: { name: string }[] | null }>(ctx, 'GET', '/v1/money/payees')).value?.payees ?? []).filter((p) => p.name === askedName).length
      const mandates = async () => ((await call<{ mandates: unknown[] | null }>(ctx, 'GET', '/v1/money/permission-mandates')).value?.mandates ?? []).length
      const reg = await call<{ challenge: string; rp_id: string }>(ctx, 'POST', '/v1/workspaces/{ws}/agents/passkeys/challenge', {})
      if (reg.value === undefined) return { pass: false, detail: `the passkey registration challenge answered ${said(reg)}` }
      const key = softPasskey(reg.value.rp_id)
      const registered = await call(ctx, 'POST', '/v1/workspaces/{ws}/agents/passkeys', key.register(reg.value.challenge, 'Nightly MCP passkey'))
      if (registered.status !== 201) return { pass: false, detail: `registering a passkey answered ${said(registered)}` }
      const mandatesBefore = await mandates()
      const asked = await tool('create_payee_request', { name: askedName, country: 'GB', sort_code: '040004', account_number: '34567890' })
      const drafted = await tool('draft_mandate', { scope: { payees: [payees[0]], currencies: ['GBP'] }, limits: { per_payment: { GBP: 5000 } },
        new_payee: { policy: 'always_ask' }, expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 19) + 'Z' })
      const askedID = String(asked.structuredContent?.id ?? '')
      const mandateID = String(drafted.structuredContent?.id ?? '')
      const early = [await askedPayees(), await mandates() - mandatesBefore]
      ctx.evidence.push({ note: `after the assistant asked: ${early[0]} payees named ${askedName} and ${early[1]} new mandates on Lens` })
      if (asked.isError !== false || drafted.isError !== false || askedID === '' || mandateID === '') wrong.push(`create_payee_request or draft_mandate was refused: ${JSON.stringify([asked, drafted]).slice(0, 400)}`)
      else if (early[0] !== 0 || early[1] !== 0) wrong.push(`the assistant's request alone made ${early[0]} payees and ${early[1]} mandates on Lens`)
      else {
        const page = ctx.app.page
        await page.goto(`${origin}/money/pay`)
        const card = page.getByTestId(`asked-payee-${askedID}`)
        const mandate = page.getByTestId(`asked-mandate-${mandateID}`)
        try {
          await card.waitFor({ timeout: 30_000 })
          await mandate.waitFor({ timeout: 30_000 })
          const words = (await mandate.innerText()).replace(/\s+/g, ' ')
          ctx.evidence.push({ note: `the Pay screen: "${(await card.innerText()).replace(/\s+/g, ' ')}"; the mandate: "${words}"` })
          if (!words.includes('paid without asking you again') || !words.includes('£50.00 a payment')) wrong.push(`the drafted mandate reads "${words}"`)
          await card.getByRole('button', { name: 'Save payee' }).click()
          await card.waitFor({ state: 'detached', timeout: 30_000 })
        } catch (err) {
          wrong.push(`the Pay screen did not show and save the assistant's payee and mandate: ${String(err).slice(0, 300)}`)
        }
        // The screen's own two calls, signed with this run's software passkey where a browser would ask Face ID.
        const post = (path: string, body?: unknown) => page.request.post(`${origin}/api/money/assistant-requests/${mandateID}/${path}`, { headers: { Origin: origin }, data: body ?? {} })
        const prepared = await (await post('prepare')).json() as { canonical?: string; challenge?: string }
        const signed = await post('sign', { canonical: prepared.canonical, assertion: key.assert(prepared.challenge ?? '') })
        const late = [await askedPayees(), await mandates() - mandatesBefore]
        ctx.evidence.push({ note: `after Save and the passkey: sign answered ${signed.status()}; ${late[0]} payees named ${askedName}, ${late[1]} new mandates on Lens` })
        if (late[0] !== 1) wrong.push(`after Save, ${late[0]} payees are named ${askedName}, not 1`)
        if (signed.status() !== 201 || late[1] !== 1) wrong.push(`signing the drafted mandate answered ${signed.status()} ${(await signed.text()).slice(0, 200)} and made ${late[1]} mandates, not 201 and 1`)
        await page.goto(origin)
      }

      // 3c. B40.9 — the approval link opens one card with both payments and their total; unticking the second leaves a
      //     statement for the passkey that names only the first (the screen's own call; approving itself is B40.21's).
      if (pr.id !== undefined && pr.approval_url !== undefined) {
        const page = ctx.app.page
        try {
          await page.goto(`${origin}${new URL(pr.approval_url).pathname}`)
          const card = page.getByTestId('approve-card')
          await card.waitFor({ timeout: 30_000 })
          const words = (await card.innerText()).replace(/\s+/g, ' ')
          ctx.evidence.push({ note: `the approval card: "${words}"` })
          // B46.2 (Nick, 24 Oct): the card carries no "Test money" chip any more, so only the payees are read.
          if (!words.includes('Nightly MCP Supplier One Ltd') || !words.includes('Nightly MCP Supplier Two Ltd')) wrong.push(`the approval card does not show both payees: "${words}"`)
          if (!(await page.getByTestId('approve-total').innerText()).includes('2 of 2 payments to approve, total £30.00')) wrong.push(`the approval card's total reads "${await page.getByTestId('approve-total').innerText()}"`)
          await page.getByRole('checkbox', { name: 'Approve £20.00 to Nightly MCP Supplier Two Ltd' }).click()
          const total = await page.getByTestId('approve-total').innerText()
          if (!total.includes('1 of 2 payments to approve, total £10.00')) wrong.push(`after unticking the second payment the card reads "${total}"`)
        } catch (err) {
          wrong.push(`the approval link did not open a card with both payments: ${String(err).slice(0, 300)}`)
        }
        const prepared = await page.request.post(`${origin}/api/money/payment-requests/${pr.id}/approval`, { headers: { Origin: origin }, data: { positions: [1] } })
        const statement = JSON.parse(String(((await prepared.json()) as { statement?: string }).statement ?? '{}')) as { items?: { reference: string }[] }
        ctx.evidence.push({ note: `the statement for the first payment alone: ${prepared.status()} ${JSON.stringify(statement).slice(0, 400)}` })
        if (JSON.stringify((statement.items ?? []).map((it) => it.reference)) !== JSON.stringify(['MCP bill 1'])) wrong.push(`the statement to sign names ${JSON.stringify(statement.items)}, not only MCP bill 1`)
        await page.goto(origin)
      }

      // 4. The money: nothing moved.
      const after = await money()
      ctx.evidence.push({ note: `after the assistant: accounts ${after.accounts}, ${after.payments} payments out, ${after.ledger} ledger rows besides ${after.charged - before.charged} for asking Taly` })
      if (after.accounts !== before.accounts || after.payments !== before.payments || after.rows !== before.rows) {
        wrong.push(`money moved: accounts ${before.accounts} → ${after.accounts}, payments out ${before.payments} → ${after.payments}, ledger rows ${before.ledger} → ${after.ledger}`)
      }

      // 5. B45.39 — pay all due over /mcp. A bill from Supplier Two (the drafted mandate covers only Supplier One, so this
      //    payment needs the person's approval), then one request for every bill due, approved once with the passkey.
      const paid = await payAllDue(ctx, origin, tool, key, company.value.id, payees[1], billNumber)
      if (!paid.pass) wrong.push(paid.detail)
      return wrong.length > 0 ? { pass: false, detail: wrong.join('; ') }
        : { pass: true, detail: `${listed.length} tools listed with their annotations, none that pays; the balance read, an invoice drafted, request ${pr.id} prepared for two payees pending approval, and the asked-for payee and mandate made only by Save and the passkey — no payment out, the accounts and ${after.ledger} ledger rows unchanged besides asking Taly; ${paid.detail}` }
    },
  }
}

/**
 * B45.39 — connect-mcp's pay all due: a bill from the saved payee `payee` joins the stranger's bill `strangerBill`; bills_due
 * lists both, prepare_bills_payment with no bill_ids prepares one request for both with the stranger's blocked, and one
 * passkey approval posts exactly one payment out, to `payee` at the bill's amount with its invoice number, the company
 * account `accountID` down by it; a replay is refused 409. What happened, or what is wrong.
 */
async function payAllDue(ctx: ScenarioCtx, origin: string, tool: ReturnType<typeof mcpTools>['tool'], key: ReturnType<typeof softPasskey>,
  accountID: string, payee: string, strangerBill: string): Promise<{ pass: boolean; detail: string }> {
  const number = `MCP-PAY-${randomBytes(3).toString('hex').toUpperCase()}`
  const AMOUNT = 1250
  const added = await ctx.env.lens.raw(ctx.app.user.token, 'POST', '/v1/money/bills?source=photo', ['From: Nightly MCP Supplier Two Ltd', 'INVOICE',
    `Invoice number: ${number}`, `Due date: ${new Date().toISOString().slice(0, 10)}`, 'Total due: GBP 12.50', 'Sort code: 04-00-04', 'Account number: 23456789'].join('\n'), 'text/plain')
  ctx.evidence.push({ note: 'a second bill, from the saved payee Nightly MCP Supplier Two Ltd', answer: `${added.status} ${added.text.slice(0, 160)}` })
  if (added.status !== 201) return { pass: false, detail: `adding the second bill answered ${added.status} ${added.text.slice(0, 160)}` }
  interface Payment { id: string; payee_id: string; amount_minor: number; currency: string; reference: string }
  const money = async (note: string) => {
    const accounts = await call<{ accounts: { id: string; test_minor: number }[] | null }>(ctx, 'GET', '/v1/money/accounts')
    const payments = await call<{ payments: Payment[] | null }>(ctx, 'GET', '/v1/money/payments')
    const m = { held: (accounts.value?.accounts ?? []).find((a) => a.id === accountID)?.test_minor ?? -1, payments: payments.value?.payments ?? [] }
    ctx.evidence.push({ note: `${note}: the company GBP account holds ${m.held} minor of test money; ${m.payments.length} payments out ${JSON.stringify(m.payments.map((p) => [p.reference, p.amount_minor]))}` })
    return m
  }
  const due = await tool('bills_due', {})
  const numbers = ((due.structuredContent?.bills ?? []) as { invoice_number?: string }[]).map((b) => b.invoice_number)
  if (due.isError !== false || numbers.length !== 2 || !numbers.includes(number) || !numbers.includes(strangerBill)) return { pass: false, detail: `bills_due does not list both bills due: ${JSON.stringify(due).slice(0, 400)}` }
  const before = await money('before paying the bills')

  const prepared = await tool('prepare_bills_payment', { idempotency_key: `e2e-${randomBytes(8).toString('hex')}` })
  type Item = { position: number; payee_id?: string; amount_minor?: number; reference?: string; decision?: string }
  const pr = (prepared.structuredContent ?? {}) as { id?: string; status?: string; items?: Item[] }
  const payable = (pr.items ?? []).filter((it) => it.decision !== 'blocked')
  ctx.evidence.push({ note: `prepare_bills_payment: ${JSON.stringify(prepared).slice(0, 800)}` })
  if (prepared.isError !== false || pr.id === undefined || pr.status !== 'pending_approval' || pr.items?.length !== 2 || payable.length !== 1 ||
    payable[0].payee_id !== payee || payable[0].amount_minor !== AMOUNT || payable[0].reference !== number) {
    return { pass: false, detail: `prepare_bills_payment did not prepare one request pending approval for both bills, only Supplier Two's payable: ${JSON.stringify(prepared).slice(0, 400)}` }
  }
  const prepaid = await money('after prepare_bills_payment')
  if (prepaid.payments.length !== before.payments.length || prepaid.held !== before.held) return { pass: false, detail: 'prepare_bills_payment moved money before any approval' }

  const post = (path: string, body: unknown) => ctx.app.page.request.post(`${origin}/api/money/payment-requests/${pr.id}/${path}`, { headers: { Origin: origin }, data: body })
  const statement = await post('approval', { positions: [payable[0].position] })
  const toSign = await statement.json() as { statement?: string; challenge?: string }
  ctx.evidence.push({ note: `the statement to sign: ${statement.status()} ${String(toSign.statement).slice(0, 600)}` })
  if (statement.status() !== 200) return { pass: false, detail: `the statement to approve the bill answered ${statement.status()} ${JSON.stringify(toSign).slice(0, 300)}` }
  const approval = { statement: toSign.statement, assertion: key.assert(toSign.challenge ?? '') }
  const approved = await post('approve', approval)
  ctx.evidence.push({ note: `approve: ${approved.status()} ${(await approved.text()).slice(0, 800)}` })
  const after = await money('after the approval')
  const fresh = after.payments.filter((p) => !before.payments.some((b) => b.id === p.id))
  if (approved.status() !== 200 || fresh.length !== 1 || fresh[0].payee_id !== payee || fresh[0].amount_minor !== AMOUNT || fresh[0].currency !== 'GBP' || fresh[0].reference !== number) {
    return { pass: false, detail: `approving answered ${approved.status()} and posted ${JSON.stringify(fresh)}, not one payment of ${AMOUNT} GBP to ${payee} referenced ${number}` }
  }
  if (after.held !== before.held - AMOUNT) return { pass: false, detail: `the company GBP account went from ${before.held} to ${after.held} minor, not down by ${AMOUNT}` }
  const replay = await post('approve', approval)
  const again = await money('after the replayed approval')
  if (replay.status() !== 409 || again.payments.length !== after.payments.length || again.held !== after.held) {
    return { pass: false, detail: `the replayed approval answered ${replay.status()}: ${after.payments.length} → ${again.payments.length} payments out, the account ${after.held} → ${again.held} minor` }
  }
  return { pass: true, detail: `bills_due listed both bills, request ${pr.id} prepared for both with the stranger's blocked, and one approval paid ${fresh[0].id}: ${AMOUNT} GBP to Supplier Two referenced ${number}, the account ${before.held} → ${after.held} minor; the replay answered 409` }
}

// B40.21 — AN ASSISTANT PREPARES A BATCH OVER MCP, AND THE PERSON APPROVES IT ONCE. One scenario, once a run, on a workspace
// of its own:
//   connect-approve — on Lens's API the owner opens the company's GBP account, saves two payees and registers this run's
//     software passkey. An assistant connected through the consent screen asks prepare_batch to pay raw bank details:
//     refused, and nothing moves. It prepares a batch for the two saved payees; the person approves both with one passkey,
//     through the approval screen's own two calls. Then exactly two payments out post, each with its payee, amount and
//     reference, and the company's account is down by their total; the same approval sent again is refused 409 and posts
//     nothing. An assistant's batch pays from the company's account, so that account must hold the test money.
export function connectApprove(): Scenario {
  return {
    id: 'connect-approve',
    owner: 'talyvor-lens',
    own: true,
    items: ['B40.21'],
    feature: 'Talyvor Connect',
    title: 'an assistant prepares a two-payee batch over MCP and the person approves it once with a passkey: exactly two payments ' +
      'post with their references and the company account is down by their total, a replayed approval posts nothing, and a ' +
      'batch carrying raw bank details is refused',
    run: async (ctx) => {
      const origin = new URL(ctx.app.page.url()).origin
      const lensCall = async <T>(method: string, path: string, body: unknown, note: string) => {
        const r = await call<T>(ctx, method, path, body)
        ctx.evidence.push({ note, answer: said(r) })
        return r
      }
      // 1. On Lens's API: the terms, the company's GBP account with GBP 50.00 of test money, two saved payees and a passkey.
      const terms = await lensCall<{ terms: { capability: string; version: number; accepted?: unknown }[] | null }>('GET', '/v1/workspaces/{ws}/terms', undefined, 'the owner reads the terms')
      for (const t of (terms.value?.terms ?? []).filter((x) => ['currency_accounts', 'payments_in', 'payments_out'].includes(x.capability) && x.accepted == null)) {
        const ok = await lensCall('POST', `/v1/workspaces/{ws}/terms/${t.capability}/accept`, { version: t.version }, `the owner accepts ${t.capability}'s terms`)
        if (ok.status !== 201) return { pass: false, detail: `accepting ${t.capability}'s terms answered ${said(ok)}` }
      }
      const company = await lensCall<{ id: string }>('POST', '/v1/money/accounts', { currency: 'GBP' }, 'the company GBP account')
      if (company.status !== 201 || company.value === undefined) return { pass: false, detail: `the company GBP account answered ${said(company)}` }
      const funded = await lensCall('POST', `/v1/money/accounts/${company.value.id}/test-money`, { amount_minor: 5000, idempotency_key: `e2e-${randomBytes(8).toString('hex')}` }, 'the owner puts GBP 50.00 of test money in the company account')
      if (funded.status !== 201) return { pass: false, detail: `putting test money in the company GBP account answered ${said(funded)}` }
      const names = ['Nightly Approve Supplier One Ltd', 'Nightly Approve Supplier Two Ltd']
      const payees: string[] = []
      for (const [i, name] of names.entries()) {
        const p = await lensCall<{ id: string }>('POST', '/v1/money/payees', { name, country: 'GB', sort_code: '040004', account_number: `4567890${i}` }, `the payee ${name}`)
        if (p.status !== 201 || p.value === undefined) return { pass: false, detail: `saving ${name} answered ${said(p)}` }
        payees.push(p.value.id)
      }
      const reg = await lensCall<{ challenge: string; rp_id: string }>('POST', '/v1/workspaces/{ws}/agents/passkeys/challenge', {}, 'the passkey registration challenge')
      if (reg.value === undefined) return { pass: false, detail: `the passkey registration challenge answered ${said(reg)}` }
      const key = softPasskey(reg.value.rp_id)
      const registered = await lensCall('POST', '/v1/workspaces/{ws}/agents/passkeys', key.register(reg.value.challenge, 'Nightly approve passkey'), 'the passkey')
      if (registered.status !== 201) return { pass: false, detail: `registering a passkey answered ${said(registered)}` }

      interface Payment { id: string; payee_id: string; amount_minor: number; currency: string; reference: string; status: string }
      const money = async (note: string) => {
        const accounts = await call<{ accounts: { id: string; test_minor: number }[] | null }>(ctx, 'GET', '/v1/money/accounts')
        const payments = await call<{ payments: Payment[] | null }>(ctx, 'GET', '/v1/money/payments')
        const m = { held: (accounts.value?.accounts ?? []).find((a) => a.id === company.value?.id)?.test_minor ?? -1, payments: payments.value?.payments ?? [] }
        ctx.evidence.push({ note: `${note}: the company GBP account holds ${m.held} minor of test money; ${m.payments.length} payments out ${JSON.stringify(m.payments.map((p) => [p.reference, p.amount_minor, p.status]))}` })
        return m
      }
      const before = await money('before the assistant')

      // 2. An assistant connects; a batch carrying raw bank details is refused, and nothing moves.
      const token = await connectAssistant(ctx, origin, 'e2e assistant (approve)')
      if (typeof token !== 'string') return token
      const { tool } = mcpTools(ctx, origin, token)
      const wrong: string[] = []
      const raw = await tool('prepare_batch', { idempotency_key: `e2e-${randomBytes(8).toString('hex')}`,
        items: [{ name: 'Nightly Raw Details Ltd', sort_code: '040004', account_number: '56789012', currency: 'GBP', amount_minor: 500, reference: 'MCP raw details' }] })
      if (raw.isError !== true || raw.structuredContent?.id !== undefined) wrong.push(`prepare_batch with raw bank details was not refused: ${JSON.stringify(raw).slice(0, 300)}`)

      // 3. A batch for the two saved payees, pending approval.
      const items = payees.map((p, i) => ({ payee_id: p, currency: 'GBP', amount_minor: 1000 * (i + 1), reference: `MCP approve ${i + 1} ${randomBytes(3).toString('hex')}` }))
      const total = items.reduce((s, it) => s + it.amount_minor, 0)
      const batch = await tool('prepare_batch', { idempotency_key: `e2e-${randomBytes(8).toString('hex')}`, items })
      const pr = (batch.structuredContent ?? {}) as { id?: string; status?: string; items?: unknown[] }
      if (batch.isError !== false || pr.id === undefined || pr.status !== 'pending_approval' || pr.items?.length !== 2) {
        wrong.push(`prepare_batch did not answer a two-item request pending approval: ${JSON.stringify(batch).slice(0, 400)}`)
        return { pass: false, detail: wrong.join('; ') }
      }

      // 4. One approval for both, signed with the passkey: the approval screen's own two calls.
      const post = (path: string, body: unknown) => ctx.app.page.request.post(`${origin}/api/money/payment-requests/${pr.id}/${path}`, { headers: { Origin: origin }, data: body })
      const prepared = await post('approval', { positions: [1, 2] })
      const toSign = await prepared.json() as { statement?: string; challenge?: string; allow_credentials?: string[] | null }
      ctx.evidence.push({ note: `the statement to sign: ${prepared.status()} ${String(toSign.statement).slice(0, 600)}` })
      const named = (JSON.parse(toSign.statement ?? '{}') as { items?: { reference: string }[] }).items?.map((it) => it.reference) ?? []
      if (prepared.status() !== 200 || JSON.stringify(named) !== JSON.stringify(items.map((it) => it.reference))) {
        return { pass: false, detail: `the statement to approve both answered ${prepared.status()} naming ${JSON.stringify(named)}, not both payments` }
      }
      if (!(toSign.allow_credentials ?? []).includes(key.credentialID)) wrong.push(`the approval's challenge does not allow this run's passkey: ${JSON.stringify(toSign.allow_credentials)}`)
      const approval = { statement: toSign.statement, assertion: key.assert(toSign.challenge ?? '') }
      const approved = await post('approve', approval)
      const paid = await approved.json() as { status?: string; items?: { position: number; payment_id?: string; pay_status?: string; pay_detail?: string }[] }
      ctx.evidence.push({ note: `approve: ${approved.status()} ${JSON.stringify(paid).slice(0, 800)}` })
      if (approved.status() !== 200 || paid.status !== 'approved') wrong.push(`approving answered ${approved.status()} ${JSON.stringify(paid).slice(0, 300)}`)
      const unpaid = (paid.items ?? []).filter((it) => !it.payment_id)
      if (unpaid.length > 0) wrong.push(`after the approval ${unpaid.length} of 2 items have no payment: ${unpaid.map((it) => `item ${it.position} ${it.pay_status} "${it.pay_detail}"`).join('; ')}`)

      // 5. The money: exactly the two payments, and the account down by their total.
      const after = await money('after the approval')
      const fresh = after.payments.filter((p) => !before.payments.some((b) => b.id === p.id))
      for (const [i, it] of items.entries()) {
        const p = fresh.filter((x) => x.reference === it.reference)
        if (p.length !== 1 || p[0].payee_id !== it.payee_id || p[0].amount_minor !== it.amount_minor || p[0].currency !== 'GBP') {
          wrong.push(`Lens lists ${p.length} payments referenced "${it.reference}" (${JSON.stringify(p)}), not one of ${it.amount_minor} GBP to ${names[i]}`)
        }
      }
      if (fresh.length !== 2) wrong.push(`the approval posted ${fresh.length} payments out, not 2`)
      if (after.held !== before.held - total) wrong.push(`the company GBP account went from ${before.held} to ${after.held} minor of test money, not down by ${total}`)

      // 6. The same approval again: refused, and nothing more posts.
      const replay = await post('approve', approval)
      const again = await money('after the replayed approval')
      ctx.evidence.push({ note: `the approval sent again: ${replay.status()} ${(await replay.text()).slice(0, 300)}` })
      if (replay.status() !== 409) wrong.push(`the replayed approval answered ${replay.status()}, not 409`)
      if (again.payments.length !== after.payments.length || again.held !== after.held) {
        wrong.push(`the replayed approval moved money: ${after.payments.length} → ${again.payments.length} payments out, the account ${after.held} → ${again.held} minor`)
      }
      await ctx.app.page.goto(origin)

      return wrong.length > 0 ? { pass: false, detail: wrong.join('; ') }
        : { pass: true, detail: `raw bank details refused; request ${pr.id} approved once with a passkey paid exactly two payments (${items.map((it) => it.reference).join(', ')}), the company account ${before.held} → ${after.held} minor; the replay answered 409 and posted nothing` }
    },
  }
}

// B45.38 — "TRANSFER $500 TO MIKE THROUGH TALY", OVER MCP. One scenario, once a run, on a workspace of its own:
//   connect-contact — on Lens's API the owner opens the company's USD account with $1,000.00 of test money, saves three
//     payees, "Mike Jones", "Mike Smith" and "Grace Hopper", and registers this run's software passkey. An assistant
//     connected through the consent screen asks prepare_payment_to_contact for $500 to "Mike": it answers "Which Mike?"
//     with both Mikes and prepares nothing. For "Grace" it prepares one $500 request to Grace's payee, which the person
//     approves with the passkey through the approval screen's own two calls. Then exactly one payment out of 50000 USD
//     to Grace's payee posts and the company's account is down by 50000; the same approval sent again is refused 409
//     and pays nothing.
export function connectContact(): Scenario {
  return {
    id: 'connect-contact',
    owner: 'talyvor-suite',
    own: true,
    items: ['B45.38'],
    feature: 'Talyvor Connect',
    title: 'an assistant asked to pay $500 to "Mike" with two saved Mikes asks which one and prepares nothing; to "Grace" it prepares ' +
      "one $500 request, and the person's one passkey approval pays exactly 50000 USD to Grace's payee, a replayed approval nothing",
    run: async (ctx) => {
      const origin = new URL(ctx.app.page.url()).origin
      const lensCall = async <T>(method: string, path: string, body: unknown, note: string) => {
        const r = await call<T>(ctx, method, path, body)
        ctx.evidence.push({ note, answer: said(r) })
        return r
      }
      // 1. On Lens's API: the terms, the company's USD account with $1,000.00 of test money, three saved payees and a passkey.
      const terms = await lensCall<{ terms: { capability: string; version: number; accepted?: unknown }[] | null }>('GET', '/v1/workspaces/{ws}/terms', undefined, 'the owner reads the terms')
      for (const t of (terms.value?.terms ?? []).filter((x) => ['currency_accounts', 'payments_in', 'payments_out'].includes(x.capability) && x.accepted == null)) {
        const ok = await lensCall('POST', `/v1/workspaces/{ws}/terms/${t.capability}/accept`, { version: t.version }, `the owner accepts ${t.capability}'s terms`)
        if (ok.status !== 201) return { pass: false, detail: `accepting ${t.capability}'s terms answered ${said(ok)}` }
      }
      const company = await lensCall<{ id: string }>('POST', '/v1/money/accounts', { currency: 'USD' }, 'the company USD account')
      if (company.status !== 201 || company.value === undefined) return { pass: false, detail: `the company USD account answered ${said(company)}` }
      const funded = await lensCall('POST', `/v1/money/accounts/${company.value.id}/test-money`, { amount_minor: 100000, idempotency_key: `e2e-${randomBytes(8).toString('hex')}` }, 'the owner puts $1,000.00 of test money in the company account')
      if (funded.status !== 201) return { pass: false, detail: `putting test money in the company USD account answered ${said(funded)}` }
      const payee: Record<string, string> = {}
      for (const [i, name] of ['Mike Jones', 'Mike Smith', 'Grace Hopper'].entries()) {
        const p = await lensCall<{ id: string }>('POST', '/v1/money/payees', { name, country: 'US', routing_number: '021000021', account_number: `12345678${i}` }, `the payee ${name}`)
        if (p.status !== 201 || p.value === undefined) return { pass: false, detail: `saving ${name} answered ${said(p)}` }
        payee[name] = p.value.id
      }
      const reg = await lensCall<{ challenge: string; rp_id: string }>('POST', '/v1/workspaces/{ws}/agents/passkeys/challenge', {}, 'the passkey registration challenge')
      if (reg.value === undefined) return { pass: false, detail: `the passkey registration challenge answered ${said(reg)}` }
      const key = softPasskey(reg.value.rp_id)
      const registered = await lensCall('POST', '/v1/workspaces/{ws}/agents/passkeys', key.register(reg.value.challenge, 'Nightly contact passkey'), 'the passkey')
      if (registered.status !== 201) return { pass: false, detail: `registering a passkey answered ${said(registered)}` }

      interface Payment { id: string; payee_id: string; amount_minor: number; currency: string; status: string }
      const money = async (note: string) => {
        const accounts = await call<{ accounts: { id: string; test_minor: number }[] | null }>(ctx, 'GET', '/v1/money/accounts')
        const payments = await call<{ payments: Payment[] | null }>(ctx, 'GET', '/v1/money/payments')
        const pending = await call<{ requests: unknown[] | null }>(ctx, 'GET', '/v1/money/payment-requests?status=pending_approval')
        const m = { held: (accounts.value?.accounts ?? []).find((a) => a.id === company.value?.id)?.test_minor ?? -1, payments: payments.value?.payments ?? [], pending: (pending.value?.requests ?? []).length }
        ctx.evidence.push({ note: `${note}: the company USD account holds ${m.held} minor of test money; ${m.pending} requests pending; ${m.payments.length} payments out ${JSON.stringify(m.payments.map((p) => [p.payee_id, p.amount_minor, p.currency, p.status]))}` })
        return m
      }
      const before = await money('before the assistant')

      // 2. An assistant connects; "Mike" is two saved contacts, so it is asked which, and nothing is prepared.
      const token = await connectAssistant(ctx, origin, 'e2e assistant (contact)')
      if (typeof token !== 'string') return token
      const { rpc, tool } = mcpTools(ctx, origin, token)
      const wrong: string[] = []
      const listed = (await rpc('tools/list')).tools ?? []
      if (listed.find((t) => t.name === 'prepare_payment_to_contact')?.annotations?.destructiveHint !== true) {
        return { pass: false, detail: `/mcp does not list prepare_payment_to_contact as destructive: ${JSON.stringify(listed.map((t) => t.name))}` }
      }
      const mike = await tool('prepare_payment_to_contact', { idempotency_key: `e2e-${randomBytes(8).toString('hex')}`, contact: 'Mike', currency: 'USD', amount_minor: 50000 })
      const asked = (mike.structuredContent ?? {}) as { question?: string; contacts?: { payee_id: string }[]; id?: string }
      const afterMike = await money('after "Mike"')
      if (mike.isError !== false || !String(asked.question).startsWith('Which Mike?') || asked.id !== undefined ||
        JSON.stringify((asked.contacts ?? []).map((c) => c.payee_id).sort()) !== JSON.stringify([payee['Mike Jones'], payee['Mike Smith']].sort())) {
        wrong.push(`"Mike" did not ask which Mike with both saved Mikes: ${JSON.stringify(mike).slice(0, 400)}`)
      }
      if (afterMike.pending !== before.pending || afterMike.payments.length !== before.payments.length) wrong.push(`"Mike" prepared ${afterMike.pending - before.pending} requests and ${afterMike.payments.length - before.payments.length} payments`)

      // 3. "Grace" is one saved contact: one $500 request to her payee, pending approval.
      const grace = await tool('prepare_payment_to_contact', { idempotency_key: `e2e-${randomBytes(8).toString('hex')}`, contact: 'Grace', currency: 'USD', amount_minor: 50000, reference: 'Nightly transfer to Grace' })
      const pr = (grace.structuredContent ?? {}) as { id?: string; status?: string; items?: { payee_id?: string; amount_minor?: number; currency?: string }[] }
      const item = pr.items?.[0]
      if (grace.isError !== false || pr.id === undefined || pr.status !== 'pending_approval' || pr.items?.length !== 1 || item?.payee_id !== payee['Grace Hopper'] || item?.amount_minor !== 50000 || item?.currency !== 'USD') {
        wrong.push(`"Grace" did not prepare one $500 request to Grace's payee pending approval: ${JSON.stringify(grace).slice(0, 400)}`)
        return { pass: false, detail: wrong.join('; ') }
      }

      // 4. One approval, signed with the passkey: the approval screen's own two calls.
      const post = (path: string, body: unknown) => ctx.app.page.request.post(`${origin}/api/money/payment-requests/${pr.id}/${path}`, { headers: { Origin: origin }, data: body })
      const prepared = await post('approval', { positions: [1] })
      const toSign = await prepared.json() as { statement?: string; challenge?: string }
      ctx.evidence.push({ note: `the statement to sign: ${prepared.status()} ${String(toSign.statement).slice(0, 600)}` })
      if (prepared.status() !== 200) return { pass: false, detail: `the statement to approve answered ${prepared.status()} ${JSON.stringify(toSign).slice(0, 300)}` }
      const approval = { statement: toSign.statement, assertion: key.assert(toSign.challenge ?? '') }
      const approved = await post('approve', approval)
      const paid = await approved.json() as { status?: string }
      ctx.evidence.push({ note: `approve: ${approved.status()} ${JSON.stringify(paid).slice(0, 800)}` })
      if (approved.status() !== 200 || paid.status !== 'approved') wrong.push(`approving answered ${approved.status()} ${JSON.stringify(paid).slice(0, 300)}`)

      // 5. The money: exactly one payment out of 50000 USD, to Grace's payee, and the account down by it.
      const after = await money('after the approval')
      const fresh = after.payments.filter((p) => !before.payments.some((b) => b.id === p.id))
      if (fresh.length !== 1 || fresh[0].payee_id !== payee['Grace Hopper'] || fresh[0].amount_minor !== 50000 || fresh[0].currency !== 'USD') {
        wrong.push(`the approval posted ${JSON.stringify(fresh)}, not one payment of 50000 USD to Grace Hopper's payee ${payee['Grace Hopper']}`)
      }
      if (after.held !== before.held - 50000) wrong.push(`the company USD account went from ${before.held} to ${after.held} minor of test money, not down by 50000`)

      // 6. The same approval again: refused, and nothing more is paid.
      const replay = await post('approve', approval)
      const again = await money('after the replayed approval')
      ctx.evidence.push({ note: `the approval sent again: ${replay.status()} ${(await replay.text()).slice(0, 300)}` })
      if (replay.status() !== 409) wrong.push(`the replayed approval answered ${replay.status()}, not 409`)
      if (again.payments.length !== after.payments.length || again.held !== after.held) {
        wrong.push(`the replayed approval moved money: ${after.payments.length} → ${again.payments.length} payments out, the account ${after.held} → ${again.held} minor`)
      }
      await ctx.app.page.goto(origin)

      return wrong.length > 0 ? { pass: false, detail: wrong.join('; ') }
        : { pass: true, detail: `"Mike" asked "${asked.question}" with both Mikes and prepared nothing; "Grace" prepared request ${pr.id}, and one passkey approval paid ${fresh[0].id}: 50000 USD to Grace Hopper's payee, the account ${before.held} → ${after.held} minor; the replay answered 409 and paid nothing` }
    },
  }
}

// B45.37 — AN ASSISTANT PREPARES RECURRING PAYMENTS AND THE PERSON SIGNS THEM IN THE APP. One scenario, once a run, on a
// workspace of its own:
//   connect-recurring — on Lens's API the owner opens a GBP account with test money, saves two payees and registers a
//     passkey. An assistant on /mcp prepares a two-line list with prepare_recurring_payments (destructive): nothing is
//     prepared to pay before the person signs. The link opens the plan screen, which shows both orders waiting for the
//     signature; signed with this run's software passkey (the screen's own call), the screen shows them running, and
//     within Lens's minute tick each order's first run waits under Approvals. Each is approved with the passkey, and the
//     money is exactly one payment out per order at its amount, the account down by both. B45.43: then each order is
//     brought due again (Lens B45.42) and runs once more: the order at or under ask_above pays on its own, and the order
//     above it waits under Approvals and pays nothing.
export function connectRecurring(): Scenario {
  return {
    id: 'connect-recurring',
    owner: 'talyvor-suite',
    own: true,
    items: ['B45.37', 'B45.43'],
    feature: 'Talyvor Connect',
    title: 'an assistant prepares two recurring payments over /mcp; nothing runs until the person signs the plan in the app with a passkey, ' +
      'then each order shows running, its first run waits under Approvals, and one approval each pays exactly its amount; ' +
      'run again, the order under ask_above pays on its own and the one above it waits',
    run: async (ctx) => {
      const origin = new URL(ctx.app.page.url()).origin
      const page = ctx.app.page
      const lensCall = async <T>(method: string, path: string, body: unknown, note: string) => {
        const r = await call<T>(ctx, method, path, body)
        ctx.evidence.push({ note, answer: said(r) })
        return r
      }
      // 1. On Lens's API: the terms, the company's GBP account with £1,000.00 of test money, two saved payees and a passkey.
      const terms = await lensCall<{ terms: { capability: string; version: number; accepted?: unknown }[] | null }>('GET', '/v1/workspaces/{ws}/terms', undefined, 'the owner reads the terms')
      for (const t of (terms.value?.terms ?? []).filter((x) => ['currency_accounts', 'payments_in', 'payments_out'].includes(x.capability) && x.accepted == null)) {
        const ok = await lensCall('POST', `/v1/workspaces/{ws}/terms/${t.capability}/accept`, { version: t.version }, `the owner accepts ${t.capability}'s terms`)
        if (ok.status !== 201) return { pass: false, detail: `accepting ${t.capability}'s terms answered ${said(ok)}` }
      }
      const company = await lensCall<{ id: string }>('POST', '/v1/money/accounts', { currency: 'GBP' }, 'the company GBP account')
      if (company.status !== 201 || company.value === undefined) return { pass: false, detail: `the company GBP account answered ${said(company)}` }
      const funded = await lensCall('POST', `/v1/money/accounts/${company.value.id}/test-money`, { amount_minor: 100000, idempotency_key: `e2e-${randomBytes(8).toString('hex')}` }, 'the owner puts £1,000.00 of test money in the company account')
      if (funded.status !== 201) return { pass: false, detail: `putting test money in the company GBP account answered ${said(funded)}` }
      const lines = [{ name: 'Nightly Recurring Rent Ltd', amount: 30000, every: 'month' }, { name: 'Nightly Recurring Fibre Ltd', amount: 1250, every: 'week' }]
      const payee: Record<string, string> = {}
      for (const [i, l] of lines.entries()) {
        const p = await lensCall<{ id: string }>('POST', '/v1/money/payees', { name: l.name, country: 'GB', sort_code: '040004', account_number: `4567890${i}` }, `the payee ${l.name}`)
        if (p.status !== 201 || p.value === undefined) return { pass: false, detail: `saving ${l.name} answered ${said(p)}` }
        payee[l.name] = p.value.id
      }
      const reg = await lensCall<{ challenge: string; rp_id: string }>('POST', '/v1/workspaces/{ws}/agents/passkeys/challenge', {}, 'the passkey registration challenge')
      if (reg.value === undefined) return { pass: false, detail: `the passkey registration challenge answered ${said(reg)}` }
      const key = softPasskey(reg.value.rp_id)
      const registered = await lensCall('POST', '/v1/workspaces/{ws}/agents/passkeys', key.register(reg.value.challenge, 'Nightly recurring passkey'), 'the passkey')
      if (registered.status !== 201) return { pass: false, detail: `registering a passkey answered ${said(registered)}` }

      interface Payment { id: string; payee_id: string; amount_minor: number; currency: string; status: string }
      interface Request { id: string; client: string; status: string }
      const money = async (note: string, planID = '') => {
        const accounts = await call<{ accounts: { id: string; test_minor: number }[] | null }>(ctx, 'GET', '/v1/money/accounts')
        const payments = await call<{ payments: Payment[] | null }>(ctx, 'GET', '/v1/money/payments')
        const pending = await call<{ requests: Request[] | null }>(ctx, 'GET', '/v1/money/payment-requests?status=pending_approval')
        const m = { held: (accounts.value?.accounts ?? []).find((a) => a.id === company.value?.id)?.test_minor ?? -1, payments: payments.value?.payments ?? [],
          runs: (pending.value?.requests ?? []).filter((r) => planID !== '' && r.client === `schedule:${planID}`) }
        ctx.evidence.push({ note: `${note}: the company GBP account holds ${m.held} minor of test money; ${m.runs.length} first runs waiting; ${m.payments.length} payments out ${JSON.stringify(m.payments.map((p) => [p.payee_id, p.amount_minor, p.currency, p.status]))}` })
        return m
      }
      const before = await money('before the assistant')

      // 2. An assistant prepares the two-line list: a plan to sign, and nothing that pays.
      const token = await connectAssistant(ctx, origin, 'e2e assistant (recurring)')
      if (typeof token !== 'string') return token
      const { rpc, tool } = mcpTools(ctx, origin, token)
      const wrong: string[] = []
      const listed = (await rpc('tools/list')).tools ?? []
      if (listed.find((t) => t.name === 'prepare_recurring_payments')?.annotations?.destructiveHint !== true) {
        return { pass: false, detail: `/mcp does not list prepare_recurring_payments as destructive: ${JSON.stringify(listed.map((t) => t.name))}` }
      }
      const prepared = await tool('prepare_recurring_payments', { idempotency_key: `e2e-${randomBytes(8).toString('hex')}`, ask_above: { GBP: 20000 },
        until: new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 19) + 'Z',
        payments: lines.map((l) => ({ payee_id: payee[l.name], currency: 'GBP', amount_minor: l.amount, every: l.every, reference: `Nightly ${l.every}ly` })) })
      const kept = (prepared.structuredContent ?? {}) as { id?: string; kind?: string; confirm_url?: string; details?: { id?: string; schedules?: { id?: string; active?: boolean }[]; mandate?: { canonical?: string; challenge?: string } } }
      const plan = kept.details ?? {}
      if (prepared.isError !== false || kept.kind !== 'plan' || plan.id === undefined || plan.schedules?.length !== 2 || plan.schedules.some((x) => x.active) ||
        !String(kept.confirm_url).includes(`/money/plans/${kept.id}`)) {
        return { pass: false, detail: `prepare_recurring_payments did not keep a two-order plan to sign with its link: ${JSON.stringify(prepared).slice(0, 500)}` }
      }
      await new Promise((ok) => setTimeout(ok, 70_000)) // past Lens's minute tick: unsigned, nothing may run
      const unsigned = await money('a minute after the assistant, unsigned', plan.id)
      if (unsigned.runs.length !== 0 || unsigned.payments.length !== before.payments.length) wrong.push(`unsigned, the plan prepared ${unsigned.runs.length} runs and ${unsigned.payments.length - before.payments.length} payments`)

      // 3. The link opens the plan screen; signed with the passkey (the screen's own call), its orders read Running.
      const screenWords = async (note: string) => {
        await page.goto(`${origin}${new URL(String(kept.confirm_url)).pathname}`)
        const card = page.getByTestId('plan-card')
        await card.waitFor({ timeout: 30_000 })
        await page.getByText(lines[0].name).first().waitFor({ timeout: 30_000 })
        const words = (await card.innerText()).replace(/\s+/g, ' ')
        ctx.evidence.push({ note: `${note}: "${words}"` })
        return words
      }
      // B17.356 — a Pill draws its words in capitals, so innerText reads RUNNING; count the pills by their own words instead.
      const pills = (status: string) => page.getByTestId('plan-card').getByText(status, { exact: true }).count()
      try {
        const words = await screenWords('the plan screen before signing')
        for (const l of lines) if (!words.includes(l.name)) wrong.push(`the plan screen does not show ${l.name}`)
        if (!words.includes('£300.00 every month') || !words.includes('£12.50 every week') || await pills('Waiting for your signature') !== 2 ||
          !words.includes('A payment above £200.00 always waits for your approval.')) wrong.push(`the plan screen reads "${words}"`)
      } catch (err) {
        wrong.push(`the plan screen did not open from the assistant's link: ${String(err).slice(0, 300)}`)
      }
      const signed = await page.request.post(`${origin}/api/money/assistant-requests/${kept.id}/sign`, { headers: { Origin: origin },
        data: { canonical: plan.mandate?.canonical, assertion: key.assert(plan.mandate?.challenge ?? '') } })
      ctx.evidence.push({ note: `signing the plan: ${signed.status()} ${(await signed.text()).slice(0, 300)}` })
      if (signed.status() !== 201) return { pass: false, detail: [...wrong, `signing the plan answered ${signed.status()}`].join('; ') }
      try {
        const words = await screenWords('the plan screen after signing')
        if (await pills('Running') !== 2 || words.includes('Sign with passkey')) wrong.push(`after signing the plan screen reads "${words}"`)
      } catch (err) {
        wrong.push(`the plan screen did not open after signing: ${String(err).slice(0, 300)}`)
      }

      // 4. Within Lens's minute tick each order's first run waits under Approvals; one passkey approval each pays it.
      let runs: Request[] = []
      for (let i = 0; i < 18 && runs.length < 2; i++) {
        await new Promise((ok) => setTimeout(ok, 10_000))
        runs = (await money(`${(i + 1) * 10}s after signing`, plan.id)).runs
      }
      if (runs.length !== 2) return { pass: false, detail: [...wrong, `three minutes after signing ${runs.length} first runs wait for approval, not 2`].join('; ') }
      for (const r of runs) {
        const post = (path: string, body: unknown) => page.request.post(`${origin}/api/money/payment-requests/${r.id}/${path}`, { headers: { Origin: origin }, data: body })
        const toSign = await (await post('approval', { positions: [1] })).json() as { statement?: string; challenge?: string }
        const approved = await post('approve', { statement: toSign.statement, assertion: key.assert(toSign.challenge ?? '') })
        const paid = await approved.json() as { status?: string }
        ctx.evidence.push({ note: `approving first run ${r.id}: ${approved.status()} ${JSON.stringify(paid).slice(0, 400)}` })
        if (approved.status() !== 200 || paid.status !== 'approved') wrong.push(`approving first run ${r.id} answered ${approved.status()} ${JSON.stringify(paid).slice(0, 200)}`)
      }

      // 5. The money: exactly one payment out per order at its amount, and the account down by both.
      const after = await money('after both approvals', plan.id)
      const fresh = after.payments.filter((p) => !before.payments.some((b) => b.id === p.id))
      const want = lines.map((l) => [payee[l.name], l.amount, 'GBP'].join(' ')).sort()
      const got = fresh.map((p) => [p.payee_id, p.amount_minor, p.currency].join(' ')).sort()
      if (JSON.stringify(got) !== JSON.stringify(want)) wrong.push(`the approvals posted ${JSON.stringify(got)}, not ${JSON.stringify(want)}`)
      if (after.held !== before.held - 31250) wrong.push(`the company GBP account went from ${before.held} to ${after.held} minor of test money, not down by 31250`)
      await page.goto(origin)

      // 6. B45.43 — run again: both orders brought due now (Lens B45.42). Fibre (£12.50, at or under ask_above's £200.00)
      // pays on its own; Rent (£300.00, above it) waits under Approvals and pays nothing.
      for (const s of plan.schedules) {
        const due = await ctx.env.lens.bringScheduleDue(ctx.app.user, String(s.id))
        ctx.evidence.push({ note: `order ${s.id} brought due now (B45.42)`, answer: JSON.stringify(due).slice(0, 400) })
        if (!due.ok) return { pass: false, detail: [...wrong, `bringing order ${s.id} due again answered ${due.status} ${due.error}`].join('; ') }
      }
      let again = after
      for (let i = 0; i < 18 && (again.runs.length === 0 || again.payments.length === after.payments.length); i++) {
        await new Promise((ok) => setTimeout(ok, 10_000))
        again = await money(`${(i + 1) * 10}s after both orders were brought due again`, plan.id)
      }
      const fibre = [payee[lines[1].name], lines[1].amount, 'GBP'].join(' ')
      const second = again.payments.filter((p) => !after.payments.some((b) => b.id === p.id)).map((p) => [p.payee_id, p.amount_minor, p.currency].join(' '))
      if (JSON.stringify(second) !== JSON.stringify([fibre])) wrong.push(`run again, the orders paid ${JSON.stringify(second)} on their own, not only ${fibre}`)
      if (again.held !== after.held - lines[1].amount) wrong.push(`run again, the company GBP account went from ${after.held} to ${again.held} minor of test money, not down by ${lines[1].amount}`)
      if (again.runs.length !== 1) wrong.push(`run again, ${again.runs.length} runs of plan ${plan.id} wait under Approvals, not the one above ask_above`)

      return wrong.length > 0 ? { pass: false, detail: wrong.join('; ') }
        : { pass: true, detail: `plan ${plan.id} waited unsigned with nothing run; signed in the app its two orders read Running, each first run waited under Approvals, and one approval each paid ${got.join(' and ')}: the account ${before.held} → ${after.held} minor; ` +
          `run again, ${second[0]} paid on its own (the account → ${again.held} minor) and request ${again.runs[0].id} for the order above ask_above waits under Approvals` }
    },
  }
}
