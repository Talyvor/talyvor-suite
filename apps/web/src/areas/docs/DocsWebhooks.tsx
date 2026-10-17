import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Input, focusRing, formatDay } from '@talyvor/ui'
import { useState } from 'react'

import { Region, RegionScreen } from '../../components/Region'
import { ApiError, getJSONArray } from '../../lib/api'
import { isSessionExpired, isUnconfigured } from '../../lib/productState'
import { CopyButton } from '../chat/CopyButton'

// B39.25 — Settings → Webhooks: a Docs workspace's owner adds an https URL, picks its events, sees the
// signing secret once, rotates it and deletes the webhook. Docs decides everything (B39.14): owner only,
// a public https address, and the secret only in the create and rotate answers, never on the list.

interface DocsWebhook {
  id: string
  url: string
  events: string[] | null
  created_at: string
}

const KEY = ['docs-webhooks']
const EVENTS = ['approval.requested', 'approval.decided', 'comment.created'] as const
const OWNER_ONLY = 'Only this workspace’s owner can manage its Docs webhooks. Ask them to add one for you.'

async function answer<T>(res: Response, path: string): Promise<T | null> {
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as { code?: string } | null
    throw new ApiError(res.status, path, err?.code)
  }
  return res.status === 204 ? null : ((await res.json()) as T)
}

async function addWebhook(url: string, events: string[]) {
  const path = '/api/docs/webhooks'
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ url, events }),
  })
  return answer<{ secret: string }>(res, path)
}

/** Rotate (POST …/rotate) and delete carry no body. */
async function act<T>(path: string, method: 'POST' | 'DELETE') {
  return answer<T>(await fetch(path, { method, headers: { Accept: 'application/json' } }), path)
}

function refusal(err: unknown, what: string): string {
  if (err instanceof ApiError && err.status === 403) return OWNER_ONLY
  if (err instanceof ApiError && err.code === 'BAD_URL') return 'The URL must start with https://.'
  if (err instanceof ApiError && (err.code === 'BLOCKED_ADDRESS' || err.code === 'BAD_HOST'))
    return 'Docs only sends to a public address it can reach. Use your server’s public https URL.'
  return `Docs didn’t ${what}. Nothing changed — you can try again.`
}

function Secret({ secret, onDone }: { secret: string; onDone: () => void }) {
  return (
    <div className="flex flex-col gap-2 rounded-control border border-rule-strong p-3" role="status">
      <p className="text-body text-ink">Copy this signing secret now. Docs will not show it again.</p>
      <div className="flex flex-wrap items-center gap-2">
        <code className="min-w-0 break-all font-mono text-caption text-ink">{secret}</code>
        <CopyButton text={secret} label="Copy" />
      </div>
      <div>
        <Button onClick={onDone}>I’ve saved it</Button>
      </div>
    </div>
  )
}

function AddWebhook({ onSecret }: { onSecret: (s: string) => void }) {
  const qc = useQueryClient()
  const [url, setUrl] = useState('')
  const [events, setEvents] = useState<string[]>([])
  const add = useMutation({
    mutationFn: () => addWebhook(url.trim(), events),
    onSuccess: async (hook) => {
      setUrl('')
      setEvents([])
      if (hook?.secret) onSecret(hook.secret)
      await qc.invalidateQueries({ queryKey: KEY })
    },
  })
  return (
    <form
      className="flex max-w-2xl flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        if (url.trim() && !add.isPending) add.mutate()
      }}
    >
      <label className="flex flex-col gap-1">
        <span className="text-caption text-muted">URL</span>
        <Input
          aria-label="Webhook URL"
          className="font-mono"
          type="url"
          placeholder="https://"
          value={url}
          autoComplete="off"
          onChange={(e) => setUrl(e.target.value)}
        />
      </label>
      <fieldset className="flex flex-col gap-1">
        <legend className="text-caption text-muted">Events — none chosen sends all three</legend>
        {EVENTS.map((ev) => (
          <label key={ev} className="flex items-center gap-2 text-body text-ink">
            <input
              type="checkbox"
              checked={events.includes(ev)}
              onChange={(e) => setEvents(e.target.checked ? [...events, ev] : events.filter((x) => x !== ev))}
              className={`transition-colors duration-200 hover:border-rule-strong disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`}
            />
            <span className="font-mono text-caption">{ev}</span>
          </label>
        ))}
      </fieldset>
      <div>
        <Button type="submit" variant="primary" disabled={!url.trim() || add.isPending}>
          {add.isPending ? 'Adding…' : 'Add webhook'}
        </Button>
      </div>
      {add.isError ? (
        <p className="text-caption text-ink" role="alert">
          {refusal(add.error, 'add it')}
        </p>
      ) : null}
    </form>
  )
}

