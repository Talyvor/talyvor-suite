// B48.23 — agents of each kind own their wallets (Lens B48.1), on Lens's API, once a run, on a workspace of its own.
//
// The owner creates a fiat agent in pounds, a crypto agent and a "both" agent in euros. Each agent's wallets are one GBP, one
// USDC, and EUR then USDC, every one an account of its own, paid into at details of its own — or, while the sandbox serves it,
// at none rather than made-up ones. The fiat agent's wallet is funded with test money (an invoice from it, paid by card); making
// that agent crypto would close the wallet holding it, so Lens answers 409, and the ledger still holds the wallet open with the
// money in it. The owner's wallets are one per asset the agents use. The agents are archived after.

import { fail } from './bank.ts'
import type { Answered } from './lens.ts'
import { RUN_SALT } from './oracles.ts'
import { payInvoiceByCard } from './payScreen.ts'
import { said } from './routes.ts'
import type { Scenario, ScenarioCtx } from './scenarios.ts'

interface Receive { asset?: string; iban?: string; sort_code?: string; account_number?: string; routing_number?: string; address?: string }
interface Wallet { account_id: string; asset: string; balance_minor: number; receive?: Receive; payment_reference?: string; mode: string }
interface Wallets { wallet_kind?: string; wallets: Wallet[] | null }
interface Account { id: string; currency: string; status: string; test_minor: number }

const CAPABILITIES = ['currency_accounts', 'payments_in', 'stablecoins']
const FUND_MINOR = 2_500
const KINDS = [
  { kind: 'fiat', fiat: 'GBP', assets: ['GBP'] },
  { kind: 'crypto', fiat: undefined, assets: ['USDC'] },
  { kind: 'both', fiat: 'EUR', assets: ['EUR', 'USDC'] },
] as const

/** Where a wallet is paid into: its details and the reference quoted with them; '' when it shows none. */
const payIn = (w: Wallet): string => {
  const r = w.receive ?? {}
  const at = [r.iban, r.sort_code, r.account_number, r.routing_number, r.address].filter(Boolean).join('/')
  return at === '' ? '' : `${at}#${w.payment_reference ?? ''}`
}

