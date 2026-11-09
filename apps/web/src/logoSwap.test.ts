// B57.79 — the logo Nick chose on 4 Nov 2026 is the only logo in the web app, the website and the BFF's
// own pages. Its source SVGs and their generator live in brand/logo (the kit, as design/logo/talyvor-logo
// ships it); every logo file served is a copy of one of them, byte for byte, and today's files are gone.
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(__dirname, '../../..')
const KIT = resolve(ROOT, 'brand/logo')
const at = (...p: string[]) => resolve(ROOT, ...p)

describe('the chosen logo is the only logo (B57.79)', () => {
  it('keeps the kit: its source SVGs at every size, light and dark, and the script that makes every PNG and ICO', () => {
    for (const f of ['README.md', 'logo-colours.json', 'build/export.py', 'build/logo.py', 'build/render.js', 'build/web.sh']) {
      expect(existsSync(resolve(KIT, f)), f).toBe(true)
    }
    const svgs = readdirSync(resolve(KIT, 'svg'))
    for (const name of ['logo', 'logo-small', 'symbol', 'symbol-small', 'wordmark']) {
      for (const v of ['on-light', 'on-dark']) expect(svgs, `${name} ${v}`).toContain(`talyvor-${name}-${v}.svg`)
    }
    for (const f of ['talyvor-app-icon.svg', 'talyvor-app-icon-rounded.svg', 'talyvor-favicon-small.svg', 'talyvor-favicon-tiny.svg', 'talyvor-favicon-pico.svg', 'favicon.svg']) {
      expect(svgs).toContain(f)
    }
  })

  it('serves only the kit’s SVGs, byte for byte, in the web app and on the BFF’s pages', () => {
    const copies = [
      ...readdirSync(at('apps/web/public/brand/logo')).map((f) => `apps/web/public/brand/logo/${f}`),
      ...readdirSync(at('apps/bff/brand')).map((f) => `apps/bff/brand/${f}`),
      'apps/web/public/favicon.svg',
    ]
    expect(copies.length).toBeGreaterThanOrEqual(15)
    for (const copy of copies) {
      const source = resolve(KIT, 'svg', copy.split('/').pop()!)
      expect(existsSync(source), `${copy} is not a kit file`).toBe(true)
      expect(readFileSync(at(copy)).equals(readFileSync(source)), copy).toBe(true)
    }
  })

  it('has no trace of today’s logo: none of its files, and no path that names one', () => {
    const files = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n')
    const old = /^(docs\/brand\/|apps\/web\/public\/brand\/svg\/(talyvor-|favicon)|apps\/bff\/brand\/talyvor-mark-)/
    expect(files.filter((f) => old.test(f))).toEqual([])
    let named = ''
    try {
      named = execFileSync(
        'git',
        ['grep', '-lE', 'talyvor-mark-|-notag\\.svg|brand/svg/(talyvor-|favicon)|docs/brand/|wordmark-(obsidian|white)|-lockup-(dark|light)', '--',
          '.', ':!apps/web/src/logoSwap.test.ts', ':!e2e/test/fixtures'], // fixtures are recorded runs, kept as they ran
        { cwd: ROOT, encoding: 'utf8' },
      )
    } catch {
      // git grep exits 1 when nothing matches
    }
    expect(named.trim().split('\n').filter(Boolean)).toEqual([])
  })
})
