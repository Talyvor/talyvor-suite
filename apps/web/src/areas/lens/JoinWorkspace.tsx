import { useMutation } from '@tanstack/react-query'
import { Link, useLocation } from 'react-router-dom'
import { Button, Card } from '@talyvor/ui/pocket'
import { InviteError, invitesApi } from './membersApi'

// B52.36 — where a workspace's invite link opens (/join#<token>), signed in. Join asks the BFF to add the session's
// own person to the invite's workspace (Lens B52.35); the browser sends the token and nothing else. A link that was
// revoked, has expired or is used up is refused in the BFF's words.

/** The invite token after the #, or '' when the link carries none. */
export function inviteToken(hash: string): string {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  try {
    return decodeURIComponent(raw).trim()
  } catch {
    return ''
  }
}

export function JoinWorkspace() {
  const { hash } = useLocation()
  const token = inviteToken(hash)
  const join = useMutation({ mutationFn: () => invitesApi.accept(token) })

  const home = (
    <Button asChild variant="secondary">
      <Link to="/">Back to Home</Link>
    </Button>
  )

  if (!token) {
    return (
      <div className="grid max-w-2xl gap-4">
        <h2 className="text-reading text-ink-2">This link has no invite in it. Ask whoever sent it for a new one.</h2>
        <div>{home}</div>
      </div>
    )
  }

  if (join.isSuccess) {
    const name = join.data.name || 'the workspace'
    return (
      <div className="grid max-w-2xl gap-4">
        <h2 data-testid="joined" className="text-reading text-ink">
          {join.data.created ? `You joined ${name}.` : `You are already a member of ${name}.`}
        </h2>
        <p className="text-body text-ink-2">You can read it as a member. Its owner can remove you.</p>
        <div>{home}</div>
      </div>
    )
  }

  return (
    <div className="grid max-w-2xl gap-4">
      <h2 className="text-reading text-ink-2">You’ve been invited to join a workspace on Talyvor.</h2>
      <Card tone="white" className="grid gap-3 p-4">
        <p className="text-body text-ink">
          As a member you can read the workspace. Its owner can remove you at any time. Your own account stays as it is.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" disabled={join.isPending} onClick={() => join.mutate()}>
            {join.isPending ? 'Joining…' : 'Join'}
          </Button>
          {home}
        </div>
        {join.isError ? (
          <p role="alert" className="text-body text-danger">
            {join.error instanceof InviteError && join.error.sentence ? join.error.sentence : 'You did not join. You can try again.'}
          </p>
        ) : null}
      </Card>
    </div>
  )
}
