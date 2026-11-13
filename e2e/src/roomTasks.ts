// B41.52 — a room's open tasks board (Lens B41.152), on Lens's API, once a run, on a Free workspace of its own.
//
// The owner opens a public room, publishes M at 400 points and two members join. A task body naming an assignee, and one
// carrying a due date, are each 400: nothing in the task model can assign a task or set a deadline. The owner posts an
// M-size task and its 400 points are fixed on it. One member claims it; the other reads the board, sees that claim, and
// its own claim is 409. The first lets it go, and the second then claims it. The operator closes the room at the end.

import { fail } from './bank.ts'
import { RUN_SALT } from './oracles.ts'
import { said } from './routes.ts'
import { CannotTest, type Scenario, type Verdict } from './scenarios.ts'

interface Detail { id: string; terms: { version: number } }
interface Task { id: string; size: string; points: number; claimant_workspace_id?: string }

export function roomTasks(i: number): Scenario {
  return {
    id: 'room-tasks',
    owner: 'talyvor-lens',
    feature: 'Rooms',
    own: true,
    title: 'a task posted at a size on the rate card is claimed by one member, that claim is what another member reads, ' +
      'and no task can name an assignee or a due date',
    run: async (ctx): Promise<Verdict> => {
      const { lens } = ctx.env
      if (!lens.canModerate) throw new CannotTest('needs a moderator key to close the public room it opens: LENS_MODERATOR_KEY, from `lens moderator-keys create`')
      const owner = ctx.app.user
      let opened: string | undefined
      try {
        const made = await lens.act<Detail>(owner, 'POST', '/v1/workspaces/{ws}/rooms', {
          title: `Tasks check ${i}-${RUN_SALT}`, topic: `e2e-room-tasks-${RUN_SALT}`, visibility: 'public',
          description: 'A nightly test room; the testers close it when they are done.',
        })
        ctx.evidence.push({ note: `the owner opens a public room: ${made.ok ? `${made.status} ${made.value.id}` : said(made)}` })
        if (!made.ok) return fail(`opening a room was refused: ${said(made)}`)
        const id = made.value.id
        opened = id
        const room = `/v1/rooms/${encodeURIComponent(id)}`
        const card = await lens.act(owner, 'PUT', `${room}/rate-card`, { pool_points: 10000, sizes: [{ size: 'M', hours: 4, points_per_hour: 100 }] })
        if (!card.ok) return fail(`publishing the rate card was refused: ${said(card)}`)
        const [ada, bob] = await lens.createUsers(2)
        for (const u of [ada, bob]) {
          const joined = await lens.act(u, 'POST', `${room}/join`, { terms_version: made.value.terms.version })
          if (!joined.ok) return fail(`${u.workspaceID} joining the room was refused: ${said(joined)}`)
        }

        const draft = { title: `Write the launch FAQ ${RUN_SALT}`, description: 'Ten questions a new member asks.', size: 'M' }
        for (const extra of [{ assignee_workspace_id: ada.workspaceID }, { due_at: new Date(Date.now() + 7 * 86_400_000).toISOString() }]) {
          const named = await lens.as(owner.token, 'POST', `${room}/tasks`, { ...draft, ...extra })
          ctx.evidence.push({ note: `a task with ${Object.keys(extra)[0]}: ${named.status} ${named.text.slice(0, 200)}` })
          if (named.status !== 400) return fail(`a task body carrying ${Object.keys(extra)[0]} was answered ${named.status} ${named.text.slice(0, 200)}, not 400`)
        }
        const posted = await lens.act<Task>(owner, 'POST', `${room}/tasks`, draft)
        ctx.evidence.push({ note: `the owner posts an M-size task: ${posted.ok ? `${posted.status} ${JSON.stringify(posted.value)}` : said(posted)}` })
        if (!posted.ok || posted.status !== 201) return fail(`posting a task answered ${said(posted)}, not 201`)
        if (posted.value.points !== 400 || posted.value.claimant_workspace_id) return fail(`the posted task reads ${JSON.stringify(posted.value)}, not open at M's 400 points`)
        const claim = `${room}/tasks/${encodeURIComponent(posted.value.id)}/claim`

        const took = await lens.act<Task>(ada, 'POST', claim)
        if (!took.ok || took.value.claimant_workspace_id !== ada.workspaceID) return fail(`${ada.workspaceID} claiming the task answered ${took.ok ? JSON.stringify(took.value) : said(took)}`)
        const board = await lens.act<Task[]>(bob, 'GET', `${room}/tasks`)
        ctx.evidence.push({ note: `another member reads the board: ${board.ok ? JSON.stringify(board.value) : said(board)}` })
        if (!board.ok) return fail(`another member reading the board was refused: ${said(board)}`)
        const seen = board.value.find((t) => t.id === posted.value.id)
        if (seen?.claimant_workspace_id !== ada.workspaceID) return fail(`another member reads the task as ${JSON.stringify(seen)}, not claimed by ${ada.workspaceID}`)
        const steal = await lens.as(bob.token, 'POST', claim)
        ctx.evidence.push({ note: `another member claims a held task: ${steal.status} ${steal.text.slice(0, 200)}` })
        if (steal.status !== 409) return fail(`a member claiming a task another holds was answered ${steal.status} ${steal.text.slice(0, 200)}, not 409`)

        const let_ = await lens.act<Task>(ada, 'DELETE', claim)
        if (!let_.ok || let_.value.claimant_workspace_id) return fail(`the claimant letting the task go answered ${let_.ok ? JSON.stringify(let_.value) : said(let_)}`)
        const next = await lens.act<Task>(bob, 'POST', claim)
        ctx.evidence.push({ note: `once it is let go, the other member claims it: ${next.ok ? JSON.stringify(next.value) : said(next)}` })
        if (!next.ok || next.value.claimant_workspace_id !== bob.workspaceID) return fail(`claiming the released task answered ${next.ok ? JSON.stringify(next.value) : said(next)}`)
        return {
          pass: true,
          detail: `room ${id}: a task body naming an assignee or a due date was 400; an M-size task was posted at 400 points, ${ada.workspaceID}'s claim ` +
            `was what ${bob.workspaceID} read and its own claim was 409, and once let go ${bob.workspaceID} claimed it`,
        }
      } finally {
        if (opened !== undefined) await lens.moderateRoom(opened, 'close', 'a nightly test room, closed by the testers').catch(() => undefined)
      }
    },
  }
}
