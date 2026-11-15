import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { App, queryClient } from './App'
import { historyKey } from './areas/chat/history'
import { SHORTCUTS_LINE } from './components/CommandPalette'
import { populatedBff, settleQueries } from './populatedBff'
import { pressAll } from './test/pressEverything'

// B28.135 — the command palette and the keyboard shortcuts. Drives the real <App />: the keys are pressed on the page,
// and what is asserted is the screen a person is left on. B57.9 — the bar in Pocket: every agent, payee and page in it.

const CATALOG = [
  { id: 'claude-opus-5', provider: 'anthropic', display_name: 'Claude Opus 5', input_per_1m: 5, output_per_1m: 25, release_date: '2026-07-24', tier: 'frontier' },
  { id: 'gpt-4o', provider: 'openai', display_name: 'GPT-4o', input_per_1m: 2.5, output_per_1m: 10, release_date: '2024-05-13', tier: 'balanced' },
]
const QUESTION = 'Where does the kestrel nest?'

function mockBff() {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
    const url = String(input)
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/models') return json(CATALOG)
    if (url === '/api/ai/providers') return json({ unconfigured: [] })
    return new Response('null', { status: 404 })
  })
  // One saved conversation, which Chat reopens: a new chat is the thread gone with the conversation still listed.
  window.localStorage.setItem(
    historyKey('local'),
    JSON.stringify([
      {
        id: 'c-1', title: QUESTION, renamed: false, model_id: 'claude-opus-5', created_at: 1, updated_at: 1,
        messages: [{ role: 'user', content: QUESTION }, { role: 'assistant', content: 'On the north cliff.' }],
      },
    ]),
  )
}

async function mountAt(address: string): Promise<void> {
  window.history.pushState({}, '', address)
  render(<App />)
  await screen.findByRole('navigation', { name: /sections/i })
}

const press = (key: string, code: string, mods: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean } = {}, on: Element = document.body) =>
  fireEvent.keyDown(on, { key, code, ...mods })

async function openPalette(): Promise<HTMLElement> {
  press('k', 'KeyK', { ctrlKey: true })
  return screen.findByRole('dialog', { name: 'Command palette' })
}

beforeEach(mockBff)
afterEach(() => {
  cleanup()
  queryClient.clear()
  vi.restoreAllMocks()
  window.localStorage.clear()
})

