// B17.506 — a card payment disputed from its statement line in the app (B28.60, on Lens B28.333), once a run, on a workspace of
// its own. On Lens's API the owner gives an agent's GBP account £500.00 from the company's, the agent's key asks for one card
// capped at £200.00 at British Airways, the owner approves it and the issuer charges it £180.00. In the app, on Statements, the
// agent's statement has the charge as a Card payment line; the owner presses Dispute this payment on it, says why and sends
// it: the line reads With the card issuer, Lens holds the payment's one dispute, with the issuer, of £180.00 with that reason,
// and nothing moves. The Sandbox decides it won, as the issuer would. Back on Statements the charge's line reads Dispute won ·
// £180.00 back and the paper has one Dispute won line of +£180.00; on the ledger the agent's account is up by exactly the
// £180.00, once: one card_dispute_won of 18000 on its statement, and the app's disputes list it won, 18000 credited.

import { randomBytes } from 'node:crypto'
import type { Page } from 'playwright'
import { fail } from './bank.ts'
import { RUN_SALT } from './oracles.ts'
import type { Scenario } from './scenarios.ts'
import { call, said } from './settings.ts'

const TIMEOUT_MS = 30_000
const FUND_MINOR = 50_000
const CAP_MINOR = 20_000
const SPEND_MINOR = 18_000
const MERCHANT = 'British Airways'
const REASON = 'The flight was cancelled and the airline has not refunded it'
const CAPABILITIES = ['currency_accounts', 'payments_in', 'payments_out', 'agent_card']

interface Account { id: string; test_minor: number }
interface Batch { id: string; status: string; cards: { id: string; merchant: string }[] | null }
interface Dispute { id: string; payment_id: string; agent_id?: string; amount_minor: number; currency: string; reason: string; status: string; credited_minor: number }
interface Statement { lines: { kind: string; amount_minor: number; partner_ref?: string }[] | null }

const pounds = (minor: number) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(minor / 100)

/** A GET the page's own script makes through the BFF, as JSON: the status and the body. */
async function fromApp<T>(page: Page, path: string): Promise<{ status: number; value?: T; text: string }> {
  const r = await page.evaluate(async (p) => {
    const res = await fetch(p, { credentials: 'same-origin' })
    return { status: res.status, text: await res.text() }
  }, path)
  try {
    return { ...r, value: JSON.parse(r.text) as T }
  } catch {
    return r
  }
}

