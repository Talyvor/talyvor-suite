// B55.44 — the Pocket problems in Rooms: paying members out from the app (12), and members, authors and refusals by name
// and in words (18). Words from B55.28, B55.34 and B55.35.

import { ACTION_TIMEOUT_MS, fail } from '../bank.ts'
import type { SyntheticUser } from '../lens.ts'
import { RUN_SALT } from '../oracles.ts'
import { said } from '../routes.ts'
import type { Scenario, ScenarioCtx } from '../scenarios.ts'
import { acceptMoneyTerms, account } from './approvals.ts'
import { BLANK, bothSizes, machineWords, screenAt, step } from './press.ts'

type Bare = Omit<Scenario, 'id' | 'items'>

/** A private room of the owner's, a named second company joined by its invite, and the room's wallet. */
async function roomWithMember(ctx: ScenarioCtx, title: string): Promise<{ id: string; wallet: { agent_id: string; name: string }; member: SyntheticUser; memberName: string }> {
  const { lens } = ctx.env
  const owner = ctx.app.user
  const named = await step(ctx, 'PUT', '/v1/workspaces/{ws}/name', { name: `Ana's studio ${RUN_SALT}` }, 'the owner names the workspace')
  if (!named.ok) throw new Error(`naming the owner's workspace answered ${said(named)}`)
  const made = await step<{ id: string }>(ctx, 'POST', '/v1/workspaces/{ws}/rooms', { title: `${title} ${RUN_SALT}`, topic: `pocket-${RUN_SALT}`, visibility: 'private',
    description: 'A nightly test room.' }, 'the owner opens a private room')
  if (!made.ok) throw new Error(`opening a private room answered ${said(made)}`)
  const id = made.value.id
  const detail = await lens.room(owner, id)
  if (detail.wallet === undefined) throw new Error(`room ${id} shows its owner no wallet`)
  const invite = await step<{ token: string }>(ctx, 'POST', `/v1/rooms/${encodeURIComponent(id)}/invites`, { max_uses: 1, expires_at: new Date(Date.now() + 3600_000).toISOString() }, 'the owner makes an invite')
  if (!invite.ok) throw new Error(`making an invite answered ${said(invite)}`)
  const [member] = await lens.createUsers(1)
  const memberName = `Ben's lab ${RUN_SALT}`
  const n = await lens.act(member, 'PUT', '/v1/workspaces/{ws}/name', { name: memberName })
  if (!n.ok) throw new Error(`naming the member's workspace answered ${said(n)}`)
  const joined = await lens.joinRoomByInvite(member, invite.value.token, detail.terms.version)
  ctx.evidence.push({ note: `${memberName} joins by the invite`, answer: said(joined) })
  if (!joined.ok) throw new Error(`joining by the invite answered ${said(joined)}`)
  return { id, wallet: detail.wallet, member, memberName }
}

/** 12 — the room's owner pays members by the room's split from the app; Lens's payouts hold the member's share (B55.28). */
export function roomPayout(): Bare {
  return {
    owner: 'talyvor-suite',
    feature: 'Rooms',
    agents: 1,
    title: "a room's owner pays its member by the room's split from the room's settings, and Lens's payouts hold the member's share",
    run: async (ctx) => {
      const room = await roomWithMember(ctx, 'Payout room')
      await acceptMoneyTerms(ctx)
      await account(ctx, 'GBP', 0)
      await account(ctx, 'GBP', 10_000, room.wallet.agent_id)
      const page = await ctx.app.tab(`/rooms/${room.id}/settings`)
      try {
        await bothSizes(ctx, page, 'pocket-12-settings')
        const payOut = page.getByRole('button', { name: 'Pay out' })
        if ((await payOut.count()) === 0) return fail(`the room's settings have no Pay out: its owner can pay members only on Lens's API`)
        await page.getByLabel(/Amount/).first().fill('20.00')
        await payOut.first().click()
        const ask = page.getByText(/^Pay .* members? by this room.s terms\?$/)
        await ask.waitFor({ timeout: ACTION_TIMEOUT_MS })
        await page.getByRole('dialog').getByRole('button', { name: 'Pay out' }).click()
        await page.getByText(room.memberName).last().waitFor({ timeout: ACTION_TIMEOUT_MS })
        await bothSizes(ctx, page, 'pocket-12-paid')
      } finally {
        await page.close()
      }
      const paid = await step<{ payouts: { amount_minor: number; currency: string; payee_workspace_id?: string; workspace_id?: string }[] | null }>(ctx, 'GET', '/v1/money/earnings-payouts', undefined, "the owner's payouts")
      const share = (paid.ok ? paid.value.payouts ?? [] : []).find((p) => JSON.stringify(p).includes(room.member.workspaceID) && p.currency === 'GBP')
      if (share === undefined) return fail(`after Pay out, Lens's payouts hold no GBP share for ${room.memberName}: ${said(paid)}`)
      return { pass: true, detail: `paid out £20.00 by the split from the room's settings; Lens holds ${room.memberName}'s share of ${share.amount_minor}` }
    },
  }
}

/** 18 — rooms name members and authors, and a member's spend reason and a budget past the plan read in words (B55.34, B55.35, B55.29). */
export function roomNames(): Bare {
  return {
    owner: 'talyvor-lens',
    feature: 'Rooms',
    agents: 1,
    title: "a room lists its member and its message's author by workspace name, never an id, and a member's spend reason and a budget past the plan read in words",
    run: async (ctx) => {
      const { lens } = ctx.env
      const room = await roomWithMember(ctx, 'Names room')
      await lens.postRoomMessage(room.member, room.id, `Hello from ${room.memberName}`)
      const wrong: string[] = []
      for (const path of [`/rooms/${room.id}`, `/rooms/${room.id}/settings`]) {
        for (const { width, text } of await screenAt(ctx, path, `pocket-18-${path.endsWith('settings') ? 'settings' : 'room'}`)) {
          if (BLANK.test(text)) wrong.push(`${path} at ${width}px could not be read`)
          if (text.includes(room.member.workspaceID) || text.includes(ctx.app.user.workspaceID)) wrong.push(`${path} at ${width}px shows a workspace's raw id`)
          if (!text.includes(room.memberName)) wrong.push(`${path} at ${width}px does not name the member "${room.memberName}"`)
        }
      }
      const why = (await lens.room(room.member, room.id)).wallet?.why_not ?? ''
      ctx.evidence.push({ note: "the member reads why it may not spend the room's wallet", answer: why })
      if (machineWords(why).length > 0) wrong.push(`the member's reason it may not spend reads "${why}", not words`)
      const rules = `/v1/workspaces/{ws}/agents/${room.wallet.agent_id}/rules`
      const over = await step(ctx, 'PUT', rules, { ...await lens.agentRules(ctx.app.user, room.wallet.agent_id), monthly_limit_ulxc: 1e15 }, "a room budget past the plan's")
      if (over.ok) wrong.push("a room budget past the plan's was saved")
      else if (machineWords(said(over)).length > 0) wrong.push(`a room budget past the plan's is refused as "${said(over)}", not in words`)
      if (wrong.length > 0) return fail(wrong.join('; '))
      return { pass: true, detail: `the room and its settings name ${room.memberName}, never an id; the spend reason and the plan's refusal read in words` }
    },
  }
}
