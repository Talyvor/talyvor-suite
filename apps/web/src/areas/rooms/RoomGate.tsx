import { type ReactNode, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Input, Row } from '@talyvor/ui'
import { Region } from '../../components/Region'
import { ApiError } from '../../lib/api'
import { Card, Note } from '../marketplace/parts'
import { type GateThresholds, type RoomDetail, type RoomGate as Gate, ROOMS_KEY, roomRefusal, roomsApi } from './roomsApi'

// RoomGate.tsx — B41.46: the room's Gate tracker (Lens B41.146), progress towards distribution from Talyvor's own records.
// Shipped: a public beta live 8 weeks in a row. Used: people not linked to the owner, active in 6 of the last 8 weeks.
// Paid: $1,000 from 10 payers not linked to the owner, through Talyvor billing. Shipped and Paid read the room's published
// build, so until a room can publish one they show Lens's "needs a published build". The owner may raise a threshold and
// never lower it: Lens refuses a lower one, and its sentence is shown. Behind room_equity, so on Lens's 404 nothing is drawn.

const gateKey = (id: string) => [...ROOMS_KEY, 'gate', id]
const count = (n: number) => n.toLocaleString('en-US')
const dollars = (micros: number) => `$${count(Math.floor(micros / 1_000_000))}`
const whole = (s: string) => (/^\s*\d{1,9}\s*$/.test(s) ? Number(s) : null)

const STATUS: Record<string, string> = { met: 'Met', in_progress: 'In progress' }

function Progress({ testid, status, note, children }: { testid: string; status: string; note?: string; children: ReactNode }) {
  return (
    <span className="text-body text-ink" data-testid={testid}>
      {note ? <span className="text-muted">{note.charAt(0).toUpperCase() + note.slice(1)}</span> : children}
      {note ? null : <span className="block text-caption text-muted">{STATUS[status] ?? status}</span>}
    </span>
  )
}

const FIELDS = [
  ['shipped_weeks', 'Weeks live in a row'],
  ['used_people', 'People'],
  ['used_active_weeks', 'Active weeks of the last 8'],
  ['paid_usd_micros', 'Paid, in dollars'],
  ['paid_payers', 'Payers'],
] as const

type Key = (typeof FIELDS)[number][0]

function ThresholdsForm({ room, t }: { room: RoomDetail; t: GateThresholds }) {
  const qc = useQueryClient()
  const [draft, setDraft] = useState<Record<Key, string>>(() => ({
    shipped_weeks: String(t.shipped_weeks),
    used_people: String(t.used_people),
    used_active_weeks: String(t.used_active_weeks),
    paid_usd_micros: String(Math.floor(t.paid_usd_micros / 1_000_000)),
    paid_payers: String(t.paid_payers),
  }))
  const ok = FIELDS.every(([k]) => whole(draft[k]) !== null)
  const save = useMutation({
    mutationFn: () =>
      roomsApi.setGateThresholds(room.id, {
        shipped_weeks: Number(draft.shipped_weeks),
        used_people: Number(draft.used_people),
        used_active_weeks: Number(draft.used_active_weeks),
        paid_usd_micros: Number(draft.paid_usd_micros) * 1_000_000,
        paid_payers: Number(draft.paid_payers),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: gateKey(room.id) }),
  })
  return (
    <form
      className="flex flex-col gap-3 p-gutter"
      aria-label="Raise the Gate thresholds"
      onSubmit={(e) => {
        e.preventDefault()
        if (ok && !save.isPending) save.mutate()
      }}
    >
      <div className="flex flex-wrap items-end gap-2">
        {FIELDS.map(([k, label]) => (
          <label key={k} className="text-caption text-muted">
            {label}
            <Input
              className="mt-1 block w-32 font-figure"
              inputMode="numeric"
              value={draft[k]}
              onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
            />
          </label>
        ))}
      </div>
      {ok ? null : <Note ok={false}>Each threshold is a whole number.</Note>}
      <div>
        <Button type="submit" disabled={!ok || save.isPending}>
          {save.isPending ? 'Saving…' : 'Save'}
        </Button>
      </div>
      {save.isSuccess ? <Note ok>Saved.</Note> : null}
      {save.isError ? <Note ok={false}>{roomRefusal(save.error)}</Note> : null}
    </form>
  )
}

export function RoomGate({ room }: { room: RoomDetail }) {
  // A 404 is Lens's verdict that this room has no Gate tracker for this workspace; asking again changes nothing.
  const q = useQuery({ queryKey: gateKey(room.id), queryFn: () => roomsApi.gate(room.id), retry: false })
  if (q.isError && !(q.error instanceof ApiError && q.error.status === 404)) {
    return (
      <Region index="10" label="Gate" className="flex max-w-2xl flex-col gap-3">
        <Note ok={false}>The room’s Gate tracker could not be read. Reload the page to try again.</Note>
      </Region>
    )
  }
  if (!q.data) return null
  const g: Gate = q.data
  const t = g.thresholds
  const owner = room.me?.role === 'owner'
  return (
    <Region index="10" label="Gate" className="flex max-w-2xl flex-col gap-3">
      <p className="text-body text-muted">Progress towards distribution, from Talyvor’s own data.</p>
      <Card>
        <Row stack label="Shipped">
          <Progress testid="room-gate-shipped" status={g.shipped.status} note={g.shipped.note}>
            <span className="font-figure">{count(g.shipped.weeks)}</span> of <span className="font-figure">{count(t.shipped_weeks)}</span>{' '}
            weeks live in a row
          </Progress>
        </Row>
        <Row stack label="Used">
          <Progress testid="room-gate-used" status={g.used.status}>
            <span className="font-figure">{count(g.used.people)}</span> of <span className="font-figure">{count(t.used_people)}</span> people
            not linked to the owner, active in <span className="font-figure">{t.used_active_weeks}</span> of the last{' '}
            <span className="font-figure">{t.used_window_weeks}</span> weeks
          </Progress>
        </Row>
        <Row stack label="Paid">
          <Progress testid="room-gate-paid" status={g.paid.status} note={g.paid.note}>
            <span className="font-figure">{dollars(g.paid.usd_micros)}</span> of{' '}
            <span className="font-figure">{dollars(t.paid_usd_micros)}</span> from <span className="font-figure">{count(g.paid.payers)}</span>{' '}
            of <span className="font-figure">{count(t.paid_payers)}</span> payers
          </Progress>
        </Row>
      </Card>
      {g.met ? <Note ok>All three tests are met.</Note> : null}
      <p className="text-body text-muted" data-testid="room-gate-notice">
        {g.notice}
      </p>
      {owner ? (
        <Card>
          <ThresholdsForm key={t.updated_at ?? ''} room={room} t={t} />
        </Card>
      ) : (
        <p className="text-body text-muted">Only the room’s owner raises the thresholds. They are never lowered.</p>
      )}
    </Region>
  )
}