export function agentWalletKinds(fund: (ctx: ScenarioCtx, token: string) => Promise<string | undefined> = payInvoiceByCard): Scenario {
  return {
    id: 'agent-wallet-kinds',
    owner: 'talyvor-lens',
    own: true,
    agents: 3,
    feature: 'Agent Wallets',
    items: ['B48.23'],
    title: 'agents of each kind own their wallets: a fiat agent one GBP wallet, a crypto agent one USDC, a "both" agent EUR and USDC, each its own; ' +
      'removing the kind whose wallet holds test money answers 409 and the ledger keeps the wallet open with the money; the owner has one wallet per asset',
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

      const made: string[] = []
      const wrong: string[] = []
      try {
        // 1. One agent of each kind, and its wallets.
        const agents: { id: string; kind: string; wallets: Wallet[] }[] = []
        for (const k of KINDS) {
          const created = await call<{ id: string; wallet_kind?: string }>('POST', '/v1/workspaces/{ws}/agents',
            { name: `Kind ${k.kind} ${RUN_SALT}`, wallet_kind: k.kind, ...(k.fiat === undefined ? {} : { fiat_currency: k.fiat }) }, `the owner creates a ${k.kind} agent`)
          if (created.status !== 201 || !created.ok) return fail(`creating a ${k.kind} agent must answer 201; Lens answered ${said(created)}`)
          made.push(created.value.id)
          const got = await call<Wallets>('GET', `/v1/workspaces/{ws}/agents/${created.value.id}/wallets`, undefined, `the ${k.kind} agent's wallets`)
          if (got.status !== 200 || !got.ok) return fail(`the ${k.kind} agent's wallets must answer 200; Lens answered ${said(got)}`)
          const wallets = got.value.wallets ?? []
          const assets = wallets.map((w) => w.asset)
          if (got.value.wallet_kind !== k.kind || assets.join() !== k.assets.join()) {
            wrong.push(`a ${k.kind} agent must own ${k.assets.join(' and ')} wallets; Lens answered kind ${got.value.wallet_kind} with ${assets.join(', ') || 'none'}`)
          }
          for (const w of wallets) {
            if (!w.account_id || w.balance_minor !== 0 || !['TEST', 'LIVE'].includes(w.mode)) wrong.push(`the ${k.kind} agent's new ${w.asset} wallet must be an account holding nothing, TEST or LIVE: ${JSON.stringify(w)}`)
            if (w.mode === 'LIVE' && payIn(w) === '') wrong.push(`the ${k.kind} agent's live ${w.asset} wallet shows nowhere to pay into it`)
          }
          agents.push({ id: created.value.id, kind: k.kind, wallets })
        }
        const all = agents.flatMap((a) => a.wallets)
        const ids = new Set(all.map((w) => w.account_id))
        if (ids.size !== all.length) wrong.push(`every wallet must be an account of its own; ${all.length} wallets are ${ids.size} accounts`)
        const shown = all.map(payIn).filter((p) => p !== '')
        if (new Set(shown).size !== shown.length) wrong.push(`every wallet must be paid into at details of its own; two show the same: ${shown.join(', ')}`)
        if (wrong.length > 0) return fail(wrong.join('; '))

        // 2. Test money in the fiat agent's GBP wallet: an invoice from it, paid by card.
        const fiat = agents[0]
        const gbp = fiat.wallets[0]
        const invoice = await call<{ pay_url?: string }>('POST', '/v1/money/invoices', {
          account_id: gbp.account_id, customer_name: `Wallet kinds ${RUN_SALT}`, lines: [{ description: 'Funding', quantity: 1, unit_amount_minor: FUND_MINOR, vat_rate_bps: 0 }],
          due_date: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10), send: true,
        }, `the owner sends a ${FUND_MINOR} minor invoice from the fiat agent's GBP wallet, to fund it`)
        const token = /\/pay\/([A-Za-z0-9_-]+)/.exec(invoice.ok ? invoice.value.pay_url ?? '' : '')?.[1] ?? ''
        if (invoice.status !== 201 || token === '') return fail(`issuing the funding invoice answered ${said(invoice)}`)
        const unpaid = await fund(ctx, token)
        if (unpaid !== undefined) return fail(unpaid)
        const ledger = async (note: string) => {
          const accounts = await call<{ accounts: Account[] | null }>('GET', '/v1/money/accounts', undefined, `${note}: the ledger's accounts`)
          if (!accounts.ok) throw new Error(`reading the accounts ${note} answered ${said(accounts)}`)
          return (accounts.value.accounts ?? []).find((a) => a.id === gbp.account_id)
        }
        const funded = await ledger('after the card payment')
        if (funded?.status !== 'open' || funded.test_minor !== FUND_MINOR) {
          return fail(`the invoice was paid by card, but the ledger shows the GBP wallet ${gbp.account_id} as ${JSON.stringify(funded)}, not open holding ${FUND_MINOR} minor`)
        }

        // 3. Making the fiat agent crypto would close the GBP wallet holding that money: refused, and nothing closed.
        const removed = await call('PUT', `/v1/workspaces/{ws}/agents/${fiat.id}/wallet-kind`, { wallet_kind: 'crypto' }, 'the owner makes the funded fiat agent crypto')
        if (removed.status !== 409) wrong.push(`removing the kind whose wallet holds ${FUND_MINOR} minor must answer 409; Lens answered ${said(removed)}`)
        const kept = await ledger('after the refused change')
        if (kept?.status !== 'open' || kept.test_minor !== FUND_MINOR) {
          wrong.push(`after the change the ledger shows the funded GBP wallet as ${JSON.stringify(kept)}, not still open holding ${FUND_MINOR} minor`)
        }
        const still = await call<Wallets>('GET', `/v1/workspaces/{ws}/agents/${fiat.id}/wallets`, undefined, "the fiat agent's wallets after the refused change")
        const held = still.ok ? (still.value.wallets ?? []).find((w) => w.account_id === gbp.account_id) : undefined
        if (!still.ok || still.value.wallet_kind !== 'fiat' || held?.balance_minor !== FUND_MINOR) {
          wrong.push(`after the refused change the fiat agent must still be fiat with its GBP wallet holding ${FUND_MINOR} minor; Lens answered ${said(still)}`)
        }

        // 4. The owner's wallets: one per asset the agents use.
        const owner = await call<Wallets>('GET', '/v1/workspaces/{ws}/agents/owner-wallets', undefined, "the owner's wallets")
        const ownerAssets = owner.ok ? (owner.value.wallets ?? []).map((w) => w.asset).sort() : []
        if (owner.status !== 200 || ownerAssets.join() !== 'EUR,GBP,USDC') wrong.push(`the owner must have one wallet in each of EUR, GBP and USDC; Lens answered ${said(owner)}`)
        if (owner.ok && (owner.value.wallets ?? []).some((w) => ids.has(w.account_id))) wrong.push("an owner's wallet is one of the agents' own")

        if (wrong.length > 0) return fail(wrong.join('; '))
        return {
          pass: true,
          detail: `fiat ${fiat.wallets.map((w) => w.asset)}, crypto ${agents[1].wallets.map((w) => w.asset)}, both ${agents[2].wallets.map((w) => w.asset)}: ${ids.size} accounts of their own; ` +
            `the GBP wallet funded with ${FUND_MINOR} minor, making its agent crypto answered 409 and the ledger kept it open holding ${kept?.test_minor}; the owner's wallets ${ownerAssets.join(', ')}`,
        }
      } catch (e) {
        return fail([...wrong, (e as Error).message].join('; '))
      } finally {
        for (const id of made) {
          const archived = await lens.archiveAgent(user, id)
          ctx.evidence.push({ note: `the owner archives agent ${id}`, answer: said(archived) })
        }
      }
    },
  }
}
