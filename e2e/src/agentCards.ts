// B46.20 — an agent's single-use cards, end to end on the sandbox (Lens B46.10), on Lens's API, once a run, on a workspace of its own.
//
// The owner funds the agent's GBP account with £500.00 (an invoice from it, paid by card, as money-layer-contract does). The agent's
// own key asks POST /v1/money/cards for three cards to "Book a trip": an airline, a hotel and a car-hire firm, each capped. The batch
// waits for one approval and nothing moves. The owner approves it once: GET /v1/money/cards/{id} shows three active cards, each
// locked to its merchant, capped and closing within 24 hours, and the money ledger shows one card_hold of the total — the agent's
// account down by exactly £400.00. Approved again it is answered as it stands and holds nothing twice. The money layer lists no
// entries by kind, so the hold is read as the ledger keeps it: the agent's account balance, the sum of its postings. On the sandbox
// no charge can be made from outside, so the charges stay covered by Lens's TestB4610 until an issuer adapter exists.

import { randomBytes } from 'node:crypto'
import { fail } from './bank.ts'
import type { Answered } from './lens.ts'
import { RUN_SALT } from './oracles.ts'
import { payInvoiceByCard } from './payScreen.ts'
import { said } from './routes.ts'
import type { Scenario, ScenarioCtx } from './scenarios.ts'

interface Account { id: string; test_minor: number }
interface Card { id: string; merchant: string; cap_minor: number; currency: string; status: string; expires_at?: string }
interface Batch { id: string; agent_id: string; total_minor: number; status: string; cards: Card[] | null }

const CAPABILITIES = ['currency_accounts', 'payments_in', 'payments_out', 'agent_card']
const FUND_MINOR = 50_000
const TRIP = [{ merchant: 'British Airways', cap_minor: 20_000 }, { merchant: 'Marriott Lisbon', cap_minor: 15_000 }, { merchant: 'Hertz', cap_minor: 5_000 }]
const TOTAL_MINOR = TRIP.reduce((n, c) => n + c.cap_minor, 0)
const DAY_MS = 86_400_000

