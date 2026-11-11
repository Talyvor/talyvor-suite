// B57.120 — the 15 approved card artworks (design/talyvor-cards-final/art, Nick, 10 Nov 2026) are served under
// /cards, file names unchanged, and one typed manifest names each of them. A file without an entry, or an entry
// without its file, is a card that cannot be drawn.
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { cardArt, cardFaces } from './cardArt'

const DIR = resolve(__dirname, '../../public/cards')

/** A JPEG's size from its first start-of-frame marker (SOF0 to SOF15, less DHT, JPG and DAC). */
function jpegSize(buf: Buffer): { width: number; height: number } {
  let i = 2
  while (i < buf.length) {
    const marker = buf[i + 1]
    const len = buf.readUInt16BE(i + 2)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) }
    }
    i += 2 + len
  }
  throw new Error('no start-of-frame marker')
}

/** WCAG 2.2 relative luminance and contrast ratio, for #RRGGBB. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((o) => {
    const c = parseInt(hex.slice(o, o + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

describe('card art and its manifest (B57.120)', () => {
  it('has all 15 cards: three personal, three corporate, three stablecoin and six helpers', () => {
    expect(cardArt.map((c) => c.id)).toEqual([
      'daily', 'premium', 'platinum', 'team', 'business', 'enterprise', 'stable', 'stable-premium', 'stable-platinum',
      'agent-remy', 'agent-sunny', 'agent-penny', 'agent-max', 'agent-nova', 'agent-ollie',
    ])
  })

  it('gives every entry its file and every file an entry', () => {
    const files = readdirSync(DIR).sort()
    expect(cardArt.map((c) => c.art.replace('/cards/', '')).sort()).toEqual(files)
  })

  it.each(cardArt.map((c) => [c.id, c.art]))('%s is 1536 × 968', (_, art) => {
    expect(jpegSize(readFileSync(resolve(DIR, art.replace('/cards/', ''))))).toEqual({ width: 1536, height: 968 })
  })

  it('keeps every text colour at 4.5:1 or more against its scrim’s darkest stop, and every badge readable', () => {
    for (const face of Object.values(cardFaces)) {
      expect(contrast(face.ink, face.scrimStop)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(face.ink2, face.scrimStop)).toBeGreaterThanOrEqual(4.5)
    }
    for (const c of cardArt) if (c.badge) expect(contrast(c.badge.ink, c.badge.background), c.id).toBeGreaterThanOrEqual(4.5)
  })
})
