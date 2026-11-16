import { useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Button,
  Card,
  Dialog,
  Face,
  Field,
  Icon,
  type IconName,
  Input,
  KindTile,
  faceColours,
  faceOf,
  faceShapes,
  pocketFocusRing,
} from '@talyvor/ui/pocket'
import type { FaceColour, FaceShape } from '@talyvor/ui/pocket'
import { BOOK_KEY, SCHEDULES_KEY, rulesKey, statementKey } from './AgentBank'
import { cardKey } from './AgentCardPanel'
import { DESIGN_ATTR } from '../../pocketPending'
import { PictureGallery } from '../../cards/HelperPicker'
import { AGENT_PICTURES, lookFor, pictureOf } from '../../cards/agentPictures'
import { type Agent, type AgentArchive, agentBankApi, refusalText } from './agentBankApi'

// AgentSettings.tsx — B57.22: the Settings section of an agent's page, as Pocket's w-agent-research draws it. One row
// for each thing the agent's owner can set or do; a row opens it over the page. Name and look and Archive are drawn
// here; the rest are the agent view's own forms, given to this section, so each posts what it posted before.
// B57.167 — those seven are drawn in Pocket too, and each opens over the page as the rest do.

/** What a row opens: the agent view's form for it. */
export interface SettingsForms {
  keyForm: React.ReactNode
  card: React.ReactNode
  boost: React.ReactNode
  schedules: React.ReactNode
  credential: React.ReactNode
}

// B61.14 — Automatic top-up and Pay another agent move LXC, which is parked: they are not drawn.
type Open = 'look' | 'key' | 'card' | 'boost' | 'schedules' | 'prompts' | 'credential' | 'archive' | null

const CARD_CURRENCY: Record<string, string> = {
  gbp: 'pounds',
  eur: 'euros',
  usd: 'US dollars',
}

const rowClass = `flex w-full items-center gap-3 border-t border-line py-2.5 text-left text-reading first:border-t-0 rounded-control ${pocketFocusRing}`

function RowBody({ icon, title, line, lineId, chevron = true }: { icon: IconName; title: string; line: React.ReactNode; lineId?: string; chevron?: boolean }) {
  return (
    <>
      <KindTile on="white" icon={<Icon name={icon} size={18} />} />
      <span className="min-w-0 flex-1">
        <span className="block font-semibold text-ink">{title}</span>
        <span id={lineId} className="block text-body font-normal text-ink-3">
          {line}
        </span>
      </span>
      {chevron ? <Icon name="chev" size={16} className="shrink-0 text-ink-3" /> : null}
    </>
  )
}

function SettingRow({ icon, title, line, onOpen }: { icon: IconName; title: string; line: React.ReactNode; onOpen: () => void }) {
  const lineId = useId()
  return (
    // The whole row is one control, named by its title, with its line as what it says now: an empty button over the
    // row, so the words under it wrap as the row's words and not as a button's label.
    <div className={`relative ${rowClass}`} data-testid={`agent-setting-${title}`}>
      <RowBody icon={icon} title={title} line={line} lineId={lineId} />
      <button
        type="button"
        className={`absolute inset-0 rounded-control ${pocketFocusRing}`}
        onClick={onOpen}
        aria-haspopup="dialog"
        aria-label={title}
        aria-describedby={lineId}
      />
    </div>
  )
}

/** B57.22 — the agent's name, what it is for, and the colour and face it wears everywhere it is drawn. B61.102 — and its
 *  picture, one of the gallery's 27: a picture sets its colour, and a colour picked alone takes that colour's helper, as
 *  Lens does, so the two never disagree. */
