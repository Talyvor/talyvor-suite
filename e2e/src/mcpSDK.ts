// B40.25 — THE OFFICIAL MCP SDK ON LENS'S DEPLOYED /mcp, AND A PAYMENT IT MAKES IS ON THE LEDGER. One scenario, once a run,
// on a workspace of its own:
//   mcp-sdk-agent-pay — the owner makes two agents, funds the first and gives it a key. @modelcontextprotocol/sdk's Client
//     over StreamableHTTPClientTransport, the transport Claude, ChatGPT and Cursor use, connects to Lens's /mcp with that
//     key and lists the tools: each carries its annotations, agent_balance read-only and agent_pay destructive. agent_balance
//     reads the funding; agent_pay pays the second agent a quarter of it. The oracle is the ledger, never the tool's answer:
//     the payment's entry is exactly two postings, one on each agent's statement, that sum to zero.
//   mcp-pay-retried-once (B50.16, in the red team's money-tampered family) — an agent's own key, through the same client,
//     calls agent_pay five times with one idempotency_key, as an MCP client retrying after a timeout does, then once more
//     with that key and another amount. The ledger, never the answers: the payer's statement carries one payment out and
//     the payee's one payment in, summing to zero, and the changed amount is refused and moved nothing.
// Lens's own CI proves the same client against an httptest server (talyvor-lens internal/mcp/sdk_client_realpg_test.go).

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { randomUUID } from 'node:crypto'
import { fail } from './bank.ts'
import { RUN_SALT } from './oracles.ts'
import { CannotTest, type Scenario, type ScenarioCtx } from './scenarios.ts'

const FUND_ULXC = 1_000_000
const PAY_ULXC = 250_000

/** A tool call through the SDK client, recorded as evidence: its JSON answer, or why it was refused. */
function toolCaller(ctx: ScenarioCtx, client: Client) {
  return async <T>(name: string, args: Record<string, unknown>): Promise<T | string> => {
    const r = await client.callTool({ name, arguments: args }) as { isError?: boolean; content: { type: string; text?: string }[] }
    const text = r.content[0]?.text ?? ''
    ctx.evidence.push({ note: `${name} ${JSON.stringify(args)}`, answer: `${r.isError === true ? 'isError ' : ''}${text.slice(0, 400)}` })
    if (r.isError === true) return `${name} was refused: ${text}`
    try {
      return JSON.parse(text) as T
    } catch {
      return `${name} answered no JSON: ${text.slice(0, 200)}`
    }
  }
}

export function mcpSDKAgentPay(i: number): Scenario {
  return {
    id: 'mcp-sdk-agent-pay',
    owner: 'talyvor-lens',
    own: true,
    agents: 2,
    items: ['B40.25'],
    feature: 'Agent Wallets',
    title: "the official MCP SDK client on an agent's own key lists Lens's tools with their annotations, reads agent_balance and pays " +
      'another agent with agent_pay: one entry of two postings, one on each statement, summing to zero',
    run: async (ctx) => {
      const { lens } = ctx.env
      const user = ctx.app.user
      const payer = await lens.createAgent(user, `SDK payer ${i}`)
      const payee = await lens.createAgent(user, `SDK payee ${i}`)
      const book = await lens.agentBook(user)
      if (book.unallocated_ulxc < FUND_ULXC) throw new CannotTest(`the workspace has ${book.unallocated_ulxc} µLXC free, under the ${FUND_ULXC} µLXC its agent is funded`)
      await lens.fundAgent(user, payer.id, FUND_ULXC)
      const k = await lens.act<{ key: string }>(user, 'POST', `/v1/workspaces/{ws}/agents/${payer.id}/keys`, { name: 'mcp-sdk-agent-pay' })
      if (!k.ok) return fail(`issuing ${payer.name} a key was refused: ${k.status} ${k.error}`)

      const client = new Client({ name: 'talyvor-e2e', version: '1.0.0' })
      const transport = new StreamableHTTPClientTransport(new URL('/mcp', lens.baseURL), { requestInit: { headers: { Authorization: `Bearer ${k.value.key}` } } })
      try {
        await client.connect(transport)
        ctx.evidence.push({ note: `the SDK client connects to ${lens.baseURL}/mcp with ${payer.name}'s key: protocol ${transport.protocolVersion ?? '?'}, session ${transport.sessionId ?? 'none'}` })
        const { tools } = await client.listTools()
        ctx.evidence.push({ note: `tools/list: ${JSON.stringify(tools.map((t) => [t.name, t.annotations]))}` })
        const bare = tools.filter((t) => typeof t.annotations?.title !== 'string' || typeof t.annotations.readOnlyHint !== 'boolean' || typeof t.annotations.destructiveHint !== 'boolean')
        if (bare.length > 0) return fail(`tools without their annotations (title, readOnlyHint, destructiveHint): ${bare.map((t) => t.name).join(', ')}`)
        const ann = (n: string) => tools.find((t) => t.name === n)?.annotations
        if (ann('agent_balance')?.readOnlyHint !== true || ann('agent_pay')?.destructiveHint !== true) {
          return fail(`agent_balance is not readOnlyHint or agent_pay is not destructiveHint: ${JSON.stringify([ann('agent_balance'), ann('agent_pay')])}`)
        }

        const call = toolCaller(ctx, client)
        const bal = await call<{ agent: { id: string; balance_ulxc: number } }>('agent_balance', {})
        if (typeof bal === 'string') return fail(bal)
        if (bal.agent.id !== payer.id || bal.agent.balance_ulxc !== FUND_ULXC) return fail(`agent_balance read ${JSON.stringify(bal.agent)}, not ${payer.id} holding ${FUND_ULXC} µLXC`)
        const paid = await call<{ entry_id: string }>('agent_pay', { to_agent_id: payee.id, amount_ulxc: PAY_ULXC, memo: `mcp sdk ${RUN_SALT}` })
        if (typeof paid === 'string') return fail(paid)

        // The ledger: the entry's postings on each agent's statement.
        const posted = async (agentID: string) => (await lens.agentLines(user, agentID)).filter((l) => l.entry_id === paid.entry_id).map((l) => l.amount_ulxc)
        const from = await posted(payer.id)
        const to = await posted(payee.id)
        const lines = [...from, ...to]
        ctx.evidence.push({ note: `entry ${paid.entry_id}: ${JSON.stringify(from)} on ${payer.name}'s statement, ${JSON.stringify(to)} on ${payee.name}'s` })
        const sum = lines.reduce((s, a) => s + a, 0)
        if (from.length !== 1 || from[0] !== -PAY_ULXC || to.length !== 1 || sum !== 0) {
          return fail(`agent_pay's entry ${paid.entry_id} is ${lines.length} posting(s) summing to ${sum} (${JSON.stringify(lines)}), ` +
            `not −${PAY_ULXC} on ${payer.name}'s statement and +${PAY_ULXC} on ${payee.name}'s`)
        }
        return {
          pass: true,
          detail: `the MCP SDK client listed ${tools.length} tools, each annotated; agent_balance read ${FUND_ULXC} µLXC and agent_pay's entry ${paid.entry_id} ` +
            `is two postings, −${PAY_ULXC} on ${payer.name}'s statement and +${PAY_ULXC} on ${payee.name}'s, summing to zero`,
        }
      } finally {
        await client.close().catch(() => undefined)
      }
    },
  }
}

