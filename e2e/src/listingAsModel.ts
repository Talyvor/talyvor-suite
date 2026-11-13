// B41.208 (for talyvor-lens B41.79) — a paid agent listing called as a model, once a run, on workspaces of its own.
//
// A new seller publishes an agent at $1.00 a use. The buyer calls Lens's OpenAI-compatible chat completions on its own key
// with model "listing/<listing id>", once not streamed and once streamed, as any app or SDK would. Each answer must say its use
// was billed (X-Talyvor-Listing-Charge), and the buyer's marketplace bill must gain exactly one billed use of the listing per
// call, at its price: one after the first, two after the second. Lens's streaming path is a copy of the other, so each is
// asked once.

import { fail } from './bank.ts'
import { worstInputTokens } from './budget.ts'
import { freshQuestion } from './gateway.ts'
import type { BillLine, Listing, MarketBill, MarketOffer } from './lens.ts'
import { RUN_SALT, listPriceUSD } from './oracles.ts'
import { said } from './routes.ts'
import { CannotTest, type Scenario } from './scenarios.ts'
import { until } from './trade.ts'

/** The agent's price, $1.00 a use, in µUSD. */
const PRICE_USD_MICROS = 1_000_000
/** Lens puts a billed use on the bill within a minute. */
const BILL_WAIT_MS = 90_000
const MAX_TOKENS = 16
const SYSTEM_PROMPT = 'Answer with the number only, and nothing else.'

/** One call of the listing as a model, and how many uses of it the bill held once it was answered. */
export interface ListingCall { how: 'plain' | 'streamed'; status: number; charge: string | null; error?: string; uses: number }

/** What is wrong: a call refused or not billed, the bill not one use more after each call, or a use not at the listing's price. */
export function listingAsModelFaults(calls: ListingCall[], lines: BillLine[], priceULXC: number): string[] {
  const wrong: string[] = []
  calls.forEach((c, i) => {
    if (c.status !== 200) wrong.push(`the ${c.how} call was refused: ${c.status} ${c.error ?? ''}`.trim())
    if (c.charge !== 'billed') wrong.push(`the ${c.how} answer's X-Talyvor-Listing-Charge is ${JSON.stringify(c.charge)}, not "billed"`)
    if (c.uses !== i + 1) wrong.push(`after the ${c.how} call the buyer's bill holds ${c.uses} uses of the listing, not ${i + 1}`)
  })
  const off = lines.filter((l) => l.price_ulxc !== priceULXC || l.refunded_at !== undefined)
  if (off.length > 0) wrong.push(`the bill's uses should each be billed at ${priceULXC} µLXC; these are not: ${JSON.stringify(off)}`)
  return wrong
}

export function listingAsModel(seed: number): Scenario {
  return {
    id: 'market-listing-as-model',
    owner: 'talyvor-lens',
    own: true,
    feature: 'Marketplace',
    items: ['B41.208', 'B41.79'],
    title: 'a paid agent listing called as model "listing/<id>" on the OpenAI-compatible route, once plain and once streamed: each answer says billed, and each call is exactly one billed use on the buyer\'s marketplace bill',
    run: async (ctx) => {
      const { env, app } = ctx
      const model = env.catalog.filter((m) => m.provider === 'openai' && m.output_per_1m > 0 && !m.deprecated).sort((a, b) => a.output_per_1m - b.output_per_1m)[0]
      if (model === undefined) throw new CannotTest("Lens's catalog offers no OpenAI chat model for the listing to run on")
      const [seller] = await env.lens.createUsers(1)
      const title = `Listing as a model ${seed}-${RUN_SALT}`
      const offers: MarketOffer[] = [{ kind: 'per_use', licence: 'commercial', price_usd_micros: PRICE_USD_MICROS }]
      const pub = await env.lens.act<Listing>(seller, 'POST', '/v1/workspaces/{ws}/marketplace/listings', { kind: 'agent', title, description: '', visibility: 'public',
        artifact: { system_prompt: SYSTEM_PROMPT, model: model.id }, changelog: '', offers, age_rating: 'all', content_labels: [] })
      ctx.evidence.push({ note: `the seller publishes the agent "${title}" on ${model.id} at ${PRICE_USD_MICROS} µUSD a use`, answer: said(pub) })
      if (!pub.ok) return fail(`publishing the agent "${title}" was refused: ${said(pub)}`)
      const id = pub.value.id
      if (pub.value.review_status !== 'approved') {
        if (!env.lens.canModerate) throw new CannotTest(`the listing was ${pub.value.review_status}, and approving it needs a moderator key: LENS_MODERATOR_KEY, from \`lens moderator-keys create\``)
        const ok = await env.lens.moderate(id, 'approve')
        if (!ok.ok) return fail(`approving the held listing ${id}: ${ok.status} ${ok.error}`)
      }

      const ours = (b: MarketBill) => (b.lines ?? []).filter((l) => l.listing_id === id)
      const calls: ListingCall[] = []
      let bill: MarketBill | undefined
      for (const stream of [false, true]) {
        const how = stream ? 'streamed' : 'plain'
        const question = freshQuestion()
        const hold = env.cap.reserve(listPriceUSD(model, worstInputTokens(question.length + SYSTEM_PROMPT.length), MAX_TOKENS))
        let r
        try {
          r = await env.lens.askListingAsModel(app.user, id, question, MAX_TOKENS, stream)
        } finally {
          env.cap.settle(hold, undefined)
        }
        ctx.evidence.push({ note: `the ${how} call, model listing/${id}: ${r.status}, X-Talyvor-Listing-Charge ${JSON.stringify(r.charge)}`, question, answer: r.text.slice(0, 200) })
        bill = r.status !== 200 ? await env.lens.marketBill(app.user) : await until(() => env.lens.marketBill(app.user), (b) => ours(b).length >= calls.length + 1, BILL_WAIT_MS)
        calls.push({ how, status: r.status, charge: r.charge, ...(r.status === 200 ? {} : { error: r.text }), uses: ours(bill).length })
      }
      const lines = bill === undefined ? [] : ours(bill)
      ctx.evidence.push({ note: `the buyer's bill lines for ${id}`, answer: JSON.stringify(lines) })
      const price = pub.value.price_per_use_ulxc
      const wrong = listingAsModelFaults(calls, lines, price)
      if (wrong.length > 0) return fail(wrong.join('; '))
      return { pass: true, detail: `two calls of model listing/${id} (plain, then streamed) each answered billed, and the buyer's bill gained one billed use at ${price} µLXC with each: ${lines.length} in all` }
    },
  }
}
