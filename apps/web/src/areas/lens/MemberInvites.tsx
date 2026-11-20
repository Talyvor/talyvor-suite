import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Card, Chip, Field, Input, Row, Select, showSnack, type ChipTone } from '@talyvor/ui/pocket'
import { formatWhen } from './format'
import { InviteError, invitesApi, joinHref, type JoinedMember, type WorkspaceInvite } from './membersApi'

// B52.36 — Settings → Members: the workspace's invite links (made, copied once, revoked) and the people who joined by
// one (removed). Lens (B52.35) keeps both and lets only the workspace's owner see them; a person who joins reads the
// workspace and its owner can remove them.

const INVITES_KEY = ['workspace', 'member-invites']
const JOINED_KEY = ['workspace', 'members']

const EXPIRIES: readonly [number, string][] = [
  [1, 'In a day'],
  [7, 'In a week'],
  [30, 'In 30 days'],
]

function inviteState(i: WorkspaceInvite): { tone: ChipTone; label: string } {
  if (i.live) return { tone: 'good', label: 'Live' }
  if (i.revoked_at) return { tone: 'bad', label: 'Revoked' }
  if (i.uses >= i.max_uses) return { tone: 'plain', label: 'Used up' }
  return { tone: 'plain', label: 'Expired' }
}

const refusal = (err: unknown, fallback: string) => (err instanceof InviteError && err.sentence ? err.sentence : fallback)

function InviteRow({ i }: { i: WorkspaceInvite }) {
  const qc = useQueryClient()
  const revoke = useMutation({
    mutationFn: () => invitesApi.revoke(i.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: INVITES_KEY }),
  })
  const state = inviteState(i)
  return (
    <li>
      <Row
        title={
          <>
            Link · <span className="font-figure">{i.uses}</span> of <span className="font-figure">{i.max_uses}</span> used
          </>
        }
        line={
          <>
            made <span className="font-figure">{formatWhen(i.created_at)}</span> · expires{' '}
            <span className="font-figure">{formatWhen(i.expires_at)}</span>
            {revoke.isError ? <span role="alert"> · {refusal(revoke.error, 'It was not revoked. Try again.')}</span> : null}
          </>
        }
        action={
          i.live ? (
            <Button
              size="sm"
              variant="outline"
              aria-label={`Revoke invite made ${formatWhen(i.created_at)}`}
              disabled={revoke.isPending}
              onClick={() => revoke.mutate()}
            >
              {revoke.isPending ? 'Revoking…' : 'Revoke'}
            </Button>
          ) : (
            <Chip tone={state.tone}>{state.label}</Chip>
          )
        }
      />
    </li>
  )
}

