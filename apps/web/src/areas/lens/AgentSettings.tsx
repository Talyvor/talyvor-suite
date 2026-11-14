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
  Money,
  faceColours,
  faceOf,
  faceShapes,
  pocketFocusRing,
} from '@talyvor/ui/pocket'
import type { FaceColour, FaceShape } from '@talyvor/ui/pocket'
import { BOOK_KEY, SCHEDULES_KEY, rulesKey, statementKey } from './AgentBank'
import { cardKey } from './AgentCardPanel'
import { DESIGN_ATTR } from '../../pocketPending'
import { type Agent, type AgentArchive, agentBankApi, refusalText } from './agentBankApi'

// AgentSettings.tsx — B57.22: the Settings section of an agent's page, as Pocket's w-agent-research draws it. One row
// for each thing the agent's owner can set or do; a row opens it over the page. Name and look and Archive are drawn
// here; the rest are today's own forms, given to this section by the agent view, so each posts what it posted before.

/** What a row opens: today's form for it, given by the agent view. */
export interface SettingsForms {
  keyForm: React.ReactNode
  card: React.ReactNode
  topUp: React.ReactNode
  boost: React.ReactNode
  pay: React.ReactNode
  schedules: React.ReactNode
  credential: React.ReactNode
}

type Open = 'look' | 'key' | 'card' | 'topup' | 'boost' | 'pay' | 'schedules' | 'prompts' | 'credential' | 'archive' | null

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

function SettingRow({ icon, title, line, onOpen, expanded }: { icon: IconName; title: string; line: React.ReactNode; onOpen: () => void; expanded?: boolean }) {
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
        aria-expanded={expanded}
        aria-label={title}
        aria-describedby={lineId}
      />
    </div>
  )
}

/** B57.22 — the agent's name, what it is for, and the colour and face it wears everywhere it is drawn. */
export function LookDialog({ agent, open, onClose }: { agent: Agent; open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const now = faceOf(agent)
  const [name, setName] = useState(agent.name)
  const [description, setDescription] = useState(agent.description ?? '')
  const [colour, setColour] = useState<FaceColour>(now.colour)
  const [shape, setShape] = useState<FaceShape>(now.shape)
  const save = useMutation({
    // Only what moved is sent as a colour or a face, so Lens keeps the rest as it is.
    mutationFn: () =>
      agentBankApi.update(agent.id, {
        name: name.trim(),
        description: description.trim(),
        ...(colour !== now.colour ? { colour } : {}),
        ...(shape !== now.shape ? { face: shape } : {}),
      }),
    onSuccess: onClose,
    onSettled: () => qc.invalidateQueries({ queryKey: BOOK_KEY }),
  })
  const changed = name.trim() !== agent.name || description.trim() !== (agent.description ?? '') || colour !== now.colour || shape !== now.shape
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
              onClick={() => setColour(c)}
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
        Archiving {agent.name} moves the <Money ulxc={agent.balance_ulxc} /> it holds back to the workspace, stops its keys working, and ends its top-up and
        schedules. Its statement is kept. It cannot be undone.
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
  if (agent.verified) return 'Its owner is verified: this workspace has bought LXC with a card, or Talyvor vouches for it'
  return 'Its owner is not verified yet: buying LXC with a card verifies this workspace'
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
  const topUp = useQuery({
    queryKey: ['agent-topup', agent.id],
    queryFn: () => agentBankApi.topUp(agent.id),
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
  // Today's forms open under the section, as they are drawn today, until each is redrawn in Pocket; pressing the
  // row again folds it away. Name and look, prompt schedules and Archive open over the page.
  const inline: Partial<Record<Exclude<Open, null>, React.ReactNode>> = {
    key: forms.keyForm,
    card: forms.card,
    topup: forms.topUp,
    boost: forms.boost,
    pay: forms.pay,
    schedules: forms.schedules,
    credential: forms.credential,
  }
  const toggle = (which: Exclude<Open, null>) => () => setOpen((o) => (o === which ? null : which))
  const shown = open ? inline[open] : undefined
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
            onOpen={toggle('key')}
            expanded={open === 'key'}
          />
          <SettingRow
            icon="card"
            title="Its card"
            line={
              cardCurrency
                ? `Issued in ${CARD_CURRENCY[cardCurrency] ?? cardCurrency.toUpperCase()}: each purchase is paid from its wallet only if its rules allow it`
                : `${n} has no card yet. Each purchase on one is paid from its wallet only if its rules allow it`
            }
            onOpen={toggle('card')}
            expanded={open === 'card'}
          />
          <SettingRow
            icon="coin"
            title="Automatic top-up"
            line={
              topUp.data ? (
                <>
                  Below <Money ulxc={topUp.data.below_ulxc} />, topped back up to <Money ulxc={topUp.data.to_ulxc} />
                </>
              ) : (
                `${n} is not topped up automatically`
              )
            }
            onOpen={toggle('topup')}
            expanded={open === 'topup'}
          />
          <SettingRow
            icon="arrow"
            title="Limit boost"
            line="Raise one of its limits for a while, signed like an approval; it goes back by itself"
            onOpen={toggle('boost')}
            expanded={open === 'boost'}
          />
          <SettingRow
            icon="agents"
            title="Pay another agent"
            line={`Judged by ${n}’s rules. It stays inside this workspace`}
            onOpen={toggle('pay')}
            expanded={open === 'pay'}
          />
          <SettingRow
            icon="clock"
            title="Scheduled payments"
            line={paying === 0 ? `${n} pays nothing on a schedule` : `${n} makes ${paying} ${paying === 1 ? 'payment' : 'payments'} on a schedule`}
            onOpen={toggle('schedules')}
            expanded={open === 'schedules'}
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
            onOpen={toggle('credential')}
            expanded={open === 'credential'}
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
      {shown !== undefined ? <div data-testid={`agent-setting-open-${open}`}>{shown}</div> : null}
    </>
  )
}
