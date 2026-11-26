// B30.139 — agent cards that spend from a currency account (Lens B30.30), on Lens's API, once a run, on a workspace of its own.
// The owner gives an agent 400 LXC of credits, issues it a test-mode card and opens the company's and the agent's accounts in the
// card's currency, the agent's holding 500.00 of test money. The card switched to draw on the account (POST …/card/draws-on
// {"draws_on":"account"}) reads draws_on account. A 25.00 purchase on it, decided as Stripe Issuing's authorisation request is, is
// held on the money ledger: the agent's statement holds one card_hold of −25.00, the account 475.00, and GET …/card names the
// account on the authorisation (money_account_id). Its capture at 24.00 arrives as Stripe sends it, an issuing_transaction.created
// signed with Lens's test-mode webhook secret: card_charge gives the account the 1.00 no longer held at once, so the statement holds
// −25.00 held and +1.00 released and the account 476.00. Sent again, it moves nothing more. The agent's credits never move.
// Without LENS_STRIPE_TEST_WEBHOOK_SECRET no capture can be signed, and the scenario is a SKIP.

import { createHmac, randomBytes } from 'node:crypto'
import { fail } from './bank.ts'
import { RUN_SALT } from './oracles.ts'
import { CannotTest, type Scenario } from './scenarios.ts'
import { call, said } from './settings.ts'

const FUND_MINOR = 50_000
const HOLD_MINOR = 2_500
const CAPTURE_MINOR = 2_400
const CREDITS_ULXC = 400_000_000
const CAPABILITIES = ['currency_accounts', 'payments_in', 'payments_out']
const TEST_HOOK = '/v1/billing/webhook/test'
const SYMBOL: Record<string, string> = { GBP: '£', EUR: '€', USD: '$' }

interface Card { id: string; currency: string; livemode: boolean; draws_on?: string }
interface Authorization { authorization_id: string; approved: boolean; money_account_id?: string | null }
interface Account { id: string; test_minor: number }
interface Statement { lines: { kind?: string; amount_minor: number }[] | null }

