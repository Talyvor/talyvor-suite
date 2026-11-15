import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ROUTE_PATHS } from '../../App'
import { CAPABILITIES, DOCUMENTATION_PATH, START } from './content'

// B61.38 — the Help chat answers only from Talyvor's own help pages: /documentation's claims (content.ts) and the
// facts file beside them (help-facts.md). The BFF embeds both as apps/bff/help_pages.json, so this test is what keeps
// the BFF's copy the app's words. Run with HELP_PAGES_WRITE=1 to write it after changing either.

const HERE = import.meta.dirname
const JSON_PATH = resolve(HERE, '../../../../bff/help_pages.json')

interface HelpPage {
  path: string
  name: string
  lines: string[]
}

function helpPages(): HelpPage[] {
  const pages: HelpPage[] = []
  const at = (path: string, name: string) => {
    let p = pages.find((x) => x.path === path && (path !== '' || x.name === name))
    if (!p) pages.push((p = { path, name, lines: [] }))
    return p
  }
  for (const c of [...START, ...CAPABILITIES.flatMap((cap) => cap.claims)]) {
    const path = c.href.startsWith('#') ? DOCUMENTATION_PATH : c.href
    if (!path.startsWith('/')) continue
    at(path, c.href.startsWith('#') ? 'Documentation' : c.label.split(':')[0]).lines.push(c.text)
  }
  let page: HelpPage | undefined
  for (const line of readFileSync(resolve(HERE, 'help-facts.md'), 'utf8').replace(/<!--[\s\S]*?-->/g, '').split('\n')) {
    const head = /^## (\S*) ?· (.+)$/.exec(line)
    if (head) page = at(head[1], head[2])
    else if (line.startsWith('- ') && page) page.lines.push(line.slice(2))
  }
  return pages
}

describe('the Help chat’s pages', () => {
  it('are apps/bff/help_pages.json, and every page they name is one the app mounts', () => {
    const pages = helpPages()
    const want = `${JSON.stringify({ pages }, null, 2)}\n`
    if (process.env.HELP_PAGES_WRITE === '1') writeFileSync(JSON_PATH, want)
    expect(readFileSync(JSON_PATH, 'utf8')).toBe(want)
    for (const p of pages) if (p.path !== '') expect(ROUTE_PATHS, p.path).toContain(p.path)
    expect(pages.find((p) => p.path === '/settings/help')?.lines.length).toBeGreaterThan(0)
  })
})
