import { describe, expect, it } from 'vitest'
import { firstMessageVerdict, stalled } from '../src/chatFirstMessage.ts'

describe('the first chat message oracle (B45.3)', () => {
  it('passes a message sent within 10 seconds on both viewports with nothing unnamed', () => {
    expect(firstMessageVerdict([
      { viewport: 'desktop (1440 px)', ms: 1_800, unlabelled: [] },
      { viewport: 'phone (390 px)', ms: 2_400, unlabelled: [] },
    ]).pass).toBe(true)
  })

  it('fails a hidden composer, a slow send and an unnamed button', () => {
    const v = firstMessageVerdict([
      { viewport: 'desktop (1440 px)', why: 'locator.fill: Timeout 10000ms exceeded.', unlabelled: [] },
      { viewport: 'phone (390 px)', ms: 12_000, unlabelled: ['button-name at #send'] },
    ])
    expect(v.pass).toBe(false)
    expect(v.detail).toContain('on the desktop (1440 px), no first message was sent: locator.fill: Timeout')
    expect(v.detail).toContain('took 12000 ms from landing, over 10000')
    expect(v.detail).toContain('axe finds unnamed: button-name at #send')
  })

  it('takes a visit far past every bounded wait for a stalled machine, and a slow page for a slow page (B17.312)', () => {
    expect(stalled(951_956)).toBe(true)
    expect(stalled(10_400)).toBe(false)
  })
})
