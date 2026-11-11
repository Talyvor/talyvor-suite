import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from './App'

// B57.8 — Pocket's shell around every signed-in page: the top bar's Pause every agent (instant, no passkey), the kill
// banner on every page while every agent is paused, Start every agent again opening the killoff dialog that signs over
// /api/agents/resume-all/challenge, the avatar to Settings, and the sidebar as a drawer below 840. The mock keeps the
// pause the way Lens B19.7 does, and refuses an unsigned resume once the workspace has a passkey (Lens B41.108).

const ASSERTION = {
  rawId: new Uint8Array([1]).buffer,
  response: { clientDataJSON: new Uint8Array([2]).buffer, authenticatorData: new Uint8Array([3]).buffer, signature: new Uint8Array([4]).buffer },
}

function mockLens({ passkey = true, phone = false } = {}) {
  const posts: Array<{ url: string; body: unknown }> = []
  let paused = false
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input).split('?')[0]
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (init?.method === 'POST') posts.push({ url, body: init.body ? JSON.parse(String(init.body)) : null })
    if (url === '/auth/me') return json({ mode: 'oidc', authenticated: true, user: { sub: 's1', email: 'nick@example.com' } })
    if (url === '/api/workspace/name') return json({ id: 'ws_1', name: 'Nick’s team' })
    if (url === '/api/agents/passkeys') return json({ passkeys: passkey ? [{ id: 'pk_1', created_at: '2026-11-01T00:00:00Z' }] : [] })
    if (url === '/api/money/devices') return json({ devices: phone ? [{ id: 'dk_1', platform: 'ios', name: 'Work iPhone' }] : [] })
    if (url === '/api/agents')
      return json({
        workspace_balance_ulxc: 0, allocated_ulxc: 0, unallocated_ulxc: 0, spent_ulxc: 0,
        ...(paused ? { all_paused_at: '2026-11-10T10:00:00Z', all_paused_reason: 'paused from the top bar' } : {}),
        agents: [
          { id: 'agt_1', name: 'Sales', balance_ulxc: 0, spent_ulxc: 0, keys: [], created_at: '2026-11-01T00:00:00Z' },
          { id: 'agt_2', name: 'Ops', balance_ulxc: 0, spent_ulxc: 0, keys: [], created_at: '2026-11-01T00:00:00Z', paused_at: '2026-11-09T10:00:00Z' },
        ],
      })
    if (url === '/api/agents/pause-all') {
      paused = true
      return json({ all_paused: true })
    }
    if (url === '/api/agents/resume-all/challenge') return json({ challenge: 'Y2gx', allow_credentials: passkey ? ['Y3JlZDE'] : [] })
    if (url === '/api/agents/resume-all') {
      const body = posts.at(-1)?.body as { assertion?: unknown } | null
      if (passkey && body?.assertion === undefined) return json({ error: 'economy: this workspace signs resuming' }, 403)
      paused = false
      return json({ all_paused: false })
    }
    return new Response('null', { status: 404 })
  })
  return posts
}

function passkeyAnswers(get = vi.fn().mockResolvedValue(ASSERTION)) {
  Object.defineProperty(navigator, 'credentials', { value: { get, create: vi.fn() }, configurable: true })
  return get
}

async function at(address: string) {
  window.history.pushState({}, '', address)
  render(<App />)
  return within(await screen.findByRole('banner'))
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  queryClient.clear()
})

