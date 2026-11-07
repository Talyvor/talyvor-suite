// B52.6 — an assistant pays, creates and manages agents from the chat, once a run, on a workspace of its own.
//
// The owner funds an agent and sets its approval amount, and on Settings → Connect your AI sets the most an assistant may give a
// new agent. An assistant signs in through the consent screen with payments:send and agents:write, and @modelcontextprotocol/sdk's
// Client, over the Streamable HTTP transport Claude and ChatGPT use, calls the BFF's /mcp: send_payment inside the agent's limits
// pays once (one pay pair on both statements); above them it answers pending approval with the link and neither statement moves;
// create_agent under the limit makes an agent with exactly those limits; set_agent_limits raising one saves nothing and waits for
// the person; open_topup gives the top-up link. A BFF without Lens's Connect mint key pays nothing, and the run SKIPs. The
// prepare-only setting is the BFF's own (apps/bff mcp_agents_test.go), not this run's.

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { fail } from './bank.ts'
import { connectAssistant } from './connect.ts'
import { RUN_SALT } from './oracles.ts'
import { CannotTest, type Scenario } from './scenarios.ts'

const FUND_ULXC = 300_000
const APPROVAL_ABOVE_ULXC = 100_000
const INSIDE_ULXC = 50_000
const ABOVE_ULXC = 200_000
// The limit for new agents, set on the screen in LXC: 0.2 a payment, 1 a day, 5 a month.
const CEILING = { max_per_request_ulxc: 200_000, daily_limit_ulxc: 1_000_000, monthly_limit_ulxc: 5_000_000 }

interface ToolAnswer { isError?: boolean; content: { type: string; text?: string }[]; structuredContent?: Record<string, unknown> }

