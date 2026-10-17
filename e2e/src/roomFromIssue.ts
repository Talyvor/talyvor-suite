// B41.61 — a room opened from a Track issue, once a run, on a Team workspace of its own (an issue's room is private).
//
// The owner files a Track issue, opens it on the issue screen and follows "Open a room": the new-room form
// (apps/web Rooms.tsx, /rooms/new?issue=<id>) starts with the issue's title and description, private, and Open room
// opens it. Lens's reads are the oracle, never the screen alone: the room's title is the issue's, its description is the
// issue's text ending with the line linking back to /track/issues/<id>, and its first message is the issue as Chat attaches
// it (TrackIssuePicker trackIssueText). The room screen shows the issue's identifier as a link to the issue. The operator
// closes the room at the end, when the run has a moderator key.

import { ACTION_TIMEOUT_MS, fail } from './bank.ts'
import { RUN_SALT } from './oracles.ts'
import { bff, said } from './routes.ts'
import type { Scenario, Verdict } from './scenarios.ts'

interface TrackIssue { id: string; identifier: string; title: string }
interface Room { id: string; title: string; description: string; visibility: string }

export function roomFromIssue(i: number): Scenario {
  return {
    id: 'room-from-issue',
    owner: 'talyvor-suite',
    feature: 'Rooms',
    plan: 'team',
    own: true,
    title: "a room opened from a Track issue's screen has the issue's title, its description ending with a link back to the issue, and the issue " +
      'as its first message; the room screen links back to the issue',
    run: async (ctx): Promise<Verdict> => {
      const { page, user: owner } = ctx.app
      const { lens } = ctx.env
      const origin = new URL(page.url()).origin
      let opened: string | undefined
      try {
        const teams = await bff<{ id: string }[]>(ctx, 'GET', '/api/track/teams')
        if (!teams.ok || teams.value[0] === undefined) return fail(`Track named no team to file an issue in: ${said(teams)}`)
        const word = `kestrel${RUN_SALT}`.toLowerCase()
        const made = await bff<TrackIssue>(ctx, 'POST', '/api/track/issues', {
          title: `Room check ${i}-${RUN_SALT}`, description: `The cache code word is ${word}.`, team_id: teams.value[0].id,
        })
        ctx.evidence.push({ note: `the owner (${owner.workspaceID}) files a Track issue: ${said(made)}` })
        if (!made.ok) return fail(`filing a Track issue was refused: ${said(made)}`)
        const issue = made.value
        const issuePath = `/track/issues/${encodeURIComponent(issue.id)}`

        await page.goto(`${origin}${issuePath}`)
        await page.getByRole('link', { name: 'Open a room', exact: true }).click()
        const title = page.getByLabel('Title', { exact: true })
        // The form fills in once the issue is read.
        const until = Date.now() + ACTION_TIMEOUT_MS
        while ((await title.inputValue()) !== issue.title && Date.now() < until) await page.waitForTimeout(250)
        if ((await title.inputValue()) !== issue.title) {
          return fail(`the new-room form from issue ${issue.identifier} does not start with its title: ${JSON.stringify(await title.inputValue())}`)
        }
        const [create] = await Promise.all([
          page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/rooms', { timeout: ACTION_TIMEOUT_MS }),
          page.getByRole('button', { name: 'Open room', exact: true }).click(),
        ])
        ctx.evidence.push({ note: `Open room: POST /api/rooms answered ${create.status()}` })
        if (create.status() >= 300) return fail(`opening the room from issue ${issue.identifier} was answered ${create.status()} ${await create.text()}`)
        const id = ((await create.json()) as { id: string }).id
        opened = id

        const room = await lens.act<Room>(owner, 'GET', `/v1/rooms/${encodeURIComponent(id)}`)
        ctx.evidence.push({ note: `Lens's room: ${said(room)}` })
        if (!room.ok) return fail(`reading room ${id} as its owner: ${said(room)}`)
        const line = `From Track issue ${issue.identifier}: ${origin}${issuePath}`
        if (room.value.title !== issue.title || room.value.visibility !== 'private') {
          return fail(`room ${id} is "${room.value.title}" (${room.value.visibility}), not the issue's title "${issue.title}", private`)
        }
        if (!room.value.description.includes(word) || !room.value.description.endsWith(line)) {
          return fail(`room ${id}'s description does not carry the issue's text and end with "${line}": ${JSON.stringify(room.value.description).slice(0, 300)}`)
        }
        const first = (await lens.roomMessages(owner, id)).find((m) => m.author_workspace_id === owner.workspaceID)
        if (first === undefined || !first.body.startsWith(`# ${issue.identifier} ${issue.title}`) || !first.body.includes(word)) {
          return fail(`room ${id}'s first message is not the issue: ${JSON.stringify(first?.body ?? null).slice(0, 300)}`)
        }
        const back = await page.getByRole('link', { name: issue.identifier, exact: true }).getAttribute('href', { timeout: ACTION_TIMEOUT_MS }).catch(() => null)
        if (back !== issuePath) return fail(`the room screen's link back to ${issue.identifier} is ${JSON.stringify(back)}, not ${issuePath}`)
        return {
          pass: true,
          detail: `room ${id}, opened from issue ${issue.identifier}'s screen, has its title, a private room, its description ending with the link back, ` +
            'the issue as its first message, and the room screen links back to the issue',
        }
      } finally {
        if (opened !== undefined && lens.canModerate) await lens.moderateRoom(opened, 'close', 'a nightly test room, closed by the testers').catch(() => undefined)
      }
    },
  }
}
