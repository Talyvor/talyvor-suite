import { Fragment, useId, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button, Card, Chip, Crumb, EmptyState, Field, Icon, KindTile, Money, Row, Select, pocketFocusRing, showSnack } from '@talyvor/ui/pocket'
import { cn } from '@talyvor/ui'
import { isSessionExpired } from '../../lib/productState'
import { readFailure } from './WalletMoney'
import {
  type AccountRequest,
  type RequestKind,
  BalancesHeldError,
  REQUESTS_KEY,
  RequestRefusedError,
  exportHref,
  sendRequest,
  useAccountRequests,
} from './accountRequests'

// HelpAndAccount.tsx — B59.28: Settings' Help and complaints, Close this account and Your data. Each sends a request
// that a person at Talyvor answers (Lens B59.27), and lists what was sent with its state and, for a complaint, its
// reference. Closing the account is refused while any balance is not empty, and the refusal names each one. A data
// export downloads here once Talyvor has marked it done. No screen promises when an answer comes.
// B57.139 — each page is drawn as Pocket's w-card: the crumb back to Settings, the page's heading and its line, then
// what was sent in the wide column with the form beside it.

const KIND_TITLE: Record<RequestKind, string> = {
  support: 'Question or problem',
  complaint: 'Complaint',
  account_closure: 'Close this account',
  data_export: 'A copy of your data',
  data_deletion: 'Delete your data',
}

const KIND_ICON: Record<RequestKind, 'phone' | 'x' | 'download'> = {
  support: 'phone',
  complaint: 'phone',
  account_closure: 'x',
  data_export: 'download',
  data_deletion: 'x',
}

const STATE_CHIP: Record<AccountRequest['state'], React.ReactNode> = {
  received: <Chip tone="wait">Received</Chip>,
  in_progress: <Chip tone="wait" dot>In progress</Chip>,
  done: <Chip tone="good">Done</Chip>,
}

const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })

/** A refusal as one sentence: what the account still holds, or Lens's own words where it gave them. */
function refusalLine(err: unknown): React.ReactNode {
  if (isSessionExpired(err)) return 'Nothing was sent. Sign in again.'
  if (err instanceof BalancesHeldError) {
    return (
      <>
        This account still holds{' '}
        {Object.keys(err.balances)
          .sort()
          .map((c, i) => (
            <Fragment key={c}>
              {i > 0 ? ', ' : null}
              <Money minor={err.balances[c]} currency={c} />
            </Fragment>
          ))}
        . Move the money out, then ask again.
      </>
    )
  }
  if (err instanceof RequestRefusedError && err.status < 500 && err.sentence) {
    const s = err.sentence.replace(/^support: /, '')
    return `${s.charAt(0).toUpperCase()}${s.slice(1)}${s.endsWith('.') ? '' : '.'}`
  }
  return 'Nothing was sent. You can try again.'
}

/** The crumb back to Settings, then the page's heading (the shell's top bar holds its one h1) and its words. */
function PageTop({ page, heading, children }: { page: string; heading: string; children: React.ReactNode }) {
  return (
    <>
      <Crumb trail={[{ label: 'Settings', href: '/settings' }, { label: page }]} />
      <div className="grid max-w-2xl gap-1">
        <h2 className="font-display text-title font-bold text-ink">{heading}</h2>
        <div className="grid gap-2 text-reading text-ink-2">{children}</div>
      </div>
    </>
  )
}

/** A message box in the same face as Pocket's Input, named by its own label. */
function MessageBox({ label, value, onChange, required = false }: { label: string; value: string; onChange: (v: string) => void; required?: boolean }) {
  const id = useId()
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-body font-semibold text-ink-2">
        {label}
      </label>
      <textarea
        id={id}
        rows={5}
        maxLength={4000}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          'min-h-28 rounded-control bg-page px-3.5 py-2.5 text-reading text-ink shadow-edge placeholder:text-faint',
          'transition-colors duration-200 hover:border-rule-strong disabled:cursor-not-allowed disabled:opacity-50',
          pocketFocusRing,
        )}
      />
    </div>
  )
}

