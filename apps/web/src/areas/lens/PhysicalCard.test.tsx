import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'
import { populatedBff, settleQueries } from '../../populatedBff'
import { pressAll } from '../../test/pressEverything'
import { PhysicalCardScreen } from './PhysicalCard'

// B53.12 — /money/card on a Lens that serves physical cards: order one (only its fields reach the BFF), activate it
// with the last four digits once it has shipped, and freeze and replace it when lost. On a Lens whose switch is off
// (404) /money/card lands on Spending, which shows no link to it; on one that serves them, Spending links to it.
// B57.97 — drawn in Pocket (reference w-card, card-order, card-activate, card-replace), in every state Lens has.

const address = { line1: '1 High St', line2: '', city: 'London', postcode: 'N1 9GU', country: 'GB' }
const card = (p: Record<string, unknown>) => ({ id: 'pc_1', last4: '4242', state: 'inactive', design: 'standard', name_on_card: 'Ada Owner', address,
  delivery: { status: 'ordered', updated_at: '2026-11-05T09:00:00Z' }, pin_url: '', replaces: '', replaced_by: '', created_at: '2026-11-05T09:00:00Z', ...p })

function mockBff(served: boolean, posts: [string, unknown][], start: unknown[] = []) {
  let cards = start
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

async function openCard(start: unknown[]) {
  mockBff(true, [], start)
  window.history.pushState({}, '', '/money/card')
  render(<App />)
  return screen.findByRole('heading', { name: 'Your Talyvor Card' })
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  queryClient.clear()
})

