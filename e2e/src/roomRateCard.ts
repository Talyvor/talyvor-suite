// B41.42 — the room's rate card (Lens B41.142), on Lens's API, once a run, on a Free workspace of its own.
//
// The owner opens a public room and a second company joins. The owner publishes a rate card: a pool of 10,000 points,
// S at 2 hours and M at 4 hours, both at 100 points an hour; a size worth 600 points, more than 5% of the pool, is 400.
// The member proposes a prompt and claims it at size M before the work: 400 points, fixed on it. The owner accepts it.
// The owner then publishes L at 5 hours (500 points) and tries to move the accepted contribution to L, and the author
// tries the same: both are 409. Lens's own read is the oracle: the contribution reads accepted, size M, 400 points. The
// operator closes the room at the end, so a nightly run leaves nothing in the directory people read.
//
// A workspace that is not synthetic sees none of it until room_equity is cleared; a nightly run has only synthetic
// workspaces, so Lens proves that on real Postgres and the room screen's test proves the screen draws nothing on that 404.

import { fail } from './bank.ts'
import { RUN_SALT } from './oracles.ts'
import { said } from './routes.ts'
import { CannotTest, type Scenario, type Verdict } from './scenarios.ts'

interface Detail { id: string; terms: { version: number } }
interface Work { id: string; status: string; size?: string; points: number }

export function roomRateCard(i: number): Scenario {
  return {
    id: 'room-rate-card',
    owner: 'talyvor-lens',
    feature: 'Rooms',
    own: true,
    title: "a room's owner publishes a rate card and a contribution claimed at size M earns M's 400 points when accepted; " +
      'a size over 5% of the pool is 400, and raising its points after it is accepted is 409 to the owner and the author',
    run: async (ctx): Promise<Verdict> => {
      const { lens } = ctx.env
      if (!lens.canModerate) throw new CannotTest('needs a moderator key to close the public room it opens: LENS_MODERATOR_KEY, from `lens moderator-keys create`')
      const owner = ctx.app.user
      let opened: string | undefined
      try {
        const made = await lens.act<Detail>(owner, 'POST', '/v1/workspaces/{ws}/rooms', {
          title: `Rate card check ${i}-${RUN_SALT}`, topic: `e2e-room-rate-card-${RUN_SALT}`, visibility: 'public',
          description: 'A nightly test room; the testers close it when they are done.',
        })
        ctx.evidence.push({ note: `the owner opens a public room: ${made.ok ? `${made.status} ${made.value.id}` : said(made)}` })
        if (!made.ok) return fail(`opening a room was refused: ${said(made)}`)
        const id = made.value.id
        opened = id
        const room = `/v1/rooms/${encodeURIComponent(id)}`
        const [member] = await lens.createUsers(1)
        const joined = await lens.act(member, 'POST', `${room}/join`, { terms_version: made.value.terms.version })
        ctx.evidence.push({ note: `a second company (${member.workspaceID}) joins: ${said(joined)}` })
        if (!joined.ok) return fail(`joining the room was refused: ${said(joined)}`)

        const S = { size: 'S', hours: 2, points_per_hour: 100 }
        const M = { size: 'M', hours: 4, points_per_hour: 100 }
        const tooBig = await lens.as(owner.token, 'PUT', `${room}/rate-card`, { pool_points: 10000, sizes: [S, { size: 'XL', hours: 6, points_per_hour: 100 }] })
        ctx.evidence.push({ note: `the owner publishes a size worth 600 of a 10,000-point pool: ${tooBig.status} ${tooBig.text.slice(0, 200)}` })
        if (tooBig.status !== 400) return fail(`a size worth more than 5% of the pool was answered ${tooBig.status} ${tooBig.text.slice(0, 200)}, not 400`)
        const card = await lens.act(owner, 'PUT', `${room}/rate-card`, { pool_points: 10000, sizes: [S, M] })
        ctx.evidence.push({ note: `the owner publishes S and M: ${said(card)}` })
        if (!card.ok) return fail(`publishing the rate card was refused: ${said(card)}`)

        const proposed = await lens.act<Work>(member, 'POST', `${room}/contributions`,
          { kind: 'prompt', title: `Pricing tiers ${RUN_SALT}`, artifact: { template: `Name three pricing tiers for {{product}}. (rate card check ${RUN_SALT})`, model: ctx.env.judgeModel } },
          { 'Idempotency-Key': `e2e-room-rate-card-contribute-${id}` })
        ctx.evidence.push({ note: `the member proposes a prompt: ${said(proposed)}` })
        if (!proposed.ok) return fail(`the member's contribution was refused: ${said(proposed)}`)
        const one = `${room}/contributions/${encodeURIComponent(proposed.value.id)}`
        const claimed = await lens.act<Work>(member, 'PUT', `${one}/size`, { size: 'M' })
        ctx.evidence.push({ note: `the member claims size M: ${claimed.ok ? JSON.stringify(claimed.value) : said(claimed)}` })
        if (!claimed.ok) return fail(`the author claiming size M was refused: ${said(claimed)}`)
        if (claimed.value.size !== 'M' || claimed.value.points !== 400) return fail(`a contribution claimed at M reads size ${claimed.value.size} at ${claimed.value.points} points, not M at 400`)
        const accepted = await lens.act<Work>(owner, 'PATCH', one, { status: 'accepted' })
        ctx.evidence.push({ note: `the owner accepts it: ${said(accepted)}` })
        if (!accepted.ok) return fail(`the owner accepting the contribution was refused: ${said(accepted)}`)

        const bigger = await lens.act(owner, 'PUT', `${room}/rate-card`, { pool_points: 10000, sizes: [S, M, { size: 'L', hours: 5, points_per_hour: 100 }] })
        ctx.evidence.push({ note: `the owner adds L at 500 points: ${said(bigger)}` })
        if (!bigger.ok) return fail(`adding size L to the rate card was refused: ${said(bigger)}`)
        const byOwner = await lens.as(owner.token, 'PUT', `${one}/size`, { size: 'L' })
        const byAuthor = await lens.as(member.token, 'PUT', `${one}/size`, { size: 'L' })
        ctx.evidence.push({ note: `raising the accepted contribution to L: the owner ${byOwner.status} ${byOwner.text.slice(0, 160)}; the author ${byAuthor.status}` })
        if (byOwner.status !== 409) return fail(`the owner raising an accepted contribution's points was answered ${byOwner.status} ${byOwner.text.slice(0, 200)}, not 409`)
        if (byAuthor.status !== 409) return fail(`the author raising an accepted contribution's points was answered ${byAuthor.status} ${byAuthor.text.slice(0, 200)}, not 409`)

        const after = await lens.act<Work>(member, 'GET', one)
        ctx.evidence.push({ note: `the contribution as Lens reads it after: ${after.ok ? JSON.stringify(after.value) : said(after)}` })
        if (!after.ok) return fail(`reading the contribution back was refused: ${said(after)}`)
        if (after.value.status !== 'accepted' || after.value.size !== 'M' || after.value.points !== 400) {
          return fail(`after the refused raise the contribution reads ${after.value.status}, size ${after.value.size}, ${after.value.points} points — not accepted at M's 400`)
        }
        return {
          pass: true,
          detail: `room ${id}: a contribution claimed at M earned M's 400 points when accepted and kept them; a 600-point size was 400 and both raises to L were 409`,
        }
      } finally {
        if (opened !== undefined) await lens.moderateRoom(opened, 'close', 'a nightly test room, closed by the testers').catch(() => undefined)
      }
    },
  }
}
