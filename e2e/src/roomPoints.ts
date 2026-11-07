// B41.43 — a room's points ledger (Lens B41.143), on Lens's API, once a run, on a Free workspace of its own.
//
// The owner opens a public room whose terms give an original 20% of a fork's points, a second company joins, and the
// owner publishes a rate card with M at 4 hours of 100 points. The member proposes a prompt and claims M; the owner
// accepts it, so the member earns M's 400 points × its quality × survival in an accepted row. The owner forks it, claims
// M and accepts the fork: the owner earns its points less the remix share, and a remix_share row credits the member the
// 20%. The owner then rejects the original: a withdrawn row takes its points back, and the rows already written stay as
// they were. Lens's own read of GET /v1/rooms/{id}/points is the oracle. Quality is whatever Lens scored (1.0 until
// B41.144's reviewers), so each row's points are checked against its own size × quality; Lens's real-Postgres test
// proves 1.2 × M. B41.45: with both companies holding points, the member's GET /v1/rooms/{id}/leaderboard lists every holder
// on the ledger with the same points, the identity-checked holders' shares of the pool add up to exactly 10,000 bps, a
// holder not yet identity-checked has none, and it carries the note that nothing is final until the Gate. B41.46: the member's
// GET /v1/rooms/{id}/gate reads Talyvor's thresholds, nobody counted as Used (no one has been active in a room opened
// tonight for 6 of the last 8 weeks; Lens's real-Postgres test proves the count), and Shipped and Paid waiting on a
// published build; the owner lowering a threshold is refused with 409 and changes nothing, and raising one is kept.
// The operator closes the room at the end, so a nightly run leaves nothing in the directory people read.

import { fail } from './bank.ts'
import { RUN_SALT } from './oracles.ts'
import { said } from './routes.ts'
import { CannotTest, type Scenario, type Verdict } from './scenarios.ts'

const REMIX_SHARE_BPS = 2000

interface Detail { id: string; terms: { version: number } }
interface Work { id: string; listing_id: string; status: string; size?: string; points: number }
interface Entry {
  contribution_id: string; workspace_id: string; reason: string; size_points: number; quality_bps: number; survival_bps: number
  remix_share_bps: number; points: number
}
interface Ledger { holders: { workspace_id: string; points: number }[]; entries: Entry[] }
interface Thresholds { shipped_weeks: number; used_people: number; used_active_weeks: number; paid_usd_micros: number; paid_payers: number }
interface Gate { thresholds: Thresholds; shipped: { status: string }; used: { status: string; people: number }; paid: { status: string } }
const GATE_FLOOR: Thresholds = { shipped_weeks: 8, used_people: 100, used_active_weeks: 6, paid_usd_micros: 1_000_000_000, paid_payers: 10 }
interface Board { rows: { workspace_id: string; points: number; identity_checked: boolean; share_bps: number }[]; note: string }

