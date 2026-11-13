// B45.31 — the trust layer end to end (Lens B45.24, B45.28, B45.29; the card of suite B45.25), on Lens's API and the app's
// approval card, once a run, on a workspace of its own.
//
// An outside agent publishes an Ed25519 key at https://<its domain>/.well-known/http-message-signatures-directory and asks the
// owner's agent to be paid, signed under Talyvor's money profile (RFC 9421: method, full URL, Content-Digest and Signature-Agent
// covered, 5 minutes, a nonce). The request lands in the owner's approvals as "Signed by <domain> (business not checked)" — on
// Lens and on the app's approval card — and nothing is paid. The same request with a signature by another key under the
// published key's id is refused 401 and lands nowhere; unsigned, it lands as "Unverified agent". Then the owner, signing with a
// passkey, lets an approver agent approve a payer's requests up to its own limit: it approves one within it, which then pays once
// (a pay line on its statement), and is refused 409 above it, where nothing moves and the request waits for the owner. The owner's own
// approval of that one is an AP2 v0.2 closed Payment Mandate that verifies with only /.well-known/talyvor-ap2/jwks.json.
// Lens fetches the outside agent's keys over https, so against a deployed Lens the directory is served through a Cloudflare quick
// tunnel (trackWebhooks.ts); --hook-tunnel none signs as https://127.0.0.1:<port>, which only the self-test's stub reads.

import { type ChildProcess } from 'node:child_process'
import { createHash, createPublicKey, generateKeyPairSync, type JsonWebKey, type KeyObject, randomBytes, randomUUID, sign, verify } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { fail } from './bank.ts'
import type { Answered } from './lens.ts'
import { RUN_SALT } from './oracles.ts'
import { softPasskey } from './payees.ts'
import { said } from './routes.ts'
import { CannotTest, type Scenario } from './scenarios.ts'
import { tunnel } from './trackWebhooks.ts'

interface Trust { level: string; label: string; domain?: string; business?: string }
interface Request { id: string; status: string; agent_trust?: Trust | null }
interface Approver { id: string; limit_ulxc: number; mandate: string }

const PAYEE = { name: 'Nightly Outside Agent Ltd', country: 'GB', sort_code: '040004', account_number: '86420135' }
const CAPABILITIES = ['currency_accounts', 'payments_out']
const FUND_ULXC = 1_000_000
const PAYER_ASKS_ABOVE_ULXC = 100_000
const APPROVER_LIMIT_ULXC = 200_000
const WITHIN_ULXC = 150_000
const ABOVE_ULXC = 250_000
const TIMEOUT_MS = 30_000

const b64u = (b: Buffer) => b.toString('base64url')
const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest()

/** An outside agent's Ed25519 key: its JWK, and its keyid — the RFC 7638 thumbprint Web Bot Auth signs with. */
export function agentKey(): { privateKey: KeyObject; jwk: { kty: string; crv: string; x: string }; keyID: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const x = String(publicKey.export({ format: 'jwk' }).x)
  return { privateKey, jwk: { kty: 'OKP', crv: 'Ed25519', x }, keyID: b64u(sha256(`{"crv":"Ed25519","kty":"OKP","x":"${x}"}`)) }
}

/** The headers of a request signed under Talyvor's money profile (docs/agent-signatures.md), as `keyID`, with `privateKey`. */
export function moneySignature(privateKey: KeyObject, keyID: string, agent: string, url: string, body: string): Record<string, string> {
  const digest = `sha-256=:${sha256(body).toString('base64')}:`
  const created = Math.floor(Date.now() / 1000)
  const params = `("@method" "@target-uri" "content-digest" "signature-agent");created=${created};expires=${created + 240};` +
    `keyid="${keyID}";alg="ed25519";nonce="${b64u(randomBytes(16))}";tag="web-bot-auth"`
  const signatureAgent = `"${agent}"`
  const base = `"@method": POST\n"@target-uri": ${url}\n"content-digest": ${digest}\n"signature-agent": ${signatureAgent}\n"@signature-params": ${params}`
  return { 'Content-Digest': digest, 'Signature-Agent': signatureAgent, 'Signature-Input': `sig1=${params}`,
    Signature: `sig1=:${sign(null, Buffer.from(base), privateKey).toString('base64')}:` }
}

