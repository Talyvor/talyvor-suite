import { describe, expect, it } from 'vitest'
import { chatSidebarVerdict } from '../src/chatSidebar.ts'

describe('the chat sidebar oracle (B47.2)', () => {
  it('passes a hidden sidebar on /chat that Menu opens in place and Escape closes, with Home as before', () => {
    expect(chatSidebarVerdict([
      { viewport: 'desktop (1440 px)', besidePage: true, chatShown: false, opened: true, moved: 0, escClosed: true, homeShown: true },
      { viewport: 'phone (390 px)', besidePage: false, chatShown: false, opened: true, moved: 0, escClosed: true, homeShown: false },
    ]).pass).toBe(true)
  })

  it('fails a sidebar shown on /chat, a chat that moves, Escape ignored and Home without its sidebar', () => {
    const v = chatSidebarVerdict([
      { viewport: 'desktop (1440 px)', besidePage: true, chatShown: true, opened: true, moved: 240, escClosed: false, homeShown: false },
      { viewport: 'phone (390 px)', besidePage: false, why: 'locator.click: Timeout 30000ms exceeded.' },
    ])
    expect(v.pass).toBe(false)
    expect(v.detail).toContain('/chat opened with the suite sidebar showing')
    expect(v.detail).toContain('the chat moved 240 px when the sidebar opened')
    expect(v.detail).toContain('Escape did not close the sidebar')
    expect(v.detail).toContain('Home hid the sidebar, as before it showed it')
    expect(v.detail).toContain('on the phone (390 px): locator.click: Timeout')
  })
})
