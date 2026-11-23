import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { JoinWorkspace } from './JoinWorkspace'
import { MemberInvites } from './MemberInvites'

// B52.36 — Settings → Members: make an invite link, copy it, revoke it; the person who joins with it is listed and can
// be removed. The Join page sends the token and nothing else. Lens's state is kept in this stand-in BFF.

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function standInBff() {
  const invites: Record<string, unknown>[] = []
  const members: Record<string, unknown>[] = []
  const sent: { method: string; url: string; body: unknown }[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    sent.push({ method, url, body })
    if (url === '/api/workspace/member-invites' && method === 'POST') {
      const inv = { id: 'wsinv_1', max_uses: body.max_uses, uses: 0, expires_at: body.expires_at, live: true, created_at: '2026-11-20T10:00:00Z' }
      invites.push(inv)
      return json({ ...inv, token: 'wsinvtok_abc' }, 201)
    }
    if (url === '/api/workspace/member-invites') return json({ invites })
    if (url === '/api/workspace/member-invites/wsinv_1' && method === 'DELETE') {
      Object.assign(invites[0], { live: false, revoked_at: '2026-11-20T11:00:00Z' })
      return json(invites[0])
    }
    if (url === '/api/workspace/members') return json({ members })
    if (url === '/api/workspace/members/wsm_1' && method === 'DELETE') {
      members.splice(0, 1)
      return new Response(null, { status: 204 })
    }
    if (url === '/api/invites/accept') {
      // The join: Lens adds the session's person, so the owner's list has them after it.
      members.push({ id: 'wsm_1', role: 'member', added_at: '2026-11-20T10:30:00Z' })
      Object.assign(invites[0] ?? {}, { uses: 1 })
      return json({ workspace_id: 'ws_owner', name: 'Northwind Studio', created: true })
    }
    return json({}, 404)
  })
  return sent
}

function renderAt(node: React.ReactNode, at = '/members') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[at]}>
        <div data-design="pocket">{node}</div>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => vi.restoreAllMocks())

describe('Settings → Members invites someone in', () => {
  it('makes a link, copies it, and revokes it', async () => {
    const sent = standInBff()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    renderAt(<MemberInvites />)

    expect(await screen.findByText('No invite links yet. Make one above to invite someone.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Make a link' }))
    const link = (await screen.findByLabelText('Invite link')) as HTMLInputElement
    expect(link.value).toBe(`${window.location.origin}/join#wsinvtok_abc`)
    const made = sent.find((s) => s.method === 'POST')
    expect(made?.body).toMatchObject({ max_uses: 1 })
    expect(Date.parse((made?.body as { expires_at: string }).expires_at)).toBeGreaterThan(Date.now())

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    expect(await screen.findByText('Copied. Send it to the people you want in this workspace.')).toBeTruthy()
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/join#wsinvtok_abc`)

    const list = await screen.findByRole('list', { name: 'Invite links' })
    fireEvent.click(within(list).getByRole('button', { name: /^Revoke invite made/ }))
    expect(await within(list).findByText('Revoked')).toBeTruthy()
    expect(sent.some((s) => s.method === 'DELETE' && s.url === '/api/workspace/member-invites/wsinv_1')).toBe(true)
  })

  it('lists the person who joined, and removes them', async () => {
    const sent = standInBff()
    renderAt(<MemberInvites />)
    fireEvent.click(await screen.findByRole('button', { name: 'Make a link' }))
    await screen.findByLabelText('Invite link')
    expect(await screen.findByText('Nobody has joined by invite yet.')).toBeTruthy()

    // Someone opens the link and joins.
    await fetch('/api/invites/accept', { method: 'POST', body: JSON.stringify({ token: 'wsinvtok_abc' }) })
    renderAt(<MemberInvites />)
    const joined = await screen.findAllByRole('list', { name: 'Joined by invite' })
    const rows = within(joined[joined.length - 1])
    expect(rows.getByText('Member')).toBeTruthy()

    fireEvent.click(rows.getByRole('button', { name: /^Remove the member who joined/ }))
    await waitFor(() => expect(sent.some((s) => s.method === 'DELETE' && s.url === '/api/workspace/members/wsm_1')).toBe(true))
    expect((await screen.findAllByText('Nobody has joined by invite yet.')).length).toBeGreaterThan(0)
  })

  it('is not drawn for someone Lens refuses as not the owner', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ error: 'only the workspace owner may do this' }, 403))
    const { container } = renderAt(<MemberInvites />)
    await waitFor(() => expect(container.querySelector('#invite-links')).toBeNull())
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByText('Invite links')).toBeNull()
  })
})

describe('An invite link opened signed in', () => {
  it('sends only the token, and says which workspace was joined', async () => {
    const sent = standInBff()
    renderAt(<JoinWorkspace />, '/join#wsinvtok_abc')
    expect(screen.getByText('You’ve been invited to join a workspace on Talyvor.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Join' }))
    expect((await screen.findByTestId('joined')).textContent).toBe('You joined Northwind Studio.')
    expect(sent.find((s) => s.url === '/api/invites/accept')?.body).toEqual({ token: 'wsinvtok_abc' })
  })

  it('says a used, expired or revoked link in the BFF’s words', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      json({ error: 'This invite link has expired, been used or been revoked. Ask for a new one.' }, 404),
    )
    renderAt(<JoinWorkspace />, '/join#wsinvtok_gone')
    fireEvent.click(screen.getByRole('button', { name: 'Join' }))
    expect((await screen.findByRole('alert')).textContent).toBe('This invite link has expired, been used or been revoked. Ask for a new one.')
  })
})

// B57.205 — drawn in Pocket: each part is a white card that heads itself (w-room-settings' cards), its rows as
// w-members' rows; the Join page as w-room-invite, what joining means as facts beside the
// note on what a link admits, and Not now.
describe('Members’ invite links and the Join page, in Pocket', () => {
  it('heads each card itself, the form and the links in one card', async () => {
    standInBff()
    renderAt(<MemberInvites />)
    const links = await screen.findByRole('region', { name: 'Invite links' })
    expect(within(links).getByRole('heading', { level: 2, name: 'Invite links' })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 2, name: 'Joined by invite' })).toBeTruthy()
    fireEvent.click(within(links).getByRole('button', { name: 'Make a link' }))
    const list = await within(links).findByRole('list', { name: 'Invite links' })
    expect(within(list).getByRole('button', { name: /^Revoke invite made/ })).toBeTruthy()
  })

  it('says what joining means as facts, with Not now and what a link admits', () => {
    standInBff()
    renderAt(<JoinWorkspace />, '/join#wsinvtok_abc')
    const facts = screen.getAllByRole('term').map((t) => [t.textContent, t.nextElementSibling?.textContent])
    expect(facts).toEqual([
      ['What you can do', 'Read the workspace'],
      ['Who can remove you', 'Its owner, at any time'],
      ['Your own account', 'Stays as it is'],
    ])
    expect(screen.getByRole('link', { name: 'Not now' }).getAttribute('href')).toBe('/')
    expect(screen.getByText('An invite link admits people until it is revoked, expires or is used up. A link that no longer admits anyone says so here.')).toBeTruthy()
  })
})
