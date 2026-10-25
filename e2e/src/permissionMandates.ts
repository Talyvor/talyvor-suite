// B40.26 — a person signs a permission mandate (Lens B40.2), on Lens's API, once a run, on a workspace of its own.
//
// The owner registers a software passkey (P-256, "none" attestation) and prepares a mandate letting Chat and voice pay two
// payees up to £100 a payment and £250 a day. A canonical altered after its challenge was issued is refused; the one
// prepared, signed over its challenge, is kept with exactly that JSON and this passkey. The evaluator then judges: £90 to a
// mandated payee is allow, £120 needs approval on the per-payment limit, a third payee is blocked on the scope, and the same
// £90 asked for by voice needs approval. Once revoked, all three are blocked on revoked_at.

import { createHash } from 'node:crypto'
import { fail } from './bank.ts'
import type { Answered } from './lens.ts'
import { softPasskey } from './payees.ts'
import { said } from './routes.ts'
import type { Scenario } from './scenarios.ts'

interface Decision { decision: string; reason: string; rule: string }
interface Mandate { id: string; status: string; canonical: string; credential_id: string }

const PLUMBER = 'payee-nightly-plumber'
const GROCER = 'payee-nightly-grocer'
const STRANGER = 'payee-nightly-stranger'
const pay = (client: string, payee: string, minor: number) => ({ client, payee_id: payee, currency: 'GBP', amount_minor: minor })