function InviteLinks() {
  const qc = useQueryClient()
  const [uses, setUses] = useState('1')
  const [days, setDays] = useState(7)
  const [copied, setCopied] = useState<boolean | null>(null)
  const list = useQuery({ queryKey: INVITES_KEY, queryFn: invitesApi.invites, retry: false })
  const maxUses = /^\s*\d{1,9}\s*$/.test(uses) && Number(uses) >= 1 ? Number(uses) : null
  const create = useMutation({
    mutationFn: () => invitesApi.create(maxUses ?? 1, new Date(Date.now() + days * 86_400_000).toISOString()),
    onSuccess: () => {
      setCopied(null)
      void qc.invalidateQueries({ queryKey: INVITES_KEY })
    },
  })
  const link = create.data?.token ? `${window.location.origin}${joinHref(create.data.token)}` : ''
  const copy = () =>
    navigator.clipboard
      .writeText(link)
      .then(() => setCopied(true))
      .catch(() => setCopied(false))

  return (
    <section aria-labelledby="invite-links" className="grid gap-3">
      <h3 id="invite-links" className="text-head font-bold text-ink">
        Invite links
      </h3>
      <p className="max-w-2xl text-body text-ink-2">
        A link lets people join this workspace until it is used up, expires or is revoked. Whoever joins can read the
        workspace, and you can remove them. The link is shown once, when it is made. Copy it then.
      </p>
      <Card tone="white">
        <form
          className="grid gap-3.5 p-4"
          onSubmit={(ev) => {
            ev.preventDefault()
            if (maxUses !== null && !create.isPending) create.mutate()
          }}
        >
          <div className="flex flex-wrap items-end gap-3">
            <Field label="How many people it admits">
              <Input className="w-28 font-figure" inputMode="numeric" value={uses} onChange={(ev) => setUses(ev.target.value)} />
            </Field>
            <Field label="It expires">
              <Select value={days} onChange={(ev) => setDays(Number(ev.target.value))}>
                {EXPIRIES.map(([d, label]) => (
                  <option key={d} value={d}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            <Button type="submit" variant="secondary" disabled={maxUses === null || create.isPending}>
              {create.isPending ? 'Making…' : 'Make a link'}
            </Button>
          </div>
          {maxUses === null ? <p role="alert" className="text-body text-danger">A link admits a whole number of people, at least 1.</p> : null}
          {link ? (
            <div className="grid gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Input aria-label="Invite link" readOnly className="min-w-0 grow font-figure" value={link} onFocus={(ev) => ev.target.select()} />
                <Button variant="secondary" onClick={copy}>
                  Copy
                </Button>
              </div>
              {copied === true ? <p className="text-body text-ink-2">Copied. Send it to the people you want in this workspace.</p> : null}
              {copied === false ? <p className="text-body text-danger">This browser would not copy it. Select the link and copy it.</p> : null}
            </div>
          ) : null}
          {create.isError ? (
            <p role="alert" className="text-body text-danger">
              {refusal(create.error, 'No link was made. You can try again.')}
            </p>
          ) : null}
        </form>
      </Card>
      <Card tone="white">
        {list.isPending ? (
          <p className="p-4 text-body text-ink-2">Reading…</p>
        ) : list.isError ? (
          <p className="p-4 text-body text-ink-2">Couldn’t read the invite links. This is a fault, not an empty list.</p>
        ) : list.data.length === 0 ? (
          <p className="p-4 text-body text-ink-2">No invite links yet. Make one above to invite someone.</p>
        ) : (
          <ul aria-label="Invite links">
            {list.data.map((i) => (
              <InviteRow key={i.id} i={i} />
            ))}
          </ul>
        )}
      </Card>
    </section>
  )
}

function JoinedRow({ m }: { m: JoinedMember }) {
  const qc = useQueryClient()
  const remove = useMutation({
    mutationFn: () => invitesApi.remove(m.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: JOINED_KEY })
      showSnack({ title: 'Removed', line: 'They can no longer reach this workspace.' })
    },
  })
  return (
    <li>
      <Row
        title="Member"
        line={
          <>
            joined <span className="font-figure">{formatWhen(m.added_at)}</span> · can read this workspace
            {remove.isError ? <span role="alert"> · {refusal(remove.error, 'They were not removed. Try again.')}</span> : null}
          </>
        }
        action={
          <Button
            size="sm"
            variant="danger"
            aria-label={`Remove the member who joined ${formatWhen(m.added_at)}`}
            disabled={remove.isPending}
            onClick={() => remove.mutate()}
          >
            {remove.isPending ? 'Removing…' : 'Remove'}
          </Button>
        }
      />
    </li>
  )
}

function JoinedByInvite() {
  const list = useQuery({ queryKey: JOINED_KEY, queryFn: invitesApi.members, retry: false })
  return (
    <section aria-labelledby="joined-by-invite" className="grid gap-3">
      <h3 id="joined-by-invite" className="text-head font-bold text-ink">
        Joined by invite
      </h3>
      <Card tone="white">
        {list.isPending ? (
          <p className="p-4 text-body text-ink-2">Reading…</p>
        ) : list.isError ? (
          <p className="p-4 text-body text-ink-2">Couldn’t read who joined. This is a fault, not an empty list.</p>
        ) : list.data.length === 0 ? (
          <p className="p-4 text-body text-ink-2">Nobody has joined by invite yet.</p>
        ) : (
          <ul aria-label="Joined by invite">
            {list.data.map((m) => (
              <JoinedRow key={m.id} m={m} />
            ))}
          </ul>
        )}
      </Card>
    </section>
  )
}

/** The owner's invite links and who joined by one, under the roster. Lens shows them to the owner only: anyone else
 * is refused (403), and then neither is drawn. */
export function MemberInvites() {
  const list = useQuery({ queryKey: INVITES_KEY, queryFn: invitesApi.invites, retry: false })
  if (list.error instanceof InviteError && list.error.status === 403) return null
  return (
    <div className="grid gap-6">
      <InviteLinks />
      <JoinedByInvite />
    </div>
  )
}
