/**
 * Pocket's focus ring (B57.4): 3px of tangerine at 2px offset, on keyboard focus only. Today's `focusRing`
 * (lib/focus.ts) stays on today's components until each screen moves to these.
 */
export const pocketFocusRing =
  'outline-none focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-tangerine'