export function permissionMandate(): Scenario {
  return {
    id: 'permission-mandate',
    owner: 'talyvor-lens',
    own: true,
    feature: 'Agent Wallets',
    items: ['B40.26'],
    title: 'a person signs a permission mandate with a passkey — two payees, £100 a payment, £250 a day — kept with the signed JSON; ' +
      '£90 allowed, £120 needs approval, a third payee blocked, £90 by voice needs approval; an altered mandate refused; revoked, all three blocked',
    run: async (ctx) => {
      const { lens } = ctx.env
      const [owner] = await lens.createUsers(1)
      const call = async <T>(method: string, path: string, body: object | undefined, note: string): Promise<Answered<T>> => {
        const got = await lens.act<T>(owner, method, path, body)
        ctx.evidence.push({ note, answer: said(got) })
        return got
      }

      // The person's passkey.
      const reg = await call<{ challenge: string; rp_id: string }>('POST', '/v1/workspaces/{ws}/agents/passkeys/challenge', {}, 'the owner asks to register a passkey')
      if (!reg.ok) return fail(`the passkey registration challenge was refused: ${said(reg)}`)
      const key = softPasskey(reg.value.rp_id)
      const registered = await call('POST', '/v1/workspaces/{ws}/agents/passkeys', key.register(reg.value.challenge, 'Nightly mandate passkey'), 'the owner registers a P-256 passkey')
      if (registered.status !== 201) return fail(`registering a passkey must answer 201; Lens answered ${said(registered)}`)

      // The terms, and the canonical JSON Lens asks the person to sign.
      const expires = new Date(Date.now() + 30 * 24 * 3600_000).toISOString()
      const prep = await call<{ canonical: string; challenge: string; allow_credentials: string[] }>('POST', '/v1/money/permission-mandates/prepare', {
        principal: { type: 'person', name: 'Nightly Person' }, clients: ['chat', 'voice'], scope: { payees: [PLUMBER, GROCER], currencies: ['GBP'] },
        limits: { per_payment: { GBP: 10_000 }, per_day: { GBP: 25_000 } }, new_payee: { policy: 'always_ask' }, expires_at: expires,
      }, 'the owner prepares a mandate: two payees, £100 a payment, £250 a day')
      if (!prep.ok) return fail(`preparing the mandate must answer 200; Lens answered ${said(prep)}`)
      const { canonical, challenge } = prep.value
      if (challenge !== createHash('sha256').update(canonical).digest('base64url')) return fail(`the mandate's challenge ${challenge} is not the SHA-256 of its canonical JSON`)
      if (!(prep.value.allow_credentials ?? []).includes(key.credentialID)) return fail(`the mandate's challenge does not allow the passkey just registered: ${said(prep)}`)

      // Altered after the challenge was issued: refused.
      const altered = canonical.replace('"per_payment":{"GBP":10000}', '"per_payment":{"GBP":99900}')
      if (altered === canonical) return fail(`the canonical mandate does not read "per_payment":{"GBP":10000}: ${canonical}`)
      const forged = await call('POST', '/v1/money/permission-mandates', { canonical: altered, assertion: key.assert(challenge) }, 'the owner signs a mandate altered to £999 a payment')
      if (forged.status !== 400) return fail(`a mandate altered after its challenge was signed must be refused 400; Lens answered ${said(forged)}`)

      // Signed as prepared: kept, with exactly the JSON the person signed.
      const signed = await call<Mandate>('POST', '/v1/money/permission-mandates', { canonical, assertion: key.assert(challenge) }, 'the owner signs the mandate with the passkey')
      if (signed.status !== 201 || !signed.ok || signed.value.status !== 'active') return fail(`the signed mandate must answer 201 active; Lens answered ${said(signed)}`)
      const id = signed.value.id
      const list = await call<{ mandates: Mandate[] | null }>('GET', '/v1/money/permission-mandates', undefined, 'the owner lists the mandates')
      if (!list.ok) return fail(`the list of mandates was refused: ${said(list)}`)
      const kept = (list.value.mandates ?? []).find((m) => m.id === id)
      if (kept === undefined) return fail(`the signed mandate ${id} is not on the list`)
      if (kept.canonical !== canonical || kept.credential_id !== key.credentialID) {
        return fail(`the kept mandate is not the signed one: canonical ${kept.canonical === canonical ? 'the same' : `"${kept.canonical}"`}, credential ${kept.credential_id}`)
      }

      // The evaluator.
      const judge = async (p: object, decision: string, rule: string, note: string): Promise<string | undefined> => {
        const d = await call<Decision>('POST', `/v1/money/permission-mandates/${id}/evaluate`, p, note)
        if (!d.ok || d.value.decision !== decision || d.value.rule !== rule) return `${note}: want ${decision}${rule === '' ? '' : ` by ${rule}`}, Lens answered ${said(d)}`
        return undefined
      }
      const three = [
        [pay('chat', PLUMBER, 9_000), 'allow', '', '£90 to a mandated payee'],
        [pay('chat', PLUMBER, 12_000), 'needs_approval', 'limits.per_payment', '£120 to a mandated payee'],
        [pay('chat', STRANGER, 9_000), 'block', 'scope', '£90 to a payee the mandate does not name'],
      ] as const
      const wrong: string[] = []
      for (const [p, decision, rule, note] of three) wrong.push(await judge(p, decision, rule, note) ?? '')
      wrong.push(await judge(pay('voice', PLUMBER, 9_000), 'needs_approval', 'clients.voice', 'the same £90 asked for by voice') ?? '')
      if (wrong.some(Boolean)) return fail(wrong.filter(Boolean).join('; '))

      // Revoked: every one blocked.
      const revoked = await call<Mandate>('POST', `/v1/money/permission-mandates/${id}/revoke`, {}, 'the owner revokes the mandate')
      if (!revoked.ok || revoked.value.status !== 'revoked') return fail(`revoking the mandate must answer 200 revoked; Lens answered ${said(revoked)}`)
      for (const [p, , , note] of three) wrong.push(await judge(p, 'block', 'revoked_at', `${note}, after revoke`) ?? '')
      if (wrong.some(Boolean)) return fail(wrong.filter(Boolean).join('; '))

      return {
        pass: true,
        detail: `mandate ${id} signed with the passkey and kept with the signed JSON; an altered one refused 400; £90 allow, £120 needs_approval ` +
          '(limits.per_payment), a third payee block (scope), £90 by voice needs_approval (clients.voice); revoked, all three block (revoked_at)',
      }
    },
  }
}
