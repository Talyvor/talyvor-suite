import { Button, Mark, ThemeToggle, Wordmark, focusRing, inlineLink } from '@talyvor/ui'
import { CompanyLine } from './CompanyLine'
import { CookieSettingsLink } from '../areas/marketing/MetaPixel'
import { FOOTER_LINE } from '../positioning'
import { COMPANY_CONTACT } from '../company'

// B29.13 — the logo header and the footer the public reading pages share: /documentation, /privacy,
// /terms and a published board. The header is Pricing's: the drawn mark and wordmark with the product
// under them in eyebrow caps, the page links, the theme toggle and the one way into the app. The
// footer is Landing's: the mark beside the company's line on the surface plane, the links, and the
// registered details.
//
// B51.1 — the public pages (/marketing, /pricing, /documentation, /documentation/claude, /privacy,
// /terms) wear ONE header and ONE footer: PublicHeader and PublicFooter below, with nothing under
// the wordmark. The `product` eyebrow stays for the shared reading pages (a board, a chat, an invoice).

export interface SiteLink {
  href: string
  label: string
}

/** The frame's width, as a whole class so Tailwind's extractor sees it. */
type Width = 'max-w-5xl' | 'max-w-6xl'

export function SiteHeader({
  product,
  links = [],
  current,
  width = 'max-w-5xl',
  getStarted = false,
}: {
  product?: string
  links?: SiteLink[]
  current?: string
  width?: Width
  /** The way in for a stranger, beside Open the app. */
  getStarted?: boolean
}) {
  return (
    // Sticky only from 840px up, and the text links step out below it (the footer carries them):
    // on a phone a pinned two-row bar eats the screen.
    <header className="border-b border-rule bg-canvas wide:sticky wide:top-0 wide:z-20">
      <div className={`mx-auto flex w-full ${width} flex-wrap items-center justify-between gap-y-2 px-gutter py-3`}>
        <a href="/marketing" className={`flex items-center gap-2.5 ${focusRing}`}>
          <Mark size={26} aria-hidden />
          <div className="min-w-0">
            <Wordmark height={12} />
            {product ? <div className="mt-1 text-eyebrow uppercase leading-tight text-label">{product}</div> : null}
          </div>
        </a>
        <div className="flex items-center gap-3">
          {links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              aria-current={l.href === current ? 'page' : undefined}
              className={`hidden text-body wide:inline ${l.href === current ? 'text-ink' : 'text-muted'} ${inlineLink}`}
            >
              {l.label}
            </a>
          ))}
          <ThemeToggle />
          <Button asChild>
            <a href="/">Open the app</a>
          </Button>
          {getStarted ? (
            <Button asChild variant="primary">
              <a href="/signup">Get started</a>
            </Button>
          ) : null}
        </div>
      </div>
    </header>
  )
}

export function SiteFooter({
  links,
  width = 'max-w-5xl',
  contact = false,
}: {
  links: SiteLink[]
  width?: Width
  /** The company's address after the links. */
  contact?: boolean
}) {
  return (
    <footer className="border-t border-rule bg-surface">
      <div className={`mx-auto flex w-full ${width} flex-wrap items-center justify-between gap-3 px-gutter py-6`}>
        <div className="flex items-center gap-2.5">
          <Mark size={20} aria-hidden />
          <div className="font-figure text-eyebrow uppercase text-faint">{FOOTER_LINE}</div>
        </div>
        <div className="text-caption text-faint">
          {links.map((l, i) => (
            <span key={l.href}>
              {i > 0 ? ' · ' : null}
              <a href={l.href} className={inlineLink}>
                {l.label}
              </a>
            </span>
          ))}
          <CookieSettingsLink />
          {contact ? (
            <>
              {' · '}
              <a href={`mailto:${COMPANY_CONTACT}`} className={`font-mono ${inlineLink}`}>
                {COMPANY_CONTACT}
              </a>
            </>
          ) : null}
        </div>
      </div>
      <div className={`mx-auto w-full ${width} px-gutter pb-6`}>
        <CompanyLine />
      </div>
    </footer>
  )
}

const PUBLIC_HEADER_LINKS: SiteLink[] = [
  { href: '/pricing', label: 'Pricing' },
  { href: '/documentation', label: 'Documentation' },
]
const PUBLIC_FOOTER_LINKS: SiteLink[] = [
  { href: '/privacy', label: 'Privacy' },
  { href: '/terms', label: 'Terms' },
  ...PUBLIC_HEADER_LINKS,
]

/** The one header of every public page (B51.1). */
export function PublicHeader({ current, width }: { current?: string; width?: Width }) {
  return <SiteHeader links={PUBLIC_HEADER_LINKS} current={current} width={width} getStarted />
}

/** The one footer of every public page (B51.1). */
export function PublicFooter({ width }: { width?: Width }) {
  return <SiteFooter links={PUBLIC_FOOTER_LINKS} width={width} contact />
}