export function LookDialog({ agent, open, onClose }: { agent: Agent; open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const now = faceOf(agent)
  const [name, setName] = useState(agent.name)
  const [description, setDescription] = useState(agent.description ?? '')
  const nowPicture = pictureOf({ picture: agent.picture, colour: now.colour })
  const [colour, setColour] = useState<FaceColour>(now.colour)
  const [picture, setPicture] = useState(nowPicture)
  const [shape, setShape] = useState<FaceShape>(now.shape)
  const save = useMutation({
    // Only what moved is sent as a colour or a face, so Lens keeps the rest as it is.
    mutationFn: () =>
      agentBankApi.update(agent.id, {
        name: name.trim(),
        description: description.trim(),
        ...(picture && picture.id !== nowPicture?.id ? lookFor(picture) : colour !== now.colour ? { colour } : {}),
        ...(shape !== now.shape ? { face: shape } : {}),
      }),
    onSuccess: onClose,
    onSettled: () => qc.invalidateQueries({ queryKey: BOOK_KEY }),
  })
  const changed =
    name.trim() !== agent.name || description.trim() !== (agent.description ?? '') || colour !== now.colour || picture?.id !== nowPicture?.id || shape !== now.shape
  const look = { id: agent.id, name: name || agent.name, colour, face: shape }
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`${agent.name}’s name and look`}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!changed || name.trim() === '' || save.isPending}
            disabledReason={name.trim() === '' ? 'Name it first.' : !changed ? 'Change something first.' : undefined}
            onClick={() => save.mutate()}
          >
            Save
          </Button>
        </>
      }
    >
      <Field label="Name">
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <div className="grid gap-1.5">
        <label htmlFor={`what-${agent.id}`} className="text-body font-semibold text-ink-2">
          What it is for
        </label>
        <textarea
          id={`what-${agent.id}`}
          maxLength={500}
          rows={3}
          placeholder="What it is for"
          className={`w-full rounded-control bg-page px-3.5 py-2.5 text-reading text-ink shadow-edge placeholder:text-faint transition-colors duration-200 hover:border-rule-strong disabled:cursor-not-allowed disabled:opacity-50 ${pocketFocusRing}`}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <div className="grid gap-1.5">
        <span className="text-body font-semibold text-ink-2">Picture</span>
        <PictureGallery
          label="Picture"
          value={picture?.id ?? null}
          onChange={(p) => {
            if (!p) return
            setPicture(p)
            setColour(p.colour)
          }}
        />
      </div>
      <div className="grid gap-1.5" role="radiogroup" aria-label="Colour">
        <span className="text-body font-semibold text-ink-2">Colour</span>
        <div className="flex flex-wrap gap-2">
          {faceColours.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={colour === c}
              aria-label={c}
              onClick={() => {
                setColour(c)
                setPicture(AGENT_PICTURES.find((p) => p.id === c))
              }}
              className={`h-9 w-9 rounded-pill ${colour === c ? 'ring-2 ring-ink ring-offset-2 ring-offset-page' : ''} ${pocketFocusRing}`}
              style={{ background: `var(--agent-${c})` }}
            />
          ))}
        </div>
      </div>
      <div className="grid gap-1.5" role="radiogroup" aria-label="Face">
        <span className="text-body font-semibold text-ink-2">Face</span>
        <div className="flex flex-wrap gap-2">
          {faceShapes.map((f) => (
            <button
              key={f}
              type="button"
              role="radio"
              aria-checked={shape === f}
              aria-label={`A ${f} face`}
              onClick={() => setShape(f)}
              className={`grid h-12 w-12 place-items-center rounded-tile ${shape === f ? 'bg-cloud ring-2 ring-ink' : 'bg-page shadow-edge'} ${pocketFocusRing}`}
            >
              <Face agent={{ ...look, face: f }} size={36} />
            </button>
          ))}
        </div>
      </div>
      {save.isError ? (
        <p role="alert" className="text-caption text-ink">
          {refusalText(save.error)}
        </p>
      ) : null}
    </Dialog>
  )
}

