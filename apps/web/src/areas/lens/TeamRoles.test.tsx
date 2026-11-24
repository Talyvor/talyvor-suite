import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TeamRolesScreen } from './TeamRoles'

// B28.70 — Settings → Team and roles: a Business owner gives an email a role and takes it away; a person proves their
// email with the code mailed to it, and the account they were given a role in opens from here. The BFF is a stand-in.

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function standInBff(type: 'business' | 'personal') {
  const given: Record<string, unknown>[] = []
  const emails: string[] = []
  const sent: { method: string; url: string; body: unknown }[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    sent.push({ method, url, body })
    if (url === '/api/workspace/account') return json({ account_type: type, money_kind: 'fiat' })
    if (url === '/api/accounts') return json({ accounts: [{ id: 'ws_own', name: 'Own', type, kind: 'fiat', opened_at: '', current: true }] })
    if (url === '/api/workspace/roles' && method === 'PUT') {
      const r = { email: body.email, role: body.role, signed_in: false, granted_at: '2026-11-24T10:00:00Z' }
      given.push(r)
      return json(r)
    }
    if (url === '/api/workspace/roles') return json({ items: given, roles: ['viewer', 'finance', 'approver', 'admin'] })
    if (url.startsWith('/api/workspace/roles?email=') && method === 'DELETE') {
      given.splice(0, 1)
      return new Response(null, { status: 204 })
    }
    if (url === '/api/roles/email/code') return json({ sent: true, email: body.email })
    if (url === '/api/roles/email/check') {
      if (body.code !== '482913') return json({ error: 'That code isn’t right, or it has run out. Ask for a new one.' }, 400)
      emails.push(body.email)
      return json({ email: body.email })
    }
    if (url === '/api/roles')
      return json({
        emails,
        accounts: emails.length
          ? [{ id: 'ws_northwind', name: 'Northwind', type: 'business', kind: 'fiat', role: 'viewer', email: emails[0], current: false }]
          : [],
      })
    return json({}, 404)
  })
  return sent
}

function renderScreen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/settings/team']}>
        <div data-design="pocket">
          <TeamRolesScreen />
        </div>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => vi.restoreAllMocks())

describe('Settings → Team and roles', () => {
  it('lets a Business owner give an email a role, and take it away', async () => {
    const sent = standInBff('business')
    renderScreen()
    expect(await screen.findByText('You haven’t given anyone a role yet.')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'finn@northwind.example' } })
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'finance' } })
    expect(screen.getByText('Sees everything, and adds, pays, sends and converts money.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Give role' }))

    const team = await screen.findByRole('list', { name: 'Your team' })
    expect(within(team).getByText('finn@northwind.example')).toBeTruthy()
    expect(within(team).getByText('Finance · Hasn’t signed in yet')).toBeTruthy()
    expect(sent.find((s) => s.method === 'PUT')?.body).toEqual({ email: 'finn@northwind.example', role: 'finance' })

    fireEvent.click(within(team).getByRole('button', { name: 'Remove' }))
    expect(await screen.findByText('You haven’t given anyone a role yet.')).toBeTruthy()
    expect(sent.some((s) => s.method === 'DELETE' && s.url === '/api/workspace/roles?email=finn%40northwind.example')).toBe(true)
  })

  it('shows a shared account only once the email is proved with its code, and gives a Personal account no team', async () => {
    standInBff('personal')
    renderScreen()
    expect(await screen.findByRole('heading', { name: 'Open an account someone gave you a role in' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Give role' })).toBeNull()

    fireEvent.change(await screen.findByLabelText('Your email'), { target: { value: 'finn@northwind.example' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }))
    expect(await screen.findByText('We sent a code to finn@northwind.example. It works for 10 minutes.')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Code'), { target: { value: '000000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(await screen.findByText('That code isn’t right, or it has run out. Ask for a new one.')).toBeTruthy()
    expect(screen.queryByText('Northwind')).toBeNull()

    fireEvent.change(screen.getByLabelText('Code'), { target: { value: '482913' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    const shared = await screen.findByRole('list', { name: 'Accounts shared with you' })
    expect(within(shared).getByText('Northwind')).toBeTruthy()
    expect(within(shared).getByText('Viewer · finn@northwind.example')).toBeTruthy()
    await waitFor(() => expect(within(shared).getByRole('button', { name: 'Open' })).toBeTruthy())
  })
})
