import { getJSON, getJSONArray } from '../../lib/api'
import { unlessHeld } from '../../lib/held'
import { isSessionExpired } from '../../lib/productState'
import { type ListingKind, MarketError } from '../marketplace/marketApi'

// roomsApi.ts — B32.53: rooms, through the BFF's /api/rooms routes (apps/bff/rooms.go) to Lens's rooms
// (B32.28–B32.30). A room is an open chat where people and their agents build something together; its
// terms say how what is made in it is priced and shared. Prices are integer µUSD.
//
// A refusal carries Lens's own sentence — a rooms_plan_limits refusal names the plan and the plan that
// allows more — and the screen shows it as Lens words it.

/** Lens rooms.Room. */
export interface Room {
  id: string
  owner_workspace_id: string
  title: string
  topic: string
  description: string
  visibility: 'public' | 'private'
  status: string
  terms_version: number
  member_count: number
  created_at: string
  last_activity_at: string
}

export type SplitRule = 'owner_decides' | 'equal' | 'by_votes'
export type SpendPolicy = 'owner_only' | 'members_with_spend'

/** Lens rooms.Terms: one version of how a room's work is priced and shared. */
export interface Terms {
  version: number
  split_rule: SplitRule
  remix_share_bps: number
  default_price_usd_micros: number
  spend_policy: SpendPolicy
  created_at: string
}

/** Lens rooms.Member. workspace_name is its workspace's name, or "A workspace not named yet" (B55.34). */
export interface Member {
  workspace_id: string
  workspace_name: string
  role: string
  may_spend: boolean
  terms_version: number
  terms_current: boolean
  joined_at: string
}

/** Lens rooms.Wallet (B32.32) — the room's budget, shown to its members. Amounts are µLXC; -1 is unlimited. */
export interface RoomWallet {
  agent_id: string
  name: string
  balance_ulxc: number
  monthly_limit_ulxc: number
  spent_this_month_ulxc: number
  max_per_request_ulxc: number
  approval_above_ulxc: number
  budget_max_ulxc: number
  spend_policy: SpendPolicy
  may_spend: boolean
  why_not?: string
}

/** Lens rooms.Detail — GET /api/rooms/{id}; `me` is null when this workspace is not a member. */
export interface RoomDetail extends Room {
  terms: Terms
  members: Member[] | null
  agents: { agent_id: string; name: string; workspace_id: string }[] | null
  me: Member | null
  wallet?: RoomWallet
  /** B41.148: the room this one was forked from while its owner was away. */
  forked_from_room_id?: string
}

/** Lens rooms.Takeover (B41.148) — GET /api/rooms/{id}/takeover, to the room's members. An owner who does nothing in
 *  the room for 60 days can be given notice; 14 days unanswered, the voting members — not the owner, not viewers —
 *  elect a new lead by points, or fork the room. */
export interface Takeover {
  owner_workspace_id: string
  owner_last_active_at: string
  /** 60 days after the owner's last activity. */
  notice_from: string
  /** The open notice, else the latest closed one; null, never any. */
  notice: {
    id: string
    noticed_by_workspace_id: string
    noticed_at: string
    /** 14 days after the notice. */
    voting_from: string
    status: 'open' | 'answered' | 'elected'
    elected_workspace_id?: string
    closed_at?: string
  } | null
  voting: boolean
  members: { workspace_id: string; role: string; points: number; voted_for?: string }[]
  total_points: number
  /** Candidate → the points of the members voting for it. */
  tally: Record<string, number>
}

/** Lens rooms.SharedOwnership (B41.141) — GET /api/rooms/{id}/shared-ownership, to members under the current terms.
 *  Intent only: the share of the room's future value its owner means for contributors, with the notice Lens words.
 *  404 in a workspace that is not synthetic until room_equity is cleared. */
export interface SharedOwnership {
  room_id: string
  enabled: boolean
  /** 1,000–5,000 basis points; 2,500 until the owner sets it. */
  pool_bps: number
  notice: string
  updated_at?: string
}

