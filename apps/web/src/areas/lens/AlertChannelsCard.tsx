import { Button, Card, Chip, CodeBox, Field, Input, Row, Select, type ChipTone } from '@talyvor/ui/pocket'
import { readFailure } from './WalletMoney'
import { formatWhen } from './format'
import { KIND_NAME, URL_HINT, useAlertChannels } from './AlertChannels'
import { type AlertChannel, type AlertDelivery, refusalText } from './agentBankApi'

// AlertChannelsCard.tsx — B57.115: Where alerts go on /agents, below Limit alerts, in Pocket's components as B57.90 draws
// Limit alerts. The same card as AlertChannels.tsx (B28.66, Lens B28.338), which the agent's own page still draws: each
// channel with Remove, the picker and Add channel, a webhook's signing secret shown once, and Sent alerts with each
// delivery's Queued, Sent or Failed and Lens's reason. Email needs an email integration, so it is not offered.

const DELIVERY: Record<AlertDelivery['status'], [ChipTone, string]> = {
  queued: ['wait', 'Queued'],
  sent: ['good', 'Sent'],
  failed: ['bad', 'Failed'],
}

function Refusal({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="text-body text-danger">
      {children}
    </p>
  )
}

/** A new webhook's signing secret, shown once: Done unmounts it and nothing shows it again. */
function SecretOnce({ channel, onDone }: { channel: AlertChannel; onDone: () => void }) {
  return (
    <Card tone="white" tight className="mt-3 grid gap-2" role="status" data-testid="alert-channel-secret">
      <p className="text-body font-semibold text-ink">Webhook signing secret (shown once)</p>
      <p className="text-body text-ink-3">Store it now. It will not be shown again.</p>
      <CodeBox code={channel.secret ?? ''} copied="Copied. Store it now. It will not be shown again." />
      <p className="text-body text-ink-3">
        Sends to <span className="break-all font-mono text-ink">{channel.url ?? ''}</span>
      </p>
      <p className="text-caption text-ink-3">
        Each alert is posted here with X-Talyvor-Timestamp and X-Talyvor-Signature: v1= the HMAC-SHA256 of the timestamp, a dot and the body, keyed with this secret.
      </p>
      <div>
        <Button variant="secondary" size="sm" onClick={onDone}>
          Done, I stored it
        </Button>
      </div>
    </Card>
  )
}

export function AlertChannelsCard() {
  const { channels, kind, setKind, url, setURL, secret, setSecret, add, remove, list, sent, kindOf } = useAlertChannels()

  return (
    <Card tone="white" data-testid="alert-channels">
      <h2 className="font-display text-head font-bold text-ink">Where alerts go</h2>
      {secret ? <SecretOnce channel={secret} onDone={() => setSecret(null)} /> : null}
      {remove.isError ? (
        <div className="mt-2">
          <Refusal>{refusalText(remove.error)}</Refusal>
        </div>
      ) : null}
      <div className="mt-2">
        {channels.isError ? (
          <div role="alert" className="grid justify-items-start gap-3">
            <p className="text-body text-ink-3">{readFailure(channels.error, 'Where alerts go')}</p>
            <Button variant="secondary" size="sm" onClick={() => void channels.refetch()}>
              Try again
            </Button>
          </div>
        ) : channels.isPending ? (
          <p className="text-body text-ink-3">Reading…</p>
        ) : list.length > 0 ? (
          list.map((c) => (
            <div key={c.id} data-testid={`alert-channel-${c.id}`} className="border-t border-line first:border-t-0">
              <Row
                wrap
                title={KIND_NAME[c.kind] ?? c.kind}
                line={
                  <>
                    {c.url ? <span className="break-all font-mono">{c.url}</span> : 'Every phone and browser you turned notifications on for'} · added{' '}
                    <span className="font-figure">{formatWhen(c.created_at)}</span>
                  </>
                }
                action={
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(c.id)}
                    aria-label={`Remove ${KIND_NAME[c.kind] ?? c.kind}`}
                  >
                    Remove
                  </Button>
                }
              />
            </div>
          ))
        ) : (
          <p className="text-body text-ink-3">
            Alerts show only here for now. Add a channel and each limit or unusual-spend alert is sent to it too, within a minute.
          </p>
        )}
      </div>
      <form
        className="mt-3 grid gap-3 border-t border-line pt-3"
        data-testid="new-alert-channel"
        onSubmit={(ev) => {
          ev.preventDefault()
          if (!add.isPending) add.mutate()
        }}
      >
        <div className="grid gap-3 wide:grid-cols-2">
          <Field label="Send alerts to">
            <Select value={kind} onChange={(ev) => setKind(ev.target.value as AlertChannel['kind'])}>
              {(Object.keys(KIND_NAME) as AlertChannel['kind'][]).map((k) => (
                <option key={k} value={k}>
                  {KIND_NAME[k]}
                </option>
              ))}
            </Select>
          </Field>
          {kind !== 'push' ? (
            <Field label={kind === 'slack' ? 'Slack incoming webhook URL' : 'Webhook URL'}>
              <Input placeholder={URL_HINT[kind]} inputMode="url" value={url} onChange={(ev) => setURL(ev.target.value)} />
            </Field>
          ) : null}
        </div>
        <p className="text-caption text-ink-3">Email needs an email integration, which is not connected yet.</p>
        <div>
          <Button type="submit" size="sm" disabled={add.isPending || (kind !== 'push' && url.trim() === '')}>
            {add.isPending ? 'Adding…' : 'Add channel'}
          </Button>
        </div>
        {add.isError ? <Refusal>{refusalText(add.error)}</Refusal> : null}
      </form>
      {sent.length > 0 ? (
        <div className="mt-4">
          <h3 className="text-reading font-semibold text-ink">Sent alerts</h3>
          <div className="mt-1">
            {sent.slice(0, 10).map((d) => (
              <div key={d.id} data-testid={`alert-delivery-${d.id}`} className="border-t border-line first:border-t-0">
                <Row
                  wrap
                  title={d.body || d.title}
                  line={
                    <>
                      {d.title} · to {kindOf(d.channel_id, d.channel_kind)} · <span className="font-figure">{formatWhen(d.sent_at ?? d.created_at)}</span>
                      {d.status === 'failed' && d.last_error ? <> · {d.last_error}</> : null}
                    </>
                  }
                  action={<Chip tone={DELIVERY[d.status]?.[0] ?? 'plain'}>{DELIVERY[d.status]?.[1] ?? d.status}</Chip>}
                />
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </Card>
  )
}
