import { useMutation } from '@tanstack/react-query'
import { Link, useLocation } from 'react-router-dom'
import { Button, Card, Facts } from '@talyvor/ui/pocket'
import { InviteError, invitesApi } from './membersApi'

// B52.36 — where a workspace's invite link opens (/join#<token>), signed in. Join asks the BFF to add the session's
// own person to the invite's workspace (Lens B52.35); the browser sends the token and nothing else. A link that was
// revoked, has expired or is used up is refused in the BFF's words.
//
// B57.205 — drawn in Pocket as w-room-invite: the invitation's line under the page's heading, then a white card of what
// joining means (its facts, Join and Not now) beside the note on what a link admits.

/** The invite token after the #, or '' when the link carries none. */
export function inviteToken(hash: string): string {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  try {
    return decodeURIComponent(raw).trim()
  } catch {
    return ''
  }
}

/** w-room-invite's side card: what a link admits, beside what joining means. */
function Admits() {
  return (
    <Card className="wide:col-span-5">
      <p className="text-body text-ink-3">
        An invite link admits people until it is revoked, expires or is used up. A link that no longer admits anyone says so here.
      </p>
    </Card>
  )
}

export function JoinWorkspace() {
  const { hash } = useLocation()
  const token = inviteToken(hash)
  const join = useMutation({ mutationFn: () => invitesApi.accept(token) })

  const home = (label: string) => (
    <Button asChild variant="secondary">
      <Link to="/">{label}</Link>
    </Button>
  )

  if (!token) {
    return (
      <div className="grid items-start gap-4 wide:grid-cols-12">
        <Card tone="white" className="grid gap-3.5 wide:col-span-7">
          <h2 className="font-display text-reading font-bold text-ink">This link has no invite in it. Ask whoever sent it for a new one.</h2>
          <div>{home('Back to Home')}</div>
        </Card>
        <Admits />
      </div>
    )
  }

  if (join.isSuccess) {
    const name = join.data.name || 'the workspace'
    return (
      <div className="grid items-start gap-4 wide:grid-cols-12">
        <Card tone="white" className="grid gap-3.5 wide:col-span-7">
          <div>
            <h2 data-testid="joined" className="font-display text-reading font-bold text-ink">
              {join.data.created ? `You joined ${name}.` : `You are already a member of ${name}.`}
            </h2>
            <p className="mt-1 text-body text-ink-3">You can read it as a member. Its owner can remove you.</p>
          </div>
          <div>{home('Back to Home')}</div>
        </Card>
        <Admits />
      </div>
    )
  }

  return (
    <div className="grid gap-4">
      <p className="text-reading pk-on-bg">You’ve been invited to join a workspace on Talyvor.</p>
      <div className="grid items-start gap-4 wide:grid-cols-12">
        <Card tone="white" className="grid gap-3.5 wide:col-span-7">
          <h2 className="font-display text-reading font-bold text-ink">What joining means</h2>
          <Facts
            facts={[
              { label: 'What you can do', value: 'Read the workspace' },
              { label: 'Who can remove you', value: 'Its owner, at any time' },
              { label: 'Your own account', value: 'Stays as it is' },
            ]}
          />
          <div className="flex flex-wrap gap-2.5">
            <Button variant="primary" disabled={join.isPending} onClick={() => join.mutate()}>
              {join.isPending ? 'Joining…' : 'Join'}
            </Button>
            {home('Not now')}
          </div>
          {join.isError ? (
            <p role="alert" className="text-body text-danger">
              {join.error instanceof InviteError && join.error.sentence ? join.error.sentence : 'You did not join. You can try again.'}
            </p>
          ) : null}
        </Card>
        <Admits />
      </div>
    </div>
  )
}
