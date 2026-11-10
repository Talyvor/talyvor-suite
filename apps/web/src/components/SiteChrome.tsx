import { Logo } from '@talyvor/ui'
import { Button, Eyebrow, pocketFocusRing } from '@talyvor/ui/pocket'
import { CompanyLine } from './CompanyLine'
import { CookieSettingsLink } from '../areas/marketing/MetaPixel'
import { FOOTER_LINE } from '../positioning'
import { COMPANY_CONTACT } from '../company'

export interface SiteLink {
  href: string
  label: string
}

/** The frame's width, as a whole class so Tailwind's extractor sees it. */
type Width = 'max-w-5xl' | 'max-w-6xl'

// B57.59 — Pocket's header and footer (design/pocket s-home, s-pricing, s-board): one header and one footer
// on every public page, held to Pocket's rules (data-design) while the pages between them wait their turn.
// The header is the logo home, then the site's links or, on a page shared by link, the product's name, then
// Open the app. The footer is the same everywhere. B57.62 adds Your money to both, after Pricing.
const HEADER_LINKS: SiteLink[] = [
  { href: '/marketing', label: 'How it works' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/your-money', label: 'Your money' },
  { href: '/documentation', label: 'Docs' },
]
const FOOTER_LINKS: SiteLink[] = [
  { href: '/pricing', label: 'Pricing' },
  { href: '/your-money', label: 'Your money' },
  { href: '/documentation', label: 'Docs' },
  { href: '/privacy', label: 'Privacy' },
  { href: '/terms', label: 'Terms' },
]

export function SiteHeader({
  product,
  current,
  width = 'max-w-5xl',
}: {
  /** A page shared by link names its product here instead of the site's links. */
  product?: string
  current?: string
  width?: Width
}) {
  return (
    // Sticky only from 840px up, and the text links step out below it (the footer carries them):
    // on a phone a pinned two-row bar eats the screen.
    <header data-design="pocket" className="bg-page wide:sticky wide:top-0 wide:z-20">
      <div className={`mx-auto flex w-full ${width} items-center justify-between gap-6 px-gutter py-2`}>
        <a href="/marketing" aria-label="Talyvor, home" className={`shrink-0 ${pocketFocusRing}`}>
          <Logo width={168} />
        </a>
        {product ? (
          <Eyebrow>{product}</Eyebrow>
        ) : (
          <nav aria-label="Talyvor" className="hidden items-center gap-6 wide:flex">
            {HEADER_LINKS.map((l) => (
              <a
                key={l.label}
                href={l.href}
                aria-current={l.href === current ? 'page' : undefined}
                className={`text-body font-semibold ${l.href === current ? 'text-ink' : 'text-ink-2'} ${pocketFocusRing}`}
              >
                {l.label}
              </a>
            ))}
          </nav>
        )}
        <Button asChild variant="outline" size="sm">
          <a href="/">Open the app</a>
        </Button>
      </div>
    </header>
  )
}

export function SiteFooter({ width = 'max-w-5xl' }: { width?: Width }) {
  return (
    <footer data-design="pocket" className="mt-12 border-t border-line bg-page">
      <div className={`mx-auto flex w-full ${width} flex-wrap items-start justify-between gap-6 px-gutter pb-12 pt-10`}>
        <div className="min-w-0 max-w-lg">
          <Logo width={150} />
          <p className="mt-2 text-body text-ink">{FOOTER_LINE}</p>
          <CompanyLine className="mt-2" />
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-body">
          {FOOTER_LINKS.map((l) => (
            <a key={l.href} href={l.href} className={`font-semibold text-ink-2 ${pocketFocusRing}`}>
              {l.label}
            </a>
          ))}
          <a href={`mailto:${COMPANY_CONTACT}`} className={`font-semibold text-ink-2 ${pocketFocusRing}`}>
            {COMPANY_CONTACT}
          </a>
          <CookieSettingsLink />
        </div>
      </div>
    </footer>
  )
}

/** The one header of every public page (B51.1). */
export function PublicHeader({ current, width }: { current?: string; width?: Width }) {
  return <SiteHeader current={current} width={width} />
}

/** The one footer of every public page (B51.1). */
export function PublicFooter({ width }: { width?: Width }) {
  return <SiteFooter width={width} />
}
