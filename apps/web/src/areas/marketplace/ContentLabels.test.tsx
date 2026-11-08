import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B41.85 — content labels and age ratings. The mock BFF answers as Lens B41.185 does: a listing carries age_rating and
// content_labels, a workspace's content filter reads back what it saved and the listings it blocked, and a block and
// its undo answer 204.

const LISTING = {
  id: 'lst_med', workspace_id: 'ws_seller', kind: 'agent', title: 'Night nurse', description: '',
  price_per_use_ulxc: 0, visibility: 'public', latest_version: 1, created_at: '2026-11-01T09:00:00Z', updated_at: '2026-11-01T09:00:00Z',
  age_rating: '18+', content_labels: ['adult', 'medical_advice'],
}

function mockBff(asSeller = false) {
  const sent: { method: string; url: string; body?: unknown }[] = []
  let filter = { max_age_rating: '18+', blocked_labels: [] as string[], blocked_listings: ['lst_med'] }
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (method !== 'GET') sent.push({ method, url, body })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/models') return json([])
    if (url === '/api/marketplace/content-filter') {
      if (method === 'PUT') filter = { ...filter, ...body }
      return json(filter)
    }
    if (url === '/api/marketplace/blocked-listings/lst_med') return new Response(null, { status: 204 })
    if (url === '/api/marketplace/listings/lst_med/content-labels') return json({ ...LISTING, ...body })
    if (url === '/api/marketplace/listings/lst_med')
      return json({ ...LISTING, versions: [{ version: 1, artifact_sha256: 'a', created_at: '', ...(asSeller ? { artifact: { system_prompt: 'x' } } : {}) }] })
    return new Response('null', { status: 404 })
  })
  return sent
}

async function at(path: string) {
  window.history.pushState({}, '', path)
  render(<App />)
  await screen.findByRole('navigation', { name: /sections/i })
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  queryClient.clear()
})

describe('content labels and age ratings (B41.85)', () => {
  it('a workspace sets the family filter, hides a label, and unblocks a listing it blocked', async () => {
    const sent = mockBff()
    await at('/marketplace/content-filter')
    fireEvent.change(await screen.findByLabelText('Show listings rated for'), { target: { value: 'all' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Financial advice' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save filter' }))
    expect((await screen.findByRole('status')).textContent).toBe('Saved. Your marketplace shows only what this filter allows.')
    expect(sent[0]).toEqual({
      method: 'PUT',
      url: '/api/marketplace/content-filter',
      body: { max_age_rating: 'all', blocked_labels: ['financial_advice'] },
    })

    const blocked = screen.getByRole('list', { name: 'Blocked listings' })
    expect(await within(blocked).findByRole('link', { name: 'Night nurse' })).toBeTruthy()
    fireEvent.click(within(blocked).getByRole('button', { name: 'Unblock' }))
    await waitFor(() => expect(sent[1]).toEqual({ method: 'DELETE', url: '/api/marketplace/blocked-listings/lst_med', body: undefined }))
  })

  it("a buyer reads a listing's rating and labels, blocks it and undoes the block", async () => {
    const sent = mockBff()
    await at('/marketplace/listings/lst_med')
    expect((await screen.findByTestId('listing-content')).textContent).toBe('Rated 18 and over · Adult content, Medical advice')
    fireEvent.click(screen.getByRole('button', { name: 'Block this listing' }))
    expect((await screen.findByRole('status')).textContent).toBe('Blocked. It no longer shows in your marketplace, search or collections.')
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(await screen.findByRole('button', { name: 'Block this listing' })).toBeTruthy()
    expect(sent.map((s) => `${s.method} ${s.url}`)).toEqual([
      'PUT /api/marketplace/blocked-listings/lst_med',
      'DELETE /api/marketplace/blocked-listings/lst_med',
    ])
  })

  it('a seller rerates their listing, and cannot rate adult content under 18', async () => {
    const sent = mockBff(true)
    await at('/marketplace/listings/lst_med')
    expect(screen.queryByRole('button', { name: 'Block this listing' })).toBeNull()
    fireEvent.click(await screen.findByRole('button', { name: 'Change rating and labels' }))
    fireEvent.click(screen.getByRole('button', { name: '13 and over' }))
    expect(screen.getByRole('alert').textContent).toBe('A listing with adult content is rated 18 and over.')
    expect(screen.getByRole('button', { name: 'Save' })).toHaveProperty('disabled', true)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Adult content' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect((await screen.findByRole('status')).textContent).toBe('Saved. Buyers see the new rating and labels now.')
    expect(sent).toEqual([
      { method: 'PUT', url: '/api/marketplace/listings/lst_med/content-labels', body: { age_rating: '13+', content_labels: ['medical_advice'] } },
    ])
  })
})
