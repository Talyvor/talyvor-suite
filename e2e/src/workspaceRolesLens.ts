// B17.545 — roles: Viewer, Finance, Approver, Admin (Lens B28.342, the Lens side of B28.70), on Lens's API, once a run, on a
// workspace of its own. The owner gives four emails the four roles (PUT /v1/workspaces/{ws}/roles) and each person signs in with
// theirs the way the BFF signs in a person who proved their email (POST /v1/provision/roles on the provisioning secret). Every
// role reads the agent's summary. The Viewer's and the Approver's funds are refused 403 and write no posting; Finance's posts
// exactly one. An agent's payment above its approval amount waits: the Viewer's and Finance's approvals are refused and it stays
// pending with no posting; the Approver's approves it, and the agent's payment then posts once on each agent's account. Admin
// does all but the owner's own parts: their try at giving a role is refused and the owner's list is as it was. A run without
// the provisioning secret is a SKIP, never a pass.

import { fail } from './bank.ts'
import { RUN_SALT } from './oracles.ts'
import { books, movedBy, said, type Side } from './routes.ts'
import { CannotTest, type Scenario } from './scenarios.ts'

/** cmd/lens/provision_handler.go provisionSecretHeader. */
const PROVISION_HEADER = 'X-Gateway-Auth'
const START_ULXC = 3_000_000
const FUND_ULXC = 1_000_000
const APPROVAL_ABOVE_ULXC = 1_000_000
const PAY_ULXC = 2_000_000

const ROLES = ['viewer', 'finance', 'approver', 'admin'] as const
type Role = (typeof ROLES)[number]

