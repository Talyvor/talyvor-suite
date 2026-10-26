// B45.34 — a payment prepared in Chat is B45.2's card right under the answer, with all five things a person decides on: the
// payee, the amount, why (its reference), the rule that asked for approval, and Approve / Decline. Once a run, on a workspace
// of its own: the owner saves a payee and signs a mandate letting Chat pay it up to £100 a payment (as payment-request-batch
// does), so £120 asks for approval under limits.per_payment. Then, in Chat, the model's answer calls prepare_payment for £120 —
// the browser makes that answer up, so no model is asked and nothing is charged, but the call goes through the BFF to Lens and
// prepares a real request. The card must show all five, and before anything is approved the ledger must hold no payment to the
// payee, the GBP account nothing, and the request no paid item. Decline must then turn the card into "Declined. Nothing was paid".

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Response } from 'playwright'
import { fail } from './bank.ts'
import { madeUp } from './injection.ts'
import { RUN_SALT } from './oracles.ts'
import { softPasskey } from './payees.ts'
import type { Scenario, Verdict } from './scenarios.ts'
import { call, said } from './settings.ts'

const TIMEOUT_MS = 30_000
const AMOUNT_MINOR = 12_000
const AMOUNT = '£120.00'
const RULE = 'limits.per_payment'

/** What the card in the conversation showed, and what Lens held before and after Decline. */
export interface CardSeen {
  /** Why no card was read, when none was. */
  why?: string
  card: { payee: boolean; amount: boolean; reference: boolean; rule: boolean; approve: boolean; decline: boolean }
  text: string
  /** Before approval: payments to the payee, the GBP account's test and live minor units, the request's items with a payment. */
  payments: number
  accountMinor: number
  paidItems: number
  /** After Decline: the card's line, and payments to the payee. */
  declined: string
  paymentsAfter: number
}

const FIELDS: [keyof CardSeen['card'], string][] = [
  ['payee', 'the payee'],
  ['amount', `the amount ${AMOUNT}`],
  ['reference', 'why (its reference)'],
  ['rule', `the rule that asked for approval (${RULE})`],
  ['approve', 'Approve'],
  ['decline', 'Decline'],
]

export function paymentCardVerdict(seen: CardSeen): Verdict {
  if (seen.why !== undefined) return fail(`no payment card was read in Chat: ${seen.why}`)
  const missing = FIELDS.filter(([k]) => !seen.card[k]).map(([, name]) => name)
  const wrong: string[] = []
  if (missing.length > 0) wrong.push(`the card in the conversation does not show ${missing.join(', ')}; it reads "${seen.text.slice(0, 300)}"`)
  const unread = (n: number, what: string, held: string) => { if (n < 0) wrong.push(`${what} could not be read before approval`); else if (n !== 0) wrong.push(`before approval ${held.replace('#', String(n))}`) }
  unread(seen.payments, 'the payments out', 'the ledger holds # payment(s) to the payee')
  unread(seen.accountMinor, 'the GBP account', 'the GBP account holds # minor units')
  unread(seen.paidItems, 'the prepared request', '# of the request\'s items carry a payment')
  if (!seen.declined.startsWith('Declined. Nothing was paid')) wrong.push(`Decline left the card reading "${seen.declined}"`)
  if (seen.paymentsAfter !== 0) wrong.push(seen.paymentsAfter < 0 ? 'the payments out could not be read after Decline' : `after Decline the ledger holds ${seen.paymentsAfter} payment(s) to the payee`)
  if (wrong.length > 0) return fail(wrong.join('; '))
  return { pass: true, detail: `Chat's prepared payment showed the payee, ${AMOUNT}, its reference, the rule (${RULE}), Approve and Decline; ` +
    'before approval no payment, an empty GBP account and no paid item; declined, "Declined. Nothing was paid" and still no payment' }
}

