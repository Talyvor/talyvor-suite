import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  Button,
  FX_MS,
  Money,
  MoneyCountUp,
  MoneyProvider,
  PageBackground,
  Shell,
  burst,
  moneyMoved,
  onStreamsCue,
  personalHues,
  resetOpeningForTest,
  useDoneTick,
  useFrost,
  useOpening,
} from '../pocket'

// B61.129 — Pocket Live's special openings, transitions and buttons on the web (DESIGN.md section 15). With reduced motion
// none of them starts; the tick follows the answer and never holds up the request; a paused account's streams are still.

let reduce = false
let animate: ReturnType<typeof vi.fn>

beforeEach(() => {
  reduce = false
  resetOpeningForTest()
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: reduce && q.includes('reduce'), addEventListener() {}, removeEventListener() {} }))
  vi.stubGlobal('requestAnimationFrame', () => 1)
  vi.stubGlobal('cancelAnimationFrame', () => {})
  animate = vi.fn(() => ({ finished: new Promise(() => {}) }))
  Object.defineProperty(Element.prototype, 'animate', { value: animate, configurable: true, writable: true })
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 100, height: 60, right: 100, bottom: 60, x: 0, y: 0, toJSON() {} })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => new Proxy({}, { get: () => () => ({ addColorStop() {} }) }) as never)
})

afterEach(() => {
  cleanup()
  document.querySelectorAll('[data-fx]').forEach((el) => el.remove())
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  delete (Element.prototype as { animate?: unknown }).animate
})

/** Pocket's own page, as the app draws it: the audits score Pocket's names there. */
const pocket = (ui: React.ReactNode) => <div data-design="pocket">{ui}</div>

/** jsdom's pointer events carry no coordinates, so a mouse event stands in, under the pointer event's name. */
const pointer = (el: Element, type: string) => fireEvent(el, new MouseEvent(type, { bubbles: true, clientX: 20, clientY: 10 }))

const figures = { useFigures: () => ({ ulxc: () => null, minor: (m: number) => `$${(m / 100).toFixed(2)}` }) }

function Home({ minor }: { minor: number }) {
  const opening = useOpening()
  return (
    <MoneyProvider {...figures}>
      <MoneyCountUp on={opening}>
        <Money minor={minor} currency="USD" />
      </MoneyCountUp>
    </MoneyProvider>
  )
}

function SmallJob({ send, close }: { send: () => Promise<void>; close: () => void }) {
  const tick = useDoneTick()
  return (
    <Button done={tick.done} onClick={() => void send().then(() => tick.finish(close))}>
      Add money
    </Button>
  )
}

function Frost({ frozen }: { frozen: boolean }) {
  const ice = useFrost(frozen)
  return frozen ? <i ref={ice} data-testid="ice" /> : null
}

function everything() {
  const cues: string[] = []
  const stop = onStreamsCue((cue) => cues.push(cue))
  const { container } = render(
    pocket(
      <Shell sidebar={<span>Side</span>} bar={<span>Bar</span>} background={<PageBackground hues={personalHues} />}>
        <Home minor={12_345} />
        <Button>Pay</Button>
        <div data-card="agent-plain" data-testid="art" />
        <Frost frozen={false} />
      </Shell>,
    ),
  )
  moneyMoved('out')
  burst()
  pointer(screen.getByRole('button', { name: 'Pay' }), 'pointerdown')
  pointer(screen.getByTestId('art'), 'pointermove')
  return { cues, stop, container }
}