const RETRIES = 5

export function mcpPayRetried(): Scenario {
  return {
    id: 'mcp-pay-retried-once',
    owner: 'talyvor-lens',
    own: true,
    agents: 2,
    items: ['B50.16'],
    feature: 'Agent Wallets',
    title: `an agent's own key calls agent_pay through MCP ${RETRIES} times with one idempotency_key and is paid once; the same key with another ` +
      "amount is refused and moves nothing: one posting out on the payer's statement and one in on the payee's, summing to zero",
    run: async (ctx) => {
      const { lens } = ctx.env
      const user = ctx.app.user
      const payer = await lens.createAgent(user, `Retry payer ${RUN_SALT}`)
      const payee = await lens.createAgent(user, `Retry payee ${RUN_SALT}`)
      const book = await lens.agentBook(user)
      if (book.unallocated_ulxc < FUND_ULXC) throw new CannotTest(`the workspace has ${book.unallocated_ulxc} µLXC free, under the ${FUND_ULXC} µLXC its agent is funded`)
      await lens.fundAgent(user, payer.id, FUND_ULXC)
      const k = await lens.act<{ key: string }>(user, 'POST', `/v1/workspaces/{ws}/agents/${payer.id}/keys`, { name: 'mcp-pay-retried-once' })
      if (!k.ok) return fail(`issuing ${payer.name} a key was refused: ${k.status} ${k.error}`)

      const client = new Client({ name: 'talyvor-e2e', version: '1.0.0' })
      const transport = new StreamableHTTPClientTransport(new URL('/mcp', lens.baseURL), { requestInit: { headers: { Authorization: `Bearer ${k.value.key}` } } })
      try {
        await client.connect(transport)
        const call = toolCaller(ctx, client)
        const idempotencyKey = randomUUID()
        const pay = (amount: number) => call<{ entry_id: string }>('agent_pay',
          { to_agent_id: payee.id, amount_ulxc: amount, memo: `mcp retry ${RUN_SALT}`, idempotency_key: idempotencyKey })
        for (let n = 0; n < RETRIES; n++) await pay(PAY_ULXC)
        const changed = await pay(PAY_ULXC * 2)

        // The ledger: every payment out of the payer, and everything on the payee's statement.
        const out = (await lens.agentLines(user, payer.id)).filter((l) => l.amount_ulxc < 0).map((l) => l.amount_ulxc)
        const into = (await lens.agentLines(user, payee.id)).map((l) => l.amount_ulxc)
        ctx.evidence.push({ note: `${payer.name}'s payments out: ${JSON.stringify(out)}; ${payee.name}'s postings: ${JSON.stringify(into)}` })
        const wrong: string[] = []
        if (out.length !== 1 || out[0] !== -PAY_ULXC || into.length !== 1 || into[0] !== PAY_ULXC) {
          wrong.push(`${RETRIES} calls under one idempotency_key and a changed amount left ${JSON.stringify(out)} on ${payer.name}'s statement and ` +
            `${JSON.stringify(into)} on ${payee.name}'s, not one −${PAY_ULXC} and one +${PAY_ULXC}`)
        }
        if (typeof changed !== 'string') wrong.push(`agent_pay under a used idempotency_key with ${PAY_ULXC * 2} µLXC in place of ${PAY_ULXC} was taken: ${JSON.stringify(changed)}`)
        if (wrong.length > 0) return fail(wrong.join('; '))
        return {
          pass: true,
          detail: `${RETRIES} agent_pay calls under one idempotency_key paid once, −${PAY_ULXC} on ${payer.name}'s statement and +${PAY_ULXC} on ` +
            `${payee.name}'s, summing to zero; the same key with ${PAY_ULXC * 2} µLXC was refused and moved nothing`,
        }
      } finally {
        await client.close().catch(() => undefined)
      }
    },
  }
}
