import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B53.12 — /money/card on a Lens that serves physical cards: order one (only its fields reach the BFF), activate it
// with the last four digits once it has shipped, and freeze and replace it when lost. On a Lens whose switch is off
// (404) /money/card lands on Spending, which shows no link to it; on one that serves them, Spending links to it.

const address = { line1: '1 High St', line2: '', city: 'London', postcode: 'N1 9GU', country: 'GB' }
const card = (p: Record<string, unknown>) => ({ id: 'pc_1', last4: '4242', state: 'inactive', design: 'standard', name_on_card: 'Ada Owner', address,
  delivery: { status: 'ordered', updated_at: '2026-11-05T09:00:00Z' }, pin_url: '', replaces: '', replaced_by: '', created_at: '2026-11-05T09:00:00Z', ...p })

function mockBff(served: boolean, posts: [string, unknown][]) {
  let cards: unknown[] = []
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (!url.startsWith('/api/money/physical-cards')) return new Response('null', { status: 404 })
    if (!served) return json({ error: 'not found' }, 404)
    if (init?.method !== 'POST') return json({ cards })
    const body = JSON.parse(String(init.body))
    posts.push([url, body])
    if (url === '/api/money/physical-cards') cards = [card({})]
    if (url.endsWith('/activate')) cards = [card({ state: 'active', delivery: { status: 'delivered', updated_at: '2026-11-07T09:00:00Z' }, pin_url: 'https://partner.example/pin' })]
    if (url.endsWith('/replace')) cards = [card({ state: 'frozen', replaced_by: 'pc_2' }), card({ id: 'pc_2', last4: '5151', replaces: 'pc_1' })]
    return json({})
  })
  return { ship: () => (cards = [card({ delivery: { status: 'shipped', updated_at: '2026-11-06T09:00:00Z' } })]) }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  queryClient.clear()
})

describe('the physical Talyvor Card (B53.12)', () => {
  it('orders, activates on arrival, and freezes and replaces a lost card', async () => {
    const posts: [string, unknown][] = []
    const bff = mockBff(true, posts)
    window.history.pushState({}, '', '/money/spending')
    render(<App />)
    fireEvent.click(await screen.findByRole('link', { name: 'Your Talyvor Card' }))

    fireEvent.change(await screen.findByLabelText('Name on the card'), { target: { value: 'Ada Owner' } })
    fireEvent.change(screen.getByLabelText('Address line 1'), { target: { value: '1 High St' } })
    fireEvent.change(screen.getByLabelText('Town or city'), { target: { value: 'London' } })
    fireEvent.change(screen.getByLabelText('Postcode'), { target: { value: 'N1 9GU' } })
    fireEvent.click(screen.getByRole('button', { name: 'Order card' }))
    await waitFor(() => expect(screen.getByTestId('physical-card-pc_1').textContent).toContain('Ordered — the partner is making it'))
    expect(posts[0]).toEqual(['/api/money/physical-cards', { name_on_card: 'Ada Owner', address }])
    expect(screen.queryByTestId('order-physical-card')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Activate' })).toBeNull()

    bff.ship()
    await queryClient.invalidateQueries()
    fireEvent.change(await screen.findByLabelText('Last four digits on the card'), { target: { value: '4242' } })
    fireEvent.click(screen.getByRole('button', { name: 'Activate' }))
    await waitFor(() => expect(screen.getByTestId('physical-card-pc_1').textContent).toContain('Active'))
    expect(posts[1]).toEqual(['/api/money/physical-cards/pc_1/activate', { last4: '4242' }])
    expect(screen.getByRole('link', { name: 'Set or view your PIN' }).getAttribute('href')).toBe('https://partner.example/pin')

    fireEvent.change(screen.getByLabelText('What happened to the card'), { target: { value: 'stolen' } })
    fireEvent.click(screen.getByRole('button', { name: 'Freeze and replace' }))
    await waitFor(() => expect(screen.getByTestId('physical-card-pc_1').textContent).toContain('Frozen'))
    expect(posts[2]).toEqual(['/api/money/physical-cards/pc_1/replace', { reason: 'stolen' }])
    expect(screen.getByTestId('physical-card-pc_2').textContent).toContain('Card ending 5151 · Not yet active')
  })

  it('shows nothing while Lens’s switch is off', async () => {
    mockBff(false, [])
    window.history.pushState({}, '', '/money/card')
    render(<App />)
    await waitFor(() => expect(window.location.pathname).toBe('/money/spending'))
    expect(screen.queryByRole('link', { name: 'Your Talyvor Card' })).toBeNull()
  })
})
