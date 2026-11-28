import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { cn, formatDay } from '@talyvor/ui'
import { Button, Card, Chip, CodeBox, Crumb, Field, Input, pocketFocusRing, type ChipTone } from '@talyvor/ui/pocket'
import { useState } from 'react'

import { ApiError } from '../../lib/api'
import { isSessionExpired } from '../../lib/productState'
import { type WalletWebhook, type WalletWebhookEvent, agentBankApi, refusalText } from './agentBankApi'
import { formatWhen } from './format'

// B28.74 — Settings › Wallet webhooks: the owner adds an https URL, picks which wallet events it takes, sees the signing
// secret once, rotates it and deletes the endpoint, and reads each event sent to it. Lens decides everything (B28.344):
// owner or admin only, a public https address, the Standard Webhooks signature, and retrying until the server answers 2xx.

const HOOKS_KEY = ['wallet-webhooks']
const EVENTS_KEY = ['wallet-webhook-events']
const OWNER_ONLY = 'Only this account’s owner or an admin can manage its wallet webhooks.'

/** Each event type in words; the type itself is what the server reads, so it is shown beside them. */
export const EVENT_WORDS: Record<string, string> = {
  'transfer.created': 'A transfer',
  'approval.requested': 'An approval is asked for',
  'approval.decided': 'An approval is decided',
  'alert.limit': 'A limit alert',
  'alert.unusual_spend': 'Unusual spending',
  'balance.low': 'A low balance',
}

const STATUS: Record<WalletWebhookEvent['status'], [ChipTone, string]> = {
  queued: ['wait', 'Queued'],
  delivered: ['good', 'Delivered'],
  failed: ['bad', 'Failed'],
}

function refusal(err: unknown): string {
  if (err instanceof ApiError && err.status === 403) return OWNER_ONLY
  return refusalText(err)
}

function Secret({ secret, onDone }: { secret: string; onDone: () => void }) {
  return (
    <Card tone="white" className="grid gap-2" role="status">
      <p className="text-body font-semibold text-ink">Copy this signing secret now. Talyvor will not show it again.</p>
      <CodeBox code={secret} copied="Copied. Store it now: it will not be shown again" />
      <div>
        <Button variant="secondary" size="sm" onClick={onDone}>
          I’ve saved it
        </Button>
      </div>
    </Card>
  )
}

