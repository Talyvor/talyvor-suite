import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Button, Card, CloseX, pocketFocusRing } from '@talyvor/ui/pocket'
import { WAITLIST_JOINED_EVENT } from '../../components/Waitlist'
import { signupStateOf } from '../../lib/signupOpen'
import { META_DATASET_ID, type Consent, isPublicPath, readConsent, revokePixel, startPixel, track, writeConsent } from './pixel'

// B44.2 — the cookie banner and the pixel it gates, on the public pages only. Lead: a waitlist join (the waitlist
// shows only while sign-up is closed), or a click to /signup while it is open (B51.1). Mounted once above the routes, so a
// client-side move between public pages counts its own PageView.

const COOKIE_SETTINGS_EVENT = 'talyvor:cookie-settings'

export function MetaPixel() {
  const { pathname } = useLocation()
  const live = META_DATASET_ID !== '' && isPublicPath(pathname)
  const [consent, setConsent] = useState(readConsent)
  const [open, setOpen] = useState(() => readConsent() === null)
  const started = useRef(false)
  const signupOpen = useRef(false)

  useEffect(() => {
    // A client-side move into the app (the legal pages' "Back to Talyvor") would keep the pixel and this document's
    // public-page security policy: load the app afresh instead.
    if (started.current && !isPublicPath(pathname)) return window.location.reload()
    if (!live || consent !== 'accepted') return
    if (!started.current) {
      started.current = startPixel(META_DATASET_ID)
      // B51.1 — a click to create a workspace is a Lead only while sign-up is open; the BFF says whether it is.
      if (started.current) {
        fetch('/auth/me', { headers: { Accept: 'application/json' } })
          .then((r) => (r.ok ? r.json() : null))
          .then((me) => (signupOpen.current = signupStateOf(me) === 'open'))
          .catch(() => {})
      }
    }
    if (started.current) track('PageView')
  }, [live, consent, pathname])

  useEffect(() => {
    const lead = () => started.current && track('Lead') // no parameters: nothing typed reaches Meta
    // Get started and Create your workspace both go to /signup.
    const click = (e: MouseEvent) =>
      signupOpen.current && e.target instanceof Element && e.target.closest('a[href="/signup"]') && lead()
    const reopen = () => setOpen(true)
    window.addEventListener(WAITLIST_JOINED_EVENT, lead)
    window.addEventListener(COOKIE_SETTINGS_EVENT, reopen)
    document.addEventListener('click', click, true)
    return () => {
      window.removeEventListener(WAITLIST_JOINED_EVENT, lead)
      window.removeEventListener(COOKIE_SETTINGS_EVENT, reopen)
      document.removeEventListener('click', click, true)
    }
  }, [])

  function choose(choice: Consent) {
    writeConsent(choice)
    setOpen(false)
    if (choice === 'rejected' && started.current) {
      // Withdrawn after Accept: tell Meta, then reload so the page runs without the pixel.
      revokePixel()
      window.location.reload()
      return
    }
    setConsent(choice)
  }

  if (!live || !open) return null
  return (
    // B57.59: Pocket's white card, floating over the page's foot; Accept and Reject drawn alike.
    <div role="dialog" aria-label="Cookies" data-design="pocket" className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-3xl">
      <Card tone="white" className="flex flex-wrap items-center gap-3">
        <p className="min-w-0 flex-1 basis-64 text-reading text-ink">
          We use one advertising cookie, Meta’s, to measure our ads. Only if you accept.
        </p>
        <div className="flex items-center gap-2.5">
          <Button variant="secondary" onClick={() => choose('accepted')}>
            Accept
          </Button>
          <Button variant="secondary" onClick={() => choose('rejected')}>
            Reject
          </Button>
          {/* Closing it counts as Reject. */}
          <CloseX onClose={() => choose('rejected')} />
        </div>
      </Card>
    </div>
  )
}

/** "Cookie settings" for a public footer: reopens the banner. Nothing while the pixel is off or off the public pages. */
export function CookieSettingsLink() {
  if (META_DATASET_ID === '' || !isPublicPath(window.location.pathname)) return null
  return (
    <button
      type="button"
      className={`font-semibold text-ink-2 ${pocketFocusRing}`}
      onClick={() => window.dispatchEvent(new Event(COOKIE_SETTINGS_EVENT))}
    >
      Cookie settings
    </button>
  )
}