export function connectChat(): Scenario {
  return {
    id: 'connect-chat',
    owner: 'talyvor-suite',
    own: true,
    // Its two agents, the one it creates and the workspace's first: one past Free's three.
    plan: 'team',
    agents: 3,
    feature: 'Talyvor Connect',
    items: ['B52.6'],
    title: "an assistant on the MCP SDK pays from an agent inside its limits once (the pay pair on both statements), gets a pending approval " +
      'above them with nothing moved, creates an agent under the limit the person set on Settings, cannot raise a limit from the chat, ' +
      'and hands over the top-up link',
    run: async (ctx) => {
      const { lens } = ctx.env
      const user = ctx.app.user
      const page = ctx.app.page
      const origin = new URL(page.url()).origin

      // 1. On Lens's API: two agents, the first funded, payments above the approval amount waiting for the owner.
      const payer = await lens.createAgent(user, `Chat payer ${RUN_SALT}`)
      const payee = await lens.createAgent(user, `Chat payee ${RUN_SALT}`)
      const book = await lens.agentBook(user)
      if (book.unallocated_ulxc < FUND_ULXC) throw new CannotTest(`the workspace has ${book.unallocated_ulxc} µLXC free, under the ${FUND_ULXC} µLXC its agent is funded`)
      await lens.fundAgent(user, payer.id, FUND_ULXC)
      const rules = await lens.act(user, 'PUT', `/v1/workspaces/{ws}/agents/${payer.id}/rules`, { ...await lens.agentRules(user, payer.id), approval_above_ulxc: APPROVAL_ABOVE_ULXC })
      if (!rules.ok) return fail(`saving ${payer.name}'s approval amount was refused: ${rules.status}`)

      // 2. On Settings → Connect your AI: the most an assistant may give a new agent.
      await page.goto(`${origin}/settings/connect`)
      await page.getByLabel('One payment, in LXC').fill('0.2')
      await page.getByLabel('A day, in LXC').fill('1')
      await page.getByLabel('A month, in LXC').fill('5')
      await page.getByRole('button', { name: /^(Set|Change)$/ }).click()
      const said = page.getByTestId('agent-ceiling')
      await said.filter({ hasText: '0.2 LXC a payment, 1 LXC a day and 5 LXC a month' }).waitFor({ timeout: 15_000 })
      ctx.evidence.push({ note: 'the owner sets the limit for new agents on Settings → Connect your AI', answer: (await said.textContent()) ?? '' })

      // 3. An assistant connects with the two new permissions, and the SDK client calls the tools.
      const token = await connectAssistant(ctx, origin, 'e2e assistant (chat)', 'wallets:read payments:send agents:write')
      if (typeof token !== 'string') return token
      const client = new Client({ name: 'talyvor-e2e', version: '1.0.0' })
      const transport = new StreamableHTTPClientTransport(new URL('/mcp', origin), { requestInit: { headers: { Authorization: `Bearer ${token}` } } })
      await client.connect(transport)
      const call = async (name: string, args: Record<string, unknown>) => {
        const r = await client.callTool({ name, arguments: args }) as ToolAnswer
        ctx.evidence.push({ note: `${name} ${JSON.stringify(args).slice(0, 200)}`, answer: JSON.stringify(r).slice(0, 600) })
        return r
      }
      const words = (r: ToolAnswer) => r.content.map((c) => c.text ?? '').join(' ')
      const pays = async (agentID: string) => (await lens.agentLines(user, agentID)).filter((l) => l.kind === 'pay')
      const wrong: string[] = []
      try {
        const { tools } = await client.listTools()
        const send = tools.find((t) => t.name === 'send_payment')
        if (send?.annotations?.destructiveHint !== true) wrong.push(`send_payment must be listed destructive, so the assistant asks before each call; it is ${JSON.stringify(send?.annotations)}`)

        // Inside the limits: one payment, its pair on both statements.
        const inside = await call('send_payment', { agent_id: payer.id, to_agent_id: payee.id, amount_ulxc: INSIDE_ULXC, memo: `chat ${RUN_SALT}`, idempotency_key: `e2e-chat-${RUN_SALT}-in` })
        if (inside.isError === true && /cannot pay through an assistant/.test(words(inside))) {
          throw new CannotTest("the BFF pays nothing through an assistant: it was not given Lens's LENS_CONNECT_MINT_KEY")
        }
        const [from, to] = [await pays(payer.id), await pays(payee.id)]
        if (inside.structuredContent?.status !== 'paid' || from.length !== 1 || from[0].amount_ulxc !== -INSIDE_ULXC || to.length !== 1 || to[0].amount_ulxc !== INSIDE_ULXC) {
          return fail(`send_payment of ${INSIDE_ULXC} µLXC inside the limits must pay once; it answered ${words(inside).slice(0, 200)} and ${payer.name} ` +
            `has pay line(s) ${JSON.stringify(from)}, ${payee.name} ${JSON.stringify(to)}`)
        }

        // Above them: pending approval with the link, and neither statement moves.
        const above = await call('send_payment', { agent_id: payer.id, to_agent_id: payee.id, amount_ulxc: ABOVE_ULXC, idempotency_key: `e2e-chat-${RUN_SALT}-above` })
        if (above.structuredContent?.status !== 'pending_approval' || above.structuredContent?.approval_url !== `${origin}/approvals` || !/Nothing has been paid/.test(words(above))) {
          wrong.push(`send_payment above the approval amount must answer pending approval with ${origin}/approvals; it answered ${words(above).slice(0, 200)}`)
        }
        const [fromAfter, toAfter] = [await pays(payer.id), await pays(payee.id)]
        if (fromAfter.length !== 1 || toAfter.length !== 1) wrong.push(`only the payment inside the limits may move money; ${payer.name} has ${fromAfter.length} pay line(s), ${payee.name} ${toAfter.length}`)

        // create_agent under the limit: an agent with exactly those limits.
        const made = await call('create_agent', { name: `Chat-made ${RUN_SALT}`, purpose: 'Buys datasets for research', ...CEILING })
        const madeID = String(made.structuredContent?.id ?? '')
        const madeRules = madeID === '' ? undefined : await lens.agentRules(user, madeID)
        if (madeRules === undefined || madeRules.max_per_request_ulxc !== CEILING.max_per_request_ulxc || madeRules.daily_limit_ulxc !== CEILING.daily_limit_ulxc ||
          madeRules.monthly_limit_ulxc !== CEILING.monthly_limit_ulxc) {
          wrong.push(`create_agent under the limit must make an agent with exactly those limits; it answered ${words(made).slice(0, 200)} and Lens reads ${JSON.stringify(madeRules)}`)
        }
        const over = await call('create_agent', { name: `Chat-over ${RUN_SALT}`, purpose: 'Too much', ...CEILING, daily_limit_ulxc: CEILING.daily_limit_ulxc + 1 })
        if (over.isError !== true) wrong.push(`create_agent above the limit must be refused; it answered ${words(over).slice(0, 200)}`)

        // A raise from the chat saves nothing and waits for the person.
        if (madeID !== '') {
          const raise = await call('set_agent_limits', { agent_id: madeID, daily_limit_ulxc: CEILING.daily_limit_ulxc * 10 })
          const after = await lens.agentRules(user, madeID)
          if (after.daily_limit_ulxc !== CEILING.daily_limit_ulxc || !/raises it in Talyvor/.test(words(raise))) {
            wrong.push(`set_agent_limits raising a limit must save nothing and send the person to Talyvor; it answered ${words(raise).slice(0, 200)} and the daily limit is ${after.daily_limit_ulxc}`)
          }
        }

        const topup = await call('open_topup', {})
        if (topup.structuredContent?.url !== `${origin}/billing`) wrong.push(`open_topup must give ${origin}/billing; it gave ${JSON.stringify(topup.structuredContent)}`)
      } finally {
        await client.close()
      }
      if (wrong.length > 0) return fail(wrong.join('; '))
      return {
        pass: true,
        detail: `over the MCP SDK: send_payment paid ${INSIDE_ULXC} µLXC once (-${INSIDE_ULXC} on ${payer.name}, +${INSIDE_ULXC} on ${payee.name}); ${ABOVE_ULXC} µLXC ` +
          'answered pending approval with the link and nothing moved; create_agent made an agent with the limits set on Settings and refused one above them; ' +
          'a raise from the chat saved nothing; open_topup gave the top-up link',
      }
    },
  }
}
