import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PageBackground, Shell, agentHues, businessHues, personalHues, pocketFocusRing } from '../pocket'
import { pocket } from '../tokens'

// B61.70 — Pocket Live's background (design/pocket-live/DESIGN.md section 6): still with reduced motion, nothing drawn
// while the tab is hidden, about 30 frames a second, never a press, and the account's or the agent's colours.

let frames: FrameRequestCallback[] = []
let paints = 0
let reduce = false

const flush = (now: number) => {
  const due = frames
  frames = []
  act(() => due.forEach((f) => f(now)))
}

const setHidden = (hidden: boolean) => Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })

beforeEach(() => {
  frames = []
  paints = 0
  reduce = false
  setHidden(false)
  vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => frames.push(f))
  vi.stubGlobal('cancelAnimationFrame', () => {})
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: reduce && q.includes('reduce'), addEventListener() {}, removeEventListener() {} }))
  const gradient = { addColorStop() {} }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () =>
      ({
        setTransform() {},
        clearRect: () => void paints++,
        createLinearGradient: () => gradient,
        createRadialGradient: () => gradient,
        beginPath() {},
        moveTo() {},
        bezierCurveTo() {},
        stroke() {},
        fillRect() {},
        // B61.129 — the opening clips the streams as they draw in, and a pulse runs along them.
        save() {},
        restore() {},
        rect() {},
        clip() {},
        lineTo() {},
      }) as never,
  )
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  setHidden(false)
})

describe('the background (B61.70)', () => {
  it('is hidden from assistive technology, and takes no press', () => {
    const { container } = render(<PageBackground hues={personalHues} />)
    const bg = container.querySelector('[data-background="streams"]')!
    expect(bg.getAttribute('aria-hidden')).toBe('true')
    expect(bg.querySelectorAll('canvas')).toHaveLength(1)
    const css = readFileSync(resolve(import.meta.dirname, '../theme.css'), 'utf8')
    expect(css).toMatch(/\.pk-bg \{[^}]*pointer-events: none;/)
  })

  it('runs at about 30 frames a second while the tab shows', () => {
    render(<PageBackground hues={personalHues} />)
    for (const t of [1000, 1016, 1033, 1050, 1066, 1083, 1100]) flush(t)
    expect(paints).toBe(4)
    expect(frames).toHaveLength(1)
  })

  it('with reduced motion, draws one still frame and asks for no more', () => {
    reduce = true
    render(<PageBackground hues={personalHues} />)
    expect(paints).toBe(1)
    expect(frames).toHaveLength(0)
    const css = readFileSync(resolve(import.meta.dirname, '../theme.css'), 'utf8')
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.pk-bg-tint i, \.pk-bg-satin::before \{ animation: none !important; \}/)
  })

  it('draws nothing while the tab is hidden, and starts again when it shows', () => {
    setHidden(true)
    render(<PageBackground hues={personalHues} />)
    flush(1000)
    expect(paints).toBe(0)
    expect(frames).toHaveLength(0)
    setHidden(false)
    act(() => void document.dispatchEvent(new Event('visibilitychange')))
    flush(1100)
    expect(paints).toBe(1)
    setHidden(true)
    act(() => void document.dispatchEvent(new Event('visibilitychange')))
    flush(1200)
    expect(paints).toBe(1)
    expect(frames).toHaveLength(0)
  })

  it('wears the account’s two colours, or the agent’s own', () => {
    expect(personalHues).toEqual([pocket.light.tangerine, pocket.light['agent-cobalt']])
    expect(businessHues).toEqual([pocket.light['agent-cobalt'], pocket.light['agent-mint']])
    expect(agentHues({ id: 'agt_1', colour: 'orchid' })).toEqual([pocket.light['agent-orchid'], pocket.light['agent-orchid']])
    const { container } = render(<PageBackground hues={businessHues} />)
    const bg = container.querySelector<HTMLElement>('[data-background="streams"]')!
    expect([bg.style.getPropertyValue('--h1'), bg.style.getPropertyValue('--h2')]).toEqual([...businessHues])
  })
})

// B61.125 — Pocket Live's 26 Nov pass (DESIGN.md section 6.0): the colour fills the whole window. One glass, drawn once
// by the Shell behind the sidebar, the top bar and every page; it does not scroll and does not fade; five washes.
describe('the glass across the whole window (B61.125)', () => {
  const css = readFileSync(resolve(import.meta.dirname, '../theme.css'), 'utf8')
  const rule = (selector: string) => css.match(new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`))?.[1] ?? ''

  it('is drawn once for the window by the Shell, hidden from assistive technology, behind the sidebar', () => {
    const { container } = render(
      <div data-design="pocket">
        <Shell sidebar={<a href="/" className={pocketFocusRing}>Home</a>} bar={<span>Bar</span>} background={<PageBackground hues={personalHues} />}>
          <p>Page</p>
        </Shell>
      </div>,
    )
    const glass = container.querySelectorAll('[data-glass]')
    expect(glass).toHaveLength(1)
    expect(glass[0]!.closest('[aria-hidden="true"]')).not.toBeNull()
    expect(glass[0]!.querySelectorAll('.pk-bg-tint i')).toHaveLength(5)
    // The frosted tokens reach the sidebar as well as the page, and the sidebar is raised over the window's glass.
    expect(container.firstElementChild!.firstElementChild).toHaveClass('pk-glass')
    expect(container.querySelector('aside')).toHaveClass('pk-side-glass', 'wide:relative', 'wide:z-10')
  })

  it('fills the window edge to edge, with no fade, and stays put while the page scrolls', () => {
    const glass = rule('.pk-bg-glass')
    expect(glass).toMatch(/position: fixed; inset: 0;/)
    expect(glass).not.toMatch(/mask-image|height: 70vh/)
    expect(rule('.pk-bg')).not.toMatch(/70vh|--bg-scroll/)
    // Only the streams fade to 40% and lift 24 px.
    expect(rule('.pk-bg-streams')).toMatch(/--bg-scroll, 0\) \* \.6/)
    expect(css).toMatch(/--bg-wash: 46%;\s*--bg-veil: 16%;/)
    expect(css).toMatch(/--bg-wash: 32%;\s*--bg-veil: 12%;/)
  })

  // B17.566 — sign-in and sign-up draw the background themselves, so their frame holds the glass tokens; its own colour
  // under the glass was cloud at 66% white, not Pocket's cloud. The cards on it stay glass.
  it('a page that draws the background itself keeps the solid cloud under it', () => {
    expect(css).toMatch(/:root,\n\[data-theme\] \{[^}]*--cloud-solid: var\(--cloud\);/)
    expect(rule(':has(> .pk-bg).bg-cloud')).toMatch(/background-color: var\(--cloud-solid\);/)
    expect(rule(':is(.pk-glass, :has(> .pk-bg))')).not.toMatch(/--cloud-solid/)
  })
})
