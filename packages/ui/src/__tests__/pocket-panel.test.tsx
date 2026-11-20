import { act, fireEvent, render as renderBare, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Button, Dialog, SnackHost, showSnack } from '../pocket'

// B61.74 — Pocket Live's moves 3 and 8 on the web (~/talyvor-queue/design/pocket-live/DESIGN.md sections 4 and 5).
const Pocket = ({ children }: { children: React.ReactNode }) => <div data-design="pocket">{children}</div>
const render = (ui: React.ReactElement) => renderBare(ui, { wrapper: Pocket })
const classes = (el: Element) => el.className.split(/\s+/)

function Payments() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Orbit Studio, 120.00
      </Button>
      <Button variant="secondary">Northwind, 40.00</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Paid Orbit Studio" position="panel" actions={<Button>Download receipt</Button>}>
        Sent on 12 Nov.
      </Dialog>
    </>
  )
}

const openRow = () => {
  const row = screen.getByRole('button', { name: 'Orbit Studio, 120.00' })
  row.focus()
  fireEvent.click(row)
  return row
}

/** A browser that plays animations, with the reader's motion setting: what jsdom has neither of. */
function browser(reduced: boolean) {
  const played: { el: Element; keyframes: Keyframe[]; opts: KeyframeAnimationOptions; finish: () => void }[] = []
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: reduced && q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} }))
  Object.defineProperty(Element.prototype, 'animate', {
    configurable: true,
    value(this: Element, keyframes: Keyframe[], opts: KeyframeAnimationOptions) {
      const on: Record<string, () => void> = {}
      const finish = () => on.finish?.()
      played.push({ el: this, keyframes, opts, finish })
      return { addEventListener: (name: string, fn: () => void) => void (on[name] = fn) } as unknown as Animation
    },
  })
  return played
}

afterEach(() => {
  vi.unstubAllGlobals()
  delete (Element.prototype as { animate?: unknown }).animate
  vi.useRealTimers()
})

describe('the right panel', () => {
  it('opens 440 wide at the right, takes focus, closes on Esc and gives focus back to the row that opened it', () => {
    render(<Payments />)
    const row = openRow()
    const panel = screen.getByRole('dialog', { name: 'Paid Orbit Studio' })
    expect(panel).toHaveAttribute('data-panel')
    expect(classes(panel)).toEqual(expect.arrayContaining(['wide:w-110', 'pk-panel', 'overflow-y-auto']))
    expect(classes(document.querySelector('[data-layer]')!)).toEqual(expect.arrayContaining(['justify-end', 'items-stretch']))
    expect(panel).toContainElement(document.activeElement as HTMLElement)
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(row).toHaveFocus()
  })

  it('slides in over 420 ms and out over 280 ms on the motion tokens, then leaves the page', () => {
    const played = browser(false)
    render(<Payments />)
    openRow()
    const panel = screen.getByRole('dialog')
    const inward = played.find((p) => p.el === panel)!
    expect(inward.opts).toEqual({ duration: 420, easing: 'cubic-bezier(.22, 1, .36, 1)' })
    expect(inward.keyframes).toEqual([{ transform: 'translateX(100%)' }, { transform: 'translateX(0)' }])
    fireEvent.click(document.querySelector('[data-scrim]')!)
    // Closed for everyone at once: no dialog to read or press, only its picture leaving.
    expect(screen.queryByRole('dialog')).toBeNull()
    const leaving = document.querySelector('[data-layer]')!
    expect(leaving).toHaveAttribute('inert')
    expect(leaving).toHaveAttribute('aria-hidden', 'true')
    const out = played.find((p) => p.opts.duration === 280 && p.el.hasAttribute('data-panel'))!
    expect(out.keyframes).toEqual([{ transform: 'translateX(0)' }, { transform: 'translateX(100%)' }])
    out.finish()
    expect(document.querySelector('[data-layer]')).toBeNull()
  })

  it('with reduced motion opens and closes at once, playing nothing', () => {
    const played = browser(true)
    render(<Payments />)
    openRow()
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(played).toEqual([])
    expect(document.querySelector('[data-layer]')).toBeNull()
  })
})

describe('the one line that says what happened', () => {
  it('is shown for 2.4 s and then goes', () => {
    vi.useFakeTimers()
    renderBare(<SnackHost view="/activity" />)
    act(() => showSnack({ title: 'Sent 120.00 to Orbit Studio' }))
    expect(screen.getByRole('status')).toHaveTextContent('Sent 120.00 to Orbit Studio')
    act(() => void vi.advanceTimersByTime(2399))
    expect(screen.queryByRole('status')).not.toBeNull()
    act(() => void vi.advanceTimersByTime(1))
    expect(screen.queryByRole('status')).toBeNull()
  })
})
