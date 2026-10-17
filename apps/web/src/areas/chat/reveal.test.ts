import { describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { FINISH_HORIZON_MS, Reveal, STREAM_HORIZON_MS, useRevealedText } from './reveal'

const FRAME = 16

/** Steps the pacer frame by frame until it has shown `upTo` characters; returns each frame's gain. */
function frames(r: Reveal, upTo: number, limit = 1000): number[] {
  const gains: number[] = []
  let prev = 0
  for (let i = 0; i < limit && prev < upTo; i++) {
    const now = r.step(FRAME)
    gains.push(now - prev)
    prev = now
  }
  return gains
}

describe('Reveal — the pace an answer grows at', () => {
  it('spreads a burst that arrives while the answer is streaming over the stream horizon', () => {
    const r = new Reveal()
    r.arrive(600, false)
    const gains = frames(r, 600)
    // Measured before B16.3: one frame showed 12% of a live answer. Spread over the horizon, no
    // frame shows more than a frame's share of it.
    expect(Math.max(...gains)).toBeLessThanOrEqual(Math.ceil((600 * FRAME) / STREAM_HORIZON_MS) + 1)
    expect(gains.length * FRAME).toBeLessThanOrEqual(STREAM_HORIZON_MS + FRAME)
  })

  it('reveals a complete answer — a cached one arrives in one piece — steadily, within the finish horizon', () => {
    const r = new Reveal()
    r.arrive(3000, true)
    const gains = frames(r, 3000)
    expect(gains.length).toBeGreaterThan(30) // not one block
    expect(Math.max(...gains) - Math.min(...gains.slice(0, -1))).toBeLessThanOrEqual(1) // steady
    expect(gains.length * FRAME).toBeLessThanOrEqual(FINISH_HORIZON_MS + FRAME)
    expect(r.finished).toBe(true)
  })
})

describe('useRevealedText', () => {
  it('shows an answer reopened from history at once, and paces one that is arriving', async () => {
    const past = renderHook(() => useRevealedText('An earlier answer, kept in history.', false))
    expect(past.result.current).toEqual({ text: 'An earlier answer, kept in history.', revealing: false })

    const answer = 'A cached answer arrives in one piece and still grows on screen.'
    const live = renderHook(({ text, live }) => useRevealedText(text, live), { initialProps: { text: '', live: true } })
    live.rerender({ text: answer, live: false })
    await act(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))
    expect(live.result.current.revealing).toBe(true)
    expect(live.result.current.text.length).toBeGreaterThan(0)
    expect(live.result.current.text.length).toBeLessThan(answer.length)
    expect(answer.startsWith(live.result.current.text)).toBe(true)
  })

  it('B17.216 — a late frame that shows the rest of an answer still leaves it a frame on screen before it settles', async () => {
    const queued: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => queued.push(cb))
    try {
      const answer = '1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30'
      const hook = renderHook(({ text, live }) => useRevealedText(text, live), { initialProps: { text: '', live: true } })
      hook.rerender({ text: answer, live: false })
      // One frame five seconds late: everything that was left is shown in it, and the answer is still revealing.
      act(() => queued.shift()?.(performance.now() + 5_000))
      expect(hook.result.current).toEqual({ text: answer, revealing: true })
      act(() => queued.shift()?.(performance.now() + 5_016))
      expect(hook.result.current).toEqual({ text: answer, revealing: false })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('B28.113 — an answer continued keeps the text it already showed, and paces only what is added', async () => {
    const start = 'The first part of an answer, cut off '
    const whole = start + 'in the middle of a sentence, and then it goes on for a good while longer.'
    const hook = renderHook(({ text, live }) => useRevealedText(text, live), { initialProps: { text: start + 'mi', live: false } })
    hook.rerender({ text: start, live: true })
    expect(hook.result.current.text).toBe(start)
    hook.rerender({ text: whole, live: false })
    await act(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))
    expect(hook.result.current.revealing).toBe(true)
    expect(hook.result.current.text.startsWith(start)).toBe(true)
    expect(hook.result.current.text.length).toBeLessThan(whole.length)
  })
})