export function agentCardAccount(): Scenario {
  return {
    id: 'agent-card-account',
    owner: 'talyvor-lens',
    own: true,
    agents: 1,
    feature: 'Agent Wallets',
    items: ['B30.30', 'B30.139'],
    title: "agent cards that spend from a currency account: switched to draw on the agent's account, a 25.00 purchase is held " +
      'there (card_hold), its capture at 24.00 gives the 1.00 back at once (card_charge), sent again it moves nothing, and no credits move',
    run: async (ctx) => {
      const secret = ctx.env.webhookSecret
      if (secret === '') throw new CannotTest("LENS_STRIPE_TEST_WEBHOOK_SECRET is not set, so the purchase's capture cannot be signed as Stripe signs it")
      const { lens } = ctx.env
      const user = ctx.app.user
      const step = async <T>(method: string, path: string, body: unknown, note: string) => {
        const r = await call<T>(ctx, method, path, body)
        ctx.evidence.push({ note, answer: said(r) })
        return r
      }
      const key = () => `e2e-${randomBytes(8).toString('hex')}`

      // 1. The terms, an agent with 400 LXC of credits, and its test-mode card.
      const terms = await step<{ terms: { capability: string; version: number; accepted?: unknown }[] | null }>('GET', '/v1/workspaces/{ws}/terms', undefined, 'the owner reads the terms')
      for (const t of (terms.value?.terms ?? []).filter((x) => CAPABILITIES.includes(x.capability) && x.accepted == null)) {
        const ok = await step('POST', `/v1/workspaces/{ws}/terms/${t.capability}/accept`, { version: t.version }, `the owner accepts ${t.capability}'s terms`)
        if (ok.status !== 201) return fail(`accepting ${t.capability}'s terms answered ${said(ok)}`)
      }
      const agent = await lens.createAgent(user, `Card account ${RUN_SALT}`)
      await lens.fundAgent(user, agent.id, CREDITS_ULXC)
      const issued = await step<Card>('POST', `/v1/workspaces/{ws}/agents/${agent.id}/card`,
        { first_name: 'Test', last_name: 'Shopper', line1: '1 High Street', city: 'London', postal_code: 'EC1A 1BB', country: 'GB' }, `the owner issues ${agent.name} a card`)
      if (issued.status !== 201 || issued.value === undefined) return fail(`issuing ${agent.name} a card must answer 201; Lens answered ${said(issued)}`)
      const card = issued.value
      if (card.livemode) return fail(`${agent.name}'s card must be a test-mode card; Lens issued ${issued.text.slice(0, 200)}`)
      const currency = card.currency.toUpperCase()
      const sym = SYMBOL[currency]
      if (sym === undefined) return fail(`the card is in ${currency}, and an account is opened in GBP, EUR or USD`)
      const amount = (minor: number): string => `${minor < 0 ? '−' : ''}${sym}${(Math.abs(minor) / 100).toFixed(2)}`

      // 2. The company's and the agent's accounts in the card's currency, the agent's holding 500.00 of test money.
      const company = await step<{ id: string }>('POST', '/v1/money/accounts', { currency }, `the company's ${currency} account`)
      if (company.status !== 201 || company.value === undefined) return fail(`opening the company's ${currency} account must answer 201; Lens answered ${said(company)}`)
      const topped = await step('POST', `/v1/money/accounts/${company.value.id}/test-money`, { amount_minor: FUND_MINOR, idempotency_key: key() },
        `${amount(FUND_MINOR)} of test money comes into the company's account`)
      if (topped.status !== 201) return fail(`${amount(FUND_MINOR)} of test money into the company's account answered ${said(topped)}`)
      const opened = await step<{ id: string }>('POST', '/v1/money/accounts', { currency, agent_id: agent.id }, `${agent.name}'s ${currency} account`)
      if (opened.status !== 201 || opened.value === undefined) return fail(`opening ${agent.name}'s ${currency} account must answer 201; Lens answered ${said(opened)}`)
      const accountID = opened.value.id
      const given = await step('POST', `/v1/money/accounts/${accountID}/funding`, { direction: 'to_agent', amount_minor: FUND_MINOR, idempotency_key: key() },
        `${agent.name}'s account is given ${amount(FUND_MINOR)}`)
      if (given.status !== 201) return fail(`giving ${agent.name}'s account ${amount(FUND_MINOR)} answered ${said(given)}`)

      const credits = async (note: string): Promise<number> => {
        const book = await lens.agentBook(user)
        ctx.evidence.push({ note, answer: JSON.stringify(book.agents.find((a) => a.id === agent.id) ?? null).slice(0, 200) })
        const a = book.agents.find((x) => x.id === agent.id)
        if (a === undefined) throw new Error(`${agent.name} is not in the workspace's agents`)
        return a.balance_ulxc
      }
      /** The account's balance and its card_hold and card_charge lines. */
      const ledger = async (when: string): Promise<{ balance: number; hold: number[]; charge: number[] }> => {
        const list = await step<{ accounts: Account[] | null }>('GET', '/v1/money/accounts', undefined, `the accounts ${when}`)
        const a = (list.value?.accounts ?? []).find((x) => x.id === accountID)
        if (a === undefined) throw new Error(`${agent.name}'s account ${accountID} is not on the list: ${said(list)}`)
        const st = await step<Statement>('GET', `/v1/money/accounts/${accountID}/statement`, undefined, `${agent.name}'s statement ${when}`)
        if (st.status !== 200) throw new Error(`${agent.name}'s statement answered ${said(st)}`)
        const lines = st.value?.lines ?? []
        const of = (kind: string) => lines.filter((l) => l.kind === kind).map((l) => l.amount_minor)
        return { balance: a.test_minor, hold: of('card_hold'), charge: of('card_charge') }
      }
      const shown = (l: { balance: number; hold: number[]; charge: number[] }): string =>
        `card_hold ${l.hold.map(amount).join(', ') || 'none'}, card_charge ${l.charge.map(amount).join(', ') || 'none'} and a balance of ${amount(l.balance)}`

      try {
        const creditsBefore = await credits(`${agent.name}'s credits before the purchase`)

        // 3. The card switched to draw on the agent's account.
        const switched = await step<Card>('POST', `/v1/workspaces/{ws}/agents/${agent.id}/card/draws-on`, { draws_on: 'account' }, `the owner sets ${agent.name}'s card to draw on its account`)
        if (switched.status !== 200 || switched.value?.draws_on !== 'account') return fail(`switching the card to draw on the account must answer 200 with draws_on account; Lens answered ${said(switched)}`)

        // 4. A 25.00 purchase, held on the account.
        const bought = await lens.cardPurchase(user, agent.id, { amount_minor: HOLD_MINOR, currency: card.currency, merchant: `Card account shop ${RUN_SALT}` })
        ctx.evidence.push({ note: `a ${amount(HOLD_MINOR)} purchase on ${agent.name}'s card`, answer: JSON.stringify(bought).slice(0, 200) })
        if (!bought.ok || !bought.value.approved) return fail(`a ${amount(HOLD_MINOR)} purchase on a card drawing on an account holding ${amount(FUND_MINOR)} must be approved; Lens answered ${JSON.stringify(bought).slice(0, 200)}`)
        const authID = bought.value.authorization_id
        const held = await ledger('after the purchase')
        if (JSON.stringify(held) !== JSON.stringify({ balance: FUND_MINOR - HOLD_MINOR, hold: [-HOLD_MINOR], charge: [] })) {
          return fail(`the purchase must be held on ${agent.name}'s account: one card_hold of ${amount(-HOLD_MINOR)}, no card_charge and a balance of ${amount(FUND_MINOR - HOLD_MINOR)}; it holds ${shown(held)}`)
        }
        const read = await step<{ card: Card; authorizations: Authorization[] | null }>('GET', `/v1/workspaces/{ws}/agents/${agent.id}/card`, undefined, `${agent.name}'s card and its purchases`)
        const auth = (read.value?.authorizations ?? []).find((x) => x.authorization_id === authID)
        if (read.value?.card.draws_on !== 'account' || auth?.money_account_id !== accountID) {
          return fail(`the card must read draws_on account and its purchase name the account ${accountID} it was held on; Lens reads ${said(read)}`)
        }

        // 5. Its capture at 24.00, as Stripe sends it: the 1.00 no longer held back on the account at once. Sent again, nothing more.
        const tag = randomBytes(8).toString('hex')
        const event = JSON.stringify({ id: `evt_e2e_card_capture_${tag}`, object: 'event', type: 'issuing_transaction.created', created: Math.floor(Date.now() / 1000), livemode: false,
          data: { object: { id: `ipi_e2e_${tag}`, object: 'issuing.transaction', type: 'capture', amount: -CAPTURE_MINOR, currency: card.currency.toLowerCase(),
            card: card.id, authorization: authID, livemode: false } } })
        const capture = async (note: string): Promise<string | undefined> => {
          const t = Math.floor(Date.now() / 1000)
          const r = await lens.webhook(TEST_HOOK, event, `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${event}`).digest('hex')}`)
          ctx.evidence.push({ note, answer: `${r.status} ${r.text}` })
          return r.status === 200 ? undefined : `Lens's test-mode Stripe webhook must take the capture 200; it answered ${r.status} ${r.text}`
        }
        const want = { balance: FUND_MINOR - CAPTURE_MINOR, hold: [-HOLD_MINOR], charge: [HOLD_MINOR - CAPTURE_MINOR] }
        const sent = await capture(`the purchase captured at ${amount(CAPTURE_MINOR)}`)
        if (sent !== undefined) return fail(sent)
        const captured = await ledger('after the capture')
        if (JSON.stringify(captured) !== JSON.stringify(want)) {
          return fail(`captured at ${amount(CAPTURE_MINOR)}, the ${amount(HOLD_MINOR - CAPTURE_MINOR)} no longer held must come back to ${agent.name}'s account at once: ` +
            `card_hold ${amount(-HOLD_MINOR)}, card_charge ${amount(HOLD_MINOR - CAPTURE_MINOR)} and a balance of ${amount(want.balance)}; it holds ${shown(captured)}`)
        }
        const again = await capture('the same capture sent again')
        if (again !== undefined) return fail(again)
        const twice = await ledger('after the capture was sent again')
        if (JSON.stringify(twice) !== JSON.stringify(want)) return fail(`the same capture sent again must move nothing more; ${agent.name}'s account now holds ${shown(twice)}`)

        // 6. No credits moved.
        const creditsAfter = await credits(`${agent.name}'s credits after the capture`)
        if (creditsAfter !== creditsBefore) {
          return fail(`a card drawing on the account must move no credits; ${agent.name}'s went from ${creditsBefore} to ${creditsAfter} µLXC`)
        }
        return {
          pass: true,
          detail: `${agent.name}'s ${currency} card, switched to draw on its account, held a ${amount(HOLD_MINOR)} purchase there (card_hold ${amount(-HOLD_MINOR)}, ` +
            `${amount(FUND_MINOR - HOLD_MINOR)} left); captured at ${amount(CAPTURE_MINOR)}, card_charge gave ${amount(HOLD_MINOR - CAPTURE_MINOR)} back at once, ` +
            `leaving ${amount(want.balance)}; sent again it moved nothing; its ${creditsBefore} µLXC of credits never moved`,
        }
      } catch (e) {
        return fail((e as Error).message)
      }
    },
  }
}
