// B17.531 — an agent's single-use card asked for and approved in the app (B28.49, on Lens B28.323 and B46.10), once a run, on a
// workspace of its own. On Lens's API the owner gives an agent's GBP account £100.00 from the company's. In the app, on the
// agent's page, Settings → Its card: the owner asks for a single-use card For "Get to the client meeting", Merchant TfL Travel,
// Up to £45.00 in GBP. It reads Waiting for approval and nothing moves. The owner presses Approve: it reads Ready for one purchase
// and the ledger holds the £45.00 once, one card_hold of -4500 on the agent's statement. The issuer charges it £38.50, as the
// issuer makes it: approved, one card_charge giving back the £6.50 the purchase did not spend, and back on Its card the card reads
// Used · £38.50 spent. The issuer charges it again: declined, "it pays once", no second card_charge, and the account does not move.

import { randomBytes } from 'node:crypto'
import type { Locator, Page } from 'playwright'
import { fail } from './bank.ts'
import { RUN_SALT } from './oracles.ts'
import type { Scenario } from './scenarios.ts'
import { said as answered } from './routes.ts'
import { call, said } from './settings.ts'

const TIMEOUT_MS = 30_000
const FUND_MINOR = 10_000
const CAP_MINOR = 4_500
const SPEND_MINOR = 3_850
const MERCHANT = 'TfL Travel'
const PURPOSE = 'Get to the client meeting'
const CAPABILITIES = ['currency_accounts', 'payments_in', 'payments_out', 'agent_card']

interface Account { id: string; test_minor: number }
interface Statement { lines: { kind: string; amount_minor: number }[] | null }
interface Batch { id: string; agent_id: string; purpose: string; status: string; cards: { id: string; merchant: string; cap_minor: number; status: string }[] | null }

const pounds = (minor: number) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(minor / 100)
const words = async (l: Locator) => (await l.allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim()).join(' | ')