export function workspaceRolesLens(): Scenario {
  return {
    id: 'workspace-roles-lens',
    owner: 'talyvor-lens',
    own: true,
    agents: 2,
    feature: 'Team and roles',
    items: ['B28.342'],
    title: "each of Viewer, Finance, Approver and Admin reads the agent; only Finance's fund posts, only the Approver's approval " +
      "lets the waiting payment post once on each account, and Admin cannot give a role",
    run: async (ctx) => {
      const { lens, provisionSecret } = ctx.env
      const user = ctx.app.user
      if (provisionSecret === '') throw new CannotTest('each person signs in to the account with their role on LENS_PROVISION_SECRET, which this run was not given')
      const ws = `/v1/workspaces/${user.workspaceID}`
      const note = (what: string, r: { status: number; text: string }) => ctx.evidence.push({ note: what, answer: `${r.status} ${r.text.slice(0, 200)}` })

      // 1. A payer funded by the owner, a payee, and an approval amount under the payment the payer will make.
      const payer = await lens.createAgent(user, `Roles payer ${RUN_SALT}`)
      const payee = await lens.createAgent(user, `Roles payee ${RUN_SALT}`)
      const book = await lens.agentBook(user)
      if (book.unallocated_ulxc < START_ULXC + 3 * FUND_ULXC) {
        throw new CannotTest(`the workspace has ${book.unallocated_ulxc} µLXC free, under the ${START_ULXC + 3 * FUND_ULXC} µLXC this scenario moves`)
      }
      await lens.fundAgent(user, payer.id, START_ULXC)
      const k = await lens.act<{ key: string }>(user, 'POST', `/v1/workspaces/{ws}/agents/${payer.id}/keys`, { name: 'workspace-roles-lens' })
      if (!k.ok) return fail(`issuing ${payer.name} a key was refused: ${said(k)}`)
      const rules = await lens.act(user, 'PUT', `/v1/workspaces/{ws}/agents/${payer.id}/rules`, { ...await lens.agentRules(user, payer.id), approval_above_ulxc: APPROVAL_ABOVE_ULXC })
      if (!rules.ok) return fail(`saving ${payer.name}'s approval amount was refused: ${said(rules)}`)

      // 2. The owner gives four emails the four roles, and each person signs in with theirs.
      const tokens = {} as Record<Role, string>
      const emailOf = (role: Role) => `${role}-${RUN_SALT}-${user.workspaceID.slice(-8)}@e2e.talyvor.test`.toLowerCase()
      for (const role of ROLES) {
        const email = emailOf(role)
        const given = await lens.as(user.token, 'PUT', `${ws}/roles`, { email, role })
        note(`the owner gives ${email} the ${role} role`, given)
        if (given.status !== 200) return fail(`the owner giving ${email} the ${role} role must answer 200; Lens answered ${given.status} ${given.text.slice(0, 200)}`)
        const session = await lens.as('', 'POST', '/v1/provision/roles',
          { identity: `e2e-roles-lens-${role}-${RUN_SALT}-${user.workspaceID}`, email, mode: 'session', account_id: user.workspaceID, ttl_hours: 1 },
          { [PROVISION_HEADER]: provisionSecret })
        ctx.evidence.push({ note: `${email} signs in to the account as ${role}`, answer: `${session.status} ${session.status === 200 ? '(token withheld)' : session.text.slice(0, 200)}` })
        if (session.status === 401) throw new CannotTest("Lens refused this run's LENS_PROVISION_SECRET: it is not the value Lens boots with")
        let token = ''
        try {
          token = session.status === 200 ? (JSON.parse(session.text) as { token?: string }).token ?? '' : ''
        } catch {
          token = ''
        }
        if (token === '') return fail(`${email} signing in as ${role} must answer 200 with a session; Lens answered ${session.status} ${session.text.slice(0, 200)}`)
        tokens[role] = token
      }

      // 3. Every role reads the agent's summary.
      for (const role of ROLES) {
        const read = await lens.as(tokens[role], 'GET', `${ws}/agents/${payer.id}/summary`)
        note(`the ${role} reads ${payer.name}'s summary`, read)
        if (read.status !== 200) return fail(`every role must read an agent's summary; the ${role}'s read answered ${read.status} ${read.text.slice(0, 200)}`)
      }

      // 4. Only the money roles fund: the Viewer's and the Approver's funds are refused and post nothing; Finance's posts one.
      const payerSide: Side[] = [{ user, agent: payer.id, who: payer.name }]
      for (const role of ['viewer', 'approver'] as const) {
        const before = await books(ctx, payerSide)
        const free = (await lens.agentBook(user)).unallocated_ulxc
        const r = await lens.as(tokens[role], 'POST', `${ws}/agents/${payer.id}/fund`, { amount_ulxc: FUND_ULXC })
        note(`the ${role} funds ${payer.name} ${FUND_ULXC} µLXC`, r)
        const moved = await movedBy(ctx, payerSide, before, [0], `after the ${role}'s fund`)
        const freeAfter = (await lens.agentBook(user)).unallocated_ulxc
        if (r.status !== 403 || moved !== undefined || freeAfter !== free) {
          return fail(`the ${role}'s fund must be refused 403 and write no posting; Lens answered ${r.status} ${r.text.slice(0, 160)}` +
            `${moved === undefined ? '' : `; ${moved}`}; the workspace's free µLXC went ${free} → ${freeAfter}`)
        }
      }
      const beforeFinance = await books(ctx, payerSide)
      const byFinance = await lens.as(tokens.finance, 'POST', `${ws}/agents/${payer.id}/fund`, { amount_ulxc: FUND_ULXC })
      note(`Finance funds ${payer.name} ${FUND_ULXC} µLXC`, byFinance)
      const financeMoved = await movedBy(ctx, payerSide, beforeFinance, [FUND_ULXC], "after Finance's fund")
      if (byFinance.status !== 200 || financeMoved !== undefined) {
        return fail(`Finance's fund must answer 200 and post exactly one line of ${FUND_ULXC} µLXC; Lens answered ${byFinance.status} ${byFinance.text.slice(0, 160)}` +
          `${financeMoved === undefined ? '' : `; ${financeMoved}`}`)
      }

      // 5. The payer's payment above its approval amount waits; only the Approver's approval lets it post.
      const sides: Side[] = [{ user, agent: payer.id, who: payer.name }, { user, agent: payee.id, who: payee.name }]
      const memo = `roles ${RUN_SALT}`
      const pay = async (what: string) => {
        const r = await lens.payAsAgent(k.value.key, user.workspaceID, payer.id, payee.id, PAY_ULXC, memo)
        ctx.evidence.push({ note: what, answer: r.ok ? `paid ${JSON.stringify(r.value)}` : `${r.status} ${r.error}` })
        return r
      }
      const before = await books(ctx, sides)
      const held = await pay(`${payer.name} pays ${PAY_ULXC} µLXC, above its ${APPROVAL_ABOVE_ULXC} µLXC approval amount`)
      const approvalID = (await lens.agentApprovals(user)).find((a) => a.agent_id === payer.id && a.amount_ulxc === PAY_ULXC && a.status === 'pending')?.id
      if (held.ok || held.held === undefined || approvalID === undefined) {
        return fail(`a payment above the approval amount must be held and file a pending approval; Lens answered ${held.ok ? 'paid' : `${held.status} ${held.error}`}`)
      }
      const status = async () => (await lens.agentApprovals(user)).find((a) => a.id === approvalID)?.status ?? 'missing'
      for (const role of ['viewer', 'finance'] as const) {
        const r = await lens.as(tokens[role], 'POST', `${ws}/agents/approvals/${approvalID}/approve`, {})
        note(`the ${role} approves ${approvalID}`, r)
        const now = await status()
        if (r.status !== 403 || now !== 'pending') {
          return fail(`the ${role}'s approval of ${approvalID} must be refused 403 and leave it pending; Lens answered ${r.status} ${r.text.slice(0, 160)} and it is ${now}`)
        }
      }
      const still = await movedBy(ctx, sides, before, [0, 0], "after the Viewer's and Finance's approvals")
      if (still !== undefined) return fail(still)
      const byApprover = await lens.as(tokens.approver, 'POST', `${ws}/agents/approvals/${approvalID}/approve`, {})
      note(`the approver approves ${approvalID}`, byApprover)
      const approved = await status()
      if (byApprover.status !== 200 || approved !== 'approved') {
        return fail(`the Approver's approval of ${approvalID} must answer 200 and approve it; Lens answered ${byApprover.status} ${byApprover.text.slice(0, 160)} and it is ${approved}`)
      }
      const paid = await pay(`${payer.name} pays the approved ${PAY_ULXC} µLXC`)
      if (!paid.ok) return fail(`the payment the Approver approved must be paid; Lens answered ${paid.status} ${paid.error}`)
      const moved = await movedBy(ctx, sides, before, [-PAY_ULXC, PAY_ULXC], "after the Approver's approval")
      if (moved !== undefined) return fail(moved)

      // 6. Admin cannot give a role: roles stay the owner's.
      const intruder = `intruder-${RUN_SALT}-${user.workspaceID.slice(-8)}@e2e.talyvor.test`.toLowerCase()
      const byAdmin = await lens.as(tokens.admin, 'PUT', `${ws}/roles`, { email: intruder, role: 'admin' })
      note(`the admin gives ${intruder} the admin role`, byAdmin)
      const list = await lens.as(user.token, 'GET', `${ws}/roles`)
      note("the owner reads the workspace's roles", list)
      let emails: string[] = []
      try {
        emails = (JSON.parse(list.text) as { items?: { email: string }[] }).items?.map((i) => i.email) ?? []
      } catch {
        emails = []
      }
      if (byAdmin.status !== 403 || list.status !== 200 || emails.includes(intruder) || emails.length !== ROLES.length) {
        return fail(`an Admin giving a role must be refused 403 and leave the owner's ${ROLES.length} roles as they were; Lens answered ${byAdmin.status} ` +
          `${byAdmin.text.slice(0, 160)}, and the owner's list reads ${list.status} ${JSON.stringify(emails)}`)
      }

      return {
        pass: true,
        detail: `all four roles read ${payer.name}; the Viewer's and the Approver's funds were refused 403 with no posting, Finance's posted ${FUND_ULXC} µLXC; ` +
          `approval ${approvalID} was refused for the Viewer and Finance with no posting, the Approver's approved it and the payment posted ` +
          `${-PAY_ULXC} µLXC on ${payer.name} and ${PAY_ULXC} µLXC on ${payee.name}; the Admin's try at giving a role was refused 403`,
      }
    },
  }
}
