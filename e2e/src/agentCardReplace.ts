// B17.543 — cancel and replace an agent's card (Lens B28.321, the Lens side of B28.47), on Lens's API, once a run, on a workspace
// of its own. The owner gives an agent 20 LXC of credits and issues it a test-mode card; a £0.40 purchase on it is approved and
// posts once on the agent's account. Replaced (POST …/card/replace), Lens answers 201 with a new card, another id, and GET …/card
// reads that one: the next £0.40 purchase is approved, one posting of what Lens says it cost. Cancelled (POST …/card/cancel), Lens
// answers 200 with that card cancelled and the agent holds no card (GET …/card 404): the next purchase is refused or declined and
// writes no posting, the agent's balance unmoved. A purchase on the old card after a replace cannot be asked from outside Lens —
// the synthetic purchase is always on the card the agent holds — so that half is Lens's own realpg test
// (cmd/lens/b28321_card_cancel_replace_realpg_test.go). The replace and the cancel are asked through `open` (Lens's API here; the
// phone's Cards tab in phoneCardReplace.ts), and every money oracle stays the same.

import { fail, lxcText } from './bank.ts'
import type { AgentCard, Answered } from './lens.ts'
import { RUN_SALT } from './oracles.ts'
import { books, movedBy, said, type Side } from './routes.ts'
import { CannotTest, type Scenario, type ScenarioCtx } from './scenarios.ts'

const FUND_ULXC = 20e6
const PENCE = 40
const HOLDER = { first_name: 'Test', last_name: 'Shopper', line1: '1 High Street', city: 'London', postal_code: 'EC1A 1BB', country: 'GB' }

export type Card = AgentCard & { cancelled_at?: string }

/** Replace card and Cancel card for one agent, as the owner asks them: what was answered, the card in it. */
export interface CardEnds {
  replace: () => Promise<Answered<Card>>
  cancel: () => Promise<Answered<Card>>
  close: () => Promise<void>
}

export type OpenEnds = (ctx: ScenarioCtx, agent: { id: string; name: string }) => Promise<CardEnds>

/** The owner's own Lens routes: POST …/card/replace and …/card/cancel. */
export const onLens: OpenEnds = async (ctx, agent) => {
  const ask = (how: string) => ctx.env.lens.act<Card>(ctx.app.user, 'POST', `/v1/workspaces/{ws}/agents/${agent.id}/card/${how}`, undefined)
  return { replace: () => ask('replace'), cancel: () => ask('cancel'), close: async () => undefined }
}