export function cardDisputeScreen(): Scenario {
  return {
    id: 'card-dispute-screen',
    owner: 'talyvor-suite',
    own: true,
    agents: 1,
    items: ['B28.60'],
    feature: 'Agent wallets',
    title: "a card payment disputed from its line on the agent's statement in the app: sent with a reason it is with the card issuer and " +
      'nothing moves; won, the line reads Dispute won · £180.00 back and the agent\'s account gets exactly the £180.00 back, one card_dispute_won',
    run: async (ctx) => {
      const { lens } = ctx.env
      const user = ctx.app.user
      const key = () => `e2e-${randomBytes(8).toString('hex')}`
      const step = async <T>(method: string, path: string, body: unknown, note: string) => {
        const r = await call<T>(ctx, method, path, body)
        ctx.evidence.push({ note, answer: said(r) })
        return r
      }

      // 1. On Lens's API: the agent's GBP account holding £500.00, one card for British Airways, approved and charged £180.00.
      const terms = await step<{ terms: { capability: string; version: number; accepted?: unknown }[] | null }>('GET', '/v1/workspaces/{ws}/terms', undefined, 'the owner reads the terms')
      for (const t of (terms.value?.terms ?? []).filter((x) => CAPABILITIES.includes(x.capability) && x.accepted == null)) {
        const ok = await step('POST', `/v1/workspaces/{ws}/terms/${t.capability}/accept`, { version: t.version }, `the owner accepts ${t.capability}'s terms`)
        if (ok.status !== 201) return fail(`accepting ${t.capability}'s terms answered ${said(ok)}`)
      }
      const company = await step<Account>('POST', '/v1/money/accounts', { currency: 'GBP' }, "the company's GBP account")
      if (company.status !== 201 || company.value === undefined) return fail(`opening the company's GBP account answered ${said(company)}`)
      const topped = await step('POST', `/v1/money/accounts/${company.value.id}/test-money`, { amount_minor: FUND_MINOR, idempotency_key: key() }, `${pounds(FUND_MINOR)} into the company's account`)
      if (topped.status !== 201) return fail(`${pounds(FUND_MINOR)} into the company's account answered ${said(topped)}`)
      const agent = await lens.createAgent(user, `Flight booker ${RUN_SALT}`)
      const opened = await step<Account>('POST', '/v1/money/accounts', { currency: 'GBP', agent_id: agent.id }, `${agent.name}'s GBP account`)
      if (opened.status !== 201 || opened.value === undefined) return fail(`opening ${agent.name}'s GBP account answered ${said(opened)}`)
      const acct = opened.value.id
      const given = await step('POST', `/v1/money/accounts/${acct}/funding`, { direction: 'to_agent', amount_minor: FUND_MINOR, idempotency_key: key() }, `${agent.name}'s account is given ${pounds(FUND_MINOR)}`)
      if (given.status !== 201) return fail(`giving ${agent.name}'s account ${pounds(FUND_MINOR)} answered ${said(given)}`)
      const k = await lens.act<{ key: string }>(user, 'POST', `/v1/workspaces/{ws}/agents/${agent.id}/keys`, { name: 'flight-card' })
      if (!k.ok) return fail(`issuing ${agent.name} a key was refused: ${k.status} ${k.error}`)
      const asked = await lens.as(k.value.key, 'POST', '/v1/money/cards', { purpose: 'Book a flight', currency: 'GBP', cards: [{ merchant: MERCHANT, cap_minor: CAP_MINOR }] },
        { 'Idempotency-Key': key() })
      ctx.evidence.push({ note: `${agent.name}'s key asks for a card for ${MERCHANT}`, answer: `${asked.status} ${asked.text.slice(0, 300)}` })
      const batch = asked.status === 201 ? JSON.parse(asked.text) as Batch : undefined
      if (batch === undefined) return fail(`a card capped at ${pounds(CAP_MINOR)} must answer 201; Lens answered ${asked.status} ${asked.text.slice(0, 200)}`)
      const approved = await step<Batch>('POST', `/v1/money/cards/${batch.id}/approve`, {}, 'the owner approves the card')
      const card = (approved.value?.cards ?? []).find((c) => c.merchant === MERCHANT)
      if (approved.status !== 200 || approved.value?.status !== 'issued' || card === undefined) return fail(`approving the card must answer 200 issued; Lens answered ${said(approved)}`)
      const charged = await lens.chargeTestCard(user, card.id, { merchant: MERCHANT, amount_minor: SPEND_MINOR })
      ctx.evidence.push({ note: `the issuer charges ${pounds(SPEND_MINOR)} at ${MERCHANT}`, answer: charged.ok ? JSON.stringify(charged.value) : `${charged.status} ${charged.error}` })
      if (!charged.ok || !charged.value.approved) return fail(`a ${pounds(SPEND_MINOR)} charge on the card capped at ${pounds(CAP_MINOR)} must be approved; Lens answered ${charged.ok ? JSON.stringify(charged.value) : charged.error}`)
      const payment = charged.value.authorization_id

      /** The agent's account as the ledger holds it, and its card_dispute_won lines. */
      const ledger = async (when: string): Promise<{ balance: number; won: number[] }> => {
        const list = await step<{ accounts: Account[] | null }>('GET', '/v1/money/accounts', undefined, `the accounts ${when}`)
        const st = await step<Statement>('GET', `/v1/money/accounts/${acct}/statement`, undefined, `${agent.name}'s statement ${when}`)
        if (st.status !== 200) throw new Error(`${agent.name}'s statement ${when} answered ${said(st)}`)
        return {
          balance: (list.value?.accounts ?? []).find((a) => a.id === acct)?.test_minor ?? Number.NaN,
          won: (st.value?.lines ?? []).filter((l) => l.kind === 'card_dispute_won').map((l) => l.amount_minor),
        }
      }

      const page = await ctx.app.tab(`/statements?wallet=${acct}`)
      try {
        // 2. In the app: Dispute this payment on the charge's line, with a reason; it is with the card issuer, and nothing moves.
        const before = await ledger('before the dispute')
        const dispute = page.getByRole('button', { name: 'Dispute this payment', exact: true })
        if (!(await dispute.waitFor({ timeout: TIMEOUT_MS }).then(() => true, () => false))) {
          return fail(`${agent.name}'s statement in the app must offer Dispute this payment on its ${pounds(SPEND_MINOR)} card payment at ${MERCHANT}; it does not`)
        }
        if ((await dispute.count()) !== 1) return fail(`the statement has one card payment, so one Dispute this payment; it shows ${await dispute.count()}`)
        await dispute.click()
        const dialog = page.getByRole('dialog', { name: 'Dispute this payment' })
        await dialog.getByLabel('Why are you disputing it?').fill(REASON)
        await dialog.getByRole('button', { name: 'Send dispute', exact: true }).click()
        const state = page.getByTestId('dispute-state')
        const withIssuer = await state.filter({ hasText: 'With the card issuer' }).waitFor({ timeout: TIMEOUT_MS }).then(() => true, () => false)
        ctx.evidence.push({ note: 'the charge\'s line once the dispute is sent', answer: (await state.allTextContents()).join(' | ') })
        if (!withIssuer) return fail(`sent, the charge's line must read With the card issuer; it reads "${(await state.allTextContents()).join(' | ')}"`)
        const listed = await step<{ card_disputes: Dispute[] | null }>('GET', '/v1/money/card-disputes', undefined, "Lens's disputes once it was sent")
        const mine = (listed.value?.card_disputes ?? []).filter((d) => d.payment_id === payment)
        const d = mine[0]
        if (mine.length !== 1 || d.status !== 'with_issuer' || d.amount_minor !== SPEND_MINOR || d.currency !== 'GBP' || d.agent_id !== agent.id || d.reason !== REASON) {
          return fail(`sent from the app, Lens must hold the payment's one dispute, with the issuer, of ${SPEND_MINOR} GBP with its reason; it lists ${JSON.stringify(mine)}`)
        }
        const sent = await ledger('after the dispute was sent')
        if (sent.balance !== before.balance || sent.won.length !== 0) {
          return fail(`a dispute the issuer has not decided must move nothing: the agent's account went from ${before.balance} to ${sent.balance} minor, with card_dispute_won ${JSON.stringify(sent.won)}`)
        }

        // 3. The Sandbox decides it won, as the issuer would.
        const won = await step<Dispute>('POST', `/v1/money/card-disputes/${d.id}/sandbox-outcome`, { won: true }, 'the Sandbox decides the dispute won, as the issuer would')
        if (won.status !== 200 || won.value?.status !== 'won') return fail(`the Sandbox's won outcome must answer 200 won; Lens answered ${said(won)}`)

        // 4. Back on Statements: the charge's line reads Dispute won · £180.00 back, and the paper has one Dispute won line.
        await page.reload()
        const back = `Dispute won · ${pounds(SPEND_MINOR)} back`
        const shownWon = await state.filter({ hasText: back }).waitFor({ timeout: TIMEOUT_MS }).then(() => true, () => false)
        ctx.evidence.push({ note: "the charge's line once the dispute was won", answer: (await state.allTextContents()).join(' | ') })
        if (!shownWon) return fail(`won, the charge's line must read "${back}"; it reads "${(await state.allTextContents()).join(' | ')}"`)
        const wonLines = page.getByRole('row').filter({ has: page.locator('[data-testid="account-statement-what"], [data-testid="account-statement-detail"]', { hasText: 'Dispute won' }) })
        const rows = await wonLines.allTextContents()
        ctx.evidence.push({ note: 'the Dispute won lines on the paper', answer: rows.join(' | ') })
        if (rows.length !== 1 || !rows[0].includes(pounds(SPEND_MINOR))) {
          return fail(`won, the agent's statement must have one Dispute won line of ${pounds(SPEND_MINOR)}; it has ${rows.length}: ${rows.join(' | ')}`)
        }

        // 5. On the ledger: exactly the £180.00 back, once; and the app's disputes list it won.
        const after = await ledger('after the dispute was won')
        if (after.balance !== sent.balance + SPEND_MINOR || after.won.join() !== String(SPEND_MINOR)) {
          return fail(`a won dispute must credit the agent's account the ${SPEND_MINOR} minor charge once (one card_dispute_won): it went from ${sent.balance} to ${after.balance} minor, with card_dispute_won ${JSON.stringify(after.won)}`)
        }
        const inApp = await fromApp<{ card_disputes: Dispute[] | null }>(page, '/api/money/card-disputes')
        ctx.evidence.push({ note: "the app's disputes", answer: `${inApp.status} ${inApp.text.slice(0, 400)}` })
        const appMine = (inApp.value?.card_disputes ?? []).filter((x) => x.payment_id === payment)
        if (inApp.status !== 200 || appMine.length !== 1 || appMine[0].status !== 'won' || appMine[0].credited_minor !== SPEND_MINOR) {
          return fail(`the app's disputes must list the payment's one dispute, won, ${SPEND_MINOR} credited; it answered ${inApp.status} ${JSON.stringify(appMine)}`)
        }
        return {
          pass: true,
          detail: `disputed in the app from its line on ${agent.name}'s statement, the ${pounds(SPEND_MINOR)} ${MERCHANT} charge was with the card issuer and the account stayed at ` +
            `${sent.balance}; won, the line read "${back}", the paper one Dispute won line, and the account ${sent.balance} → ${after.balance} minor, one card_dispute_won of ${SPEND_MINOR}`,
        }
      } catch (e) {
        return fail((e as Error).message.split('\n')[0])
      } finally {
        await page.close()
      }
    },
  }
}
