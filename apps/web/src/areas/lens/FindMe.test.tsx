import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B61.93, B57.196 — Settings, Profile: your Talyvor name and who can find you, "Let people find me" (by name or phone
// number) and email, off until pressed, with Lens's refusal words for a name taken, a look-alike and one kept for
// Talyvor; and the one question at the end of sign-up, su7, which switches nothing on without Yes. The BFF answers
// what Lens recorded.

/** Lens B61.32's words, as writeJSONErr says them. */
const TAKEN = 'That Talyvor name is taken: choose another'
const KEPT = 'Invalid Talyvor name: that name is kept for Talyvor'
const SHORT = 'Invalid Talyvor name: a Talyvor name is 3 to 20 characters'

let posts: Record<string, unknown>[]
let recorded: { name: string; email: string; phone: string; by_name: boolean; by_phone: boolean; by_email: boolean }
let sub: string

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })

beforeEach(() => {
  posts = []
  sub = 'person:per_maya'
  recorded = { name: '', email: '', phone: '+447700900456', by_name: false, by_phone: false, by_email: false }
  window.localStorage.clear()
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const path = String(input).split('?')[0]
    const method = init?.method ?? 'GET'
    if (path === '/auth/me') return json({ mode: 'oidc', authenticated: true, workspace_id: 'ws_maya', user: { sub, email: '' } })
    if (path === '/api/workspace/account') return json({ account_type: 'personal', money_kind: 'fiat' })
    if (path === '/api/verification') {
      const check = (level: number, subject: string) => ({ level: `L${level}`, subject, method: 'test', test: true, status: 'completed', started_at: '2026-11-18T09:00:00Z', checked_at: '2026-11-18T09:00:00Z' })
      return json({ workspace_id: 'ws_maya', level: 'L2', meaning: 'identity checked', live_level: 'L0', live_meaning: 'signed in', checks: [check(2, 'person'), check(1, 'contact')] })
    }
    if (path === '/api/people/finding') {
      if (sub !== 'person:per_maya') return json({ error: 'Confirm your phone number first.', reason: 'phone_needed' }, 409)
      if (method === 'GET') return json(recorded)
      const change = JSON.parse(String(init?.body)) as Record<string, unknown>
      posts.push(change)
      if (change.name === 'grace.h' || change.name === 'grace_h') return json({ error: TAKEN, reason: null }, 409)
      if (change.name === 'support') return json({ error: KEPT, reason: null }, 400)
      if (change.name === 'mj') return json({ error: SHORT, reason: null }, 400)
      // Lens keeps a name lower-case (economy.PersonNameFor).
      recorded = { ...recorded, ...change, ...(typeof change.name === 'string' ? { name: change.name.toLowerCase() } : {}) }
      return json(recorded)
    }
    return json({ error: 'not here' }, 404)
  })
})

afterEach(() => {
  cleanup()
  queryClient.clear()
  vi.restoreAllMocks()
  window.history.pushState({}, '', '/')
})

async function openProfile() {
  window.history.pushState({}, '', '/settings/profile')
  render(<App />)
  const page = await screen.findByTestId('settings-profile')
  await within(page).findByLabelText('Your Talyvor name')
  return page
}

const sw = (page: HTMLElement, name: string) => within(page).getByRole('switch', { name })
const FIND_ME = 'Let people find me'

