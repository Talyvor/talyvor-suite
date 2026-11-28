// B52.6 — an assistant pays, creates and manages agents from the chat, once a run, on a workspace of its own. B17.560 brings it
// back from B52.6's branch to the connector's tools as they are today (B61.19): every amount in an account's own currency.
//
// On Lens's API the owner opens the company's USD account and two agents' USD accounts, moves $10.00 into the payer's and sets its
// approval amount at $3.00. On Settings → Connect your AI the owner sets the most an assistant may give a new agent. An assistant
// signs in through the consent screen with payments:send and agents:write, and @modelcontextprotocol/sdk's Client, over the
// Streamable HTTP transport Claude uses, calls the BFF's /mcp: send_payment of $2.00 is one agent_payment entry, −200 on the
// payer's statement and +200 on the payee's; $5.00 answers pending approval with the link, the approval pending on Lens and
// neither statement moving; create_agent under the limit makes an agent with exactly those limits and one above them is refused;
// set_agent_limits raising one saves nothing and waits for the person; open_topup gives the top-up link. A BFF without Lens's
// Connect mint key pays nothing, and the run SKIPs. The prepare-only setting is the BFF's own (apps/bff mcp_agents_test.go).

import { randomBytes } from 'node:crypto'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { ACTION_TIMEOUT_MS, fail } from './bank.ts'
import { connectAssistant } from './connect.ts'
import { RUN_SALT } from './oracles.ts'
import { CannotTest, type Scenario } from './scenarios.ts'
import { call, said } from './settings.ts'

const CURRENCY = 'USD'
const COMPANY_START_MINOR = 2000
const FUND_MINOR = 1000
const APPROVAL_ABOVE_MINOR = 300
const INSIDE_MINOR = 200
const ABOVE_MINOR = 500
// The limit for new agents, typed on the screen in the account's currency: 2.00 a payment, 10.00 a day, 50.00 a month.
const CEILING_TYPED = { 'One payment': '2.00', 'A day': '10.00', 'A month': '50.00' }

interface ToolAnswer { isError?: boolean; content: { type: string; text?: string }[]; structuredContent?: Record<string, unknown> }
interface Account { id: string; currency: string; purpose: string; agent_id?: string; test_minor: number }
interface Ceiling { currency?: string; max_per_payment_minor?: number; daily_limit_minor?: number; monthly_limit_minor?: number }
type Limits = Required<Omit<Ceiling, 'currency'>>
interface MinorRules extends Partial<Limits> { currency?: string }

