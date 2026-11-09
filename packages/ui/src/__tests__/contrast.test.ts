import { describe, expect, it } from 'vitest'
import { contrastRatio } from '../lib/contrast'
import { pocket, tokens, type PocketName } from '../tokens'
import { AA_BODY, TEXT_PLANES, TEXT_ROLES as PLANE_TEXT_ROLES, permits, ratio } from '../planes'

/**
 * THE PALETTE, MEASURED — Pocket's contrast table (B57.2).
 *
 * Every row of the reference's "Contrast, computed from the stylesheet" table (design/pocket
 * index.html, #system), in its own words, scored from tokens.ts: 4.5:1 for text, 3:1 for control
 * edges, focus rings and faces. A name is a Pocket token, read in the row's theme; a #hex is a
 * colour the reference draws outside the tokens (the ink hero, the wallpaper). The published
 * ratio is asserted too, so a token that drifts from the table moves a number and goes red even
 * while it still clears its floor.
 */
type Colour = PocketName | `#${string}`
type Row = readonly [pair: string, fg: Colour, bg: Colour, published: number, needs: 4.5 | 3]

const THEMED: Record<'light' | 'dark', readonly Row[]> = {
  light: [
    ['Body text', 'ink', 'page', 18.72, 4.5],
    ['Secondary text', 'ink-2', 'page', 8.04, 4.5],
    ['Small grey text', 'ink-3', 'page', 5.34, 4.5],
    ['Small grey text on a card', 'ink-3', 'cloud', 4.85, 4.5],
    ['Grey text on a chip', 'ink-3', 'cloud-2', 4.6, 4.5],
    ['Orange words', 'tangerine-ink', 'page', 6.14, 4.5],
    ['Waiting chip', 'tangerine-ink', 'tangerine-50', 5.55, 4.5],
    ['Money in', 'success', 'page', 5.41, 4.5],
    ['Good chip', 'success', 'success-50', 4.84, 4.5],
    ['Bad chip', 'danger', 'danger-50', 5.17, 4.5],
    ['Primary button', 'on-primary', 'primary', 18.72, 4.5],
    ['Input and toggle edges', 'control', 'page', 3.9, 3],
    ['Focus ring', 'ink', 'page', 18.72, 3],
    ['Focus ring on a card', 'ink', 'cloud', 17.01, 3],
  ],
  dark: [
    ['Body text', 'ink', 'page', 17.14, 4.5],
    ['Secondary text', 'ink-2', 'page', 8.36, 4.5],
    ['Small grey text', 'ink-3', 'page', 5.96, 4.5],
    ['Small grey text on a card', 'ink-3', 'cloud', 5.45, 4.5],
    ['Grey text on a chip', 'ink-3', 'cloud-2', 4.93, 4.5],
    ['Orange words', 'tangerine-ink', 'page', 8.09, 4.5],
    ['Waiting chip', 'tangerine-ink', 'tangerine-50', 6.19, 4.5],
    ['Money in', 'success', 'page', 10.14, 4.5],
    ['Good chip', 'success', 'success-50', 8.22, 4.5],
    ['Bad chip', 'danger', 'danger-50', 5.93, 4.5],
    ['Primary button', 'on-primary', 'primary', 16.86, 4.5],
    ['Input and toggle edges', 'control', 'page', 4.06, 3],
    ['Focus ring', 'ink', 'page', 17.14, 3],
    ['Focus ring on a card', 'ink', 'cloud', 15.68, 3],
  ],
}

/** The "Both" rows: the same pair in either theme. */
const BOTH: readonly Row[] = [
  ['Ink on tangerine', '#111216', 'tangerine', 7.18, 4.5],
  ['Text on the ink hero', '#F2F3F5', '#111216', 16.86, 4.5],
  ['Second text on the ink hero', '#C9CDD6', '#111216', 11.75, 4.5],
  ['Outline button edge on the ink hero', '#7A8192', '#111216', 4.8, 3],
  ['Focus ring on the ink hero and the lock screen', '#F2F3F5', '#111216', 16.86, 3],
  ['Focus ring on the home-screen wallpaper, at its lightest', '#F2F3F5', '#4B3A5E', 9.15, 3],
  ['Face on cobalt', '#FFFFFF', 'agent-cobalt', 5.17, 3],
  ['Face on orchid', '#111216', 'agent-orchid', 5.32, 3],
  ['Face on sky', '#111216', 'agent-sky', 9.21, 3],
  ['Face on mint', '#111216', 'agent-mint', 8.62, 3],
  ['Face on lemon', '#111216', 'agent-lemon', 13.13, 3],
  ['Face on rose', '#111216', 'agent-rose', 6.37, 3],
  ['Face on lime', '#111216', 'agent-lime', 11.14, 3],
]

