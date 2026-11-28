import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { App, queryClient } from './App'
import { FIAT_KEY } from './areas/lens/money'

// Sharing.test.tsx — the consent surface.
//
// TWO THINGS ARE PINNED, and the first is why this file exists.
//
//  1. THE PROMISE IS BACKED. The signup screen tells people they can change this later in
//     Settings. The first draft said that while no settings route existed — a stale claim in a
//     brand-new file, about consent. So the route is asserted here: if /settings stops resolving
//     to the sharing control, this fails, and the sentence cannot quietly become false again.
//  2. THE SCREEN SHOWS WHAT IS STORED. The BFF returns the consent Lens RECORDED, and the screen
//     must render that rather than an optimistic echo of a click. A screen that shows the choice
//     you made rather than the one that took effect is the failure this whole path avoids.
//
// It also checks the copy states BOTH sides. Pre-declining means sharing only ever fires for
// people who actively opt in, so a screen that lists only the risk would quietly end the earning
// half of the product — and a screen that lists only the benefit would be selling. Both must be
// present, which is a property worth a test even though it is words.

function mockBff(cachePoolable: boolean, needsChoice = false, writes: unknown[] = []) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    if (url === '/auth/me') {
      return new Response(
        JSON.stringify({
          mode: 'oidc',
          authenticated: true,
          user: { sub: 'sub-alice', email: 'alice@example.com' },
          workspace_id: 'uabcdefghijklmnopqrstuvwxy',
          cache_poolable: cachePoolable,
          needs_pooling_choice: needsChoice,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }
    if (url === '/api/agents') {
      // A workspace this login just created: no agents, so Home opens its onboarding.
      return new Response(
        JSON.stringify({ workspace_balance_ulxc: 0, allocated_ulxc: 0, unallocated_ulxc: 0, spent_ulxc: 0, agents: [] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }
    // B57.42 — who is signed in, and as what, for Settings' first line.
    if (url === '/api/members') {
      return new Response(JSON.stringify([{ id: 'm1', name: 'Alice', email: 'alice@example.com', role: 'owner', avatar_url: '' }]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    if (url === '/api/workspace/name') {
      return new Response(JSON.stringify({ id: 'uabcdefghijklmnopqrstuvwxy', name: 'Alice’s team' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    if (url === '/api/pooling' && init?.method === 'POST') {
      writes.push(JSON.parse(String(init.body)))
      return new Response(JSON.stringify({ cache_poolable: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  })
}

describe('sharing consent', () => {
  beforeEach(() => {
    // Each case seeds a different /auth/me answer; a cached probe from the previous one would
    // silently be the thing asserted against.
    queryClient.clear()
    window.history.pushState({}, '', '/')
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('/settings resolves to the sharing switch, so the signup promise is not stale', async () => {
    mockBff(true)
    window.history.pushState({}, '', '/settings')
    render(<App />)
    const sw = await screen.findByRole('switch', { name: 'Share my answers' })
    expect(screen.getByRole('heading', { name: 'Shared answers' })).toBeInTheDocument()
    // Both sides of the trade, in one line: the saving and the royalty, and that the answer leaves for another company.
    const card = screen.getByTestId('settings-sharing')
    expect(card).toHaveTextContent(/served to another company/)
    expect(card).toHaveTextContent(/repeated questions cost less/)
    expect(card).toHaveTextContent(/never shared/)
    expect(sw).toBeInTheDocument()
  })

  it('renders the RECORDED state, not a pressed one', async () => {
    const writes: unknown[] = []
    // Lens recorded "off", and keeps saying so whatever is pressed: the switch follows Lens, not the press.
    mockBff(false, false, writes)
    window.history.pushState({}, '', '/settings')
    render(<App />)
    const sw = await screen.findByRole('switch', { name: 'Share my answers' })
    await waitFor(() => expect(sw).not.toBeDisabled())
    expect(sw).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(sw)
    await waitFor(() => expect(writes).toEqual([{ cache_poolable: true }]))
    await waitFor(() => expect(sw).not.toBeDisabled())
    expect(sw).toHaveAttribute('aria-checked', 'false')
  })

  // B57.42 — one page that links every setting.
  it('links every settings page, and Documents you attach is not among them', async () => {
    mockBff(true)
    window.history.pushState({}, '', '/settings')
    render(<App />)
    const pages = await screen.findByRole('navigation', { name: 'Settings pages' })
    const hrefs = Array.from(pages.querySelectorAll('a')).map((a) => a.getAttribute('href'))
    expect(hrefs).toEqual([
      '/settings/profile',
      '/settings/devices',
      '/settings/security',
      '/settings/connect',
      '/members',
      '/billing',
      '/settings/team',
      '/settings/verification',
      '/settings/payout-details',
      '/settings/terms',
      '/settings/wallet-webhooks',
      '/settings/webhooks',
      '/settings/email-branding',
      '/settings/help',
      '/settings/data',
      '/settings/close',
    ])
    expect(await screen.findByText('Signed in as Alice, the owner of Alice’s team.')).toBeInTheDocument()
    expect(within(pages).getByRole('link', { name: /^Members/ })).toHaveTextContent('1 person')
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
    expect(screen.queryByText('Documents you attach')).not.toBeInTheDocument()
  })

  // B57.228 — as Pocket Live's w-settings draws it: a row among the settings saying what is chosen, which opens its sheet.
  it('Look and sound: a settings row that opens its sheet: Follow my computer, Light or Dark', async () => {
    mockBff(true)
    window.history.pushState({}, '', '/settings')
    render(<App />)
    const pages = await screen.findByRole('navigation', { name: 'Settings pages' })
    const row = within(pages).getByRole('button', { name: 'Look and sound' })
    expect(row).toHaveAccessibleDescription('Follows your computer, sounds on')
    expect(screen.queryByRole('button', { name: /Switch to (dark|light) theme/ })).not.toBeInTheDocument()
    fireEvent.click(row)
    const sheet = screen.getByRole('dialog', { name: 'Look and sound' })
    const look = within(sheet).getByRole('radiogroup', { name: 'Look' })
    expect(within(look).getAllByRole('radio').map((r) => r.getAttribute('aria-label'))).toEqual(['Follow my computer', 'Light', 'Dark'])
    expect(within(look).getByRole('radio', { name: 'Follow my computer' })).toHaveAccessibleDescription('Light by day, dark by night')
    expect(within(look).getByRole('radio', { name: 'Follow my computer' })).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(within(look).getByRole('radio', { name: 'Dark' }))
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(window.localStorage.getItem('talyvor-theme')).toBe('dark')
    expect(within(look).getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true')
    expect(row).toHaveAccessibleDescription('Dark, sounds on')
    // Follow my computer keeps no choice, so every load asks the device.
    fireEvent.click(within(look).getByRole('radio', { name: 'Follow my computer' }))
    expect(window.localStorage.getItem('talyvor-theme')).toBeNull()
    expect(within(look).getByRole('radio', { name: 'Follow my computer' })).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(within(look).getByRole('radio', { name: 'Light' }))
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  it('Look and sound: Sounds is on by default, kept when switched off, and plays moneyin once when switched on', async () => {
    mockBff(true)
    window.history.pushState({}, '', '/settings')
    render(<App />)
    const row = await screen.findByRole('button', { name: 'Look and sound' })
    fireEvent.click(row)
    const sheet = screen.getByRole('dialog', { name: 'Look and sound' })
    expect(sheet).toHaveTextContent('SoundsSoft sounds when money moves')
    const sounds = within(sheet).getByRole('switch', { name: 'Sounds' })
    expect(sounds).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(sounds)
    expect(sounds).toHaveAttribute('aria-checked', 'false')
    expect(window.localStorage.getItem('talyvor-sounds')).toBe('off')
    expect(row).toHaveAccessibleDescription(/, sounds off$/)
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play')
    fireEvent.click(sounds)
    expect(sounds).toHaveAttribute('aria-checked', 'true')
    expect(window.localStorage.getItem('talyvor-sounds')).toBeNull()
    expect(play.mock.contexts.map((el) => new URL((el as HTMLAudioElement).src).pathname)).toEqual(['/sounds/moneyin.wav'])
    play.mockRestore()
  })

  it('Show amounts in: pounds or euros beside LXC, dollars by default', async () => {
    mockBff(true)
    window.history.pushState({}, '', '/settings')
    render(<App />)
    const show = await screen.findByRole('tablist', { name: 'Show amounts in' })
    expect(within(show).getByRole('tab', { name: 'US dollars' })).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(within(show).getByRole('tab', { name: 'Pounds' }))
    expect(window.localStorage.getItem(FIAT_KEY)).toBe('GBP')
    expect(within(show).getByRole('tab', { name: 'Pounds' })).toHaveAttribute('aria-selected', 'true')
    window.localStorage.removeItem(FIAT_KEY)
  })

  // B28.8 — the full-screen disclosure is gone. A new workspace opens the app, and sharing is one line
  // on Home's onboarding: the box is what Lens recorded, and one click changes it.
  it('a new workspace is never blocked: the app renders, with sharing one line to untick', async () => {
    const writes: unknown[] = []
    mockBff(true, true, writes)
    render(<App />)
    const box = await screen.findByRole('checkbox', { name: /Share answers with other companies/i })
    expect(screen.getByRole('navigation', { name: /sections/i })).toBeInTheDocument()
    expect(screen.queryByText(/Share your answers, and earn from them/i)).not.toBeInTheDocument()
    expect(box).toBeChecked()
    expect(box.closest('label')).toHaveTextContent(/On now; untick to stop/)

    fireEvent.click(box)
    await waitFor(() => expect(writes).toEqual([{ cache_poolable: false }]))
  })
})