export function connectChat(): Scenario {
  return {
    id: 'connect-chat',
    owner: 'talyvor-suite',
    own: true,
    // Its two agents and the one it creates.
    agents: 3,
    feature: 'Talyvor Connect',
    items: ['B52.6', 'B17.560'],
    title: "an assistant on the MCP SDK pays from an agent inside its limits once (one agent_payment, −200 and +200 on the two statements), " +
      'gets a pending approval above them with nothing moved, creates an agent under the limit the person set on Settings, cannot raise a ' +
      'limit from the chat, and hands over the top-up link',
    run: async (ctx) => {
      const { lens } = ctx.env
      const user = ctx.app.user
      const page = ctx.app.page
      const origin = new URL(page.url()).origin
      const step = async <T>(method: string, path: string, body: unknown, note: string) => {
        const r = await call<T>(ctx, method, path, body)
        ctx.evidence.push({ note, answer: said(r) })
        return r
      }

      // 1. On Lens's API: the company's USD account with $20.00, two agents' USD accounts, $10.00 moved into the payer's, and
      // payments above $3.00 waiting for the owner.
      const terms = await step<{ terms: { capability: string; version: number; accepted?: unknown }[] | null }>('GET', '/v1/workspaces/{ws}/terms', undefined, 'the owner reads the terms')
      for (const t of (terms.value?.terms ?? []).filter((x) => ['currency_accounts', 'payments_in'].includes(x.capability) && x.accepted == null)) {
        const ok = await step('POST', `/v1/workspaces/{ws}/terms/${t.capability}/accept`, { version: t.version }, `the owner accepts ${t.capability}'s terms`)
        if (ok.status !== 201) return fail(`accepting ${t.capability}'s terms answered ${said(ok)}`)
      }
      const payer = await lens.createAgent(user, `Chat payer ${RUN_SALT}`)
      const payee = await lens.createAgent(user, `Chat payee ${RUN_SALT}`)
      const accounts = async (when: string) => {
        const r = await step<{ accounts: Account[] | null }>('GET', '/v1/money/accounts', undefined, `the accounts ${when}`)
        if (r.status !== 200) throw new Error(`reading the accounts ${when} answered ${said(r)}`)
        return r.value?.accounts ?? []
      }
      const ids = { company: '', payer: '', payee: '' }
      for (const [whose, agentID] of [['company', ''], ['payer', payer.id], ['payee', payee.id]] as const) {
        const had = (await accounts(`before the ${whose}'s ${CURRENCY} account`))
          .find((a) => a.currency === CURRENCY && (agentID === '' ? a.purpose === 'company' : a.agent_id === agentID))
        if (had !== undefined) {
          ids[whose] = had.id
          continue
        }
        const opened = await step<Account>('POST', '/v1/money/accounts', { currency: CURRENCY, ...(agentID === '' ? {} : { agent_id: agentID }) }, `the ${whose}'s ${CURRENCY} account`)
        if (opened.status !== 201 || opened.value === undefined) return fail(`opening the ${whose}'s ${CURRENCY} account answered ${said(opened)}`)
        ids[whose] = opened.value.id
      }
      const key = () => `e2e-${randomBytes(8).toString('hex')}`
      const topped = await step('POST', `/v1/money/accounts/${ids.company}/test-money`, { amount_minor: COMPANY_START_MINOR, idempotency_key: key() }, `${COMPANY_START_MINOR} into the company's account`)
      if (topped.status !== 201) return fail(`${COMPANY_START_MINOR} into the company's account answered ${said(topped)}`)
      const funded = await step('POST', `/v1/money/accounts/${ids.payer}/funding`, { direction: 'to_agent', amount_minor: FUND_MINOR, idempotency_key: key() }, `${FUND_MINOR} into ${payer.name}'s account`)
      if (funded.status !== 201) return fail(`moving ${FUND_MINOR} into ${payer.name}'s account answered ${said(funded)}`)
      const rules = await step('PUT', `/v1/workspaces/{ws}/agents/${payer.id}/rules`,
        { ...await lens.agentRules(user, payer.id), currency: CURRENCY, approval_above_minor: APPROVAL_ABOVE_MINOR }, `${payer.name}'s approval amount`)
      if (rules.status !== 200) return fail(`saving ${payer.name}'s approval amount was refused: ${said(rules)}`)

      /** The agent_payment lines on both statements, and what each account holds, as the ledger has them. */
      const ledger = async (when: string) => {
        const lines = async (id: string, whose: string) => {
          const st = await step<{ lines: { kind: string; amount_minor: number }[] | null }>('GET', `/v1/money/accounts/${id}/statement`, undefined, `${whose}'s statement ${when}`)
          if (st.status !== 200) throw new Error(`${whose}'s statement ${when} answered ${said(st)}`)
          return (st.value?.lines ?? []).filter((l) => l.kind === 'agent_payment').map((l) => l.amount_minor)
        }
        const list = await accounts(when)
        const holds = (id: string) => list.find((a) => a.id === id)?.test_minor ?? Number.NaN
        return { payer: await lines(ids.payer, payer.name), payee: await lines(ids.payee, payee.name), payerHolds: holds(ids.payer), payeeHolds: holds(ids.payee) }
      }
      const showLedger = (l: Awaited<ReturnType<typeof ledger>>) =>
        `${payer.name} has agent_payment line(s) [${l.payer.join(', ')}] and holds ${l.payerHolds}, ${payee.name} [${l.payee.join(', ')}] and holds ${l.payeeHolds}`

      // 2. On Settings → Connect your AI: the most an assistant may give a new agent.
      await page.goto(`${origin}/settings/connect`)
      for (const [label, typed] of Object.entries(CEILING_TYPED)) await page.getByLabel(new RegExp(`^${label}, in `)).fill(typed, { timeout: ACTION_TIMEOUT_MS })
      await page.getByRole('button', { name: /^(Set|Change)$/ }).click({ timeout: ACTION_TIMEOUT_MS })
      const shown = page.getByTestId('agent-ceiling')
      await shown.filter({ hasText: /may spend at most/ }).waitFor({ timeout: 15_000 })
      ctx.evidence.push({ note: 'the owner sets the limit for new agents on Settings → Connect your AI', answer: (await shown.textContent()) ?? '' })
      const ceiling = await page.evaluate(async () => (await fetch('/api/connect/agent-ceiling', { headers: { Accept: 'application/json' } })).json()) as Ceiling
      ctx.evidence.push({ note: 'the limit for new agents as the BFF keeps it', answer: JSON.stringify(ceiling) })
      const limits: Limits = { max_per_payment_minor: ceiling.max_per_payment_minor ?? 0, daily_limit_minor: ceiling.daily_limit_minor ?? 0, monthly_limit_minor: ceiling.monthly_limit_minor ?? 0 }
      if (!ceiling.currency || !(limits.max_per_payment_minor > 0 && limits.max_per_payment_minor < limits.daily_limit_minor && limits.daily_limit_minor < limits.monthly_limit_minor)) {
        return fail(`Set on Settings → Connect your AI must keep the three limits typed (2.00, 10.00 and 50.00); the BFF keeps ${JSON.stringify(ceiling)}`)
      }

      // 3. An assistant connects with the two permissions that act, and the SDK client calls the tools.
      const token = await connectAssistant(ctx, origin, 'e2e assistant (chat)', 'wallets:read payments:send agents:write')
      if (typeof token !== 'string') return token
      const client = new Client({ name: 'talyvor-e2e', version: '1.0.0' })
      const transport = new StreamableHTTPClientTransport(new URL('/mcp', origin), { requestInit: { headers: { Authorization: `Bearer ${token}` } } })
      await client.connect(transport)
      const tool = async (name: string, args: Record<string, unknown>) => {
        const r = await client.callTool({ name, arguments: args }) as ToolAnswer
        ctx.evidence.push({ note: `${name} ${JSON.stringify(args).slice(0, 200)}`, answer: JSON.stringify(r).slice(0, 600) })
        return r
      }
      const words = (r: ToolAnswer) => r.content.map((c) => c.text ?? '').join(' ')
      const wrong: string[] = []
      let paid = ''
      try {
        const { tools } = await client.listTools()
        const send = tools.find((t) => t.name === 'send_payment')
        if (send?.annotations?.destructiveHint !== true) wrong.push(`send_payment must be listed destructive, so the assistant asks before each call; it is ${JSON.stringify(send?.annotations)}`)

        // Inside the limits: one agent_payment, its two postings on both statements.
        const inside = await tool('send_payment', { agent_id: payer.id, to_agent_id: payee.id, amount_minor: INSIDE_MINOR, currency: CURRENCY,
          memo: `chat ${RUN_SALT}`, idempotency_key: `e2e-chat-${RUN_SALT}-in` })
        if (inside.isError === true && /cannot pay through an assistant/.test(words(inside))) {
          throw new CannotTest("the BFF pays nothing through an assistant: it was not given Lens's LENS_CONNECT_MINT_KEY")
        }
        const afterInside = await ledger('after the payment inside the limits')
        if (inside.structuredContent?.status !== 'paid' || afterInside.payer.join() !== String(-INSIDE_MINOR) || afterInside.payee.join() !== String(INSIDE_MINOR) ||
          afterInside.payerHolds !== FUND_MINOR - INSIDE_MINOR || afterInside.payeeHolds !== INSIDE_MINOR) {
          return fail(`send_payment of ${INSIDE_MINOR} ${CURRENCY} minor inside the limits must pay once, −${INSIDE_MINOR} and +${INSIDE_MINOR}; it answered ` +
            `${words(inside).slice(0, 200)} and ${showLedger(afterInside)}`)
        }
        paid = showLedger(afterInside)

        // Above the approval amount: pending approval with the link, the approval on Lens, and neither statement moves.
        const above = await tool('send_payment', { agent_id: payer.id, to_agent_id: payee.id, amount_minor: ABOVE_MINOR, currency: CURRENCY,
          idempotency_key: `e2e-chat-${RUN_SALT}-above` })
        const approvalID = String(above.structuredContent?.approval_id ?? '')
        if (above.structuredContent?.status !== 'pending_approval' || above.structuredContent?.approval_url !== `${origin}/approvals` || approvalID === '') {
          wrong.push(`send_payment above the approval amount must answer pending approval with ${origin}/approvals; it answered ${words(above).slice(0, 200)}`)
        } else {
          const filed = (await lens.agentApprovals(user)).find((a) => a.id === approvalID)
          if (filed?.status !== 'pending' || filed.agent_id !== payer.id) wrong.push(`approval ${approvalID} must be pending for ${payer.name}; the owner reads ${JSON.stringify(filed)}`)
        }
        const afterAbove = await ledger('after the payment above the approval amount')
        if (showLedger(afterAbove) !== paid) wrong.push(`only the payment inside the limits may move money; after the one above them ${showLedger(afterAbove)}`)

        // create_agent under the limit: an agent with exactly those limits; one above them is refused.
        const made = await tool('create_agent', { name: `Chat-made ${RUN_SALT}`, purpose: 'Buys datasets for research', currency: ceiling.currency, ...limits })
        const madeID = String(made.structuredContent?.id ?? '')
        const madeRules = madeID === '' ? undefined : await lens.agentRules(user, madeID) as MinorRules
        // Rules Lens holds in no currency are in dollars (Lens B61.12).
        if (madeRules === undefined || (madeRules.currency || 'USD') !== ceiling.currency || madeRules.max_per_payment_minor !== limits.max_per_payment_minor ||
          madeRules.daily_limit_minor !== limits.daily_limit_minor || madeRules.monthly_limit_minor !== limits.monthly_limit_minor) {
          wrong.push(`create_agent under the limit must make an agent with exactly ${JSON.stringify(limits)} in ${ceiling.currency}; it answered ${words(made).slice(0, 200)} ` +
            `and Lens reads ${JSON.stringify(madeRules && { currency: madeRules.currency, max_per_payment_minor: madeRules.max_per_payment_minor,
              daily_limit_minor: madeRules.daily_limit_minor, monthly_limit_minor: madeRules.monthly_limit_minor })}`)
        }
        const over = await tool('create_agent', { name: `Chat-over ${RUN_SALT}`, purpose: 'Too much', currency: ceiling.currency, ...limits, daily_limit_minor: limits.daily_limit_minor + 1 })
        if (over.isError !== true) wrong.push(`create_agent above the limit must be refused; it answered ${words(over).slice(0, 200)}`)

        // A raise from the chat saves nothing and waits for the person.
        if (madeID !== '') {
          const raise = await tool('set_agent_limits', { agent_id: madeID, currency: ceiling.currency, daily_limit_minor: limits.daily_limit_minor * 10 })
          const after = await lens.agentRules(user, madeID) as MinorRules
          if (after.daily_limit_minor !== limits.daily_limit_minor || !/raises it in Talyvor/.test(words(raise))) {
            wrong.push(`set_agent_limits raising a limit must save nothing and send the person to Talyvor; it answered ${words(raise).slice(0, 200)} and the daily limit is ${after.daily_limit_minor}`)
          }
        }

        const topup = await tool('open_topup', {})
        if (topup.structuredContent?.url !== `${origin}/billing`) wrong.push(`open_topup must give ${origin}/billing; it gave ${JSON.stringify(topup.structuredContent)}`)
      } finally {
        await client.close()
      }
      if (wrong.length > 0) return fail(wrong.join('; '))
      return {
        pass: true,
        detail: `over the MCP SDK: send_payment paid ${INSIDE_MINOR} ${CURRENCY} minor once (${paid}); ${ABOVE_MINOR} answered pending approval with the ` +
          'link and nothing moved; create_agent made an agent with the limits set on Settings and refused one above them; a raise from the chat saved ' +
          'nothing; open_topup gave the top-up link',
      }
    },
  }
}
