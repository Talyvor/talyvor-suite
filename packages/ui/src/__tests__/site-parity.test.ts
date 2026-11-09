import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { pocket, type PocketName } from '../tokens'

/**
 * POCKET, MADE AUDITABLE (B57.2).
 *
 * The console speaks Pocket, the design Nick approved on 1 Nov 2026. Its two token blocks ship
 * beside this package as brand/pocket-tokens.css, copied verbatim from design/pocket/pocket.css,
 * and this file READS them, so the reference is a check rather than a paraphrase:
 *
 *   · tokens.ts carries every Pocket token, with pocket.css's value, in both themes, and no other;
 *   · theme.css, the stylesheet the build ships, declares the same values;
 *   · brand/tokens.json (version 5, for the phone and Lens) carries the same values.
 *
 * pocket.css names its tokens `--pk-<name>` and its agent colours `--a-<colour>`; here they are
 * `<name>` and `agent-<colour>`. Its agent colours sit on .pk alone, so .pk-dark inherits them.
 */
const ui = resolve(import.meta.dirname, '../..')
const reference = readFileSync(resolve(ui, 'brand/pocket-tokens.css'), 'utf8')
const themeCss = readFileSync(resolve(ui, 'src/theme.css'), 'utf8')
const brand = JSON.parse(readFileSync(resolve(ui, 'brand/tokens.json'), 'utf8')) as {
  version: number
  color: { tokens: { name: string; value: { light: string; dark: string } }[] }
}

const norm = (v: string) => v.replace(/\s+/g, ' ').trim()

function block(css: string, selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`)
  expect(start, `no ${selector} block`).toBeGreaterThanOrEqual(0)
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start))
  return Object.fromEntries([...body.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], norm(m[2])]))
}

function pocketNames(vars: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(vars)) {
    if (k === 'pk-display' || k === 'pk-ui') continue // the type stacks; typeface.test.tsx holds those
    if (k.startsWith('pk-')) out[k.slice(3)] = v
    else if (k.startsWith('a-')) out[`agent-${k.slice(2)}`] = v
    else throw new Error(`pocket.css token with an unknown prefix: --${k}`)
  }
  return out
}

const light = pocketNames(block(reference, '.pk, .pk-light'))
const agents = Object.fromEntries(Object.entries(light).filter(([k]) => k.startsWith('agent-')))
const ref = { light, dark: { ...agents, ...pocketNames(block(reference, '.pk-dark')) } }

describe('the reference is read, not assumed', () => {
  it('pocket.css yields every token the item names, in both themes', () => {
    for (const theme of ['light', 'dark'] as const) {
      expect(Object.keys(ref[theme]).length, `${theme}`).toBe(27)
      expect(ref[theme].tangerine).toBe('#FF7A1A')
    }
  })
})

for (const theme of ['light', 'dark'] as const) {
  describe(`${theme}: tokens.ts is pocket.css`, () => {
    it('the same names, no more and no fewer', () => {
      expect(Object.keys(pocket[theme]).sort()).toEqual(Object.keys(ref[theme]).sort())
    })
    for (const [name, value] of Object.entries(ref[theme])) {
      it(`${name} is ${value}`, () => {
        expect(norm(pocket[theme][name as PocketName])).toBe(value)
      })
    }
  })

  describe(`${theme}: the shipped stylesheet is pocket.css`, () => {
    const shipped = block(themeCss, theme === 'light' ? ":root,\n[data-theme='light']" : "[data-theme='dark']")
    for (const [name, value] of Object.entries(ref[theme])) {
      it(`theme.css --${name} is ${value}`, () => {
        expect(shipped[name]).toBe(value)
      })
    }
  })
}

describe('brand/tokens.json is Pocket, version 5', () => {
  it('is version 5', () => {
    expect(brand.version).toBe(5)
  })
  it('carries every Pocket token with pocket.css values, light and dark, and nothing else', () => {
    const got = Object.fromEntries(brand.color.tokens.map((t) => [t.name, { light: t.value.light, dark: t.value.dark }]))
    const want = Object.fromEntries(Object.keys(ref.light).map((n) => [n, { light: ref.light[n], dark: ref.dark[n] }]))
    expect(got).toEqual(want)
  })
})
