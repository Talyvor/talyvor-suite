// B40.23 — a room's contribution record, from rate card to leaderboard (Lens B41.141–B41.152), on Lens's API, once a run,
// on a Free workspace of its own.
//
// The owner opens a test room, switches shared ownership on and publishes a rate card with S at 200 and M at 400 points.
// Three synthetic members join, pass the Test provider's email-and-phone and identity checks (so their points share the
// pool) and sign the contributor agreement they read. The owner posts one sized task each; each member claims one, and
// another member reads that claim on the board. Each member then proposes its task's work and claims its size; Lens draws
// its two reviewers, never its author nor the owner, both score it, and the owner accepts it. Lens's own reads are the
// oracle: each accepted row is the task's size × the quality its reviews read × survival 100%, the leaderboard lists the
// ledger's holders, and the three members' shares add up to exactly 10,000 bps of the pool. A caller with no key reads
// none of it. And room_equity must still be RED and uncleared: Lens answers a room whose owner is not synthetic as if
// shared ownership did not exist, which a nightly run cannot reach since every workspace it makes is synthetic, so Lens
// proves the refusal on real Postgres (TestRooms_SharedOwnershipIsIntentOnlyAndGatedOnRoomEquity). The operator closes
// the room at the end, so a nightly run leaves nothing in the directory people read.

import { fail } from './bank.ts'
import { RUN_SALT } from './oracles.ts'
import { said } from './routes.ts'
import { CannotTest, type Scenario, type Verdict } from './scenarios.ts'

interface Detail { id: string; terms: { version: number } }
interface Ownership { enabled: boolean; pool_bps: number }
interface Agreement { version: string; text_sha256: string; signature: { version: string } | null }
interface Task { id: string; size: string; points: number; claimant_workspace_id?: string }
interface Work { id: string }
interface Reviews { quality_bps: number; reviews: { reviewer_workspace_id: string; score_bps: number | null }[] }
interface Entry { contribution_id: string; workspace_id: string; reason: string; size_points: number; quality_bps: number; survival_bps: number; points: number }
interface Ledger { holders: { workspace_id: string; points: number }[]; entries: Entry[] }
interface Board { enabled: boolean; rows: { workspace_id: string; points: number; identity_checked: boolean; share_bps: number }[]; note: string }

const SIZES = ['M', 'S', 'M'] as const
const POINTS: Record<string, number> = { S: 200, M: 400 }

