// B41.93 — A PRIVACY LABEL ON EVERY LISTING. Lens reads each version's label from its own artifact (B41.193); the listing
// page shows it:
//   market-privacy-label — a seller, a workspace of the run's own, publishes a prompt on one model and a skill on another,
//        then a pipeline running the two. The browser's user opens the pipeline's page, and its privacy label must read
//        both models, no tools and "keeps nothing", and must match Lens's own label for it, read as that user: both models
//        in order and keeps_nothing. The control is the models: a page that showed nothing would not name either.
// Nothing is used or bought, so nothing is charged.

import { ACTION_TIMEOUT_MS, fail } from './bank.ts'
import { verdictOf } from './gateway.ts'
import type { Answered } from './lens.ts'
import { RUN_SALT } from './oracles.ts'
import type { Scenario } from './scenarios.ts'

/** The two models the pipeline's steps call, in order. */
export const PRIVACY_MODELS = ['gpt-4o', 'claude-sonnet-4'] as const

/** Lens market.Privacy. */
export interface Privacy { models: string[]; tools: string[]; keeps: string[]; keeps_nothing: boolean }

/** What is wrong with the label: Lens's not naming both models and keeping nothing, or the page not saying the same. */
export function privacyLabelFaults(lens: Privacy | undefined, shown: string): string[] {
  const wrong: string[] = []
  const want = `Calls ${PRIVACY_MODELS.join(', ')} · uses no tools · keeps nothing`
  if (!lens) wrong.push('Lens gave the pipeline\'s latest version no privacy label')
  else {
    if (JSON.stringify(lens.models) !== JSON.stringify(PRIVACY_MODELS)) wrong.push(`Lens's label names the models ${JSON.stringify(lens.models)}, not ${JSON.stringify(PRIVACY_MODELS)}`)
    if (lens.tools.length > 0) wrong.push(`Lens's label names the tools ${JSON.stringify(lens.tools)}, though no step uses one`)
    if (!lens.keeps_nothing || lens.keeps.length > 0) wrong.push(`Lens's label keeps ${JSON.stringify(lens.keeps)}, though no step keeps anything`)
  }
  if (shown !== want) wrong.push(`the listing page's privacy label reads ${JSON.stringify(shown)}, not ${JSON.stringify(want)}`)
  return wrong
}

const said = (a: Answered<unknown>): string => a.ok ? `${a.status} ${JSON.stringify(a.value).slice(0, 300)}` : `refused ${a.status}: ${a.error}`

interface Published { id: string; review_status: string }

export function marketPrivacyLabel(): Scenario {
  return {
    id: 'market-privacy-label',
    owner: 'talyvor-suite',
    feature: 'Marketplace',
    items: ['B41.93'],
    title: 'a listing that calls two models and keeps nothing shows both models and "keeps nothing" on its page, drawn from its own record',
    run: async (ctx) => {
      const { lens } = ctx.env
      const buyer = ctx.app.user
      const [seller] = await lens.createUsers(1)
      const publish = async (kind: string, title: string, artifact: Record<string, unknown>): Promise<Published> => {
        const pub = await lens.act<Published>(seller, 'POST', '/v1/workspaces/{ws}/marketplace/listings', {
          kind, title: `${title} ${RUN_SALT}`, description: '', price_per_use_ulxc: 0, visibility: 'public', artifact,
          changelog: '', age_rating: 'all', content_labels: [],
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
      const summary = await publish('prompt', 'One-line summary', { template: `Summarise in one line (${RUN_SALT}): {{text}}`, model: PRIVACY_MODELS[0] })
      const french = await publish('skill', 'Into French', { instructions: `Translate into French (${RUN_SALT}).`, model: PRIVACY_MODELS[1] })
      const pipeline = await publish('pipeline', 'Summary in French', { steps: [{ use: `prompt:${summary.id}` }, { use: `listing:${french.id}` }] })

      const read = await lens.act<{ latest_version: number; versions?: { version: number; privacy?: Privacy }[] }>(buyer, 'GET', `/v1/marketplace/listings/${pipeline.id}`)
      ctx.evidence.push({ note: `the pipeline, read from Lens as the browser's user: ${said(read)}` })
      if (!read.ok) return fail(`GET /v1/marketplace/listings/${pipeline.id}: ${said(read)}`)
      const label = read.value.versions?.find((v) => v.version === read.value.latest_version)?.privacy

      const page = await ctx.app.tab(`/marketplace/listings/${pipeline.id}`)
      let shown = ''
      try {
        shown = (await page.getByTestId('listing-privacy').textContent({ timeout: ACTION_TIMEOUT_MS })) ?? ''
      } finally {
        await page.close()
      }
      ctx.evidence.push({ note: `the listing page's privacy label: ${JSON.stringify(shown)}` })
      return verdictOf(privacyLabelFaults(label, shown), 'the pipeline\'s page named both models, no tools and "keeps nothing", as Lens\'s own label for it does')
    },
  }
}
