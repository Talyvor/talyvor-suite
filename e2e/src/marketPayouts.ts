// B46.24 — a marketplace seller and a lineage royalty paid out on the money layer (Lens B46.22), on Lens's API, once a run, on
// workspaces of its own.
//
// A creator publishes an original and lets others remix it at a 30% royalty; a seller accepts that licence and publishes its remix,
// sold by a $100.00 30-day commercial rent; a third seller publishes a $30.00 rent of its own. A buyer rents both on one bill, paid
// with the synthetic bill-pay, and Lens's release job releases the shares past the holdback: at a 15% take the seller keeps $59.50,
// the creator's royalty is $25.50 and the third keeps $25.50, each over the $25 payout minimum. The three complete their tax details
// and save USD payout details (PUT /v1/money/payout-details); the third's holder is named "TESTPENDING …", so the sandbox's partner
// leaves its verification pending.
//
// The weekly payout run, brought to each seller now with the synthetic key (talyvor-lens B32.99), pays on the money layer: one
// market payout of method money in USD (GET /v1/workspaces/{ws}/marketplace/payouts), without Stripe's fees. Lens's earnings_payout
// rows (GET /v1/money/earnings-payouts) are the oracle: under source market:<ISO week> the seller's sale of 5950 USD minor and the
// creator's royalty of 2550 completed by the partner, the third's sale of 2550 held and never sent — each the whole of its payout.
//
// A Lens whose synthetic run still pays such a seller by Stripe has made no money payout to read: the scenario SKIPs naming
// talyvor-lens B46.25, the item that brings the run onto the money layer.

import { randomUUID } from 'node:crypto'
import { fail } from './bank.ts'
import { keptOf } from './fees.ts'
import type { Answered, MarketLicence, SellerTax, SyntheticUser, WeeklyPayout } from './lens.ts'
import { publish, remix, terms } from './lineage.ts'
import { RUN_SALT } from './oracles.ts'
import { said } from './routes.ts'
import { CannotTest, type Scenario } from './scenarios.ts'
import { isoWeek, SELLER_DETAILS } from './taxPayouts.ts'
import { until } from './trade.ts'

interface Payout { id: string; kind: string; source: string; agreement?: string; recipient_workspace_id: string; amount_minor: number; currency: string
  funding: string; status: string; partner_ref?: string }

/** The remix's rent and the third seller's, µUSD; the creator's royalty on its remixes. */
const REMIX_RENT_USD_MICROS = 100_000_000
const OWN_RENT_USD_MICROS = 30_000_000
const ROYALTY_BPS = 3000
const BPS = 10_000
const CAPABILITIES = ['currency_accounts', 'payments_in', 'payments_out']
/** A valid UK IBAN (the standard example); the sandbox pays to any IBAN whose checks pass. */
const IBAN = 'GB82WEST12345698765432'
/** Lens meters a billed use within a minute; its release job runs every 5 minutes. */
const METER_WAIT_MS = 90_000
const RELEASE_WAIT_MS = 360_000

/** What each seller keeps of the paid bill at Talyvor's take, µUSD: the seller's sale, the creator's royalty, the third's sale. */
export function shares(takeBPS: number): { seller: number; creator: number; third: number } {
  const pool = keptOf(REMIX_RENT_USD_MICROS, takeBPS)
  const creator = Math.floor((pool * ROYALTY_BPS) / BPS)
  return { seller: pool - creator, creator, third: keptOf(OWN_RENT_USD_MICROS, takeBPS) }
}