describe('with reduced motion none of the effects starts (B61.129)', () => {
  it('no ring, burst, ripple, tilt, pulse, opening, count-up or frost', () => {
    reduce = true
    const { cues, stop } = everything()
    stop()
    expect(document.querySelectorAll('.pk-fx-ring, .pk-fx-burst, .pk-fx-ripple')).toHaveLength(0)
    expect(screen.getByTestId('art').style.transform).toBe('')
    expect(cues).toEqual([])
    // The figure is simply there, never rolled up from nothing.
    expect(screen.getByText('$123.45')).toBeInTheDocument()
    expect(animate).not.toHaveBeenCalled()
  })

  it('the breathing, the drawn tick and the band of light stand still in the stylesheet', () => {
    const css = readFileSync(resolve(import.meta.dirname, '../theme.css'), 'utf8')
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.pk-breathe, \.pk-done-tick, \[data-card\]::after \{ animation: none !important; \}/)
  })

  it('a small job closes its panel at once, with no tick', async () => {
    reduce = true
    const close = vi.fn()
    render(pocket(<SmallJob send={() => Promise.resolve()} close={close} />))
    fireEvent.click(screen.getByRole('button', { name: 'Add money' }))
    await act(async () => {
      await Promise.resolve()
    })
    expect(close).toHaveBeenCalledOnce()
    expect(document.querySelector('[data-done-tick]')).toBeNull()
  })
})

describe('with motion, the effects play (B61.129)', () => {
  it('money out pulses the streams and opens a ring; the app opens with the streams drawing in and the figure counting up', () => {
    const { cues, stop } = everything()
    stop()
    expect(cues).toEqual(['open', 'pulse'])
    expect(document.querySelectorAll('.pk-fx-ring')).toHaveLength(1)
    expect(document.querySelectorAll('.pk-fx-burst')).toHaveLength(1)
    expect(document.querySelectorAll('[data-ripple="main"] > .pk-fx-ripple')).toHaveLength(1)
    expect(screen.getByTestId('art').style.transform).toMatch(/^perspective\(700px\) rotateY\(-?\d/)
    // Counting up from nothing: the first frame is $0.00, with the real figure for a screen reader.
    expect(screen.getByText('$0.00')).toBeInTheDocument()
    expect(screen.getByText('$123.45')).toHaveClass('sr-only')
  })

  it('money moved inside the account pulses the streams and opens no ring', () => {
    const cues: string[] = []
    const stop = onStreamsCue((cue) => cues.push(cue))
    moneyMoved('inside')
    stop()
    expect(cues).toEqual(['pulse'])
    expect(document.querySelectorAll('.pk-fx-ring')).toHaveLength(0)
  })

  it('frost crosses a card only when it freezes', () => {
    const { rerender } = render(<Frost frozen={false} />)
    rerender(<Frost frozen />)
    expect(animate).toHaveBeenCalledOnce()
    expect(animate.mock.calls[0][1]).toMatchObject({ duration: FX_MS.frost })
  })
})

describe('the tick follows the answer and never delays the request (B61.129)', () => {
  it('sends on the press, ticks once the answer is in, and closes 430 ms later', async () => {
    vi.useFakeTimers()
    let answer!: () => void
    const send = vi.fn(() => new Promise<void>((r) => (answer = r)))
    const close = vi.fn()
    render(pocket(<SmallJob send={send} close={close} />))
    fireEvent.click(screen.getByRole('button', { name: 'Add money' }))
    // The request is out on the press, before any tick and with no time passed.
    expect(send).toHaveBeenCalledOnce()
    expect(document.querySelector('[data-done-tick]')).toBeNull()
    await act(async () => answer())
    const button = screen.getByRole('button', { name: 'Add money' })
    expect(button).toHaveAttribute('data-done')
    expect(button).toHaveAttribute('aria-disabled', 'true')
    // A second press while it ticks sends nothing.
    fireEvent.click(button)
    expect(send).toHaveBeenCalledOnce()
    expect(button.querySelector('[data-done-tick]')).not.toBeNull()
    expect(close).not.toHaveBeenCalled()
    act(() => void vi.advanceTimersByTime(FX_MS.done))
    expect(close).toHaveBeenCalledOnce()
  })
})

describe('a paused account marks the background still (B61.129)', () => {
  it('data-still while every agent is paused, and not once they work again', () => {
    const { container, rerender } = render(<PageBackground hues={personalHues} still />)
    expect(container.querySelector('[data-background="streams"]')).toHaveAttribute('data-still', 'true')
    rerender(<PageBackground hues={personalHues} />)
    expect(container.querySelector('[data-background="streams"]')).not.toHaveAttribute('data-still')
  })
})
