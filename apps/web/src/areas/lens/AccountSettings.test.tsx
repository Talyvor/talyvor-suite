import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'
import { populatedBff, settleQueries } from '../../populatedBff'

async function settings(account: { account_type: string; money_kind: string }) {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  populatedBff((impl) => vi.spyOn(globalThis, 'fetch').mockImplementation(impl as never), { '/api/workspace/account': account })
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

// B61.4 — Nick, 15 Nov: the type and the kind of money are fixed once the account is open. Another kind or type is
// another account, with its own sign-up. Settings draws both as facts, with no control and no call that changes either.
describe('Settings, Account: the type and the kind are facts', () => {
  const KIND = 'The kind of money can’t be changed later. To use another kind, open another account.'
  const TYPE = 'The type can’t be changed later. To use another type, open another account.'

  for (const [account_type, money_kind, typeChip, kindChip] of [
    ['business', 'hybrid', 'Business', 'Hybrid'],
    ['personal', 'fiat', 'Personal', 'Fiat only'],
    ['business', 'stablecoin', 'Business', 'Stablecoin and crypto only'],
  ] as const) {
    it(`${typeChip}, ${kindChip}: two facts, their sentences, no control and no money-kind call`, async () => {
      const main = await settings({ account_type, money_kind })
      const kind = within(main).getByTestId('settings-money-kind')
      const type = within(main).getByTestId('settings-account-type')
      expect(within(kind).getByText(kindChip)).toBeInTheDocument()
      expect(within(kind).getByText(KIND)).toBeInTheDocument()
      expect(within(type).getByText(typeChip)).toBeInTheDocument()
      expect(within(type).getByText(TYPE)).toBeInTheDocument()
      for (const card of [kind, type]) {
        expect(card.querySelector('button, input, select, a, [role="radio"], [tabindex]')).toBeNull()
        for (const el of card.querySelectorAll('*')) fireEvent.click(el)
      }
      expect(within(main).queryByRole('radiogroup', { name: 'Kind of money' })).toBeNull()
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(main.textContent).not.toMatch(/can become Hybrid|can become a single kind|Change to/)
      const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String(c[0]))
      expect(calls.filter((u) => u.includes('money-kind'))).toEqual([])
    })
  }
})