/** Lens rooms.RateSize (B41.142): one size of work; it earns hours × points per hour, worked out by Lens. */
export interface RateSize {
  size: string
  hours: number
  points_per_hour: number
  points: number
}

/** Lens rooms.RateCard (B41.142) — GET /api/rooms/{id}/rate-card, to members under the current terms, behind the same
 *  room_equity gate as shared ownership. pool_points is 0 until the owner publishes one; no size is worth more than
 *  item_cap_points, 5% of the pool. */
export interface RateCard {
  room_id: string
  pool_points: number
  item_cap_points: number
  sizes: RateSize[]
  updated_at?: string
}

/** Lens rooms.PointsEntry (B41.143): one append-only row of a room's points ledger. An accepted row earns size × quality ×
 *  survival, less the remix share a fork passes to its original's author in a remix_share row; a withdrawn row takes
 *  back what a contribution rejected after it was accepted had earned. Basis points: 10,000 is 1.0 or 100%. */
export interface PointsEntry {
  id: string
  contribution_id: string
  workspace_id: string
  reason: 'accepted' | 'remix_share' | 'withdrawn' | 'review' | 'objection'
  size_points: number
  received_usd_micros: number
  quality_bps: number
  survival_bps: number
  remix_share_bps: number
  points: number
  created_at: string
}

/** Lens rooms.Points (B41.143) — GET /api/rooms/{id}/points, to members under the current terms, behind the same
 *  room_equity gate as the rate card. total_points counts only holders whose owner is identity-checked at L2. */
export interface RoomPoints {
  room_id: string
  total_points: number
  holders: { workspace_id: string; workspace_name: string; points: number; identity_checked: boolean }[]
  entries: PointsEntry[]
}

/** Lens rooms.Leaderboard (B41.145) — GET /api/rooms/{id}/leaderboard, behind the same room_equity gate as the points
 *  ledger. Rows are most points first; the identity-checked holders' share_bps of the contributor pool add up to 10,000,
 *  and a holder waiting for its owner's identity check has 0. */
export interface RoomLeaderboard {
  room_id: string
  enabled: boolean
  pool_bps: number
  total_points: number
  rows: { workspace_id: string; workspace_name: string; points: number; identity_checked: boolean; share_bps: number }[]
  note: string
  notice: string
}

/** Lens rooms.GateThresholds (B41.146): Talyvor's are the floor, and the owner may raise them, never lower them. */
export interface GateThresholds {
  shipped_weeks: number
  used_people: number
  used_active_weeks: number
  used_window_weeks: number
  paid_usd_micros: number
  paid_payers: number
  updated_at?: string
}

/** Lens rooms.GateTracker (B41.146) — GET /api/rooms/{id}/gate, behind the same room_equity gate as the points ledger.
 *  Each test's status is met, in_progress or needs_published_build; Shipped and Paid carry Lens's note while the room
 *  cannot publish a build. */
export interface RoomGate {
  room_id: string
  thresholds: GateThresholds
  shipped: { status: string; note?: string; weeks: number }
  used: { status: string; people: number }
  paid: { status: string; note?: string; usd_micros: number; payers: number }
  met: boolean
  notice: string
}

/** Lens rooms.Review (B41.144): one reviewer's seat on a contribution. score_bps is 5,000–15,000 (0.5–1.5), null until it
 *  scores; ring means it and the author scored each other's work, so its score counts as 1.0 and earns nothing. */
export interface Review {
  reviewer_workspace_id: string
  reviewer_workspace_name: string
  score_bps: number | null
  ring: boolean
  drawn_at: string
  scored_at?: string
}

/** Lens rooms.Reviews (B41.144) — GET /api/rooms/{id}/contributions/{cid}/reviews, behind the same room_equity gate as
 *  the points ledger. quality_bps is the median of both counted scores, 10,000 until both are in. */
export interface Reviews {
  contribution_id: string
  quality_bps: number
  reviews: Review[]
}

/** Lens rooms.Signature (B41.150): a workspace's e-signature of the contributor agreement, kept as evidence with the
 *  version and the hash of the exact text signed. */
