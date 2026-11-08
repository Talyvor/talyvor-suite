// Token values. Single source of truth. theme.css mirrors these into CSS variables;
// tokens.test.ts asserts the two never drift.
//
// ── WHERE THE VALUES COME FROM ───────────────────────────────────────────────────────
//
// Pocket (B57.2): the two token blocks of design/pocket/pocket.css, copied verbatim into
// brand/pocket-tokens.css. site-parity.test.ts reads that file and fails if any value here
// differs from it, in either theme. brand/tokens.json (version 5) carries the same values
// for the phone and Lens.
//
// ── THE ROLES, FROM POCKET.CSS'S HEADER ──────────────────────────────────────────────
//
// Tangerine is the brand and "your move". Ink is text and primary actions. The seven
// agent colours are identity only: an agent's face and card. Green and red are status and
// always come with words. Text is never tangerine or an agent colour (tangerine-ink is the
// one orange that may carry words).
//
// ⚠ EVERY PAIR IS MEASURED. __tests__/contrast.test.ts scores every pair in the reference's
// contrast table, both themes. Do not change a value here without running it.
export const pocket = {
  light: {
    page: '#FFFFFF', cloud: '#F3F4F6', 'cloud-2': '#ECEEF2',
    ink: '#111216', 'ink-2': '#4A5061', 'ink-3': '#646B7B',
    line: '#E4E6EB', control: '#7A8192',
    tangerine: '#FF7A1A', 'tangerine-ink': '#A84100', 'tangerine-50': '#FFF1E6',
    success: '#0B7A45', 'success-50': '#E6F6EE', danger: '#C0262D', 'danger-50': '#FDECEC',
    primary: '#111216', 'on-primary': '#FFFFFF',
    shadow: '0 1px 2px rgba(17, 18, 22, .06), 0 10px 28px rgba(17, 18, 22, .07)',
    'shadow-lg': '0 2px 6px rgba(17, 18, 22, .08), 0 24px 60px rgba(17, 18, 22, .14)',
    scrim: 'rgba(17, 18, 22, .42)',
    'agent-cobalt': '#2F5BFF', 'agent-orchid': '#B65CFF', 'agent-sky': '#39C2FF', 'agent-mint': '#16C79A',
    'agent-lemon': '#FFD43B', 'agent-rose': '#FF5C8A', 'agent-lime': '#8EDC4E',
  },
  dark: {
    page: '#0F1013', cloud: '#181A1F', 'cloud-2': '#20232A',
    ink: '#F2F3F5', 'ink-2': '#A6ACB9', 'ink-3': '#8A90A0',
    line: '#2A2E36', control: '#6E7482',
    tangerine: '#FF7A1A', 'tangerine-ink': '#FF8A33', 'tangerine-50': '#3A2414',
    success: '#3DD68C', 'success-50': '#12291E', danger: '#FF6B6B', 'danger-50': '#331717',
    primary: '#F2F3F5', 'on-primary': '#111216',
    shadow: '0 1px 2px rgba(0, 0, 0, .4), 0 10px 28px rgba(0, 0, 0, .35)',
    'shadow-lg': '0 2px 6px rgba(0, 0, 0, .5), 0 24px 60px rgba(0, 0, 0, .55)',
    scrim: 'rgba(0, 0, 0, .6)',
    // pocket.css declares the agent colours once, on .pk; .pk-dark inherits them.
    'agent-cobalt': '#2F5BFF', 'agent-orchid': '#B65CFF', 'agent-sky': '#39C2FF', 'agent-mint': '#16C79A',
    'agent-lemon': '#FFD43B', 'agent-rose': '#FF5C8A', 'agent-lime': '#8EDC4E',
  },
} as const

export type PocketName = keyof typeof pocket.light

/**
 * Today's names, kept as aliases onto Pocket's values so screens not yet redrawn keep working.
 * theme.css writes each as `--alias: var(--target)`. B57.88 fails while any alias is used.
 */
export const aliases = {
  canvas: 'page', surface: 'page', raised: 'page', sidebar: 'cloud',
  rule: 'line', 'rule-strong': 'control',
  muted: 'ink-2', faint: 'ink-3', label: 'ink-3',
  accent: 'primary', 'accent-hover': 'ink-2', 'accent-ink': 'on-primary', 'accent-tint': 'cloud-2', 'accent-strong': 'primary',
  lens: 'ink-2', lxc: 'ink-2', tier1: 'ink-2', tier3: 'tangerine-ink',
  settled: 'success', held: 'tangerine-ink', slashed: 'danger',
} as const satisfies Record<string, PocketName>

export type AliasName = keyof typeof aliases
export type TokenName = PocketName | AliasName

function resolved(theme: Record<PocketName, string>): Record<TokenName, string> {
  const out: Record<string, string> = { ...theme }
  for (const [alias, target] of Object.entries(aliases)) out[alias] = theme[target]
  return out as Record<TokenName, string>
}

/** Every name a screen may use, Pocket's and the aliases, with its value in each theme. */
export const tokens = { light: resolved(pocket.light), dark: resolved(pocket.dark) }
