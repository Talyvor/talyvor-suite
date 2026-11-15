import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B59.45 — Cards on the web, as the phone's Cards tab (B59.34): every agent's card in its art, Frozen, the limits its
// purchases are judged by, Freeze card, its purchases, and its details hidden until the owner's passkey says it is them.

const CARD = { id: 'ic_1', agent_id: 'agt_1', last4: '4242', exp_month: 9, exp_year: 2029, currency: 'gbp', livemode: false, created_at: '2026-09-28T09:00:00Z' }

function mockBff({ passkeys = [] as string[] } = {}) {
  const sent: Array<{ method: string; url: string }> = []
  const researcher = { id: 'agt_1', name: 'Researcher', description: 'Research', colour: 'cobalt', balance_ulxc: 50_000_000, spent_ulxc: 0, keys: [], created_at: '2026-08-01T09:00:00Z', owner_user_id: 'ws_1', verified: true }
  const writer = { ...researcher, id: 'agt_2', name: 'Writer', description: 'Words', colour: 'violet' }
  let frozen = false
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (method !== 'GET') sent.push({ method, url })
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/agents')
      return json({ workspace_balance_ulxc: 100_000_000, allocated_ulxc: 50_000_000, unallocated_ulxc: 50_000_000, spent_ulxc: 0, agents: [researcher, writer] })
    if (url === '/api/agents/agt_1/card/freeze' && method === 'POST') return (frozen = true), json({ ...CARD, frozen: true })
    if (url === '/api/agents/agt_1/card/unfreeze' && method === 'POST') return (frozen = false), json({ ...CARD, frozen: false })
    if (url === '/api/agents/agt_1/card')
      return json({
        card: { ...CARD, frozen },
        authorizations: [
          {
            id: 'a',
            authorization_id: 'iauth_a',
            approved: true,
            reason: "within the agent's rules and balance",
            amount_minor: 100,
            currency: 'gbp',
            merchant_name: 'Compute shop',
            merchant_category: 'computer_software_stores',
            amount_ulxc: 13_971_751,
            created_at: '2026-09-28T10:00:00Z',
          },
        ],
      })
    if (url === '/api/agents/agt_2/card') return json({ error: 'economy: this agent has no card' }, 404)
    if (url === '/api/agents/agt_1/rules' || url === '/api/agents/agt_2/rules')
      return json({ max_per_request_ulxc: 20_000_000, daily_limit_ulxc: 0, monthly_limit_ulxc: 0, approval_above_ulxc: 0, allowed_models: [], allowed_providers: [], allowed_listings: [], active_from: '', active_until: '', timezone: 'UTC', pause_on_unusual_spend: false })
    if (url === '/api/agents/passkeys')
      return json({ passkeys: passkeys.map((id) => ({ credential_id: id, name: 'This device', created_at: '2026-10-01T09:00:00Z' })) })
    if (url === '/api/agents/approvals') return json({ approvals: [] })
    return new Response('null', { status: 404 })
  })
  return sent
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  queryClient.clear()
  Reflect.deleteProperty(navigator, 'credentials')
  Reflect.deleteProperty(window, 'PublicKeyCredential')
})

describe('Cards on the web', () => {
  it("lists every agent's card in its art, with its limits and purchases, from the nav", async () => {
    mockBff()
    window.history.pushState({}, '', '/')
    render(<App />)

    fireEvent.click(await screen.findByRole('link', { name: 'Cards' }))
    const researcher = await screen.findByTestId('card-agt_1')
    expect(within(researcher).getByRole('img', { name: "Researcher, Research's agent card" })).toBeTruthy()
    expect(await within(researcher).findByText(/Spends at most/)).toBeTruthy()
    expect(researcher.textContent).toContain('on one request.')
    expect(await within(researcher).findByText('Compute shop')).toBeTruthy()
    expect(within(researcher).getByText('Approved')).toBeTruthy()
    expect(within(researcher).getByRole('button', { name: 'Freeze card' })).toBeTruthy()
    // An agent with no card says so, and links to where one is issued.
    const writer = screen.getByTestId('card-agt_2')
    expect(await within(writer).findByText('No card for Writer yet.')).toBeTruthy()
  })

  it('freezes a card, shows it Frozen, and unfreezes it', async () => {
    const sent = mockBff()
    window.history.pushState({}, '', '/cards')
    render(<App />)

    const researcher = await screen.findByTestId('card-agt_1')
    fireEvent.click(await within(researcher).findByRole('button', { name: 'Freeze card' }))
    expect(await within(researcher).findByText('Frozen. Every purchase on Researcher’s card is refused, and nothing leaves its wallet, until you unfreeze it.')).toBeTruthy()
    expect(within(researcher).getByText('Frozen')).toBeTruthy()
    fireEvent.click(await within(researcher).findByRole('button', { name: 'Unfreeze card' }))
    expect(await within(researcher).findByText('Unfrozen. Researcher’s card takes purchases again, each one judged by Researcher’s rules.')).toBeTruthy()
    expect(sent).toEqual([
      { method: 'POST', url: '/api/agents/agt_1/card/freeze' },
      { method: 'POST', url: '/api/agents/agt_1/card/unfreeze' },
    ])
  })

  it("keeps the card's details hidden until the passkey says it is you", async () => {
    mockBff({ passkeys: ['AQID'] })
    const get = vi.fn(async () => ({ rawId: new Uint8Array([1, 2, 3]).buffer }))
    Object.defineProperty(navigator, 'credentials', { value: { get }, configurable: true })
    Object.defineProperty(window, 'PublicKeyCredential', { value: function PublicKeyCredential() {}, configurable: true })
    window.history.pushState({}, '', '/cards')
    render(<App />)

    const researcher = await screen.findByTestId('card-agt_1')
    expect(await within(researcher).findByText('Hidden until you check it is you with your passkey.')).toBeTruthy()
    expect(researcher.textContent).not.toContain('4242')
    fireEvent.click(within(researcher).getByRole('button', { name: 'Show card details' }))

    const details = await within(researcher).findByTestId('card-details')
    expect(details.textContent).toContain('•••• 4242')
    expect(details.textContent).toContain('expires 09/29 · GBP')
    expect(get).toHaveBeenCalledTimes(1)
    const asked = (get.mock.calls[0] as unknown as [CredentialRequestOptions])[0].publicKey!
    expect(asked.userVerification).toBe('required')
    expect(asked.allowCredentials?.map((c) => Array.from(new Uint8Array(c.id as ArrayBuffer)))).toEqual([[1, 2, 3]])

    fireEvent.click(within(researcher).getByRole('button', { name: 'Hide card details' }))
    expect(researcher.textContent).not.toContain('4242')
  })

  it('shows no details without a passkey, and says where to add one', async () => {
    mockBff()
    window.history.pushState({}, '', '/cards')
    render(<App />)

    const researcher = await screen.findByTestId('card-agt_1')
    fireEvent.click(await within(researcher).findByRole('button', { name: 'Show card details' }))
    expect(await within(researcher).findByText(/Card details show after your passkey\./)).toBeTruthy()
    expect(within(researcher).queryByTestId('card-details')).toBeNull()
    expect(researcher.textContent).not.toContain('4242')
  })
})
