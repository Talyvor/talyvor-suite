// B48.38 — an agent's crypto payment under the owner's on-chain spend permission (talyvor-lens B48.3, B48.9 and B48.37), on
// Lens's API, once a run, on a workspace of its own.
//
// The owner registers a passkey, makes a crypto agent and its smart account with that passkey as the account's owner, and signs a
// spend permission for it: 25 USDC a day in Base Sepolia's USDC, at most 20 USDC a payment, one address blocked, for an hour. The
// agent, on its own key, pays a shop 10 USDC: a new address, so it waits for the owner, whose signed yes sends it, and it lands —
// once, however often the agent asks again under its Idempotency-Key, and the same key for another amount is 409. Then, each on
// the agent's key and each refused 403 with Lens's reason: 20.000001 USDC (over the cap on one payment), 20 USDC (over the day's
// allowance, with 10 already paid), 1 USDC to the blocked address even with the owner's yes, 1 USDC under a later permission
// that allows only another token, and 1 USDC under one that has ended. The agent's history is the ledger: exactly one send out
// landed, the 10 USDC to the shop with its transaction, and every other one refused, so nothing else moved.
//
// While Lens has agents' smart accounts or their crypto sends switched off (503), it is a SKIP, never a pass.

import { randomBytes } from 'node:crypto'
import { fail } from './bank.ts'
import type { Answered } from './lens.ts'
import { RUN_SALT } from './oracles.ts'
import { softPasskey } from './payees.ts'
import { said } from './routes.ts'
import { CannotTest, type Scenario } from './scenarios.ts'

/** The network agents send on in the Sandbox, and its USDC (Base Sepolia's, as Lens's crypto-send networks name it). */
export const NETWORK = 'base-sepolia'
export const BASE_SEPOLIA_USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e'
/** Another ERC-20 on the same network, which the second permission allows instead of USDC. */
const OTHER_TOKEN = '0x808456652fdb597867f38412077a9182bf77359f'
const SHOP = '0x000000000000000000000000000000000000b4b0'
const BLOCKED = '0x000000000000000000000000000000000000b4bb'
/** USDC has 6 decimals: 1 USDC is 1,000,000 base units. */
const USDC = 1_000_000
const ALLOWANCE = 25 * USDC
const CAP = 20 * USDC
const PAID = 10 * USDC

interface Send { id: string; status: string; reason?: string; direction: string; to: string; amount_minor: number; tx_hash?: string; user_op_hash?: string }
interface Limit { token: string; allowance: number; period: string; per_payment: number }