export function roomPoints(i: number): Scenario {
  return {
    id: 'room-points',
    owner: 'talyvor-lens',
    feature: 'Rooms',
    own: true,
    title: "an accepted M-size contribution earns M's points × its quality in an append-only row, a fork credits its original the room's " +
      `${REMIX_SHARE_BPS} bps remix share, and rejecting the original afterwards adds a withdrawn row without changing the rows before it`,
    run: async (ctx): Promise<Verdict> => {
      const { lens } = ctx.env
      if (!lens.canModerate) throw new CannotTest('needs a moderator key to close the public room it opens: LENS_MODERATOR_KEY, from `lens moderator-keys create`')
      const owner = ctx.app.user
      let opened: string | undefined
      try {
        const made = await lens.act<Detail>(owner, 'POST', '/v1/workspaces/{ws}/rooms', {
          title: `Points check ${i}-${RUN_SALT}`, topic: `e2e-room-points-${RUN_SALT}`, visibility: 'public',
          description: 'A nightly test room; the testers close it when they are done.', terms: { remix_share_bps: REMIX_SHARE_BPS },
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
        const card = await lens.act(owner, 'PUT', `${room}/rate-card`, { pool_points: 10000, sizes: [{ size: 'M', hours: 4, points_per_hour: 100 }] })
        ctx.evidence.push({ note: `the owner publishes M at 400 points: ${said(card)}` })
        if (!card.ok) return fail(`publishing the rate card was refused: ${said(card)}`)

        const one = (c: Work) => `${room}/contributions/${encodeURIComponent(c.id)}`
        const proposed = await lens.act<Work>(member, 'POST', `${room}/contributions`,
          { kind: 'prompt', title: `Launch risks ${RUN_SALT}`, artifact: { template: `List three launch risks for {{product}}. (points check ${RUN_SALT})`, model: ctx.env.judgeModel } },
          { 'Idempotency-Key': `e2e-room-points-contribute-${id}` })
        ctx.evidence.push({ note: `the member proposes a prompt: ${said(proposed)}` })
        if (!proposed.ok) return fail(`the member's contribution was refused: ${said(proposed)}`)
        const original = proposed.value
        const claimed = await lens.act<Work>(member, 'PUT', `${one(original)}/size`, { size: 'M' })
        const accepted = claimed.ok ? await lens.act<Work>(owner, 'PATCH', one(original), { status: 'accepted' }) : claimed
        ctx.evidence.push({ note: `the member claims M and the owner accepts it: ${said(accepted)}` })
        if (!accepted.ok) return fail(`claiming M or accepting the member's contribution was refused: ${said(accepted)}`)
        const own = await lens.as(member.token, 'GET', `/v1/marketplace/listings/${encodeURIComponent(original.listing_id)}`)
        if (own.status === 200 && !/"review_status":"approved"/.test(own.text)) {
          const ok = await lens.moderate(original.listing_id, 'approve')
          ctx.evidence.push({ note: `the original was held for review; the operator approves it: ${said(ok)}` })
          if (!ok.ok) return fail(`approving the original, held for review, was refused: ${said(ok)}`)
        }

        const forked = await lens.act<Work>(owner, 'POST', `${one(original)}/fork`,
          { title: `Launch risks, ranked ${RUN_SALT}`, artifact: { template: `List three launch risks for {{product}}, worst first. (points check ${RUN_SALT})`, model: ctx.env.judgeModel } },
          { 'Idempotency-Key': `e2e-room-points-fork-${id}` })
        ctx.evidence.push({ note: `the owner forks it: ${said(forked)}` })
        if (!forked.ok) return fail(`the owner's fork was refused: ${said(forked)}`)
        const fork = forked.value
        const forkClaimed = await lens.act<Work>(owner, 'PUT', `${one(fork)}/size`, { size: 'M' })
        const forkAccepted = forkClaimed.ok ? await lens.act<Work>(owner, 'PATCH', one(fork), { status: 'accepted' }) : forkClaimed
        ctx.evidence.push({ note: `the owner claims M on the fork and accepts it: ${said(forkAccepted)}` })
        if (!forkAccepted.ok) return fail(`claiming M or accepting the fork was refused: ${said(forkAccepted)}`)
        const before = await lens.act<Ledger>(member, 'GET', `${room}/points`)
        ctx.evidence.push({ note: `the ledger after both are accepted: ${before.ok ? JSON.stringify(before.value).slice(0, 900) : said(before)}` })
        if (!before.ok) return fail(`the member reading the room's points was refused: ${said(before)}`)

        const rows = (l: Ledger, c: Work, reason: string) => l.entries.filter((e) => e.contribution_id === c.id && e.reason === reason)
        const [earned] = rows(before.value, original, 'accepted')
        if (earned === undefined || earned.workspace_id !== member.workspaceID || earned.size_points !== 400 || earned.survival_bps !== 10_000 ||
          earned.points !== Math.floor((400 * earned.quality_bps) / 10_000)) {
          return fail(`the accepted M-size original's row reads ${JSON.stringify(earned)}, not the member earning 400 × its quality at survival 100%`)
        }
        const [forkRow] = rows(before.value, fork, 'accepted')
        const [remix] = rows(before.value, fork, 'remix_share')
        const forkPoints = forkRow === undefined ? 0 : Math.floor((400 * forkRow.quality_bps) / 10_000)
        const share = Math.floor((forkPoints * REMIX_SHARE_BPS) / 10_000)
        if (remix === undefined || remix.workspace_id !== member.workspaceID || remix.points !== share || remix.remix_share_bps !== REMIX_SHARE_BPS) {
          return fail(`the fork's remix_share row reads ${JSON.stringify(remix)}, not the original's author credited ${share} points, ${REMIX_SHARE_BPS} bps of the fork's ${forkPoints}`)
        }
        if (forkRow === undefined || forkRow.workspace_id !== owner.workspaceID || forkRow.points !== forkPoints - share) {
          return fail(`the fork's accepted row reads ${JSON.stringify(forkRow)}, not its author earning ${forkPoints} less the ${share} passed to the original`)
        }

        const board = await lens.act<Board>(member, 'GET', `${room}/leaderboard`)
        ctx.evidence.push({ note: `the leaderboard with both holding points: ${board.ok ? JSON.stringify(board.value).slice(0, 900) : said(board)}` })
        if (!board.ok) return fail(`the member reading the room's leaderboard was refused: ${said(board)}`)
        const listed = (l: { workspace_id: string; points: number }[]) => JSON.stringify(l.map((h) => [h.workspace_id, h.points]).sort())
        if (listed(board.value.rows) !== listed(before.value.holders)) {
          return fail(`the leaderboard lists ${listed(board.value.rows)}, not the ledger's holders ${listed(before.value.holders)}`)
        }
        const checked = board.value.rows.filter((r) => r.identity_checked && r.points > 0)
        const shares = checked.reduce((a, r) => a + r.share_bps, 0)
        if ((checked.length > 0 && shares !== 10_000) || board.value.rows.some((r) => !r.identity_checked && r.share_bps !== 0)) {
          return fail(`the leaderboard's shares read ${JSON.stringify(board.value.rows)}: identity-checked holders' add up to ${shares} bps, not 10000, or an unchecked holder has one`)
        }
        if (board.value.note !== 'Nothing is final until the Gate.') return fail(`the leaderboard's note reads ${JSON.stringify(board.value.note)}`)

        const gate = await lens.act<Gate>(member, 'GET', `${room}/gate`)
        ctx.evidence.push({ note: `the Gate tracker: ${gate.ok ? JSON.stringify(gate.value).slice(0, 900) : said(gate)}` })
        if (!gate.ok) return fail(`the member reading the room's Gate tracker was refused: ${said(gate)}`)
        const floor = (t: Thresholds) => JSON.stringify(Object.keys(GATE_FLOOR).map((k) => t[k as keyof Thresholds]))
        if (floor(gate.value.thresholds) !== floor(GATE_FLOOR)) {
          return fail(`a new room's Gate thresholds read ${JSON.stringify(gate.value.thresholds)}, not Talyvor's ${JSON.stringify(GATE_FLOOR)}`)
        }
        if (gate.value.used.people !== 0 || gate.value.shipped.status !== 'needs_published_build' || gate.value.paid.status !== 'needs_published_build') {
          return fail(`a room opened tonight reads Used ${gate.value.used.people} people, Shipped ${gate.value.shipped.status}, Paid ${gate.value.paid.status}`)
        }
        const lowered = await lens.act(owner, 'PUT', `${room}/gate-thresholds`, { used_people: GATE_FLOOR.used_people - 1 })
        ctx.evidence.push({ note: `the owner lowers Used to ${GATE_FLOOR.used_people - 1} people: ${said(lowered)}` })
        if (lowered.status !== 409) return fail(`lowering a Gate threshold must answer 409; Lens answered ${said(lowered)}`)
        const unlowered = await lens.act<Gate>(member, 'GET', `${room}/gate`)
        if (!unlowered.ok || unlowered.value.thresholds.used_people !== GATE_FLOOR.used_people) {
          return fail(`after the refused lowering the member reads Used ${unlowered.ok ? unlowered.value.thresholds.used_people : said(unlowered)}, not ${GATE_FLOOR.used_people}`)
        }
        const raised = await lens.act<Thresholds>(owner, 'PUT', `${room}/gate-thresholds`, { used_people: 150 })
        ctx.evidence.push({ note: `the owner raises Used to 150 people: ${raised.ok ? JSON.stringify(raised.value) : said(raised)}` })
        if (!raised.ok || raised.value.used_people !== 150) return fail(`raising a Gate threshold to 150 people answered ${raised.ok ? JSON.stringify(raised.value) : said(raised)}`)

        const rejected = await lens.act(owner, 'PATCH', one(original), { status: 'rejected' })
        ctx.evidence.push({ note: `the owner rejects the original after accepting it: ${said(rejected)}` })
        if (!rejected.ok) return fail(`rejecting the accepted original was refused: ${said(rejected)}`)
        const after = await lens.act<Ledger>(member, 'GET', `${room}/points`)
        ctx.evidence.push({ note: `the ledger after: ${after.ok ? JSON.stringify(after.value).slice(0, 900) : said(after)}` })
        if (!after.ok) return fail(`reading the room's points again was refused: ${said(after)}`)
        const [withdrawn] = rows(after.value, original, 'withdrawn')
        if (withdrawn === undefined || withdrawn.workspace_id !== member.workspaceID || withdrawn.points !== -earned.points) {
          return fail(`rejecting the accepted original wrote ${JSON.stringify(withdrawn)}, not a withdrawn row taking back the member's ${earned.points}`)
        }
        const kept = (l: Ledger) => JSON.stringify(l.entries.filter((e) => e.reason !== 'withdrawn').sort((a, b) => `${a.contribution_id}${a.reason}`.localeCompare(`${b.contribution_id}${b.reason}`)))
        if (kept(after.value) !== kept(before.value)) return fail(`the rows written before the rejection changed: ${kept(before.value)} became ${kept(after.value)}`)
        const holds = after.value.holders.find((h) => h.workspace_id === member.workspaceID)?.points
        if (holds !== share) return fail(`after the rejection the member holds ${holds} points, not the ${share} its fork's remix share earned`)
        return {
          pass: true,
          detail: `room ${id}: the M-size original earned its author ${earned.points} (400 × quality ${earned.quality_bps} bps), the fork passed ${share} of its ` +
            `${forkPoints} to it, the leaderboard listed both holders with shares adding up to 100% of the pool, the Gate refused a lower threshold and kept a higher one, and rejecting the original wrote a withdrawn row of ${withdrawn.points} without changing the earlier rows`,
        }
      } finally {
        if (opened !== undefined) await lens.moderateRoom(opened, 'close', 'a nightly test room, closed by the testers').catch(() => undefined)
      }
    },
  }
}
