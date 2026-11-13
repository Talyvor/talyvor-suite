import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B59.28 — Settings' Help and complaints, Close this account and Your data, on a BFF that answers as Lens B59.27 does:
// each form sends its kind and message only, a complaint shows its reference, closing an account that holds money is
// refused naming each balance, a finished export downloads, and every signed-in page and both legal pages link to them.

const at = '2026-11-12T09:00:00Z'
const req = (p: Record<string, unknown>) => ({ id: 1, kind: 'support', state: 'received', reference: '', message: '', answer: '', filed_at: at, updated_at: at, ...p })

function mockBff(start: unknown[] = [], closure?: { balances: Record<string, number> }) {
  const posts: unknown[] = []
  let requests = start
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url !== '/api/workspace/requests') return new Response('null', { status: 404 })
    if (init?.method !== 'POST') return json({ requests })
    const body = JSON.parse(String(init.body)) as { kind: string; message: string }
    posts.push(body)
    if (body.kind === 'account_closure' && closure) {
      return json({ error: 'support: the account still holds money', code: 'balances_not_empty', balances: closure.balances }, 409)
    }
    const filed = req({ id: requests.length + 1, kind: body.kind, message: body.message, reference: body.kind === 'complaint' ? 'C-ABCD-EFGH' : '' })
    requests = [filed, ...requests]
    return json(filed, 201)
  })
  return posts
}

function open(path: string) {
  window.history.pushState({}, '', path)
  render(<App />)
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  queryClient.clear()
})

describe('help and complaints, closing the account, your data (B59.28)', () => {
  it('sends a complaint with its message only and shows its reference', async () => {
    const posts = mockBff()
    open('/settings/help')
    fireEvent.change(await screen.findByLabelText('What is it?'), { target: { value: 'complaint' } })
    fireEvent.change(screen.getByLabelText('Your message'), { target: { value: 'A card payment was taken twice' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send complaint' }))

    await waitFor(() => expect(screen.getByTestId('request-1').textContent).toContain('Reference C-ABCD-EFGH'))
    expect(posts).toEqual([{ kind: 'complaint', message: 'A card payment was taken twice' }])
    expect(screen.getByRole('status').textContent).toContain('Its reference is C-ABCD-EFGH.')
  })

  it('lists what was sent with its state and Talyvor’s answer', async () => {
    mockBff([req({ id: 3, kind: 'support', state: 'done', message: 'How do I add an agent?', answer: 'From Agents, press New agent.' })])
    open('/settings/help')
    const row = await screen.findByTestId('request-3')
    expect(row.textContent).toContain('Question or problem')
    expect(row.textContent).toContain('Done')
    expect(row.textContent).toContain('Talyvor’s answer: From Agents, press New agent.')
  })

  it('refuses to close an account that holds money, naming each balance', async () => {
    const posts = mockBff([], { balances: { GBP: 1250, USDC: 3_000_000 } })
    open('/settings/close')
    fireEvent.click(await screen.findByRole('button', { name: 'Ask to close this account' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent?.replace(/\u00a0/g, ' ')).toBe('This account still holds £12.50, 3.00 USDC. Move the money out, then ask again.')
    expect(posts).toEqual([{ kind: 'account_closure', message: '' }])
  })

  it('asks for a copy of the data and downloads it once it is done', async () => {
    const posts = mockBff([req({ id: 5, kind: 'data_export', state: 'done' }), req({ id: 4, kind: 'data_deletion', state: 'in_progress' })])
    open('/settings/data')
    const done = await screen.findByTestId('request-5')
    expect(within(done).getByRole('link', { name: 'Download your data' }).getAttribute('href')).toBe('/api/workspace/requests/5/export')
    expect(within(screen.getByTestId('request-4')).queryByRole('link')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Ask for a copy' }))
    await waitFor(() => expect(posts).toEqual([{ kind: 'data_export', message: '' }]))
  })

  it('links all three from the foot of a signed-in page and from both legal pages', async () => {
    mockBff()
    for (const path of ['/agents', '/privacy', '/terms']) {
      open(path)
      const nav = await screen.findByRole('navigation', { name: 'Help and your account' })
      expect(within(nav).getAllByRole('link').map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
        ['Help and complaints', '/settings/help'],
        ['Close this account', '/settings/close'],
        ['Your data', '/settings/data'],
      ])
      cleanup()
      queryClient.clear()
    }
  })
})
