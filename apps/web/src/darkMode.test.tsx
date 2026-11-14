import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { useTheme } from '@talyvor/ui'
import { Switch } from '@talyvor/ui/pocket'
import postcss from 'postcss'
import tailwind from 'tailwindcss'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import tailwindConfig from '../tailwind.config'
import { App, queryClient } from './App'
import { populatedBff, settleQueries } from './populatedBff'
import { contrastProblems } from './test/pocketCheck'
import { pressAll } from './test/pressEverything'

// B57.58 — dark mode, everywhere. pocket-shots --dark runs contrastProblems on every route in a real browser; these
// are the parts a test can hold without one.

afterEach(() => {
  cleanup()
  queryClient.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
  document.documentElement.setAttribute('data-theme', 'light')
})

async function open(route: string) {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  populatedBff((impl) => vi.spyOn(globalThis, 'fetch').mockImplementation(impl))
  window.history.pushState({}, '', route)
  render(createElement(App))
  await settleQueries(queryClient, waitFor)
}

describe('Settings is the one theme control', () => {
  it.each(['/signin', '/signup'])('%s has no theme switch in its top bar', async (route) => {
    await open(route)
    await screen.findByRole('main')
    expect(screen.queryByRole('button', { name: /Switch to (dark|light) theme/ })).not.toBeInTheDocument()
  })
})

describe('the heading size is not a colour', () => {
  it('text-page sets the size and leaves the colour to text-ink', async () => {
    const css = await postcss([
      tailwind({
        ...tailwindConfig,
        content: [{ raw: '<h2 class="text-page text-ink"></h2>', extension: 'html' }],
      } as never),
    ]).process('@tailwind utilities;', { from: undefined })
    const props: string[] = []
    postcss.parse(css.css).walkRules('.text-page', (rule) => {
      rule.walkDecls((d) => {
        props.push(d.prop)
      })
    })
    expect(props).toContain('font-size')
    expect(props).not.toContain('color')
  })
})

describe('the contrast check', () => {
  /** The check on a specimen, cleared away before the page audits in test-setup read the body: specimens are not screens. */
  function check(html: string): string[] {
    document.body.innerHTML = html
    try {
      return contrastProblems(document)
    } finally {
      document.body.innerHTML = ''
    }
  }
  const PAGE = 'background-color: rgb(15, 16, 19)'

  it('passes Pocket’s dark text pairs and a field ringed in the control grey', () => {
    expect(
      check(`<main style="${PAGE}">
          <p style="color: rgb(242, 243, 245)">Good morning</p>
          <p style="color: rgb(138, 144, 160)">ink-3 on the page</p>
          <div style="background-color: rgb(24, 26, 31)"><span style="color: rgb(166, 172, 185)">ink-2 on the cloud</span></div>
          <span style="box-shadow: rgb(110, 116, 130) 0px 0px 0px 1.5px inset; background-color: rgb(15, 16, 19)"><input aria-label="Amount" style="background-color: rgb(15, 16, 19)"></span>
        </main>`),
    ).toEqual([])
  })

  it('fails on text painted the page’s own colour, and on a field whose edge is the line', () => {
    expect(
      check(`<main style="${PAGE}">
          <h2 style="color: rgb(15, 16, 19)">Your budgets</h2>
          <select aria-label="Currency" style="border: 1px solid rgb(42, 46, 54); background-color: rgb(15, 16, 19)"><option>USD</option></select>
        </main>`),
    ).toEqual(['text at 1.00:1: h2 “Your budgets” (#0F1013 on #0F1013)', "a control's edge at 1.40:1: select “USD” (#2A2E36 on #0F1013)"])
  })

  it('passes by a picture’s words and a disabled control’s', () => {
    expect(
      check(`<main style="${PAGE}">
          <div role="img" aria-label="Research, agent card" style="background-color: rgb(17, 18, 22)"><div style="color: rgb(17, 18, 22)">Research</div></div>
          <button disabled style="color: rgb(40, 40, 40)">Send</button>
        </main>`),
    ).toEqual([])
  })
})

describe('the switch in dark', () => {
  it('has a white knob off and an on-primary one on, which is ink in the dark theme', () => {
    const { container } = render(
      createElement(
        'div',
        { 'data-design': 'pocket' },
        createElement(Switch, { 'aria-label': 'Off' }),
        createElement(Switch, { 'aria-label': 'On', defaultChecked: true }),
      ),
    )
    const [off, on] = Array.from(container.querySelectorAll('[role="switch"] > span'))
    expect(off.className).toContain('bg-knob')
    expect(on.getAttribute('data-state')).toBe('checked')
    expect(on.className).toContain('data-[state=checked]:bg-on-primary')
    const theme = readFileSync(resolve(import.meta.dirname, '../../../packages/ui/src/theme.css'), 'utf8')
    expect(theme).toMatch(/\[data-theme\] \{\s*--knob: #FFFFFF;/)
    expect(theme).toMatch(/\[data-theme='dark'\] \{[^}]*--on-primary: #111216;/)
  })
})

describe('Same as this device', () => {
  it('follows the device while chosen, and stops when a theme is chosen', async () => {
    const listeners: ((e: { matches: boolean }) => void)[] = []
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: false,
      media: q,
      addEventListener: (_: string, f: (e: { matches: boolean }) => void) => listeners.push(f),
    }))
    vi.resetModules()
    const { useTheme } = await import('../../../packages/ui/src/lib/theme')
    useTheme.getState().choose('device')
    listeners.forEach((f) => f({ matches: true }))
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(useTheme.getState().theme).toBe('dark')
    useTheme.getState().choose('light')
    listeners.forEach((f) => f({ matches: true }))
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })
})

describe('pressEverything in dark', () => {
  it('finds on Settings in dark exactly what it finds in light', async () => {
    // Each fresh render starts from the theme under test and nothing else stored: Appearance's and Show amounts in's
    // own tabs change what is stored, and the store outlives a render.
    const run = (theme: 'light' | 'dark') => {
      vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
      const { asked } = populatedBff((impl) => vi.spyOn(globalThis, 'fetch').mockImplementation(impl))
      return pressAll(
        async () => {
          window.localStorage.clear()
          useTheme.getState().setTheme(theme)
          queryClient.clear()
          window.history.pushState({}, '', '/settings')
          render(createElement(App))
          await settleQueries(queryClient, waitFor)
        },
        () => asked.length,
      )
    }
    const light = await run('light')
    vi.restoreAllMocks()
    const dark = await run('dark')
    expect(document.documentElement.getAttribute('data-theme')).not.toBeNull()
    expect(dark.pressed).toBeGreaterThan(0)
    expect(dark).toEqual(light)
  }, 60_000)
})
