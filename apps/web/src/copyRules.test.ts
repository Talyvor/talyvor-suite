import { readFileSync, readdirSync } from 'node:fs'
import { relative, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { COPY_PENDING } from './copyPending'
import { FORBIDDEN, copyHits, htmlHits, shippedModules } from './copyRules'

// B56.25 — every string the web app ships follows the copy rules, apart from the files copyPending.ts still lists.
const SRC = import.meta.dirname
// @talyvor/ui is drawn on the same screens; its components are read whole, apart from its tests.
const UI = resolve(SRC, '../../../packages/ui/src')
const uiModules = (readdirSync(UI, { recursive: true }) as string[])
  .filter((f) => /\.tsx?$/.test(f) && !/(^|\/)__tests__\/|\.(test|stories)\.tsx?$/.test(f))
  .map((f) => resolve(UI, f))

describe('copyHits', () => {
  it('fails on a dash in JSX text, in a prop and in a toast, and on a lone dash for an empty value', () => {
    const source = [
      'export const A = () => <p>Paid once a month — never from credits</p>',
      'export const B = () => <input placeholder="Search – all" aria-label="Find" />',
      "export const C = () => toast.show('Saved — done')",
      "export const D = (v?: string) => v ?? '—'",
    ].join('\n')
    expect(copyHits(source, 'x.tsx').map((h) => [h.line, h.rule])).toEqual([
      [1, 'dash'],
      [2, 'dash'],
      [3, 'dash'],
      [4, 'dash'],
    ])
  })

  it.each(FORBIDDEN.map(([word]) => word))('fails on "%s" in JSX text and in a prop', (word) => {
    const said = word === '100% of' ? '100% of every sale' : word
    const source = `export const A = () => <p>${said}</p>\nexport const B = () => <img alt="${said}" />`
    expect(copyHits(source, 'x.tsx').map((h) => h.rule)).toEqual([word, word])
  })

  it('reads template literals and leaves comments and import paths alone', () => {
    const source = [
      "import a from './a—b'",
      '// a comment — never shown',
      'export const t = (n: number) => `${n} items — ${n} left`',
    ].join('\n')
    expect(copyHits(source, 'x.ts')).toEqual([{ line: 3, rule: 'dash', text: 'items —' }])
  })

  it('fails on a dash in index.html outside a comment', () => {
    expect(htmlHits('<!-- a — b -->\n<title>Talyvor — x</title>').map((h) => h.line)).toEqual([2])
  })
})

describe('the shipped app', () => {
  const shipped = shippedModules(SRC)

  it('reaches the screens from main.tsx and no test', () => {
    expect(shipped).toContain('App.tsx')
    expect(shipped).toContain('areas/chat/Chat.tsx')
    expect(shipped.filter((f) => /\.test\.tsx?$/.test(f))).toEqual([])
    expect(uiModules.map((f) => relative(UI, f))).toContain('components/RevealOnce.tsx')
  })

  it('breaks no copy rule outside the files copyPending.ts lists, in the app or in @talyvor/ui', () => {
    const broken: string[] = []
    for (const file of shipped) {
      if (file in COPY_PENDING) continue
      for (const h of copyHits(readFileSync(resolve(SRC, file), 'utf8'), file))
        broken.push(`${file}:${h.line} ${h.rule}: ${h.text.slice(0, 80)}`)
    }
    for (const path of uiModules)
      for (const h of copyHits(readFileSync(path, 'utf8'), path))
        broken.push(`packages/ui/src/${relative(UI, path)}:${h.line} ${h.rule}: ${h.text.slice(0, 80)}`)
    for (const h of htmlHits(readFileSync(resolve(SRC, '../index.html'), 'utf8')))
      broken.push(`index.html:${h.line} ${h.rule}: ${h.text.slice(0, 80)}`)
    expect(broken).toEqual([])
  })

  it('copyPending.ts names only shipped files that still break a rule, so the list only shrinks', () => {
    const stale = Object.keys(COPY_PENDING).filter(
      (file) => !shipped.includes(file) || copyHits(readFileSync(resolve(SRC, file), 'utf8'), file).length === 0,
    )
    expect(stale).toEqual([])
  })
})
