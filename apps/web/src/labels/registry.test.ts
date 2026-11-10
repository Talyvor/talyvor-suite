import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import building from './building.json'

// B56.9 — the Building registry holds to BUILD.md, and StatusLabel is the only thing that draws Live, Sandbox or
// Building as a chip (B46.1 and B46.2 reversed for it and nothing else).

const WEB_SRC = join(__dirname, '..')
const UI_SRC = join(__dirname, '../../../../packages/ui/src')

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : sources(path)
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
  })
}

// A chip drawing one of the three words outside StatusLabel: the words as a chip's own text, a chip handed the
// status, or pocket.css's .status class copied.
const CHIP_WORDS = [
  /<(Chip|Pill|Badge|span)\b[^>]*>\s*(Live|Sandbox|Building)\s*<\//,
  /<(Chip|Pill|Badge)\b[^>]*\bstatus=\{?\s*["'](live|sandbox|building)["']/i,
  /\bstatus (live|sandbox|building)\b/,
]

describe('the Building registry', () => {
  it('names each key once, with the feature in words and its BUILD.md item', () => {
    const entries = building as { key?: unknown; feature?: unknown; item?: unknown }[]
    const seen = new Set<string>()
    for (const e of entries) {
      expect(typeof e.key === 'string' && /^[a-z0-9_]+$/.test(e.key), `key ${String(e.key)}`).toBe(true)
      expect(seen.has(e.key as string), `${String(e.key)} is in building.json twice`).toBe(false)
      seen.add(e.key as string)
      expect(typeof e.feature === 'string' && e.feature.trim() !== '', `${String(e.key)} has no feature`).toBe(true)
      expect(typeof e.item === 'string' && /^B\d+\.\d+$/.test(e.item), `${String(e.key)} has no item as BUILD.md writes it`).toBe(true)
    }
  })

  it('has every Building key StatusLabel is asked for', () => {
    const keys = new Set((building as { key: string }[]).map((e) => e.key))
    const missing: string[] = []
    for (const file of sources(WEB_SRC))
      for (const m of readFileSync(file, 'utf8').matchAll(/<StatusLabel\b[^>]*\bbuilding=\{?\s*["']([^"']+)["']/g))
        if (!keys.has(m[1])) missing.push(`${relative(WEB_SRC, file)} asks for ${m[1]}`)
    expect(missing).toEqual([])
  })
})

describe('StatusLabel is the only label', () => {
  it('catches each way of drawing one', () => {
    for (const drawn of ['<Chip tone="good">Live</Chip>', '<Chip status="sandbox" />', '<span className="status building">'])
      expect(CHIP_WORDS.some((re) => re.test(drawn)), drawn).toBe(true)
  })

  it('finds no Live, Sandbox or Building chip outside StatusLabel', () => {
    const drawn: string[] = []
    for (const file of [...sources(WEB_SRC), ...sources(UI_SRC)]) {
      if (file === join(__dirname, 'StatusLabel.tsx')) continue
      const text = readFileSync(file, 'utf8')
      for (const re of CHIP_WORDS) if (re.test(text)) drawn.push(`${file}: ${re}`)
    }
    expect(drawn).toEqual([])
  })
})