/** B57.22 — archive asks first, and says what it does, before it does it. */
export function ArchiveDialog({
  agent,
  open,
  onClose,
  onArchived,
}: {
  agent: Agent
  open: boolean
  onClose: () => void
  onArchived: (done: AgentArchive) => void
}) {
  const qc = useQueryClient()
  const archive = useMutation({
    mutationFn: () => agentBankApi.archive(agent.id),
    onSuccess: (done) => {
      onArchived(done)
      onClose()
    },
    onSettled: () => Promise.all([qc.invalidateQueries({ queryKey: BOOK_KEY }), qc.invalidateQueries({ queryKey: statementKey(agent.id) })]),
  })
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Archive ${agent.name}?`}
      actions={
        <>
          <Button variant="secondary" disabled={archive.isPending} onClick={onClose}>
            Keep it
          </Button>
          <Button variant="danger" disabled={archive.isPending} onClick={() => archive.mutate()}>
            {archive.isPending ? 'Archiving…' : `Yes, archive ${agent.name}`}
          </Button>
        </>
      }
    >
      <p>
        Archiving {agent.name} stops its keys working and ends its schedules. Its statement is kept. It cannot be undone.
      </p>
      {archive.isError ? (
        <p role="alert" className="text-caption text-ink">
          {refusalText(archive.error)}
        </p>
      ) : null}
    </Dialog>
  )
}

function PromptSchedules({ agent }: { agent: Agent }) {
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: ['prompt-schedules'],
    queryFn: agentBankApi.promptSchedules,
  })
  const stop = useMutation({
    mutationFn: agentBankApi.stopPromptSchedule,
    onSettled: () => qc.invalidateQueries({ queryKey: ['prompt-schedules'] }),
  })
  const mine = (q.data?.schedules ?? []).filter((s) => s.agent_id === agent.id && s.active)
  if (q.isError) return <p>{agent.name}’s prompt schedules could not be read just now.</p>
  if (q.isPending) return <p>Reading…</p>
  if (mine.length === 0) return <p>None. In Chat, /schedule asks a prompt at a time you set, on {agent.name}’s wallet.</p>
  return (
    <div>
      {mine.map((s) => (
        <div key={s.id} className="flex items-center gap-3 border-t border-line py-2.5 first:border-t-0">
          <span className="min-w-0 flex-1">
            <span className="block font-semibold text-ink">{s.prompt}</span>
            <span className="block text-caption text-ink-3">
              {s.every === 'once' ? 'Once' : `Every ${s.every}`}
              {s.next_run_at ? (
                <>
                  {' '}
                  · next{' '}
                  <span className="font-figure">
                    {new Date(s.next_run_at).toLocaleString('en-GB', {
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </>
              ) : null}
            </span>
          </span>
          <Button variant="secondary" size="sm" disabled={stop.isPending} onClick={() => stop.mutate(s.id)}>
            Stop
          </Button>
        </div>
      ))}
    </div>
  )
}

function ownershipLine(agent: Agent): string {
  if (agent.owner_user_id === undefined) return `${agent.name}’s owner could not be read just now`
  if (agent.owner_user_id === '') return `Nobody owns ${agent.name} yet. Claim it under Money`
  if (agent.verified) return 'Its owner is verified: this workspace has paid by card, or Talyvor vouches for it'
  return 'Its owner is not verified yet: paying by card verifies this workspace'
}

/** B57.22 — the Settings section: one row for everything an agent's owner can set or do on its page. */
export function AgentSettings({ agent, forms, onArchived }: { agent: Agent; forms: SettingsForms; onArchived: (done: AgentArchive) => void }) {
  const [open, setOpen] = useState<Open>(null)
  const close = () => setOpen(null)
  const { colour, shape } = faceOf(agent)
  const n = agent.name
  const card = useQuery({
    queryKey: cardKey(agent.id),
    queryFn: () => agentBankApi.card(agent.id),
  })
  const schedules = useQuery({
    queryKey: SCHEDULES_KEY,
    queryFn: agentBankApi.schedules,
  })
  const prompts = useQuery({
    queryKey: ['prompt-schedules'],
    queryFn: agentBankApi.promptSchedules,
  })
  const rules = useQuery({
    queryKey: rulesKey(agent.id),
    queryFn: () => agentBankApi.rules(agent.id),
  })
  const paying = (schedules.data?.schedules ?? []).filter((s) => s.from_agent_id === agent.id && s.active).length
  const asking = (prompts.data?.schedules ?? []).filter((s) => s.agent_id === agent.id && s.active).length
  const unusual = rules.data?.pause_on_unusual_spend ?? false
  const cardCurrency = card.data?.card?.currency
  const panels: [Exclude<Open, null>, string, React.ReactNode][] = [
    ['key', 'Its key', forms.keyForm],
    ['card', 'Its card', forms.card],
    ['boost', 'Limit boost', forms.boost],
    ['schedules', 'Scheduled payments', forms.schedules],
    ['credential', 'Its credential', forms.credential],
  ]
  return (
    <>
      <Card tone="white" className="grid gap-2" data-testid="agent-settings" {...{ [DESIGN_ATTR]: 'pocket' }}>
        <h2 className="font-display text-reading font-bold text-ink">Settings</h2>
        <div>
          <SettingRow icon="settings" title="Name, description, colour and face" line={`${n}: ${colour}, a ${shape} face`} onOpen={() => setOpen('look')} />
          <SettingRow
            icon="key"
            title="Its key"
            line={`A proxy key that spends only ${n}’s balance, under its rules; shown once`}
            onOpen={() => setOpen('key')}
          />
          <SettingRow
            icon="card"
            title="Its card"
            line={
              cardCurrency
                ? `Issued in ${CARD_CURRENCY[cardCurrency] ?? cardCurrency.toUpperCase()}: each purchase is paid from its wallet only if its rules allow it`
                : `${n} has no card yet. Each purchase on one is paid from its wallet only if its rules allow it`
            }
            onOpen={() => setOpen('card')}
          />
          <SettingRow
            icon="arrow"
            title="Limit boost"
            line="Raise one of its limits for a while, signed like an approval; it goes back by itself"
            onOpen={() => setOpen('boost')}
          />
          <SettingRow
            icon="clock"
            title="Scheduled payments"
            line={paying === 0 ? `${n} pays nothing on a schedule` : `${n} makes ${paying} ${paying === 1 ? 'payment' : 'payments'} on a schedule`}
            onOpen={() => setOpen('schedules')}
          />
          <SettingRow
            icon="chat"
            title="Prompt schedules"
            line={`Prompts asked at a time you set, on ${n}’s wallet. ${asking === 0 ? 'None' : asking}`}
            onOpen={() => setOpen('prompts')}
          />
          <Link to={`/agents/${encodeURIComponent(agent.id)}/rules`} className={rowClass} data-testid="agent-setting-Unusual spend">
            <RowBody
              icon="pause"
              title="Unusual spend"
              line={
                unusual ? `On: ${n} is paused when Talyvor raises an unusual-spend alert` : `Off: ${n} is not paused when Talyvor raises an unusual-spend alert`
              }
            />
          </Link>
          <SettingRow
            icon="shield"
            title="Its credential"
            line={`Signed by Talyvor: who owns ${n}, how far they are verified, and what it may do with live money`}
            onOpen={() => setOpen('credential')}
          />
          <div className="flex w-full items-center gap-3 border-t border-line py-2.5 text-reading" data-testid="agent-setting-Ownership">
            <RowBody icon="agents" title="Ownership" line={ownershipLine(agent)} chevron={false} />
          </div>
          <SettingRow
            icon="download"
            title="Archive"
            line={`Moves what ${n} holds back to the workspace and stops its keys. It asks first`}
            onOpen={() => setOpen('archive')}
          />
        </div>
        {open === 'look' ? <LookDialog agent={agent} open onClose={close} /> : null}
        <Dialog open={open === 'prompts'} onClose={close} title="Prompt schedules">
          <PromptSchedules agent={agent} />
        </Dialog>
        <ArchiveDialog agent={agent} open={open === 'archive'} onClose={close} onArchived={onArchived} />
      </Card>
      {/* A form is drawn only while its dialog is open, so a key shown once is gone when it closes. */}
      {panels.map(([which, title, body]) => (
        <Dialog key={which} open={open === which} onClose={close} title={title} className="max-h-screen overflow-y-auto">
          {body}
        </Dialog>
      ))}
    </>
  )
}
