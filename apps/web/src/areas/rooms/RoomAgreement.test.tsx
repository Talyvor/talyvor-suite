import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B41.50 — the contributor agreement, e-signed before points count. The mock BFF plays Lens's B41.150: a member reads the
// draft marked Test rooms only and signs the version it read; Lens keeps the signature with that version and the text's
// hash, answers 409 to any other version, and 404 in a workspace that is not synthetic until room_equity is cleared.

const OWNER = 'ws_owner'
const ME = 'ws_me'
const SHA = 'a'.repeat(64)
const TEXT = 'Contributor agreement\n\n2. You assign to the company formed to own this room’s work the copyright in your contributions.'

function mockBff({ gated = false, refuse = '' }: { gated?: boolean; refuse?: string } = {}) {
  let agreement = { room_id: 'room_1', version: 'draft-1', draft: true, marked: 'Test rooms only', text: TEXT, text_sha256: SHA, signature: null } as Record<string, unknown>
  const sent: { method: string; url: string; body: Record<string, unknown> }[] = []
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
    if (method !== 'GET') sent.push({ method, url, body })
    const json = (v: unknown, status = 200) =>
      new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    const member = (ws: string) => ({
      workspace_id: ws, role: ws === OWNER ? 'owner' : 'member', may_spend: false, terms_version: 1, terms_current: true, joined_at: '',
    })
    if (url === '/auth/me') return json({ mode: 'oidc', authenticated: true, user: { sub: 'u1', email: 'u1@example.com' } })
    if (url === '/api/rooms') return json({ rooms: [], joined: [], invited: null })
    if (url === '/api/rooms/room_1') {
      return json({
        id: 'room_1', owner_workspace_id: OWNER, title: 'Agent pricing', topic: 'research', description: '', visibility: 'public',
        status: 'open', terms_version: 1, member_count: 2, created_at: '', last_activity_at: '2026-10-07T10:00:00Z',
        terms: { version: 1, split_rule: 'by_votes', remix_share_bps: 0, default_price_usd_micros: 0, spend_policy: 'owner_only', created_at: '' },
        members: [OWNER, ME].map(member), agents: null, me: member(ME),
      })
    }
    if (url === '/api/rooms/room_1/agreement') {
      if (gated) return json({ error: 'rooms: not found: no such room' }, 404)
      if (method === 'POST') {
        if (refuse) return json({ error: `rooms: conflict: ${refuse}` }, 409)
        agreement = { ...agreement, signature: { workspace_id: ME, user_id: 'u1', signed_name: body.signed_name, version: body.version, text_sha256: SHA, signed_at: '2026-11-07T22:00:00Z' } }
        return json(agreement, 201)
      }
      return json(agreement)
    }
    if (url.startsWith('/api/rooms/room_1/messages')) return json({ messages: [], more: false, events_cursor: 0 })
    if (url === '/api/rooms/room_1/contributions') return json({ contributions: [] })
    return new Response('null', { status: 404 })
  })
  return { sent }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  queryClient.clear()
})

describe('contributor agreement', () => {
  it('a member reads the draft, signs the version it read with its name, and sees the signature kept', async () => {
    const bff = mockBff()
    window.history.pushState({}, '', '/rooms/room_1')
    render(<App />)
    expect((await screen.findByTestId('room-agreement-text')).textContent).toBe(TEXT)
    expect(screen.getByText('Version draft-1 · Draft · Test rooms only')).toBeTruthy()
    expect(screen.getByTestId('room-agreement-unsigned').textContent).toBe('Not signed yet. Work accepted before your workspace signs earns no points.')
    expect(screen.getByRole('button', { name: 'Sign the agreement' })).toHaveProperty('disabled', true)

    fireEvent.change(screen.getByLabelText('Your full name'), { target: { value: '  Ada Lovelace ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign the agreement' }))
    await waitFor(() =>
      expect(screen.getByTestId('room-agreement-signed').textContent).toBe(
        'Ada Lovelace signed version draft-1 on 8 November 2026. Your points in this room count.',
      ),
    )
    expect(screen.getByText(SHA)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Sign the agreement' })).toBeNull()
    expect(bff.sent).toEqual([{ method: 'POST', url: '/api/rooms/room_1/agreement', body: { version: 'draft-1', signed_name: 'Ada Lovelace' } }])
  })

  it('a refusal shows Lens’s sentence and keeps the form', async () => {
    mockBff({ refuse: 'the contributor agreement is at version draft-2: read it and sign that version' })
    window.history.pushState({}, '', '/rooms/room_1')
    render(<App />)
    fireEvent.change(await screen.findByLabelText('Your full name'), { target: { value: 'Ada Lovelace' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign the agreement' }))
    expect((await screen.findByRole('alert')).textContent).toBe('The contributor agreement is at version draft-2: read it and sign that version.')
    expect(screen.getByTestId('room-agreement-unsigned')).toBeTruthy()
  })

  it('is not drawn where Lens answers 404', async () => {
    mockBff({ gated: true })
    window.history.pushState({}, '', '/rooms/room_1')
    render(<App />)
    await screen.findByRole('heading', { name: 'Agent pricing' })
    await waitFor(() => expect(queryClient.getQueryState(['rooms', 'agreement', 'room_1'])?.status).toBe('error'))
    expect(screen.queryByTestId('room-agreement-text')).toBeNull()
    expect(screen.queryByText('Contributor agreement')).toBeNull()
  })
})
