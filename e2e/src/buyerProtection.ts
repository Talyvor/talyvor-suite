// B41.90 — buyer protection at checkout, in the app, once a run.
//
// A new seller publishes a prompt listing with a $30.00 commercial rent (weekStatement.ts's publishRent). The signed-in
// person opens it, presses Rent, and the checkout must say what the 14-day holdback protects and the day it ends: no
// earlier than 14 days from today (the bill is paid at the end of its period, not before), and no later than 14 days
// after the longest period a bill can run. They press Not now: their marketplace bill — the ledger of what they owe —
// gains no line, so reading the protection costs nothing.

import { ACTION_TIMEOUT_MS, fail } from './bank.ts'
import { RUN_SALT } from './oracles.ts'
import type { Scenario } from './scenarios.ts'
import { publishRent } from './weekStatement.ts'

const DAY_MS = 86_400_000
const HOLDBACK_DAYS = 14
/** A monthly bill's period runs at most 31 days, plus a day for the UTC date the screen rounds to. */
const LONGEST_PERIOD_DAYS = 32

export function buyerProtection(seed: number): Scenario {
  return {
    id: 'buyer-protection',
    owner: 'talyvor-suite',
    feature: 'Marketplace',
    title: 'checkout says what the 14-day holdback protects and the day it ends, between 14 days and a bill period plus 14 days away; backing out bills nothing',
    run: async (ctx) => {
      const { env, app } = ctx
      const [seller] = await env.lens.createUsers(1)
      const l = await publishRent(ctx, seller, `Protected rent ${seed}-${RUN_SALT}`)
      if (typeof l === 'string') return fail(l)
      const before = (await env.lens.marketBill(app.user)).lines?.length ?? 0

      const page = await app.tab(`/marketplace/listings/${encodeURIComponent(l.id)}`)
      let text: string
      try {
        const offer = page.getByTestId('listing-offer').filter({ hasText: 'Rent' }).first()
        await offer.getByRole('button', { name: 'Rent', exact: true }).click({ timeout: ACTION_TIMEOUT_MS })
        const said = offer.getByTestId('buyer-protection')
        await said.waitFor({ timeout: ACTION_TIMEOUT_MS })
        text = (await said.innerText()).trim()
        await offer.getByRole('button', { name: 'Not now' }).click()
      } finally {
        await page.close()
      }
      ctx.evidence.push({ note: 'the checkout of the rent says', answer: text })

      const m = /^Buyer protection until (\d{1,2} \w{3} \d{4})\./.exec(text)
      if (m === null) return fail(`the checkout should open "Buyer protection until <day>."; it reads ${JSON.stringify(text)}`)
      if (!text.includes(`${HOLDBACK_DAYS} days after your bill is paid`)) return fail(`the checkout should say the seller is paid ${HOLDBACK_DAYS} days after the bill is paid; it reads ${JSON.stringify(text)}`)
      const ends = Date.parse(`${m[1]} UTC`)
      const today = Date.now() - (Date.now() % DAY_MS)
      const days = (ends - today) / DAY_MS
      if (Number.isNaN(ends) || days < HOLDBACK_DAYS || days > HOLDBACK_DAYS + LONGEST_PERIOD_DAYS) {
        return fail(`the protection ends ${m[1]}, ${days} days from today; it must be ${HOLDBACK_DAYS} to ${HOLDBACK_DAYS + LONGEST_PERIOD_DAYS} days away`)
      }
      const after = (await env.lens.marketBill(app.user)).lines?.length ?? 0
      if (after !== before) return fail(`backing out of the checkout billed: the bill went from ${before} to ${after} line(s)`)
      return { pass: true, detail: `the rent's checkout reads "Buyer protection until ${m[1]}", ${days} days away, the seller paid ${HOLDBACK_DAYS} days after the bill; Not now left the bill at ${after} line(s)` }
    },
  }
}