export interface AgreementSignature {
  workspace_id: string
  user_id: string
  signed_name: string
  version: string
  text_sha256: string
  signed_at: string
}

/** Lens rooms.Agreement (B41.150) — GET /api/rooms/{id}/agreement, behind the same room_equity gate as the points ledger.
 *  A draft carries what it is marked with; signature is null until this workspace signs, and its points count only then. */
export interface RoomAgreement {
  room_id: string
  version: string
  draft: boolean
  marked?: string
  text: string
  text_sha256: string
  signature: AgreementSignature | null
}

/** Lens rooms.Objection (B41.147): an objection to the points one accepted contribution earned its author. points is the
 *  change proposed, signed; the panel is the three members Lens drew, each uphold null until it votes. Two votes the same
 *  way decide it; lapsed is an open one its panel did not decide by decide_by, so the points stand. */
export interface Objection {
  id: string
  contribution_id: string
  holder_workspace_id: string
  objector_workspace_id: string
  points: number
  reason: string
  status: 'open' | 'upheld' | 'dismissed' | 'lapsed'
  raised_at: string
  decide_by: string
  decided_at?: string
  panel: { workspace_id: string; workspace_name: string; uphold: boolean | null; voted_at?: string }[]
}

/** Lens rooms.Objections (B41.147) — GET /api/rooms/{id}/objections, behind the same room_equity gate as the points ledger.
 *  frozen_at and objections_close_at are null until the owner freezes the leaderboard; rules are Lens's published rules. */
export interface RoomObjections {
  room_id: string
  frozen_at: string | null
  objections_close_at: string | null
  rules: string
  objections: Objection[]
}

/** Lens rooms.Task (B41.152): one task on the room's open board, at a size on the rate card whose points were fixed on it
 *  when it was posted. It has no assignee and no deadline: claimant_workspace_id is empty while it is open, and only a
 *  member claims a task, for itself. */
export interface RoomTask {
  id: string
  room_id: string
  poster_workspace_id: string
  title: string
  description: string
  size: string
  points: number
  claimant_workspace_id?: string
  claimant_workspace_name?: string
  claimed_at?: string
  created_at: string
}

/** Lens rooms.Usage — what this workspace's plan lets it open, beside what it has open. -1 is unlimited. */
export interface RoomLimits {
  plan: string
  limit_as: string
  public_rooms: number
  private_rooms: number
  public_rooms_open: number
  private_rooms_open: number
}

/** GET /api/rooms: the open public rooms by latest activity, and the rooms this workspace is in or invited to. */
export interface RoomsList {
  rooms: Room[] | null
  joined: Room[] | null
  invited: Room[] | null
  limits?: RoomLimits
}

/** Lens rooms.Draft — POST /api/rooms. */
export interface RoomDraft {
  title: string
  topic: string
  description: string
  visibility: 'public' | 'private'
  terms: {
    split_rule: SplitRule
    remix_share_bps: number
    default_price_usd_micros: number
    spend_policy: SpendPolicy
  }
}

export const SPLIT_RULES: readonly [SplitRule, string][] = [
  ['owner_decides', 'The owner decides'],
  ['equal', 'Equal shares'],
  ['by_votes', 'By members’ votes'],
]

export const SPEND_POLICIES: readonly [SpendPolicy, string][] = [
  ['owner_only', 'Only the owner'],
  ['members_with_spend', 'Members the owner lets spend'],
]

export const splitRuleText = (r: string) => SPLIT_RULES.find(([v]) => v === r)?.[1] ?? r
export const spendPolicyText = (p: string) => SPEND_POLICIES.find(([v]) => v === p)?.[1] ?? p

/** Where a room's text is kept, said before its first message (B32.30). */
export const STORED_NOTICE =
  'Messages in a room are stored by Talyvor and visible to its members (to everyone, in a public room).'

