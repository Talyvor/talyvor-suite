import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'
import { populatedBff, settleQueries } from '../../populatedBff'

// B57.137 — Settings' Kind of money as launch-pack P11 draws it: the three kinds as choices, the current one checked,
// a single kind blocked by the zero-balance rule with what the other side holds, and the Account type as its chip.

async function settings(account: { account_type: string; money_kind: string }, accounts?: unknown) {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  populatedBff((impl) => vi.spyOn(globalThis, 'fetch').mockImplementation(impl as never), {
    '/api/workspace/account': account,
    ...(accounts ? { '/api/money/accounts': { accounts } } : {}),
  })
  window.history.pushState({}, '', '/settings')
  render(<App />)
  await screen.findByRole('navigation', { name: /sections/i })
  await settleQueries(queryClient, waitFor)
  return document.querySelector('main') as HTMLElement
}

afterEach(() => {
  vi.restoreAllMocks()
  queryClient.clear()
  document.body.replaceChildren()
})

const account = (currency: string, balance_minor: number) => ({
  id: `macc_${currency}`, agent_id: '', currency, purpose: 'company', status: 'open', name: `${currency} account`,
  balance_minor, test_minor: balance_minor, live_minor: 0,
})

describe('Settings, Kind of money (P11)', () => {
  it('Hybrid: current, and a single kind blocked while the other side holds money, naming what it holds', async () => {
    const main = await settings({ account_type: 'business', money_kind: 'hybrid' }, [
      account('USD', 3_158_000),
      account('USDC', 16_700_000_000),
    ])
    const group = within(main).getByRole('radiogroup', { name: 'Kind of money' })
    const [fiat, coin, hybrid] = within(group).getAllByRole('radio')
    expect(hybrid).toHaveAttribute('aria-checked', 'true')
    expect(hybrid.textContent).toContain('Current')
    expect(fiat).toHaveAttribute('aria-checked', 'false')
    // The balances are read once the account's kind is known, so after the first queries settle.
    await waitFor(() => expect(fiat.textContent).toContain('Needs zero stablecoin and crypto balances. They hold 16,700.00\u00a0USDC.'))
    expect(coin.textContent).toContain('Needs zero fiat balances. They hold $31,580.00.')
    expect(within(main).getByTestId('settings-kind-note').textContent).toBe(
      'Hybrid can become a single kind only when the other side’s balances are zero.',
    )
    expect(within(within(main).getByTestId('settings-account-type')).getByText('Business')).toBeInTheDocument()
  })

  it('Fiat only: Hybrid is free to pick, and the note says a single kind can become Hybrid', async () => {
    const main = await settings({ account_type: 'personal', money_kind: 'fiat' })
    const [fiat, , hybrid] = within(within(main).getByRole('radiogroup', { name: 'Kind of money' })).getAllByRole('radio')
    expect(fiat).toHaveAttribute('aria-checked', 'true')
    expect(hybrid.textContent).not.toContain('Needs zero')
    expect(within(main).getByTestId('settings-kind-note').textContent).toBe(
      'Fiat only or Stablecoin and crypto only can become Hybrid at any time.',
    )
    expect(within(within(main).getByTestId('settings-account-type')).getByText('Personal')).toBeInTheDocument()
  })
})

