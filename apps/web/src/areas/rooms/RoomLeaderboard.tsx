import { useQuery } from '@tanstack/react-query'
import { Region } from '../../components/Region'
import { ApiError } from '../../lib/api'
import { Card, Note } from '../marketplace/parts'
import { pointsKey } from './RoomPoints'
import { type RoomDetail, roomsApi, shareText } from './roomsApi'

// RoomLeaderboard.tsx — B41.45: the room's provisional leaderboard (Lens B41.145), live, for its members only. Each holder's
// points from the ledger and its estimated share of the contributor pool: the identity-checked holders' shares add up to
// 100% of the pool, and a holder waiting for its owner's identity check has none yet. Lens's note that nothing is final
// until the Gate is shown as it words it. Behind the same room_equity gate as the points ledger, so on Lens's 404 nothing
// is drawn.

// Under the points ledger's key, so whatever refreshes the points (an accepted contribution) refreshes the shares too.
const leaderboardKey = (id: string) => [...pointsKey(id), 'leaderboard']
const points = (n: number) => n.toLocaleString('en-US')

export function RoomLeaderboard({ room }: { room: RoomDetail }) {
  const q = useQuery({ queryKey: leaderboardKey(room.id), queryFn: () => roomsApi.leaderboard(room.id), retry: false })
  if (q.isError && !(q.error instanceof ApiError && q.error.status === 404)) {
    return (
      <Region index="09" label="Leaderboard" className="flex max-w-2xl flex-col gap-3">
        <Note ok={false}>The room’s leaderboard could not be read. Reload the page to try again.</Note>
      </Region>
    )
  }
  if (!q.data) return null
  const l = q.data
  const me = room.me?.workspace_id
  return (
    <Region index="09" label="Leaderboard" className="flex max-w-2xl flex-col gap-3">
      <p className="text-body text-muted">
        Each person’s points and estimated share of the pool for contributors
        {l.enabled ? (
          <>
            {' '}
            (<span className="font-figure">{shareText(l.pool_bps)}</span> of the room)
          </>
        ) : null}
        .
      </p>
      {l.rows.length === 0 ? (
        <p className="text-body text-muted" data-testid="room-leaderboard-empty">
          Shares appear here when the room’s owner accepts a contribution claimed at a size.
        </p>
      ) : (
        <Card>
          <table className="w-full text-body text-ink" aria-label="Leaderboard">
            <thead>
              <tr className="text-left text-caption text-muted">
                <th className="px-gutter py-2 font-normal">Who</th>
                <th className="px-gutter py-2 text-right font-normal">Points</th>
                <th className="px-gutter py-2 text-right font-normal">Share of the pool</th>
              </tr>
            </thead>
            <tbody>
              {l.rows.map((r) => (
                <tr key={r.workspace_id} className="border-t border-rule align-top" data-testid="room-leaderboard-row">
                  <td className="px-gutter py-2">
                    {r.workspace_id === me ? 'You' : r.workspace_name || r.workspace_id}
                    {r.identity_checked ? null : <span className="block text-caption text-muted">Shares once its owner is identity-checked</span>}
                  </td>
                  <td className="px-gutter py-2 text-right font-figure">{points(r.points)}</td>
                  <td className="px-gutter py-2 text-right font-figure">{r.identity_checked ? shareText(r.share_bps) : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <p className="text-body text-ink" data-testid="room-leaderboard-note">
        {l.note}
      </p>
    </Region>
  )
}