export function marketPayouts(): Scenario {
  return {
    id: 'market-earnings-payout',
    owner: 'talyvor-lens',
    own: true,
    feature: 'Marketplace',
    items: ['B46.24'],
    title: "a seller's sale and its original's lineage royalty are paid out by the weekly run on the money layer, each a USD earnings_payout " +
      'under market:<ISO week> completed to verified details; a third seller whose details are pending is held',
    run: async (ctx) => {
      const { env } = ctx
      const { lens } = env
      const call = async <T>(who: SyntheticUser, method: string, path: string, body: object | undefined, note: string): Promise<Answered<T>> => {
        const got = await lens.act<T>(who, method, path, body)
        ctx.evidence.push({ note, answer: said(got) })
        return got
      }
      const [creator, seller, third, buyer] = await lens.createUsers(4)
      const model = env.judgeModel
      const tag = `${RUN_SALT}`

      // The original at a 30% royalty, its remix rented at $100.00, and a third seller's own $30.00 rent.
      const A = await publish(ctx, creator, 'the creator', { title: `Launch checklist ${tag}`, artifact: { template: 'List five launch checks for {{text}}.', model } })
      if (typeof A === 'string') return fail(A)
      const lets = await terms(ctx, creator, 'the creator', A.id, ROYALTY_BPS)
      if (lets !== undefined) return fail(lets)
      const granted = await remix(ctx, seller, 'the seller', 'the creator', A.id, ROYALTY_BPS)
      if (granted !== undefined) return fail(granted)
      const B = await publish(ctx, seller, 'the seller', { title: `Launch checklist, with owners ${tag}`, parents: [{ listing_id: A.id, version: 1 }], rent: true,
        price: REMIX_RENT_USD_MICROS, artifact: { template: 'List five launch checks for {{text}}, each with who owns it.', model } })
      if (typeof B === 'string') return fail(B)
      const C = await publish(ctx, third, 'the third seller', { title: `Release notes ${tag}`, rent: true, price: OWN_RENT_USD_MICROS,
        artifact: { template: 'Write release notes for {{text}}.', model } })
      if (typeof C === 'string') return fail(C)

      // The buyer rents both on one bill, paid; each share released past the holdback.
      for (const [name, l] of [['the remix', B], ["the third seller's listing", C]] as const) {
        const rented = await lens.act<MarketLicence>(buyer, 'POST', `/v1/workspaces/{ws}/marketplace/listings/${l.id}/licences`, { offer_id: l.rent },
          { 'Idempotency-Key': randomUUID() })
        ctx.evidence.push({ note: `the buyer rents ${name}`, answer: said(rented) })
        if (!rented.ok) return fail(`renting ${name} was refused: ${said(rented)}`)
      }
      const bill = await until(() => lens.payTestBill(buyer), (x) => x.ok || x.status !== 409, METER_WAIT_MS)
      ctx.evidence.push({ note: "the buyer's bill paid now (B25.7)", answer: said(bill) })
      if (!bill.ok || bill.value.uses_cleared !== 2) return fail(`paying the buyer's bill of two rents should clear both: ${said(bill)}`)
      const s = shares(env.fees.market_take_bps)
      const sellers: [string, SyntheticUser, number, string, string, string][] = [
        ['the seller', seller, s.seller, `Nightly Seller ${RUN_SALT}`, 'sale', 'completed'],
        ['the creator', creator, s.creator, `Nightly Creator ${RUN_SALT}`, 'royalty', 'completed'],
        ['the third seller', third, s.third, `TESTPENDING Nightly Seller ${RUN_SALT}`, 'sale', 'held'],
      ]
      for (const [name, who, share] of sellers) {
        const j = await until(() => lens.marketJournal(who), (x) => x.holdback_usd_micros === 0 && x.available_usd_micros === share, RELEASE_WAIT_MS)
        ctx.evidence.push({ note: `${name}'s journal: ${JSON.stringify(j)}` })
        if (j.available_usd_micros !== share) return fail(`${RELEASE_WAIT_MS / 60_000} minutes after the bill was paid, ${name}'s ${share} µUSD should be available; the journal reads ${JSON.stringify(j)}`)
      }

      // Each completes its tax details and saves USD payout details; the TESTPENDING holder's stay pending.
      for (const [name, who, , holder, , status] of sellers) {
        const tax = await call<SellerTax>(who, 'PUT', '/v1/workspaces/{ws}/marketplace/seller-tax', SELLER_DETAILS, `${name} completes their tax details`)
        if (!tax.ok && tax.status === 503) throw new CannotTest(`this Lens stores no seller's tax details (no LENS_PROVIDER_SECRET_KEK), so its payout run pays ${name} nothing`)
        if (!tax.ok || !tax.value.complete) return fail(`${name}'s complete tax details should be saved complete: ${said(tax)}`)
        const read = await call<{ terms: { capability: string; version: number; accepted?: unknown }[] | null }>(who, 'GET', '/v1/workspaces/{ws}/terms', undefined, `${name} reads the terms`)
        if (!read.ok) return fail(`reading ${name}'s terms answered ${said(read)}`)
        for (const t of (read.value.terms ?? []).filter((x) => CAPABILITIES.includes(x.capability) && x.accepted == null)) {
          const ok = await call(who, 'POST', `/v1/workspaces/{ws}/terms/${t.capability}/accept`, { version: t.version }, `${name} accepts ${t.capability}'s terms`)
          if (ok.status !== 201) return fail(`${name} accepting ${t.capability}'s terms answered ${said(ok)}`)
        }
        const want = status === 'held' ? 'pending' : 'verified'
        const saved = await call<{ status: string }>(who, 'PUT', '/v1/money/payout-details', { asset: 'USD', holder, iban: IBAN, country: 'GB' }, `${name} saves USD payout details for ${holder}`)
        if (!saved.ok || saved.value.status !== want) return fail(`${name}'s USD payout details for ${holder} must answer 200 ${want}; Lens answered ${said(saved)}`)
      }

      // The weekly run, brought to each now: one money payout in USD, and its earnings_payout rows under the week.
      const week = isoWeek(new Date())
      const wrong: string[] = []
      const paidOut: string[] = []
      for (const [name, who, share, , kind, status] of sellers) {
        const run = await lens.syntheticPayoutRun(who)
        ctx.evidence.push({ note: `the payout run, brought to ${name} now`, answer: said(run) })
        if (!run.ok && (run.status === 404 || run.status === 405)) throw new CannotTest('this Lens has no synthetic payout run (POST /v1/synthetic/workspaces/{ws}/marketplace/payouts/run, talyvor-lens B32.99)')
        if (!run.ok) return fail(`the payout run for ${name} was refused: ${said(run)}`)
        const p: (WeeklyPayout & { asset?: string }) | null = run.value.payout
        if (run.value.withheld || p === null) return fail(`with ${share} µUSD available and their tax details complete, the payout run should pay ${name}; it answered ${JSON.stringify(run.value)}`)
        if (p.method !== 'money') {
          throw new CannotTest(`the synthetic payout run paid ${name}, who saved USD payout details, by ${p.method}, not on the money layer, so there is no earnings_payout to ` +
            'read: talyvor-lens B46.25 brings that run onto the money layer as the weekly run is')
        }
        const minor = Math.floor(share / 10_000)
        if (p.asset !== 'USD' || p.period !== week || p.gross_usd_micros !== minor * 10_000 || p.net_usd_micros !== p.gross_usd_micros) {
          wrong.push(`${name}'s market payout must be ${minor * 10_000} µUSD in USD in ${week}, gross and net alike with no Stripe fees; the run made ${JSON.stringify(p)}`)
          continue
        }
        const page = await call<{ payouts: (WeeklyPayout & { asset?: string })[] | null }>(who, 'GET', '/v1/workspaces/{ws}/marketplace/payouts', undefined, `${name}'s payout page`)
        const listed = page.ok ? (page.value.payouts ?? []).find((x) => x.id === p.id) : undefined
        if (listed?.method !== 'money' || listed.asset !== 'USD') wrong.push(`${name}'s payout page must list ${p.id} as a money payout in USD; it reads ${said(page)}`)
        const list = await call<{ payouts: Payout[] | null }>(who, 'GET', '/v1/money/earnings-payouts', undefined, `${name}'s earnings payouts`)
        const rows = list.ok ? (list.value.payouts ?? []).filter((x) => x.recipient_workspace_id === who.workspaceID && x.source === `market:${week}`) : []
        const r = rows[0]
        const sent = (r?.partner_ref ?? '') !== ''
        if (rows.length !== 1 || r.kind !== kind || r.amount_minor !== minor || r.currency !== 'USD' || r.status !== status || r.funding !== 'test' ||
          r.agreement !== `market_payouts:${p.id}` || sent !== (status === 'completed')) {
          wrong.push(`${name} must have one earnings_payout under market:${week}, a ${kind} of ${minor} USD minor ${status}${status === 'held' ? ' and never sent' : ' by the partner'} ` +
            `for market payout ${p.id}; Lens lists ${list.ok ? JSON.stringify(rows) : said(list)}`)
          continue
        }
        paidOut.push(`${name}'s ${kind} ${minor} ${status}`)
      }
      if (wrong.length > 0) return fail(wrong.join('; '))
      return { pass: true, detail: `the weekly run paid on the money layer in USD under market:${week}: ${paidOut.join(', ')}` }
    },
  }
}
