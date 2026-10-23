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
import { call, said } from './settings.ts'
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

/** What /mcp answers a JSON-RPC message with: a tool's result, the server's description or its tools. */
interface RPCResult {
  isError?: boolean
  error?: unknown
  structuredContent?: Record<string, unknown>
  serverInfo?: { name?: string }
  tools?: { name: string; annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean } }[]
}

// B40.7 — AN ASSISTANT USES TALYVOR'S MCP SERVER, AND IT PREPARES AND NEVER PAYS. One scenario, once a run, on a workspace
// of its own:
//   connect-mcp — on Lens's API the owner opens a GBP account for an agent and saves two payees. An assistant registered by
//     DCR is allowed through the consent screen in the browser; on its token /mcp lists the tools with their annotations
//     (get_balances read-only, prepare_batch destructive, nothing that pays), get_balances reads the GBP account,
//     draft_invoice keeps a draft, and prepare_batch for the two payees answers pending approval with the approval link
//     and the talyvor:// deep link, and still reads pending after. The money: no payment out, every account's test money
//     and the workspace's ledger exactly as they were before the assistant connected.
export function connectMCP(): Scenario {
  return {
    id: 'connect-mcp',
    owner: 'talyvor-suite',
    own: true,
    agents: 1,
    items: ['B40.7'],
    feature: 'Talyvor Connect',
    title: 'an assistant on /mcp lists the tools with their annotations, reads a balance, drafts an invoice and prepares a two-payee ' +
      'batch that stays pending approval — no payment out, and the accounts and the ledger unchanged',
    run: async (ctx) => {
      const origin = new URL(ctx.app.page.url()).origin
      const lensCall = async <T>(method: string, path: string, body: unknown, note: string) => {
        const r = await call<T>(ctx, method, path, body)
        ctx.evidence.push({ note, answer: said(r) })
        return r
      }
      // 1. On Lens's API: the terms, an agent with a GBP account, and two saved payees.
      const terms = await lensCall<{ terms: { capability: string; version: number; accepted?: unknown }[] | null }>('GET', '/v1/workspaces/{ws}/terms', undefined, 'the owner reads the terms')
      for (const t of (terms.value?.terms ?? []).filter((x) => ['currency_accounts', 'payments_in'].includes(x.capability) && x.accepted == null)) {
        const ok = await lensCall('POST', `/v1/workspaces/{ws}/terms/${t.capability}/accept`, { version: t.version }, `the owner accepts ${t.capability}'s terms`)
        if (ok.status !== 201) return { pass: false, detail: `accepting ${t.capability}'s terms answered ${said(ok)}` }
      }
      if ((await lensCall('POST', '/v1/money/accounts', { currency: 'GBP' }, 'the company GBP account')).status !== 201) return { pass: false, detail: 'the company GBP account was not opened' }
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
      const money = async () => {
        const accounts = await call<{ accounts: { id: string; test_minor: number }[] | null }>(ctx, 'GET', '/v1/money/accounts')
        const payments = await call<{ payments: unknown[] | null }>(ctx, 'GET', '/v1/money/payments')
        const ledger = await ctx.env.lens.ledger(ctx.app.user)
        return { accounts: JSON.stringify((accounts.value?.accounts ?? []).map((a) => [a.id, a.test_minor])), payments: (payments.value?.payments ?? []).length, ledger: ledger.length }
      }
      const before = await money()
      ctx.evidence.push({ note: `before the assistant: accounts ${before.accounts}, ${before.payments} payments out, ${before.ledger} ledger rows` })

      // 2. An assistant connects through the consent screen.
      const server = createServer((_req, res) => res.writeHead(200, { 'Content-Type': 'text/plain' }).end('back at the assistant'))
      await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok))
      const callback = `http://127.0.0.1:${(server.address() as AddressInfo).port}/callback`
      let token = ''
      try {
        const reg = await (await fetch(`${origin}/oauth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_name: 'e2e assistant (MCP)', redirect_uris: [callback] }) })).json() as { client_id?: string }
        if (reg.client_id === undefined) return { pass: false, detail: `registering the assistant answered ${JSON.stringify(reg)}` }
        const verifier = randomBytes(32).toString('base64url')
        const q = new URLSearchParams({ response_type: 'code', client_id: reg.client_id, redirect_uri: callback, state: 's',
          code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
          scope: 'wallets:read invoices:draft payments:prepare', resource: `${origin}/mcp` })
        await ctx.app.page.goto(`${origin}/oauth/authorize?${q}`)
        await Promise.all([ctx.app.page.waitForURL((u) => u.href.startsWith(callback), { timeout: 30_000 }), ctx.app.page.getByRole('button', { name: 'Allow' }).click()])
        const code = new URL(ctx.app.page.url()).searchParams.get('code') ?? ''
        const tok = await form(`${origin}/oauth/token`, { grant_type: 'authorization_code', code, redirect_uri: callback, client_id: reg.client_id, code_verifier: verifier })
        token = String(tok.json.access_token ?? '')
        if (token === '') return { pass: false, detail: `the token endpoint answered ${tok.status} ${JSON.stringify(tok.json)}` }
      } finally {
        server.close()
        await ctx.app.page.goto(origin)
      }

      // 3. The tools.
      let id = 0
      const rpc = async (method: string, params?: unknown): Promise<RPCResult> => {
        const res = await fetch(`${origin}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'MCP-Protocol-Version': '2025-06-18' },
          body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) })
        const body = await res.json() as { result?: RPCResult; error?: unknown }
        ctx.evidence.push({ note: `${method} ${JSON.stringify(params ?? {}).slice(0, 200)}: ${res.status} ${JSON.stringify(body).slice(0, 600)}` })
        return body.result ?? { isError: true, error: body.error }
      }
      const tool = (name: string, args: Record<string, unknown>) => rpc('tools/call', { name, arguments: args })
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

      // 4. The money: nothing moved.
      const after = await money()
      ctx.evidence.push({ note: `after the assistant: accounts ${after.accounts}, ${after.payments} payments out, ${after.ledger} ledger rows` })
      if (after.accounts !== before.accounts || after.payments !== before.payments || after.ledger !== before.ledger) {
        wrong.push(`money moved: accounts ${before.accounts} → ${after.accounts}, payments out ${before.payments} → ${after.payments}, ledger rows ${before.ledger} → ${after.ledger}`)
      }
      return wrong.length > 0 ? { pass: false, detail: wrong.join('; ') }
        : { pass: true, detail: `${listed.length} tools listed with their annotations, none that pays; the balance read, an invoice drafted, and request ${pr.id} prepared for two payees pending approval — no payment out, the accounts and ${after.ledger} ledger rows unchanged` }
    },
  }
}
