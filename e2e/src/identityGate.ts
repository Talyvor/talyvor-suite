// B17.554 — identity-gate (Lens B61.52: an account that has not confirmed who it is moves no money, Sandbox money included),
// once a run, on a workspace of its own that starts unconfirmed (UNCONFIRMED_SCENARIOS). The owner of the fresh account puts
// money into its agent: Lens refuses it 403 VERIFICATION_NEEDED with its one sentence, "Confirm who you are to move money.",
// and nothing is on the ledger — no fund line on the agent's statement and nothing allocated from the workspace. A Business
// needs L3, so at L2 (email and phone, then identity) the same move is still refused with nothing posted. After the check its
// account needs passes (confirmIdentity.ts, the calls the app makes), the same move posts exactly once: one fund line of the
// amount on the agent's statement, and the workspace's allocation up by it.

import { fail } from './bank.ts'
import { PERSON, confirmIdentity, neededLevel } from './confirmIdentity.ts'
import type { WorkspaceVerification } from './lens.ts'
import { RUN_SALT } from './oracles.ts'
import { said } from './routes.ts'
import { CannotTest, type Scenario } from './scenarios.ts'

/** Lens economy.ConfirmIdentitySentence, and the code the apps read (cmd/lens/identity_gate.go). */
export const CONFIRM_SENTENCE = 'Confirm who you are to move money.'
export const VERIFICATION_NEEDED = 'VERIFICATION_NEEDED'
/** 1 LXC from the workspace into its agent. */
const FUND_ULXC = 1_000_000

