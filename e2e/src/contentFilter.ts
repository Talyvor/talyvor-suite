// B41.85 — CONTENT LABELS AND AGE RATINGS. Lens rates and labels every listing (B41.185); the app lets a workspace set a
// content filter and a seller choose a rating:
//   market-content-filter — a seller, a workspace of the run's own, publishes three prompts: one rated 18+ and labelled
//        adult, one rated for everyone, and one with no rating at all, which Lens must publish rated 18+ (no listing
//        publishes without a label). The browser's user opens Content filter, chooses the family filter (everyone only)
//        and saves it. Read back from Lens its filter is max_age_rating "all", and Lens's catalog, as that user reads it,
//        holds the everyone listing (the control: without it an empty catalog would pass) and neither 18+ one, and the 18+
//        listing's own page is not found. The filter is put back to 18+ after, so the user's later scenarios see everything.
// Nothing is used or bought, so nothing is charged.

import { ACTION_TIMEOUT_MS, fail } from './bank.ts'
import { verdictOf } from './gateway.ts'
import type { Answered } from './lens.ts'
import { RUN_SALT } from './oracles.ts'
import type { Scenario } from './scenarios.ts'

/** The run's three listings: rated 18+ and adult, rated for everyone, and published with no rating. */
export interface Rated { adult: string; family: string; unrated: string }

/** What is wrong once the family filter is set: the unrated listing not 18+, the filter not saved, or the catalog showing an 18+ listing or not the everyone one. */
export function contentFilterFaults(catalog: readonly string[], mine: Rated, unratedRating: string, savedRating: string): string[] {
  const wrong: string[] = []
  if (unratedRating !== '18+') wrong.push(`a listing published with no age rating reads ${JSON.stringify(unratedRating)}, not 18+`)
  if (savedRating !== 'all') wrong.push(`the family filter saved on Content filter reads max_age_rating ${JSON.stringify(savedRating)} from Lens, not "all"`)
  if (!catalog.includes(mine.family)) wrong.push(`the control: the listing rated for everyone ${mine.family} is not in the catalog, so the 18+ ones missing proves nothing`)
  if (catalog.includes(mine.adult)) wrong.push(`the listing rated 18+ ${mine.adult} is in the catalog of a workspace with the family filter`)
  if (catalog.includes(mine.unrated)) wrong.push(`the listing published with no rating ${mine.unrated} is in the catalog of a workspace with the family filter`)
  return wrong
}

const said = (a: Answered<unknown>): string => a.ok ? `${a.status} ${JSON.stringify(a.value).slice(0, 300)}` : `refused ${a.status}: ${a.error}`

interface Published { id: string; review_status: string; age_rating?: string }

export function marketContentFilter(): Scenario {
  return {
    id: 'market-content-filter',
    owner: 'talyvor-suite',
    feature: 'Marketplace',
    items: ['B41.85'],
    title: 'a workspace that sets the family filter on Content filter no longer finds a listing rated 18+ in the catalog, and still finds one rated for everyone; ' +
      'a listing published without a rating is rated 18+',
    run: async (ctx) => {
      const { lens } = ctx.env
      const buyer = ctx.app.user
      const [seller] = await lens.createUsers(1)
      const publish = async (title: string, content: { age_rating?: string; content_labels?: string[] }): Promise<Published> => {
        const pub = await lens.act<Published>(seller, 'POST', '/v1/workspaces/{ws}/marketplace/listings', {
          kind: 'prompt', title: `${title} ${RUN_SALT}`, description: '', price_per_use_ulxc: 0, visibility: 'public',
          artifact: { template: `${title}, in one line (${RUN_SALT}): {{text}}` }, changelog: '', ...content,
        })
        ctx.evidence.push({ note: `published "${title}": ${said(pub)}` })
        if (!pub.ok) throw new Error(`publishing "${title}" was refused: ${said(pub)}`)
        if (pub.value.review_status !== 'approved') {
          const ok = await lens.moderate(pub.value.id, 'approve')
          ctx.evidence.push({ note: `"${title}" was ${pub.value.review_status}; the operator approves it: ${said(ok)}` })
          if (!ok.ok) throw new Error(`approving the held listing ${pub.value.id}: ${said(ok)}`)
        }
        return pub.value
      }
      const adult = await publish('Write a late-night story', { age_rating: '18+', content_labels: ['adult'] })
      const family = await publish('Write a bedtime story', { age_rating: 'all', content_labels: [] })
      const unrated = await publish('Write a ghost story', {})
      const mine: Rated = { adult: adult.id, family: family.id, unrated: unrated.id }

      const page = await ctx.app.tab('/marketplace/content-filter')
      try {
        await page.getByLabel('Show listings rated for').selectOption('all', { timeout: ACTION_TIMEOUT_MS })
        await page.getByRole('button', { name: 'Save filter' }).click()
        await page.getByText('Saved. Your marketplace shows only what this filter allows.').waitFor({ timeout: ACTION_TIMEOUT_MS })
      } finally {
        await page.close()
      }
      try {
        const saved = await lens.act<{ max_age_rating: string }>(buyer, 'GET', '/v1/workspaces/{ws}/marketplace/content-filter')
        ctx.evidence.push({ note: `the filter, read back from Lens: ${said(saved)}` })
        if (!saved.ok) return fail(`reading the content filter back: ${said(saved)}`)
        const catalog = await lens.act<{ listings: { id: string }[] }>(buyer, 'GET', '/v1/marketplace/listings?kind=prompt')
        if (!catalog.ok) return fail(`GET /v1/marketplace/listings?kind=prompt: ${said(catalog)}`)
        const ids = catalog.value.listings.map((l) => l.id)
        ctx.evidence.push({ note: `the catalog with the family filter: ${ids.length} listings; ${Object.entries(mine).map(([k, v]) => `${k} ${ids.includes(v) ? 'in' : 'out'}`).join(', ')}` })
        const wrong = contentFilterFaults(ids, mine, unrated.age_rating ?? '', saved.value.max_age_rating)
        const read = await lens.act(buyer, 'GET', `/v1/marketplace/listings/${adult.id}`)
        if (read.ok) wrong.push(`the listing rated 18+ ${adult.id} reads ${read.status} for a workspace with the family filter, not 404`)
        return verdictOf(wrong, 'with the family filter saved on Content filter, the catalog held the listing rated for everyone and neither 18+ one, ' +
          'the 18+ listing read as not found, and the listing published without a rating was rated 18+')
      } finally {
        ctx.evidence.push({ note: `the filter put back to 18+: ${said(await lens.act(buyer, 'PUT', '/v1/workspaces/{ws}/marketplace/content-filter', { max_age_rating: '18+', blocked_labels: [] }))}` })
      }
    },
  }
}
