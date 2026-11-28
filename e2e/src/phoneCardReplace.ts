// B17.576 — Replace card and Cancel card on the phone (talyvor-mobile B28.465, the phone side of B28.47), once a run, on a workspace
// of its own, in the phone app's web export (phoneJourneys.ts openPhone, E2E_MOBILE_SRC). The run is agent-card-replace's own
// (agentCardReplace.ts): the owner funds an agent and issues it a card, and a £0.40 purchase on it posts once. Then, on the phone's
// Cards tab, the owner presses Replace card and Replace card again on the sheet that asks once: the phone sends POST
// /api/agents/{id}/card/replace, the BFF answers 201 with a new card, and the phone says the new card's last four. The next purchase
// on the agent's card posts once. The owner presses Cancel card and Cancel card on its sheet: POST …/card/cancel answers 200, the
// phone shows "No card for … yet.", and a purchase after it writes no posting. A run without the phone is a SKIP.

import { agentCardReplace, type Card, type CardEnds, type OpenEnds } from './agentCardReplace.ts'
import { openPhone, type Phone, type Sent, sentWords } from './phoneJourneys.ts'
import type { Answered } from './lens.ts'
import type { Scenario, ScenarioCtx } from './scenarios.ts'

const TIMEOUT_MS = 30_000

/** What a press answers when the phone's Cards tab draws no Replace card or Cancel card: the feature is not there. */
export const NO_ENDS = 'the phone’s Cards tab shows no Replace card and Cancel card (cards.tsx EndCard) for the agent’s card'

/** The first request after the phone's first `from` that is method to path, once the BFF has answered it. */
async function sentAfter(phone: Phone, from: number, method: string, path: string): Promise<Sent | undefined> {
  const until = Date.now() + TIMEOUT_MS
  while (Date.now() < until) {
    const s = phone.sent.slice(from).find((x) => x.method === method && x.path === path)
    if (s !== undefined) return s
    await phone.page.waitForTimeout(250)
  }
  return undefined
}

/** Replace card and Cancel card on the phone's Cards tab, as the owner presses them. */
export const onPhone: OpenEnds = async (ctx, agent) => onCards(ctx, agent, await openPhone(ctx))

/** The same, on a phone already open. */
export async function onCards(ctx: ScenarioCtx, agent: { id: string; name: string }, phone: Phone): Promise<CardEnds> {
  const { page } = phone
  await phone.open('/cards')
  // The development export's own warning toast (#error-overlay) sits over the sheet's bottom button; a phone never draws it.
  await page.addStyleTag({ content: '#error-overlay { display: none !important; }' })
  const row = page.getByTestId(`card-${agent.id}`)
  const shown = await row.getByRole('button', { name: 'Replace card', exact: true }).waitFor({ timeout: TIMEOUT_MS }).then(() => true, () => false)
  ctx.evidence.push({ note: `the phone's Cards tab, ${agent.name}'s card`, answer: shown ? 'Replace card and Cancel card are shown' : NO_ENDS })
  // Pressed on the card, then once more on the sheet that asks; what the BFF answered, and the words the phone must then draw.
  const press = async (how: 'replace' | 'cancel', label: string, words: (card: Card) => string): Promise<Answered<Card>> => {
    if (!shown) return { ok: false, status: 0, error: NO_ENDS }
    const from = phone.sent.length
    await row.getByRole('button', { name: label, exact: true }).click()
    await page.getByTestId('end-card-sheet').getByRole('button', { name: label, exact: true }).click()
    const path = `/api/agents/${agent.id}/card/${how}`
    const s = await sentAfter(phone, from, 'POST', path)
    if (s === undefined) return { ok: false, status: 0, error: `${label} sent no POST ${path}; the phone sent ${sentWords(phone.sent.slice(from))}` }
    if (s.status >= 300) return { ok: false, status: s.status, error: s.answer }
    const card = JSON.parse(s.answer) as Card
    const drawn = await row.getByText(words(card)).first().waitFor({ timeout: TIMEOUT_MS }).then(() => true, () => false)
    if (!drawn) return { ok: false, status: s.status, error: `the BFF answered ${s.status}, and the phone never said “${words(card)}”` }
    return { ok: true, status: s.status, value: card }
  }
  return {
    replace: () => press('replace', 'Replace card', (card) => `new card ends ${card.last4}`),
    cancel: () => press('cancel', 'Cancel card', () => `No card for ${agent.name} yet.`),
    close: () => phone.close(),
  }
}

export function phoneCardReplace(open: OpenEnds = onPhone): Scenario {
  return {
    ...agentCardReplace(open),
    id: 'phone-card-replace',
    // The phone journeys' owner (phoneJourneys.ts): the run has no talyvor-mobile owner.
    owner: 'talyvor-suite',
    items: ['B28.465'],
    title: "on the phone's Cards tab the owner replaces an agent's card: the phone says the new card's last four and the next purchase " +
      'posts once; cancelled there, the phone says it has no card and the next purchase writes no posting',
  }
}
