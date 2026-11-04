// B41.48 — a room's owner can change (Lens B41.148), on Lens's API, once a run, on a Free workspace of its own.
//
// The owner opens a public room and a second company joins. Lens's takeover reads name the owner, its last activity
// and when notice can be given: 60 days on. The second company gives the owner notice at once: 409, and the takeover
// still has no notice; its vote for a lead and its fork are 409 too, so a room opened today opens no fork. The owner
// hands the room to the second company. Lens's own reads are the oracle: the room's owner_workspace_id is the second
// company, its members are that company as owner and the first as an editor that may no longer spend, and the takeover reads
// the new owner. The first company, an editor now, is refused handing the room back: 403. The operator closes the room
// at the end, so a nightly run leaves nothing in the directory people read.
//
// The vote itself waits on 74 days of an owner's silence, which a nightly run cannot wait out; Lens proves it on real
// Postgres (TestRooms_InactiveOwnerIsReplacedByAPointsMajorityVote) and the room screen's test proves the screen.

import { fail } from './bank.ts'
import { RUN_SALT } from './oracles.ts'
import { said } from './routes.ts'
import { CannotTest, type Scenario, type Verdict } from './scenarios.ts'

const DAY_MS = 86_400_000

interface Member { workspace_id: string; role: string; may_spend: boolean }
interface Detail { id: string; owner_workspace_id: string; terms: { version: number }; members: Member[] | null }
interface Takeover { owner_workspace_id: string; owner_last_active_at: string; notice_from: string; notice: unknown; voting: boolean }

export function roomTakeover(i: number): Scenario {
  return {
    id: 'room-takeover',
    owner: 'talyvor-lens',
    feature: 'Rooms',
    own: true,
    title: "a room's owner hands it to a member, who Lens then reads as the owner with the old owner an editor that may not spend; " +
      'notice to an owner active today is 409 and gives none, and a vote or a fork without an unanswered notice is 409',
    run: async (ctx): Promise<Verdict> => {
      const { lens } = ctx.env
      if (!lens.canModerate) throw new CannotTest('needs a moderator key to close the public room it opens: LENS_MODERATOR_KEY, from `lens moderator-keys create`')
      const owner = ctx.app.user
      let opened: string | undefined
      try {
        const made = await lens.act<Detail>(owner, 'POST', '/v1/workspaces/{ws}/rooms', {
          title: `Takeover check ${i}-${RUN_SALT}`, topic: `e2e-room-takeover-${RUN_SALT}`, visibility: 'public',
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

        const before = await lens.act<Takeover>(member, 'GET', `${room}/takeover`)
        ctx.evidence.push({ note: `the takeover as the member reads it: ${before.ok ? JSON.stringify(before.value) : said(before)}` })
        if (!before.ok) return fail(`reading the room's takeover was refused: ${said(before)}`)
        const wait = Date.parse(before.value.notice_from) - Date.parse(before.value.owner_last_active_at)
        if (before.value.owner_workspace_id !== owner.workspaceID || wait !== 60 * DAY_MS || before.value.notice !== null || before.value.voting) {
          return fail(`the takeover of a room opened now reads ${JSON.stringify(before.value)} — not owner ${owner.workspaceID}, notice 60 days on, no notice, no vote`)
        }
        const early = await lens.as(member.token, 'POST', `${room}/takeover`)
        const vote = await lens.as(member.token, 'PUT', `${room}/takeover/vote`, { candidate_workspace_id: member.workspaceID })
        const fork = await lens.as(member.token, 'POST', `${room}/fork`)
        ctx.evidence.push({ note: `notice to an owner active today: ${early.status} ${early.text.slice(0, 200)}; a vote: ${vote.status}; a fork: ${fork.status}` })
        if (early.status !== 409) return fail(`notice to an owner active today was answered ${early.status} ${early.text.slice(0, 200)}, not 409`)
        if (vote.status !== 409 || fork.status !== 409) return fail(`without an unanswered notice a vote was ${vote.status} and a fork ${fork.status}, not 409`)
        const still = await lens.act<Takeover>(member, 'GET', `${room}/takeover`)
        if (!still.ok || still.value.notice !== null) return fail(`after the refused notice the takeover reads ${still.ok ? JSON.stringify(still.value.notice) : said(still)}, not no notice`)

        const handed = await lens.act(owner, 'POST', `${room}/owner`, { workspace_id: member.workspaceID })
        ctx.evidence.push({ note: `the owner hands the room to ${member.workspaceID}: ${said(handed)}` })
        if (!handed.ok) return fail(`handing the room over was refused: ${said(handed)}`)
        const after = await lens.act<Detail>(member, 'GET', room)
        if (!after.ok) return fail(`reading the room after the hand-over: ${said(after)}`)
        const members = after.value.members ?? []
        ctx.evidence.push({ note: `Lens's room after the hand-over: owner ${after.value.owner_workspace_id}; members ${members.map((m) => `${m.workspace_id} ${m.role} may_spend=${m.may_spend}`).join(', ')}` })
        const roleOf = (ws: string) => members.find((m) => m.workspace_id === ws)?.role
        if (after.value.owner_workspace_id !== member.workspaceID) return fail(`after the hand-over Lens reads the room's owner as ${after.value.owner_workspace_id}, not ${member.workspaceID}`)
        if (members.length !== 2 || roleOf(member.workspaceID) !== 'owner' || roleOf(owner.workspaceID) !== 'editor') {
          return fail(`after the hand-over Lens's members are ${JSON.stringify(members)} — not ${member.workspaceID} the owner and ${owner.workspaceID} an editor`)
        }
        if (members.find((m) => m.workspace_id === owner.workspaceID)?.may_spend !== false) return fail(`after the hand-over the old owner may still spend the room's money: ${JSON.stringify(members)}`)
        const lead = await lens.act<Takeover>(owner, 'GET', `${room}/takeover`)
        if (!lead.ok || lead.value.owner_workspace_id !== member.workspaceID) return fail(`after the hand-over the takeover reads ${lead.ok ? lead.value.owner_workspace_id : said(lead)} as the owner`)
        const back = await lens.as(owner.token, 'POST', `${room}/owner`, { workspace_id: owner.workspaceID })
        ctx.evidence.push({ note: `the old owner, an editor now, hands the room back: ${back.status} ${back.text.slice(0, 200)}` })
        if (back.status !== 403) return fail(`the old owner, an editor now, handing the room back was answered ${back.status} ${back.text.slice(0, 200)}, not 403`)
        return {
          pass: true,
          detail: `room ${id}: notice to an owner active today, a vote and a fork were each 409; handed to ${member.workspaceID}, Lens reads it as the owner ` +
            `and ${owner.workspaceID} as an editor that may not spend, and the editor's hand-back is 403`,
        }
      } finally {
        if (opened !== undefined) await lens.moderateRoom(opened, 'close', 'a nightly test room, closed by the testers').catch(() => undefined)
      }
    },
  }
}
