import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Input, Row } from '@talyvor/ui'
import { Region } from '../../components/Region'
import { Card, Note, selectClass } from '../marketplace/parts'
import { type Contribution, type RateCard, type RoomDetail, ROOMS_KEY, roomRefusal, roomsApi } from './roomsApi'

// RoomRateCard.tsx — B41.42: the room's rate card (Lens B41.142). The owner publishes the pool's points and, for each
// size of work, its estimated hours and the points per hour of its market band; a size earns hours × points per hour
// and none may be worth more than 5% of the pool. A contribution claims a size before the work, and that size's points
// are fixed on it then: a later rate card does not change them, and Lens refuses a raise once it is decided. Behind the
// same room_equity gate as shared ownership, so on Lens's 404 nothing is drawn.

const rateCardKey = (id: string) => [...ROOMS_KEY, 'rate-card', id]
const points = (n: number) => n.toLocaleString('en-US')
const whole = (s: string) => (/^\s*\d{1,13}\s*$/.test(s) ? Number(s) : null)

// A 404 is Lens's verdict that this room has no rate card for this workspace; asking again changes nothing.
export const useRateCard = (id: string) =>
  useQuery({ queryKey: rateCardKey(id), queryFn: () => roomsApi.rateCard(id), retry: false })

interface Draft {
  size: string
  hours: string
  pph: string
}

const blank: Draft = { size: '', hours: '', pph: '' }

/** What is wrong with the owner's draft, said the way Lens says it, or null when Lens may be asked. */
function draftProblem(pool: number | null, rows: Draft[]): string | null {
  if (pool === null || pool < 1) return 'The pool is a whole number of points, like 10000.'
  const cap = Math.floor((pool * 500) / 10_000)
  const seen = new Set<string>()
  for (const r of rows) {
    const name = r.size.trim()
    const h = whole(r.hours)
    const p = whole(r.pph)
    if (name === '') return 'Each size needs a name, like M.'
    if (seen.has(name)) return `Size ${name} is on the rate card twice.`
    seen.add(name)
    if (h === null || h < 1 || p === null || p < 1) return `Size ${name}: hours and points per hour are whole numbers from 1.`
    if (h * p > cap) return `Size ${name} is worth ${points(h * p)} points, more than 5% of the pool (${points(cap)}).`
  }
  return null
}

function RateCardForm({ room, rc }: { room: RoomDetail; rc: RateCard }) {
  const qc = useQueryClient()
  const [pool, setPool] = useState(rc.pool_points > 0 ? String(rc.pool_points) : '')
  const [rows, setRows] = useState<Draft[]>(
    rc.sizes.length > 0 ? rc.sizes.map((z) => ({ size: z.size, hours: String(z.hours), pph: String(z.points_per_hour) })) : [blank],
  )
  const problem = draftProblem(whole(pool), rows)
  const save = useMutation({
    mutationFn: () =>
      roomsApi.setRateCard(
        room.id,
        Number(pool),
        rows.map((r) => ({ size: r.size.trim(), hours: Number(r.hours), points_per_hour: Number(r.pph) })),
      ),
    onSuccess: (next) => qc.setQueryData(rateCardKey(room.id), next),
  })
  const set = (i: number, k: keyof Draft, v: string) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)))
  return (
    <form
      className="flex flex-col gap-3 p-gutter"
      aria-label="Publish the rate card"
      onSubmit={(e) => {
        e.preventDefault()
        if (problem === null && !save.isPending) save.mutate()
      }}
    >
      <label className="text-caption text-muted">
        Pool, in points
        <Input className="mt-1 block w-40 font-figure" inputMode="numeric" value={pool} onChange={(e) => setPool(e.target.value)} />
      </label>
      {rows.map((r, i) => (
        <fieldset key={i} className="flex flex-wrap items-end gap-2" aria-label={`Size ${i + 1}`}>
          <label className="text-caption text-muted">
            Size
            <Input className="mt-1 block w-24" value={r.size} onChange={(e) => set(i, 'size', e.target.value)} />
          </label>
          <label className="text-caption text-muted">
            Hours
            <Input className="mt-1 block w-24 font-figure" inputMode="numeric" value={r.hours} onChange={(e) => set(i, 'hours', e.target.value)} />
          </label>
          <label className="text-caption text-muted">
            Points per hour
            <Input className="mt-1 block w-32 font-figure" inputMode="numeric" value={r.pph} onChange={(e) => set(i, 'pph', e.target.value)} />
          </label>
          {rows.length > 1 ? (
            <Button type="button" aria-label={`Remove size ${i + 1}`} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
              Remove
            </Button>
          ) : null}
        </fieldset>
      ))}
      {problem !== null ? <Note ok={false}>{problem}</Note> : null}
      <div className="flex gap-2">
        <Button type="button" disabled={rows.length >= 12} onClick={() => setRows((rs) => [...rs, blank])}>
          Add a size
        </Button>
        <Button type="submit" disabled={problem !== null || save.isPending}>
          {save.isPending ? 'Publishing…' : 'Publish'}
        </Button>
      </div>
      {save.isSuccess ? <Note ok>Published. Contributions already sized keep their points.</Note> : null}
      {save.isError ? <Note ok={false}>{roomRefusal(save.error)}</Note> : null}
    </form>
  )
}