describe('the command palette (B28.135)', () => {
  it('opens with Ctrl+K on any screen, and a page typed and chosen with Enter opens', async () => {
    await mountAt('/settings')
    const palette = await openPalette()
    const box = within(palette).getByRole('combobox', { name: 'Search, or type a command' })
    expect(box).toHaveFocus()
    fireEvent.change(box, { target: { value: 'ledger' } })
    expect(within(palette).getByRole('option', { name: 'Ledger' })).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(window.location.pathname).toBe('/ledger')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Ledger')
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).toBeNull()
  })

  it('New chat leaves the open conversation for an empty one, which is still listed', async () => {
    await mountAt('/chat')
    await screen.findByTestId('turn-user')
    const palette = await openPalette()
    fireEvent.click(within(palette).getByRole('option', { name: /^New chat/ }))
    await waitFor(() => expect(screen.queryByTestId('turn-user')).toBeNull())
    expect(within(screen.getByRole('list', { name: 'Saved conversations' })).getByRole('button', { name: QUESTION })).toBeInTheDocument()
  })

  it('words that name no command search the conversations for them', async () => {
    await mountAt('/settings')
    const palette = await openPalette()
    fireEvent.change(within(palette).getByRole('combobox'), { target: { value: 'kestrel' } })
    fireEvent.click(within(palette).getByRole('option', { name: 'Search conversations for “kestrel”' }))
    expect(window.location.pathname).toBe('/chat')
    const search = await screen.findByRole('searchbox', { name: 'Search conversations' })
    expect(search).toHaveValue('kestrel')
    await waitFor(() => expect(search).toHaveFocus())
    expect(within(await screen.findByRole('list', { name: 'Conversations found' })).getByText(QUESTION)).toBeInTheDocument()
  })

  it('Switch model opens the model picker on its search box', async () => {
    await mountAt('/chat')
    await screen.findByRole('button', { name: 'Model: Claude Opus 5' })
    const palette = await openPalette()
    fireEvent.click(within(palette).getByRole('option', { name: 'Switch model' }))
    expect(await screen.findByRole('listbox', { name: 'Models' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Search models' })).toHaveFocus()
  })
})

describe('the keyboard shortcuts (B28.135)', () => {
  it('Ctrl+/ says the shortcuts in a message', async () => {
    await mountAt('/settings')
    press('/', 'Slash', { ctrlKey: true })
    expect(await screen.findByText(SHORTCUTS_LINE)).toBeInTheDocument()
  })

  it('Ctrl+Shift+O opens Chat on a new chat from another screen', async () => {
    await mountAt('/settings')
    press('O', 'KeyO', { ctrlKey: true, shiftKey: true })
    expect(window.location.pathname).toBe('/chat')
    await screen.findByRole('list', { name: 'Saved conversations' })
    // Turns are drawn once the catalog is read; until then no thread is on screen, new or not.
    await screen.findByRole('button', { name: 'Model: Claude Opus 5' })
    expect(screen.queryByTestId('turn-user')).toBeNull()
  })

  it('/ opens the one search, but typed in the message box it is only a slash', async () => {
    await mountAt('/chat')
    const message = await screen.findByLabelText('Your message')
    press('/', 'Slash', {}, message)
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).toBeNull()
    press('/', 'Slash')
    const palette = await screen.findByRole('dialog', { name: 'Command palette' })
    expect(within(palette).getByRole('combobox', { name: 'Search, or type a command' })).toHaveFocus()
  })
})

async function mountPopulated(address: string): Promise<string[]> {
  vi.restoreAllMocks()
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  const { asked } = populatedBff((impl) => vi.spyOn(globalThis, 'fetch').mockImplementation(impl))
  await mountAt(address)
  return asked
}

const group = (bar: HTMLElement, name: string) => within(within(bar).getByRole('group', { name }))

describe('the one search box (B41.7)', () => {
  it('a supplier’s name finds its payee, its payment and its bill, grouped, and the bill opens on its own row', async () => {
    const asked = await mountPopulated('/settings')
    const palette = await openPalette()
    fireEvent.change(within(palette).getByRole('combobox', { name: 'Search, or type a command' }), { target: { value: 'acme' } })
    const bills = await within(palette).findByRole('group', { name: 'Bills and invoices' }, { timeout: 2000 })
    expect(asked).toContain('/api/money/search?q=acme')
    expect(within(palette).getAllByRole('group').map((g) => g.getAttribute('aria-label'))).toEqual(['Payees', 'Bills and invoices', 'Payments', 'Conversations'])
    expect(group(palette, 'Payees').getAllByRole('option').map((o) => o.textContent)).toEqual(['Acme Hosting Ltd'])
    expect(group(palette, 'Payments').getByRole('option')).toHaveTextContent('Acme Hosting Ltd · October hosting · £20.00')
    const bill = within(bills).getByRole('option')
    expect(bill).toHaveTextContent('Acme Hosting Ltd · INV-2041 · £120.00')
    fireEvent.click(bill)
    expect(window.location.pathname).toBe('/money/pay/bills') // B57.32: bills have their own page under Pay
    expect(window.location.hash).toBe('#bill-bill_1')
    await waitFor(() => expect(screen.getByTestId('bill-bill_1')).toHaveAttribute('data-linked', 'true'))
  })
})

describe('the ⌘K bar in Pocket (B57.9)', () => {
  it('lists Actions, every agent, every saved payee and every page before a word is typed', async () => {
    await mountPopulated('/settings')
    const bar = await openPalette()
    await within(bar).findByRole('group', { name: 'Payees' })
    await within(bar).findByRole('group', { name: 'Agents' })
    expect(within(bar).getByRole('combobox')).toHaveAttribute('placeholder', 'Search agents, payees, bills… or type a command')
    expect(within(bar).getAllByRole('group').map((g) => g.getAttribute('aria-label'))).toEqual(['Actions', 'Agents', 'Payees', 'Pages'])
    expect(group(bar, 'Actions').getAllByRole('option').map((o) => o.textContent)).toContain('Keyboard shortcuts')
    expect(group(bar, 'Agents').getAllByRole('option').map((o) => o.textContent)).toEqual(['Researcher', 'Writer'])
    expect(group(bar, 'Payees').getAllByRole('option').map((o) => o.textContent)).toEqual(['Acme Hosting Ltd', 'Nord Research GmbH'])
    const pages = group(bar, 'Pages').getAllByRole('option').map((o) => o.textContent)
    for (const page of ['Home', 'Approvals', 'Agents', 'Statements', 'Pay', 'Invoices', 'Settings', 'Ledger']) expect(pages).toContain(page)
    expect(screen.getByText('Enter to choose · Esc to close')).toBeInTheDocument()
  })

  it('an agent chosen opens its own page', async () => {
    await mountPopulated('/settings')
    const bar = await openPalette()
    fireEvent.click(await within(bar).findByRole('option', { name: 'Writer' }))
    expect(window.location.pathname).toBe('/agents/agt_writer')
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).toBeNull()
  })

  it('a payee chosen lands on Pay with that payee filled in', async () => {
    await mountPopulated('/settings')
    const bar = await openPalette()
    fireEvent.click(await within(bar).findByRole('option', { name: 'Nord Research GmbH' }))
    expect(window.location.pathname).toBe('/money/pay')
    const form = await screen.findByTestId('send-payment')
    await waitFor(() => expect((within(form).getByLabelText('To') as HTMLSelectElement).value).toBe('payee_2'))
  })

  it('the arrows move down the bar as it reads, Enter chooses and Esc closes', async () => {
    await mountPopulated('/settings')
    const bar = await openPalette()
    await within(bar).findByRole('group', { name: 'Payees' })
    const box = within(bar).getByRole('combobox')
    fireEvent.change(box, { target: { value: 'r' } })
    const options = within(bar).getAllByRole('option')
    expect(options[0]).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(box, { key: 'ArrowDown' })
    expect(options[1]).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(box, { key: 'ArrowUp' })
    fireEvent.keyDown(box, { key: 'ArrowUp' })
    expect(options[options.length - 1]).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(box, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Command palette' })).toBeNull())
    expect(window.location.pathname).toBe('/settings')
  })

  it('Keyboard shortcuts shows its message and closes the bar', async () => {
    await mountPopulated('/settings')
    const bar = await openPalette()
    fireEvent.click(within(bar).getByRole('option', { name: 'Keyboard shortcuts' }))
    expect(await screen.findByText(SHORTCUTS_LINE)).toBeInTheDocument()
    expect(SHORTCUTS_LINE).toMatch(/^(⌘K|Ctrl\+K) opens this bar · \/ searches when you are not typing · Esc closes$/)
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).toBeNull()
  })

  it('every control on the open bar does something', async () => {
    vi.restoreAllMocks()
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    const { asked } = populatedBff((impl) => vi.spyOn(globalThis, 'fetch').mockImplementation(impl))
    const report = await pressAll(
      async () => {
        queryClient.clear()
        window.history.pushState({}, '', '/settings')
        render(<App />)
        await screen.findByRole('navigation', { name: /sections/i })
        await openPalette()
        await settleQueries(queryClient, waitFor)
      },
      () => asked.length,
    )
    expect(report.pressed).toBeGreaterThan(0)
    expect(report.dead).toEqual([])
  }, 60_000)
})
