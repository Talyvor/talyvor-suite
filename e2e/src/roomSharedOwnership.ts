// B41.41 — shared ownership, intent only (Lens B41.141), on Lens's API, once a run, on a Free workspace of its own.
//
// The owner opens a public room and a second company joins. The member reads the room's shared ownership: off, a 25%
// pool and Lens's notice word for word. The member's attempt to switch it on is 403. The owner switches it on without
// naming a pool, and a pool of 60% is 400. Lens's own read is the oracle: the member then reads it on, the pool 25% and
// the same notice, while a third company that is not a member and a caller with no key read nothing: 404 and a refusal,
// and neither body carries the notice. The operator closes the room at the end, so a nightly run leaves nothing in the
// directory people read.
//
// A workspace that is not synthetic sees none of it until room_equity is cleared; a nightly run has only synthetic
// workspaces, so Lens proves that on real Postgres (TestRooms_SharedOwnershipIsIntentOnlyAndGatedOnRoomEquity) and the
// room screen's test proves the screen draws nothing on that 404.

import { fail } from './bank.ts'
import { RUN_SALT } from './oracles.ts'
import { said } from './routes.ts'
import { CannotTest, type Scenario, type Verdict } from './scenarios.ts'

const NOTICE =
  'No shares, options or rights arise unless and until a company is formed, a regulated partner adopts a Contributor Plan, and the Gate is met'

interface Detail { id: string; terms: { version: number } }
interface Ownership { room_id: string; enabled: boolean; pool_bps: number; notice: string }

export function roomSharedOwnership(i: number): Scenario {
  return {
    id: 'room-shared-ownership',
    owner: 'talyvor-lens',
    feature: 'Rooms',
    own: true,
    title: "a room's owner switches shared ownership on at the default 25% pool, and its members read it with Lens's notice word for word; " +
      'a member setting it is 403, a 60% pool is 400, and a stranger and a caller with no key read nothing',
    run: async (ctx): Promise<Verdict> => {
      const { lens } = ctx.env
      if (!lens.canModerate) throw new CannotTest('needs a moderator key to close the public room it opens: LENS_MODERATOR_KEY, from `lens moderator-keys create`')
      const owner = ctx.app.user
      let opened: string | undefined
      try {
        const made = await lens.act<Detail>(owner, 'POST', '/v1/workspaces/{ws}/rooms', {
          title: `Shared ownership check ${i}-${RUN_SALT}`, topic: `e2e-room-shared-ownership-${RUN_SALT}`, visibility: 'public',
          description: 'A nightly test room; the testers close it when they are done.',
        })
        ctx.evidence.push({ note: `the owner opens a public room: ${made.ok ? `${made.status} ${made.value.id}` : said(made)}` })
        if (!made.ok) return fail(`opening a room was refused: ${said(made)}`)
        const id = made.value.id
        opened = id
        const path = `/v1/rooms/${encodeURIComponent(id)}/shared-ownership`
        const [member, stranger] = await lens.createUsers(2)
        const joined = await lens.act(member, 'POST', `/v1/rooms/${encodeURIComponent(id)}/join`, { terms_version: made.value.terms.version })
        ctx.evidence.push({ note: `a second company (${member.workspaceID}) joins: ${said(joined)}` })
        if (!joined.ok) return fail(`joining the room was refused: ${said(joined)}`)

        const before = await lens.act<Ownership>(member, 'GET', path)
        ctx.evidence.push({ note: `shared ownership as the member reads it first: ${before.ok ? JSON.stringify(before.value) : said(before)}` })
        if (!before.ok) return fail(`reading the room's shared ownership was refused: ${said(before)}`)
        if (before.value.enabled || before.value.pool_bps !== 2500 || before.value.notice !== NOTICE) {
          return fail(`a new room's shared ownership reads ${JSON.stringify(before.value)} — not off, a 2,500 bps pool and the notice word for word`)
        }
        const byMember = await lens.as(member.token, 'PUT', path, { enabled: true, pool_bps: 5000 })
        ctx.evidence.push({ note: `the member switches it on at 50%: ${byMember.status} ${byMember.text.slice(0, 200)}` })
        if (byMember.status !== 403) return fail(`a member that is not the owner setting shared ownership was answered ${byMember.status} ${byMember.text.slice(0, 200)}, not 403`)

        const on = await lens.act<Ownership>(owner, 'PUT', path, { enabled: true })
        ctx.evidence.push({ note: `the owner switches it on, naming no pool: ${on.ok ? JSON.stringify(on.value) : said(on)}` })
        if (!on.ok) return fail(`the owner switching shared ownership on was refused: ${said(on)}`)
        const tooBig = await lens.as(owner.token, 'PUT', path, { enabled: true, pool_bps: 6000 })
        ctx.evidence.push({ note: `the owner asks for a 60% pool: ${tooBig.status} ${tooBig.text.slice(0, 200)}` })
        if (tooBig.status !== 400) return fail(`a 60% pool was answered ${tooBig.status} ${tooBig.text.slice(0, 200)}, not 400`)

        const after = await lens.act<Ownership>(member, 'GET', path)
        ctx.evidence.push({ note: `shared ownership as the member reads it after: ${after.ok ? JSON.stringify(after.value) : said(after)}` })
        if (!after.ok) return fail(`reading the room's shared ownership after it was switched on was refused: ${said(after)}`)
        if (!after.value.enabled || after.value.pool_bps !== 2500 || after.value.notice !== NOTICE) {
          return fail(`after the owner switched it on the member reads ${JSON.stringify(after.value)} — not on, a 2,500 bps pool and the notice word for word`)
        }
        const outsider = await lens.as(stranger.token, 'GET', path)
        const anonymous = await lens.as('', 'GET', path)
        ctx.evidence.push({ note: `a company that is not a member reads it: ${outsider.status}; a caller with no key: ${anonymous.status}` })
        if (outsider.status !== 404 || outsider.text.includes('Contributor Plan')) return fail(`a company that is not a member reading shared ownership was answered ${outsider.status} ${outsider.text.slice(0, 200)}, not 404`)
        if (anonymous.status < 400 || anonymous.text.includes('Contributor Plan')) return fail(`a caller with no key reading shared ownership was answered ${anonymous.status} ${anonymous.text.slice(0, 200)}, not a refusal`)
        return {
          pass: true,
          detail: `room ${id}: the owner switched shared ownership on at a 25% pool and the member reads it with the notice word for word; ` +
            `the member's own change was 403, a 60% pool 400, a stranger 404 and no key ${anonymous.status}`,
        }
      } finally {
        if (opened !== undefined) await lens.moderateRoom(opened, 'close', 'a nightly test room, closed by the testers').catch(() => undefined)
      }
    },
  }
}
