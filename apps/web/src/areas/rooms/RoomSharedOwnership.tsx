import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Input, Row, cn, focusRing } from '@talyvor/ui'
import { Region } from '../../components/Region'
import { Card, Note } from '../marketplace/parts'
import { type RoomDetail, type SharedOwnership, ROOMS_KEY, parseShare, roomRefusal, roomsApi, shareText } from './roomsApi'

// RoomSharedOwnership.tsx — B41.41: shared ownership, intent only (Lens B41.141). The room's owner switches it on and
// sets the pool for contributors, 10–50%, 25% by default; every member under the current terms sees it with the notice
// Lens words. Lens answers 404 in a workspace that is not synthetic until room_equity is cleared, and to anyone who is
// not a member, so the region is not drawn at all then.

const ownershipKey = (id: string) => [...ROOMS_KEY, 'shared-ownership', id]

function OwnershipForm({ room, o }: { room: RoomDetail; o: SharedOwnership }) {
  const qc = useQueryClient()
  const [enabled, setEnabled] = useState(o.enabled)
  const [pool, setPool] = useState(String(o.pool_bps / 100))
  const parsed = parseShare(pool)
  const bps = parsed !== null && parsed >= 1000 && parsed <= 5000 ? parsed : null
  const save = useMutation({
    mutationFn: () => roomsApi.setSharedOwnership(room.id, enabled, bps ?? 0),
    onSuccess: (next) => qc.setQueryData(ownershipKey(room.id), next),
  })
  return (
    <form
      className="flex flex-col gap-3 p-gutter"
      aria-label="Set shared ownership"
      onSubmit={(e) => {
        e.preventDefault()
        if (bps !== null && !save.isPending) save.mutate()
      }}
    >
      <label className="flex items-center gap-2 text-body text-ink">
        <input
          type="checkbox"
          className={cn('h-4 w-4 accent-accent transition-colors duration-200 hover:border-rule-strong disabled:cursor-not-allowed disabled:opacity-50', focusRing)}
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        Shared ownership on
      </label>
      <label className="text-caption text-muted">
        Pool for contributors, in percent
        <Input className="mt-1 block w-32 font-figure" inputMode="decimal" value={pool} onChange={(e) => setPool(e.target.value)} />
      </label>
      {bps === null ? <Note ok={false}>The pool is a percentage from 10 to 50, like 25.</Note> : null}
      <div>
        <Button type="submit" disabled={bps === null || save.isPending}>
          {save.isPending ? 'Saving…' : 'Save'}
        </Button>
      </div>
      {save.isSuccess ? <Note ok>Saved.</Note> : null}
      {save.isError ? <Note ok={false}>{roomRefusal(save.error)}</Note> : null}
    </form>
  )
}

export function RoomSharedOwnership({ room }: { room: RoomDetail }) {
  // A 404 is Lens's verdict that this room has no shared ownership for this workspace; asking again changes nothing.
  const q = useQuery({ queryKey: ownershipKey(room.id), queryFn: () => roomsApi.sharedOwnership(room.id), retry: false })
  if (!q.data) return null
  const o = q.data
  const owner = room.me?.role === 'owner'
  return (
    <Region index="06" label="Shared ownership" className="flex max-w-2xl flex-col gap-3">
      <Card>
        <Row stack label="Shared ownership">
          <span className="text-body text-ink" data-testid="room-shared-ownership">
            {o.enabled ? (
              <>
                On · pool for contributors <span className="font-figure">{shareText(o.pool_bps)}</span>
              </>
            ) : (
              'Off'
            )}
          </span>
        </Row>
      </Card>
      <p className="text-body text-muted" data-testid="room-shared-ownership-notice">
        {o.notice}
      </p>
      {owner ? (
        <Card>
          <OwnershipForm key={o.updated_at ?? ''} room={room} o={o} />
        </Card>
      ) : (
        <p className="text-body text-muted">Only the room’s owner sets shared ownership.</p>
      )}
    </Region>
  )
}
