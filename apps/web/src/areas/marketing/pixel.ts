// B44.2 — the Meta pixel on talyvor.com's public pages, only after the visitor accepts. PageView on each public page
// view and Lead on a waitlist sign-up or, while sign-up is open, a click to create a workspace; never advanced matching, never a parameter that could carry what someone typed.

/** Nicolai's Meta dataset ID (B44.3). Empty: no banner, no request to Meta, ever. */
export const META_DATASET_ID: string = ''

export const FBEVENTS_URL = 'https://connect.facebook.net/en_US/fbevents.js'
export const CONSENT_KEY = 'talyvor.consent.v1'

export type Consent = 'accepted' | 'rejected'

/** The public pages (B44 section). Never /auth/*, never "/", never a signed-in page. */
export function isPublicPath(path: string): boolean {
  return (
    ['/pricing', '/signup', '/privacy', '/terms'].includes(path) ||
    ['/marketing', '/documentation'].some((p) => path === p || path.startsWith(p + '/'))
  )
}

export function readConsent(): Consent | null {
  try {
    const choice = (JSON.parse(localStorage.getItem(CONSENT_KEY) ?? 'null') as { choice?: unknown } | null)?.choice
    return choice === 'accepted' || choice === 'rejected' ? choice : null
  } catch {
    return null
  }
}

export function writeConsent(choice: Consent) {
  localStorage.setItem(CONSENT_KEY, JSON.stringify({ choice, date: new Date().toISOString() }))
}

type Fbq = ((...args: unknown[]) => void) & { queue?: unknown[][]; callMethod?: (...args: unknown[]) => void }

declare global {
  interface Window {
    fbq?: Fbq
    _fbq?: Fbq
  }
}

/**
 * Meta's base code, as a module rather than an inline script so the page's script hashes do not change: a queue
 * fbevents.js drains once it loads. Refuses outside the public pages.
 */
export function startPixel(datasetId: string): boolean {
  if (!datasetId || !isPublicPath(window.location.pathname)) return false
  if (!window.fbq) {
    const fbq: Fbq = (...args) => (fbq.callMethod ? fbq.callMethod(...args) : fbq.queue?.push(args))
    Object.assign(fbq, { push: fbq, loaded: true, version: '2.0', queue: [] })
    window.fbq = window._fbq = fbq
    const s = document.createElement('script')
    s.async = true
    s.src = FBEVENTS_URL
    document.head.appendChild(s)
  }
  window.fbq('consent', 'grant')
  window.fbq('set', 'autoConfig', false, datasetId) // Meta must not collect clicks or page metadata on its own
  window.fbq('init', datasetId) // no advanced matching: no email, phone, name or external id
  return true
}

export function track(event: 'PageView' | 'Lead') {
  window.fbq?.('track', event)
}

export function revokePixel() {
  window.fbq?.('consent', 'revoke')
}