describe('Pause every agent, from the top bar of every page', () => {
  it('pauses at once with no passkey, stays on the page with its snack, and the kill banner follows the person to every page', async () => {
    const posts = mockLens()
    const get = passkeyAnswers()
    const bar = await at('/money/invoices')
    fireEvent.click(await bar.findByRole('button', { name: 'Pause every agent' }))

    expect(await screen.findByText('Every agent is paused')).toBeInTheDocument()
    expect(window.location.pathname).toBe('/money/invoices')
    expect(await screen.findByTestId('kill-banner')).toHaveTextContent('Every agent is paused.')
    expect(get).not.toHaveBeenCalled()
    expect(posts).toEqual([{ url: '/api/agents/pause-all', body: { reason: 'paused from the top bar' } }])

    // While paused the top bar offers the way back, and the banner is on every page.
    expect(await bar.findByRole('button', { name: 'Start every agent again' })).toBeInTheDocument()
    fireEvent.click(within(screen.getByRole('navigation', { name: /sections/i })).getByRole('link', { name: 'Statements' }))
    expect(await screen.findByTestId('kill-banner')).toBeInTheDocument()
  })

  it('Start every agent again names who stays paused, and signs with the passkey over the resume-all challenge', async () => {
    const posts = mockLens()
    const get = passkeyAnswers(
      vi.fn().mockRejectedValueOnce(new DOMException('The operation was cancelled.', 'NotAllowedError')).mockResolvedValue(ASSERTION),
    )
    const bar = await at('/')
    fireEvent.click(await bar.findByRole('button', { name: 'Pause every agent' }))
    fireEvent.click(within(await screen.findByTestId('kill-banner')).getByRole('button', { name: 'Start every agent again' }))

    const dialog = await screen.findByRole('dialog', { name: 'Start every agent again?' })
    // The pause's confirmation goes, so it cannot sit over the sheet's buttons below 840.
    expect(screen.queryByText('Every agent is paused')).toBeNull()
    expect(dialog).toHaveTextContent('An agent you paused on its own stays paused.')
    expect(dialog).toHaveTextContent('Ops stays paused until you resume it.')

    // The passkey prompt cancelled: nothing is sent, and every agent stays paused.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Start them with your passkey' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Cancelled. Nothing changed.')
    expect(posts.some((p) => p.url === '/api/agents/resume-all')).toBe(false)

    fireEvent.click(within(dialog).getByRole('button', { name: 'Start them with your passkey' }))
    expect(await screen.findByText('Your agents can work again')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByTestId('kill-banner')).toBeNull())
    expect(await bar.findByRole('button', { name: 'Pause every agent' })).toBeInTheDocument()

    expect(get.mock.calls[1][0].publicKey.userVerification).toBe('required')
    const assertion = { credential_id: 'AQ', client_data_json: 'Ag', authenticator_data: 'Aw', signature: 'BA' }
    expect(posts.map((p) => [p.url, p.body])).toEqual([
      ['/api/agents/pause-all', { reason: 'paused from the top bar' }],
      ['/api/agents/resume-all/challenge', {}],
      ['/api/agents/resume-all/challenge', {}],
      ['/api/agents/resume-all', { assertion }],
    ])
  })

  it('with only the phone’s key, the dialog sends them to the phone and starts nothing from here', async () => {
    const posts = mockLens({ passkey: false, phone: true })
    passkeyAnswers()
    const bar = await at('/')
    fireEvent.click(await bar.findByRole('button', { name: 'Pause every agent' }))
    fireEvent.click(await bar.findByRole('button', { name: 'Start every agent again' }))

    const dialog = await screen.findByRole('dialog', { name: 'Start every agent again?' })
    expect(await within(dialog).findByText(/Start your agents again on your phone with Face ID\./)).toBeInTheDocument()
    expect(within(dialog).getByRole('link', { name: 'Add this browser' })).toHaveAttribute('href', '/approvals')
    expect(within(dialog).queryByRole('button', { name: /^Start/ })).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(posts.map((p) => p.url)).toEqual(['/api/agents/pause-all'])
  })
})

describe('the avatar and the drawer', () => {
  it('the avatar opens Settings, where Sign out is now', async () => {
    mockLens()
    const bar = await at('/')
    const avatar = bar.getByRole('link', { name: 'Settings and sign out' })
    // The person's initial, once /auth/me has answered (a returning session draws the shell before it does).
    await waitFor(() => expect(avatar).toHaveTextContent('N'))
    fireEvent.click(avatar)
    expect(window.location.pathname).toBe('/settings')
    expect(await screen.findByRole('button', { name: 'Sign out' })).toBeInTheDocument()
    expect(bar.queryByRole('button', { name: 'Sign out' })).toBeNull()
  })

  it('Menu opens the sidebar as a drawer, and following one of its rows closes it', async () => {
    mockLens()
    const bar = await at('/')
    const menu = bar.getByRole('button', { name: 'Menu' })
    const drawer = document.getElementById(menu.getAttribute('aria-controls') ?? '')!
    expect(drawer.className).toContain('invisible')
    fireEvent.click(menu)
    expect(menu).toHaveAttribute('aria-expanded', 'true')
    expect(drawer.className).not.toContain('invisible')
    fireEvent.click(within(drawer).getByRole('link', { name: 'Pay' }))
    expect(window.location.pathname).toBe('/money/pay')
    expect(menu).toHaveAttribute('aria-expanded', 'false')
  })
})
