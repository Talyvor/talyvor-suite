// B17.537 — two-person approval above a second amount (B28.40, Lens B28.315), on Lens's API, once a run, on a Business workspace of
// its own. The owner gives a person the Approver role on Team and roles; that person signs in to the account with it, as the BFF
// signs them in (POST /v1/provision/roles on the provisioning secret), and the owner names them the second approver above 1¢. An
// agent pays another agent above that line: Lens holds it 202 for approval whatever the agent's own rules say. The owner's approval
// leaves it pending, "Approved by you. Waiting for a second approver.", and the retry is still held with no pay line on either
// statement; the owner approving again is refused 409. The Approver's approval approves it, and the retry posts exactly one pay
// pair: the amount off the payer's statement and onto the payee's. A run without the provisioning secret is a SKIP, never a pass.

import { fail } from './bank.ts'
import { RUN_SALT } from './oracles.ts'
import { said } from './routes.ts'
import { CannotTest, type Scenario } from './scenarios.ts'

/** cmd/lens/provision_handler.go provisionSecretHeader. */
const PROVISION_HEADER = 'X-Gateway-Auth'
/** 3 LXC into the payer; 2 LXC ($0.20 at Lens's $0.10 an LXC) paid above a second-approver line of 1¢. */
const FUND_ULXC = 3_000_000
const PAY_ULXC = 2_000_000
const LINE = { above_minor: 1, currency: 'USD' }

interface Approval { id: string; status: string; waiting_for_second_approver?: boolean; over_second_approver_line?: boolean; first_approved_by?: string; second_approved_by?: string }

