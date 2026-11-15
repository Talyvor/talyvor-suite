// B61.48 — Instant transfer (the launch version's 'instant-transfer' area), once a run each, on a workspace of its own. A synthetic
// workspace is Hybrid, as Lens makes one (migration 0373), so it may send one.
//
// instant-transfer-quote, on Lens's API: the owner opens the company's USD account and two agents' USD accounts, and turns on the
// sender's "Can use Instant transfer". A quote for USD 5.00 to the other agent's account shows what leaves, the fee (Lens's fee_bps
// of it, rounded up), the rate and what arrives, and is locked for exactly its 30 seconds: a send at it inside them is not refused
// as expired, and a send at it once they are over is refused in words that say it expired and to ask for a new one.
//
// instant-transfer-offered, in the app: the Hybrid account's Pay offers Instant transfer and its page draws the form; told by the
// BFF that the account is Fiat only (a synthetic workspace cannot be made one: only Talyvor's operator changes a kind), Pay
// offers no Instant transfer and its address goes back to Pay.

import { randomBytes } from 'node:crypto'
import { fail } from './bank.ts'
import { RUN_SALT } from './oracles.ts'
import type { Scenario, ScenarioCtx } from './scenarios.ts'
import { call, said } from './settings.ts'

const TIMEOUT_MS = 30_000
const SEND_MINOR = 500
const QUOTE_LIFE_MS = 30_000

/** An Instant transfer quote as Lens answers it (economy.InstantQuote). */
export interface InstantQuote {
  id: string
  send_minor: number
  send_currency: string
  fee_bps: number
  fee_minor: number
  rate: string
  receive_minor: number
  receive_currency: string
  expires_at: string
  created_at: string
}

/** What is wrong with a quote for `sendMinor` of `currency`: what leaves, the fee, the rate, what arrives and its 30 seconds. */
export function quoteFaults(q: InstantQuote, sendMinor: number, currency: string): string[] {
  const faults: string[] = []
  if (q.send_minor !== sendMinor || q.send_currency !== currency) faults.push(`the quote must send ${sendMinor} ${currency}; it sends ${q.send_minor} ${q.send_currency}`)
  if (!Number.isInteger(q.fee_bps) || q.fee_bps <= 0) faults.push(`the quote must show its fee; its fee_bps is ${q.fee_bps}`)
  else if (q.fee_minor !== Math.ceil((sendMinor * q.fee_bps) / 10_000)) {
    faults.push(`the fee is ${q.fee_bps} basis points of ${sendMinor}, rounded up: ${Math.ceil((sendMinor * q.fee_bps) / 10_000)}; the quote shows ${q.fee_minor}`)
  }
  if (!(Number(q.rate) > 0)) faults.push(`the quote must show its rate; it shows "${q.rate}"`)
  if (!Number.isInteger(q.receive_minor) || q.receive_minor <= 0 || q.receive_currency !== currency) {
    faults.push(`the quote must show what arrives in ${currency}; it shows ${q.receive_minor} ${q.receive_currency}`)
  }
  const life = Date.parse(q.expires_at) - Date.parse(q.created_at)
  if (life !== QUOTE_LIFE_MS) faults.push(`a quote is locked for 30 seconds; this one for ${Number.isNaN(life) ? `"${q.created_at}" to "${q.expires_at}"` : `${life / 1000} seconds`}`)
  return faults
}

/** Whether Lens's refusal says the quote expired and to ask for a new one, in words. */
export const saysExpired = (error: string): boolean => /\bexpired\b/i.test(error) && /\bnew one\b/i.test(error)

