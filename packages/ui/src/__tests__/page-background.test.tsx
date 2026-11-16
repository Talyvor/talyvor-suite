import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PageBackground, agentHues, businessHues, personalHues } from '../pocket'
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
