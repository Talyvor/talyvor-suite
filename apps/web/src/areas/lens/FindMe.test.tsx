import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B61.93 — Settings, Privacy: your Talyvor name and who can find you, by name, phone number and email, each its own
// switch, off until pressed, with Lens's refusal words for a name taken, a look-alike and one kept for Talyvor; and the
// one question at the end of sign-up, which switches nothing on without Yes. The BFF answers what Lens recorded.

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

async function openPrivacy() {
  window.history.pushState({}, '', '/settings')
  render(<App />)
  const card = await screen.findByTestId('settings-privacy')
  await within(card).findByLabelText('Your Talyvor name')
  return card
}

const sw = (card: HTMLElement, name: string) => within(card).getByRole('switch', { name })

describe('Settings, Privacy', () => {
  it('saves your Talyvor name and shows the name Lens kept', async () => {
    const card = await openPrivacy()
    fireEvent.change(within(card).getByLabelText('Your Talyvor name'), { target: { value: ' Maya.L ' } })
    fireEvent.click(within(card).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(posts).toEqual([{ name: 'Maya.L' }]))
    expect(await within(card).findByText('@maya.l')).toBeInTheDocument()
  })

  it('every switch is off until pressed, and each sends only its own change', async () => {
    recorded = { ...recorded, name: 'maya.l', email: 'maya@example.com' }
    const card = await openPrivacy()
    for (const name of ['Name', 'Phone number', 'Email']) expect(sw(card, name)).toHaveAttribute('aria-checked', 'false')
    expect(posts).toEqual([])
    const cases: [string, string][] = [['Name', 'by_name'], ['Phone number', 'by_phone'], ['Email', 'by_email']]
    for (const [label, field] of cases) {
      fireEvent.click(sw(card, label))
      await waitFor(() => expect(sw(card, label)).toHaveAttribute('aria-checked', 'true'))
      expect(posts.at(-1)).toEqual({ [field]: true })
    }
    fireEvent.click(sw(card, 'Phone number'))
    await waitFor(() => expect(sw(card, 'Phone number')).toHaveAttribute('aria-checked', 'false'))
    expect(posts.at(-1)).toEqual({ by_phone: false })
  })

  it('cannot be found by name before choosing one, or by an email Talyvor does not have', async () => {
    const card = await openPrivacy()
    expect(sw(card, 'Name')).toBeDisabled()
    expect(within(card).getByText('Choose your Talyvor name first.')).toBeInTheDocument()
    expect(sw(card, 'Email')).toBeDisabled()
    expect(within(card).getByText('Talyvor has no email for you yet.')).toBeInTheDocument()
    expect(sw(card, 'Phone number')).toBeEnabled()
  })

  it.each([
    ['a name taken', 'grace.h', TAKEN],
    ['a look-alike of a name taken', 'grace_h', TAKEN],
    ['a name kept for Talyvor', 'support', KEPT],
    ['a name too short', 'mj', SHORT],
  ])('says Lens’s words for %s', async (_, name, words) => {
    const card = await openPrivacy()
    fireEvent.change(within(card).getByLabelText('Your Talyvor name'), { target: { value: name } })
    fireEvent.click(within(card).getByRole('button', { name: 'Save' }))
    expect(await within(card).findByRole('alert')).toHaveTextContent(words)
    expect(sw(card, 'Name')).toBeDisabled()
  })

  it('a session with no person yet is told to confirm a phone number', async () => {
    sub = 'usr_google'
    window.history.pushState({}, '', '/settings')
    render(<App />)
    const card = await screen.findByTestId('settings-privacy')
    expect(await within(card).findByText('Confirm your phone number first.')).toBeInTheDocument()
    expect(within(card).queryByRole('switch')).toBeNull()
  })
})

describe('the end of sign-up', () => {
  const QUESTION = 'Let people on Talyvor pay you by your name or phone number?'

  async function openEnd() {
    window.history.pushState({}, '', '/signup/confirm')
    return render(<App />)
  }

  it('asks once, and Yes turns on being found by phone number', async () => {
    await openEnd()
    expect(await screen.findByRole('heading', { name: QUESTION })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Open the app' })).toBeNull()
    expect(posts).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }))
    expect(await screen.findByRole('link', { name: 'Open the app' })).toBeInTheDocument()
    expect(posts).toEqual([{ by_phone: true }])
    expect(screen.queryByRole('heading', { name: QUESTION })).toBeNull()
  })

  it('Not now switches nothing on, and is not asked again', async () => {
    const view = await openEnd()
    fireEvent.click(await screen.findByRole('button', { name: 'Not now' }))
    expect(await screen.findByRole('link', { name: 'Open the app' })).toBeInTheDocument()
    expect(posts).toEqual([])
    view.unmount()
    queryClient.clear()
    await openEnd()
    expect(await screen.findByRole('link', { name: 'Open the app' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: QUESTION })).toBeNull()
  })
})