export function instantTransferQuote(): Scenario {
  return {
    id: 'instant-transfer-quote',
    owner: 'talyvor-lens',
    own: true,
    agents: 2,
    items: ['B61.48', 'B59.14', 'B59.15'],
    feature: 'Instant transfer',
    title: 'instant transfer: a quote shows what leaves, the fee, the rate and what arrives, holds for its 30 seconds, and once they are over a send at it is refused in words',
    run: async (ctx) => {
      const step = async <T>(method: string, path: string, body: unknown, note: string) => {
        const r = await call<T>(ctx, method, path, body)
        ctx.evidence.push({ note, answer: said(r) })
        return r
      }
      const { lens } = ctx.env
      const user = ctx.app.user
      // 1. The terms, the company's USD account, and the two agents' USD accounts under it.
      const terms = await step<{ terms: { capability: string; version: number; accepted?: unknown }[] | null }>('GET', '/v1/workspaces/{ws}/terms', undefined, 'the owner reads the terms')
      for (const t of (terms.value?.terms ?? []).filter((x) => x.accepted == null)) {
        const ok = await step('POST', `/v1/workspaces/{ws}/terms/${t.capability}/accept`, { version: t.version }, `the owner accepts ${t.capability}'s terms`)
        if (ok.status !== 201) return fail(`accepting ${t.capability}'s terms answered ${said(ok)}`)
      }
      const company = await step<{ id: string }>('POST', '/v1/money/accounts', { currency: 'USD' }, "the company's USD account")
      if (company.status !== 201) return fail(`opening the company's USD account answered ${said(company)}`)
      const sender = await lens.createAgent(user, `Instant sender ${RUN_SALT}`)
      const receiver = await lens.createAgent(user, `Instant receiver ${RUN_SALT}`)
      const accounts: Record<string, string> = {}
      for (const a of [sender, receiver]) {
        const opened = await step<{ id: string }>('POST', '/v1/money/accounts', { currency: 'USD', agent_id: a.id }, `${a.name}'s USD account`)
        if (opened.status !== 201 || opened.value === undefined) return fail(`opening ${a.name}'s USD account answered ${said(opened)}`)
        accounts[a.id] = opened.value.id
      }
      const rules = await step('PUT', `/v1/workspaces/{ws}/agents/${sender.id}/rules`, { ...await lens.agentRules(user, sender.id), may_instant_transfer: true },
        `${sender.name} may use Instant transfer`)
      if (rules.status !== 200) return fail(`turning on ${sender.name}'s "Can use Instant transfer" answered ${said(rules)}`)

      // 2. The quote.
      const quoted = await step<InstantQuote>('POST', '/v1/workspaces/{ws}/money/instant-transfers/quote',
        { send_minor: SEND_MINOR, send_currency: 'USD', receive_currency: 'USD', to: 'talyvor_account' }, `a quote for USD 5.00 to ${receiver.name}'s account`)
      if (quoted.status !== 201 || quoted.value === undefined) return fail(`a Hybrid account's quote for USD 5.00 to a Talyvor account must answer 201; Lens answered ${said(quoted)}`)
      const q = quoted.value
      const faults = quoteFaults(q, SEND_MINOR, 'USD')
      if (faults.length > 0) return fail(faults.join('; '))
      const send = (note: string) => step('POST', `/v1/workspaces/{ws}/agents/${sender.id}/money/instant-transfers`,
        { quote_id: q.id, to_account_id: accounts[receiver.id], idempotency_key: `e2e-${randomBytes(8).toString('hex')}` }, note)

      // 3. Inside its 30 seconds it holds: a send at it is answered for something else (the new account, or the money), never its expiry.
      const inside = await send(`${sender.name} sends at the quote inside its 30 seconds`)
      if (Date.now() < Date.parse(q.expires_at) && saysExpired(inside.error)) return fail(`inside its 30 seconds the quote must hold; Lens refused a send at it as expired: ${said(inside)}`)

      // 4. Once they are over, a send at it is refused in words.
      const wait = Date.parse(q.expires_at) + 1500 - Date.now()
      if (wait > 0) await new Promise((r) => setTimeout(r, wait))
      const late = await send(`${sender.name} sends at the quote once its 30 seconds are over`)
      if (late.status < 400 || late.status >= 500) return fail(`a send at a quote past its 30 seconds must be refused; Lens answered ${said(late)}`)
      if (!saysExpired(late.error)) return fail(`the refusal of a send at an expired quote must say it expired and to ask for a new one; Lens said "${late.error}"`)
      return {
        pass: true,
        detail: `USD 5.00 quoted at a fee of ${q.fee_minor} (${q.fee_bps} bps), rate ${q.rate}, ${q.receive_minor} arriving, locked 30 seconds; inside them a send ` +
          `answered ${inside.status}, after them refused ${late.status} "${late.error.slice(0, 160)}"`,
      }
    },
  }
}

