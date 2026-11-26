import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import { playSound, resetSoundsForTest, useSounds, WEB_SOUND_VOLUME } from '../lib/sound'
import { Switch } from '../pocket/Switch'

// B61.128 — the web's sounds (Pocket Live section 15): asked for only after the person's first press, never with Sounds
// off, at 60% of the phone's level, and a switch flipping plays tick.

type PlaySpy = MockInstance<HTMLMediaElement['play']>

function asked(spy: PlaySpy): string[] {
  return (spy.mock.contexts as HTMLMediaElement[]).map((el) => new URL(el.src).pathname)
}

describe('sounds', () => {
  let play: PlaySpy
  beforeEach(() => {
    resetSoundsForTest()
    useSounds.setState({ on: true })
    play = vi.spyOn(HTMLMediaElement.prototype, 'play')
  })
  afterEach(() => {
    play.mockRestore()
    window.localStorage.removeItem('talyvor-sounds')
  })

  it('asks for nothing before the first press on the page', () => {
    playSound('sent')
    expect(play).not.toHaveBeenCalled()
    fireEvent.pointerDown(document.body)
    playSound('sent')
    expect(asked(play)).toEqual(['/sounds/sent.wav'])
    expect((play.mock.contexts[0] as HTMLMediaElement).volume).toBe(WEB_SOUND_VOLUME)
  })

  it('asks for nothing with Sounds off, keeps the choice, and plays moneyin once when switched back on', () => {
    fireEvent.keyDown(document.body, { key: 'a' })
    useSounds.getState().setOn(false)
    expect(window.localStorage.getItem('talyvor-sounds')).toBe('off')
    playSound('approved')
    expect(play).not.toHaveBeenCalled()
    useSounds.getState().setOn(true)
    expect(window.localStorage.getItem('talyvor-sounds')).toBeNull()
    expect(asked(play)).toEqual(['/sounds/moneyin.wav'])
  })

  it('a switch flipping plays tick, once', () => {
    const changed = vi.fn()
    render(
      <div data-design="pocket">
        <Switch aria-label="Try" checked={false} onCheckedChange={changed} />
      </div>,
    )
    fireEvent.click(screen.getByRole('switch', { name: 'Try' }))
    expect(changed).toHaveBeenCalledWith(true)
    expect(asked(play)).toEqual(['/sounds/tick.wav'])
  })
})
