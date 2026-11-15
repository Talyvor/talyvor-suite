// @talyvor/ui — the Talyvor design system.
// The invariant: text is never a hue. See README §The invariant.
export * from './components'
export { cn } from './lib/cn'
export { formatDay } from './lib/format'
export { focusRing } from './lib/focus'
export { inlineLink } from './lib/link'
export { useTheme } from './lib/theme'
export type { Theme, ThemeChoice } from './lib/theme'
export { tokens } from './tokens'
export type { TokenName } from './tokens'
export {
  AA_BODY,
  POCKET_ROLES_ON_PLANE,
  ROLES_ON_PLANE,
  TEXT_PLANES,
  TEXT_ROLES,
  isTextPlane,
  isTextRole,
  permits,
  pocketName,
  pocketPermits,
  ratio,
  worstRatio,
} from './planes'
export type { PocketPlane, TextPlane, TextRole } from './planes'
export { default as preset } from './preset'
