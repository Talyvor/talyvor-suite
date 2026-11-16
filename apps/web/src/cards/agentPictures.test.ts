// B61.102 — the gallery an agent's picture is chosen from: Lens's list in Lens's order (economy.AgentPictures, B61.101),
// each picture in the colour Lens draws it, and each of the twenty served as a 1536 × 968 WebP with a PNG for a browser
// without WebP, both under 300 KB like the website's card faces. A file without an entry, or an entry without its file,
// is a picture that cannot be drawn.
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AGENT_PICTURES, NEW_PICTURES, lookFor } from './agentPictures'

const DIR = resolve(__dirname, '../../public/agent-pictures')

/** A WebP's size, from its VP8 (lossy), VP8L (lossless) or VP8X (extended) chunk. */
function webpSize(b: Buffer): { width: number; height: number } {
  expect(b.toString('ascii', 0, 4)).toBe('RIFF')
  expect(b.toString('ascii', 8, 12)).toBe('WEBP')
  const chunk = b.toString('ascii', 12, 16)
  if (chunk === 'VP8 ') return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff }
  if (chunk === 'VP8L') {
    const bits = b.readUInt32LE(21)
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
  }
  return { width: b.readUIntLE(24, 3) + 1, height: b.readUIntLE(27, 3) + 1 }
}

describe('the agent pictures (B61.102)', () => {
  it('offers 27, as Lens lists them: the six helpers under their colours, lime, then the twenty, each in its colour', () => {
    expect(AGENT_PICTURES.map((p) => `${p.id}:${p.colour}`)).toEqual([
      'cobalt:cobalt', 'orchid:orchid', 'mint:mint', 'lemon:lemon', 'sky:sky', 'rose:rose', 'lime:lime',
      'shopper:lime', 'grocer:mint', 'bills:sky', 'saver:rose', 'coder:cobalt', 'designer:orchid', 'writer:lemon',
      'social:rose', 'recruiter:sky', 'legal:cobalt', 'analyst:mint', 'events:orchid', 'chef:lemon', 'coach:lime',
      'home:rose', 'driver:sky', 'tutor:cobalt', 'musician:orchid', 'photographer:lemon', 'gardener:lime',
    ])
  })

  it('sends one of the twenty as its picture, and a helper or lime as its colour, as before', () => {
    expect(lookFor(AGENT_PICTURES.find((p) => p.id === 'chef')!)).toEqual({ picture: 'chef' })
    expect(lookFor(AGENT_PICTURES.find((p) => p.id === 'cobalt')!)).toEqual({ colour: 'cobalt' })
    expect(lookFor(AGENT_PICTURES.find((p) => p.id === 'lime')!)).toEqual({ colour: 'lime' })
  })

  it('gives every one of the twenty its two files, and every file an entry', () => {
    expect(readdirSync(DIR).sort()).toEqual(NEW_PICTURES.flatMap((p) => [`${p.id}.png`, `${p.id}.webp`]).sort())
  })

  it.each(NEW_PICTURES.map((p) => [p.id]))('%s is a 1536 × 968 WebP and a PNG, each under 300 KB', (id) => {
    const webp = readFileSync(resolve(DIR, `${id}.webp`))
    const png = readFileSync(resolve(DIR, `${id}.png`))
    expect(webpSize(webp)).toEqual({ width: 1536, height: 968 })
    expect(png.toString('ascii', 1, 4)).toBe('PNG')
    // the PNG's width and height, from its IHDR: half the WebP's, for the browser that cannot read a WebP
    expect({ width: png.readUInt32BE(16), height: png.readUInt32BE(20) }).toEqual({ width: 768, height: 484 })
    expect(webp.length).toBeLessThan(300 * 1024)
    expect(png.length).toBeLessThan(300 * 1024)
  })
})