export function agentCards(fund: (ctx: ScenarioCtx, token: string) => Promise<string | undefined> = payInvoiceByCard): Scenario {
  return {
    id: 'agent-cards',
    owner: 'talyvor-lens',
    own: true,
    agents: 1,
    feature: 'Agent Wallets',
    items: ['B46.20'],
    title: "an agent's single-use cards: its key asks for three capped cards to book a trip; one approval issues all three, each locked to " +
      'its merchant, capped and closing within 24 hours, with one card_hold of the total; approved again it holds nothing twice',
    run: async (ctx) => {
      const { lens } = ctx.env
      const user = ctx.app.user
      const call = async <T>(method: string, path: string, body: object | undefined, note: string): Promise<Answered<T>> => {
        const got = await lens.act<T>(user, method, path, body)
        ctx.evidence.push({ note, answer: said(got) })
        return got
      }

      const terms = await call<{ terms: { capability: string; version: number; accepted?: unknown }[] | null }>('GET', '/v1/workspaces/{ws}/terms', undefined, 'the owner reads the terms')
      if (!terms.ok) return fail(`reading the workspace's terms answered ${said(terms)}`)
      for (const t of (terms.value.terms ?? []).filter((x) => CAPABILITIES.includes(x.capability) && x.accepted == null)) {
        const ok = await call('POST', `/v1/workspaces/{ws}/terms/${t.capability}/accept`, { version: t.version }, `the owner accepts ${t.capability}'s terms`)
        if (ok.status !== 201) return fail(`accepting ${t.capability}'s terms answered ${said(ok)}`)
      }
      const company = await call<Account>('POST', '/v1/money/accounts', { currency: 'GBP' }, "the owner opens the company's GBP account")
      if (company.status !== 201 || !company.ok) return fail(`opening the company's GBP account must answer 201; Lens answered ${said(company)}`)

      // The agent's GBP account, funded by card.
      const agent = await lens.createAgent(user, `Trip booker ${RUN_SALT}`)
      const opened = await call<Account>('POST', '/v1/money/accounts', { currency: 'GBP', agent_id: agent.id }, `the owner opens ${agent.name}'s GBP account`)
      if (opened.status !== 201 || !opened.ok) return fail(`opening the agent's GBP account must answer 201; Lens answered ${said(opened)}`)
      const acct = opened.value.id
      const held = async (note: string): Promise<number> => {
        const accounts = await call<{ accounts: Account[] | null }>('GET', '/v1/money/accounts', undefined, `${note}: the accounts`)
        if (!accounts.ok) throw new Error(`reading the accounts ${note} answered ${said(accounts)}`)
        return (accounts.value.accounts ?? []).find((a) => a.id === acct)?.test_minor ?? -1
      }
      const invoice = await call<{ pay_url?: string }>('POST', '/v1/money/invoices', {
        account_id: acct, customer_name: `Trip funding ${RUN_SALT}`, lines: [{ description: 'Funding', quantity: 1, unit_amount_minor: FUND_MINOR, vat_rate_bps: 0 }],
        due_date: new Date(Date.now() + 30 * DAY_MS).toISOString().slice(0, 10), send: true,
      }, `the owner sends a ${FUND_MINOR} minor invoice from the agent's account, to fund it`)
      const token = /\/pay\/([A-Za-z0-9_-]+)/.exec(invoice.ok ? invoice.value.pay_url ?? '' : '')?.[1] ?? ''
      if (invoice.status !== 201 || token === '') return fail(`issuing the funding invoice answered ${said(invoice)}`)
      const unpaid = await fund(ctx, token)
      if (unpaid !== undefined) return fail(unpaid)

      const k = await lens.act<{ key: string; id: string }>(user, 'POST', `/v1/workspaces/{ws}/agents/${agent.id}/keys`, { name: 'trip-cards' })
      if (!k.ok) return fail(`issuing ${agent.name} a key was refused: ${said(k)}`)

      try {
        // 1. The agent's own key asks for three cards; they wait for one approval, and nothing moves.
        const asked = await lens.as(k.value.key, 'POST', '/v1/money/cards', { purpose: 'Book a trip', currency: 'GBP', cards: TRIP },
          { 'Idempotency-Key': `e2e-agent-cards-${randomBytes(3).toString('hex')}` })
        ctx.evidence.push({ note: `${agent.name}'s key asks for three cards to book a trip`, answer: `${asked.status} ${asked.text.slice(0, 600)}` })
        const batch = asked.status === 201 ? JSON.parse(asked.text) as Batch : undefined
        if (batch === undefined || batch.status !== 'awaiting_approval' || batch.cards?.length !== 3 || batch.total_minor !== TOTAL_MINOR) {
          return fail(`three cards capped at ${TOTAL_MINOR} minor together must answer 201 awaiting_approval; Lens answered ${asked.status} ${asked.text.slice(0, 300)}`)
        }
        const before = await held('before the approval')
        if (before !== FUND_MINOR) return fail(`the funding invoice was paid by card, but before approval the agent's GBP account holds ${before} minor, not ${FUND_MINOR}`)

        // 2. One approval issues all three, and holds their total once.
        const approved = await call<Batch>('POST', `/v1/money/cards/${batch.id}/approve`, {}, 'the owner approves the three cards once')
        if (approved.status !== 200 || !approved.ok || approved.value.status !== 'issued') return fail(`approving the cards must answer 200 issued; Lens answered ${said(approved)}`)
        const got = await call<Batch>('GET', `/v1/money/cards/${batch.id}`, undefined, 'the owner reads the cards')
        if (!got.ok) return fail(`reading the cards answered ${said(got)}`)
        const wrong: string[] = []
        const now = Date.now()
        for (const want of TRIP) {
          const c = (got.value.cards ?? []).find((x) => x.merchant === want.merchant)
          const expires = Date.parse(c?.expires_at ?? '')
          if (c === undefined || c.status !== 'active' || c.cap_minor !== want.cap_minor || c.currency !== 'GBP' || !(expires > now && expires <= now + DAY_MS)) {
            wrong.push(`the ${want.merchant} card must be active, locked to ${want.merchant}, capped at ${want.cap_minor} GBP and closing within 24 hours; Lens answered ${JSON.stringify(c)}`)
          }
        }
        if ((got.value.cards ?? []).length !== 3) wrong.push(`the batch must hold three cards; Lens lists ${got.value.cards?.length ?? 0}`)
        const after = await held('after the approval')
        if (after !== FUND_MINOR - TOTAL_MINOR) wrong.push(`one card_hold of ${TOTAL_MINOR} minor must leave the agent's account at ${FUND_MINOR - TOTAL_MINOR}; it went from ${FUND_MINOR} to ${after}`)

        // 3. Approved again: answered as it stands, nothing held twice.
        const again = await call<Batch>('POST', `/v1/money/cards/${batch.id}/approve`, {}, 'the owner approves the same cards again')
        if (again.status !== 200 || !again.ok || again.value.status !== 'issued') wrong.push(`approving again must answer the batch as it stands, 200 issued; Lens answered ${said(again)}`)
        const last = await held('after the second approval')
        if (last !== after) wrong.push(`approving the cards again held more: the agent's account went from ${after} to ${last} minor`)
        if (wrong.length > 0) return fail(wrong.join('; '))
        return {
          pass: true,
          detail: `${agent.name}'s key asked for batch ${batch.id}: ${TRIP.map((c) => `${c.merchant} ${c.cap_minor}`).join(', ')} GBP minor; one approval issued all three, ` +
            `active and closing within 24 hours, the agent's account ${FUND_MINOR} → ${after} minor (one card_hold of ${TOTAL_MINOR}); approved again it stayed at ${last}`,
        }
      } catch (e) {
        return fail((e as Error).message)
      }
    },
  }
}
