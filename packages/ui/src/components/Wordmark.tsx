// B57.6 — the Talyvor logo Nick chose on 4 Nov 2026, from the kit in design/logo/talyvor-logo: its own SVG
// files, copied unchanged into apps/web/public/brand/logo and shown as <img>, never redrawn or recoloured. Both
// versions are in the page and theme.css shows the one for the nearest data-theme (--logo-on-light,
// --logo-on-dark), so the on-light file never sits on a dark background or the reverse.
import { cn } from '../lib/cn'

export const LOGO_DIR = '/brand/logo'

/** The kit's sizes: the full logo from 240 px wide, its small drawing from 120 to 240, never below 120. */
export function logoFile(width: number) {
  return width >= 240 ? 'talyvor-logo' : 'talyvor-logo-small'
}

// The kit's README: clear space of half the arrow's height on every side. The arrow is 336 units tall in the
// drawing's 2963.51 by 944 frame (build/logo.py's CHEVRON), so half of it is 168.
const LOGO_VIEW = { w: 2963.51, h: 944 }
const HALF_ARROW = 168

/** Both versions of one kit drawing; theme.css shows the nearest theme's. */
export function ThemedImg({ file, width, height }: { file: string; width: number; height: number }) {
  return (
    <>
      {(['light', 'dark'] as const).map((v) => (
        <img
          key={v}
          src={`${LOGO_DIR}/${file}-on-${v}.svg`}
          alt="Talyvor"
          width={width}
          height={height}
          decoding="async"
          data-brand="logo"
          style={{ display: `var(--logo-on-${v})`, width, height }}
        />
      ))}
    </>
  )
}

export interface LogoProps {
  /** Width in px, 120 or more; the height follows the drawing. */
  width?: number
  className?: string
}

/** The full logo, its streams, arrow and drawn name, with the kit's clear space around it. */
export function Logo({ width = 144, className }: LogoProps) {
  const w = Math.max(120, width)
  const h = Math.round(((w * LOGO_VIEW.h) / LOGO_VIEW.w) * 10) / 10
  const clear = Math.ceil((w * HALF_ARROW) / LOGO_VIEW.w)
  return (
    <span className={cn('inline-block shrink-0 leading-none', className)} style={{ padding: clear }} data-brand="lockup">
      <ThemedImg file={logoFile(w)} width={w} height={h} />
    </span>
  )
}
