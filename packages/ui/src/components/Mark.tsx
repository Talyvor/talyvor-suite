// B57.6 — the logo's symbol and the app icon, each the kit's own drawing for its size (design/logo/talyvor-logo,
// copied unchanged into apps/web/public/brand/logo). Below 48 px the symbol is not drawn: use the app icon.
import { cn } from '../lib/cn'
import { LOGO_DIR, ThemedImg } from './Wordmark'

/** The symbol: its full drawing from 120 px wide, the small one from 48 to 120. */
export function symbolFile(width: number) {
  return width >= 120 ? 'talyvor-symbol' : 'talyvor-symbol-small'
}

/** The app icon: the full drawing from 120 px, the small from 48, the 32 px drawing from 20, the 16 px below. */
export function appIconFile(size: number) {
  if (size >= 120) return 'talyvor-app-icon-rounded.svg'
  if (size >= 48) return 'talyvor-favicon-small.svg'
  if (size >= 20) return 'talyvor-favicon-tiny.svg'
  return 'talyvor-favicon-pico.svg'
}

export interface LogoSymbolProps {
  /** Width in px, 48 or more; the height follows the drawing's 1312:944. */
  width?: number
  className?: string
}

/** The streams and arrow without the name. */
export function LogoSymbol({ width = 48, className }: LogoSymbolProps) {
  const w = Math.max(48, width)
  return (
    <span className={cn('inline-block shrink-0 leading-none', className)} data-brand="symbol">
      <ThemedImg file={symbolFile(w)} width={w} height={Math.round(((w * 944) / 1312) * 10) / 10} />
    </span>
  )
}

export interface AppIconProps {
  /** Edge in px. */
  size?: number
  className?: string
  /** Decorative beside a name that already says Talyvor. */
  'aria-hidden'?: boolean
}

/** The rounded app icon, the same in both themes: it carries its own ink tile. */
export function AppIcon({ size = 24, className, 'aria-hidden': hidden }: AppIconProps) {
  return (
    <img
      src={`${LOGO_DIR}/${appIconFile(size)}`}
      alt={hidden ? '' : 'Talyvor'}
      width={size}
      height={size}
      decoding="async"
      data-brand="app-icon"
      className={cn('block shrink-0', className)}
    />
  )
}