/** What was sent of these kinds, newest first, each with its state, its reference and Talyvor's answer. */
function SentList({ kinds, title, empty }: { kinds: RequestKind[]; title: string; empty: string }) {
  const requests = useAccountRequests()
  const mine = (requests.data ?? []).filter((r) => kinds.includes(r.kind))
  return (
    <Card tone="white">
      <h3 className="font-display text-reading font-bold text-ink">{title}</h3>
      <div className="mt-2" data-testid="sent-requests">
        {requests.isError ? (
          <p className="text-body text-ink-2">{readFailure(requests.error, 'What you sent')}</p>
        ) : requests.isPending ? (
          <p className="text-body text-ink-2">Reading…</p>
        ) : mine.length === 0 ? (
          <EmptyState icon={<Icon name="send" />} title={empty} line="Anything you send appears here with what Talyvor answers." />
        ) : (
          mine.map((r) => (
            <div key={r.id} data-testid={`request-${r.id}`} className="border-b border-line pb-2.5 last:border-b-0">
              <Row
                leading={<KindTile icon={<Icon name={KIND_ICON[r.kind]} />} on="white" />}
                title={KIND_TITLE[r.kind]}
                line={
                  <>
                    Sent {day(r.filed_at)}
                    {r.reference ? (
                      <>
                        {' · Reference '}
                        <span className="font-figure text-ink">{r.reference}</span>
                      </>
                    ) : null}
                  </>
                }
                action={STATE_CHIP[r.state]}
                wrap
              />
              {r.message ? <p className="whitespace-pre-line text-body text-ink-2">{r.message}</p> : null}
              {r.answer ? (
                <p className="mt-2 whitespace-pre-line rounded-card-tight bg-cloud px-3.5 py-2.5 text-body text-ink">
                  <span className="font-semibold">Talyvor’s answer: </span>
                  {r.answer}
                </p>
              ) : null}
              {r.kind === 'data_export' && r.state === 'done' ? (
                <div className="mt-2">
                  <Button asChild size="sm" variant="secondary">
                    <a href={exportHref(r.id)} download>
                      Download your data
                    </a>
                  </Button>
                </div>
              ) : null}
            </div>
          ))
        )}
      </div>
    </Card>
  )
}

/** Sends one kind of request, then lists it; `after` is the snack's line once it is sent. */
function useSend(kind: RequestKind, after: (r: AccountRequest) => { title: string; line: string }) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (message: string) => sendRequest(kind, message.trim()),
    onSuccess: (r) => {
      showSnack(after(r))
      void qc.invalidateQueries({ queryKey: REQUESTS_KEY })
    },
  })
}

function Refused({ error }: { error: unknown }) {
  return (
    <p role="alert" className="text-body text-danger">
      {refusalLine(error)}
    </p>
  )
}

/** /settings/help — ask for help or make a complaint, and what was sent. */
export function HelpScreen() {
  const [kind, setKind] = useState<'support' | 'complaint'>('support')
  const [message, setMessage] = useState('')
  const help = useSend('support', () => ({ title: 'Sent', line: 'A person at Talyvor reads it and answers on this page.' }))
  const complaint = useSend('complaint', (r) => ({ title: 'Complaint received', line: `Its reference is ${r.reference}.` }))
  const send = kind === 'support' ? help : complaint
  return (
    <div className="grid gap-5 px-gutter py-4 wide:py-6">
      <PageTop page="Help and complaints" heading="Ask us something, or make a complaint">
        <p>Ask us about your account, or tell us what went wrong. A person at Talyvor reads every message and answers on this page.</p>
        <p>A complaint gets a reference as soon as you send it. Quote it whenever you write to us about it.</p>
      </PageTop>
      <div className="grid items-start gap-4 wide:grid-cols-12">
        <div className="wide:col-span-7">
          <SentList kinds={['support', 'complaint']} title="What you sent" empty="Nothing sent yet." />
        </div>
        <Card className="wide:col-span-5">
          <h3 className="font-display text-reading font-bold text-ink">Write to us</h3>
          <form
            className="mt-2 grid gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              if (message.trim() === '' || send.isPending) return
              send.mutate(message, { onSuccess: () => setMessage('') })
            }}
          >
            <Field label="What is it?">
              <Select
                value={kind}
                onChange={(e) => {
                  help.reset()
                  complaint.reset()
                  setKind(e.target.value as 'support' | 'complaint')
                }}
              >
                <option value="support">A question or a problem</option>
                <option value="complaint">A complaint</option>
              </Select>
            </Field>
            <MessageBox label="Your message" value={message} onChange={setMessage} required />
            {send.isError ? <Refused error={send.error} /> : null}
            <div>
              <Button type="submit" disabled={send.isPending} disabledReason={message.trim() === '' ? 'Write your message first.' : undefined}>
                {send.isPending ? 'Sending…' : kind === 'complaint' ? 'Send complaint' : 'Send'}
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </div>
  )
}

