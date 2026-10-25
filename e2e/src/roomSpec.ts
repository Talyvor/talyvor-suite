// B41.60 — a Docs page as the room's living spec, on Lens's API, once a run, on a Team workspace of its own.
//
// The room screen attaches a Docs page by posting its text to the room as a spec message (apps/web RoomSpec.tsx
// specBody), and posts the page again, as the spec's update, when it is edited in Docs. The room's AI reads the room's
// latest messages (POST /v1/rooms/{id}/ask), so its answer is the oracle: the owner opens a private room, posts a spec
// naming a code word of the run's own and asks the AI for it — the answer carries it; the owner then posts the update
// naming a second word, asks again, and the answer carries the second. The room's messages read both spec messages by
// the owner, the update last. The operator closes the room at the end, when the run has a moderator key.

import { fail } from './bank.ts'
import { RUN_SALT } from './oracles.ts'
import { said } from './routes.ts'
import type { Scenario, Verdict } from './scenarios.ts'

/** The spec message's body exactly as RoomSpec.tsx specBody writes it (a page short enough not to be clipped). */
function specBody(title: string, spaceId: string, pageId: string, savedAt: string, text: string, updated: boolean): string {
  return `Room spec${updated ? ' updated' : ''}: ${title}\n/docs/spaces/${encodeURIComponent(spaceId)}/pages/${encodeURIComponent(pageId)} · ${savedAt}\n\n${text.trim()}`
}

export function roomSpec(i: number): Scenario {
  return {
    id: 'room-spec',
    owner: 'talyvor-suite',
    feature: 'Rooms',
    // A private room: Free opens none.
    plan: 'team',
    own: true,
    title: "a room's spec, posted from a Docs page, is in the room's AI's context, and its update replaces it: asked for the spec's code word, the AI " +
      'answers the word the latest spec names',
    run: async (ctx): Promise<Verdict> => {
      const { lens } = ctx.env
      const owner = ctx.app.user
      let opened: string | undefined
      try {
        const made = await lens.act<{ id: string }>(owner, 'POST', '/v1/workspaces/{ws}/rooms', {
          title: `Spec check ${i}-${RUN_SALT}`, topic: `e2e-room-spec-${RUN_SALT}`, visibility: 'private', description: 'A nightly test room.',
        })
        ctx.evidence.push({ note: `the owner (${owner.workspaceID}) opens a private room: ${said(made)}` })
        if (!made.ok) return fail(`opening a private room was refused: ${said(made)}`)
        const id = made.value.id
        opened = id
        const room = `/v1/rooms/${encodeURIComponent(id)}`
        const words = [`heron${RUN_SALT}`.toLowerCase(), `quartz${RUN_SALT}`.toLowerCase()]

        for (const [n, word] of words.entries()) {
          const body = specBody('Launch spec', 'sp_e2e', 'pg_e2e', `2026-10-17T0${n}:00:00Z`, `The release code word is ${word}.`, n > 0)
          const posted = await lens.act(owner, 'POST', `${room}/messages`, { body })
          ctx.evidence.push({ note: `the owner posts the spec${n > 0 ? "'s update" : ''} naming ${word}: ${said(posted)}` })
          if (!posted.ok) return fail(`posting the room's spec was refused: ${said(posted)}`)
          const asked = await lens.act<{ answer?: string }>(owner, 'POST', `${room}/ask`, {
            question: "What is the release code word in the room's latest spec? Reply with the code word only.", model: ctx.env.judgeModel, pay: 'self',
          })
          ctx.evidence.push({ note: `the owner asks the room's AI for the code word: ${said(asked)}` })
          if (!asked.ok) return fail(`asking the room's AI was refused: ${said(asked)}`)
          if (!(asked.value.answer ?? '').toLowerCase().includes(word)) {
            return fail(`the room's AI, asked for the code word after the spec${n > 0 ? "'s update" : ''} named ${word}, answered ${JSON.stringify(asked.value.answer)}`)
          }
        }
        const specs = (await lens.roomMessages(owner, id)).filter((m) => m.author_workspace_id === owner.workspaceID && m.body.startsWith('Room spec'))
        if (specs.length !== 2 || !specs[1].body.startsWith('Room spec updated: ') || !specs[1].body.includes(words[1])) {
          return fail(`room ${id} holds ${specs.length} spec message(s) by the owner, not the spec then its update naming ${words[1]}: ${JSON.stringify(specs).slice(0, 400)}`)
        }
        return {
          pass: true,
          detail: `in room ${id}, the room's AI answered ${words[0]} from the spec and ${words[1]} once the spec's update named it; the room holds both spec messages, the update last`,
        }
      } finally {
        if (opened !== undefined && lens.canModerate) await lens.moderateRoom(opened, 'close', 'a nightly test room, closed by the testers').catch(() => undefined)
      }
    },
  }
}
