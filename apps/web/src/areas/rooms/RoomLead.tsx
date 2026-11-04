import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Button, Row } from '@talyvor/ui'
import { Region } from '../../components/Region'
import { formatWhen } from '../lens/format'
import { Card, Note, pressed } from '../marketplace/parts'
import { type RoomDetail, type Takeover, ROOMS_KEY, roomRefusal, roomsApi } from './roomsApi'

// RoomLead.tsx — B41.48: who leads the room, and how that changes when its owner is away (Lens B41.148). An owner who
// does nothing in the room for 60 days can be given notice by a member; anything the owner does in 14 days, or keeping
// the room here, answers it. Unanswered, the members — not the owner, not viewers — vote for a new lead, and the first
// whose voters hold more than half of the room's points becomes its owner. Or a member forks the room instead: a new
// room it owns that names this one. Lens decides who may do each, and when; its sentence is shown on a refusal.

const takeoverKey = (id: string) => [...ROOMS_KEY, 'takeover', id]

function Name({ ws, me }: { ws: string; me: string }) {
  return ws === me ? (
    <span className="text-ink">You</span>
  ) : (
    <span className="inline-block max-w-xs truncate align-bottom font-figure text-ink" title={ws}>
      {ws}
    </span>
  )
}

const Figure = ({ n }: { n: number }) => <span className="font-figure">{n.toLocaleString('en-US')}</span>

export function RoomLead({ room }: { room: RoomDetail }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const me = room.me?.workspace_id ?? ''
  const t = useQuery({ queryKey: takeoverKey(room.id), queryFn: () => roomsApi.takeover(room.id) })
  // A notice, its answer or a vote can change who owns the room, so the room is read again with the takeover.
  const act = useMutation({
    mutationFn: (step: () => Promise<Takeover>) => step(),
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: takeoverKey(room.id) }),
        qc.invalidateQueries({ queryKey: [...ROOMS_KEY, 'room', room.id] }),
      ]),
  })
  const fork = useMutation({
    mutationFn: () => roomsApi.forkRoom(room.id),
    onSuccess: (d) => {
      void qc.invalidateQueries({ queryKey: ROOMS_KEY })
      navigate(`/rooms/${encodeURIComponent(d.id)}`)
    },
  })
  if (!t.data) return null
  const k = t.data
  const notice = k.notice
  const open = notice?.status === 'open'
  const owner = k.owner_workspace_id === me
  const voter = k.members.some((m) => m.workspace_id === me && m.role !== 'owner')
  const candidates = k.members.filter((m) => m.role !== 'owner')
  const myVote = k.members.find((m) => m.workspace_id === me)?.voted_for
  const busy = act.isPending || fork.isPending
  return (
    <Region index="05" label="Lead" className="flex max-w-2xl flex-col gap-3">
      <p className="text-body text-muted" data-testid="room-lead">
        <Name ws={k.owner_workspace_id} me={me} /> {owner ? 'lead' : 'leads'} the room · last active{' '}
        <span className="font-figure">{formatWhen(k.owner_last_active_at)}</span>
      </p>
      {notice?.status === 'elected' && notice.elected_workspace_id ? (
        <p className="text-body text-muted">
          Members holding most of the points elected <Name ws={notice.elected_workspace_id} me={me} /> as lead
          {notice.closed_at ? (
            <>
              {' '}
              on <span className="font-figure">{formatWhen(notice.closed_at)}</span>
            </>
          ) : null}
          .
        </p>
      ) : null}
      {!open ? (
        new Date(k.notice_from).getTime() > Date.now() ? (
          <p className="text-body text-muted">
            If the owner does nothing in the room for 60 days, a member can give notice from{' '}
            <span className="font-figure">{formatWhen(k.notice_from)}</span>.
          </p>
        ) : voter ? (
          <Card>
            <Row
              stack
              label="The owner has done nothing in the room for 60 days"
              hint="If the owner does not answer within 14 days, members holding most of the points can elect a new lead, or fork the room."
            >
              <Button disabled={busy} onClick={() => act.mutate(() => roomsApi.giveNotice(room.id))}>
                Give the owner notice
              </Button>
            </Row>
          </Card>
        ) : null
      ) : (
        <Card>
          <Row
            stack
            label={
              <>
                Notice given <span className="font-figure">{formatWhen(notice.noticed_at)}</span>
              </>
            }
            hint={
              k.voting ? (
                <>
                  By <Name ws={notice.noticed_by_workspace_id} me={me} />. The owner did not answer in 14 days. A new lead needs votes from members holding more than half of the
                  room’s <Figure n={k.total_points} /> points.
                </>
              ) : (
                <>
                  By <Name ws={notice.noticed_by_workspace_id} me={me} />. If the owner does not answer, members can elect a new lead or fork the room from{' '}
                  <span className="font-figure">{formatWhen(notice.voting_from)}</span>.
                </>
              )
            }
          >
            {owner ? (
              <Button disabled={busy} onClick={() => act.mutate(() => roomsApi.answerNotice(room.id))}>
                Keep the room
              </Button>
            ) : null}
          </Row>
          {k.voting ? (
            <ul aria-label="Candidates" className="border-t border-rule">
              {candidates.map((c) => (
                <li key={c.workspace_id}>
                  <Row
                    stack
                    label={<Name ws={c.workspace_id} me={me} />}
                    hint={
                      <span data-testid={`lead-tally-${c.workspace_id}`}>
                        <Figure n={k.tally[c.workspace_id] ?? 0} /> of <Figure n={k.total_points} /> points vote for{' '}
                        {c.workspace_id === me ? 'you' : 'them'} · holds <Figure n={c.points} />
                      </span>
                    }
                  >
                    {voter ? (
                      <Button
                        aria-label={`Vote for ${c.workspace_id === me ? 'yourself' : c.workspace_id} as lead`}
                        aria-pressed={myVote === c.workspace_id}
                        className={pressed}
                        disabled={busy}
                        onClick={() => act.mutate(() => roomsApi.voteLead(room.id, c.workspace_id))}
                      >
                        {myVote === c.workspace_id ? 'Your vote' : 'Vote'}
                      </Button>
                    ) : null}
                  </Row>
                </li>
              ))}
            </ul>
          ) : null}
          {k.voting && voter ? (
            <div className="border-t border-rule">
              <Row stack label="Or start again" hint="A new room you own, with this room’s title and terms, that names this one.">
                <Button disabled={busy} onClick={() => fork.mutate()}>
                  Fork the room
                </Button>
              </Row>
            </div>
          ) : null}
        </Card>
      )}
      {act.isError ? <Note ok={false}>{roomRefusal(act.error)}</Note> : null}
      {fork.isError ? <Note ok={false}>{roomRefusal(fork.error)}</Note> : null}
    </Region>
  )
}
