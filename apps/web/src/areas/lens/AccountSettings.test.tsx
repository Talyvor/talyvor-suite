import { render, screen, waitFor, within } from '@testing-library/react'
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