export function singleUseCardScreen(): Scenario {
  return {
    id: 'single-use-card-screen',
    owner: 'talyvor-suite',
    own: true,
    agents: 1,
    items: ['B28.49'],
    feature: 'Agent wallets',
    title: "an agent's single-use card asked for and approved on its Its card in the app: waiting it holds nothing; approved it is ready " +
      'for one purchase with one card_hold of its cap; its first purchase writes one card_charge and reads Used, its second is declined and moves nothing',
    run: async (ctx) => {
      const { lens } = ctx.env
      const user = ctx.app.user
      const key = () => `e2e-${randomBytes(8).toString('hex')}`
      const step = async <T>(method: string, path: string, body: unknown, note: string) => {
        const r = await call<T>(ctx, method, path, body)
        ctx.evidence.push({ note, answer: said(r) })
        return r
      }

      // 1. On Lens's API: the agent's GBP account holding £100.00, given from the company's.
      const terms = await step<{ terms: { capability: string; version: number; accepted?: unknown }[] | null }>('GET', '/v1/workspaces/{ws}/terms', undefined, 'the owner reads the terms')
      for (const t of (terms.value?.terms ?? []).filter((x) => CAPABILITIES.includes(x.capability) && x.accepted == null)) {
        const ok = await step('POST', `/v1/workspaces/{ws}/terms/${t.capability}/accept`, { version: t.version }, `the owner accepts ${t.capability}'s terms`)
        if (ok.status !== 201) return fail(`accepting ${t.capability}'s terms answered ${said(ok)}`)
      }
      const company = await step<Account>('POST', '/v1/money/accounts', { currency: 'GBP' }, "the company's GBP account")
      if (company.status !== 201 || company.value === undefined) return fail(`opening the company's GBP account answered ${said(company)}`)
      const topped = await step('POST', `/v1/money/accounts/${company.value.id}/test-money`, { amount_minor: FUND_MINOR, idempotency_key: key() }, `${pounds(FUND_MINOR)} into the company's account`)
      if (topped.status !== 201) return fail(`${pounds(FUND_MINOR)} into the company's account answered ${said(topped)}`)
      const agent = await lens.createAgent(user, `Commuter ${RUN_SALT}`)
      const opened = await step<Account>('POST', '/v1/money/accounts', { currency: 'GBP', agent_id: agent.id }, `${agent.name}'s GBP account`)
      if (opened.status !== 201 || opened.value === undefined) return fail(`opening ${agent.name}'s GBP account answered ${said(opened)}`)
      const acct = opened.value.id
      const given = await step('POST', `/v1/money/accounts/${acct}/funding`, { direction: 'to_agent', amount_minor: FUND_MINOR, idempotency_key: key() }, `${agent.name}'s account is given ${pounds(FUND_MINOR)}`)
      if (given.status !== 201) return fail(`giving ${agent.name}'s account ${pounds(FUND_MINOR)} answered ${said(given)}`)

      /** The agent's account as the ledger holds it: its balance and its card lines, by kind. */
      const ledger = async (when: string): Promise<{ balance: number; hold: number[]; charge: number[] }> => {
        const list = await step<{ accounts: Account[] | null }>('GET', '/v1/money/accounts', undefined, `the accounts ${when}`)
        const st = await step<Statement>('GET', `/v1/money/accounts/${acct}/statement`, undefined, `${agent.name}'s statement ${when}`)
        if (st.status !== 200) throw new Error(`${agent.name}'s statement ${when} answered ${said(st)}`)
        const of = (kind: string) => (st.value?.lines ?? []).filter((l) => l.kind === kind).map((l) => l.amount_minor)
        return { balance: (list.value?.accounts ?? []).find((a) => a.id === acct)?.test_minor ?? Number.NaN, hold: of('card_hold'), charge: of('card_charge') }
      }

      const page: Page = await ctx.app.tab(`/agents/${encodeURIComponent(agent.id)}`)
      /** The agent's page afresh, Settings → Its card: its single-use cards. */
      const itsCard = async (): Promise<Locator> => {
        await page.goto(new URL(`/agents/${encodeURIComponent(agent.id)}`, page.url()).toString())
        await page.getByTestId('agent-settings').getByRole('button', { name: 'Its card', exact: true }).click()
        const dialog = page.getByRole('dialog', { name: 'Its card', exact: true })
        const cards = dialog.getByTestId('single-use-cards')
        await cards.waitFor({ timeout: TIMEOUT_MS })
        return cards
      }
      try {
        // 2. In the app: Its card → ask for a single-use card. It waits for approval, and nothing moves.
        const before = await ledger('before the card was asked for')
        if (before.balance !== FUND_MINOR) return fail(`${agent.name}'s account must hold ${FUND_MINOR} minor before any card; it holds ${before.balance}`)
        let cards = await itsCard()
        const ask = cards.getByTestId('single-use-ask')
        await ask.getByLabel('For', { exact: true }).fill(PURPOSE)
        await ask.getByLabel('Merchant', { exact: true }).fill(MERCHANT)
        await ask.getByLabel('Up to', { exact: true }).fill((CAP_MINOR / 100).toFixed(2))
        await ask.getByLabel('Currency', { exact: true }).selectOption('GBP')
        await ask.getByRole('button', { name: 'Ask for a single-use card', exact: true }).click()
        const batch = cards.getByTestId('single-use-batch').filter({ hasText: PURPOSE })
        const card = batch.getByTestId('single-use-card').filter({ hasText: MERCHANT })
        const waiting = await card.filter({ hasText: 'Waiting for approval' }).waitFor({ timeout: TIMEOUT_MS }).then(() => true, () => false)
        ctx.evidence.push({ note: 'the card once it was asked for', answer: await words(cards.getByTestId('single-use-card')) })
        if (!waiting) {
          const refused = await words(ask.getByRole('alert'))
          return fail(`asked for on Its card, a ${MERCHANT} card up to ${pounds(CAP_MINOR)} must read Waiting for approval; the cards read "${await words(cards.getByTestId('single-use-card'))}"${refused ? `, the form "${refused}"` : ''}`)
        }
        const listed = await step<{ batches: Batch[] | null }>('GET', '/v1/money/cards', undefined, "Lens's single-use cards once asked for in the app")
        const mine = (listed.value?.batches ?? []).filter((b) => b.agent_id === agent.id)
        const asked = mine[0]
        if (mine.length !== 1 || asked.status !== 'awaiting_approval' || asked.purpose !== PURPOSE || asked.cards?.length !== 1 ||
          asked.cards[0].merchant !== MERCHANT || asked.cards[0].cap_minor !== CAP_MINOR) {
          return fail(`asked for in the app, Lens must hold ${agent.name}'s one batch "${PURPOSE}", awaiting approval, one ${MERCHANT} card capped at ${CAP_MINOR}; it lists ${JSON.stringify(mine)}`)
        }
        const waited = await ledger('while the card waits for approval')
        if (waited.balance !== before.balance || waited.hold.length !== 0) {
          return fail(`a card waiting for approval must hold nothing: ${agent.name}'s account went from ${before.balance} to ${waited.balance} minor, with card_hold ${JSON.stringify(waited.hold)}`)
        }

        // 3. Approve: ready for one purchase, and its cap held once.
        await batch.getByRole('button', { name: 'Approve', exact: true }).click()
        const ready = await card.filter({ hasText: 'Ready for one purchase' }).waitFor({ timeout: TIMEOUT_MS }).then(() => true, () => false)
        ctx.evidence.push({ note: 'the card once it was approved', answer: await words(card) })
        if (!ready) return fail(`approved on Its card, the ${MERCHANT} card must read Ready for one purchase; it reads "${await words(card)}", ${await words(batch.getByRole('alert')) || 'no refusal'}`)
        const held = await ledger('after the approval')
        if (held.balance !== before.balance - CAP_MINOR || held.hold.join() !== String(-CAP_MINOR)) {
          return fail(`approved, the card's ${CAP_MINOR} minor cap must be held once (one card_hold of ${-CAP_MINOR}): ${agent.name}'s account went from ${before.balance} to ${held.balance} minor, with card_hold ${JSON.stringify(held.hold)}`)
        }

        // 4. The issuer's first charge: approved, one card_charge giving back what it did not spend, and the card reads Used.
        const got = await step<Batch>('GET', `/v1/money/cards/${asked.id}`, undefined, "Lens's card once approved")
        const cardID = got.value?.cards?.find((c) => c.merchant === MERCHANT)?.id ?? ''
        if (got.value?.status !== 'issued' || cardID === '') return fail(`approved in the app, Lens must have issued the ${MERCHANT} card; it answered ${said(got)}`)
        const charge = async (note: string) => {
          const c = await lens.chargeTestCard(user, cardID, { merchant: MERCHANT, amount_minor: SPEND_MINOR })
          ctx.evidence.push({ note, answer: answered(c) })
          return c
        }
        const first = await charge(`the issuer charges ${pounds(SPEND_MINOR)} at ${MERCHANT}`)
        if (!first.ok || !first.value.approved) return fail(`a ${pounds(SPEND_MINOR)} purchase on the card up to ${pounds(CAP_MINOR)} must be approved; Lens answered ${answered(first)}`)
        const spent = await ledger('after the first purchase')
        if (spent.balance !== held.balance + CAP_MINOR - SPEND_MINOR || spent.charge.join() !== String(CAP_MINOR - SPEND_MINOR)) {
          return fail(`the first purchase must write one card_charge giving back the ${CAP_MINOR - SPEND_MINOR} minor it did not spend: ${agent.name}'s account went from ${held.balance} to ${spent.balance} minor, with card_charge ${JSON.stringify(spent.charge)}`)
        }
        cards = await itsCard()
        const usedWords = `Used · ${pounds(SPEND_MINOR)} spent`
        const used = await cards.getByTestId('single-use-card').filter({ hasText: MERCHANT }).filter({ hasText: usedWords }).waitFor({ timeout: TIMEOUT_MS }).then(() => true, () => false)
        ctx.evidence.push({ note: 'the card after its purchase', answer: await words(cards.getByTestId('single-use-card')) })
        if (!used) return fail(`after its purchase, the ${MERCHANT} card on Its card must read "${usedWords}"; it reads "${await words(cards.getByTestId('single-use-card'))}"`)

        // 5. The issuer's second charge: declined, and nothing moves.
        const second = await charge(`the issuer charges ${pounds(SPEND_MINOR)} at ${MERCHANT} again`)
        const end = await ledger('after the second purchase')
        const wrong: string[] = []
        if (!second.ok || second.value.approved || !/pays once/.test(second.value.reason)) wrong.push(`a second purchase on a single-use card must be declined "it pays once"; Lens answered ${answered(second)}`)
        if (end.charge.length !== 1) wrong.push(`a declined second purchase must write no card_charge: ${agent.name}'s statement has ${end.charge.length} (${JSON.stringify(end.charge)})`)
        if (end.balance !== spent.balance) wrong.push(`a declined second purchase must move nothing: ${agent.name}'s account went from ${spent.balance} to ${end.balance} minor`)
        if (wrong.length > 0) return fail(wrong.join('; '))
        return {
          pass: true,
          detail: `asked for on ${agent.name}'s Its card, the ${MERCHANT} card up to ${pounds(CAP_MINOR)} waited and held nothing (${before.balance} minor); approved it read Ready ` +
            `for one purchase, the account ${before.balance} → ${held.balance} (one card_hold of ${-CAP_MINOR}); its ${pounds(SPEND_MINOR)} purchase wrote one card_charge, ` +
            `the account ${held.balance} → ${spent.balance}, and it read "${usedWords}"; charged again it was declined and stayed at ${end.balance}`,
        }
      } catch (e) {
        return fail((e as Error).message.split('\n')[0])
      } finally {
        await page.close()
      }
    },
  }
}