export function agentCryptoSpendPermission(): Scenario {
  return {
    id: 'agent-crypto-spend-permission',
    owner: 'talyvor-lens',
    own: true,
    agents: 1,
    feature: 'Agent Wallets',
    items: ['B48.37', 'B48.38'],
    title: "an agent's USDC payment inside the owner's signed spend permission lands once on its history; over the cap, over the " +
      "allowance, to a blocked address, in a token it does not allow and after it ended, each is refused 403 and nothing else moves",
    run: async (ctx) => {
      const { lens } = ctx.env
      const user = ctx.app.user
      const call = async <T>(method: string, path: string, body: object | undefined, note: string): Promise<Answered<T>> => {
        const got = await lens.act<T>(user, method, path, body)
        ctx.evidence.push({ note, answer: said(got) })
        return got
      }
      const off = (a: { status: number }, what: string) => {
        if (a.status === 503) throw new CannotTest(`Lens has ${what} switched off (503): agents' smart accounts are not on in this Lens`)
      }

      // The owner's passkey, a crypto agent, and its smart account owned by that passkey.
      const reg = await call<{ challenge: string; rp_id: string }>('POST', '/v1/workspaces/{ws}/agents/passkeys/challenge', {}, 'the owner asks to register a passkey')
      if (!reg.ok) return fail(`the passkey registration challenge was refused: ${said(reg)}`)
      const passkey = softPasskey(reg.value.rp_id)
      const registered = await call('POST', '/v1/workspaces/{ws}/agents/passkeys', passkey.register(reg.value.challenge, 'Nightly software passkey'), 'the owner registers a passkey')
      if (registered.status !== 201) return fail(`registering a passkey must answer 201; Lens answered ${said(registered)}`)
      const made = await call<{ id: string; name: string }>('POST', '/v1/workspaces/{ws}/agents', { name: `Crypto buyer ${RUN_SALT}`, wallet_kind: 'crypto' }, 'the owner makes a crypto agent')
      if (made.status !== 201 || !made.ok) return fail(`making a crypto agent must answer 201; Lens answered ${said(made)}`)
      const base = `/v1/workspaces/{ws}/agents/${made.value.id}`
      const owners = { credential_id: passkey.credentialID }
      const ach = await call<{ challenge: string }>('POST', `${base}/smart-account/challenge`, owners, "the smart account's challenge")
      off(ach, "agents' smart accounts")
      if (!ach.ok) return fail(`the smart account's challenge must answer 200; Lens answered ${said(ach)}`)
      const account = await call<{ address: string }>('POST', `${base}/smart-account`, { ...owners, assertion: passkey.assert(ach.value.challenge) },
        "the owner makes the agent's smart account with the passkey")
      off(account, "agents' smart accounts")
      if (!account.ok || !/^0x[0-9a-fA-F]{40}$/.test(account.value.address)) return fail(`the agent's smart account must answer 200 with its address; Lens answered ${said(account)}`)
      const k = await lens.act<{ key: string }>(user, 'POST', `${base}/keys`, { name: 'spend-permission' })
      if (!k.ok) return fail(`issuing the agent a key was refused: ${said(k)}`)

      // The owner's spend permission, prepared, signed with the passkey and kept.
      const grant = async (tokens: Limit[], expires: Date, note: string): Promise<string | undefined> => {
        const prep = await call<{ canonical: string; challenge: string }>('POST', `${base}/spend-permission/prepare`, { tokens, allowed: [], blocked: [BLOCKED], expires: expires.toISOString() },
          `the owner prepares ${note}`)
        if (!prep.ok) return `preparing ${note} must answer 200; Lens answered ${said(prep)}`
        const kept = await call<{ canonical: string; grant_call?: string }>('PUT', `${base}/spend-permission`, { canonical: prep.value.canonical, assertion: passkey.assert(prep.value.challenge) },
          `the owner signs ${note} with the passkey`)
        if (!kept.ok || kept.value.canonical !== prep.value.canonical) return `signing ${note} must answer 200 with what was prepared; Lens answered ${said(kept)}`
        return undefined
      }
      const usdc = (perPayment: number): Limit => ({ token: BASE_SEPOLIA_USDC, allowance: ALLOWANCE, period: 'day', per_payment: perPayment })
      const first = await grant([usdc(CAP)], new Date(Date.now() + 3600_000), 'a permission of 25 USDC a day, 20 a payment, one address blocked, for an hour')
      if (first !== undefined) return fail(first)

      // The agent pays, on its own key; the owner answers a send to a new address with a signed yes.
      const send = async (to: string, amount: number, key: string, note: string): Promise<{ status: number; send?: Send; text: string }> => {
        const r = await lens.as(k.value.key, 'POST', `${base.replace('{ws}', user.workspaceID)}/crypto-sends`, { to, network: NETWORK, token: 'USDC', amount_minor: amount },
          { 'Idempotency-Key': key })
        ctx.evidence.push({ note, answer: `${r.status} ${r.text.slice(0, 400)}` })
        if (r.status === 503) off(r, "agents' crypto sends")
        let s: Send | undefined
        try { s = JSON.parse(r.text) as Send } catch { /* not a send */ }
        return { status: r.status, send: s?.id === undefined ? undefined : s, text: r.text }
      }
      const approve = async (s: Send, note: string): Promise<{ status: number; send?: Send; text: string }> => {
        const ch = await call<{ challenge: string }>('POST', `${base}/crypto-sends/${s.id}/approve/challenge`, {}, `the challenge for ${note}`)
        if (!ch.ok) return { status: ch.status, text: ch.error }
        const r = await lens.as(user.token, 'POST', `${base.replace('{ws}', user.workspaceID)}/crypto-sends/${s.id}/approve`, { assertion: passkey.assert(ch.value.challenge) })
        ctx.evidence.push({ note: `the owner approves ${note} with the passkey`, answer: `${r.status} ${r.text.slice(0, 400)}` })
        let out: Send | undefined
        try { out = JSON.parse(r.text) as Send } catch { /* not a send */ }
        return { status: r.status, send: out, text: r.text }
      }
      const key = () => `e2e-sp-${randomBytes(6).toString('hex')}`

      // Inside it: 10 USDC to the shop, a new address, waits for the owner; their yes sends it and it lands.
      const payKey = key()
      const asked = await send(SHOP, PAID, payKey, 'the agent pays the shop 10 USDC')
      if (asked.status !== 202 || asked.send?.status !== 'awaiting_owner') return fail(`the agent's first send to a new address must wait for the owner (202 awaiting_owner); Lens answered ${asked.status} ${asked.text.slice(0, 300)}`)
      const landed = await approve(asked.send, 'the 10 USDC to the shop')
      if (landed.status !== 200 || landed.send?.status !== 'landed' || (landed.send.tx_hash ?? '') === '') {
        return fail(`10 USDC inside the permission, approved, must land with its transaction (200 landed); Lens answered ${landed.status} ${landed.text.slice(0, 300)}`)
      }
      const again = await send(SHOP, PAID, payKey, 'the agent asks again under the same Idempotency-Key')
      if (again.status !== 200 || again.send?.id !== asked.send.id) return fail(`the same send asked again must answer the same landed send ${asked.send.id}; Lens answered ${again.status} ${again.text.slice(0, 300)}`)
      const changed = await send(SHOP, PAID + USDC, payKey, 'the agent uses the same key for 11 USDC')
      if (changed.status !== 409) return fail(`the same Idempotency-Key for another amount must answer 409; Lens answered ${changed.status} ${changed.text.slice(0, 300)}`)

      // Outside it: each refused 403 with Lens's reason.
      const refused = async (to: string, amount: number, reason: RegExp, note: string, ownerSaysYes = false): Promise<string | undefined> => {
        let r = await send(to, amount, key(), note)
        if (ownerSaysYes && r.status === 202 && r.send?.status === 'awaiting_owner') r = await approve(r.send, note)
        if (r.status !== 403 || r.send?.status !== 'refused' || !reason.test(r.send.reason ?? '')) {
          return `${note} must be refused 403 by the permission (${reason.source}); Lens answered ${r.status} ${r.text.slice(0, 300)}`
        }
        return undefined
      }
      const outside = [
        await refused(SHOP, CAP + 1, /over the cap/, 'the agent pays the shop 20.000001 USDC, over the cap on one payment'),
        await refused(SHOP, CAP, /over the allowance/, 'the agent pays the shop 20 USDC, over the day\'s allowance with 10 paid'),
        await refused(BLOCKED, USDC, /is blocked/, 'the agent pays the blocked address 1 USDC', true),
      ].find((x) => x !== undefined)
      if (outside !== undefined) return fail(outside)

      // A later permission that allows only another token: a USDC payment is refused.
      const second = await grant([{ token: OTHER_TOKEN, allowance: ALLOWANCE, period: 'day', per_payment: CAP }], new Date(Date.now() + 3600_000),
        'a later permission that allows only another token')
      if (second !== undefined) return fail(second)
      const token = await refused(SHOP, USDC, /does not allow paying in/, 'the agent pays the shop 1 USDC, a token the permission does not allow')
      if (token !== undefined) return fail(token)

      // And one that ends in a few seconds: once it has ended, a payment inside its limits is refused.
      const ends = new Date(Math.ceil((Date.now() + 4000) / 1000) * 1000)
      const third = await grant([usdc(CAP)], ends, 'a permission that ends in a few seconds')
      if (third !== undefined) return fail(third)
      await new Promise((r) => setTimeout(r, Math.max(0, ends.getTime() - Date.now()) + 1500))
      const ended = await refused(SHOP, USDC, /ended/, 'the agent pays the shop 1 USDC after the permission ended')
      if (ended !== undefined) return fail(ended)

      // The ledger: one send out landed, the 10 USDC to the shop; every other one refused.
      const history = await call<{ sends: Send[] | null }>('GET', `${base}/crypto-sends`, undefined, "the agent's crypto history")
      if (!history.ok) return fail(`the agent's crypto history must answer 200; Lens answered ${said(history)}`)
      const out = (history.value.sends ?? []).filter((s) => s.direction === 'out')
      const moved = out.filter((s) => s.status !== 'refused')
      if (moved.length !== 1 || moved[0].id !== asked.send.id || moved[0].status !== 'landed' || moved[0].amount_minor !== PAID || moved[0].to.toLowerCase() !== SHOP) {
        return fail(`the agent's history must hold exactly one send out that moved money, ${PAID} to ${SHOP} landed; it holds ${JSON.stringify(moved).slice(0, 400)}`)
      }
      if (out.length !== 6) return fail(`the agent's history must hold six sends out, one landed and five refused; it holds ${out.length}: ${out.map((s) => s.status).join(', ')}`)
      return { pass: true, detail: `10 USDC landed once (${moved[0].tx_hash}); over the cap, over the allowance, to a blocked address, in another token and after the permission ended, each refused 403` }
    },
  }
}
