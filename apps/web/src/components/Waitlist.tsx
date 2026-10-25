import { useId, useState } from 'react'
import { Button, Input, inlineLink } from '@talyvor/ui'
import { CopyButton } from '../areas/chat/CopyButton'

// B44.1 — talyvor.com's waitlist: one email field and one button, on /marketing and on /signup while
// sign-up is closed. A plain fetch, no providers: Landing renders bare (see Landing.tsx).
// B45.21 — a joiner gets their own link (/marketing?ref=<code>); joining through someone's link counts once for them.

/** Fired on window the moment someone joins. B44.2 counts a Lead on it; nothing personal rides on it. */
export const WAITLIST_JOINED_EVENT = 'talyvor:waitlist-joined'

type State = 'idle' | 'sending' | 'joined'

export function Waitlist({ className }: { className?: string }) {
  const id = useId()
  const [email, setEmail] = useState('')
  const [website, setWebsite] = useState('')
  const [state, setState] = useState<State>('idle')
  const [error, setError] = useState('')
  const [refCode, setRefCode] = useState('')

  if (state === 'joined') {
    // /marketing, not the bare host: it is where this form lives, so the code arrives where it is read.
    const link = `${window.location.origin}/marketing?ref=${refCode}`
    return (
      <div className={className}>
        <p role="status" className="text-body text-ink">
          You’re on the list.
        </p>
        {refCode && (
          <>
            <p className="mt-3 text-body text-muted">Move up the list: share your link</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <code className="max-w-full break-all rounded-control border border-rule px-3 py-2 font-mono text-caption text-ink">
                {link}
              </code>
              <CopyButton text={link} label="Copy link" className="border border-rule" />
            </div>
          </>
        )}
      </div>
    )
  }

  async function join(e: React.FormEvent) {
    e.preventDefault()
    setState('sending')
    setError('')
    const q = new URLSearchParams(window.location.search)
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          email,
          website,
          page: window.location.pathname,
          utm_source: q.get('utm_source') ?? '',
          utm_medium: q.get('utm_medium') ?? '',
          utm_campaign: q.get('utm_campaign') ?? '',
          ref: q.get('ref') ?? '',
        }),
      })
      if (res.ok) {
        const body = (await res.json().catch(() => ({}))) as { ref_code?: string }
        setRefCode(body.ref_code ?? '')
        setState('joined')
        window.dispatchEvent(new Event(WAITLIST_JOINED_EVENT))
        return
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      setError(body.error ?? 'We couldn’t add you just now. Try again.')
    } catch {
      setError('We couldn’t add you just now. Try again.')
    }
    setState('idle')
  }

  return (
    <form onSubmit={join} className={className} noValidate>
      <label htmlFor={`${id}-email`} className="sr-only">
        Email address
      </label>
      <div className="flex flex-wrap gap-2">
        <Input
          id={`${id}-email`}
          type="email"
          name="email"
          autoComplete="email"
          required
          placeholder="you@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={`${id}-note`}
          className="h-10 w-full max-w-xs flex-1"
        />
        <Button type="submit" variant="primary" className="h-10 px-5" disabled={state === 'sending'}>
          Join the waitlist
        </Button>
      </div>
      {/* The honeypot: off-screen and out of the tab order, so only a bot fills it. */}
      <div className="sr-only" aria-hidden="true">
        <Input
          type="text"
          name="website"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
        />
      </div>
      {error && (
        <p role="alert" className="mt-2 text-caption text-ink">
          {error}
        </p>
      )}
      <p id={`${id}-note`} className="mt-2 text-caption text-faint">
        We’ll email you when your place opens. No newsletter.{' '}
        <a href="/privacy" className={inlineLink}>
          Privacy
        </a>
      </p>
    </form>
  )
}
