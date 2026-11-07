import { useQuery } from '@tanstack/react-query'
import { Row } from '@talyvor/ui'
import { Region } from '../../components/Region'
import { ApiError } from '../../lib/api'
import { Card, Note } from '../marketplace/parts'
import { type PointsEntry, type RoomDetail, ROOMS_KEY, roomsApi, usdText } from './roomsApi'

// RoomPoints.tsx — B41.43: the room's points ledger (Lens B41.143). Each accepted contribution earns its size's points ×
// its quality × its survival, in rows nobody edits: a fork passes the room's remix share of its points to the original's
// author, and a contribution rejected after it was accepted gets a withdrawn row that takes its points back. Money earns
// no points, and prizes or royalties already received reduce a size. An agent's points are its owner's, counted once the
// owner is identity-checked. Behind the same room_equity gate as the rate card, so on Lens's 404 nothing is drawn.

export const pointsKey = (id: string) => [...ROOMS_KEY, 'points', id]
const points = (n: number) => n.toLocaleString('en-US')
const times = (bps: number) => String(bps / 10_000)
const percent = (bps: number) => `${bps / 100}%`

/** How a row's points were worked out, in the words of the ledger. */
function working(e: PointsEntry): string {
  const earned = Math.floor((e.size_points * e.quality_bps) / 10_000)
  const less = e.received_usd_micros > 0 ? `, after ${usdText(e.received_usd_micros)} already received` : ''
  switch (e.reason) {
    case 'remix_share':
      return `${percent(e.remix_share_bps)} of a fork’s ${points(earned)} points`
    case 'withdrawn':
      return 'Taken back: rejected after it was accepted'
    case 'review':
      return `Reviewed it: the score, ${times(e.quality_bps)}, agreed with the decision`
  }
  const passed = e.remix_share_bps > 0 ? `, less ${percent(e.remix_share_bps)} to the original` : ''
  return `${points(e.size_points)} × quality ${times(e.quality_bps)} × survival ${percent(e.survival_bps)}${less}${passed}`
}

export function RoomPoints({ room }: { room: RoomDetail }) {
  // A 404 is Lens's verdict that this room has no points ledger for this workspace; asking again changes nothing.
  const q = useQuery({ queryKey: pointsKey(room.id), queryFn: () => roomsApi.points(room.id), retry: false })
  const titles = useQuery({ queryKey: [...ROOMS_KEY, 'contributions', room.id], queryFn: () => roomsApi.contributions(room.id) })
  if (q.isError && !(q.error instanceof ApiError && q.error.status === 404)) {
    return (
      <Region index="08" label="Points" className="flex max-w-2xl flex-col gap-3">
        <Note ok={false}>The room’s points could not be read. Reload the page to try again.</Note>
      </Region>
    )
  }
  if (!q.data) return null
  const p = q.data
  const me = room.me?.workspace_id
  const who = (ws: string) => (ws === me ? 'You' : (p.holders.find((h) => h.workspace_id === ws)?.workspace_name ?? ws))
  const title = (id: string) => titles.data?.find((c) => c.id === id)?.title ?? id
  return (
    <Region index="08" label="Points" className="flex max-w-2xl flex-col gap-3">
      <p className="text-body text-muted">
        Each accepted contribution earns its size’s points × its quality × its survival. A fork passes the room’s remix share
        of its points to the original. Money earns no points, and prizes or royalties already received reduce a size.
      </p>
      {p.entries.length === 0 ? (
        <p className="text-body text-muted" data-testid="room-points-empty">
          Points appear here when the room’s owner accepts a contribution claimed at a size.
        </p>
      ) : (
        <>
          <Card>
            <Row stack label="Points held by identity-checked owners">
              <span className="font-figure text-body text-ink">{points(p.total_points)} points</span>
            </Row>
            <table className="w-full text-body text-ink" aria-label="Holders">
              <tbody>
                {p.holders.map((h) => (
                  <tr key={h.workspace_id} className="border-t border-rule" data-testid="room-points-holder">
                    <td className="px-gutter py-2">
                      {who(h.workspace_id)}
                      {h.identity_checked ? null : <span className="block text-caption text-muted">Counts once its owner is identity-checked</span>}
                    </td>
                    <td className="px-gutter py-2 text-right font-figure">{points(h.points)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <Card>
            <table className="w-full text-body text-ink" aria-label="Ledger">
              <thead>
                <tr className="text-left text-caption text-muted">
                  <th className="px-gutter py-2 font-normal">Contribution</th>
                  <th className="px-gutter py-2 text-right font-normal">Points</th>
                </tr>
              </thead>
              <tbody>
                {p.entries.map((e) => (
                  <tr key={e.id} className="border-t border-rule align-top" data-testid="room-points-entry">
                    <td className="px-gutter py-2">
                      {title(e.contribution_id)} · {who(e.workspace_id)}
                      <span className="block text-caption text-muted">{working(e)}</span>
                    </td>
                    <td className="px-gutter py-2 text-right font-figure">{points(e.points)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </Region>
  )
}
