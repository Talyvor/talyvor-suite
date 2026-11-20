import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from './App'

// B61.121 — a payment opens in the right panel over the page it was opened from (DESIGN.md section 7, choice 9: details
// open in a right panel, never a new page). Activity stays drawn behind it; Esc closes it and focus is back on the row;
// the payment's own address opens the same panel with Activity behind it.

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
const KITE = { entry_id: 'ent_kite', line: 1, at: '2026-11-03T10:00:00Z', kind: 'payment_out', amount_minor: -45_000, funding: 'test', counterparty: 'Kite Accounting', memo: 'October bookkeeping', balance_after_minor: 0 }

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input).split('?')[0]
    if (url === '/auth/me') return json({ mode: 'oidc', authenticated: true, user: { sub: 's1', email: 'nick@example.com' } })
    if (url === '/api/workspace/name') return json({ id: 'ws_1', name: 'Nick’s team' })
    if (url === '/api/agents') return json({ workspace_balance_ulxc: 0, allocated_ulxc: 0, unallocated_ulxc: 0, spent_ulxc: 0, agents: [] })
    if (url === '/api/money/accounts')
      return json({ accounts: [{ id: 'acct_usd', currency: 'USD', agent_id: '', purpose: 'company', status: 'open', name: 'acct_usd', balance_minor: 0, test_minor: 0, live_minor: 0 }] })
    if (url === '/api/money/accounts/acct_usd/statement')
      return json({ account_id: 'acct_usd', currency: 'USD', opening_minor: 0, in_minor: 0, out_minor: 0, closing_minor: 0, lines: [KITE] })
    return new Response('null', { status: 404 })
  })
})

afterEach(() => {
  cleanup()
  queryClient.clear()
  vi.restoreAllMocks()
})

function at(address: string) {
  window.history.pushState({}, '', address)
  render(<App />)
}

// Activity's list, drawn in the page's main (not in the panel).
async function behind() {
  const list = await screen.findByTestId('activity', {}, { timeout: 4000 })
  expect(list.closest('main')).not.toBeNull()
  return list
}

describe('a payment opens in the right panel', () => {
  it('opens over Activity, which stays drawn behind it, and Esc closes it with focus back on the row', async () => {
    at('/activity')
    const row = await within(await behind()).findByTestId('activity-row')
    row.focus()
    fireEvent.click(row)
    const panel = await screen.findByRole('dialog', { name: 'Kite Accounting' })
    expect(within(panel).getByTestId('activity-payment').textContent).toContain('−$450.00')
    expect(window.location.pathname).toBe('/activity/acct_usd/ent_kite')
    // The page it was opened from is the same page, still there: the very row pressed, and Activity's heading.
    expect(within(await behind()).getByTestId('activity-row')).toBe(row)
    expect(within(screen.getByRole('main')).getByRole('heading', { level: 1, name: 'Activity' })).toBeInTheDocument()
    fireEvent.keyDown(panel, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(window.location.pathname).toBe('/activity')
    expect(document.activeElement).toBe(row)
  })

  it('opens straight at its own address with Activity drawn behind it', async () => {
    at('/activity/acct_usd/ent_kite')
    const panel = await screen.findByRole('dialog', { name: 'Kite Accounting' })
    expect(await within(panel).findByTestId('activity-payment')).toBeInTheDocument()
    expect(await within(await behind()).findByTestId('activity-row')).toBeInTheDocument()
    fireEvent.click(within(panel).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(window.location.pathname).toBe('/activity')
    expect(await within(await behind()).findByTestId('activity-row')).toBeInTheDocument()
  })
})