/** /settings/close — what must be empty first, and the request to close. */
export function CloseAccountScreen() {
  const [message, setMessage] = useState('')
  const close = useSend('account_closure', () => ({ title: 'Asked', line: 'A person at Talyvor closes the account and answers on this page.' }))
  return (
    <div className="grid gap-5 px-gutter py-4 wide:py-6">
      <PageTop page="Close this account" heading="What must be empty first, and asking to close">
        <p>
          Before the account can close, every balance must be empty: the account’s own, each agent’s, and any money set aside. Move the
          money out first.
        </p>
        <p>A person at Talyvor closes the account and answers on this page. Only the account’s owner can ask.</p>
      </PageTop>
      <div className="grid items-start gap-4 wide:grid-cols-12">
        <div className="wide:col-span-7">
          <SentList kinds={['account_closure']} title="What you asked" empty="You have not asked to close this account." />
        </div>
        <Card className="wide:col-span-5">
          <h3 className="font-display text-reading font-bold text-ink">Ask to close</h3>
          <form
            className="mt-2 grid gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              if (!close.isPending) close.mutate(message, { onSuccess: () => setMessage('') })
            }}
          >
            <MessageBox label="Anything we should know (optional)" value={message} onChange={setMessage} />
            {close.isError ? <Refused error={close.error} /> : null}
            <div>
              <Button type="submit" variant="danger" disabled={close.isPending}>
                {close.isPending ? 'Sending…' : 'Ask to close this account'}
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </div>
  )
}

/** /settings/data — ask for a copy of the account's data and download it, or ask for it to be deleted. */
export function YourDataScreen() {
  const [message, setMessage] = useState('')
  const copy = useSend('data_export', () => ({ title: 'Asked', line: 'When your copy is ready, Download appears on this page.' }))
  const erase = useSend('data_deletion', () => ({ title: 'Asked', line: 'A person at Talyvor answers on this page.' }))
  return (
    <div className="grid gap-5 px-gutter py-4 wide:py-6">
      <PageTop page="Your data" heading="A copy of your data, or ask for it to be deleted">
        <p>Ask for a copy of this account’s data, or ask Talyvor to delete it. A person at Talyvor handles each request. Only the account’s owner can ask.</p>
      </PageTop>
      <div className="grid items-start gap-4 wide:grid-cols-12">
        <div className="wide:col-span-7">
          <SentList kinds={['data_export', 'data_deletion']} title="What you asked" empty="You have not asked for your data." />
        </div>
        <div className="grid gap-4 wide:col-span-5">
          <Card>
            <h3 className="font-display text-reading font-bold text-ink">A copy of your data</h3>
            <p className="mt-1 text-body text-ink-2">A person at Talyvor prepares it. When it is ready, Download appears beside your request.</p>
            {copy.isError ? (
              <div className="mt-2">
                <Refused error={copy.error} />
              </div>
            ) : null}
            <div className="mt-3">
              <Button disabled={copy.isPending} onClick={() => copy.mutate('')}>
                {copy.isPending ? 'Sending…' : 'Ask for a copy'}
              </Button>
            </div>
          </Card>
          <Card>
            <h3 className="font-display text-reading font-bold text-ink">Delete your data</h3>
            <p className="mt-1 text-body text-ink-2">
              Ask, and we delete it. Billing and ledger records, statements included, are kept as the law requires.
            </p>
            <form
              className="mt-2 grid gap-3"
              onSubmit={(e) => {
                e.preventDefault()
                if (!erase.isPending) erase.mutate(message, { onSuccess: () => setMessage('') })
              }}
            >
              <MessageBox label="Anything we should know (optional)" value={message} onChange={setMessage} />
              {erase.isError ? <Refused error={erase.error} /> : null}
              <div>
                <Button type="submit" variant="danger" disabled={erase.isPending}>
                  {erase.isPending ? 'Sending…' : 'Ask to delete your data'}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      </div>
    </div>
  )
}
