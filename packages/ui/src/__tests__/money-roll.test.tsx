import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Money, MoneyProvider, type MoneyFigures } from '../pocket'

// B61.75 — Pocket Live's roll: a figure that changes after first paint rolls from the old value to the new over 700 ms.
// Screen readers hear the new figure once, never the figures in between, and the roll ends on the real value.

const dollars = (minor: number) => `$${(minor / 100).toFixed(2)}`
const useFigures = (): MoneyFigures => ({ ulxc: () => null, minor: (m) => dollars(m) })

function balance(minor: number) {
  return (
    <MoneyProvider useFigures={useFigures}>
      <Money minor={minor} currency="USD" size="card" />
    </MoneyProvider>
  )
}

/** What a screen reader reads: the text of every node not under aria-hidden. */
function heard(el: Element): string {
  let out = ''
  for (const n of Array.from(el.childNodes)) {
    if (n.nodeType === 3) out += n.textContent
    else if (n instanceof Element && n.getAttribute('aria-hidden') !== 'true') out += heard(n)
  }
  return out
}

/** What the eye sees: the text of every node not visually hidden. */
function seen(el: Element): string {
  let out = ''
  for (const n of Array.from(el.childNodes)) {
    if (n.nodeType === 3) out += n.textContent
    else if (n instanceof Element && !n.classList.contains('sr-only')) out += seen(n)
  }
  return out
}

const figureOf = (s: string) => Number(s.replace(/[^\d.]/g, ''))

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'Date', 'setTimeout', 'clearTimeout'] })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('Money rolls to a new value', () => {
  it('rolls through the figures in between, says only the new one, and ends on it', () => {
    const { container, rerender } = render(balance(10_000))
    const money = () => container.querySelector('[data-money]') as Element
    expect(seen(money())).toBe('$100.00')

    rerender(balance(50_000))
    act(() => void vi.advanceTimersByTime(200))
    const between = figureOf(seen(money()))
    expect(between).toBeGreaterThan(100)
    expect(between).toBeLessThan(500)
    expect(heard(money())).toBe('$500.00')

    act(() => void vi.advanceTimersByTime(600))
    expect(seen(money())).toBe('$500.00')
    expect(heard(money())).toBe('$500.00')
    expect(money().querySelector('[aria-hidden="true"]')).toBeNull()
  })

  it('draws its first value at once', () => {
    const { container } = render(balance(10_000))
    expect(container.querySelector('[aria-hidden="true"]')).toBeNull()
    expect(seen(container)).toBe('$100.00')
  })
})