describe('the physical Talyvor Card (B53.12, in Pocket by B57.97)', () => {
  it('orders, activates on arrival, and freezes and replaces a lost card, each through its dialog', async () => {
    const posts: [string, unknown][] = []
    const bff = mockBff(true, posts)
    window.history.pushState({}, '', '/money/spending')
    render(<App />)
    fireEvent.click(await screen.findByRole('link', { name: 'Your Talyvor Card' }))

    fireEvent.change(await screen.findByLabelText('Name on the card'), { target: { value: 'Ada Owner' } })
    fireEvent.change(screen.getByLabelText('Address line 1'), { target: { value: '1 High St' } })
    fireEvent.change(screen.getByLabelText('Town or city'), { target: { value: 'London' } })
    fireEvent.change(screen.getByLabelText('Postcode'), { target: { value: 'N1 9GU' } })
    fireEvent.click(screen.getByRole('button', { name: 'Order the card' }))
    const order = screen.getByRole('dialog', { name: 'Order a Talyvor Card?' })
    expect(order.textContent).toContain('It is posted to 1 High St, London N1 9GU, and arrives switched off.')
    fireEvent.click(within(order).getByRole('button', { name: 'Order it' }))
    await waitFor(() => expect(screen.getByTestId('physical-card-pc_1').textContent).toContain('Ordered. The partner is making it, then posts it to you.'))
    expect(posts[0]).toEqual(['/api/money/physical-cards', { name_on_card: 'Ada Owner', address }])
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('status').textContent).toContain('Ordered')
    expect(screen.queryByRole('heading', { name: 'Order a card' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Activate' })).toBeNull()

    bff.ship()
    await queryClient.invalidateQueries()
    fireEvent.click(await screen.findByRole('button', { name: 'Activate' }))
    const activate = screen.getByRole('dialog', { name: 'Activate your card' })
    fireEvent.change(within(activate).getByLabelText('Last four digits on the card'), { target: { value: '4242' } })
    fireEvent.click(within(activate).getByRole('button', { name: 'Activate' }))
    await waitFor(() => expect(within(screen.getByTestId('physical-card-pc_1')).getByText('Active')).toBeTruthy())
    expect(posts[1]).toEqual(['/api/money/physical-cards/pc_1/activate', { last4: '4242' }])
    expect(screen.getByRole('link', { name: 'Set or view your PIN' }).getAttribute('href')).toBe('https://partner.example/pin')

    fireEvent.click(screen.getByRole('button', { name: 'Lost, stolen or damaged' }))
    const lost = screen.getByRole('dialog', { name: 'What happened to the card?' })
    fireEvent.click(within(lost).getByRole('button', { name: 'Stolen' }))
    fireEvent.click(within(lost).getByRole('button', { name: 'Freeze and replace' }))
    await waitFor(() => expect(screen.getByTestId('physical-card-pc_1').textContent).toContain('Frozen and replaced. The new card is listed below.'))
    expect(posts[2]).toEqual(['/api/money/physical-cards/pc_1/replace', { reason: 'stolen' }])
    expect(screen.getByTestId('physical-card-pc_2').textContent).toContain('Card ending 5151')
    expect(screen.getByTestId('physical-card-pc_2').textContent).toContain('On its way to the same address. Activate it when it arrives.')
  })

  it('draws each state Lens has, in Pocket', async () => {
    await openCard([])
    expect(screen.getByRole('heading', { name: 'Your Talyvor Card' }).closest('[data-design]')?.getAttribute('data-design')).toBe('pocket')
    expect(await screen.findByText('No card yet.')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Order a card' })).toBeTruthy()
    cleanup()
    queryClient.clear()

    const states: [Record<string, unknown>, string, string][] = [
      [{}, 'Ordered. The partner is making it, then posts it to you.', 'Not yet active'],
      [{ delivery: { status: 'shipped', updated_at: '2026-11-06T09:00:00Z' } }, 'Posted. It is on its way to you.', 'Not yet active'],
      [{ state: 'active', delivery: { status: 'delivered', updated_at: '2026-11-07T09:00:00Z' } }, 'Active · Ada Owner', 'Active'],
      [{ state: 'frozen' }, 'Frozen. It cannot be used.', 'Frozen'],
      [{ state: 'closed' }, 'Closed.', 'Closed'],
    ]
    for (const [p, line, chip] of states) {
      await openCard([card(p)])
      const row = await screen.findByTestId('physical-card-pc_1')
      expect(row.textContent).toContain(line)
      expect(within(row).getByText(chip)).toBeTruthy()
      expect(!!within(row).queryByRole('button', { name: 'Activate' })).toBe(line.startsWith('Posted'))
      expect(!!within(row).queryByRole('button', { name: 'Lost, stolen or damaged' })).toBe(chip === 'Active')
      // A frozen or closed card does not stop a new order; one on its way or in use does.
      expect(!!screen.queryByRole('heading', { name: 'Order a card' })).toBe(chip === 'Frozen' || chip === 'Closed')
      expect(!!screen.queryByRole('heading', { name: 'Where it is posted' })).toBe(chip !== 'Frozen' && chip !== 'Closed')
      cleanup()
      queryClient.clear()
    }

    await openCard([card({ state: 'frozen', replaced_by: 'pc_2' }), card({ id: 'pc_2', last4: '5151', replaces: 'pc_1' })])
    expect(within(await screen.findByTestId('physical-card-pc_1')).getByText('Replaced')).toBeTruthy()
    expect(screen.getByText('1 High St, London, N1 9GU, GB')).toBeTruthy()
  })

  it('every control on the page does something', async () => {
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    const { asked } = populatedBff((impl) => vi.spyOn(globalThis, 'fetch').mockImplementation(impl))
    const report = await pressAll(
      async () => {
        queryClient.clear()
        window.history.pushState({}, '', '/money/card')
        // The page itself, in its Pocket scope: the shell around it is B57.8's to press.
        render(
          <QueryClientProvider client={queryClient}>
            <BrowserRouter>
              <div data-design="pocket">
                <Routes>
                  <Route path="/money/card" element={<PhysicalCardScreen />} />
                  <Route path="/money/spending" element={<p>Spending</p>} />
                </Routes>
              </div>
            </BrowserRouter>
          </QueryClientProvider>,
        )
        await settleQueries(queryClient, waitFor)
      },
      () => asked.length,
    )
    expect(report.pressed).toBeGreaterThan(0)
    expect(report.dead).toEqual([])
  }, 120_000)

  it('shows nothing while Lens’s switch is off', async () => {
    mockBff(false, [])
    window.history.pushState({}, '', '/money/card')
    render(<App />)
    await waitFor(() => expect(window.location.pathname).toBe('/money/spending'))
    expect(screen.queryByRole('link', { name: 'Your Talyvor Card' })).toBeNull()
  })
})

// B57.127 — the owner's own card wears its tier art: Daily for a Personal account, Team for a Business (whatever its
// money, as B59.10 keeps personal tiers off a Business), Stablecoin Daily for a Personal stablecoin-only one. The tier choice beside it is a picture only: it is kept in this browser, sends nothing to
// Lens, and changes nothing else on the page.
describe('the owner’s own card face (B57.127)', () => {
  const requests: string[] = []
  function mockAccount(account: { account_type: string; money_kind: string }, name = { id: 'ws_1', name: 'Acme Labs' }) {
    requests.length = 0
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      requests.push(`${init?.method ?? 'GET'} ${url}`)
      const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'Content-Type': 'application/json' } })
      if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
      if (url === '/api/workspace/account') return json(account)
      if (url === '/api/workspace/name') return json(name)
      if (url === '/api/money/physical-cards') return json({ cards: [card({ state: 'active' })] })
      return new Response('null', { status: 404 })
    })
  }
  const face = () => screen.findByRole('img', { name: /card$/ })

  beforeEach(() => window.localStorage.clear())

  it.each([
    [{ account_type: 'business', money_kind: 'fiat' }, 'team', 'Acme Labs, Team corporate card', 'For your team and its agents'],
    [{ account_type: 'business', money_kind: 'stablecoin' }, 'team', 'Acme Labs, Team corporate card', 'For your team and its agents'],
    [{ account_type: 'personal', money_kind: 'fiat' }, 'daily', 'Acme Labs, Daily personal card', 'Your everyday account'],
    [{ account_type: 'personal', money_kind: 'stablecoin' }, 'stable', 'Acme Labs, Daily stablecoin card', 'Spends from your own wallet'],
  ])('%o shows the %s face by default', async (account, id, alt, sub) => {
    mockAccount(account)
    await openCardPage()
    const shown = await screen.findByRole('img', { name: alt })
    expect(shown).toHaveAttribute('data-card', id)
    expect(shown).toHaveTextContent(sub)
  })

  it('names the card by its family while the workspace is still called by its id', async () => {
    mockAccount({ account_type: 'business', money_kind: 'fiat' }, { id: 'ws_1', name: 'ws_1' })
    await openCardPage()
    expect(await face()).toHaveAccessibleName('Company card, Team corporate card')
  })

  it('switching the display tier changes only the picture, sends nothing to Lens, and is kept in this browser', async () => {
    mockAccount({ account_type: 'business', money_kind: 'fiat' })
    await openCardPage()
    await screen.findByRole('img', { name: 'Acme Labs, Team corporate card' })
    await settleQueries(queryClient, waitFor)
    const outside = () => {
      const page = screen.getByRole('heading', { name: 'Your Talyvor Card' }).closest('.grid')!.parentElement!.cloneNode(true) as HTMLElement
      page.querySelector('[data-testid="owner-card-face"]')?.remove()
      return page.textContent
    }
    const before = outside()
    const sent = requests.length

    const tiers = screen.getByRole('tablist', { name: 'Card tier' })
    expect(within(tiers).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Team', 'Business', 'Enterprise'])
    fireEvent.click(within(tiers).getByRole('tab', { name: 'Enterprise' }))

    const shown = await screen.findByRole('img', { name: 'Acme Labs, Enterprise corporate card' })
    expect(shown).toHaveAttribute('data-card', 'enterprise')
    expect(requests.slice(sent)).toEqual([])
    expect(outside()).toBe(before)

    // A fresh page in the same browser opens on the face chosen.
    cleanup()
    queryClient.clear()
    await openCardPage()
    expect(await screen.findByRole('img', { name: 'Acme Labs, Enterprise corporate card' })).toHaveAttribute('data-card', 'enterprise')
  })

  // B57.143 — drawn in Pocket, as W4 draws a card and Settings draws a display choice: the art 312 wide on a white
  // Pocket card, and beside it the choice under its own heading with its line.
  it('draws the card and its tier choice on a white Pocket card, the art 312 wide', async () => {
    mockAccount({ account_type: 'personal', money_kind: 'fiat' })
    await openCardPage()
    const shown = await screen.findByRole('img', { name: 'Acme Labs, Daily personal card' })
    expect(shown.parentElement!.className).toContain('max-w-78')

    const panel = screen.getByTestId('owner-card-face')
    expect(panel.className).toContain('bg-page')
    expect(panel.className).toContain('shadow-pocket')
    const heading = within(panel).getByRole('heading', { level: 3, name: 'Card tier' })
    const choice = heading.parentElement!
    expect(within(choice).getByText('Shows your card in another tier. Only the picture changes.')).toBeTruthy()
    expect(within(choice).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Daily', 'Premium', 'Platinum'])
  })

  async function openCardPage() {
    window.history.pushState({}, '', '/money/card')
    render(<App />)
    await screen.findByRole('heading', { name: 'Your Talyvor Card' })
  }
})