/** `12.5` → 1,250 basis points; empty is none. Null for anything that is not a share from 0 to 100 with two decimals at most. */
export function parseShare(text: string): number | null {
  if (text.trim() === '') return 0
  const m = /^\s*(\d{1,3})(?:\.(\d{1,2}))?\s*$/.exec(text)
  if (!m) return null
  const bps = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'))
  return bps <= 10_000 ? bps : null
}

/** A price per use in µUSD, to the cent — or finer, when a use costs less than a cent. */
export function usdText(micros: number): string {
  if (micros <= 0) return 'Free'
  return `$${(micros / 1_000_000).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`
}

export const shareText = (bps: number) => `${(bps / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}%`

/** Rooms of a topic, newest activity first, in the order Lens gave them. */
export function byTopic(rooms: Room[]): [string, Room[]][] {
  const out = new Map<string, Room[]>()
  for (const r of rooms) {
    const t = r.topic.trim() || 'Other'
    out.set(t, [...(out.get(t) ?? []), r])
  }
  return [...out]
}

async function post<T>(path: string, body: object, method = 'POST'): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    let sentence = ''
    try {
      sentence = ((await res.json()) as { error?: string }).error ?? ''
    } catch {
      // a body that is not JSON carries no sentence
    }
    throw new MarketError(res.status, path, sentence)
  }
  return (await res.json()) as T
}

const e = encodeURIComponent

export const ROOMS_KEY = ['rooms']

/** Lens rooms.Message (B32.30). A run's refs say what ran, what it cost and who paid (B32.33). */
export interface RoomMessage {
  id: string
  cursor: number
  room_id: string
  author_workspace_id: string
  author_workspace_name: string
  author_agent_id?: string
  kind: 'text' | 'contribution' | 'run' | 'prize' | 'system'
  body: string
  refs: RunRefs | Record<string, unknown> | null
  created_at: string
  edited_at?: string
  deleted_at?: string
}

/** A run message's refs: a use of a listing (`run: use`) or a question to the room's AI (`run: ask`). */
export interface RunRefs {
  run: 'use' | 'ask'
  pay: 'room' | 'self'
  payer_workspace_id: string
  charge?: string
  price_usd_micros?: number
  listing_id?: string
  contribution_id?: string
}

/** GET /api/rooms/{id}/messages: oldest first, and the room's event cursor as of the same read. */
export interface MessagePage {
  messages: RoomMessage[] | null
  more: boolean
  events_cursor: number
}

/** One room event: a message posted, edited or deleted, with the message as it now stands. */
export interface RoomEvent {
  cursor: number
  kind: 'message.posted' | 'message.edited' | 'message.deleted'
  ref: string
  at: string
  message?: RoomMessage
}

/** Lens rooms.Contribution (B32.31): a listing proposed to the room, with the members' votes. */
export interface Contribution {
  id: string
  room_id: string
  listing_id: string
  version: number
  kind: ListingKind
  title: string
  author_workspace_id: string
  author_workspace_name: string
  forked_from?: string
  status: 'proposed' | 'accepted' | 'rejected'
  /** B41.142 — the size claimed on the room's rate card, and that size's points, fixed when it was claimed. */
  size?: string
  points?: number
  tally: number
  up: number
  down: number
  my_vote: number
  created_at: string
}

/** POST /api/rooms/{id}/contributions; a fork sends the same without kind, and what it leaves out stays the original's. */
export interface ContributionDraft {
  kind?: ListingKind
  title: string
  description: string
  artifact?: Record<string, unknown>
  changelog: string
  price_usd_micros?: number
}

/** POST /api/rooms/{id}/runs: what to run — a contribution's id or a listing's — and who pays. */
export interface RunRequest {
  target: string
  input: string
  variables: Record<string, string>
  model: string
  pay: 'room' | 'self'
}

/** Lens rooms.RunResult: the use, and the run message the room got. */
export interface RunResult {
  /** An ask's answer (B41.60). */
  answer?: string
  pay: 'room' | 'self'
  payer_workspace_id: string
  message?: RoomMessage
}