function AddWebhook({ types, onSecret }: { types: string[]; onSecret: (s: string) => void }) {
  const qc = useQueryClient()
  const [url, setUrl] = useState('')
  const [events, setEvents] = useState<string[]>([])
  const add = useMutation({
    mutationFn: () => agentBankApi.addWalletWebhook(url.trim(), events),
    onSuccess: async (hook) => {
      setUrl('')
      setEvents([])
      if (hook.secret) onSecret(hook.secret)
      await qc.invalidateQueries({ queryKey: HOOKS_KEY })
    },
  })
  return (
    <form
      aria-label="Add a wallet webhook"
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
        <legend className="mb-1.5 text-body font-semibold text-ink-2">Events, none chosen sends every one</legend>
        <div className="flex flex-wrap gap-1.5">
          {types.map((ev) => {
            const on = events.includes(ev)
            return (
              <button
                key={ev}
                type="button"
                aria-pressed={on}
                title={EVENT_WORDS[ev]}
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
          {refusal(add.error)}
        </p>
      ) : null}
    </form>
  )
}

function WebhookRow({ hook, onSecret }: { hook: WalletWebhook; onSecret: (s: string) => void }) {
  const qc = useQueryClient()
  const rotate = useMutation({
    mutationFn: () => agentBankApi.rotateWalletWebhook(hook.id),
    onSuccess: async (r) => {
      if (r.secret) onSecret(r.secret)
      await qc.invalidateQueries({ queryKey: HOOKS_KEY })
    },
  })
  const remove = useMutation({
    mutationFn: () => agentBankApi.removeWalletWebhook(hook.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: HOOKS_KEY }),
  })
  const failed = rotate.isError ? refusal(rotate.error) : remove.isError ? refusal(remove.error) : ''
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 border-t border-line py-2.5 first:border-t-0">
      <div className="min-w-0">
        <p className="break-all font-mono text-body font-semibold text-ink">{hook.url}</p>
        <p className="text-body text-ink-3">
          {hook.events?.length ? hook.events.join(' · ') : 'Every event'} · added{' '}
          <span className="font-figure">{formatDay(hook.created_at)}</span>
          {hook.rotated_at ? (
            <>
              {' '}
              · secret rotated <span className="font-figure">{formatDay(hook.rotated_at)}</span>
            </>
          ) : null}
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

function EventRow({ event, url }: { event: WalletWebhookEvent; url: string }) {
  const [tone, words] = STATUS[event.status] ?? ['plain', event.status]
  return (
    <li className="grid gap-0.5 border-t border-line py-2.5 first:border-t-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-body font-semibold text-ink">
          {EVENT_WORDS[event.type] ?? event.type} <span className="font-mono font-normal text-ink-3">{event.type}</span>
        </p>
        <Chip tone={tone}>{words}</Chip>
      </div>
      <p className="break-all text-body text-ink-3">
        <span className="font-figure">{formatWhen(event.occurred_at)}</span> · <span className="font-mono">{event.ref}</span> · to{' '}
        <span className="font-mono">{url}</span>
      </p>
      <p className="text-body text-ink-3">
        <span className="font-figure">{event.attempts}</span> {event.attempts === 1 ? 'attempt' : 'attempts'}
        {event.status === 'delivered' && event.delivered_at ? (
          <>
            {' '}
            · delivered <span className="font-figure">{formatWhen(event.delivered_at)}</span>
          </>
        ) : null}
        {event.status === 'queued' && event.next_attempt_at ? (
          <>
            {' '}
            · next try <span className="font-figure">{formatWhen(event.next_attempt_at)}</span>
          </>
        ) : null}
      </p>
      {event.last_error && event.status !== 'delivered' ? <p className="break-all text-body text-ink-2">Last answer: {event.last_error}</p> : null}
    </li>
  )
}

function Events({ hooks }: { hooks: WalletWebhook[] }) {
  const events = useQuery({ queryKey: EVENTS_KEY, queryFn: agentBankApi.walletWebhookEvents, refetchInterval: 30_000 })
  const urls = new Map(hooks.map((h) => [h.id, h.url]))
  const list = events.data?.events ?? []
  return (
    <Card tone="white">
      <h2 className="font-display text-reading font-bold text-ink">Events sent</h2>
      {events.isError ? (
        <p className="mt-1 text-body text-ink-2">
          {isSessionExpired(events.error) ? 'The events can’t be read until you sign in again.' : 'The events could not be read just now.'}
        </p>
      ) : events.isPending ? (
        <p className="mt-1 text-body text-ink-2">Reading events…</p>
      ) : list.length === 0 ? (
        <p className="mt-1 text-body text-ink-2">No events yet. Add a webhook beside this, and each wallet event after that is listed here.</p>
      ) : (
        <ul className="mt-2">
          {list.map((ev) => (
            <EventRow key={ev.id} event={ev} url={urls.get(ev.webhook_id) ?? 'a deleted webhook'} />
          ))}
        </ul>
      )}
    </Card>
  )
}

export function WalletWebhooks() {
  const [secret, setSecret] = useState('')
  const hooks = useQuery({ queryKey: HOOKS_KEY, queryFn: agentBankApi.walletWebhooks })
  const notOwner = hooks.error instanceof ApiError && hooks.error.status === 403
  const list = hooks.data?.webhooks ?? []
  const types = hooks.data?.event_types?.length ? hooks.data.event_types : Object.keys(EVENT_WORDS)

  return (
    <div data-design="pocket" className="grid min-w-0 gap-5">
      <Crumb trail={[{ label: 'Settings', href: '/settings' }, { label: 'Wallet webhooks' }]} />
      <p className="max-w-3xl text-reading text-ink-2">
        Talyvor tells your server about every transfer, approval asked for or decided, limit or unusual-spending alert and low balance
        with a signed POST, and tries again until your server answers.
      </p>
      {secret ? <Secret secret={secret} onDone={() => setSecret('')} /> : null}
      {notOwner ? (
        <p className="max-w-2xl text-body text-ink-2">{OWNER_ONLY}</p>
      ) : hooks.isError ? (
        <p className="max-w-2xl text-body text-ink-2">
          {isSessionExpired(hooks.error) ? 'Your webhooks can’t be read until you sign in again.' : 'Your webhooks could not be read just now.'}
        </p>
      ) : hooks.isPending ? (
        <p className="text-body text-ink-2">Reading your webhooks…</p>
      ) : (
        <div className="grid items-start gap-4 wide:grid-cols-12">
          <div className="grid gap-4 wide:col-span-8">
            <Card tone="white">
              <h2 className="font-display text-reading font-bold text-ink">Your webhooks</h2>
              {list.length === 0 ? (
                <p className="mt-1 text-body text-ink-2">No webhooks yet. Add your server’s https URL beside this.</p>
              ) : (
                <ul className="mt-2">
                  {list.map((h) => (
                    <WebhookRow key={h.id} hook={h} onSecret={setSecret} />
                  ))}
                </ul>
              )}
            </Card>
            <Events hooks={list} />
          </div>
          <div className="grid gap-4 wide:col-span-4">
            <Card>
              <h2 className="font-display text-reading font-bold text-ink">Add a webhook</h2>
              <AddWebhook types={types} onSecret={setSecret} />
            </Card>
            <Card>
              <h2 className="font-display text-reading font-bold text-ink">Checking the signature</h2>
              <p className="mt-1 text-body text-ink-2">
                Each POST carries <span className="font-mono">webhook-id</span>, <span className="font-mono">webhook-timestamp</span> and{' '}
                <span className="font-mono">webhook-signature</span>, signed the Standard Webhooks way with your secret. After you rotate
                it, the old secret signs beside the new one for a day.
              </p>
            </Card>
          </div>
        </div>
      )}
    </div>
  )
}