export function agentCardReplace(open: OpenEnds = onLens): Scenario {
  return {
    id: 'agent-card-replace',
    owner: 'talyvor-lens',
    own: true,
    agents: 1,
    feature: 'Agent Wallets',
    items: ['B28.321', 'B28.47'],
    title: "an agent's card replaced: a new card, and the next purchase on it is approved, one posting of what it cost; " +
      'cancelled: the agent holds no card and the next purchase writes no posting',
    run: async (ctx) => {
      const { lens } = ctx.env
      const user = ctx.app.user
      const agent = await lens.createAgent(user, `Card replacer ${RUN_SALT}`)
      await lens.fundAgent(user, agent.id, FUND_ULXC)
      const side: Side = { user, agent: agent.id, who: agent.name }
      const step = async <T>(method: string, path: string, body: unknown, note: string) => {
        const r = await lens.act<T>(user, method, path, body)
        ctx.evidence.push({ note, answer: said(r) })
        return r
      }
      const buy = async (shop: string) => {
        const r = await lens.cardPurchase(user, agent.id, { amount_minor: PENCE, currency: 'gbp', merchant: `${shop} ${RUN_SALT}` })
        ctx.evidence.push({ note: `a £0.${PENCE} purchase at ${shop}`, answer: said(r) })
        return r
      }
      let ends: CardEnds | undefined
      try {
        // 1. A card, and one purchase on it that posts.
        const issued = await step<Card>('POST', `/v1/workspaces/{ws}/agents/${agent.id}/card`, HOLDER, `the owner issues ${agent.name} a card`)
        if (issued.status !== 201 || !issued.ok) return fail(`issuing ${agent.name} a card must answer 201; Lens answered ${said(issued)}`)
        const old = issued.value
        let before = await books(ctx, [side])
        const first = await buy('First shop')
        if (!first.ok || !first.value.approved) return fail(`a £0.${PENCE} purchase on a new card of an agent holding ${lxcText(FUND_ULXC)} LXC must be approved; Lens answered ${said(first)}`)
        let wrong = await movedBy(ctx, [side], before, [-first.value.amount_ulxc], 'a purchase on the first card')
        if (wrong !== undefined) return fail(wrong)

        // 2. Replaced: a new card, the one the agent holds, and a purchase on it posts once.
        ends = await open(ctx, agent)
        const replaced = await ends.replace()
        ctx.evidence.push({ note: `the owner replaces ${agent.name}'s card`, answer: said(replaced) })
        if (replaced.status !== 201 || !replaced.ok || replaced.value.id === old.id || replaced.value.cancelled_at !== undefined) {
          return fail(`replacing the card must answer 201 with a new card, not ${old.id}; Lens answered ${said(replaced)}`)
        }
        const next = replaced.value
        const held = await lens.agentCard(user, agent.id)
        ctx.evidence.push({ note: `${agent.name}'s card after the replace`, answer: JSON.stringify(held) })
        if (held?.id !== next.id) return fail(`after the replace ${agent.name} must hold the new card ${next.id}; Lens reads ${JSON.stringify(held)}`)
        before = await books(ctx, [side])
        const second = await buy('Second shop')
        if (!second.ok || !second.value.approved || !(second.value.amount_ulxc > 0)) return fail(`a purchase on the new card must be approved at a cost; Lens answered ${said(second)}`)
        wrong = await movedBy(ctx, [side], before, [-second.value.amount_ulxc], 'a purchase on the new card')
        if (wrong !== undefined) return fail(wrong)

        // 3. Cancelled: no card, and a purchase after it writes no posting.
        const cancelled = await ends.cancel()
        ctx.evidence.push({ note: `the owner cancels ${agent.name}'s card`, answer: said(cancelled) })
        if (cancelled.status !== 200 || !cancelled.ok || cancelled.value.id !== next.id || cancelled.value.cancelled_at === undefined) {
          return fail(`cancelling the card must answer 200 with ${next.id} cancelled; Lens answered ${said(cancelled)}`)
        }
        const none = await lens.agentCard(user, agent.id)
        ctx.evidence.push({ note: `${agent.name}'s card after the cancel`, answer: JSON.stringify(none) })
        if (none !== null) return fail(`after the cancel ${agent.name} must hold no card (GET …/card 404); Lens reads ${JSON.stringify(none)}`)
        before = await books(ctx, [side])
        const third = await buy('Third shop')
        if (third.ok && third.value.approved) return fail(`a purchase after the card was cancelled must be refused or declined; Lens approved it: ${said(third)}`)
        wrong = await movedBy(ctx, [side], before, [0], 'a purchase after the cancel')
        if (wrong !== undefined) return fail(wrong)
        return {
          pass: true,
          detail: `${agent.name}'s card ${old.id} paid £0.${PENCE} (${lxcText(first.value.amount_ulxc)} LXC, one posting); replaced by ${next.id}, ` +
            `the next paid ${lxcText(second.value.amount_ulxc)} LXC, one posting; cancelled, the agent held no card and a purchase was ` +
            `${third.ok ? 'declined' : `refused ${third.status}`}, no posting`,
        }
      } catch (e) {
        if (e instanceof CannotTest) throw e
        return fail((e as Error).message)
      } finally {
        await ends?.close()
      }
    },
  }
}
