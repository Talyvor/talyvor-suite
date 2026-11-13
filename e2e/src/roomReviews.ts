// B41.44 — a contribution's quality, scored by two reviewers Lens draws at random (Lens B41.144), on Lens's API, once a
// run, on a Free workspace of its own.
//
// The owner opens a public room and four other companies join: an author and three plain members. The author proposes a
// prompt and asks for its reviewers naming itself, which Lens must ignore: both seats go to members that are neither the
// author nor the owner. The author's own score is refused. One reviewer scores ×1.2 and the quality stays 1.0 until the
// other scores ×1.4; then it is their median, ×1.3. Lens's own read of GET .../reviews is the oracle. The operator closes
// the room at the end, so a nightly run leaves nothing in the directory people read.

import { fail } from './bank.ts'
import { RUN_SALT } from './oracles.ts'
import { said } from './routes.ts'
import { CannotTest, type Scenario, type Verdict } from './scenarios.ts'

interface Detail { id: string; terms: { version: number } }
interface Work { id: string }
interface Reviews { quality_bps: number; reviews: { reviewer_workspace_id: string; score_bps: number | null; ring: boolean }[] }

export function roomReviews(i: number): Scenario {
  return {
    id: 'room-reviews',
    owner: 'talyvor-lens',
    feature: 'Rooms',
    own: true,
    title: 'a contribution’s two reviewers are members Lens draws, never its author even when the author names itself, and its quality is ' +
      'the median of their scores',
    run: async (ctx): Promise<Verdict> => {
      const { lens } = ctx.env
      if (!lens.canModerate) throw new CannotTest('needs a moderator key to close the public room it opens: LENS_MODERATOR_KEY, from `lens moderator-keys create`')
      const owner = ctx.app.user
      let opened: string | undefined
      try {
        const made = await lens.act<Detail>(owner, 'POST', '/v1/workspaces/{ws}/rooms', {
          title: `Reviews check ${i}-${RUN_SALT}`, topic: `e2e-room-reviews-${RUN_SALT}`, visibility: 'public',
          description: 'A nightly test room; the testers close it when they are done.',
        })
        ctx.evidence.push({ note: `the owner opens a public room: ${made.ok ? `${made.status} ${made.value.id}` : said(made)}` })
        if (!made.ok) return fail(`opening a room was refused: ${said(made)}`)
        const id = made.value.id
        opened = id
        const room = `/v1/rooms/${encodeURIComponent(id)}`
        const [author, ...members] = await lens.createUsers(4)
        for (const u of [author, ...members]) {
          const joined = await lens.act(u, 'POST', `${room}/join`, { terms_version: made.value.terms.version })
          ctx.evidence.push({ note: `${u.workspaceID} joins: ${said(joined)}` })
          if (!joined.ok) return fail(`joining the room was refused: ${said(joined)}`)
        }
        const proposed = await lens.act<Work>(author, 'POST', `${room}/contributions`,
          { kind: 'prompt', title: `Launch risks ${RUN_SALT}`, artifact: { template: `List three launch risks for {{product}}. (reviews check ${RUN_SALT})`, model: ctx.env.judgeModel } },
          { 'Idempotency-Key': `e2e-room-reviews-contribute-${id}` })
        ctx.evidence.push({ note: `the author proposes a prompt: ${said(proposed)}` })
        if (!proposed.ok) return fail(`the author's contribution was refused: ${said(proposed)}`)
        const one = `${room}/contributions/${encodeURIComponent(proposed.value.id)}`

        const drawn = await lens.act<Reviews>(author, 'POST', `${one}/reviewers`, { reviewer_workspace_id: author.workspaceID })
        ctx.evidence.push({ note: `the author asks for reviewers, naming itself: ${drawn.ok ? JSON.stringify(drawn.value) : said(drawn)}` })
        if (!drawn.ok) return fail(`drawing the reviewers was refused: ${said(drawn)}`)
        const seated = drawn.value.reviews.map((v) => v.reviewer_workspace_id)
        const plain = new Set(members.map((m) => m.workspaceID))
        if (seated.length !== 2 || new Set(seated).size !== 2 || !seated.every((ws) => plain.has(ws))) {
          return fail(`the reviewers seated are ${JSON.stringify(seated)}, not two of the plain members ${JSON.stringify([...plain])}: ` +
            `the author ${author.workspaceID}, the owner ${owner.workspaceID}, or nobody, took a seat`)
        }
        const self = await lens.act(author, 'PUT', `${one}/review`, { score_bps: 15_000 })
        ctx.evidence.push({ note: `the author tries to score its own work ×1.5: ${said(self)}` })
        if (self.ok) return fail(`the author scored its own contribution: ${said(self)}`)

        const reviewer = (ws: string) => members.find((m) => m.workspaceID === ws)!
        const first = await lens.act<Reviews>(reviewer(seated[0]), 'PUT', `${one}/review`, { score_bps: 12_000 })
        ctx.evidence.push({ note: `the first reviewer scores ×1.2: ${first.ok ? JSON.stringify(first.value) : said(first)}` })
        if (!first.ok) return fail(`the first reviewer's score was refused: ${said(first)}`)
        if (first.value.quality_bps !== 10_000) return fail(`with one score in, quality reads ${first.value.quality_bps} bps, not 10000 until both score`)
        const second = await lens.act<Reviews>(reviewer(seated[1]), 'PUT', `${one}/review`, { score_bps: 14_000 })
        ctx.evidence.push({ note: `the second reviewer scores ×1.4: ${second.ok ? JSON.stringify(second.value) : said(second)}` })
        if (!second.ok) return fail(`the second reviewer's score was refused: ${said(second)}`)
        const read = await lens.act<Reviews>(author, 'GET', `${one}/reviews`)
        ctx.evidence.push({ note: `the author reads the reviews: ${read.ok ? JSON.stringify(read.value) : said(read)}` })
        if (!read.ok) return fail(`reading the reviews was refused: ${said(read)}`)
        if (read.value.reviews.some((v) => v.ring)) return fail(`a reviewer counts as a ring though nobody scored the other's work: ${JSON.stringify(read.value)}`)
        if (read.value.quality_bps !== 13_000) return fail(`with ×1.2 and ×1.4 in, quality reads ${read.value.quality_bps} bps, not their median 13000`)
        return {
          pass: true,
          detail: `room ${id}: Lens seated ${seated.join(' and ')}, neither the author nor the owner, though the author named itself; ` +
            `the author's own score was refused (${self.status}), and the quality is their median, ${read.value.quality_bps} bps`,
        }
      } finally {
        if (opened !== undefined) await lens.moderateRoom(opened, 'close', 'a nightly test room, closed by the testers').catch(() => undefined)
      }
    },
  }
}
