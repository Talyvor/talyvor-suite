// B17.544 — passkey management and recovery (Lens B28.340, the Lens side of B28.68), on Lens's API, once a run, on a workspace
// of its own, through the routes Approvals and devices calls. The owner's phone holds the workspace's first passkey, whose answer
// carries the recovery code, and their old laptop a second one, let in by the phone's signature. An agent pays above its approval
// amount and the payment waits. The owner removes the laptop's passkey: its signature on the waiting approval is refused and the
// approval stays pending. They lose the phone and lock the workspace down, which revokes its passkey too: refused, still pending,
// and nothing has moved. After a new identity check they lift the lockdown and add a new passkey with the recovery code; it
// resumes the agents Lens paused and approves the payment, which the agent then pays: one posting on each agent's account.

import { fail } from './bank.ts'
import { PERSON } from './confirmIdentity.ts'
import type { Answered } from './lens.ts'
import { RUN_SALT } from './oracles.ts'
import { softPasskey } from './payees.ts'
import { books, movedBy, said, type Side } from './routes.ts'
import { CannotTest, type Scenario } from './scenarios.ts'

const FUND_ULXC = 5_000_000
const APPROVAL_ABOVE_ULXC = 1_000_000
const PAY_ULXC = 2_000_000

type Passkey = ReturnType<typeof softPasskey>

