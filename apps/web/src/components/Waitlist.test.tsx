import { describe, expect, it, vi, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { WAITLIST_JOINED_EVENT, Waitlist } from './Waitlist'

// B44.1 — the waitlist posts the email with the page and its utm tags, then says so and fires the Lead hook.

afterEach(() => vi.unstubAllGlobals())

describe('Waitlist', () => {
  it('joins, replaces the form with "You’re on the list." and fires the joined event once', async () => {
    window.history.pushState({}, '', '/marketing?utm_source=meta&utm_campaign=oct')
    const fetchMock = vi.fn(async () => new Response('{"ok":true}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const joined = vi.fn()
    window.addEventListener(WAITLIST_JOINED_EVENT, joined)

    render(<Waitlist />)
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'ann@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Join the waitlist' }))

    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('You’re on the list.'))
    expect(screen.queryByRole('button', { name: 'Join the waitlist' })).toBeNull()
    expect(joined).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/waitlist')
    expect(JSON.parse(init.body as string)).toEqual({
      email: 'ann@example.com', website: '', page: '/marketing',
      utm_source: 'meta', utm_medium: '', utm_campaign: 'oct',
    })
    window.removeEventListener(WAITLIST_JOINED_EVENT, joined)
  })

  it('shows the server’s refusal and keeps the form', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"Too many tries from here. Try again in an hour."}', { status: 429 })))
    render(<Waitlist />)
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'ann@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Join the waitlist' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Too many tries from here. Try again in an hour.'))
    expect(screen.getByRole('button', { name: 'Join the waitlist' })).toBeTruthy()
  })
})
