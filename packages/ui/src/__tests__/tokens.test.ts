import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { aliases, pocket } from '../tokens'

const css = readFileSync(resolve(import.meta.dirname, '../theme.css'), 'utf8')
const strip = (s: string) => s.replace(/\s+/g, '')

function blockText(marker: string): string {
  const start = css.indexOf(marker)
  expect(start, `theme.css has no block ${marker}`).toBeGreaterThanOrEqual(0)
  const open = css.indexOf('{', start)
  const close = css.indexOf('}', open)
  return css.slice(open + 1, close)
}

function vars(block: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of block.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = strip(m[2])
  return out
}

// tokens.ts is the source of truth; theme.css mirrors it. Both directions: every token appears
// with its exact value, and no block carries a var without a token.
describe('tokens ↔ theme.css do not drift', () => {
  const blocks = {
    light: vars(blockText("[data-theme='light'] {")),
    dark: vars(blockText("[data-theme='dark'] {")),
  }
  for (const theme of ['light', 'dark'] as const) {
    for (const [name, value] of Object.entries(pocket[theme])) {
      it(`${theme}: --${name} = ${value}`, () => {
        expect(blocks[theme][name], `--${name} missing/changed in the ${theme} block`).toBe(strip(value))
      })
    }
    it(`${theme}: theme.css carries no var beyond Pocket's tokens`, () => {
      const extra = Object.keys(blocks[theme]).filter((name) => !(name in pocket[theme]))
      expect(extra, `stale vars in ${theme} block: ${extra.join(', ')}`).toEqual([])
    })
  }

  // The aliases resolve on every themed element, so a dark subtree reads dark values through them.
  const aliasBlock = vars(blockText('[data-theme] {'))
  it('every alias is declared as var() onto its Pocket token, and nothing else is', () => {
    const want = Object.fromEntries(Object.entries(aliases).map(([a, t]) => [a, `var(--${t})`]))
    expect(aliasBlock).toEqual(want)
  })
  it('the alias block is scoped to :root and every [data-theme]', () => {
    expect(css).toMatch(/:root,\s*\[data-theme\] \{/)
  })
})
