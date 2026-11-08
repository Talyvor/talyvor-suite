// B41.47 — objections to a room's frozen leaderboard (Lens B41.147), on Lens's API, once a run, on a Free workspace of its own.
//
// The owner opens a public room and publishes M at 400 points. An author signs the contributor agreement, its M-size
// prompt is accepted and earns its points. An objector, two plain members and a fifth member sharing a card with the
// author (Lens's synthetic card link, B32.102) join. Before the freeze an objection is 409. The owner freezes the
// leaderboard: the window closes 14 days on. The objection is 409 again, now because only two members are linked neither to
// the objector nor to the author — so the card-linked member is never drawn. A third plain member joins and the same
// objection is seated: its panel is exactly the three plain members. Two of them uphold it, and Lens's own points ledger
// is the oracle: one objection row moves the author's points by the change proposed. The operator closes the room at the end.

import { fail } from './bank.ts'
import { RUN_SALT } from './oracles.ts'
import { said } from './routes.ts'
import { CannotTest, type Scenario, type Verdict } from './scenarios.ts'

const DAY_MS = 86_400_000

interface Detail { id: string; terms: { version: number } }
interface Work { id: string; status: string }
interface Ledger { holders: { workspace_id: string; points: number }[]; entries: { contribution_id: string; workspace_id: string; reason: string; points: number }[] }
interface Objection { id: string; status: string; panel: { workspace_id: string; uphold: boolean | null }[] }
interface Objections { frozen_at: string | null; objections_close_at: string | null; rules: string }