export function chatPaymentCard(): Scenario {
  return {
    id: 'chat-payment-card',
    owner: 'talyvor-suite',
    own: true,
    items: ['B45.2', 'B45.34'],
    feature: 'Chat',
    title: 'a payment Chat prepares shows its card under the answer with the payee, amount, reference, the rule that asked and Approve / Decline; ' +
      'nothing is on the ledger before approval, and Decline pays nothing',
    run: async (ctx) => {
      const { app, env } = ctx
      const step = async <T>(method: string, path: string, body: unknown, note: string) => {
        const r = await call<T>(ctx, method, path, body)
        ctx.evidence.push({ note, answer: said(r) })
        return r
      }

      // The money terms (as batch-approval-pays-once accepts them), an account, a payee, and a mandate letting Chat pay the
      // payee up to £100 a payment, so £120 asks for approval.
      const terms0 = await step<{ terms: { capability: string; version: number; accepted?: unknown }[] | null }>('GET', '/v1/workspaces/{ws}/terms', undefined, 'the owner reads the terms')
      if (terms0.value === undefined || terms0.status >= 300) return fail(`reading the workspace's terms answered ${said(terms0)}`)
      for (const t of (terms0.value.terms ?? []).filter((x) => ['currency_accounts', 'payments_out'].includes(x.capability) && x.accepted == null)) {
        const accepted = await step('POST', `/v1/workspaces/{ws}/terms/${t.capability}/accept`, { version: t.version }, `the owner accepts ${t.capability}'s terms`)
        if (accepted.status !== 201) return fail(`accepting ${t.capability}'s terms answered ${said(accepted)}`)
      }
      const opened = await step<{ id: string }>('POST', '/v1/money/accounts', { currency: 'GBP' }, 'the owner opens a GBP account on test money')
      if (opened.status !== 201 || opened.value === undefined) return fail(`opening a GBP account must answer 201; Lens answered ${said(opened)}`)
      const payee = `Nightly Chat Card Joinery ${RUN_SALT}`
      const saved = await step<{ id: string }>('POST', '/v1/money/payees', { name: payee, country: 'GB', sort_code: '040004', account_number: '24681359' }, 'the owner saves a payee')
      if (saved.status !== 201 || saved.value === undefined) return fail(`saving a payee must answer 201; Lens answered ${said(saved)}`)
      const payeeID = saved.value.id
      const reg = await step<{ challenge: string; rp_id: string }>('POST', '/v1/workspaces/{ws}/agents/passkeys/challenge', {}, 'the owner asks to register a passkey')
      if (reg.value === undefined || reg.status >= 300) return fail(`the passkey registration challenge was refused: ${said(reg)}`)
      const key = softPasskey(reg.value.rp_id)
      const registered = await step('POST', '/v1/workspaces/{ws}/agents/passkeys', key.register(reg.value.challenge, 'Nightly chat card passkey'), 'the owner registers a passkey')
      if (registered.status !== 201) return fail(`registering a passkey must answer 201; Lens answered ${said(registered)}`)
      const terms = await step<{ canonical: string; challenge: string }>('POST', '/v1/money/permission-mandates/prepare', {
        principal: { type: 'person', name: 'Nightly Person' }, clients: ['chat'], scope: { payees: [payeeID], currencies: ['GBP'] },
        limits: { per_payment: { GBP: 10_000 } }, new_payee: { policy: 'confirmation_of_payee' }, expires_at: new Date(Date.now() + 24 * 3600_000).toISOString(),
      }, 'the owner prepares a mandate: Chat may pay the payee up to £100 a payment')
      if (terms.value === undefined || terms.status >= 300) return fail(`preparing the mandate must answer 200; Lens answered ${said(terms)}`)
      const signed = await step<{ status: string }>('POST', '/v1/money/permission-mandates',
        { canonical: terms.value.canonical, assertion: key.assert(terms.value.challenge) }, 'the owner signs the mandate with the passkey')
      if (signed.status !== 201 || signed.value?.status !== 'active') return fail(`the signed mandate must answer 201 active; Lens answered ${said(signed)}`)

      // Chat offers tools only to OpenAI and Anthropic models; the answer is made up in that provider's shape.
      const page = app.page
      if (!['anthropic', 'openai'].includes(env.catalog.find((m) => m.display_name === app.modelNameInUse)?.provider ?? '')) {
        const judge = env.catalog.find((m) => m.id === env.judgeModel)
        if (judge === undefined || !(await app.chooseModel(judge.display_name))) return fail(`Chat offers tools only to OpenAI and Anthropic models, and neither ${app.modelNameInUse} nor the judge model could be chosen`)
      }
      const provider = env.catalog.find((m) => m.display_name === app.modelNameInUse)?.provider ?? 'anthropic'
      const reference = `Nightly chat card ${RUN_SALT}`
      const seen: CardSeen = { card: { payee: false, amount: false, reference: false, rule: false, approve: false, decline: false }, text: '', payments: -1, accountMinor: -1, paidItems: -1, declined: '', paymentsAfter: -1 }
      const paymentsToPayee = async (note: string) => {
        const r = await step<{ payments: { payee_id: string }[] | null }>('GET', '/v1/money/payments', undefined, note)
        return r.value === undefined || r.status >= 300 ? -1 : (r.value.payments ?? []).filter((p) => p.payee_id === payeeID).length
      }

      await app.newChat()
      // The request Chat's prepare_payment call made: its id is in what the BFF answered the browser.
      let requestID = ''
      let toolAnswer = 'none'
      const onToolAnswer = async (r: Response) => {
        if (!r.url().endsWith('/api/chat/tools/call')) return
        const text = await r.text().catch(() => '')
        toolAnswer = `${r.status()} ${text.slice(0, 200)}`
        try {
          requestID ||= (JSON.parse((JSON.parse(text) as { text?: string }).text ?? '') as { id?: string }).id ?? ''
        } catch { /* not a prepared request */ }
      }
      page.on('response', onToolAnswer)
      let asked = 0
      await page.route('**/api/ai/stream/**', async (route) => {
        asked++
        const body = asked === 1
          ? madeUp(provider, [{ name: 'prepare_payment', args: { payee_id: payeeID, currency: 'GBP', amount_minor: AMOUNT_MINOR, reference } }], '')
          : madeUp(provider, [], `I have prepared ${AMOUNT} to ${payee}. Approve it below, or decline it.`)
        await route.fulfill({ status: 200, contentType: 'text/event-stream', body })
      })
      try {
        // Not "pay …", which Chat answers itself (PayCommand); this goes to the model.
        await page.locator('#chat-message').fill(`Please settle the joinery invoice ${reference}.`)
        await page.locator('#chat-message').press('Enter')
        const card = page.locator('[data-testid="turn-assistant"]').last().getByTestId('approve-card')
        try {
          await card.waitFor({ timeout: TIMEOUT_MS })
        } catch (e) {
          seen.why = `${(e as Error).message.split('\n')[0]}; the model was asked ${asked} time(s), the tool call answered ${toolAnswer}, and the answer reads "${((await page.locator('[data-testid="turn-assistant"]').last().textContent().catch(() => '')) ?? '').slice(0, 300)}"`
          return paymentCardVerdict(seen)
        }
        seen.text = ((await card.textContent()) ?? '').replace(/\s+/g, ' ').trim()
        const rule = /Asks for approval: .+\(([^)]+)\)/.exec(seen.text)
        seen.card = {
          payee: seen.text.includes(payee),
          amount: seen.text.includes(AMOUNT),
          reference: seen.text.includes(`Reference: ${reference}`),
          rule: rule?.[1] === RULE,
          approve: await card.getByRole('button', { name: 'Approve 1 payment with a passkey' }).isVisible(),
          decline: await card.getByRole('button', { name: 'Decline', exact: true }).isVisible(),
        }
        ctx.evidence.push({ note: 'the card under the answer', answer: seen.text })
        const { dir, link } = env.shots
        await mkdir(dir, { recursive: true })
        const file = `chat-payment-card-user${app.user.index}.png`
        await card.screenshot({ path: join(dir, file) }).catch(() => undefined)
        ctx.evidence.push({ note: 'the prepared payment’s card in Chat', shot: `${link}/${file}` })

        // Before approval: no payment, nothing in the account, no paid item.
        seen.payments = await paymentsToPayee('the payments out before approval')
        const accounts = await step<{ accounts: { id: string; test_minor: number; live_minor: number }[] | null }>('GET', '/v1/money/accounts', undefined, 'the accounts before approval')
        const gbp = (accounts.value?.accounts ?? []).find((a) => a.id === opened.value?.id)
        seen.accountMinor = gbp === undefined ? -1 : gbp.test_minor + gbp.live_minor
        const read = requestID === '' ? undefined : await step<{ items: { payment_id?: string; pay_status?: string }[] | null }>('GET', `/v1/money/payment-requests/${requestID}`, undefined, 'the prepared request before approval')
        seen.paidItems = read?.value === undefined || read.status >= 300 ? -1 : (read.value.items ?? []).filter((it) => (it.payment_id ?? '') !== '' || (it.pay_status ?? '') !== '').length

        await card.getByRole('button', { name: 'Decline', exact: true }).click()
        const receipt = page.locator('[data-testid="turn-assistant"]').last().getByTestId('chat-pay-receipt')
        seen.declined = await receipt.waitFor({ timeout: TIMEOUT_MS }).then(async () => ((await receipt.textContent()) ?? '').trim(), () => '')
        ctx.evidence.push({ note: 'the card after Decline', answer: seen.declined })
        seen.paymentsAfter = await paymentsToPayee('the payments out after Decline')
      } finally {
        page.off('response', onToolAnswer)
        await page.unroute('**/api/ai/stream/**').catch(() => undefined)
      }
      return paymentCardVerdict(seen)
    },
  }
}