export function roomContributionRecord(i: number): Scenario {
  return {
    id: 'room-contribution-record',
    owner: 'talyvor-lens',
    feature: 'Rooms',
    own: true,
    title: "in a room with shared ownership on, three members who signed the contributor agreement claim sized tasks, two drawn members review each " +
      "one's work, and once accepted the points ledger reads size × quality and the leaderboard's shares add up to 100% of the pool; " +
      'a caller with no key reads none of it, and room_equity is still RED',
    run: async (ctx): Promise<Verdict> => {
      const { lens } = ctx.env
      if (!lens.canModerate) throw new CannotTest('needs a moderator key to close the public room it opens: LENS_MODERATOR_KEY, from `lens moderator-keys create`')
      const owner = ctx.app.user
      let opened: string | undefined
      try {
        const equity = (await lens.walletCapabilities(owner)).find((c) => c.capability === 'room_equity')
        ctx.evidence.push({ note: `room_equity as Lens lists it: ${JSON.stringify(equity)}` })
        if (equity?.class !== 'RED' || equity.clearance != null) {
          return fail(`room_equity reads ${JSON.stringify(equity)}, not RED and uncleared: shared ownership must stay on synthetic rooms until Talyvor records its clearance`)
        }

        const made = await lens.act<Detail>(owner, 'POST', '/v1/workspaces/{ws}/rooms', {
          title: `Contribution record check ${i}-${RUN_SALT}`, topic: `e2e-room-contribution-record-${RUN_SALT}`, visibility: 'public',
          description: 'A nightly test room; the testers close it when they are done.',
        })
        ctx.evidence.push({ note: `the owner opens a test room: ${made.ok ? `${made.status} ${made.value.id}` : said(made)}` })
        if (!made.ok) return fail(`opening a room was refused: ${said(made)}`)
        const id = made.value.id
        opened = id
        const room = `/v1/rooms/${encodeURIComponent(id)}`
        const on = await lens.act<Ownership>(owner, 'PUT', `${room}/shared-ownership`, { enabled: true })
        ctx.evidence.push({ note: `the owner switches shared ownership on: ${on.ok ? JSON.stringify(on.value) : said(on)}` })
        if (!on.ok || !on.value.enabled) return fail(`switching shared ownership on answered ${on.ok ? JSON.stringify(on.value) : said(on)}`)
        const card = await lens.act(owner, 'PUT', `${room}/rate-card`, { pool_points: 10000, sizes: [{ size: 'S', hours: 2, points_per_hour: 100 }, { size: 'M', hours: 4, points_per_hour: 100 }] })
        ctx.evidence.push({ note: `the owner publishes S at 200 and M at 400 points: ${said(card)}` })
        if (!card.ok) return fail(`publishing the rate card was refused: ${said(card)}`)

        const members = await lens.createUsers(3)
        for (const [n, u] of members.entries()) {
          const joined = await lens.act(u, 'POST', `${room}/join`, { terms_version: made.value.terms.version })
          if (!joined.ok) return fail(`${u.workspaceID} joining the room was refused: ${said(joined)}`)
          for (const [kind, body] of [['contact', { email: `nightly-record-${n}-${RUN_SALT}@example.com`, phone: '+447700900123' }],
            ['identity', { name: `Nightly Contributor ${n}`, country: 'GB', date_of_birth: '1990-04-12' }]] as const) {
            const checked = await lens.act(u, 'POST', `/v1/workspaces/{ws}/verification/${kind}`, body)
            if (!checked.ok) return fail(`${u.workspaceID}'s Test ${kind} check was refused: ${said(checked)}`)
          }
          const agreement = await lens.act<Agreement>(u, 'GET', `${room}/agreement`)
          if (!agreement.ok) return fail(`${u.workspaceID} reading the contributor agreement was refused: ${said(agreement)}`)
          const sig = await lens.act<Agreement>(u, 'POST', `${room}/agreement`, { version: agreement.value.version, signed_name: `E2E contributor ${n} ${RUN_SALT}` })
          if (!sig.ok || sig.value.signature?.version !== agreement.value.version) return fail(`${u.workspaceID} signing the contributor agreement answered ${sig.ok ? JSON.stringify(sig.value.signature) : said(sig)}`)
        }
        ctx.evidence.push({ note: `three members join, pass the Test identity check and sign the contributor agreement: ${members.map((m) => m.workspaceID).join(', ')}` })

        const tasks: Task[] = []
        for (const [n, size] of SIZES.entries()) {
          const posted = await lens.act<Task>(owner, 'POST', `${room}/tasks`, { title: `Launch notes, part ${n + 1} ${RUN_SALT}`, description: 'One page a new member reads first.', size })
          if (!posted.ok || posted.value.points !== POINTS[size]) return fail(`posting a ${size} task answered ${posted.ok ? JSON.stringify(posted.value) : said(posted)}, not ${POINTS[size]} points`)
          const took = await lens.act<Task>(members[n], 'POST', `${room}/tasks/${encodeURIComponent(posted.value.id)}/claim`)
          if (!took.ok || took.value.claimant_workspace_id !== members[n].workspaceID) return fail(`${members[n].workspaceID} claiming a task answered ${took.ok ? JSON.stringify(took.value) : said(took)}`)
          tasks.push(took.value)
        }
        const board = await lens.act<Task[]>(members[0], 'GET', `${room}/tasks`)
        ctx.evidence.push({ note: `the first member reads the board: ${board.ok ? JSON.stringify(board.value) : said(board)}` })
        if (!board.ok) return fail(`reading the tasks board was refused: ${said(board)}`)
        for (const [n, t] of tasks.entries()) {
          const seen = board.value.find((x) => x.id === t.id)
          if (seen?.claimant_workspace_id !== members[n].workspaceID) return fail(`the board reads task ${t.id} as ${JSON.stringify(seen)}, not claimed by ${members[n].workspaceID}`)
        }

        const done: { work: Work; author: string; size: number; quality: number }[] = []
        const plain = new Set(members.map((m) => m.workspaceID))
        for (const [n, author] of members.entries()) {
          const t = tasks[n]
          const proposed = await lens.act<Work>(author, 'POST', `${room}/contributions`,
            { kind: 'prompt', title: `Launch notes ${n + 1} ${RUN_SALT}`, artifact: { template: `Write launch note ${n + 1} for {{product}}. (record check ${RUN_SALT})`, model: ctx.env.judgeModel } },
            { 'Idempotency-Key': `e2e-room-record-${n}-${id}` })
          if (!proposed.ok) return fail(`${author.workspaceID}'s contribution was refused: ${said(proposed)}`)
          const one = `${room}/contributions/${encodeURIComponent(proposed.value.id)}`
          const sized = await lens.act(author, 'PUT', `${one}/size`, { size: t.size })
          if (!sized.ok) return fail(`${author.workspaceID} claiming ${t.size} for its task's work was refused: ${said(sized)}`)
          const drawn = await lens.act<Reviews>(author, 'POST', `${one}/reviewers`, {})
          if (!drawn.ok) return fail(`drawing the reviewers was refused: ${said(drawn)}`)
          const seated = drawn.value.reviews.map((v) => v.reviewer_workspace_id)
          if (seated.length !== 2 || new Set(seated).size !== 2 || seated.some((ws) => ws === author.workspaceID || !plain.has(ws))) {
            return fail(`${author.workspaceID}'s reviewers are ${JSON.stringify(seated)}, not two other members: its author or the owner ${owner.workspaceID} took a seat`)
          }
          for (const [k, ws] of seated.entries()) {
            const scored = await lens.act(members.find((m) => m.workspaceID === ws)!, 'PUT', `${one}/review`, { score_bps: 11_000 + k * 2_000 })
            if (!scored.ok) return fail(`reviewer ${ws}'s score was refused: ${said(scored)}`)
          }
          const read = await lens.act<Reviews>(author, 'GET', `${one}/reviews`)
          ctx.evidence.push({ note: `${author.workspaceID}'s ${t.size} work, reviewed: ${read.ok ? JSON.stringify(read.value) : said(read)}` })
          if (!read.ok) return fail(`reading the reviews was refused: ${said(read)}`)
          if (read.value.reviews.some((v) => v.score_bps === null) || read.value.quality_bps < 5_000 || read.value.quality_bps > 15_000) {
            return fail(`with both reviewers scored, the reviews read ${JSON.stringify(read.value)}`)
          }
          const accepted = await lens.act(owner, 'PATCH', one, { status: 'accepted' })
          if (!accepted.ok) return fail(`the owner accepting ${author.workspaceID}'s work was refused: ${said(accepted)}`)
          done.push({ work: proposed.value, author: author.workspaceID, size: t.points, quality: read.value.quality_bps })
        }

        const ledger = await lens.act<Ledger>(members[1], 'GET', `${room}/points`)
        ctx.evidence.push({ note: `the points ledger: ${ledger.ok ? JSON.stringify(ledger.value).slice(0, 1200) : said(ledger)}` })
        if (!ledger.ok) return fail(`reading the room's points was refused: ${said(ledger)}`)
        for (const d of done) {
          const row = ledger.value.entries.find((e) => e.contribution_id === d.work.id && e.reason === 'accepted')
          if (row === undefined || row.workspace_id !== d.author || row.size_points !== d.size || row.quality_bps !== d.quality || row.survival_bps !== 10_000 ||
            row.points !== Math.floor((d.size * d.quality) / 10_000)) {
            return fail(`${d.author}'s accepted row reads ${JSON.stringify(row)}, not ${d.size} points × the ${d.quality} bps quality its reviews read, at survival 100%`)
          }
        }

        const lb = await lens.act<Board>(members[2], 'GET', `${room}/leaderboard`)
        ctx.evidence.push({ note: `the leaderboard: ${lb.ok ? JSON.stringify(lb.value).slice(0, 1200) : said(lb)}` })
        if (!lb.ok) return fail(`reading the leaderboard was refused: ${said(lb)}`)
        const listed = (l: { workspace_id: string; points: number }[]) => JSON.stringify(l.map((h) => [h.workspace_id, h.points]).sort())
        if (listed(lb.value.rows) !== listed(ledger.value.holders)) return fail(`the leaderboard lists ${listed(lb.value.rows)}, not the ledger's holders ${listed(ledger.value.holders)}`)
        const mine = lb.value.rows.filter((r) => plain.has(r.workspace_id))
        if (mine.length !== 3 || mine.some((r) => !r.identity_checked || r.share_bps <= 0)) {
          return fail(`the leaderboard reads the three identity-checked members as ${JSON.stringify(mine)}, not each holding a share`)
        }
        const shares = lb.value.rows.reduce((a, r) => a + r.share_bps, 0)
        if (shares !== 10_000) return fail(`the leaderboard's shares add up to ${shares} bps, not 10000: ${JSON.stringify(lb.value.rows)}`)
        if (!lb.value.enabled || lb.value.note !== 'Nothing is final until the Gate.') return fail(`the leaderboard reads enabled ${lb.value.enabled} and the note ${JSON.stringify(lb.value.note)}`)

        const reads = ['shared-ownership', 'rate-card', 'tasks', 'agreement', 'points', 'leaderboard', `contributions/${encodeURIComponent(done[0].work.id)}/reviews`]
        for (const r of reads) {
          const anon = await lens.as('', 'GET', `${room}/${r}`)
          if (anon.status < 400 || [...plain].some((ws) => anon.text.includes(ws)) || anon.text.includes('Contributor Plan')) {
            return fail(`a caller with no key reading ${r} was answered ${anon.status} ${anon.text.slice(0, 200)}, not a refusal that shows nothing`)
          }
        }
        ctx.evidence.push({ note: `a caller with no key is refused all of: ${reads.join(', ')}` })
        return {
          pass: true,
          detail: `room ${id}: three identity-checked members signed the contributor agreement, claimed ${SIZES.join(', ')} tasks, had each piece reviewed by the other two ` +
            `(quality ${done.map((d) => d.quality).join(', ')} bps) and accepted; the ledger read size × quality for each, the leaderboard's shares ` +
            `${mine.map((r) => r.share_bps).join(' + ')} = 10000 bps, a caller with no key read none of it, and room_equity is RED and uncleared`,
        }
      } finally {
        if (opened !== undefined) await lens.moderateRoom(opened, 'close', 'a nightly test room, closed by the testers').catch(() => undefined)
      }
    },
  }
}
