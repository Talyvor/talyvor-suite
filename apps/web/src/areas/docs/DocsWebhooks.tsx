import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { cn, formatDay } from '@talyvor/ui'
import { Button, Card, CodeBox, Crumb, Field, Input, pocketFocusRing } from '@talyvor/ui/pocket'
import { useState } from 'react'

import { ApiError, getJSONArray } from '../../lib/api'
import { isSessionExpired, isUnconfigured } from '../../lib/productState'

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
  return `Docs didn’t ${what}. Nothing changed. You can try again.`
}

function Secret({ secret, onDone }: { secret: string; onDone: () => void }) {
  return (
    <Card tone="white" className="grid gap-2" role="status">
      <p className="text-body font-semibold text-ink">Copy this signing secret now. Docs will not show it again.</p>
      <CodeBox code={secret} copied="Copied. Store it now: it will not be shown again" />
      <div>
        <Button variant="secondary" size="sm" onClick={onDone}>
          I’ve saved it
        </Button>
      </div>
    </Card>
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
      aria-label="Add a webhook"
      className="mt-2 flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        if (url.trim() && !add.isPending) add.mutate()
      }}
    >
      <Field label="URL">
        <Input
          aria-label="Webhook URL"
          className="font-mono"
          type="url"
          placeholder="https://"
          value={url}
          autoComplete="off"
          onChange={(e) => setUrl(e.target.value)}
        />
      </Field>
      <fieldset className="grid gap-1.5">
        <legend className="mb-1.5 text-body font-semibold text-ink-2">Events, none chosen sends all three</legend>
        <div className="flex flex-wrap gap-1.5">
          {EVENTS.map((ev) => {
            const on = events.includes(ev)
            return (
              <button
                key={ev}
                type="button"
                aria-pressed={on}
                onClick={() => setEvents(on ? events.filter((x) => x !== ev) : [...events, ev])}
                className={cn(
                  'inline-flex h-8.5 items-center rounded-pill px-3.5 font-mono text-body transition-colors duration-200',
                  on ? 'bg-ink text-on-primary' : 'bg-cloud-2 text-ink-2',
                  pocketFocusRing,
                )}
              >
                {ev}
              </button>
            )
          })}
        </div>
      </fieldset>
      <div>
        <Button type="submit" disabled={!url.trim() || add.isPending}>
          {add.isPending ? 'Adding…' : 'Add webhook'}
        </Button>
      </div>
      {add.isError ? (
        <p className="text-body text-ink" role="alert">
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
    <li className="flex flex-wrap items-start justify-between gap-3 border-t border-line py-2.5 first:border-t-0">
      <div className="min-w-0">
        <p className="break-all font-mono text-body font-semibold text-ink">{hook.url}</p>
        <p className="text-body text-ink-3">
          {hook.events?.length ? hook.events.join(' · ') : 'All events'} · added{' '}
          <span className="font-figure">{formatDay(hook.created_at)}</span>
        </p>
        {failed ? (
          <p className="text-body text-ink" role="alert">
            {failed}
          </p>
        ) : null}
      </div>
      <div className="flex gap-2">
        <Button
          variant="secondary"
          size="sm"
          aria-label={`Rotate secret for ${hook.url}`}
          disabled={rotate.isPending}
          onClick={() => rotate.mutate()}
        >
          {rotate.isPending ? 'Rotating…' : 'Rotate secret'}
        </Button>
        <Button aria-label={`Delete ${hook.url}`} variant="danger" size="sm" disabled={remove.isPending} onClick={() => remove.mutate()}>
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

  // B57.42 — Pocket's w-docs-webhooks: the crumb and the line, the webhooks in a white card, adding one beside it.
  return (
    <div className="grid min-w-0 gap-5">
      <Crumb trail={[{ label: 'Settings', href: '/settings' }, { label: 'Webhooks' }]} />
      <p className="max-w-3xl text-reading text-ink-2">
        Docs tells your server when an approval is requested or decided, or a comment is added, with a signed POST that carries ids only,
        never page text.
      </p>
      {secret ? <Secret secret={secret} onDone={() => setSecret('')} /> : null}
      {notOwner ? (
        <p className="max-w-2xl text-body text-ink-2">{OWNER_ONLY}</p>
      ) : hooks.isError ? (
        <p className="max-w-2xl text-body text-ink-2">
          {isUnconfigured(hooks.error) || isSessionExpired(hooks.error)
            ? 'Docs is not reachable from this session, so there are no webhooks to show.'
            : 'Couldn’t read your webhooks from Docs. This is a fault, not an empty list.'}
        </p>
      ) : hooks.isPending ? (
        <p className="text-body text-ink-2">Reading webhooks from Docs…</p>
      ) : (
        <div className="grid items-start gap-4 wide:grid-cols-12">
          <Card tone="white" className="wide:col-span-8">
            <h2 className="font-display text-reading font-bold text-ink">Docs webhooks</h2>
            {(hooks.data ?? []).length === 0 ? (
              <p className="mt-1 text-body text-ink-2">No webhooks yet. Add your server’s https URL beside this.</p>
            ) : (
              <ul className="mt-2">
                {(hooks.data ?? []).map((h) => (
                  <WebhookRow key={h.id} hook={h} onSecret={setSecret} />
                ))}
              </ul>
            )}
          </Card>
          <Card className="wide:col-span-4">
            <h2 className="font-display text-reading font-bold text-ink">Add a webhook</h2>
            <AddWebhook onSecret={setSecret} />
          </Card>
        </div>
      )}
    </div>
  )
}