export function passkeyRecovery(): Scenario {
  return {
    id: 'passkey-recovery',
    owner: 'talyvor-lens',
    own: true,
    agents: 2,
    feature: 'Agent Wallets',
    items: ['B28.340', 'B28.68'],
    title: 'a removed passkey and a locked-out phone\'s can no longer approve, and the payment waits with no posting; ' +
      'a passkey added with the recovery code approves it, and the agent\'s payment then posts once on each account',
    run: async (ctx) => {
      const { lens } = ctx.env
      const user = ctx.app.user
      const call = async <T>(method: string, path: string, body: object | undefined, note: string, headers?: Record<string, string>): Promise<Answered<T>> => {
        const got = await lens.act<T>(user, method, path, body, headers)
        ctx.evidence.push({ note, answer: said(got) })
        return got
      }
      // A passkey registered over its own challenge, signed in by `by` once the workspace has a key.
      const register = async (name: string, by?: Passkey) => {
        const ch = await call<{ challenge: string; rp_id: string }>('POST', '/v1/workspaces/{ws}/agents/passkeys/challenge', {}, `the owner asks to register ${name}`)
        if (!ch.ok) throw new Error(`the passkey registration challenge was refused: ${said(ch)}`)
        const key = softPasskey(ch.value.rp_id)
        const body = { ...key.register(ch.value.challenge, name), ...(by === undefined ? {} : { assertion: by.assert(ch.value.challenge) }) }
        return { key, challenge: ch.value.challenge, body }
      }

      // The phone's passkey first: its answer carries the recovery code. The laptop's, signed in by the phone's.
      const phone = await register('Nightly phone')
      const first = await call<{ recovery_code?: string }>('POST', '/v1/workspaces/{ws}/agents/passkeys', phone.body, 'the owner registers the phone\'s passkey, the first key')
      if (first.status !== 201 || !first.ok) return fail(`registering the workspace's first passkey must answer 201; Lens answered ${said(first)}`)
      const recoveryCode = first.value.recovery_code ?? ''
      if (recoveryCode === '') return fail(`the workspace's first passkey must answer its recovery code; Lens answered ${said(first)}`)
      const laptop = await register('Nightly old laptop', phone.key)
      const second = await call('POST', '/v1/workspaces/{ws}/agents/passkeys', laptop.body, 'the owner registers the laptop\'s passkey, signed by the phone\'s')
      if (second.status !== 201) return fail(`a second passkey signed by the first must answer 201; Lens answered ${said(second)}`)

      // An agent's payment above its approval amount waits.
      const payer = await lens.createAgent(user, `Recovery payer ${RUN_SALT}`)
      const payee = await lens.createAgent(user, `Recovery payee ${RUN_SALT}`)
      const book = await lens.agentBook(user)
      if (book.unallocated_ulxc < FUND_ULXC) throw new CannotTest(`the workspace has ${book.unallocated_ulxc} µLXC free, under the ${FUND_ULXC} µLXC its agent is funded`)
      await lens.fundAgent(user, payer.id, FUND_ULXC)
      const k = await lens.act<{ key: string }>(user, 'POST', `/v1/workspaces/{ws}/agents/${payer.id}/keys`, { name: 'passkey-recovery' })
      if (!k.ok) return fail(`issuing ${payer.name} a key was refused: ${said(k)}`)
      const rules = await lens.act(user, 'PUT', `/v1/workspaces/{ws}/agents/${payer.id}/rules`, { ...await lens.agentRules(user, payer.id), approval_above_ulxc: APPROVAL_ABOVE_ULXC })
      if (!rules.ok) return fail(`saving ${payer.name}'s approval amount was refused: ${said(rules)}`)
      const sides: Side[] = [{ user, agent: payer.id, who: payer.name }, { user, agent: payee.id, who: payee.name }]
      const memo = `recovery ${RUN_SALT}`
      const pay = async (note: string) => {
        const r = await lens.payAsAgent(k.value.key, user.workspaceID, payer.id, payee.id, PAY_ULXC, memo)
        ctx.evidence.push({ note, answer: r.ok ? `paid ${JSON.stringify(r.value)}` : `${r.status} ${r.error}` })
        return r
      }
      const before = await books(ctx, sides)
      const held = await pay(`${payer.name} pays ${PAY_ULXC} µLXC, above its ${APPROVAL_ABOVE_ULXC} µLXC approval amount`)
      const approvalID = (await lens.agentApprovals(user)).find((a) => a.agent_id === payer.id && a.amount_ulxc === PAY_ULXC && a.status === 'pending')?.id
      if (held.ok || held.held === undefined || approvalID === undefined) {
        return fail(`a payment above the approval amount must be held and file a pending approval; Lens answered ${held.ok ? 'paid' : `${held.status} ${held.error}`}`)
      }
      const status = async () => (await lens.agentApprovals(user)).find((a) => a.id === approvalID)?.status ?? 'missing'
      const approve = async (by: Passkey, note: string) => {
        const c = await call<{ challenge: string }>('POST', `/v1/workspaces/{ws}/agents/approvals/${approvalID}/challenge`, {}, `the owner asks for ${approvalID}'s challenge`)
        if (!c.ok) throw new Error(`approval ${approvalID}'s challenge was refused: ${said(c)}`)
        return call('POST', `/v1/workspaces/{ws}/agents/approvals/${approvalID}/approve`, { assertion: by.assert(c.value.challenge) }, note)
      }

      const wrong: string[] = []
      try {
        // The laptop's passkey removed: it signs nothing.
        const removed = await call('DELETE', `/v1/workspaces/{ws}/agents/passkeys/${encodeURIComponent(laptop.key.credentialID)}`, undefined, 'the owner removes the laptop\'s passkey')
        if (!removed.ok) return fail(`removing the laptop's passkey, not the last key, must answer 200; Lens answered ${said(removed)}`)
        const byRemoved = await approve(laptop.key, 'the removed laptop passkey signs the waiting approval')
        const afterRemoved = await status()
        if (byRemoved.ok || afterRemoved !== 'pending') wrong.push(`the removed passkey's signature on approval ${approvalID} must be refused and leave it pending; Lens answered ${said(byRemoved)} and it is ${afterRemoved}`)

        // The phone lost: the lockdown names no key, so it revokes the last one too.
        const locked = await call('POST', '/v1/money/lockdown', { reason: 'lost my phone' }, 'the owner locks the workspace down')
        if (!locked.ok) return fail(`the lockdown was refused: ${said(locked)}`)
        const byPhone = await approve(phone.key, 'the lost phone\'s passkey signs the waiting approval')
        const afterPhone = await status()
        if (byPhone.ok || afterPhone !== 'pending') wrong.push(`the locked-out phone's signature on approval ${approvalID} must be refused and leave it pending; Lens answered ${said(byPhone)} and it is ${afterPhone}`)
        const still = await movedBy(ctx, sides, before, [0, 0], 'before the recovery')
        if (still !== undefined) wrong.push(still)
        if (wrong.length > 0) return fail(wrong.join('; '))

        // A new identity check lifts the lockdown, and the recovery code adds a new passkey at once.
        const checked = await call('POST', '/v1/workspaces/{ws}/verification/identity', PERSON, 'the owner passes an identity check again')
        if (!checked.ok) return fail(`the identity check after the lockdown was refused: ${said(checked)}`)
        const lifted = await call('POST', '/v1/money/lockdown/lift', {}, 'the owner lifts the lockdown')
        if (!lifted.ok) return fail(`lifting the lockdown after a new identity check was refused: ${said(lifted)}`)
        const fresh = await register('Nightly new phone')
        // The app's server sends the session's sign-in time with a recovery; this session signed in moments ago.
        const recovered = await call<{ recovery_code?: string }>('POST', '/v1/workspaces/{ws}/keys/recover', { code: recoveryCode, passkey: fresh.body },
          'the owner adds a new passkey with the recovery code', { 'X-Talyvor-Signed-In-At': new Date().toISOString() })
        if (!recovered.ok) return fail(`adding a passkey with the recovery code, no key live and the lockdown lifted, was refused: ${said(recovered)}`)
        if ((recovered.value.recovery_code ?? '') === '' || recovered.value.recovery_code === recoveryCode) {
          return fail(`a recovery must answer a new recovery code in place of the one used; Lens answered ${said(recovered)}`)
        }

        // The recovery passkey resumes the agents the lockdown paused and approves the payment; the agent then pays it.
        const rc = await call<{ challenge: string }>('POST', '/v1/workspaces/{ws}/agents/resume-all/challenge', {}, 'the owner asks to resume every agent')
        if (!rc.ok) return fail(`the resume challenge was refused: ${said(rc)}`)
        const resumed = await call('POST', '/v1/workspaces/{ws}/agents/resume-all', { assertion: fresh.key.assert(rc.value.challenge) }, 'the recovery passkey resumes every agent')
        if (!resumed.ok) return fail(`resuming the agents signed by the recovery passkey was refused: ${said(resumed)}`)
        const byRecovered = await approve(fresh.key, 'the recovery passkey signs the waiting approval')
        const afterRecovered = await status()
        if (!byRecovered.ok || afterRecovered !== 'approved') {
          return fail(`the recovery passkey's signature on approval ${approvalID} must approve it; Lens answered ${said(byRecovered)} and it is ${afterRecovered}`)
        }
      } catch (e) {
        return fail((e as Error).message)
      }
      const paid = await pay(`${payer.name} pays the approved ${PAY_ULXC} µLXC`)
      if (!paid.ok) return fail(`the payment the recovery passkey approved must be paid; Lens answered ${paid.status} ${paid.error}`)
      const moved = await movedBy(ctx, sides, before, [-PAY_ULXC, PAY_ULXC], 'after the recovery passkey approved')
      if (moved !== undefined) return fail(moved)

      return {
        pass: true,
        detail: `approval ${approvalID} refused by the removed passkey and by the locked-out phone's, still pending with no posting; ` +
          `after the lift a passkey added with the recovery code approved it, and the payment posted ${-PAY_ULXC} µLXC on ${payer.name} and ${PAY_ULXC} µLXC on ${payee.name}`,
      }
    },
  }
}
