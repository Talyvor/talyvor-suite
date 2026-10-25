// B40.28 — a phone's device key signs an agent's approval (Lens B40.4), on Lens's API, once a run, on a workspace of its own.
//
// The owner registers a software P-256 key as platform "test", the key signing "talyvor-device-v1:<challenge>" as the phone's
// Secure Enclave does, and finds it on the workspace's device list. An agent pays above its approval amount and files an
// approval; the device's signature over that approval's challenge approves it. Once the device is revoked, a second approval
// signed the same way is refused 403, an unsigned decision is refused too, and that approval stays pending.
// A Lens without LENS_DEVICE_TEST_ATTESTATION=true (production) refuses the "test" platform: a SKIP, never a pass.

import { generateKeyPairSync, sign } from 'node:crypto'
import { fail } from './bank.ts'
import type { Answered } from './lens.ts'
import { RUN_SALT } from './oracles.ts'
import { said } from './routes.ts'
import { CannotTest, type Scenario } from './scenarios.ts'

interface Device { id: string; platform: string; person: string; revoked_at?: string }

const FUND_ULXC = 300_000
const APPROVAL_ABOVE_ULXC = 100_000

/** A phone's hardware key, in software: it signs devicekey.Message(challenge) as Lens verifies it. */
export function softDevice() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const signed = (challenge: string) => sign('sha256', Buffer.from(`talyvor-device-v1:${challenge}`), privateKey).toString('base64url')
  return {
    register: (challenge: string, name: string) => ({ platform: 'test', name, public_key: publicKey.export({ type: 'spki', format: 'der' }).toString('base64url'),
      challenge, signature: signed(challenge), attestation: '' }),
    assert: (id: string, challenge: string) => ({ device_id: id, challenge, signature: signed(challenge) }),
  }
}