/** What is wrong with what Pay offers an account of `kind`: Instant transfer for Hybrid alone, and its page only there. */
export function offeredFaults(kind: 'hybrid' | 'fiat', s: { payLinks: string[]; formDrawn: boolean; landedOn: string }): string[] {
  const offered = s.payLinks.some((l) => /instant transfer/i.test(l))
  if (kind === 'hybrid') {
    return [
      ...(offered ? [] : [`a Hybrid account's Pay must offer Instant transfer; its links read ${JSON.stringify(s.payLinks).slice(0, 200)}`]),
      ...(s.formDrawn ? [] : [`a Hybrid account's /money/pay/instant-transfer must draw the form; it landed on ${s.landedOn} without it`]),
    ]
  }
  return [
    ...(offered ? [`a Fiat only account's Pay must offer no Instant transfer; it offers ${JSON.stringify(s.payLinks.filter((l) => /instant/i.test(l)))}`] : []),
    ...(s.formDrawn || s.landedOn !== '/money/pay' ? [`a Fiat only account's /money/pay/instant-transfer must go back to Pay; it landed on ${s.landedOn}${s.formDrawn ? ' with the form' : ''}`] : []),
  ]
}

async function whatPayOffers(ctx: ScenarioCtx, kind: 'hybrid' | 'fiat'): Promise<{ payLinks: string[]; formDrawn: boolean; landedOn: string }> {
  const page = await ctx.app.tab('/money')
  try {
    if (kind === 'fiat') {
      await page.route('**/api/workspace/account', async (route) => {
        const real = await route.fetch()
        const body = (await real.json()) as Record<string, unknown>
        await route.fulfill({ response: real, json: { ...body, money_kind: 'fiat' } })
      })
    }
    await page.goto(new URL('/money/pay', page.url()).href)
    // "Also on Pay" is drawn once the account's kind is read, with Standing orders for every kind.
    await page.locator('main a[href="/money/pay/standing-orders"]').first().waitFor({ timeout: TIMEOUT_MS }).catch(() => undefined)
    const payLinks = (await page.locator('main a').allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim())
    await page.goto(new URL('/money/pay/instant-transfer', page.url()).href)
    const form = page.getByTestId('instant-transfer-form')
    const formDrawn = await form.waitFor({ timeout: kind === 'hybrid' ? TIMEOUT_MS : 5000 }).then(() => true, () => false)
    if (kind === 'fiat') await page.waitForURL((u) => u.pathname === '/money/pay', { timeout: TIMEOUT_MS }).catch(() => undefined)
    return { payLinks, formDrawn, landedOn: new URL(page.url()).pathname }
  } finally {
    await page.close()
  }
}

export function instantTransferOffered(): Scenario {
  return {
    id: 'instant-transfer-offered',
    owner: 'talyvor-suite',
    own: true,
    items: ['B61.48', 'B59.19'],
    feature: 'Instant transfer',
    title: "instant transfer: a Hybrid account's Pay offers it and its page draws the form; a Fiat only account is offered no Instant transfer and its address goes back to Pay",
    run: async (ctx) => {
      const faults: string[] = []
      const seen: string[] = []
      for (const kind of ['hybrid', 'fiat'] as const) {
        const s = await whatPayOffers(ctx, kind)
        ctx.evidence.push({ note: `Pay, for a ${kind} account`, answer: JSON.stringify(s).slice(0, 600) })
        faults.push(...offeredFaults(kind, s))
        seen.push(`${kind}: ${s.formDrawn ? 'form drawn' : `back on ${s.landedOn}`}`)
      }
      return faults.length > 0 ? fail(faults.join('; ')) : { pass: true, detail: `Instant transfer offered to the Hybrid account alone (${seen.join('; ')})` }
    },
  }
}
