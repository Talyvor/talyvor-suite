import { describe, expect, it } from 'vitest'

import { pixelContrastProblems, type TextLine } from './pocketCheck'

// B61.98 — the contrast check on the real pixels that `pocket:shots <item> --pixels` runs over the moving background:
// pictures painted by hand here, as the browser's screenshots are there.

const W = 40
const H = 10

/** A W×H picture, every pixel `at(x, y)`. */
function picture(at: (x: number, y: number) => [number, number, number]): Uint8ClampedArray {
  const px = new Uint8ClampedArray(W * H * 4)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      px.set([...at(x, y), 255], (y * W + x) * 4)
    }
  return px
}

const WHITE: [number, number, number] = [255, 255, 255]
/** Light ink-3 and ink-2 (theme.css). */
const INK_3: TextLine['fg'] = [0x64, 0x6b, 0x7b, 1]
const INK_2: TextLine['fg'] = [0x4a, 0x50, 0x61, 1]
const line = (fg: TextLine['fg'], large = false): TextLine => ({ name: 'p “Each agent spends its own money”', x: 0, y: 0, w: W, h: H, fg, large })
/** The glyphs: a few dark pixels, so the drawn picture differs from the bare one. */
const drawnOver = (bare: Uint8ClampedArray) => {
  const d = bare.slice()
  d.set([0, 0, 0, 255], (5 * W + 5) * 4)
  return d
}

describe('the contrast check on the real pixels', () => {
  it('passes ink-3 on the white page, and fails it where a wash sits behind half the line, saying where', () => {
    const page = picture(() => WHITE)
    expect(pixelContrastProblems([line(INK_3)], page, drawnOver(page), W, H)).toEqual([])
    // The cobalt wash's tint the light page shows at its strongest, behind the right half of the line.
    const washed = picture((x) => (x >= W / 2 ? [0xbe, 0xc6, 0xe2] : WHITE))
    expect(pixelContrastProblems([line(INK_3)], washed, drawnOver(washed), W, H)).toEqual([
      'text at 3.15:1 over the background (needs 4.5): p “Each agent spends its own money” (#646B7B on #BEC6E2)',
    ])
    // ink-2 reads over the same wash.
    expect(pixelContrastProblems([line(INK_2)], washed, drawnOver(washed), W, H)).toEqual([])
  })

  it('holds large text to 3:1', () => {
    const washed = picture(() => [0xbe, 0xc6, 0xe2])
    expect(pixelContrastProblems([line(INK_3, true)], washed, drawnOver(washed), W, H)).toEqual([])
  })

  it('passes by a line something else is drawn over: no pixel of it differs with the text drawn clear', () => {
    const washed = picture(() => [0xbe, 0xc6, 0xe2])
    expect(pixelContrastProblems([line(INK_3)], washed, washed, W, H)).toEqual([])
  })
})
