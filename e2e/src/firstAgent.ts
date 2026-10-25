// B45.36 — a new workspace starts with a first agent (talyvor-lens B45.7). Once a run, on an identity of its own: the first
// POST /v1/provision for it, as the BFF makes at a person's first sign-in, must create the workspace and return
// first_agent with its key; one proxy request on that key, as the agent, must leave a request line on that agent's own
// statement; when the agent started with test money (LENS_STARTER_TEST_MONEY_ULXC), the workspace's ledger must hold one
// starter_test_money row of that amount, marked test money, and the agent's statement its fund line. A second sign-in must
// return no first_agent, and the workspace must still have one agent. Every figure is read back from Lens.

import { worstInputTokens } from './budget.ts'
import type { AgentLine, LedgerRow, SyntheticUser } from './lens.ts'
import { RUN_SALT, listPriceUSD } from './oracles.ts'
import { CannotTest, type Scenario, type Verdict } from './scenarios.ts'

/** cmd/lens/provision_handler.go provisionSecretHeader. */
const PROVISION_HEADER = 'X-Gateway-Auth'
/** internal/economy/workspace_start.go LXCTypeStarterTest. */
export const STARTER_ROW = 'starter_test_money'
const MAX_TOKENS = 16

export interface ProvisionReply {
  workspace_id: string
  created: boolean
  token: string
  expires_at: string
  first_agent?: { agent: { id: string; name: string }; key: string; key_id: string; template: string; test_money_ulxc: number }
}

/** What the first and second sign-ins answered, the request on the first agent's key, and what Lens holds after. */
export interface FirstAgentSeen {
  first: ProvisionReply
  asked: { status: number; error: string }
  lines: AgentLine[]
  ledger: LedgerRow[]
  second: ProvisionReply
  agentsAfter: number
}

const REQUEST_KINDS = ['hold', 'spend', 'settle']

export function firstAgentVerdict(s: FirstAgentSeen): Verdict {
  const fa = s.first.first_agent
  if (!s.first.created) return { pass: false, detail: `the first sign-in of a new identity answered created:false (workspace ${s.first.workspace_id})` }
  if (fa === undefined) return { pass: false, detail: 'the first sign-in of a new identity returned no first_agent' }
  if (fa.key === '' || fa.agent.id === '') return { pass: false, detail: `first_agent came without its ${fa.key === '' ? 'key' : 'agent id'}` }
  const money = fa.test_money_ulxc
  if (s.asked.status !== 200) {
    // With no starting test money the agent holds nothing, so Lens refusing the request for its balance is Nicolai's setting, not a defect.
    if (money === 0 && s.asked.status === 402) throw new CannotTest(`LENS_STARTER_TEST_MONEY_ULXC is 0 on this Lens, so ${fa.agent.name} holds nothing and its first request was refused 402: ${s.asked.error}`)
    return { pass: false, detail: `${fa.agent.name}'s first request on the key sign-in returned was refused: ${s.asked.status} ${s.asked.error}` }
  }
  const request = s.lines.find((l) => REQUEST_KINDS.includes(l.kind) && l.amount_ulxc < 0)
  if (request === undefined) return { pass: false, detail: `served on ${fa.agent.name}'s key, yet its statement has no line for the request: ${JSON.stringify(s.lines.map((l) => l.kind))}` }
  let starter = 'no starting test money on this Lens'
  if (money > 0) {
    const rows = s.ledger.filter((r) => r.type === STARTER_ROW)
    if (rows.length !== 1 || rows[0].amount_ulxc !== money || rows[0].metadata?.funding !== 'test') {
      return { pass: false, detail: `first_agent says ${money} µLXC of test money; the ledger should hold one ${STARTER_ROW} row of it marked funding "test": ${JSON.stringify(rows)}` }
    }
    const funded = s.lines.filter((l) => l.kind === 'fund')
    if (funded.length !== 1 || funded[0].amount_ulxc !== money) return { pass: false, detail: `${fa.agent.name}'s statement should hold one fund line of ${money} µLXC: ${JSON.stringify(funded)}` }
    starter = `${STARTER_ROW} ${money} µLXC on the ledger and funded to ${fa.agent.name}`
  }
  if (s.second.created || s.second.first_agent !== undefined || s.second.workspace_id !== s.first.workspace_id) {
    return { pass: false, detail: `the second sign-in should return the same workspace, created:false and no first_agent: ${JSON.stringify({ ...s.second, token: undefined, first_agent: s.second.first_agent === undefined ? undefined : { agent: s.second.first_agent.agent } })}` }
  }
  if (s.agentsAfter !== 1) return { pass: false, detail: `after the second sign-in the workspace has ${s.agentsAfter} agents, not 1` }
  return { pass: true, detail: `a new identity's workspace started with ${fa.agent.name} on ${fa.template}; its first request on the key sign-in returned served (${request.kind} ${request.amount_ulxc} µLXC on its statement); ${starter}; a second sign-in returned no first_agent and the workspace still has one agent` }
}