describe('the instrument, before it measures anything', () => {
  // Published WCAG values. If these drift, every assertion below is decoration.
  it('black on white is 21:1', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5)
  })
  it('white on white is 1:1', () => {
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5)
  })
  it('#767676 on white is 4.54:1 — the canonical smallest passing grey', () => {
    expect(contrastRatio('#767676', '#FFFFFF')).toBeCloseTo(4.54, 2)
  })
  it('the ratio is symmetric', () => {
    expect(contrastRatio('#3AD6C0', '#060A12')).toBeCloseTo(contrastRatio('#060A12', '#3AD6C0'), 10)
  })
  it('a translucent foreground is composited, not read as opaque', () => {
    // 50% white over black composites to #808080-ish, nowhere near white's 21:1.
    const composited = contrastRatio('rgba(255,255,255,.5)', '#000000')
    expect(composited).toBeLessThan(21)
    expect(composited).toBeGreaterThan(1)
  })
  it('a colour form it cannot read throws rather than scoring as a pass', () => {
    expect(() => contrastRatio('hsl(180 50% 50%)', '#FFFFFF')).toThrow(/unreadable/)
  })
})

for (const theme of ['light', 'dark'] as const) {
  const value = (c: Colour) => (c.startsWith('#') ? c : pocket[theme][c as PocketName])
  describe(`${theme}: every pair in Pocket's contrast table`, () => {
    for (const [pair, fg, bg, published, needs] of [...THEMED[theme], ...BOTH]) {
      it(`${pair}: ${fg} on ${bg} needs ${needs}:1 and measures ${published}:1`, () => {
        const r = contrastRatio(value(fg), value(bg))
        const note = `${pair} (${value(fg)} on ${value(bg)}) = ${r.toFixed(2)}:1`
        expect(r, note).toBeGreaterThanOrEqual(needs)
        expect(Math.round(r * 100) / 100, `${note}, the reference publishes ${published}:1`).toBeCloseTo(published, 2)
      })
    }
  })
}

describe('the table covers both themes alike', () => {
  it('light and dark score the same pairs', () => {
    expect(THEMED.dark.map((r) => r.slice(0, 3))).toEqual(THEMED.light.map((r) => r.slice(0, 3)))
  })
})

/**
 * THE PLANES, TOTAL — every role asked about every plane, in both directions.
 *
 * ── TODAY'S NAMES, STILL SCORED ─────────────────────────────────────────────────────────────
 *
 * The table above scores Pocket's names. Screens not yet redrawn still paint with today's names,
 * which tokens.ts keeps as aliases onto Pocket's values; planes.ts says which of those text roles
 * each of those planes permits, and this asks every role about every plane.
 *
 * ── WHY THE REFUSALS ARE CHECKED TOO ─────────────────────────────────────────────────────────
 *
 * `ROLES_ON_PLANE` says which roles a plane permits, so a role can be left off a plane. Left
 * unchecked that is an exemption list, and an exemption list absorbs every future failure
 * silently. So a refusal must be a FACT: a pair that is refused has to MEASURE below the floor in
 * at least one theme. Widen the palette until `faint` clears the tint and this file fails until
 * somebody widens the classification to match — which is the direction that keeps it honest.
 *
 * ⚠ THE SET OF PLANES IS PINNED FROM THE DOM, NOT HERE. This file has no product to look at;
 * `apps/web/src/planeAudit.ts` scores what actually renders and reports a plane nobody classified.
 * Neither half can produce the other's answer, which is why both exist.
 */
describe('the tint is a plane, so every role is asked about it', () => {
  it('every plane in the classification is a real token', () => {
    const phantom = TEXT_PLANES.filter((p) => !(p in tokens.light))
    expect(phantom, `plane names a non-token: ${phantom.join(', ')}`).toEqual([])
  })

  for (const plane of TEXT_PLANES) {
    for (const role of PLANE_TEXT_ROLES) {
      const allowed = permits(plane, role)
      it(`${role} on ${plane} — ${allowed ? 'permitted, so it must clear AA body' : 'refused, so it must MEASURE below it'}`, () => {
        const light = ratio('light', role, plane)
        const dark = ratio('dark', role, plane)
        const note = `${role} on ${plane} = ${light.toFixed(2)}:1 light, ${dark.toFixed(2)}:1 dark`
        if (allowed) {
          expect(Math.min(light, dark), note).toBeGreaterThanOrEqual(AA_BODY)
        } else {
          // A refusal is a measurement, never a preference — see the header.
          expect(Math.min(light, dark), `${note} — this pair PASSES; refusing it is a preference`)
            .toBeLessThan(AA_BODY)
        }
      })
    }
  }
})