export function roomObjections(i: number): Scenario {
  return {
    id: 'room-objections',
    owner: 'talyvor-lens',
    feature: 'Rooms',
    own: true,
    title: 'an objection raised once the leaderboard is frozen goes to three random members linked neither to the objector nor to the author, ' +
      "and their majority upholding it writes an objection row that changes the author's points",
    run: async (ctx): Promise<Verdict> => {
      const { lens } = ctx.env
      if (!lens.canModerate) throw new CannotTest('needs a moderator key to close the public room it opens: LENS_MODERATOR_KEY, from `lens moderator-keys create`')
      const owner = ctx.app.user
      let opened: string | undefined
      try {
        const made = await lens.act<Detail>(owner, 'POST', '/v1/workspaces/{ws}/rooms', {
          title: `Objections check ${i}-${RUN_SALT}`, topic: `e2e-room-objections-${RUN_SALT}`, visibility: 'public',
          description: 'A nightly test room; the testers close it when they are done.',
        })
        ctx.evidence.push({ note: `the owner opens a public room: ${made.ok ? `${made.status} ${made.value.id}` : said(made)}` })
        if (!made.ok) return fail(`opening a room was refused: ${said(made)}`)
        const id = made.value.id
        opened = id
        const room = `/v1/rooms/${encodeURIComponent(id)}`
        const card = await lens.act(owner, 'PUT', `${room}/rate-card`, { pool_points: 10000, sizes: [{ size: 'M', hours: 4, points_per_hour: 100 }] })
        if (!card.ok) return fail(`publishing the rate card was refused: ${said(card)}`)
        const [author, objector, p1, p2, linked] = await lens.createUsers(5)
        for (const u of [author, objector, p1, p2, linked]) {
          const joined = await lens.act(u, 'POST', `${room}/join`, { terms_version: made.value.terms.version })
          if (!joined.ok) return fail(`${u.workspaceID} joining the room was refused: ${said(joined)}`)
        }
        const link = await lens.linkCard(linked, author)
        ctx.evidence.push({ note: `${linked.workspaceID} shares a card with the author ${author.workspaceID}: ${said(link)}` })
        if (!link.ok) return fail(`linking a member to the author by a card (POST /v1/synthetic/workspaces/{ws}/card-link) was refused: ${said(link)}`)

        const agreement = await lens.act<{ version: string }>(author, 'GET', `${room}/agreement`)
        const sig = agreement.ok ? await lens.act(author, 'POST', `${room}/agreement`, { version: agreement.value.version, signed_name: `E2E author ${RUN_SALT}` }) : agreement
        if (!sig.ok) return fail(`the author signing the contributor agreement was refused: ${said(sig)}`)
        const proposed = await lens.act<Work>(author, 'POST', `${room}/contributions`,
          { kind: 'prompt', title: `Launch risks ${RUN_SALT}`, artifact: { template: `List three launch risks for {{product}}. (objections check ${RUN_SALT})`, model: ctx.env.judgeModel } },
          { 'Idempotency-Key': `e2e-room-objections-${id}` })
        const one = proposed.ok ? `${room}/contributions/${encodeURIComponent(proposed.value.id)}` : ''
        const claimed = proposed.ok ? await lens.act(author, 'PUT', `${one}/size`, { size: 'M' }) : proposed
        const accepted = claimed.ok ? await lens.act(owner, 'PATCH', one, { status: 'accepted' }) : claimed
        ctx.evidence.push({ note: `the author proposes a prompt, claims M and the owner accepts it: ${said(accepted)}` })
        if (!proposed.ok || !accepted.ok) return fail(`the author's M-size contribution was refused: ${said(accepted)}`)
        const cid = proposed.value.id
        const before = await lens.act<Ledger>(author, 'GET', `${room}/points`)
        if (!before.ok) return fail(`reading the room's points was refused: ${said(before)}`)
        const held = before.value.entries.filter((e) => e.contribution_id === cid && e.workspace_id === author.workspaceID).reduce((a, e) => a + e.points, 0)
        if (held <= 0) return fail(`the accepted M-size contribution earned its author ${held} points: ${JSON.stringify(before.value.entries)}`)
        const objection = { contribution_id: cid, points: -Math.floor(held / 2), reason: `A nightly test objection ${RUN_SALT}: half of it was copied.` }

        const early = await lens.as(objector.token, 'POST', `${room}/objections`, objection)
        ctx.evidence.push({ note: `an objection before the freeze: ${early.status} ${early.text.slice(0, 200)}` })
        if (early.status !== 409) return fail(`an objection before the leaderboard froze was answered ${early.status} ${early.text.slice(0, 200)}, not 409`)
        const frozen = await lens.act<Objections>(owner, 'POST', `${room}/leaderboard/freeze`)
        ctx.evidence.push({ note: `the owner freezes the leaderboard: ${frozen.ok ? JSON.stringify({ ...frozen.value, rules: undefined }) : said(frozen)}` })
        if (!frozen.ok || frozen.value.frozen_at === null || frozen.value.objections_close_at === null) return fail(`freezing the leaderboard answered ${frozen.ok ? JSON.stringify(frozen.value) : said(frozen)}`)
        const span = Date.parse(frozen.value.objections_close_at) - Date.parse(frozen.value.frozen_at)
        if (Math.abs(span - 14 * DAY_MS) > 60_000) return fail(`the objection window closes ${span / DAY_MS} days after the freeze, not 14`)

        const short = await lens.as(objector.token, 'POST', `${room}/objections`, objection)
        ctx.evidence.push({ note: `with two members unlinked to either side and one sharing the author's card: ${short.status} ${short.text.slice(0, 300)}` })
        if (short.status === 201) return fail(`Lens seated a panel when only two members are linked to neither side, so it drew ${linked.workspaceID}, which shares the author's card: ${short.text.slice(0, 400)}`)
        if (short.status !== 409) return fail(`an objection Lens cannot seat three unlinked members for was answered ${short.status} ${short.text.slice(0, 200)}, not 409`)
        const [p3] = await lens.createUsers(1)
        const third = await lens.act(p3, 'POST', `${room}/join`, { terms_version: made.value.terms.version })
        if (!third.ok) return fail(`a third plain member joining was refused: ${said(third)}`)
        const raised = await lens.act<Objection>(objector, 'POST', `${room}/objections`, objection)
        ctx.evidence.push({ note: `the objector objects to ${objection.points} points: ${raised.ok ? `${raised.status} ${JSON.stringify(raised.value)}` : said(raised)}` })
        if (!raised.ok || raised.status !== 201) return fail(`raising the objection answered ${said(raised)}, not 201`)
        const seated = raised.value.panel.map((p) => p.workspace_id).sort()
        const plain = [p1, p2, p3].map((u) => u.workspaceID).sort()
        if (JSON.stringify(seated) !== JSON.stringify(plain) || raised.value.status !== 'open') {
          return fail(`the objection's panel is ${JSON.stringify(seated)} (${raised.value.status}), not the three members linked to neither side ${JSON.stringify(plain)}`)
        }

        const vote = `${room}/objections/${encodeURIComponent(raised.value.id)}/vote`
        const v1 = await lens.act<Objection>(p1, 'PUT', vote, { uphold: true })
        if (!v1.ok || v1.value.status !== 'open') return fail(`after one vote to uphold the objection reads ${v1.ok ? v1.value.status : said(v1)}, not open`)
        const v2 = await lens.act<Objection>(p2, 'PUT', vote, { uphold: true })
        ctx.evidence.push({ note: `two panelists uphold it: ${v2.ok ? v2.value.status : said(v2)}` })
        if (!v2.ok || v2.value.status !== 'upheld') return fail(`after two votes to uphold the objection reads ${v2.ok ? v2.value.status : said(v2)}, not upheld`)
        const after = await lens.act<Ledger>(author, 'GET', `${room}/points`)
        ctx.evidence.push({ note: `the ledger after: ${after.ok ? JSON.stringify(after.value).slice(0, 900) : said(after)}` })
        if (!after.ok) return fail(`reading the room's points again was refused: ${said(after)}`)
        const rows = after.value.entries.filter((e) => e.reason === 'objection')
        if (rows.length !== 1 || rows[0].workspace_id !== author.workspaceID || rows[0].contribution_id !== cid || rows[0].points !== objection.points) {
          return fail(`the upheld objection wrote ${JSON.stringify(rows)}, not one objection row of ${objection.points} points for the author's contribution`)
        }
        const holds = after.value.holders.find((h) => h.workspace_id === author.workspaceID)?.points
        if (holds !== held + objection.points) return fail(`after the upheld objection the author holds ${holds} points, not ${held + objection.points}`)
        return {
          pass: true,
          detail: `room ${id}: an objection was 409 before the freeze and while only two members were linked to neither side; once a third joined, Lens seated exactly ` +
            `the three plain members, never the one sharing the author's card, and two votes to uphold wrote an objection row of ${objection.points}, taking the author from ${held} to ${holds} points`,
        }
      } finally {
        if (opened !== undefined) await lens.moderateRoom(opened, 'close', 'a nightly test room, closed by the testers').catch(() => undefined)
      }
    },
  }
}