export function identityGate(): Scenario {
  return {
    id: 'identity-gate',
    owner: 'talyvor-lens',
    own: true,
    agents: 1,
    feature: 'Agent Wallets',
    items: ['B61.52'],
    title: 'an account that has not confirmed who it is is refused a money move 403 VERIFICATION_NEEDED, "Confirm who you are to move money.", ' +
      'with nothing on the ledger, a Business at L2 too; after the check its account needs passes, the same move posts exactly once',
    run: async (ctx) => {
      const { lens } = ctx.env
      const user = ctx.app.user
      const ws = `/v1/workspaces/${user.workspaceID}`

      // 1. A fresh account, below the level its type needs.
      const account = await lens.act<{ account_type: string }>(user, 'GET', '/v1/workspaces/{ws}/account')
      if (!account.ok) return fail(`the owner's read of the account was refused: ${said(account)}`)
      const needs = neededLevel(account.value.account_type)
      const level = async (): Promise<string> => {
        const r = await lens.act<WorkspaceVerification>(user, 'GET', '/v1/workspaces/{ws}/verification')
        if (!r.ok) throw new Error(`the owner's read of the verification record was refused: ${said(r)}`)
        return r.value.level
      }
      const start = await level()
      ctx.evidence.push({ note: `a ${account.value.account_type} account, needing ${needs} to move money, starts at ${start}` })
      if (start >= needs) throw new CannotTest(`the workspace of its own starts at ${start}, already the ${needs} it needs: the run confirmed it`)

      // 2. One agent: making it moves no money, so it is open.
      const agent = await lens.createAgent(user, `Identity gate agent ${RUN_SALT}`)
      const book = await lens.agentBook(user)
      if (book.unallocated_ulxc < FUND_ULXC) throw new CannotTest(`the workspace has ${book.unallocated_ulxc} µLXC free, under the ${FUND_ULXC} µLXC it moves`)
      const funds = async () => (await lens.agentLines(user, agent.id)).filter((l) => l.kind === 'fund')
      const allocated = async () => (await lens.agentBook(user)).allocated_ulxc
      const fund = async (what: string) => {
        const r = await lens.as(user.token, 'POST', `${ws}/agents/${agent.id}/fund`, { amount_ulxc: FUND_ULXC })
        ctx.evidence.push({ note: what, answer: `${r.status} ${r.text.slice(0, 300)}` })
        let body: { error?: string; code?: string } = {}
        try {
          body = JSON.parse(r.text) as typeof body
        } catch {
          // Not JSON: judged by its status and text below.
        }
        return { ...r, body }
      }
      /** Refused in Lens's words with nothing on the ledger, or why not. */
      const refused = async (at: string): Promise<string | undefined> => {
        const r = await fund(`the owner puts ${FUND_ULXC} µLXC into the agent at ${at}`)
        const [lines, now] = [await funds(), await allocated()]
        const ledger = `the agent's statement has ${lines.length} fund line(s) ${JSON.stringify(lines.map((l) => l.amount_ulxc))} and the workspace has ${now} µLXC allocated (${book.allocated_ulxc} before)`
        if (r.status !== 403 || r.body.code !== VERIFICATION_NEEDED || r.body.error !== CONFIRM_SENTENCE) {
          return `a ${account.value.account_type} account at ${at}, below the ${needs} it needs, must be refused 403 ${VERIFICATION_NEEDED} "${CONFIRM_SENTENCE}" ` +
            `before any money moves (Lens B61.52); Lens answered ${r.status} ${r.text.slice(0, 200)}; ${ledger}`
        }
        if (lines.length !== 0 || now !== book.allocated_ulxc) return `the refused move at ${at} still left money on the ledger: ${ledger}`
        return undefined
      }

      // 3. Unconfirmed, the move is refused and nothing posts.
      const atStart = await refused(start)
      if (atStart !== undefined) return fail(atStart)

      // 4. A Business needs L3: with email, phone and identity confirmed (L2) it is still refused.
      if (needs === 'L3') {
        if (start < 'L1') {
          const c = await lens.act(user, 'POST', '/v1/workspaces/{ws}/verification/contact', { email: `nightly-${user.workspaceID}@example.com`, phone: '+447700900123' })
          if (!c.ok) return fail(`the email and phone check was refused: ${said(c)}`)
        }
        if (start < 'L2') {
          const c = await lens.act(user, 'POST', '/v1/workspaces/{ws}/verification/identity', PERSON)
          if (!c.ok) return fail(`the identity check was refused: ${said(c)}`)
        }
        const l2 = await level()
        if (l2 !== 'L2') return fail(`after the email, phone and identity checks the Business is at ${l2}, not L2`)
        const atL2 = await refused('L2')
        if (atL2 !== undefined) return fail(atL2)
      }

      // 5. The check its account needs passes, and the same move posts exactly once.
      const confirmed = await confirmIdentity(lens, user)
      ctx.evidence.push({ note: 'the owner passes the Sandbox identity check the account needs', answer: JSON.stringify(confirmed) })
      if (!confirmed.ok) return fail(`the owner could not pass the Sandbox identity check the account needs: ${confirmed.why}`)
      const paid = await fund(`the owner puts ${FUND_ULXC} µLXC into the agent at ${confirmed.level}`)
      const [lines, now] = [await funds(), await allocated()]
      if (paid.status !== 200 || lines.length !== 1 || lines[0].amount_ulxc !== FUND_ULXC || now !== book.allocated_ulxc + FUND_ULXC) {
        return fail(`at ${confirmed.level} the same move must answer 200 and post exactly once: one fund line of ${FUND_ULXC} µLXC and ${book.allocated_ulxc + FUND_ULXC} ` +
          `µLXC allocated; Lens answered ${paid.status} ${paid.text.slice(0, 160)}; the agent's statement has ${lines.length} fund line(s) ` +
          `${JSON.stringify(lines.map((l) => l.amount_ulxc))} and the workspace ${now} µLXC allocated`)
      }

      return {
        pass: true,
        detail: `a ${account.value.account_type} account at ${start} was refused 403 ${VERIFICATION_NEEDED} "${CONFIRM_SENTENCE}" with nothing posted` +
          `${needs === 'L3' ? ', and again at L2' : ''}; at ${confirmed.level} the same ${FUND_ULXC} µLXC posted one fund line on ${agent.name}'s statement`,
      }
    },
  }
}
