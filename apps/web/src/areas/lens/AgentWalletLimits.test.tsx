import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentMoneyWalletCard } from './AgentMoneyWallet'
import { AppMoney } from './money'
import { USDC_ON_BASE, type Agent } from './agentBankApi'

// B48.48 — an agent's Limits and permissions under its USDC wallet: the permission in force, a change prepared by Lens
// and kept with the assertion of the passkey that owns the agent's account, and Freeze, which signs one with no
// tokens. The BFF is mocked at the wire with what Lens B48.3 answers.

const ASSERTION = { rawId: new Uint8Array([1]).buffer, response: { clientDataJSON: new Uint8Array([2]).buffer, authenticatorData: new Uint8Array([3]).buffer, signature: new Uint8Array([4]).buffer } }
const SIGNED = { credential_id: 'AQ', client_data_json: 'Ag', authenticator_data: 'Aw', signature: 'BA' }

const AGENT = { id: 'agt_1', name: 'Researcher', balance_ulxc: 0, owner_user_id: 'u1' } as Agent
const USDC = { agent_id: 'agt_1', asset: 'USDC', partner: 'circle', balance_minor: 25_000_000, mode: 'LIVE',
  receive: { asset: 'USDC', network: 'base', address: '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed' } }
const BLOCKED = '0x2222222222222222222222222222222222222222'
const IN_FORCE = { number: 1, account: USDC.receive.address, canonical: 'C1', credential_id: 'Y3JlZDE', signed_by: 'u1', signed_at: '2026-11-20T09:00:00Z',
  permission: { tokens: [{ token: USDC_ON_BASE, allowance: 50_000_000, period: 'week', per_payment: 10_000_000 }], allowed: [], blocked: [BLOCKED], expires: '2027-06-30T23:59:59Z' } }

function mockBff() {
  const calls: { method: string; url: string; body: string }[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    calls.push({ method, url, body: typeof init?.body === 'string' ? init.body : '' })
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/api/agents/agt_1/wallets') return json({ agent_id: 'agt_1', wallet_kind: 'crypto', wallets: [USDC] })
    if (url === '/api/agents/agt_1/smart-account')
      return json({ agent_id: 'agt_1', address: USDC.receive.address, owners: [{ index: 0, role: 'person', credential_id: 'Y3JlZDE' }, { index: 1, role: 'agent', address: '0x1' }] })
    if (url === '/api/agents/agt_1/spend-permission/prepare') return json({ canonical: 'C2', challenge: 'Y2gy' })
    if (url === '/api/agents/agt_1/spend-permission' && method === 'PUT') {
      const tokens = calls.filter((c) => c.url.endsWith('/prepare')).map((c) => JSON.parse(c.body).tokens).at(-1)
      return json({ ...IN_FORCE, number: 2, canonical: 'C2', permission: { ...IN_FORCE.permission, tokens } })
    }
    if (url === '/api/agents/agt_1/spend-permission') return json(IN_FORCE)
    if (url === '/api/agents/passkeys') return json({ passkeys: [] })
    if (url === '/api/money/devices') return json({ devices: [] })
    return json(null, 404)
  })
  const get = vi.fn(async () => ASSERTION)
  Object.defineProperty(navigator, 'credentials', { value: { get, create: vi.fn() }, configurable: true })
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AppMoney>
        <MemoryRouter>
          <div data-design="pocket">
            <AgentMoneyWalletCard agent={AGENT} />
          </div>
        </MemoryRouter>
      </AppMoney>
    </QueryClientProvider>,
  )
  return { calls, get }
}

const sent = (calls: { method: string; url: string; body: string }[], method: string, end: string) =>
  calls.filter((c) => c.method === method && c.url.endsWith(end)).map((c) => JSON.parse(c.body))

/** The challenge and the credential the browser was asked to sign with, as bytes. */
const askedFor = (get: ReturnType<typeof vi.fn>) => {
  const pk = (get.mock.calls[0] as unknown as [{ publicKey: { challenge: Uint8Array; allowCredentials: { id: Uint8Array }[] } }])[0].publicKey
  return { challenge: [...pk.challenge], credentials: pk.allowCredentials.map((c) => [...c.id]) }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('an agent’s Limits and permissions', () => {
  it('sends a changed allowance as Lens’s prepare, then the PUT with the owning passkey’s assertion', async () => {
    const { calls, get } = mockBff()
    const card = await screen.findByTestId('agent-money-wallet')
    fireEvent.click(await within(card).findByRole('button', { name: 'Limits and permissions' }))
    const panel = await within(card).findByTestId('agent-wallet-limits')
    expect(await within(panel).findByText('50.00 USDC a week')).toBeTruthy()
    expect(within(panel).getByText(BLOCKED)).toBeTruthy()
    fireEvent.change(within(panel).getByRole('textbox', { name: 'Allowance in USDC' }), { target: { value: '75' } })
    fireEvent.change(within(panel).getByRole('combobox', { name: 'Each' }), { target: { value: 'month' } })
    fireEvent.click(within(panel).getByRole('button', { name: 'Sign new limits' }))
    await within(panel).findByText(/Signed\. Researcher’s new limits hold from now\./)
    expect(sent(calls, 'POST', '/spend-permission/prepare')).toEqual([
      { tokens: [{ token: USDC_ON_BASE, allowance: 75_000_000, period: 'month', per_payment: 10_000_000 }], allowed: [], blocked: [BLOCKED], expires: '2027-06-30T23:59:59Z' },
    ])
    expect(askedFor(get)).toEqual({ challenge: [...new TextEncoder().encode('ch2')], credentials: [[...new TextEncoder().encode('cred1')]] })
    expect(sent(calls, 'PUT', '/spend-permission')).toEqual([{ canonical: 'C2', assertion: SIGNED }])
  })

  it('freezes the agent by signing a permission with no tokens', async () => {
    const { calls, get } = mockBff()
    const card = await screen.findByTestId('agent-money-wallet')
    fireEvent.click(await within(card).findByRole('button', { name: 'Limits and permissions' }))
    const panel = await within(card).findByTestId('agent-wallet-limits')
    fireEvent.click(await within(panel).findByRole('button', { name: 'Freeze Researcher' }))
    await within(panel).findByText(/Researcher’s wallet is frozen\./)
    expect(sent(calls, 'POST', '/spend-permission/prepare')).toEqual([{ tokens: [], allowed: [], blocked: [BLOCKED], expires: '2027-06-30T23:59:59Z' }])
    expect(get).toHaveBeenCalledTimes(1)
    expect(sent(calls, 'PUT', '/spend-permission')).toEqual([{ canonical: 'C2', assertion: SIGNED }])
  })
})