export function RoomRateCard({ room }: { room: RoomDetail }) {
  const q = useRateCard(room.id)
  if (!q.data) return null
  const rc = q.data
  const owner = room.me?.role === 'owner'
  return (
    <Region index="07" label="Rate card" className="flex max-w-2xl flex-col gap-3">
      <p className="text-body text-muted">
        Points for each size of work: its estimated hours times the points per hour of its band. A contribution’s points are
        fixed when its size is claimed, and never raised after it is accepted.
      </p>
      {rc.pool_points === 0 ? (
        <p className="text-body text-muted" data-testid="room-rate-card-empty">
          The room’s owner has not published a rate card yet.
        </p>
      ) : (
        <Card>
          <Row stack label="Pool">
            <span className="font-figure text-body text-ink">{points(rc.pool_points)} points</span>
          </Row>
          <Row stack label="Most one item earns, 5% of the pool">
            <span className="font-figure text-body text-ink">{points(rc.item_cap_points)} points</span>
          </Row>
          <table className="w-full text-body text-ink" aria-label="Sizes">
            <thead>
              <tr className="text-left text-caption text-muted">
                <th className="px-gutter py-2 font-normal">Size</th>
                <th className="px-gutter py-2 text-right font-normal">Hours</th>
                <th className="px-gutter py-2 text-right font-normal">Points per hour</th>
                <th className="px-gutter py-2 text-right font-normal">Points</th>
              </tr>
            </thead>
            <tbody>
              {rc.sizes.map((z) => (
                <tr key={z.size} className="border-t border-rule" data-testid="rate-card-size">
                  <td className="px-gutter py-2">{z.size}</td>
                  <td className="px-gutter py-2 text-right font-figure">{points(z.hours)}</td>
                  <td className="px-gutter py-2 text-right font-figure">{points(z.points_per_hour)}</td>
                  <td className="px-gutter py-2 text-right font-figure">{points(z.points)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {owner ? (
        <Card>
          <RateCardForm key={rc.updated_at ?? ''} room={room} rc={rc} />
        </Card>
      ) : (
        <p className="text-body text-muted">Only the room’s owner publishes the rate card.</p>
      )}
    </Region>
  )
}

/** On a contribution's card: its size and points, and claiming a size — its author once, the owner or an editor any time. */
export function ContributionSize({ room, c, me, update }: { room: RoomDetail; c: Contribution; me: string; update: (c: Contribution) => void }) {
  const q = useRateCard(room.id)
  const sizes = q.data?.sizes ?? []
  const [pick, setPick] = useState(c.size ?? '')
  const claim = useMutation({ mutationFn: (size: string) => roomsApi.claimSize(room.id, c.id, size), onSuccess: update })
  if (!q.data) return null
  const decides = room.me?.role === 'owner' || room.me?.role === 'editor'
  const may = sizes.length > 0 && (decides || (c.author_workspace_id === me && !c.size))
  if (!c.size && !may) return null
  const chosen = pick || sizes[0]?.size || ''
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-caption text-muted" data-testid="contribution-size">
        {c.size ? (
          <>
            Size {c.size} · <span className="font-figure">{points(c.points ?? 0)}</span> points
          </>
        ) : (
          'No size claimed yet'
        )}
      </span>
      {may ? (
        <>
          <span className="grow" />
          <select
            aria-label={`Size for ${c.title}`}
            className={`${selectClass} mt-0 wide:w-48`}
            value={chosen}
            onChange={(e) => setPick(e.target.value)}
          >
            {sizes.map((z) => (
              <option key={z.size} value={z.size}>
                {z.size} · {points(z.points)} points
              </option>
            ))}
          </select>
          <Button disabled={claim.isPending || chosen === ''} onClick={() => claim.mutate(chosen)}>
            {c.size ? 'Change size' : 'Claim size'}
          </Button>
        </>
      ) : null}
      {claim.isError ? <Note ok={false}>{roomRefusal(claim.error)}</Note> : null}
    </div>
  )
}
