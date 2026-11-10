import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { App, CONSOLE_ROUTES, ROUTE_PATHS } from './App'
import { CLAUDE_CONNECTOR_PATH, DOCUMENTATION_PATH } from './areas/documentation/content'
import { POCKET_PENDING, designOf, inPocket } from './pocketPending'

// B57.3 — the list of routes still in today's design, where today's rules still apply.
describe('pocketPending.ts', () => {
  it('names only routes the app has, so an entry cannot outlive its page', () => {
    for (const path of POCKET_PENDING) expect([...ROUTE_PATHS, '*'], path).toContain(path)
  })

  it('ROUTE_PATHS is every route App.tsx declares: the public <Route>s, CONSOLE_ROUTES and /earnings', () => {
    const app = readFileSync(resolve(import.meta.dirname, 'App.tsx'), 'utf8')
    const outer = app.slice(app.indexOf('export function App()'))
    const named: Record<string, string> = { DOCUMENTATION_PATH, CLAUDE_CONNECTOR_PATH }
    const declared = Array.from(outer.matchAll(/<Route path=(?:"([^"]+)"|\{(\w+)\})/g)).map((m) => m[1] ?? named[m[2]])
    const inShell = Array.from(app.matchAll(/<Route path="([^"]+)" element=\{<EarningsMoved/g)).map((m) => m[1])
    expect([...ROUTE_PATHS].sort()).toEqual([...declared.filter((p) => p !== '/*'), ...CONSOLE_ROUTES.map((r) => r.path), ...inShell].sort())
  })

  it('has no entry twice', () => {
    expect(new Set(POCKET_PENDING).size).toBe(POCKET_PENDING.length)
  })

  it('holds a pending address to today’s design and any other to Pocket’s', () => {
    const routes = ['/', '/agents', '/docs/*', '/docs/s/:token']
    expect(designOf('/agents', routes, ['/agents', '*'])).toBe('today')
    expect(designOf('/', routes, ['/agents', '*'])).toBe('pocket')
    expect(designOf('/docs/s/abc', routes, ['/docs/*'])).toBe('pocket')
    expect(designOf('/docs/spaces', routes, ['/docs/*'])).toBe('today')
  })

  it('an address with no route is the "*" page', () => {
    expect(designOf('/nowhere', ['/'], ['*'])).toBe('today')
    expect(designOf('/nowhere', ['/'], ['/'])).toBe('pocket')
  })

  it('reads the nearest marker', () => {
    const host = document.createElement('div')
    host.innerHTML = '<div data-design="pocket"><p id="a"></p><div data-design="today"><p id="b"></p></div></div><p id="c"></p>'
    expect(inPocket(host.querySelector('#a'))).toBe(true)
    expect(inPocket(host.querySelector('#b'))).toBe(false)
    expect(inPocket(host.querySelector('#c'))).toBe(false)
  })

  it('App marks every page with the design it is held to', async () => {
    // B57.63 took /privacy out of the list, so it is Pocket's; /marketing is still today's.
    for (const [path, design] of [
      ['/marketing', 'today'],
      ['/privacy', 'pocket'],
    ]) {
      window.history.pushState({}, '', path)
      const view = render(<App />)
      const heading = await screen.findByRole('heading', { level: 1 })
      expect(heading.closest('[data-design]')?.getAttribute('data-design')).toBe(design)
      view.unmount()
    }
  })
})