/** A message list with `m` in its place: replaced when it is there, else added in cursor order. */
export function upsertMessage(list: RoomMessage[], m: RoomMessage): RoomMessage[] {
  const at = list.findIndex((x) => x.id === m.id)
  if (at >= 0) return list.map((x, i) => (i === at ? m : x))
  return [...list, m].sort((a, b) => a.cursor - b.cursor)
}

/** The frames of a Server-Sent Events buffer that are complete, and what is left over. */
function sseFrames(buffer: string): { frames: { id?: string; event?: string; data: string }[]; rest: string } {
  const parts = buffer.replace(/\r\n/g, '\n').split('\n\n')
  const rest = parts.pop() ?? ''
  const frames = parts.map((p) => {
    const f: { id?: string; event?: string; data: string } = { data: '' }
    for (const line of p.split('\n')) {
      const i = line.indexOf(':')
      if (i <= 0) continue
      const field = line.slice(0, i)
      const value = line.slice(i + 1).replace(/^ /, '')
      if (field === 'id') f.id = value
      else if (field === 'event') f.event = value
      else if (field === 'data') f.data += value
    }
    return f
  })
  return { frames, rest }
}

const pause = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => (clearTimeout(t), resolve()), { once: true })
  })

/**
 * Follows a room's events from `after` until `signal` aborts: each event to `onEvent`, in order. Lens ends each stream
 * after a while; this reconnects from the last cursor it saw, so nothing is lost and nothing comes twice. A room that
 * answers `gone` — this workspace was removed from it — ends the follow.
 */
export async function followRoom(id: string, after: number, onEvent: (e: RoomEvent) => void, signal: AbortSignal): Promise<void> {
  let cursor = after
  while (!signal.aborted) {
    let wait = 1000
    try {
      const res = await fetch(`/api/rooms/${e(id)}/events?after=${cursor}`, { headers: { Accept: 'text/event-stream' }, signal })
      if (!res.ok || !res.body) {
        if (res.status === 404) return
        wait = 5000
      } else {
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const split = sseFrames(buffer)
          buffer = split.rest
          for (const f of split.frames) {
            if (f.event === 'gone') return
            if (!f.data) continue
            const ev = JSON.parse(f.data) as RoomEvent
            cursor = Math.max(cursor, ev.cursor)
            onEvent(ev)
          }
        }
      }
    } catch {
      if (signal.aborted) return
      wait = 5000
    }
    await pause(wait, signal)
  }
}

/** Lens rooms.Invite (B32.29): a link, or a workspace the owner named. The token is in the answer that made it, only. */
export interface Invite {
  id: string
  room_id: string
  kind: 'link' | 'named'
  workspace_id?: string
  /** B55.34 — set once the named workspace has been a member of the room. */
  workspace_name?: string
  token?: string
  max_uses: number
  uses: number
  expires_at?: string
  revoked_at?: string
  live: boolean
  created_by_workspace_id: string
  created_at: string
}

/** Lens rooms.InvitePreview — what a live invite link opens. */
export interface InvitePreview {
  room: Room
  terms: Terms
  expires_at: string
  uses_left: number
}

/** Lens rooms.Prize (B32.35): posted by the owner, awarded to a contribution, or closed at its deadline unawarded. */
export interface Prize {
  id: string
  room_id: string
  poster_workspace_id: string
  title: string
  criteria: string
  amount_usd_micros: number
  deadline: string
  status: 'open' | 'awarded' | 'closed'
  contribution_id?: string
  winner_workspace_id?: string
  awarded_at?: string
  closed_at?: string
  created_at: string
}

/** PATCH /api/rooms/{id}/members/{ws}: one change at a time — a role, may_spend, or removing the member. */
export type MemberChange = { role: 'editor' | 'member' | 'viewer' } | { may_spend: boolean } | { remove: true }

/** The roles the owner or an editor can give; a room has one owner, the workspace that opened it. */
export const ROLES: readonly ['editor' | 'member' | 'viewer', string][] = [
  ['editor', 'Editor'],
  ['member', 'Member'],
  ['viewer', 'Viewer'],
]

/** Where an invite link's token is opened, on this site. */
export const inviteHref = (token: string) => `/rooms/invite/${encodeURIComponent(token)}`

