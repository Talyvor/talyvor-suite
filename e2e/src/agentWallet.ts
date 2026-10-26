// B46.9 — an agent's wallet in the app: its balance, how to add money and Send. Once a run, on a workspace of its own: the
// owner makes an agent and reads its wallet from Lens (B46.4); the agent's screen must show the same balance, and — while
// the sandbox serves the wallet — Lens's sentence and nothing to copy (a live partner's address or IBAN shows with Copy).
// Then Send prepares a payment to a saved payee: it must wait for one-tap approval under the wallet, with no payment on the
// ledger and no paid item before approval, and Decline must pay nothing.

import { fail } from './bank.ts'
import { RUN_SALT } from './oracles.ts'
import type { Scenario, Verdict } from './scenarios.ts'
import { call, said } from './settings.ts'

const TIMEOUT_MS = 30_000
const AMOUNT = '12.00'

/** What Lens held and the wallet card showed. */
export interface WalletSeen {
  why?: string
  /** Lens's wallet: the balance as the card writes it, TEST or LIVE, and what there is to pay into. */
  lens: { balance: string; mode: string; payInto: string }
  /** The card: its text, whether it offered anything to copy, and whether Send's approval card appeared. */
  text: string
  copy: boolean
  approval: boolean
  /** Before approval: payments to the payee and the request's paid items. After Decline: payments to the payee. */
  payments: number
  paidItems: number
  paymentsAfter: number
}

export function walletVerdict(seen: WalletSeen): Verdict {
  if (seen.why !== undefined) return fail(`the agent's wallet could not be read: ${seen.why}`)
  const wrong: string[] = []
  if (!seen.text.includes(seen.lens.balance)) wrong.push(`the card does not show Lens's balance ${seen.lens.balance}`)
  if (seen.lens.mode === 'LIVE') {
    if (!seen.text.includes(seen.lens.payInto)) wrong.push(`a live wallet's card does not show ${seen.lens.payInto}`)
    if (!seen.copy) wrong.push('a live wallet offers nothing to copy')
  } else {
    if (seen.copy) wrong.push('the sandbox wallet offers something to copy')
    if (seen.lens.payInto !== '' && seen.text.includes(seen.lens.payInto)) wrong.push(`the sandbox wallet shows its made-up ${seen.lens.payInto}`)
  }
  if (!seen.approval) wrong.push('Send did not wait for approval under the wallet')
  if (seen.payments !== 0) wrong.push(seen.payments < 0 ? 'the payments out could not be read before approval' : `before approval the ledger holds ${seen.payments} payment(s) to the payee`)
  if (seen.paidItems !== 0) wrong.push(seen.paidItems < 0 ? 'the prepared request could not be read' : `before approval ${seen.paidItems} of the request's items carry a payment`)
  if (seen.paymentsAfter !== 0) wrong.push(seen.paymentsAfter < 0 ? 'the payments out could not be read after Decline' : `after Decline the ledger holds ${seen.paymentsAfter} payment(s) to the payee`)
  if (wrong.length > 0) return fail(wrong.join('; '))
  return { pass: true, detail: `the wallet showed ${seen.lens.balance} (${seen.lens.mode}), ${seen.lens.mode === 'LIVE' ? 'its details with Copy' : 'nothing to copy'}; ` +
    'Send waited for approval with no payment on the ledger, and Decline paid nothing' }
}

