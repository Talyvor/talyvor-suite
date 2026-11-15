import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, CardHeader, Input, Pill, RevealOnce, Row, focusRing, type PillStatus } from '@talyvor/ui'
import { Card } from './walletBrand'
import { Note, readFailure } from './WalletMoney'
import { formatWhen } from './format'
import { type AlertChannel, type AlertDelivery, agentBankApi, refusalText } from './agentBankApi'

// AlertChannels.tsx — B28.66: where the workspace's alerts go (Lens B28.338). Each limit alert and unusual-spend alert
// raised after a channel is added is queued once for every channel — push to the owner's phones and browsers, a webhook
// signed with its own secret, or a Slack channel — and sent within a minute. Email needs an email integration, which
// is not connected yet, so it is not offered.

const CHANNELS_KEY = ['alert-channels']
const DELIVERIES_KEY = ['alert-deliveries']

export const KIND_NAME: Record<AlertChannel['kind'], string> = {
  push: 'Push to your phones and browsers',
  webhook: 'Webhook, signed',
  slack: 'Slack',
}
export const URL_HINT: Partial<Record<AlertChannel['kind'], string>> = {
  webhook: 'https://your-server.example/alerts',
  slack: 'https://hooks.slack.com/services/…',
}
const DELIVERY: Record<AlertDelivery['status'], [PillStatus, string]> = {
  queued: ['held', 'Queued'],
  sent: ['settled', 'Sent'],
  failed: ['slashed', 'Failed'],
}
const select = `h-8 rounded-control border border-rule-strong bg-surface px-2 text-body text-ink transition-colors duration-200 hover:border-rule-strong ${focusRing}`

/** The channels, their deliveries, the picker's state and the add and remove calls: one for each drawing of the card. */
export function useAlertChannels() {
  const qc = useQueryClient()
  const channels = useQuery({ queryKey: CHANNELS_KEY, queryFn: agentBankApi.alertChannels })
  const deliveries = useQuery({ queryKey: DELIVERIES_KEY, queryFn: agentBankApi.alertDeliveries })
  const [kind, setKind] = useState<AlertChannel['kind']>('push')
  const [url, setURL] = useState('')
  const [secret, setSecret] = useState<AlertChannel | null>(null)
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: CHANNELS_KEY })
    void qc.invalidateQueries({ queryKey: DELIVERIES_KEY })
  }
  const add = useMutation({
    mutationFn: () => agentBankApi.addAlertChannel(kind, kind === 'push' ? '' : url.trim()),
    onSuccess: (c) => {
      setURL('')
      if (c.secret) setSecret(c)
      refresh()
    },
  })
  const remove = useMutation({ mutationFn: agentBankApi.removeAlertChannel, onSuccess: refresh })
  const list = channels.data?.channels ?? []
  const sent = deliveries.data?.deliveries ?? []
  const kindOf = (id: string, fallback: AlertChannel['kind']) => KIND_NAME[list.find((c) => c.id === id)?.kind ?? fallback]
  return { channels, kind, setKind, url, setURL, secret, setSecret, add, remove, list, sent, kindOf }
}

export function AlertChannels() {
  const { channels, kind, setKind, url, setURL, secret, setSecret, add, remove, list, sent, kindOf } = useAlertChannels()

  return (
    <Card data-testid="alert-channels">
      <CardHeader>Where alerts go</CardHeader>
      {secret ? (
        <div className="px-gutter py-3">
          <RevealOnce
            title="Webhook signing secret (shown once)"
            secret={secret.secret ?? ''}
            copyLabel="Copy secret"
            identifierLabel="Sends to"
            identifier={secret.url ?? ''}
            identifierNote="Each alert is posted here with X-Talyvor-Timestamp and X-Talyvor-Signature: v1= the HMAC-SHA256 of the timestamp, a dot and the body, keyed with this secret."
            onDone={() => setSecret(null)}
          />
        </div>
      ) : null}
      {remove.isError ? (
        <div className="px-gutter py-2">
          <Note ok={false}>{refusalText(remove.error)}</Note>
        </div>
      ) : null}
      {channels.isError ? (
        <p className="px-gutter py-3 text-body text-muted">{readFailure(channels.error, 'Where alerts go')}</p>
      ) : channels.isPending ? (
        <p className="px-gutter py-3 text-body text-muted">Reading…</p>
      ) : list.length > 0 ? (
        list.map((c) => (
          <Row
            key={c.id}
            data-testid={`alert-channel-${c.id}`}
            label={KIND_NAME[c.kind] ?? c.kind}
            hint={
              <>
                {c.url ? <span className="font-figure">{c.url}</span> : 'Every phone and browser you turned notifications on for'} · added{' '}
                <span className="font-figure">{formatWhen(c.created_at)}</span>
              </>
            }
          >
            <Button variant="danger" disabled={remove.isPending} onClick={() => remove.mutate(c.id)} aria-label={`Remove ${KIND_NAME[c.kind] ?? c.kind}`}>
              Remove
            </Button>
          </Row>
        ))
      ) : (
        <p className="px-gutter py-3 text-body text-muted">
          Alerts show only here for now. Add a channel and each limit or unusual-spend alert is sent to it too, within a minute.
        </p>
      )}
      <form
        className="flex flex-col gap-2 px-gutter py-3"
        data-testid="new-alert-channel"
        onSubmit={(ev) => {
          ev.preventDefault()
          if (!add.isPending) add.mutate()
        }}
      >
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="Send alerts to" className={select} value={kind} onChange={(ev) => setKind(ev.target.value as AlertChannel['kind'])}>
            {(Object.keys(KIND_NAME) as AlertChannel['kind'][]).map((k) => (
              <option key={k} value={k}>
                {KIND_NAME[k]}
              </option>
            ))}
          </select>
          {kind !== 'push' ? (
            <Input
              aria-label={kind === 'slack' ? 'Slack incoming webhook URL' : 'Webhook URL'}
              placeholder={URL_HINT[kind]}
              className="min-w-0 flex-1"
              inputMode="url"
              value={url}
              onChange={(ev) => setURL(ev.target.value)}
            />
          ) : null}
          <Button type="submit" disabled={add.isPending || (kind !== 'push' && url.trim() === '')}>
            {add.isPending ? 'Adding…' : 'Add channel'}
          </Button>
        </div>
        <p className="text-caption text-muted">Email needs an email integration, which is not connected yet.</p>
        {add.isError ? <Note ok={false}>{refusalText(add.error)}</Note> : null}
      </form>
      {sent.length > 0 ? (
        <>
          <CardHeader>Sent alerts</CardHeader>
          {sent.slice(0, 10).map((d) => (
            <Row
              key={d.id}
              data-testid={`alert-delivery-${d.id}`}
              label={d.body || d.title}
              hint={
                <>
                  {d.title} · to {kindOf(d.channel_id, d.channel_kind)} · <span className="font-figure">{formatWhen(d.sent_at ?? d.created_at)}</span>
                  {d.status === 'failed' && d.last_error ? <> · {d.last_error}</> : null}
                </>
              }
            >
              <Pill status={DELIVERY[d.status]?.[0] ?? 'idle'}>{DELIVERY[d.status]?.[1] ?? d.status}</Pill>
            </Row>
          ))}
        </>
      ) : null}
    </Card>
  )
}