export function secondApprover(): Scenario {
  return {
    id: 'second-approver',
    owner: 'talyvor-lens',
    own: true,
    agents: 2,
    feature: 'Agent Wallets',
    items: ['B28.40', 'B28.315'],
    title: "above the second-approver line an agent's payment waits for two people: after the owner's approval it is still held and " +
      "nothing posts; after the Approver-role person's approval the retry posts exactly one pay pair",
    run: async (ctx) => {
      const { lens, provisionSecret } = ctx.env
      const user = ctx.app.user
      if (provisionSecret === '') throw new CannotTest('the Approver signs in to the account on LENS_PROVISION_SECRET, which this run was not given')
      const note = (what: string, r: { status: number; text: string }) => ctx.evidence.push({ note: what, answer: `${r.status} ${r.text.slice(0, 300)}` })
      const parse = <T>(text: string): T | undefined => {
        try {
          return JSON.parse(text) as T
        } catch {
          return undefined
        }
      }
      const ws = `/v1/workspaces/${user.workspaceID}`

      // 1. Two agents, the payer funded.
      const payer = await lens.createAgent(user, `Second approver payer ${RUN_SALT}`)
      const payee = await lens.createAgent(user, `Second approver payee ${RUN_SALT}`)
      const book = await lens.agentBook(user)
      if (book.unallocated_ulxc < FUND_ULXC) throw new CannotTest(`the workspace has ${book.unallocated_ulxc} µLXC free, under the ${FUND_ULXC} µLXC its agent is funded`)
      await lens.fundAgent(user, payer.id, FUND_ULXC)

      // 2. A person is given the Approver role, and signs in to the account with it.
      const email = `approver-${RUN_SALT}-${user.workspaceID.slice(-8)}@e2e.talyvor.test`.toLowerCase()
      const given = await lens.act(user, 'PUT', '/v1/workspaces/{ws}/roles', { email, role: 'approver' })
      ctx.evidence.push({ note: `the owner gives ${email} the Approver role`, answer: said(given) })
      if (!given.ok) return fail(`giving ${email} the Approver role on Team and roles must answer 200; Lens answered ${said(given)}`)
      const session = await lens.as('', 'POST', '/v1/provision/roles',
        { identity: `e2e-second-approver-${RUN_SALT}-${user.workspaceID}`, email, mode: 'session', account_id: user.workspaceID, ttl_hours: 1 },
        { [PROVISION_HEADER]: provisionSecret })
      ctx.evidence.push({ note: `${email} signs in to the account with the Approver role`, answer: `${session.status} ${session.status === 200 ? '(token withheld)' : session.text.slice(0, 200)}` })
      if (session.status === 401) throw new CannotTest("Lens refused this run's LENS_PROVISION_SECRET: it is not the value Lens boots with")
      const approverToken = session.status === 200 ? parse<{ token?: string; role?: string }>(session.text)?.token ?? '' : ''
      if (approverToken === '') return fail(`${email} signing in with the Approver role must answer 200 with a session; Lens answered ${session.status} ${session.text.slice(0, 200)}`)
      const roles = await lens.act<{ items: { email: string; role: string; user_id: string }[] | null }>(user, 'GET', '/v1/workspaces/{ws}/roles')
      ctx.evidence.push({ note: 'the owner reads Team and roles', answer: said(roles) })
      const person = roles.ok ? (roles.value.items ?? []).find((r) => r.email === email) : undefined
      if (person === undefined || person.role !== 'approver' || person.user_id === '') {
        return fail(`after ${email} signed in, Team and roles must list them as Approver with their user id; Lens answered ${said(roles)}`)
      }

      // 3. The owner names them the second approver above 1¢.
      const line = { user_id: person.user_id, ...LINE }
      const set = await lens.act(user, 'PUT', '/v1/workspaces/{ws}/second-approver', line)
      ctx.evidence.push({ note: `the owner names ${email} the second approver above ${LINE.above_minor}¢`, answer: said(set) })
      if (!set.ok) return fail(`setting the second approver must answer 200; Lens answered ${said(set)}`)
      const read = await lens.act<{ user_id: string; above_minor: number; currency: string }>(user, 'GET', '/v1/workspaces/{ws}/second-approver')
      ctx.evidence.push({ note: 'the owner reads the second approver back', answer: said(read) })
      if (!read.ok || read.value.user_id !== line.user_id || read.value.above_minor !== LINE.above_minor || read.value.currency !== LINE.currency) {
        return fail(`the second approver must read back as ${JSON.stringify(line)}; Lens answered ${said(read)}`)
      }

      const pays = async (agentID: string) => (await lens.agentLines(user, agentID)).filter((l) => l.kind === 'pay')
      const memo = `second approver ${RUN_SALT}`
      const pay = async (what: string) => {
        const r = await lens.as(user.token, 'POST', `${ws}/agents/${payer.id}/pay`, { to_agent_id: payee.id, amount_ulxc: PAY_ULXC, memo })
        note(what, r)
        return r
      }
      const approve = async (token: string, id: string, what: string) => {
        const r = await lens.as(token, 'POST', `${ws}/agents/approvals/${id}/approve`, {})
        note(what, r)
        return { ...r, value: r.status === 200 ? parse<Approval>(r.text) : undefined }
      }
      const posted = async (): Promise<string> => {
        const [from, to] = [await pays(payer.id), await pays(payee.id)]
        return `${payer.name} has ${from.length} pay line(s) ${JSON.stringify(from.map((l) => l.amount_ulxc))}, ${payee.name} ${to.length} ${JSON.stringify(to.map((l) => l.amount_ulxc))}`
      }
      const none = async () => (await pays(payer.id)).length === 0 && (await pays(payee.id)).length === 0

      // 4. Above the line: held for approval, and nothing posts.
      const first = await pay(`the payer pays ${PAY_ULXC} µLXC, above the second-approver line`)
      const held = first.status === 202 ? parse<{ status?: string; approval_id?: string }>(first.text) : undefined
      const approvalID = held?.approval_id ?? ''
      if (held?.status !== 'pending_approval' || approvalID === '') {
        return fail(`${PAY_ULXC} µLXC above the second-approver line must answer 202 naming its pending approval; Lens answered ${first.status} ${first.text.slice(0, 200)}; ${await posted()}`)
      }
      if (!await none()) return fail(`a payment held for approval must post nothing; ${await posted()}`)

      // 5. The owner's approval: still pending, waiting for a second approver, and the retry posts nothing.
      const byOwner = await approve(user.token, approvalID, "the owner approves the payment, the first of two")
      if (byOwner.status !== 200 || byOwner.value?.status !== 'pending' || byOwner.value.waiting_for_second_approver !== true) {
        return fail(`the owner's approval above the line must answer 200 with the approval still pending and waiting_for_second_approver ` +
          `("Approved by you. Waiting for a second approver."); Lens answered ${byOwner.status} ${byOwner.text.slice(0, 200)}`)
      }
      const retried = await pay('the payer retries after the owner\'s approval')
      if (retried.status !== 202 || !await none()) {
        return fail(`after only the owner's approval the retry must still be held (202) with zero postings; Lens answered ${retried.status} ${retried.text.slice(0, 160)}; ${await posted()}`)
      }
      const again = await approve(user.token, approvalID, 'the owner approves it a second time')
      if (again.status !== 409 || !again.text.includes('same_approver')) {
        return fail(`the owner approving twice must be refused 409 same_approver; Lens answered ${again.status} ${again.text.slice(0, 200)}`)
      }
      if (!await none()) return fail(`the owner's second approval must post nothing; ${await posted()}`)

      // 6. The Approver's approval: approved, and the retry posts exactly one pay pair.
      const byApprover = await approve(approverToken, approvalID, `${email}, the second approver, approves the payment`)
      if (byApprover.status !== 200 || byApprover.value?.status !== 'approved') {
        return fail(`the second approver's approval must answer 200 approved; Lens answered ${byApprover.status} ${byApprover.text.slice(0, 200)}`)
      }
      const paid = await pay('the payer retries after both approvals')
      const [from, to] = [await pays(payer.id), await pays(payee.id)]
      if (paid.status !== 200 || from.length !== 1 || from[0].amount_ulxc !== -PAY_ULXC || to.length !== 1 || to[0].amount_ulxc !== PAY_ULXC) {
        return fail(`after both approvals the retry must answer 200 and post exactly one pay pair of ${PAY_ULXC} µLXC; Lens answered ${paid.status} ` +
          `${paid.text.slice(0, 160)}; ${await posted()}`)
      }

      return {
        pass: true,
        detail: `${PAY_ULXC} µLXC above the ${LINE.above_minor}¢ line was held as approval ${approvalID}; after the owner's approval it was still pending ` +
          `and waiting for a second approver, the retry held with zero postings and a second approval by the owner refused 409; after ${email}'s ` +
          `(Approver role) approval the retry posted one pay pair: -${PAY_ULXC} on ${payer.name}, +${PAY_ULXC} on ${payee.name}`,
      }
    },
  }
}
