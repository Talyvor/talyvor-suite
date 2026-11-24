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
  it('lets a Business owner give an email a role from its dialog, and take it away once asked', async () => {
    const sent = standInBff('business')
    renderScreen()
    expect(await screen.findByText('You haven’t given anyone a role yet.')).toBeTruthy()

    // B57.211 — as w-members' Add a member: Give a role opens the form in a dialog.
    fireEvent.click(await screen.findByRole('button', { name: 'Give a role' }))
    const give = await screen.findByRole('dialog', { name: 'Give a role' })
    fireEvent.change(within(give).getByLabelText('Email'), { target: { value: 'finn@northwind.example' } })
    fireEvent.change(within(give).getByLabelText('Role'), { target: { value: 'finance' } })
    expect(within(give).getByText('Sees everything, and adds, pays, sends and converts money.')).toBeTruthy()
    fireEvent.click(within(give).getByRole('button', { name: 'Give role' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Give a role' })).toBeNull())

    // Each person is a w-members row: the email, whether they signed in, and the role as its chip.
    const team = await screen.findByRole('list', { name: 'Your team' })
    expect(within(team).getByText('finn@northwind.example')).toBeTruthy()
    expect(within(team).getByText('Hasn’t signed in yet')).toBeTruthy()
    expect(within(team).getByText('Finance')).toBeTruthy()
    expect(sent.find((s) => s.method === 'PUT')?.body).toEqual({ email: 'finn@northwind.example', role: 'finance' })

    // Remove asks first, as w-security does for a key; Keep it removes nothing.
    fireEvent.click(within(team).getByRole('button', { name: 'Remove' }))
    const ask = await screen.findByRole('dialog', { name: 'Remove “finn@northwind.example”?' })
    fireEvent.click(within(ask).getByRole('button', { name: 'Keep it' }))
    expect(sent.some((s) => s.method === 'DELETE')).toBe(false)
    fireEvent.click(within(team).getByRole('button', { name: 'Remove' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove it' }))
    expect(await screen.findByText('You haven’t given anyone a role yet.')).toBeTruthy()
    expect(sent.some((s) => s.method === 'DELETE' && s.url === '/api/workspace/roles?email=finn%40northwind.example')).toBe(true)
  })

  it('shows a shared account only once the email is proved with its code, and gives a Personal account no team', async () => {
    standInBff('personal')
    renderScreen()
    expect(await screen.findByRole('heading', { name: 'Open an account someone gave you a role in' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Give a role' })).toBeNull()

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
    expect(within(shared).getByText('finn@northwind.example')).toBeTruthy()
    expect(within(shared).getByText('Viewer')).toBeTruthy()
    await waitFor(() => expect(within(shared).getByRole('button', { name: 'Open' })).toBeTruthy())
  })

  // B28.40 — the second approver is an Approver or Admin who has signed in, picked with the amount above which a payment
  // needs two approvals; the line Lens is asked to sign and then set is exactly the one picked, in minor units.
  it('lets a Business owner name a second approver above an amount in a dialog, and remove them once asked', async () => {
    let line = { user_id: '', above_minor: 0, currency: '' }
    const sent: { method: string; url: string; body: unknown }[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      const body = init?.body ? JSON.parse(String(init.body)) : undefined
      sent.push({ method, url, body })
      if (url === '/api/workspace/account') return json({ account_type: 'business', money_kind: 'fiat' })
      if (url === '/api/accounts') return json({ accounts: [{ id: 'ws_own', name: 'Own', type: 'business', kind: 'fiat', opened_at: '', current: true }] })
      if (url === '/api/workspace/roles')
        return json({
          items: [
            { email: 'ada@northwind.example', role: 'approver', signed_in: true, granted_at: '', user_id: 'pada' },
            { email: 'finn@northwind.example', role: 'finance', signed_in: true, granted_at: '', user_id: 'pfinn' },
            { email: 'new@northwind.example', role: 'admin', signed_in: false, granted_at: '', user_id: '' },
          ],
        })
      if (url === '/api/workspace/second-approver/challenge') return json({ challenge: 'c1', allow_credentials: [] })
      if (url === '/api/workspace/second-approver' && method === 'PUT') {
        line = body
        return json(line)
      }
      if (url === '/api/workspace/second-approver') return json(line)
      if (url === '/api/roles') return json({ emails: [], accounts: [] })
      return json({}, 404)
    })
    renderScreen()
    expect(await screen.findByText('No second approver: one approval is enough.')).toBeTruthy()
    // B57.212 — the line is chosen in a dialog, as a role is given.
    expect(screen.queryByLabelText('Who')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Choose' }))
    const dialog = await screen.findByRole('dialog', { name: 'Second approver' })
    const who = within(dialog).getByLabelText('Who') as HTMLSelectElement
    expect([...who.options].map((o) => o.textContent)).toEqual(['ada@northwind.example · Approver'])

    fireEvent.change(within(dialog).getByLabelText('Above'), { target: { value: '5000' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    const now = await screen.findByTestId('second-approver-now')
    expect(within(now).getByText('ada@northwind.example')).toBeTruthy()
    expect(within(now).getByText('Above £5,000.00')).toBeTruthy()
    expect(within(now).getByText('Approver')).toBeTruthy()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const picked = { user_id: 'pada', above_minor: 500000, currency: 'GBP' }
    const changes = () => sent.filter((s) => s.url.startsWith('/api/workspace/second-approver') && s.method !== 'GET').map((s) => [s.method, s.url, s.body])
    expect(changes()).toEqual([
      ['POST', '/api/workspace/second-approver/challenge', picked],
      ['PUT', '/api/workspace/second-approver', picked],
    ])

    // B57.212 — Remove asks first, and Keep it sends nothing.
    fireEvent.click(within(now).getByRole('button', { name: 'Remove' }))
    const ask = await screen.findByRole('dialog', { name: 'Remove “ada@northwind.example” as second approver?' })
    fireEvent.click(within(ask).getByRole('button', { name: 'Keep it' }))
    expect(changes()).toHaveLength(2)
    fireEvent.click(within(screen.getByTestId('second-approver-now')).getByRole('button', { name: 'Remove' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove it' }))
    expect(await screen.findByText('No second approver: one approval is enough.')).toBeTruthy()
    const none = { user_id: '', above_minor: 0, currency: '' }
    expect(changes().slice(2)).toEqual([
      ['POST', '/api/workspace/second-approver/challenge', none],
      ['PUT', '/api/workspace/second-approver', none],
    ])
  })
})