export function firstAgent(): Scenario {
  return {
    id: 'first-agent',
    owner: 'talyvor-lens',
    items: ['B45.7', 'B45.36'],
    feature: 'Session and sign-in',
    title: "a new workspace starts with a first agent: its key, shown once at the first sign-in, is served as that agent and the agent's statement shows the request; a second sign-in makes no second agent",
    run: async (ctx) => {
      const { lens, provisionSecret, cap, catalog, judgeProvider, judgeModel } = ctx.env
      if (provisionSecret === '') throw new CannotTest('a fresh identity signs in on LENS_PROVISION_SECRET, which this run was not given')
      // An issuer no identity provider has, so this can never be a person's workspace.
      const identity = `talyvor-e2e\x00first-agent-${Date.now()}-${RUN_SALT}`
      const signIn = async (): Promise<ProvisionReply> => {
        const r = await lens.as('', 'POST', '/v1/provision', { identity, ttl_hours: 1 }, { [PROVISION_HEADER]: provisionSecret })
        if (r.status !== 200) throw new Error(`POST /v1/provision answered ${r.status}: ${r.text.slice(0, 200)}`)
        return JSON.parse(r.text) as ProvisionReply
      }
      const first = await signIn()
      const fa = first.first_agent
      const user: SyntheticUser = { index: -1, workspaceID: first.workspace_id, token: first.token, expiresAt: first.expires_at }
      let asked = { status: 0, error: 'not asked: no first_agent' }
      if (fa !== undefined && fa.key !== '') {
        const model = catalog.find((m) => m.id === judgeModel)
        if (model === undefined) throw new Error(`the catalog has no model ${judgeModel}`)
        const prompt = 'Reply with the single word: ready'
        const hold = cap.reserve(listPriceUSD(model, worstInputTokens(prompt.length), MAX_TOKENS))
        const r = await lens.askAsAgent(fa.key, judgeProvider, judgeModel, prompt, MAX_TOKENS).catch((e: unknown) => {
          cap.settle(hold, undefined)
          throw e
        })
        cap.settle(hold, r.ok ? listPriceUSD(model, r.value.inputTokens, r.value.outputTokens) : undefined)
        asked = r.ok ? { status: 200, error: '' } : { status: r.status, error: r.error }
      }
      const lines = fa === undefined ? [] : await lens.agentLines(user, fa.agent.id)
      const ledger = await lens.ledger(user)
      const second = await signIn()
      const agentsAfter = (await lens.agentBook(user)).agents.filter((a) => a.archived_at === undefined).length
      ctx.evidence.push({ note: `workspace ${first.workspace_id}: ${fa?.agent.name ?? 'no first agent'}, ${fa?.test_money_ulxc ?? 0} µLXC of test money; request ${asked.status}; statement ${lines.map((l) => `${l.kind} ${l.amount_ulxc}`).join(', ')}` })
      return firstAgentVerdict({ first, asked, lines, ledger, second, agentsAfter })
    },
  }
}
