import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@talyvor/ui'
import { ApiError } from '../../lib/api'
import { Note, selectClass } from '../marketplace/parts'
import { type Contribution, type Reviews, type RoomDetail, ROOMS_KEY, roomRefusal, roomsApi } from './roomsApi'

// RoomReviews.tsx — B41.44: a contribution's quality, scored by two reviewers (Lens B41.144). Lens draws them at random
// from the room's plain members not linked to its author — never the author, an owner or an editor — and only fills
// empty seats, so whoever asks for the draw, nobody picks them. Each scores 0.5 to 1.5 while the contribution is
// proposed; once both have, its quality is the median, what the points ledger multiplies its size by. Two members that
// scored each other's work count as 1.0 and earn nothing. Behind the same room_equity gate as the points ledger, so on
// Lens's 404 nothing is drawn.

const reviewsKey = (id: string, cid: string) => [...ROOMS_KEY, 'reviews', id, cid]
const times = (bps: number) => (bps / 10_000).toFixed(1)
// 0.5 to 1.5 in tenths, as basis points.
const SCORES = Array.from({ length: 11 }, (_, i) => 5_000 + i * 1_000)

/** On a contribution's card: its reviewers, their scores and the quality they set; drawing them; scoring it. */
export function ContributionReviews({ room, c, me }: { room: RoomDetail; c: Contribution; me: string }) {
  const qc = useQueryClient()
  // A 404 is Lens's verdict that this room has no reviews for this workspace; asking again changes nothing.
  const q = useQuery({ queryKey: reviewsKey(room.id, c.id), queryFn: () => roomsApi.reviews(room.id, c.id), retry: false })
  const [pick, setPick] = useState<number | null>(null)
  const set = (r: Reviews) => qc.setQueryData(reviewsKey(room.id, c.id), r)
  const draw = useMutation({ mutationFn: () => roomsApi.drawReviewers(room.id, c.id), onSuccess: set })
  const give = useMutation({ mutationFn: (bps: number) => roomsApi.review(room.id, c.id, bps), onSuccess: set })
  if (q.isError && !(q.error instanceof ApiError && q.error.status === 404)) {
    return <Note ok={false}>The reviewers could not be read. Reload the page to try again.</Note>
  }
  if (!q.data) return null
  const r = q.data
  const proposed = c.status === 'proposed'
  if (r.reviews.length === 0 && !proposed) return null
  const scored = r.reviews.filter((v) => v.score_bps !== null).length
  const mine = r.reviews.find((v) => v.reviewer_workspace_id === me)
  const score = pick ?? mine?.score_bps ?? 10_000
  const failed = draw.error ?? give.error
  return (
    <div className="flex flex-col gap-2 border-t border-rule pt-3" data-testid="contribution-reviews">
      <span className="text-caption text-muted" data-testid="contribution-quality">
        {scored >= 2 && r.reviews.length >= 2 ? (
          <>
            Quality <span className="font-figure text-ink">×{times(r.quality_bps)}</span>, the median of two reviewers’ scores
          </>
        ) : (
          'Quality is scored by two members drawn at random, never by its author or anyone linked to them.'
        )}
      </span>
      {r.reviews.length > 0 ? (
        <ul className="flex flex-col gap-1" aria-label={`Reviewers of ${c.title}`}>
          {r.reviews.map((v) => (
            <li key={v.reviewer_workspace_id} className="flex flex-wrap items-baseline gap-2 text-caption text-muted" data-testid="contribution-reviewer">
              <span className="max-w-xs truncate text-ink" title={v.reviewer_workspace_id}>
                {v.reviewer_workspace_id === me ? 'You' : v.reviewer_workspace_name || v.reviewer_workspace_id}
              </span>
              <span className="font-figure">{v.score_bps === null ? 'not scored yet' : `×${times(v.score_bps)}`}</span>
              {v.ring ? <span>counts as ×1.0: the two scored each other’s work</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {proposed && (r.reviews.length < 2 || mine) ? (
        <span className="flex flex-wrap items-center gap-2">
          {r.reviews.length < 2 ? (
            <Button disabled={draw.isPending} onClick={() => draw.mutate()}>
              {r.reviews.length === 0 ? 'Draw reviewers' : 'Draw the second reviewer'}
            </Button>
          ) : null}
          {mine ? (
            <>
              <span className="grow" />
              <select
                aria-label={`Your score for ${c.title}`}
                className={`${selectClass} mt-0 wide:w-32`}
                value={score}
                onChange={(e) => setPick(Number(e.target.value))}
              >
                {SCORES.map((bps) => (
                  <option key={bps} value={bps}>
                    ×{times(bps)}
                  </option>
                ))}
              </select>
              <Button disabled={give.isPending} onClick={() => give.mutate(score)}>
                {mine.score_bps === null ? 'Score' : 'Change score'}
              </Button>
            </>
          ) : null}
        </span>
      ) : null}
      {draw.isSuccess && r.reviews.length < 2 ? (
        <Note ok={false}>
          {r.reviews.length === 0 ? 'No member can review it yet' : 'Only one member can review it so far'}: reviewers are
          members who neither decide it nor are linked to its author. Ask again when more join.
        </Note>
      ) : null}
      {failed ? <Note ok={false}>{roomRefusal(failed)}</Note> : null}
    </div>
  )
}