/** The claims of an AP2 v0.2 SD-JWT (docs/ap2-mandates.md) if it verifies under one of `keys`, else why not. */
export function verifySDJWT(sdjwt: string, keys: JsonWebKey[]): { claims: Record<string, unknown> } | { wrong: string } {
  if (!sdjwt.endsWith('~')) return { wrong: 'an SD-JWT ends in ~' }
  const [jws, ...disclosures] = sdjwt.slice(0, -1).split('~')
  const [h, p, s] = jws.split('.')
  let header: { alg?: string; typ?: string; kid?: string }
  let claims: Record<string, unknown>
  try {
    header = JSON.parse(Buffer.from(h, 'base64url').toString())
    claims = JSON.parse(Buffer.from(p, 'base64url').toString())
  } catch {
    return { wrong: 'its JWS is not two base64url JSON parts and a signature' }
  }
  if (header.alg !== 'ES256' || header.typ !== 'dc+sd-jwt') return { wrong: `its header is alg ${header.alg}, typ ${header.typ}, not ES256 dc+sd-jwt` }
  const jwk = keys.find((k) => (k as { kid?: string }).kid === header.kid)
  if (jwk === undefined) return { wrong: `the JWKS has no key ${header.kid}` }
  const key = createPublicKey({ key: jwk, format: 'jwk' })
  if (!verify('sha256', Buffer.from(`${h}.${p}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(s ?? '', 'base64url'))) return { wrong: 'its ES256 signature does not verify' }
  if (claims._sd_alg !== 'sha-256') return { wrong: `its _sd_alg is ${String(claims._sd_alg)}` }
  const signed = new Set(Array.isArray(claims._sd) ? claims._sd as string[] : [])
  const out: Record<string, unknown> = { ...claims }
  delete out._sd
  delete out._sd_alg
  for (const d of disclosures) {
    if (!signed.delete(b64u(sha256(d)))) return { wrong: 'a disclosure the issuer did not sign, or given twice' }
    const [, name, value] = JSON.parse(Buffer.from(d, 'base64url').toString()) as [string, string, unknown]
    out[name] = value
  }
  return { claims: out }
}

export function trustLayer(): Scenario {
  return {
    id: 'trust-layer',
    owner: 'talyvor-lens',
    own: true,
    agents: 3,
    feature: 'Agent Wallets',
    items: ['B45.24', 'B45.25', 'B45.28', 'B45.29', 'B45.31'],
    title: "an outside agent's signed payment request lands in the owner's approvals as \"Signed by <domain>\", on Lens and the approval card, " +
      'unpaid; a forged signature refused 401, unsigned "Unverified agent"; an approver agent approves within its limit, which pays once, ' +
      "and is refused 409 above it; the owner's approval is an AP2 v0.2 mandate that verifies with the published key",
    run: async (ctx) => {
      const { lens } = ctx.env
      const user = ctx.app.user
      const call = async <T>(method: string, path: string, body: object | undefined, note: string): Promise<Answered<T>> => {
        const got = await lens.act<T>(user, method, path, body)
        ctx.evidence.push({ note, answer: said(got) })
        return got
      }

      // The owner's payee, which the outside agent asks to be paid to, and the agent it asks.
      const terms = await call<{ terms: { capability: string; version: number; accepted?: unknown }[] | null }>('GET', '/v1/workspaces/{ws}/terms', undefined, 'the owner reads the terms')
      if (!terms.ok) return fail(`reading the workspace's terms answered ${said(terms)}`)
      for (const t of (terms.value.terms ?? []).filter((x) => CAPABILITIES.includes(x.capability) && x.accepted == null)) {
        const ok = await call('POST', `/v1/workspaces/{ws}/terms/${t.capability}/accept`, { version: t.version }, `the owner accepts ${t.capability}'s terms`)
        if (ok.status !== 201) return fail(`accepting ${t.capability}'s terms answered ${said(ok)}`)
      }
      const saved = await call<{ id: string }>('POST', '/v1/money/payees', PAYEE, 'the owner saves the outside agent as a payee')
      if (saved.status !== 201 || !saved.ok) return fail(`saving the payee must answer 201; Lens answered ${said(saved)}`)
      const payer = await lens.createAgent(user, `Trust payer ${RUN_SALT}`)
      const payee = await lens.createAgent(user, `Trust payee ${RUN_SALT}`)
      const approver = await lens.createAgent(user, `Trust approver ${RUN_SALT}`)

      // The outside agent's key directory, public.
      const key = agentKey()
      const probe = `e2e-${randomBytes(8).toString('hex')}`
      const server = createServer((req, res) => {
        if (req.url === '/.well-known/http-message-signatures-directory') {
          res.writeHead(200, { 'Content-Type': 'application/http-message-signatures-directory+json' }).end(JSON.stringify({ keys: [key.jwk] }))
        } else res.writeHead(req.url === `/${probe}` ? 200 : 404).end(probe)
      })
      await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok))
      let proc: ChildProcess | undefined
      try {
        let agent = `https://127.0.0.1:${(server.address() as AddressInfo).port}`
        if (ctx.env.hookTunnel !== 'none') {
          const t = await tunnel((server.address() as AddressInfo).port, probe)
          proc = t.proc
          agent = t.url
        }
        const domain = new URL(agent).hostname
        ctx.evidence.push({ note: `the outside agent signs as ${agent}` })

        const path = `/v1/a2a/agents/${payer.id}/payment-requests`
        const ask = async (reference: string, signed: 'yes' | 'forged' | 'no', note: string) => {
          const body = JSON.stringify({ items: [{ payee_id: saved.value.id, currency: 'GBP', amount_minor: 12_500, reference }] })
          const forger = agentKey()
          const headers = signed === 'no' ? {} : moneySignature(signed === 'yes' ? key.privateKey : forger.privateKey, key.keyID, agent, lens.baseURL + path, body)
          const res = await fetch(lens.baseURL + path, { method: 'POST', body, signal: AbortSignal.timeout(TIMEOUT_MS),
            headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'Idempotency-Key': `e2e-${randomUUID()}`, ...headers } })
          const text = await res.text()
          ctx.evidence.push({ note, answer: `${res.status} ${text.slice(0, 300)}` })
          let value: Request | undefined
          try { value = JSON.parse(text) as Request } catch { /* a refusal's text is kept above */ }
          return { status: res.status, text, value }
        }
        const pending = async () => {
          const r = await call<{ requests: Request[] | null }>('GET', '/v1/money/payment-requests?status=pending_approval', undefined, "the owner reads the approvals")
          if (!r.ok) throw new Error(`the owner's approvals answered ${said(r)}`)
          return r.value.requests ?? []
        }

        // Signed: it lands in the owner's approvals as signed by its domain, and nothing is paid.
        const signed = await ask(`TRUST-${RUN_SALT}-1`, 'yes', `the outside agent asks to be paid £125.00, signed as ${domain}`)
        if (signed.status !== 201 || signed.value?.status !== 'pending_approval' || signed.value.agent_trust?.level !== 'signed' || signed.value.agent_trust.domain !== domain) {
          return fail(`a request signed by ${domain} must answer 201 pending_approval with agent_trust level signed for ${domain}; Lens answered ${signed.status} ${signed.text.slice(0, 300)}`)
        }
        const id = signed.value.id
        let listed = (await pending()).find((r) => r.id === id)
        if (listed?.agent_trust?.level !== 'signed' || listed.agent_trust.label !== `Signed by ${domain} (business not checked)`) {
          return fail(`the signed request ${id} must be in the owner's approvals as "Signed by ${domain} (business not checked)"; it reads ${JSON.stringify(listed)}`)
        }
        const page = ctx.app.page
        await page.goto(new URL(`/approve/${id}`, page.url()).href)
        const words = await page.getByTestId('approve-trust').innerText({ timeout: TIMEOUT_MS }).catch((e: Error) => `(no approve-trust: ${e.message.split('\n')[0]})`)
        ctx.evidence.push({ note: `the approval card for ${id}`, answer: words })
        if (!words.includes(`Signed by ${domain} (business not checked)`) || words.includes('Verified agent')) {
          return fail(`the approval card for ${id} must say "Signed by ${domain} (business not checked)"; it reads "${words}"`)
        }
        const one = await call<{ items: { payment_id?: string; pay_status?: string }[] | null }>('GET', `/v1/money/payment-requests/${id}`, undefined, 'the owner reads the signed request')
        if (!one.ok || (one.value.items ?? []).some((it) => (it.payment_id ?? '') !== '' || (it.pay_status ?? '') !== '')) {
          return fail(`an outside agent's request must pay nothing until the owner approves it; Lens reads ${said(one)}`)
        }

        // Forged: another key under the published key's id is refused, and lands nowhere.
        const forged = await ask(`TRUST-${RUN_SALT}-2`, 'forged', `the same request signed by another key under ${domain}'s keyid`)
        if (forged.status !== 401 || !/does not verify/i.test(forged.text)) return fail(`a forged signature must be refused 401 "does not verify"; Lens answered ${forged.status} ${forged.text.slice(0, 300)}`)
        // Unsigned: it lands as an unverified agent.
        const unsigned = await ask(`TRUST-${RUN_SALT}-3`, 'no', 'the same request, unsigned')
        if (unsigned.status !== 201 || unsigned.value?.agent_trust?.level !== 'unverified') {
          return fail(`an unsigned request must answer 201 with agent_trust level unverified; Lens answered ${unsigned.status} ${unsigned.text.slice(0, 300)}`)
        }
        const all = await pending()
        listed = all.find((r) => r.id === unsigned.value?.id)
        if (listed?.agent_trust?.label !== 'Unverified agent') return fail(`the unsigned request must be in the owner's approvals as "Unverified agent"; it reads ${JSON.stringify(listed)}`)
        const outside = all.filter((r) => r.agent_trust != null)
        if (outside.length !== 2) return fail(`the owner's approvals must hold exactly the signed and the unsigned request, not the forged one; they hold ${JSON.stringify(outside)}`)
      } catch (e) {
        if (e instanceof CannotTest) throw e
        return fail((e as Error).message)
      } finally {
        proc?.kill()
        server.closeAllConnections()
        server.close()
      }

      // The owner's passkey, and the approver: its own limit is the lower of its per-request limit and its approval amount.
      const reg = await call<{ challenge: string; rp_id: string }>('POST', '/v1/workspaces/{ws}/agents/passkeys/challenge', {}, 'the owner asks to register a passkey')
      if (!reg.ok) return fail(`the passkey registration challenge was refused: ${said(reg)}`)
      const passkey = softPasskey(reg.value.rp_id)
      const registered = await call('POST', '/v1/workspaces/{ws}/agents/passkeys', passkey.register(reg.value.challenge, 'Nightly trust passkey'), 'the owner registers a P-256 passkey')
      if (registered.status !== 201) return fail(`registering a passkey must answer 201; Lens answered ${said(registered)}`)
      const book = await lens.agentBook(user)
      if (book.unallocated_ulxc < FUND_ULXC) throw new CannotTest(`the workspace has ${book.unallocated_ulxc} µLXC free, under the ${FUND_ULXC} µLXC its payer is funded`)
      await lens.fundAgent(user, payer.id, FUND_ULXC)
      const rules = async (id: string, approvalAbove: number, name: string) => {
        const r = await lens.act(user, 'PUT', `/v1/workspaces/{ws}/agents/${id}/rules`, { ...await lens.agentRules(user, id), approval_above_ulxc: approvalAbove })
        if (!r.ok) throw new Error(`saving ${name}'s approval amount was refused: ${r.status} ${r.error}`)
      }
      const payerKey = await lens.act<{ key: string }>(user, 'POST', `/v1/workspaces/{ws}/agents/${payer.id}/keys`, { name: 'trust-layer payer' })
      const approverKey = await lens.act<{ key: string }>(user, 'POST', `/v1/workspaces/{ws}/agents/${approver.id}/keys`, { name: 'trust-layer approver' })
      if (!payerKey.ok || !approverKey.ok) return fail(`issuing the agents keys was refused: ${said(payerKey)}; ${said(approverKey)}`)
      try {
        await rules(payer.id, PAYER_ASKS_ABOVE_ULXC, payer.name)
        await rules(approver.id, APPROVER_LIMIT_ULXC, approver.name)
      } catch (e) {
        return fail((e as Error).message)
      }
      const challenge = await call<{ challenge: string; limit_ulxc: number }>('POST', `/v1/workspaces/{ws}/agents/${payer.id}/approver/challenge`,
        { approver_agent_id: approver.id }, `the owner asks to let ${approver.name} approve ${payer.name}'s requests`)
      if (!challenge.ok || challenge.value.limit_ulxc !== APPROVER_LIMIT_ULXC) return fail(`the approver's challenge must name its own ${APPROVER_LIMIT_ULXC} µLXC limit; Lens answered ${said(challenge)}`)
      const set = await call<Approver>('PUT', `/v1/workspaces/{ws}/agents/${payer.id}/approver`,
        { approver_agent_id: approver.id, assertion: passkey.assert(challenge.value.challenge) }, 'the owner signs it with the passkey')
      if (set.status !== 201 || !set.ok || set.value.limit_ulxc !== APPROVER_LIMIT_ULXC) return fail(`setting the approver must answer 201 with its limit; Lens answered ${said(set)}`)

      const memo = (n: number) => `trust ${RUN_SALT} ${n}`
      const pay = async (amount: number, note: string) => {
        const r = await lens.payAsAgent(payerKey.value.key, user.workspaceID, payer.id, payee.id, amount, memo(amount))
        ctx.evidence.push({ note, answer: r.ok ? `paid ${JSON.stringify(r.value)}` : `${r.status} ${r.error}` })
        return r
      }
      const file = async (amount: number): Promise<string> => {
        const r = await pay(amount, `${payer.name} pays ${amount} µLXC, above its ${PAYER_ASKS_ABOVE_ULXC} µLXC approval amount`)
        const id = (await lens.agentApprovals(user)).find((a) => a.agent_id === payer.id && a.amount_ulxc === amount && a.status === 'pending')?.id
        if (r.ok || r.status !== 403 || id === undefined) throw new Error(`${amount} µLXC above the approval amount must be refused 403 and file a pending approval; Lens answered ${r.ok ? 'paid' : `${r.status} ${r.error}`}`)
        return id
      }
      const asApprover = async (approval: string, note: string) => {
        const r = await lens.as(approverKey.value.key, 'POST', `/v1/workspaces/${user.workspaceID}/agents/${approver.id}/approvals/${approval}/approve`, {})
        ctx.evidence.push({ note, answer: `${r.status} ${r.text.slice(0, 300)}` })
        return r
      }
      // The payer's pay lines on its statement: the ledger's postings of each payment it made.
      const paidTo = async (amount: number) => (await lens.agentLines(user, payer.id)).filter((l) => l.kind === 'pay' && l.amount_ulxc === -amount).length

      let within: string
      let above: string
      try {
        // Within its limit: the approver approves, and the payment then goes through once.
        within = await file(WITHIN_ULXC)
        const ok = await asApprover(within, `${approver.name} approves ${WITHIN_ULXC} µLXC, within its ${APPROVER_LIMIT_ULXC} µLXC`)
        if (ok.status !== 200) return fail(`the approver approving ${WITHIN_ULXC} µLXC within its ${APPROVER_LIMIT_ULXC} µLXC limit must answer 200; Lens answered ${ok.status} ${ok.text.slice(0, 300)}`)
        const retried = await pay(WITHIN_ULXC, `${payer.name} pays the approved ${WITHIN_ULXC} µLXC again`)
        if (!retried.ok) return fail(`the payment its approver approved must go through; Lens answered ${retried.status} ${retried.error}`)
        if (await paidTo(WITHIN_ULXC) !== 1) return fail(`the approved ${WITHIN_ULXC} µLXC must be exactly one pay line on ${payer.name}'s statement; it has ${await paidTo(WITHIN_ULXC)}`)

        // Above it: refused, nothing moves, and the request waits for the owner.
        above = await file(ABOVE_ULXC)
      } catch (e) {
        return fail((e as Error).message)
      }
      const refused = await asApprover(above, `${approver.name} approves ${ABOVE_ULXC} µLXC, above its ${APPROVER_LIMIT_ULXC} µLXC`)
      if (refused.status !== 409) return fail(`the approver approving ${ABOVE_ULXC} µLXC above its ${APPROVER_LIMIT_ULXC} µLXC limit must be refused 409; Lens answered ${refused.status} ${refused.text.slice(0, 300)}`)
      const still = await pay(ABOVE_ULXC, `${payer.name} pays the ${ABOVE_ULXC} µLXC again, its approver having refused`)
      const status = (await lens.agentApprovals(user)).find((a) => a.id === above)?.status
      if (still.ok || status !== 'pending' || await paidTo(ABOVE_ULXC) !== 0) {
        return fail(`above its approver's limit nothing may move and the approval waits for the owner; the retry ${still.ok ? 'paid' : `answered ${still.status}`}, ` +
          `approval ${above} is ${status}, and ${await paidTo(ABOVE_ULXC)} pay line(s) of ${ABOVE_ULXC} µLXC`)
      }

      // The owner approves it with the passkey: an AP2 v0.2 closed Payment Mandate, verified with only the published key.
      const c = await call<{ challenge: string }>('POST', `/v1/workspaces/{ws}/agents/approvals/${above}/challenge`, {}, `the owner asks for ${above}'s challenge`)
      if (!c.ok) return fail(`approval ${above}'s challenge was refused: ${said(c)}`)
      const approved = await call('POST', `/v1/workspaces/{ws}/agents/approvals/${above}/approve`, { assertion: passkey.assert(c.value.challenge) }, 'the owner approves it with the passkey')
      if (approved.status !== 200) return fail(`the owner approving ${above} with the passkey must answer 200; Lens answered ${said(approved)}`)
      const evidence = await call<{ owner_mandate?: string; jwks_url?: string }>('GET', `/v1/workspaces/{ws}/agents/approvals/${above}/evidence`, undefined, `the owner reads what proves ${above}`)
      if (!evidence.ok || (evidence.value.owner_mandate ?? '') === '') return fail(`the owner's approval must carry its mandate; Lens answered ${said(evidence)}`)
      const jwks = await lens.as('', 'GET', evidence.value.jwks_url ?? '/.well-known/talyvor-ap2/jwks.json')
      ctx.evidence.push({ note: 'anyone reads the AP2 key', answer: `${jwks.status} ${jwks.text.slice(0, 300)}` })
      let keys: JsonWebKey[] = []
      try { keys = (JSON.parse(jwks.text) as { keys?: JsonWebKey[] }).keys ?? [] } catch { /* refused below */ }
      const checked = verifySDJWT(evidence.value.owner_mandate ?? '', keys)
      if ('wrong' in checked) return fail(`the owner's mandate for ${above} does not verify as an AP2 v0.2 SD-JWT: ${checked.wrong}`)
      const m = checked.claims as { vct?: string; transaction_id?: string; payment_amount?: { currency?: string; amount?: number }; payment_instrument?: { id?: string }; trusted_surface?: unknown }
      if (m.vct !== 'mandate.payment.1' || m.transaction_id !== above || m.payment_amount?.amount !== ABOVE_ULXC || m.payment_instrument?.id !== payer.id || m.trusted_surface == null) {
        return fail(`the owner's mandate must be mandate.payment.1 for ${above}, ${ABOVE_ULXC} µLXC from ${payer.id}, with the passkey's signature; it discloses ${JSON.stringify(m).slice(0, 400)}`)
      }

      return {
        pass: true,
        detail: 'a request signed by the outside agent landed in the owner\'s approvals and on the approval card as "Signed by … (business not checked)", ' +
          `unpaid; a forged signature 401, unsigned "Unverified agent"; the approver approved ${within} within its ${APPROVER_LIMIT_ULXC} µLXC, paid once, ` +
          `and was refused 409 on ${above}, nothing moved; the owner's approval of it verifies as an AP2 v0.2 mandate.payment.1 under the published key`,
      }
    },
  }
}