function WebhookRow({ hook, onSecret }: { hook: DocsWebhook; onSecret: (s: string) => void }) {
  const qc = useQueryClient()
  const path = `/api/docs/webhooks/${encodeURIComponent(hook.id)}`
  const rotate = useMutation({
    mutationFn: () => act<{ secret: string }>(`${path}/rotate`, 'POST'),
    onSuccess: (r) => r?.secret && onSecret(r.secret),
  })
  const remove = useMutation({
    mutationFn: () => act(path, 'DELETE'),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
  const failed = rotate.isError ? refusal(rotate.error, 'rotate the secret') : remove.isError ? refusal(remove.error, 'delete it') : ''
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="break-all font-mono text-body text-ink">{hook.url}</p>
        <p className="text-caption text-muted">
          {hook.events?.length ? hook.events.join(' · ') : 'All events'} · added{' '}
          <span className="font-figure">{formatDay(hook.created_at)}</span>
        </p>
        {failed ? (
          <p className="text-caption text-ink" role="alert">
            {failed}
          </p>
        ) : null}
      </div>
      <div className="flex gap-2">
        <Button aria-label={`Rotate secret for ${hook.url}`} disabled={rotate.isPending} onClick={() => rotate.mutate()}>
          {rotate.isPending ? 'Rotating…' : 'Rotate secret'}
        </Button>
        <Button
          aria-label={`Delete ${hook.url}`}
          variant="danger"
          disabled={remove.isPending}
          onClick={() => remove.mutate()}
        >
          {remove.isPending ? 'Deleting…' : 'Delete'}
        </Button>
      </div>
    </li>
  )
}

export function DocsWebhooks() {
  const [secret, setSecret] = useState('')
  const hooks = useQuery({ queryKey: KEY, queryFn: () => getJSONArray<DocsWebhook>('/api/docs/webhooks') })
  const notOwner = hooks.error instanceof ApiError && hooks.error.status === 403

  return (
    <RegionScreen>
      <Region index="00" label="Webhooks" heading="Webhooks" sectionClassName="pb-10 pt-4 wide:pb-12">
        <p className="max-w-2xl text-body text-muted">
          Docs tells your server when an approval is requested or decided, or a comment is added, with a signed
          POST that carries ids only, never page text.
        </p>
      </Region>

      <Region index="01" label="Docs webhooks">
        {secret ? <Secret secret={secret} onDone={() => setSecret('')} /> : null}
        {notOwner ? (
          <p className="max-w-2xl text-body text-muted">{OWNER_ONLY}</p>
        ) : hooks.isError ? (
          <p className="max-w-2xl text-body text-muted">
            {isUnconfigured(hooks.error) || isSessionExpired(hooks.error)
              ? 'Docs is not reachable from this session, so there are no webhooks to show.'
              : 'Couldn’t read your webhooks from Docs. This is a fault, not an empty list.'}
          </p>
        ) : hooks.isPending ? (
          <p className="text-body text-muted">Reading webhooks from Docs…</p>
        ) : (
          <div className="mt-4 flex flex-col gap-6">
            {(hooks.data ?? []).length === 0 ? (
              <p className="max-w-2xl text-body text-muted">No webhooks yet. Add your server’s https URL below.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-rule border-y border-rule">
                {(hooks.data ?? []).map((h) => (
                  <WebhookRow key={h.id} hook={h} onSecret={setSecret} />
                ))}
              </ul>
            )}
            <AddWebhook onSecret={setSecret} />
          </div>
        )}
      </Region>
    </RegionScreen>
  )
}
