import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from './App'
import { populatedBff, settleQueries } from './populatedBff'
import { areaSource } from './lib/workspaceAreas'

// B61.3 — the sidebar is the approved seven (launch-pack DESIGN.md W2), on either type of account, and every page that
// left it opens from where a person looks for it: Activity's tabs, Pay's Invoices tab on a Business, and Settings' Plan
// and (on a Business) Developers rows. Spend and routing and the Try pages are the old gateway's.

const SEVEN = ['Home', 'Agents', 'Cards', 'Pay', 'Approvals', 'Activity', 'Settings']

async function at(address: string, account_type: 'business' | 'personal') {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  populatedBff((impl) => vi.spyOn(globalThis, 'fetch').mockImplementation(impl as never), {
    '/api/workspace/account': { account_type, money_kind: 'hybrid' },
  })
  window.history.pushState({}, '', address)
  render(<App />)
  const nav = await screen.findByRole('navigation', { name: 'Sections' })
  await settleQueries(queryClient, waitFor)
  return { nav, main: document.querySelector('main') as HTMLElement }
}

const rows = (nav: HTMLElement) =>
  within(nav)
    .getAllByRole('link')
    .filter((a) => a.getAttribute('aria-label') === null && !['/privacy', '/terms'].includes(a.getAttribute('href') ?? ''))
    .map((a) => (a.querySelector('.truncate')?.textContent ?? '').trim())

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  queryClient.clear()
  document.body.replaceChildren()
})

describe.each(['business', 'personal'] as const)('a %s account', (type) => {
  const business = type === 'business'

  it('the sidebar is exactly the seven, in order', async () => {
    const { nav } = await at('/', type)
    expect(rows(nav)).toEqual(SEVEN)
  })

  it('Activity opens Statements, Spending, Budgets and Subscriptions as its tabs, Activity first', async () => {
    const { main } = await at('/activity', type)
    const tabs = within(main).getByRole('tablist', { name: 'Activity' })
    expect(within(tabs).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Activity', 'Statements', 'Spending', 'Budgets', 'Subscriptions'])
    for (const [tab, path] of [['Statements', '/statements'], ['Spending', '/money/spending'], ['Budgets', '/money/budgets'], ['Subscriptions', '/money/subscriptions']]) {
      fireEvent.click(within(screen.getByRole('tablist', { name: 'Activity' })).getByRole('tab', { name: tab }))
      await waitFor(() => expect(window.location.pathname).toBe(path))
      expect(within(screen.getByRole('tablist', { name: 'Activity' })).getByRole('tab', { name: tab }).getAttribute('aria-selected')).toBe('true')
    }
  })

  it('Invoices is a tab of Pay only on a Business account', async () => {
    const { main } = await at('/money/pay', type)
    const tabs = within(main).queryByRole('tablist', { name: 'Pay' })
    if (!business) {
      expect(tabs).toBeNull()
      return
    }
    expect(within(tabs!).getAllByRole('tab').map((t) => t.textContent)).toEqual(['One payment', 'Invoices'])
    fireEvent.click(within(tabs!).getByRole('tab', { name: 'Invoices' }))
    await waitFor(() => expect(window.location.pathname).toBe('/money/invoices'))
  })

  it('Settings has Plan, and Developers last only on a Business account', async () => {
    const { main } = await at('/settings', type)
    const pages = within(main).getByRole('navigation', { name: 'Settings pages' })
    expect(within(pages).getByRole('link', { name: /^Plan/ }).getAttribute('href')).toBe('/billing')
    expect(within(pages).queryByRole('link', { name: /^Billing/ })).toBeNull()
    const links = within(pages).getAllByRole('link')
    const developers = within(pages).queryByRole('link', { name: /^Developers/ })
    expect(developers !== null).toBe(business)
    if (business) {
      expect(links[links.length - 1]).toBe(developers)
      expect(developers!.getAttribute('href')).toBe('/setup')
    }
  })

  it('the command palette finds each moved page under its new place', async () => {
    await at('/', type)
    fireEvent.click(screen.getByRole('button', { name: 'Search agents, payees, bills… or type a command' }))
    const options = within(screen.getByRole('listbox', { name: 'Commands' }))
      .queryAllByRole('option')
      .map((o) => (o.textContent ?? '').trim())
    expect(options).toContain('Statements · in Activity')
    expect(options).toContain('Billing · in Settings')
    expect(options.includes('Invoices · in Pay')).toBe(business)
    expect(options.includes('API keys · in Settings')).toBe(business)
  })
})

describe('the old gateway (B61.3)', () => {
  it('Spend and routing and the Try pages open Home, with nothing linking them', async () => {
    areaSource.read = () => Promise.resolve([])
    areaSource.initial = []
    for (const path of ['/spend', '/features/try/tare', '/features/try/conversion']) {
      const { nav } = await at(path, 'business')
      await waitFor(() => expect(window.location.pathname).toBe('/'))
      expect(within(nav).queryAllByRole('link').map((a) => a.getAttribute('href'))).not.toContain('/spend')
      cleanup()
      queryClient.clear()
      vi.restoreAllMocks()
    }
    const { main } = await at('/setup', 'business')
    expect(within(within(main).getByRole('tablist', { name: 'Developers' })).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Connect an agent', 'API keys'])
  })
})
