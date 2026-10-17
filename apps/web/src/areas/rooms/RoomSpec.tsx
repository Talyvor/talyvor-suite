import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Button, cn, focusRing, inlineLink } from '@talyvor/ui'
import { Region } from '../../components/Region'
import { DocsPagePicker } from '../chat/DocsPagePicker'
import { docsApi } from '../docs/api'
import { pageHref } from '../docs/docsNav'
import { formatWhen } from '../lens/format'
import { Card, Note, selectClass, useRunnableModels } from '../marketplace/parts'
import { type MessagePage, type RoomDetail, type RoomMessage, ROOMS_KEY, roomRefusal, roomsApi, upsertMessage } from './roomsApi'

// RoomSpec.tsx — B41.60: a Docs page as the room's living spec. The owner or an editor attaches a page (the Chat's
// Docs page picker, B28.375); its text is posted to the room as a spec message, so every member reads it and the
// room's AI — whose context is the room's latest messages (Lens B32.33) — reads it too. While the attaching
// workspace has the room open, the page is re-read from Docs, and an edit there is posted to the room as the spec's
// update before anyone asks the AI again.
//
// shortcut: the spec lives in the room's messages, so it counts only while it is among the latest ones the screen
// reads (100) and Lens's ask sends (LENS_ROOM_CONTEXT_MESSAGES); a spec field on Lens's room is the upgrade.

/** A room message's longest body, in characters (Lens rooms.MaxMessage). */
const MAX_MESSAGE = 8000
const CLIPPED = '\n\n… the rest of the page is in Docs.'
const HEAD = /^Room spec( updated)?: (.+)\n\/docs\/spaces\/([^/\s]+)\/pages\/([^/\s]+) · (\S+)\n\n([\s\S]*)$/

/** A Docs page as the spec reads it; Docs answers when it last saved the page. */
type Read = { title: string; content_text?: string; updated_at?: string }

/** A room's spec as one of its messages states it. */
export interface Spec {
  message: RoomMessage
  updated: boolean
  title: string
  spaceId: string
  pageId: string
  savedAt: string
  text: string
}

/** The spec message's body: what it is, the page it was read from and when Docs last saved it, then its text. */
export function specBody(title: string, spaceId: string, pageId: string, savedAt: string, text: string, updated: boolean): string {
  const head = `Room spec${updated ? ' updated' : ''}: ${title}\n${pageHref({ spaceId, pageId })} · ${savedAt}\n\n`
  const room = MAX_MESSAGE - Array.from(head).length
  const chars = Array.from(text.trim())
  return head + (chars.length <= room ? chars.join('') : chars.slice(0, room - CLIPPED.length).join('') + CLIPPED)
}

/** The spec a message states, when it is one. */
export function parseSpec(m: RoomMessage): Spec | null {
  if (m.kind !== 'text' || m.deleted_at) return null
  const x = HEAD.exec(m.body)
  if (!x) return null
  return {
    message: m,
    updated: x[1] !== undefined,
    title: x[2],
    spaceId: decodeURIComponent(x[3]),
    pageId: decodeURIComponent(x[4]),
    savedAt: x[5],
    text: x[6],
  }
}

/** The room's spec: the latest spec message posted by its owner or an editor — another member's does not count. */
export function currentSpec(messages: RoomMessage[], room: RoomDetail): Spec | null {
  const sets = new Set((room.members ?? []).filter((m) => m.role === 'owner' || m.role === 'editor').map((m) => m.workspace_id))
  sets.add(room.owner_workspace_id)
  for (let i = messages.length - 1; i >= 0; i--) {
    const s = sets.has(messages[i].author_workspace_id) ? parseSpec(messages[i]) : null
    if (s) return s
  }
  return null
}

/** A spec message in the conversation: what it is, and its text one click away. */
export function SpecMessage({ spec }: { spec: Spec }) {
  return (
    <span className="flex flex-col gap-1" data-testid="spec-message">
      <span className="text-body text-ink">
        {spec.updated ? 'Updated the room’s spec' : 'Attached the room’s spec'}: <span className="text-head">{spec.title}</span>
      </span>
      <details>
        <summary className={cn('cursor-pointer text-caption text-muted', focusRing)}>The page’s text</summary>
        <span className="mt-1 block whitespace-pre-wrap break-words text-body text-ink">{spec.text}</span>
      </details>
    </span>
  )
}