export const roomsApi = {
  list: (topic = '') =>
    getJSON<RoomsList>(`/api/rooms${topic ? `?topic=${e(topic)}` : ''}`, { rooms: 'list', joined: 'list', invited: 'list' }),
  room: (id: string) =>
    getJSON<RoomDetail>(`/api/rooms/${e(id)}`, { id: 'string', title: 'string', terms: 'object' }),
  create: (draft: RoomDraft) => post<RoomDetail>('/api/rooms', draft),
  join: (id: string, termsVersion: number) => post<Member>(`/api/rooms/${e(id)}/join`, { terms_version: termsVersion }),
  // B32.54 — the room screen.
  messages: (id: string) => getJSON<MessagePage>(`/api/rooms/${e(id)}/messages?limit=100`, { messages: 'list', events_cursor: 'number' }),
  post: (id: string, body: string) => post<RoomMessage>(`/api/rooms/${e(id)}/messages`, { body }),
  contributions: async (id: string) =>
    (await getJSON<{ contributions: Contribution[] | null }>(`/api/rooms/${e(id)}/contributions`, { contributions: 'list' }))
      .contributions ?? [],
  propose: (id: string, draft: ContributionDraft) => post<Contribution>(`/api/rooms/${e(id)}/contributions`, draft),
  fork: (id: string, cid: string, draft: ContributionDraft) =>
    post<Contribution>(`/api/rooms/${e(id)}/contributions/${e(cid)}/fork`, draft),
  vote: (id: string, cid: string, value: 1 | -1) =>
    post<Contribution>(`/api/rooms/${e(id)}/contributions/${e(cid)}/vote`, { value }, 'PUT'),
  decide: (id: string, cid: string, status: 'accepted' | 'rejected') =>
    post<Contribution>(`/api/rooms/${e(id)}/contributions/${e(cid)}`, { status }, 'PATCH'),
  run: (id: string, req: RunRequest) =>
    unlessHeld(post<RunResult>(`/api/rooms/${e(id)}/runs`, req), (h) =>
      new MarketError(202, `/api/rooms/${e(id)}/runs`, h.message ?? '', h.approval_id)),
  // B41.60 — the room's AI, whose context is the room's latest messages, its spec among them.
  ask: (id: string, req: { question: string; model: string; pay: 'room' | 'self' }) => post<RunResult>(`/api/rooms/${e(id)}/ask`, req),
  // B32.55 — room settings.
  changeMember: (id: string, ws: string, change: MemberChange) =>
    post<Member>(`/api/rooms/${e(id)}/members/${e(ws)}`, change, 'PATCH'),
  setTerms: (id: string, terms: RoomDraft['terms']) => post<Terms>(`/api/rooms/${e(id)}/terms`, terms, 'PUT'),
  invites: async (id: string) =>
    (await getJSON<{ invites: Invite[] | null }>(`/api/rooms/${e(id)}/invites`, { invites: 'list' })).invites ?? [],
  createInvite: (id: string, maxUses: number, expiresAt: string) =>
    post<Invite>(`/api/rooms/${e(id)}/invites`, { max_uses: maxUses, expires_at: expiresAt }),
  revokeInvite: (id: string, iid: string) => post<Invite>(`/api/rooms/${e(id)}/invites/${e(iid)}`, {}, 'DELETE'),
  prizes: async (id: string) =>
    (await getJSON<{ prizes: Prize[] | null }>(`/api/rooms/${e(id)}/prizes`, { prizes: 'list' })).prizes ?? [],
  postPrize: (id: string, draft: { title: string; criteria: string; amount_usd_micros: number; deadline: string }) =>
    post<Prize>(`/api/rooms/${e(id)}/prizes`, draft),
  awardPrize: (id: string, pid: string, contributionID: string) =>
    post<{ prize: Prize }>(`/api/rooms/${e(id)}/prizes/${e(pid)}/award`, { contribution_id: contributionID }),
  // B41.48 — a room's owner can change: a hand-over, or a takeover vote once the owner has been away.
  transferOwner: (id: string, ws: string) => post<RoomDetail>(`/api/rooms/${e(id)}/owner`, { workspace_id: ws }),
  takeover: (id: string) =>
    getJSON<Takeover>(`/api/rooms/${e(id)}/takeover`, { owner_workspace_id: 'string', members: 'list', tally: 'object' }),
  giveNotice: (id: string) => post<Takeover>(`/api/rooms/${e(id)}/takeover`, {}),
  answerNotice: (id: string) => post<Takeover>(`/api/rooms/${e(id)}/takeover`, {}, 'DELETE'),
  voteLead: (id: string, candidate: string) =>
    post<Takeover>(`/api/rooms/${e(id)}/takeover/vote`, { candidate_workspace_id: candidate }, 'PUT'),
  forkRoom: (id: string) => post<RoomDetail>(`/api/rooms/${e(id)}/fork`, {}),
  // B41.41 — shared ownership, intent only.
  sharedOwnership: (id: string) =>
    getJSON<SharedOwnership>(`/api/rooms/${e(id)}/shared-ownership`, { enabled: 'boolean', pool_bps: 'number', notice: 'string' }),
  setSharedOwnership: (id: string, enabled: boolean, poolBps: number) =>
    post<SharedOwnership>(`/api/rooms/${e(id)}/shared-ownership`, { enabled, pool_bps: poolBps }, 'PUT'),
  // B41.42 — the rate card, and a contribution's size on it.
  rateCard: (id: string) =>
    getJSON<RateCard>(`/api/rooms/${e(id)}/rate-card`, { pool_points: 'number', item_cap_points: 'number', sizes: 'list' }),
  setRateCard: (id: string, poolPoints: number, sizes: Omit<RateSize, 'points'>[]) =>
    post<RateCard>(`/api/rooms/${e(id)}/rate-card`, { pool_points: poolPoints, sizes }, 'PUT'),
  claimSize: (id: string, cid: string, size: string) =>
    post<Contribution>(`/api/rooms/${e(id)}/contributions/${e(cid)}/size`, { size }, 'PUT'),
  // B41.43 — the points ledger.
  points: (id: string) =>
    getJSON<RoomPoints>(`/api/rooms/${e(id)}/points`, { total_points: 'number', holders: 'list', entries: 'list' }),
  // B41.45 — the provisional leaderboard.
  leaderboard: (id: string) =>
    getJSON<RoomLeaderboard>(`/api/rooms/${e(id)}/leaderboard`, { pool_bps: 'number', rows: 'list', note: 'string' }),
  // B41.46 — the Gate tracker, and the owner raising its thresholds.
  gate: (id: string) => getJSON<RoomGate>(`/api/rooms/${e(id)}/gate`, { thresholds: 'object', used: 'object', notice: 'string' }),
  setGateThresholds: (id: string, t: Omit<GateThresholds, 'used_window_weeks' | 'updated_at'>) =>
    post<GateThresholds>(`/api/rooms/${e(id)}/gate-thresholds`, t, 'PUT'),
  // B41.50 — the contributor agreement, signed before points count.
  agreement: (id: string) =>
    getJSON<RoomAgreement>(`/api/rooms/${e(id)}/agreement`, { version: 'string', text: 'string', text_sha256: 'string' }),
  signAgreement: (id: string, version: string, signedName: string) =>
    post<RoomAgreement>(`/api/rooms/${e(id)}/agreement`, { version, signed_name: signedName }),
  // B41.47 — objections to the frozen leaderboard, decided by three members Lens draws at random.
  objections: (id: string) =>
    getJSON<RoomObjections>(`/api/rooms/${e(id)}/objections`, { rules: 'string', objections: 'list' }),
  freezeLeaderboard: (id: string) => post<RoomObjections>(`/api/rooms/${e(id)}/leaderboard/freeze`, {}),
  raiseObjection: (id: string, contributionID: string, points: number, reason: string) =>
    post<Objection>(`/api/rooms/${e(id)}/objections`, { contribution_id: contributionID, points, reason }),
  voteObjection: (id: string, oid: string, uphold: boolean) =>
    post<Objection>(`/api/rooms/${e(id)}/objections/${e(oid)}/vote`, { uphold }, 'PUT'),
  // B41.52 — the open tasks board: tasks sized from the rate card that any member may claim, for itself.
  tasks: (id: string) => getJSONArray<RoomTask>(`/api/rooms/${e(id)}/tasks`),
  postTask: (id: string, title: string, description: string, size: string) =>
    post<RoomTask>(`/api/rooms/${e(id)}/tasks`, { title, description, size }),
  claimTask: (id: string, tid: string) => post<RoomTask>(`/api/rooms/${e(id)}/tasks/${e(tid)}/claim`, {}),
  releaseTask: (id: string, tid: string) => post<RoomTask>(`/api/rooms/${e(id)}/tasks/${e(tid)}/claim`, {}, 'DELETE'),
  // B41.44 — two reviewers Lens draws at random score a contribution's quality.
  reviews: (id: string, cid: string) =>
    getJSON<Reviews>(`/api/rooms/${e(id)}/contributions/${e(cid)}/reviews`, { quality_bps: 'number', reviews: 'list' }),
  drawReviewers: (id: string, cid: string) => post<Reviews>(`/api/rooms/${e(id)}/contributions/${e(cid)}/reviewers`, {}),
  review: (id: string, cid: string, scoreBps: number) =>
    post<Reviews>(`/api/rooms/${e(id)}/contributions/${e(cid)}/review`, { score_bps: scoreBps }, 'PUT'),
  previewInvite: (token: string) =>
    getJSON<InvitePreview>(`/api/room-invites/${e(token)}`, { room: 'object', terms: 'object', uses_left: 'number' }),
  joinByInvite: (token: string, termsVersion: number) =>
    post<{ room_id: string; member: Member }>(`/api/room-invites/${e(token)}/join`, { terms_version: termsVersion }),
}