export function agentWallet(): Scenario {
  return {
    id: 'agent-wallet',
    owner: 'talyvor-suite',
    own: true,
    items: ['B46.9'],
    feature: 'Agent wallets',
    title: 'an agent’s wallet shows Lens’s balance and how to add money (nothing to copy on the sandbox); Send waits for one-tap approval ' +
      'with nothing on the ledger, and Decline pays nothing',
    run: async (ctx) => {
      const step = async <T>(method: string, path: string, body: unknown, note: string) => {
        const r = await call<T>(ctx, method, path, body)
        ctx.evidence.push({ note, answer: said(r) })
        return r
      }
      const terms = await step<{ terms: { capability: string; version: number; accepted?: unknown }[] | null }>('GET', '/v1/workspaces/{ws}/terms', undefined, 'the owner reads the terms')
      if (terms.value === undefined || terms.status >= 300) return fail(`reading the workspace's terms answered ${said(terms)}`)
      for (const t of (terms.value.terms ?? []).filter((x) => ['currency_accounts', 'payments_out'].includes(x.capability) && x.accepted == null)) {
        const accepted = await step('POST', `/v1/workspaces/{ws}/terms/${t.capability}/accept`, { version: t.version }, `the owner accepts ${t.capability}'s terms`)
        if (accepted.status !== 201) return fail(`accepting ${t.capability}'s terms answered ${said(accepted)}`)
      }
      const opened = await step('POST', '/v1/money/accounts', { currency: 'GBP' }, 'the owner opens a GBP account on test money')
      if (opened.status !== 201) return fail(`opening a GBP account must answer 201; Lens answered ${said(opened)}`)
      const payee = `Nightly Wallet Joinery ${RUN_SALT}`
      const saved = await step<{ id: string; needs_confirmation: boolean }>('POST', '/v1/money/payees', { name: payee, country: 'GB', sort_code: '040004', account_number: '24681359' }, 'the owner saves a payee')
      if (saved.status !== 201 || saved.value === undefined) return fail(`saving a payee must answer 201; Lens answered ${said(saved)}`)
      const payeeID = saved.value.id
      const made = await step<{ id: string; name: string }>('POST', '/v1/workspaces/{ws}/agents', { name: `Wallet agent ${RUN_SALT}` }, 'the owner makes an agent')
      if (made.status !== 201 || made.value === undefined) return fail(`making an agent answered ${said(made)}`)
      const agent = made.value
      type Wallet = { balance_minor: number; mode: string; receive: { address?: string; iban?: string } }
      const wallet = await step<Wallet>('GET', `/v1/workspaces/{ws}/agents/${agent.id}/wallet`, undefined, 'the agent’s wallet, from Lens')
      if (wallet.status !== 200 || wallet.value === undefined) return fail(`Lens's wallet for a new agent must answer 200; it answered ${said(wallet)}`)
      const w = wallet.value
      const seen: WalletSeen = {
        lens: { balance: `${(w.balance_minor / 1e6).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 6 })} USDC`, mode: w.mode, payInto: w.receive.address ?? w.receive.iban ?? '' },
        text: '', copy: false, approval: false, payments: -1, paidItems: -1, paymentsAfter: -1,
      }
      const paymentsToPayee = async (note: string) => {
        const r = await step<{ payments: { payee_id: string }[] | null }>('GET', '/v1/money/payments', undefined, note)
        return r.value === undefined || r.status >= 300 ? -1 : (r.value.payments ?? []).filter((p) => p.payee_id === payeeID).length
      }

      let requestID = ''
      const page = await ctx.app.tab(`/agents?agent=${encodeURIComponent(agent.id)}`)
      page.on('response', async (r) => {
        if (!r.url().endsWith('/api/money/payment-requests') || r.request().method() !== 'POST') return
        requestID ||= ((await r.json().catch(() => ({}))) as { id?: string }).id ?? ''
      })
      try {
        const card = page.getByTestId('agent-money-wallet')
        try {
          await card.getByText(seen.lens.balance).waitFor({ timeout: TIMEOUT_MS })
        } catch (e) {
          seen.text = ((await card.textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ')
          return fail(`the wallet card never showed Lens's balance ${seen.lens.balance}: ${(e as Error).message.split('\n')[0]}; it reads "${seen.text.slice(0, 300)}"`)
        }
        seen.text = ((await card.textContent()) ?? '').replace(/\s+/g, ' ')
        seen.copy = (await card.getByRole('button', { name: /^Copy / }).count()) > 0
        ctx.evidence.push({ note: 'the wallet card', answer: seen.text })

        const send = card.getByTestId('wallet-send')
        await send.getByRole('combobox', { name: 'Send to' }).selectOption(payeeID, { timeout: TIMEOUT_MS })
        await send.getByRole('textbox', { name: /^Amount in / }).fill(AMOUNT)
        await send.getByRole('textbox', { name: 'Reference' }).fill(`Nightly wallet ${RUN_SALT}`)
        await send.getByRole('button', { name: 'Send', exact: true }).click()
        const approve = card.getByTestId('approve-card')
        seen.approval = await approve.waitFor({ timeout: TIMEOUT_MS }).then(() => true, () => false)

        seen.payments = await paymentsToPayee('the payments out before approval')
        const read = requestID === '' ? undefined : await step<{ items: { payment_id?: string; pay_status?: string }[] | null }>('GET', `/v1/money/payment-requests/${requestID}`, undefined, 'the prepared request before approval')
        seen.paidItems = read?.value === undefined || read.status >= 300 ? -1 : (read.value.items ?? []).filter((it) => (it.payment_id ?? '') !== '' || (it.pay_status ?? '') !== '').length
        if (seen.approval) {
          await approve.getByRole('button', { name: 'Decline', exact: true }).click()
          await card.getByTestId('chat-pay-receipt').waitFor({ timeout: TIMEOUT_MS }).catch(() => undefined)
        }
        seen.paymentsAfter = await paymentsToPayee('the payments out after Decline')
      } finally {
        await page.close()
      }
      return walletVerdict(seen)
    },
  }
}