/** The room's spec and asking the room's AI, which reads it. */
export function RoomSpec({ room, me, messagesKey }: { room: RoomDetail; me: string; messagesKey: readonly unknown[] }) {
  const qc = useQueryClient()
  const id = room.id
  const messages = useQuery({ queryKey: messagesKey, queryFn: () => roomsApi.messages(id) }).data?.messages ?? []
  const spec = currentSpec(messages, room)
  const edits = room.me?.role === 'owner' || room.me?.role === 'editor'
  const upsert = (m: RoomMessage) =>
    qc.setQueryData<MessagePage>(messagesKey, (p) => (p ? { ...p, messages: upsertMessage(p.messages ?? [], m) } : p))

  const [empty, setEmpty] = useState<string | null>(null)
  const post = useMutation({
    mutationFn: async (v: { spaceId: string; pageId: string; title: string; updated: boolean; read?: Read }) => {
      const p: Read = v.read ?? (await docsApi.page(v.spaceId, v.pageId))
      const text = p.content_text ?? ''
      setEmpty(text.trim() === '' ? `${v.title} has no text to attach yet.` : null)
      if (text.trim() === '') return null
      return roomsApi.post(id, specBody(p.title.trim() || v.title, v.spaceId, v.pageId, p.updated_at || new Date().toISOString(), text, v.updated))
    },
    onSuccess: (m) => m && upsert(m),
  })

  // The page as Docs holds it now, read by the workspace that attached it — the only one whose Docs has it.
  const mine = spec !== null && edits && spec.message.author_workspace_id === me
  const live = useQuery({
    queryKey: ['docs', 'page', spec?.spaceId, spec?.pageId],
    queryFn: () => docsApi.page(spec!.spaceId, spec!.pageId),
    enabled: mine,
    refetchInterval: 30_000,
  })
  // Whether Docs' page now says something the room's spec does not: its title or its text (when Docs saved it is not).
  const changed = (p: Read | undefined): p is Read =>
    mine && p !== undefined && (p.content_text ?? '').trim() !== '' &&
    specBody(p.title.trim() || spec.title, spec.spaceId, spec.pageId, spec.savedAt, p.content_text ?? '', spec.updated) !== spec.message.body
  const update = (p: Read) => post.mutateAsync({ spaceId: spec!.spaceId, pageId: spec!.pageId, title: spec!.title, updated: true, read: p })
  const stale = changed(live.data)

  const { runnable } = useRunnableModels()
  const mayRoom = room.wallet?.may_spend ?? false
  const [question, setQuestion] = useState('')
  const [model, setModel] = useState('')
  const [pay, setPay] = useState<'room' | 'self'>(mayRoom ? 'room' : 'self')
  const chosen = model || runnable[0]?.id || ''
  const ask = useMutation({
    // The page is read again first: an edit not yet in the room goes to it before the question does.
    mutationFn: async () => {
      if (mine) {
        const now = (await live.refetch()).data
        if (changed(now)) await update(now)
      }
      return roomsApi.ask(id, { question: question.trim(), model: chosen, pay })
    },
    onSuccess: (res) => {
      if (res.message) upsert(res.message)
      if (res.pay === 'room') void qc.invalidateQueries({ queryKey: [...ROOMS_KEY, 'room', id] })
      setQuestion('')
    },
  })
  // An edit made in Docs goes to the room as the spec's update, once — an ask posts its own first.
  useEffect(() => {
    if (stale && !post.isPending && !post.isError && !ask.isPending) void update(live.data!).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one update per edit read
  }, [stale, live.dataUpdatedAt])
  const viewer = room.me?.role === 'viewer'

  return (
    <Region index="04" label="Spec" className="flex flex-col gap-3">
      <p className="text-body text-muted">
        A Docs page the room builds to. Everyone in the room reads it, and so does the room’s AI; an edit made in Docs
        shows here and in the conversation.
      </p>
      <Card>
        <div className="flex flex-col gap-3 p-gutter" data-testid="room-spec">
          {spec ? (
            <>
              <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-head text-ink">{spec.title}</span>
                <span className="text-caption text-muted">
                  saved in Docs <span className="font-figure">{formatWhen(spec.savedAt)}</span>
                </span>
                {mine ? (
                  <Link className={`text-caption text-ink ${inlineLink}`} to={pageHref(spec)}>
                    Edit in Docs
                  </Link>
                ) : null}
              </span>
              <span className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words text-body text-ink">{spec.text}</span>
            </>
          ) : (
            <span className="text-body text-muted">
              {edits ? 'No spec yet. Attach a Docs page the room should build to.' : 'No spec yet. The owner or an editor can attach one.'}
            </span>
          )}
          {edits ? (
            <div className="relative flex items-center gap-2">
              <DocsPagePicker
                disabled={post.isPending}
                onPick={(spaceId, pageId, title) => post.mutate({ spaceId, pageId, title, updated: false })}
              />
              <span className="text-caption text-muted">
                {post.isPending ? 'Reading the page…' : spec ? 'Attach a different page' : 'Attach a Docs page'}
              </span>
            </div>
          ) : null}
          {empty !== null ? <Note ok={false}>{empty}</Note> : post.isError ? <Note ok={false}>{roomRefusal(post.error)}</Note> : null}
        </div>
      </Card>
      <Card>
        <form
          className="flex flex-col gap-3 p-gutter"
          onSubmit={(e) => {
            e.preventDefault()
            if (question.trim() !== '' && chosen !== '' && !ask.isPending && !post.isPending) ask.mutate()
          }}
        >
          <label className="flex flex-col gap-1 text-caption text-muted">
            Ask the room’s AI
            <textarea
              className={`min-h-16 w-full rounded-control border border-rule bg-surface p-3 text-body text-ink placeholder:text-faint transition-colors duration-200 hover:border-rule-strong disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`}
              value={question}
              disabled={viewer}
              placeholder="It reads the room’s latest messages and the spec"
              onChange={(e) => setQuestion(e.target.value)}
            />
          </label>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-caption text-muted">
              Model
              <select className={selectClass} value={chosen} onChange={(e) => setModel(e.target.value)}>
                {runnable.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.display_name || m.id}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-caption text-muted">
              Who pays
              <select className={selectClass} value={pay} onChange={(e) => setPay(e.target.value as 'room' | 'self')}>
                <option value="room" disabled={!mayRoom}>
                  The room
                </option>
                <option value="self">Me</option>
              </select>
            </label>
            <Button type="submit" disabled={viewer || question.trim() === '' || chosen === '' || ask.isPending || post.isPending}>
              {ask.isPending ? 'Asking…' : 'Ask'}
            </Button>
          </div>
          {ask.isError ? <Note ok={false}>{roomRefusal(ask.error)}</Note> : null}
          {ask.data?.answer ? (
            <span className="whitespace-pre-wrap break-words border-t border-rule pt-3 text-body text-ink" data-testid="room-ai-answer">
              {ask.data.answer}
            </span>
          ) : null}
        </form>
      </Card>
    </Region>
  )
}