/**
 * Lens's sentence for a refusal, as Lens words it — a rooms_plan_limits refusal word for word, setting name first;
 * any other loses Lens's "rooms: …:" prefix. A fault says nothing happened.
 */
export function roomRefusal(err: unknown): string {
  if (isSessionExpired(err)) return 'Nothing happened. Sign in again.'
  if (err instanceof MarketError && err.sentence && err.status < 500) {
    if (err.sentence.startsWith('rooms_plan_limits')) return err.sentence
    const s = err.sentence.replace(/^rooms: (invalid request: |not allowed: |conflict: |not found: )?/, '')
    return `${s.charAt(0).toUpperCase()}${s.slice(1)}${s.endsWith('.') ? '' : '.'}`
  }
  return 'Nothing happened. You can try again.'
}

// B41.61 — a room opened from a Track issue: its description ends with a line linking back to the issue, which the
// room's screen shows as a link. Lens keeps a description to 4,000 characters, so the issue's text gives way to the line.
const ISSUE_LINE = /\n*From Track issue (\S+): (https?:\/\/[^\s/]+)(\/track\/issues\/[^\s/?#]+)$/

/** A room's description for a Track issue: the issue's description, then the line linking back to it. */
export function issueRoomDescription(issue: { id: string; identifier: string; description: string }, origin: string): string {
  const line = `From Track issue ${issue.identifier}: ${origin}/track/issues/${encodeURIComponent(issue.id)}`
  const text = issue.description.trim().slice(0, 4000 - line.length - 2).trim()
  return text === '' ? line : `${text}\n\n${line}`
}

/** A description split into its text and the Track issue it links back to — only on this site, since anyone can write
 *  the line into a public room's description. `path` is the issue's address here. */
export function issueBackLink(description: string, origin: string): { text: string; issue?: { identifier: string; path: string } } {
  const m = ISSUE_LINE.exec(description)
  if (!m || m[2] !== origin) return { text: description }
  return { text: description.slice(0, m.index), issue: { identifier: m[1], path: m[3] } }
}