export function deviceKeyApproval(): Scenario {
  return {
    id: 'device-key-approval',
    owner: 'talyvor-lens',
    own: true,
    agents: 2,
    feature: 'Agent Wallets',
    items: ['B40.28'],
    title: "a phone's device key registered as platform \"test\" is on the device list and signs an agent's approval, which is approved; " +
      'revoked, its signature on a new approval is refused 403, an unsigned decision is refused, and that approval stays pending',
    run: async (ctx) => {
      const { lens } = ctx.env
      const user = ctx.app.user
      const call = async <T>(method: string, path: string, body: object | undefined, note: string): Promise<Answered<T>> => {
        const got = await lens.act<T>(user, method, path, body)
        ctx.evidence.push({ note, answer: said(got) })
        return got
      }

      // The phone's key.
      const ch = await call<{ challenge: string }>('POST', '/v1/money/devices/challenge', {}, 'the owner asks to register a device key')
      if (!ch.ok) return fail(`the device registration challenge was refused: ${said(ch)}`)
      const phone = softDevice()
      const reg = await call<Device>('POST', '/v1/money/devices', phone.register(ch.value.challenge, 'Nightly phone'), 'the owner registers a P-256 device key as platform "test"')
      if (reg.status === 400 && !reg.ok && reg.error.includes('test device keys are not accepted')) {
        throw new CannotTest(`Lens refuses the "test" device platform: ${reg.error} — it needs LENS_DEVICE_TEST_ATTESTATION=true in lens.env`)
      }
      if (reg.status !== 201 || !reg.ok || reg.value.platform !== 'test') return fail(`registering a test device key must answer 201; Lens answered ${said(reg)}`)
      const device = reg.value.id
      const listed = await call<{ devices: Device[] | null }>('GET', '/v1/money/devices', undefined, 'the owner lists the device keys')
      if (!listed.ok || !(listed.value.devices ?? []).some((d) => d.id === device && d.revoked_at === undefined)) {
        return fail(`the device key ${device} is not on the workspace's device list, unrevoked: ${said(listed)}`)
      }

      // An agent paying above its approval amount files an approval.
      const payer = await lens.createAgent(user, `Device payer ${RUN_SALT}`)
      const payee = await lens.createAgent(user, `Device payee ${RUN_SALT}`)
      const book = await lens.agentBook(user)
      if (book.unallocated_ulxc < FUND_ULXC) throw new CannotTest(`the workspace has ${book.unallocated_ulxc} µLXC free, under the ${FUND_ULXC} µLXC its agent is funded`)
      await lens.fundAgent(user, payer.id, FUND_ULXC)
      const k = await lens.act<{ key: string }>(user, 'POST', `/v1/workspaces/{ws}/agents/${payer.id}/keys`, { name: 'device-key-approval' })
      if (!k.ok) return fail(`issuing ${payer.name} a key was refused: ${k.status} ${k.error}`)
      const rules = await lens.act(user, 'PUT', `/v1/workspaces/{ws}/agents/${payer.id}/rules`, { ...await lens.agentRules(user, payer.id), approval_above_ulxc: APPROVAL_ABOVE_ULXC })
      if (!rules.ok) return fail(`saving ${payer.name}'s approval amount was refused: ${rules.status} ${rules.error}`)
      const file = async (amount: number): Promise<string> => {
        const r = await lens.payAsAgent(k.value.key, user.workspaceID, payer.id, payee.id, amount, `device ${RUN_SALT} ${amount}`)
        ctx.evidence.push({ note: `${payer.name} pays ${amount} µLXC, above its ${APPROVAL_ABOVE_ULXC} µLXC approval amount`, answer: r.ok ? `paid ${JSON.stringify(r.value)}` : `${r.status} ${r.error}` })
        const id = (await lens.agentApprovals(user)).find((a) => a.agent_id === payer.id && a.amount_ulxc === amount && a.status === 'pending')?.id
        if (r.ok || r.status !== 403 || id === undefined) throw new Error(`a ${amount} µLXC payment above the approval amount must be refused 403 and file a pending approval; Lens answered ${r.ok ? 'paid' : `${r.status} ${r.error}`}`)
        return id
      }
      const status = async (id: string) => (await lens.agentApprovals(user)).find((a) => a.id === id)?.status
      const decide = async (id: string, signed: boolean, note: string) => {
        const c = await call<{ challenge: string }>('POST', `/v1/workspaces/{ws}/agents/approvals/${id}/challenge`, {}, `the owner asks for ${id}'s challenge`)
        if (!c.ok) throw new Error(`approval ${id}'s challenge was refused: ${said(c)}`)
        return call('POST', `/v1/workspaces/{ws}/agents/approvals/${id}/approve`, signed ? { assertion: phone.assert(device, c.value.challenge) } : {}, note)
      }

      // Signed by the device: approved.
      let first: string
      let second: string
      try {
        first = await file(200_000)
        const ok = await decide(first, true, 'the owner approves with the device key')
        if (ok.status !== 200) return fail(`approving with the device's signature over the approval's challenge must answer 200; Lens answered ${said(ok)}`)
        const s = await status(first)
        if (s !== 'approved') return fail(`approved with the device key, approval ${first} is ${s}, not approved`)

        // Revoked: its signature, and no signature, are refused; the approval stays pending.
        const rev = await call<Device>('POST', `/v1/money/devices/${device}/revoke`, {}, 'the owner revokes the device key')
        if (!rev.ok || rev.value.revoked_at === undefined) return fail(`revoking the device key must answer 200 with revoked_at; Lens answered ${said(rev)}`)
        second = await file(250_000)
      } catch (e) {
        return fail((e as Error).message)
      }
      const wrong: string[] = []
      const revoked = await decide(second, true, 'the owner approves with the revoked device key')
      if (revoked.status !== 403) wrong.push(`the revoked device's signature on approval ${second} must be refused 403; Lens answered ${said(revoked)}`)
      const unsigned = await decide(second, false, 'the owner approves with no signature, the only device revoked')
      if (unsigned.status !== 403) wrong.push(`an unsigned decision on approval ${second} must be refused 403; Lens answered ${said(unsigned)}`)
      const left = await status(second)
      if (left !== 'pending') wrong.push(`after the refused decisions approval ${second} is ${left}, not pending`)
      if (wrong.length > 0) return fail(wrong.join('; '))

      return {
        pass: true,
        detail: `device ${device} registered as "test" and listed; approval ${first} approved with its signature; revoked, approval ${second} ` +
          'refused 403 signed by it and 403 unsigned, still pending',
      }
    },
  }
}
