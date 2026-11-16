import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'
import { populatedBff, settleQueries } from '../../populatedBff'
import { pressEverything } from '../../test/pressEverything'

// B61.9 — the sidebar's account tile opens "Your accounts" (Pocket Live's `accounts`): every account the person holds,
// the current one marked, then "Open another account", which runs sign-up's steps and lands in the new account. A
// pick switches (the BFF's B61.8) and Home comes back with that account's words.

type Acct = { id: string; name: string; type: 'business' | 'personal'; kind: 'fiat' | 'stablecoin' | 'hybrid' }

const NORTHWIND: Acct = { id: 'ws_n', name: 'Northwind Studio', type: 'business', kind: 'hybrid' }
const MAYA: Acct = { id: 'ws_m', name: 'Maya Lind', type: 'personal', kind: 'fiat' }

/** A BFF whose session is on one of `held` and moves on a switch or an open, as accounts.go does. */
function bff(held: Acct[]) {
  const accounts = [...held]
  let current = accounts[0]!.id
  const posted: { path: string; body: unknown }[] = []
  let base: (input: unknown) => Promise<Response> = async () => new Response('null', { status: 404 })
  populatedBff((impl) => {
    base = impl
  })
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  vi.spyOn(globalThis, 'fetch').mockImplementation((async (input: unknown, init?: RequestInit) => {
    const path = String(input)
    const on = accounts.find((a) => a.id === current)!
    if (init?.method === 'POST' && (path === '/api/accounts/switch' || path === '/api/accounts')) {
      const body = JSON.parse(String(init.body)) as Record<string, string>
      posted.push({ path, body })
      if (path === '/api/accounts/switch') {
        if (!accounts.some((a) => a.id === body.account_id)) return json({ error: 'no such account' }, 404)
        current = body.account_id!
      } else {
        const made: Acct = { id: `ws_${accounts.length + 1}`, name: body.name!, type: body.type as Acct['type'], kind: body.kind as Acct['kind'] }
        accounts.push(made)
        current = made.id
      }
      return json({ account_id: current, created: path === '/api/accounts' })
    }
    if (path === '/api/accounts') {
      return json({ accounts: accounts.map((a) => ({ ...a, opened_at: '2026-11-15T00:00:00Z', current: a.id === current })) })
    }
    if (path === '/api/workspace/name') return json({ id: on.id, name: on.name })
    if (path === '/api/workspace/account') return json({ account_type: on.type, money_kind: on.kind })
    return base(input)
  }) as never)
  return { posted, current: () => accounts.find((a) => a.id === current)! }
}

async function at(address: string) {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  window.history.pushState({}, '', address)
  render(<App />)
  await settleQueries(queryClient, waitFor)
}

async function openSheet() {
  fireEvent.click(await screen.findByTestId('sidebar-workspace'))
  return screen.findByRole('dialog', { name: 'Your accounts' })
}

const rows = async (sheet: HTMLElement) =>
  (await within(sheet).findAllByTestId('account-row')).map((r) => ({ text: r.textContent, current: r.getAttribute('aria-current') === 'true' }))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  queryClient.clear()
  document.body.replaceChildren()
})

describe('Your accounts', () => {
  it('lists both accounts with the current one marked, and a pick reloads Home with the other account’s words', async () => {
    const server = bff([NORTHWIND, MAYA])
    await at('/')
    expect(within(document.querySelector('main')!).getByText('Your company’s total')).toBeTruthy()
    const sheet = await openSheet()
    expect(await rows(sheet)).toEqual([
      { text: 'NNorthwind StudioBusiness · HybridCurrent', current: true },
      { text: 'MMaya LindPersonal · Fiat', current: false },
    ])
    expect(within(sheet).getByRole('link', { name: 'Open another account' }).getAttribute('href')).toBe('/accounts/new')
    expect(within(sheet).getByText('Each account has one kind of money. Another kind is another account.')).toBeTruthy()

    fireEvent.click(within(sheet).getByRole('button', { name: /Maya Lind/ }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Your accounts' })).toBeNull())
    expect(server.posted).toEqual([{ path: '/api/accounts/switch', body: { account_id: 'ws_m' } }])
    expect(window.location.pathname).toBe('/')
    await waitFor(() => expect(screen.getByTestId('sidebar-workspace-name').textContent).toBe('Maya Lind'))
    await settleQueries(queryClient, waitFor)
    const main = document.querySelector('main')!
    expect(within(main).getByText('Your total')).toBeTruthy()
    expect(within(main).queryByText('Your company’s total')).toBeNull()
    expect(screen.getByTestId('sidebar-account-chip').textContent).toBe('Personal · Fiat')
  })

  it('with one account, shows its row and then the button', async () => {
    bff([NORTHWIND])
    await at('/')
    const sheet = await openSheet()
    expect((await rows(sheet)).map((r) => r.current)).toEqual([true])
    expect(within(sheet).getByRole('link', { name: 'Open another account' })).toBeTruthy()
  })

  it('Settings’ two sentences open the sheet', async () => {
    bff([NORTHWIND, MAYA])
    await at('/settings')
    const kind = await screen.findByTestId('settings-money-kind')
    fireEvent.click(within(kind).getByRole('link', { name: 'open another account' }))
    expect(await screen.findByRole('dialog', { name: 'Your accounts' })).toBeTruthy()
    expect(within(screen.getByTestId('settings-account-type')).getByRole('link', { name: 'open another account' })).toBeTruthy()
  })

  it('Open another account as Personal lands in a new Personal account, at its identity check', async () => {
    const server = bff([NORTHWIND])
    await at('/accounts/new')
    expect(screen.getByText('Step 1 of 3')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Sign in instead' })).toBeNull()
    fireEvent.click(screen.getByRole('radio', { name: /Personal/ }))
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Maya Lind' } })
    fireEvent.change(screen.getByLabelText('Country'), { target: { value: 'GB' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.click(await screen.findByRole('radio', { name: /Fiat only/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(window.location.pathname).toBe('/accounts/new/confirm'))
    expect(server.posted).toEqual([{ path: '/api/accounts', body: { type: 'personal', kind: 'fiat', name: 'Maya Lind', country: 'GB' } }])
    expect(server.current()).toMatchObject({ name: 'Maya Lind', type: 'personal', kind: 'fiat' })
    expect(await screen.findByRole('heading', { name: 'Confirm who you are' })).toBeTruthy()
    expect(screen.getByText('Step 3 of 3')).toBeTruthy()
    await settleQueries(queryClient, waitFor)
    const accounts = (await (await fetch('/api/accounts')).json()) as { accounts: { name: string; current: boolean }[] }
    expect(accounts.accounts.map((a) => [a.name, a.current])).toEqual([
      ['Northwind Studio', false],
      ['Maya Lind', true],
    ])
  })

  it('pressEverything: the sheet and the page leave no control doing nothing', async () => {
    for (const route of ['/?accounts=open', '/accounts/new']) {
      const report = await pressEverything(route)
      expect(report.dead, route).toEqual([])
      cleanup()
      queryClient.clear()
    }
  }, 120_000)
})