// B59.12 — changing the kind (SPEC 3.5): a kind free to pick asks to change to it, signed with the owner's passkey over
// Lens's challenge for that kind; Lens's refusal names the balances to empty; the type has no control.
describe('Settings, Kind of money: changing it', () => {
  const ASSERTION = {
    rawId: new Uint8Array([1]).buffer,
    response: { clientDataJSON: new Uint8Array([2]).buffer, authenticatorData: new Uint8Array([3]).buffer, signature: new Uint8Array([4]).buffer },
  }

  /** Settings for `kind`, with a passkey, and Lens answering the change with `answer`; returns what was sent to change. */
  async function changing(kind: string, accounts: unknown[], answer: (to: string) => { status: number; body: unknown }) {
    const sent: { url: string; body: unknown }[] = []
    let now = kind
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    const get = vi.fn().mockResolvedValue(ASSERTION)
    Object.defineProperty(navigator, 'credentials', { value: { get, create: vi.fn() }, configurable: true })
    populatedBff(
      (impl) =>
        vi.spyOn(globalThis, 'fetch').mockImplementation((async (input: unknown, init?: RequestInit) => {
          const url = String(input)
          const json = (status: number, v: unknown) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
          if (url.startsWith('/api/workspace/account/money-kind')) {
            const body = JSON.parse(String(init?.body)) as { money_kind: string }
            sent.push({ url: `${init?.method} ${url}`, body })
            if (url.endsWith('/challenge')) return json(200, { challenge: 'Y2gx', allow_credentials: ['Y3JlZDE'], user_verification: 'required' })
            const a = answer(body.money_kind)
            if (a.status === 200) now = body.money_kind
            return json(a.status, a.body)
          }
          if (url === '/api/workspace/account') return json(200, { account_type: 'business', money_kind: now })
          return impl(input)
        }) as never),
      {
        '/api/money/accounts': { accounts },
        '/api/agents/passkeys': { passkeys: [{ credential_id: 'Y3JlZDE', name: 'This Mac', created_at: '2026-11-01T09:00:00Z' }] },
        '/api/money/devices': { devices: [] },
      },
    )
    window.history.pushState({}, '', '/settings')
    render(<App />)
    await screen.findByRole('navigation', { name: /sections/i })
    await settleQueries(queryClient, waitFor)
    const main = document.querySelector('main') as HTMLElement
    const radios = () => within(within(main).getByRole('radiogroup', { name: 'Kind of money' })).getAllByRole('radio')
    return { main, radios, sent, get }
  }

  const ok = (to: string) => ({ status: 200, body: { workspace_id: 'ws_1', account_type: 'business', money_kind: to } })
  const signedChange = (to: string) => [
    { url: 'POST /api/workspace/account/money-kind/challenge', body: { money_kind: to } },
    {
      url: 'PUT /api/workspace/account/money-kind',
      body: { money_kind: to, assertion: { credential_id: 'AQ', client_data_json: 'Ag', authenticator_data: 'Aw', signature: 'BA' } },
    },
  ]

  it('Fiat only becomes Hybrid at once, signed with the passkey over the challenge for Hybrid', async () => {
    const { radios, sent, get } = await changing('fiat', [account('USD', 3_158_000)], ok)
    fireEvent.click(radios()[2])
    const dialog = await screen.findByRole('dialog', { name: 'Change to Hybrid?' })
    expect(get).not.toHaveBeenCalled()
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Change with your passkey' }))
    await waitFor(() => expect(radios()[2]).toHaveAttribute('aria-checked', 'true'))
    expect(get).toHaveBeenCalledTimes(1)
    expect(sent).toEqual(signedChange('hybrid'))
  })

  it('Hybrid becomes Fiat only, signed, once the stablecoin side holds nothing', async () => {
    const { radios, sent } = await changing('hybrid', [account('USD', 3_158_000), account('USDC', 0)], ok)
    await waitFor(() => expect(radios()[0].textContent).not.toContain('Needs zero'))
    fireEvent.click(radios()[0])
    fireEvent.click(await within(await screen.findByRole('dialog', { name: 'Change to Fiat only?' })).findByRole('button', { name: 'Change with your passkey' }))
    await waitFor(() => expect(radios()[0]).toHaveAttribute('aria-checked', 'true'))
    expect(sent).toEqual(signedChange('fiat'))
  })

  it('Lens refusing names the balances to empty, and the kind stays Hybrid', async () => {
    // The screen read no stablecoin, but Lens holds some by the time the change arrives: Lens's word decides.
    const { radios } = await changing('hybrid', [account('USD', 3_158_000)], () => ({
      status: 409,
      body: { error: 'the account still holds 16700.000000 USDC: move it out first', code: 'wrong_money_kind', money_kind: 'hybrid', balances: { USDC: 16_700_000_000 } },
    }))
    await waitFor(() => expect(radios()[0].textContent).not.toContain('Needs zero'))
    fireEvent.click(radios()[0])
    const dialog = await screen.findByRole('dialog', { name: 'Change to Fiat only?' })
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Change with your passkey' }))
    expect((await within(dialog).findByRole('alert')).textContent).toBe('Needs zero stablecoin and crypto balances. They hold 16,700.00\u00a0USDC.')
    expect(radios()[2]).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('a kind blocked by its balances, the current kind and the type have no control', async () => {
    const { main, radios, sent } = await changing('hybrid', [account('USD', 3_158_000), account('USDC', 16_700_000_000)], ok)
    await waitFor(() => expect(radios()[0].textContent).toContain('Needs zero'))
    for (const r of radios()) fireEvent.click(r)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(sent).toEqual([])
    const type = within(main).getByTestId('settings-account-type')
    expect(within(type).queryAllByRole('button')).toEqual([])
    expect(within(type).queryAllByRole('radio')).toEqual([])
    expect(type.querySelector('input, select, a, [tabindex]')).toBeNull()
  })

  it('Fiat only becomes Stablecoin and crypto only only through Hybrid, even with no fiat', async () => {
    const { radios, sent } = await changing('fiat', [], ok)
    await waitFor(() => expect(radios()[1].textContent).not.toContain('Needs zero'))
    fireEvent.click(radios()[1])
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(sent).toEqual([])
  })
})