describe('Settings, Profile', () => {
  it('Settings links Profile first, and Privacy is no longer a card there', async () => {
    window.history.pushState({}, '', '/settings')
    render(<App />)
    const pages = await screen.findByRole('navigation', { name: 'Settings pages' })
    const first = within(pages).getAllByRole('link')[0]
    expect(first).toHaveAttribute('href', '/settings/profile')
    expect(first).toHaveTextContent('Name, phone number, who can find you')
    expect(screen.queryByTestId('settings-privacy')).toBeNull()
  })

  it('saves your Talyvor name and shows the name Lens kept', async () => {
    const page = await openProfile()
    fireEvent.change(within(page).getByLabelText('Your Talyvor name'), { target: { value: ' Maya.L ' } })
    fireEvent.click(within(page).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(posts).toEqual([{ name: 'Maya.L' }]))
    expect(await within(page).findByText('@maya.l')).toBeInTheDocument()
  })

  it('shows what Talyvor has for you, and every switch is off until pressed', async () => {
    recorded = { ...recorded, name: 'maya.l', email: 'maya@example.com' }
    const page = await openProfile()
    expect(within(page).getByText('+447700900456')).toBeInTheDocument()
    expect(within(page).getAllByText('maya@example.com').length).toBeGreaterThan(0)
    expect(within(page).getByText('By my name or phone number, to pay me')).toBeInTheDocument()
    for (const name of [FIND_ME, 'Email']) expect(sw(page, name)).toHaveAttribute('aria-checked', 'false')
    expect(posts).toEqual([])
  })

  it('Let people find me turns on name and phone number together, and off together', async () => {
    recorded = { ...recorded, name: 'maya.l' }
    const page = await openProfile()
    fireEvent.click(sw(page, FIND_ME))
    await waitFor(() => expect(sw(page, FIND_ME)).toHaveAttribute('aria-checked', 'true'))
    expect(posts).toEqual([{ by_name: true, by_phone: true }])
    fireEvent.click(sw(page, FIND_ME))
    await waitFor(() => expect(sw(page, FIND_ME)).toHaveAttribute('aria-checked', 'false'))
    expect(posts.at(-1)).toEqual({ by_name: false, by_phone: false })
  })

  it('before a name is chosen, Let people find me is by phone number only; no email, no email switch', async () => {
    const page = await openProfile()
    expect(sw(page, 'Email')).toBeDisabled()
    expect(within(page).getByText('Talyvor has no email for you yet.')).toBeInTheDocument()
    fireEvent.click(sw(page, FIND_ME))
    await waitFor(() => expect(sw(page, FIND_ME)).toHaveAttribute('aria-checked', 'true'))
    expect(posts).toEqual([{ by_phone: true }])
  })

  it('the email switch sends only its own change', async () => {
    recorded = { ...recorded, email: 'maya@example.com' }
    const page = await openProfile()
    fireEvent.click(sw(page, 'Email'))
    await waitFor(() => expect(sw(page, 'Email')).toHaveAttribute('aria-checked', 'true'))
    expect(posts).toEqual([{ by_email: true }])
  })

  it.each([
    ['a name taken', 'grace.h', TAKEN],
    ['a look-alike of a name taken', 'grace_h', TAKEN],
    ['a name kept for Talyvor', 'support', KEPT],
    ['a name too short', 'mj', SHORT],
  ])('says Lens’s words for %s', async (_, name, words) => {
    const page = await openProfile()
    fireEvent.change(within(page).getByLabelText('Your Talyvor name'), { target: { value: name } })
    fireEvent.click(within(page).getByRole('button', { name: 'Save' }))
    expect(await within(page).findByRole('alert')).toHaveTextContent(words)
    expect(within(page).queryByText(`@${name}`)).toBeNull()
  })

  it('a session with no person yet is told to confirm a phone number', async () => {
    sub = 'usr_google'
    window.history.pushState({}, '', '/settings/profile')
    render(<App />)
    const page = await screen.findByTestId('settings-profile')
    expect(await within(page).findByText('Confirm your phone number first.')).toBeInTheDocument()
    expect(within(page).queryByRole('switch')).toBeNull()
  })
})

describe('the end of sign-up', () => {
  const QUESTION = 'Let people find you?'

  async function openEnd() {
    window.history.pushState({}, '', '/signup/confirm')
    return render(<App />)
  }

  it('asks once with nothing picked, and Yes then Open my account turns on being found by phone number and opens Home', async () => {
    await openEnd()
    expect(await screen.findByRole('heading', { name: QUESTION })).toBeInTheDocument()
    expect(screen.getByText('So people can pay you by your name or phone number.')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Open the app' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Open my account' })).toBeDisabled()
    for (const r of screen.getAllByRole('radio')) expect(r).not.toBeChecked()
    fireEvent.click(screen.getByRole('radio', { name: /Yes, find me/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Open my account' }))
    await waitFor(() => expect(window.location.pathname).toBe('/'))
    expect(posts).toEqual([{ by_phone: true }])
  })

  it('No switches nothing on, opens Home, and is not asked again', async () => {
    const view = await openEnd()
    fireEvent.click(await screen.findByRole('radio', { name: /^No/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Open my account' }))
    await waitFor(() => expect(window.location.pathname).toBe('/'))
    expect(posts).toEqual([])
    view.unmount()
    queryClient.clear()
    await openEnd()
    expect(await screen.findByRole('link', { name: 'Open the app' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: QUESTION })).toBeNull()
  })
})
