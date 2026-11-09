import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Input, Row, focusRing } from '@talyvor/ui'
import { Region } from '../../components/Region'
import { ApiError } from '../../lib/api'
import { formatWhen } from '../lens/format'
import { Card, Note, pressed, selectClass } from '../marketplace/parts'
import { pointsKey } from './RoomPoints'
import { type Objection, type RoomDetail, ROOMS_KEY, roomRefusal, roomsApi } from './roomsApi'

// RoomObjections.tsx — B41.47: objections to the room's frozen leaderboard (Lens B41.147). The owner freezes the leaderboard
// once, which opens a 14-day window; from then on the points move only by objection. In the window a member objects to the
// points an accepted contribution earned its author, proposing a change; Lens draws three members linked neither to the
// objector nor to the author, nor to each other, and they have 14 days to decide it. Two votes the same way decide it, and
// an upheld objection changes the points in the ledger. Lens decides who may do each, and when; its sentence is shown on a
// refusal. Behind the same room_equity gate as the points ledger, so on Lens's 404 nothing is drawn.

const objectionsKey = (id: string) => [...ROOMS_KEY, 'objections', id]
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toLocaleString('en-US')}`

function status(o: Objection): string {
  switch (o.status) {
    case 'upheld':
      return `Upheld${o.decided_at ? ` on ${formatWhen(o.decided_at)}` : ''}: the points changed`
    case 'dismissed':
      return `Dismissed${o.decided_at ? ` on ${formatWhen(o.decided_at)}` : ''}: the points stand`
    case 'lapsed':
      return 'Lapsed: the panel did not decide it in time, so the points stand'
  }
  return `Open · the panel decides by ${formatWhen(o.decide_by)}`
}

function RaiseForm({ room, onDone }: { room: RoomDetail; onDone: () => Promise<unknown> }) {
  const work = useQuery({ queryKey: [...ROOMS_KEY, 'contributions', room.id], queryFn: () => roomsApi.contributions(room.id) })
  const accepted = (work.data ?? []).filter((c) => c.status === 'accepted' && (c.points ?? 0) > 0)
  const [cid, setCid] = useState('')
  const [change, setChange] = useState('')
  const [reason, setReason] = useState('')
  const raise = useMutation({
    mutationFn: () => roomsApi.raiseObjection(room.id, cid || accepted[0].id, Number(change), reason.trim()),
    onSuccess: () => {
      setChange('')
      setReason('')
      return onDone()
    },
  })
  if (work.isError) return <Note ok={false}>The room’s contributions could not be read. Reload the page to try again.</Note>
  if (accepted.length === 0) return null
  const points = /^\s*[+-]?\d+\s*$/.test(change) && Number(change) !== 0
  const ok = points && reason.trim() !== ''
  return (
    <Card>
      <form
        className="flex flex-col gap-3 p-gutter"
        aria-label="Raise an objection"
        onSubmit={(e) => {
          e.preventDefault()
          if (ok && !raise.isPending) raise.mutate()
        }}
      >
        <label className="text-caption text-muted">
          Contribution
          <select className={selectClass} value={cid || accepted[0].id} onChange={(e) => setCid(e.target.value)}>
            {accepted.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title} · {c.author_workspace_id === room.me?.workspace_id ? 'You' : c.author_workspace_name || c.author_workspace_id}
              </option>
            ))}
          </select>
        </label>
        <label className="text-caption text-muted">
          Change to its author’s points, like −200 or 100
          <Input className="mt-1 block w-32 font-figure" inputMode="numeric" value={change} onChange={(e) => setChange(e.target.value.replace('−', '-'))} />
        </label>
        <label className="flex flex-col gap-1 text-caption text-muted">
          Why
          <textarea
            className={`min-h-20 w-full rounded-control border border-rule bg-surface p-3 text-body text-ink placeholder:text-faint transition-colors duration-200 hover:border-rule-strong disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`}
            maxLength={2000}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        <div>
          <Button type="submit" disabled={!ok || raise.isPending}>
            {raise.isPending ? 'Raising…' : 'Raise the objection'}
          </Button>
        </div>
        {raise.isError ? <Note ok={false}>{roomRefusal(raise.error)}</Note> : null}
      </form>
    </Card>
  )
}

export function RoomObjections({ room }: { room: RoomDetail }) {
  const qc = useQueryClient()
  const me = room.me?.workspace_id ?? ''
  const [confirming, setConfirming] = useState(false)
  // A 404 is Lens's verdict that this room has no objections for this workspace; asking again changes nothing.
  const q = useQuery({ queryKey: objectionsKey(room.id), queryFn: () => roomsApi.objections(room.id), retry: false })
  const titles = useQuery({ queryKey: [...ROOMS_KEY, 'contributions', room.id], queryFn: () => roomsApi.contributions(room.id) })
  // An upheld objection writes to the points ledger, and the leaderboard sits under the ledger's key.
  const refresh = () =>
    Promise.all([qc.invalidateQueries({ queryKey: objectionsKey(room.id) }), qc.invalidateQueries({ queryKey: pointsKey(room.id) })])
  const freeze = useMutation({ mutationFn: () => roomsApi.freezeLeaderboard(room.id), onSuccess: refresh })
  const vote = useMutation({ mutationFn: (v: { oid: string; uphold: boolean }) => roomsApi.voteObjection(room.id, v.oid, v.uphold), onSuccess: refresh })
  if (q.isError && !(q.error instanceof ApiError && q.error.status === 404)) {
    return (
      <Region index="12" label="Objections" className="flex max-w-2xl flex-col gap-3">
        <Note ok={false}>The room’s objections could not be read. Reload the page to try again.</Note>
      </Region>
    )
  }
  if (!q.data) return null
  const k = q.data
  const owner = room.owner_workspace_id === me
  const open = k.objections_close_at !== null && new Date(k.objections_close_at).getTime() > Date.now()
  const who = (ws: string) => (ws === me ? 'You' : ws)
  const title = (id: string) => titles.data?.find((c) => c.id === id)?.title ?? id
  return (
    <Region index="12" label="Objections" className="flex max-w-2xl flex-col gap-3">
      {k.frozen_at === null ? (
        <>
          <p className="text-body text-muted" data-testid="room-objections-state">
            The leaderboard is provisional. Once the room’s owner freezes it, members have 14 days to object to the points a
            contribution earned.
          </p>
          {owner ? (
            <Card>
              <Row
                stack
                label="Freeze the leaderboard"
                hint="Once frozen, the points change only by objection. It cannot be undone."
              >
                {confirming ? (
                  <div className="flex flex-wrap gap-2">
                    <Button variant="danger" disabled={freeze.isPending} onClick={() => freeze.mutate()}>
                      Freeze it
                    </Button>
                    <Button disabled={freeze.isPending} onClick={() => setConfirming(false)}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Button onClick={() => setConfirming(true)}>Freeze the leaderboard</Button>
                )}
              </Row>
            </Card>
          ) : null}
          {freeze.isError ? <Note ok={false}>{roomRefusal(freeze.error)}</Note> : null}
        </>
      ) : (
        <p className="text-body text-muted" data-testid="room-objections-state">
          Frozen on <span className="font-figure">{formatWhen(k.frozen_at)}</span>.{' '}
          {open ? 'Objections are open until' : 'Objections closed on'}{' '}
          <span className="font-figure">{formatWhen(k.objections_close_at ?? k.frozen_at)}</span>.
        </p>
      )}
      <p className="text-caption text-muted" data-testid="room-objections-rules">
        {k.rules}
      </p>
      {open ? <RaiseForm room={room} onDone={refresh} /> : null}
      {k.objections.length > 0 ? (
        <ul aria-label="Objections" className="flex flex-col gap-3">
          {k.objections.map((o) => {
            const mine = o.panel.find((p) => p.workspace_id === me)
            return (
              <li key={o.id} data-testid="room-objection">
                <Card>
                  <div className="flex flex-col gap-2 p-gutter">
                    <p className="text-body text-ink">
                      {title(o.contribution_id)} · {who(o.holder_workspace_id)}:{' '}
                      <span className="font-figure">{signed(o.points)}</span> points
                    </p>
                    <p className="text-caption text-muted">
                      Raised by {who(o.objector_workspace_id)} on <span className="font-figure">{formatWhen(o.raised_at)}</span>
                    </p>
                    <p className="whitespace-pre-line text-body text-ink">{o.reason}</p>
                    <p className="text-body text-ink" data-testid="room-objection-status">
                      {status(o)}
                    </p>
                    <ul aria-label="Panel" className="text-caption text-muted">
                      {o.panel.map((p) => (
                        <li key={p.workspace_id}>
                          {p.workspace_id === me ? 'You' : p.workspace_name || p.workspace_id} ·{' '}
                          {p.uphold === null ? 'not voted yet' : p.uphold ? 'uphold' : 'dismiss'}
                        </li>
                      ))}
                    </ul>
                    {mine && o.status === 'open' ? (
                      <div className="flex flex-wrap gap-2">
                        {([true, false] as const).map((uphold) => (
                          <Button
                            key={String(uphold)}
                            aria-pressed={mine.uphold === uphold}
                            className={pressed}
                            disabled={vote.isPending}
                            onClick={() => vote.mutate({ oid: o.id, uphold })}
                          >
                            {uphold ? 'Uphold' : 'Dismiss'}
                          </Button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </Card>
              </li>
            )
          })}
        </ul>
      ) : open ? (
        <p className="text-body text-muted">No objections yet. Any member can raise one with the form above until the window closes.</p>
      ) : null}
      {vote.isError ? <Note ok={false}>{roomRefusal(vote.error)}</Note> : null}
    </Region>
  )
}
