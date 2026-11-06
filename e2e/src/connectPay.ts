// B52.34 — an assistant pays from an agent's wallet on a Connect token (talyvor-lens B52.4), once a run, on a workspace of its own.
//
// The owner funds an agent and sets its approval amount; the run, holding the BFF's LENS_CONNECT_MINT_KEY, mints a Connect token
// for that agent as the BFF does for Claude or ChatGPT. A payment under the approval amount lands once: one pay line on the payer's
// statement and its pair on the payee's. One above it answers 202 with a pending approval and neither statement moves. The token is
// refused 403 on approve, PUT rules, POST keys and POST card, and the approval is still pending after. A Lens without the mint
// route (404), or a run without the credential, is a SKIP, never a pass.

import { fail } from './bank.ts'
import { RUN_SALT } from './oracles.ts'
import { said } from './routes.ts'
import { CannotTest, type Scenario } from './scenarios.ts'

const FUND_ULXC = 300_000
const APPROVAL_ABOVE_ULXC = 100_000
const INSIDE_ULXC = 50_000
const ABOVE_ULXC = 200_000

export function connectPay(): Scenario {
  return {
    id: 'connect-pay',
    owner: 'talyvor-lens',
    own: true,
    agents: 2,
    feature: 'Connect',
    items: ['B52.4', 'B52.34'],
    title: "an assistant's Connect token pays from its agent inside the rules once (the pay pair on both statements); above the approval " +
      'amount it answers 202 with a pending approval and nothing moves; approve, PUT rules, POST keys and POST card refuse it 403',
    run: async (ctx) => {
      const { lens, connectMintKey } = ctx.env
      const user = ctx.app.user
      if (connectMintKey === '') throw new CannotTest('a Connect token is minted on LENS_CONNECT_MINT_KEY, which this run was not given')

      const payer = await lens.createAgent(user, `Connect payer ${RUN_SALT}`)
      const payee = await lens.createAgent(user, `Connect payee ${RUN_SALT}`)
      const book = await lens.agentBook(user)
      if (book.unallocated_ulxc < FUND_ULXC) throw new CannotTest(`the workspace has ${book.unallocated_ulxc} µLXC free, under the ${FUND_ULXC} µLXC its agent is funded`)
      const owner = book.agents.find((a) => a.id === payer.id)?.owner_user_id ?? ''
      if (owner === '') return fail(`${payer.name} has no owner in the workspace's book, so no Connect token can be minted for it`)
      await lens.fundAgent(user, payer.id, FUND_ULXC)
      const rules = await lens.act(user, 'PUT', `/v1/workspaces/{ws}/agents/${payer.id}/rules`, { ...await lens.agentRules(user, payer.id), approval_above_ulxc: APPROVAL_ABOVE_ULXC })
      if (!rules.ok) return fail(`saving ${payer.name}'s approval amount was refused: ${said(rules)}`)

      const minted = await lens.as(connectMintKey, 'POST', '/v1/auth/connect-token',
        { workspace_id: user.workspaceID, user_id: owner, client_id: 'https://claude.ai', agent_id: payer.id, scopes: ['payments:send'] })
      ctx.evidence.push({ note: `the BFF's credential mints a Connect token for ${payer.name}`, answer: `${minted.status} ${minted.status === 201 ? '(token withheld)' : minted.text.slice(0, 200)}` })
      if (minted.status === 404) throw new CannotTest('Lens answers 404 on POST /v1/auth/connect-token: Connect tokens (talyvor-lens B52.4) are not deployed')
      if (minted.status === 403 && minted.text.includes('mint credentials required')) {
        throw new CannotTest("Lens refused this run's LENS_CONNECT_MINT_KEY: it is not the value Lens boots with")
      }
      const token = minted.status === 201 ? (JSON.parse(minted.text) as { token?: string }).token ?? '' : ''
      if (token === '') return fail(`minting a Connect token for ${payer.name} must answer 201 with a token; Lens answered ${minted.status} ${minted.text.slice(0, 200)}`)

      const pays = async (agentID: string) => (await lens.agentLines(user, agentID)).filter((l) => l.kind === 'pay')
      const pay = async (amount: number, note: string) => {
        const r = await lens.as(token, 'POST', `/v1/workspaces/${user.workspaceID}/agents/${payer.id}/pay`,
          { to_agent_id: payee.id, amount_ulxc: amount, memo: `connect ${RUN_SALT} ${amount}` }, { 'Idempotency-Key': `e2e-connect-${RUN_SALT}-${amount}` })
        ctx.evidence.push({ note, answer: `${r.status} ${r.text.slice(0, 300)}` })
        return r
      }

      // Inside the rules: one payment, its pair on both statements.
      const inside = await pay(INSIDE_ULXC, `the Connect token pays ${INSIDE_ULXC} µLXC, under the ${APPROVAL_ABOVE_ULXC} µLXC approval amount`)
      const [from, to] = [await pays(payer.id), await pays(payee.id)]
      if (from.length !== 1 || from[0].amount_ulxc !== -INSIDE_ULXC || to.length !== 1 || to[0].amount_ulxc !== INSIDE_ULXC) {
        return fail(`a ${INSIDE_ULXC} µLXC payment on the Connect token inside the rules must post one pay pair; Lens answered ${inside.status} and ` +
          `${payer.name} has pay line(s) ${JSON.stringify(from)}, ${payee.name} ${JSON.stringify(to)}`)
      }

      // Above the approval amount: 202 with a pending approval, and neither statement moves.
      const above = await pay(ABOVE_ULXC, `the Connect token pays ${ABOVE_ULXC} µLXC, above the approval amount`)
      const pending = above.status === 202 ? JSON.parse(above.text) as { status?: string; approval_id?: string } : {}
      const approvalID = pending.approval_id ?? ''
      if (above.status !== 202 || pending.status !== 'pending_approval' || approvalID === '') {
        return fail(`a ${ABOVE_ULXC} µLXC payment above the approval amount must answer 202 naming its pending approval; Lens answered ${above.status} ${above.text.slice(0, 200)}`)
      }
      const filed = (await lens.agentApprovals(user)).find((a) => a.id === approvalID)
      if (filed?.status !== 'pending' || filed.agent_id !== payer.id || filed.amount_ulxc !== ABOVE_ULXC) {
        return fail(`approval ${approvalID} must be pending for ${payer.name}'s ${ABOVE_ULXC} µLXC; the owner reads ${JSON.stringify(filed)}`)
      }

      // The token never approves, changes rules, issues keys or a card.
      const wrong: string[] = []
      for (const [method, path, body] of [
        ['POST', `/agents/approvals/${approvalID}/approve`, {}],
        ['PUT', `/agents/${payer.id}/rules`, { approval_above_ulxc: 100_000_000 }],
        ['POST', `/agents/${payer.id}/keys`, { name: 'connect' }],
        ['POST', `/agents/${payer.id}/card`, {}],
      ] as const) {
        const r = await lens.as(token, method, `/v1/workspaces/${user.workspaceID}${path}`, body)
        ctx.evidence.push({ note: `the Connect token tries ${method} ${path}`, answer: `${r.status} ${r.text.slice(0, 200)}` })
        if (r.status !== 403) wrong.push(`${method} ${path} on the Connect token must be refused 403; Lens answered ${r.status} ${r.text.slice(0, 160)}`)
      }
      const left = (await lens.agentApprovals(user)).find((a) => a.id === approvalID)?.status
      if (left !== 'pending') wrong.push(`after the Connect token's calls approval ${approvalID} is ${left}, not pending`)
      const [fromAfter, toAfter] = [await pays(payer.id), await pays(payee.id)]
      if (fromAfter.length !== 1 || toAfter.length !== 1) {
        wrong.push(`only the one payment inside the rules may move money; ${payer.name} has ${fromAfter.length} pay line(s) and ${payee.name} ${toAfter.length}`)
      }
      if (wrong.length > 0) return fail(wrong.join('; '))

      return {
        pass: true,
        detail: `the Connect token paid ${INSIDE_ULXC} µLXC once (-${INSIDE_ULXC} on ${payer.name}, +${INSIDE_ULXC} on ${payee.name}); ${ABOVE_ULXC} µLXC answered ` +
          `202 with approval ${approvalID} pending and nothing moved; approve, PUT rules, POST keys and POST card refused 403, the approval still pending`,
      }
    },
  }
}
