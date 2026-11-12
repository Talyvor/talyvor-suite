import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B59.31 — a Business account's company details and the people with control, in Settings and at the end of sign-up,
// on a BFF that answers as Lens B59.30 does. A Personal account never sees them: no Settings entry, no form after
// sign-up, its address opens Home, and nothing asks the BFF for them.

const saved = {
  company_name: 'Northwind Studio Ltd',
  registration_number: '12345678',
  country: 'GB',
  people: [{ name: 'Ada Lovelace', role: 'director', share_bps: 6000 }],
}

function mockBff(accountType: 'business' | 'personal') {
  const puts: unknown[] = []
  const asked: string[] = []
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/workspace/account') return json({ account_type: accountType, money_kind: 'hybrid' })
    if (url !== '/api/workspace/business') return new Response('null', { status: 404 })
    asked.push(init?.method ?? 'GET')
    if (accountType === 'personal') return json({ error: 'a Personal account has no company details', code: 'not_business' }, 404)
    if (init?.method !== 'PUT') return json(saved)
    const body = JSON.parse(String(init.body)) as unknown
    puts.push(body)
    return json(body)
  })
  return { puts, asked }
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

describe('company details and people with control (B59.31)', () => {
  it('shows what was saved and sends the company and each person’s name, role and share', async () => {
    const { puts } = mockBff('business')
    open('/settings/company')
    const form = await screen.findByRole('form', { name: 'Company details' })
    expect(screen.getByText('These go to our partner’s identity check later. No identity documents are asked for.')).toBeTruthy()
    expect((within(form).getByLabelText('Company name') as HTMLInputElement).value).toBe('Northwind Studio Ltd')
    expect((within(screen.getByTestId('person-0')).getByLabelText('Share') as HTMLInputElement).value).toBe('60')

    fireEvent.click(within(form).getByRole('button', { name: 'Add a person' }))
    const added = screen.getByTestId('person-1')
    fireEvent.change(within(added).getByLabelText('Name'), { target: { value: '  Grace Hopper ' } })
    fireEvent.change(within(added).getByLabelText('Role'), { target: { value: 'shareholder' } })
    fireEvent.change(within(added).getByLabelText('Share'), { target: { value: '25.5' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(puts).toHaveLength(1))
    expect(puts[0]).toEqual({
      company_name: 'Northwind Studio Ltd',
      registration_number: '12345678',
      country: 'GB',
      people: [
        { name: 'Ada Lovelace', role: 'director', share_bps: 6000 },
        { name: 'Grace Hopper', role: 'shareholder', share_bps: 2550 },
      ],
    })
    expect((await screen.findByRole('status')).textContent).toContain('Saved')
  })

  // B57.145 — drawn as Pocket's settings forms are (w-payout-details, w-members): the company in its own titled card,
  // and the people with control as a list, each row headed by the person, their role and their share.
  it('draws the company in its own card and each person as a row with their role and share', async () => {
    mockBff('business')
    open('/settings/company')
    const company = await screen.findByRole('region', { name: 'The company' })
    expect(within(company).getByLabelText('Company name')).toBeTruthy()
    const people = screen.getByRole('region', { name: 'People with control' })
    const ada = within(people).getAllByRole('listitem')[0]
    expect(within(ada).getByRole('heading', { name: 'Ada Lovelace' })).toBeTruthy()
    expect(within(ada).getByText('Director · 60%')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Add a person' }))
    const added = within(people).getAllByRole('listitem')[1]
    expect(within(added).getByRole('heading', { name: 'Person 2' })).toBeTruthy()
    fireEvent.change(within(added).getByLabelText('Role'), { target: { value: 'shareholder' } })
    fireEvent.change(within(added).getByLabelText('Share'), { target: { value: '25.5' } })
    expect(within(added).getByText('Shareholder · 25.5%')).toBeTruthy()
  })

  it('sends nothing while a person has no name or the shares come to more than 100%', async () => {
    const { puts } = mockBff('business')
    open('/settings/company')
    const form = await screen.findByRole('form', { name: 'Company details' })
    fireEvent.click(within(form).getByRole('button', { name: 'Add a person' }))
    fireEvent.change(within(screen.getByTestId('person-1')).getByLabelText('Share'), { target: { value: '50' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }))

    expect(await within(form).findByText('Add their name.')).toBeTruthy()
    expect(within(form).getByText('The shares come to more than 100%.')).toBeTruthy()
    expect(puts).toEqual([])
  })

  it('is part of a Business account’s Settings and the end of its sign-up', async () => {
    mockBff('business')
    open('/settings')
    expect(await screen.findByRole('link', { name: /Company details/ })).toBeTruthy()
    cleanup()
    queryClient.clear()
    open('/signup/key')
    expect(await screen.findByRole('form', { name: 'Company details' })).toBeTruthy()
  })

  it('never shows to a Personal account', async () => {
    const { asked } = mockBff('personal')
    open('/settings')
    expect(await screen.findByRole('link', { name: /Capability terms/ })).toBeTruthy()
    await waitFor(() => expect(queryClient.getQueryData(['workspace-account'])).toBeTruthy())
    expect(screen.queryByRole('link', { name: /Company details/ })).toBeNull()
    cleanup()

    open('/signup/key')
    expect(await screen.findByRole('heading', { name: 'Add a passkey or pair your phone' })).toBeTruthy()
    cleanup()

    open('/settings/company')
    await waitFor(() => expect(window.location.pathname).toBe('/'))
    expect(screen.queryByRole('form', { name: 'Company details' })).toBeNull()
    expect(asked).toEqual([])
  })
})
