import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Input, focusRing } from '@talyvor/ui'
import { Region } from '../../components/Region'
import { ApiError } from '../../lib/api'
import { formatWhen } from '../lens/format'
import { Card, Note, selectClass } from '../marketplace/parts'
import { useRateCard } from './RoomRateCard'
import { type RoomDetail, type RoomTask, ROOMS_KEY, roomRefusal, roomsApi } from './roomsApi'

// RoomTasks.tsx — B41.52: the room's open tasks board (Lens B41.152). The owner or an editor posts a task at a size on the
// rate card, and that size's points are fixed on it then. Any member claims an open task for itself and may let it go
// again, with nothing lost. A task is never assigned to anyone and has no deadline or penalty, so contributors stay
// volunteers: the form has no field for either and Lens refuses a body that sends one. Behind the same room_equity gate
// as the rate card, so on Lens's 404 nothing is drawn.

const tasksKey = (id: string) => [...ROOMS_KEY, 'tasks', id]
const points = (n: number) => n.toLocaleString('en-US')

function PostForm({ room, onDone }: { room: RoomDetail; onDone: () => Promise<unknown> }) {
  const rc = useRateCard(room.id)
  const sizes = rc.data?.sizes ?? []
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [size, setSize] = useState('')
  const post = useMutation({
    mutationFn: () => roomsApi.postTask(room.id, title.trim(), description.trim(), size || sizes[0].size),
    onSuccess: () => {
      setTitle('')
      setDescription('')
      return onDone()
    },
  })
  if (rc.isError) return <Note ok={false}>The room’s rate card could not be read. Reload the page to try again.</Note>
  if (sizes.length === 0) {
    return rc.isPending ? null : <p className="text-body text-muted">Publish the rate card first: a task is posted at one of its sizes.</p>
  }
  const ok = title.trim() !== ''
  return (
    <Card>
      <form
        className="flex flex-col gap-3 p-gutter"
        aria-label="Post a task"
        onSubmit={(e) => {
          e.preventDefault()
          if (ok && !post.isPending) post.mutate()
        }}
      >
        <label className="text-caption text-muted">
          Title
          <Input className="mt-1 block w-full" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-caption text-muted">
          What it involves
          <textarea
            className={`min-h-20 w-full rounded-control border border-rule bg-surface p-3 text-body text-ink placeholder:text-faint transition-colors duration-200 hover:border-rule-strong disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`}
            maxLength={4000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <label className="text-caption text-muted">
          Size
          <select className={selectClass} value={size || sizes[0].size} onChange={(e) => setSize(e.target.value)}>
            {sizes.map((z) => (
              <option key={z.size} value={z.size}>
                {z.size} · {points(z.points)} points
              </option>
            ))}
          </select>
        </label>
        <div>
          <Button type="submit" disabled={!ok || post.isPending}>
            {post.isPending ? 'Posting…' : 'Post the task'}
          </Button>
        </div>
        {post.isError ? <Note ok={false}>{roomRefusal(post.error)}</Note> : null}
      </form>
    </Card>
  )
}

function status(t: RoomTask, me: string): string {
  if (!t.claimant_workspace_id) return 'Open · anyone in the room may claim it'
  const who = t.claimant_workspace_id === me ? 'you' : t.claimant_workspace_name || t.claimant_workspace_id
  return `Claimed by ${who}${t.claimed_at ? ` on ${formatWhen(t.claimed_at)}` : ''}`
}

export function RoomTasks({ room }: { room: RoomDetail }) {
  const qc = useQueryClient()
  const me = room.me?.workspace_id ?? ''
  const role = room.me?.role ?? ''
  // A 404 is Lens's verdict that this room has no tasks board for this workspace; asking again changes nothing.
  const q = useQuery({ queryKey: tasksKey(room.id), queryFn: () => roomsApi.tasks(room.id), retry: false })
  const refresh = () => qc.invalidateQueries({ queryKey: tasksKey(room.id) })
  const claim = useMutation({
    mutationFn: (v: { tid: string; take: boolean }) => (v.take ? roomsApi.claimTask(room.id, v.tid) : roomsApi.releaseTask(room.id, v.tid)),
    onSettled: refresh,
  })
  if (q.isError && !(q.error instanceof ApiError && q.error.status === 404)) {
    return (
      <Region index="13" label="Tasks" className="flex max-w-2xl flex-col gap-3">
        <Note ok={false}>The room’s tasks could not be read. Reload the page to try again.</Note>
      </Region>
    )
  }
  if (!q.data) return null
  const poster = role === 'owner' || role === 'editor'
  return (
    <Region index="13" label="Tasks" className="flex max-w-2xl flex-col gap-3">
      <p className="text-body text-muted">
        Tasks anyone in the room may pick up. Nobody is given a task and none has a deadline: claim one you want to do, and
        let it go if you change your mind.
      </p>
      {poster ? <PostForm room={room} onDone={refresh} /> : null}
      {q.data.length > 0 ? (
        <ul aria-label="Tasks" className="flex flex-col gap-3">
          {q.data.map((t) => (
            <li key={t.id} data-testid="room-task">
              <Card>
                <div className="flex flex-col gap-2 p-gutter">
                  <p className="text-body text-ink">{t.title}</p>
                  <p className="text-caption text-muted">
                    Size {t.size} · <span className="font-figure">{points(t.points)}</span> points
                  </p>
                  {t.description ? <p className="whitespace-pre-line text-body text-ink">{t.description}</p> : null}
                  <p className="text-body text-ink" data-testid="room-task-status">
                    {status(t, me)}
                  </p>
                  {!t.claimant_workspace_id && role !== 'viewer' ? (
                    <div>
                      <Button disabled={claim.isPending} onClick={() => claim.mutate({ tid: t.id, take: true })}>
                        Claim it
                      </Button>
                    </div>
                  ) : t.claimant_workspace_id === me ? (
                    <div>
                      <Button disabled={claim.isPending} onClick={() => claim.mutate({ tid: t.id, take: false })}>
                        Let it go
                      </Button>
                    </div>
                  ) : null}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-body text-muted">No tasks on the board yet.</p>
      )}
      {claim.isError ? <Note ok={false}>{roomRefusal(claim.error)}</Note> : null}
    </Region>
  )
}
