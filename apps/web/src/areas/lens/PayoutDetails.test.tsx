import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B55.28 — a workspace saves where it is paid. The mock BFF answers the way Lens B46.11 does: the details saved, their
// holder handed to the partner to verify, pending until it answers.

function mockBff() {
  const sent: Array<{ method: string; body: unknown }> = []
  const saved: Array<Record<string, unknown>> = []
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/money/payout-details' && method === 'PUT') {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      sent.push({ method, body })
      const d = { ...body, workspace_id: 'ws_1', partner: 'test', status: 'pending', updated_at: '2026-11-06T09:00:00Z' }
      saved.splice(0, saved.length, d)
      return json(d)
    }
    if (url === '/api/money/payout-details') return json({ payout_details: saved.length ? [...saved] : null })
    return json({ error: 'not found' }, 404)
  })
  return sent
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  queryClient.clear()
})

describe('Payout details', () => {
  it('saves IBAN details and shows them as Checking', async () => {
    const sent = mockBff()
    window.history.pushState({}, '', '/settings/payout-details')
    render(<App />)

    expect(await screen.findByText('Where Talyvor pays you: your share of a room, your marketplace sales and royalties.')).toBeTruthy()
    const form = screen.getByRole('form', { name: 'Payout details' })
    fireEvent.change(within(form).getByLabelText('Pay me in'), { target: { value: 'EUR' } })
    fireEvent.change(within(form).getByLabelText('Name on the account'), { target: { value: 'Ada Ltd' } })
    fireEvent.change(within(form).getByLabelText('IBAN'), { target: { value: 'DE89370400440532013000' } })
    fireEvent.change(within(form).getByLabelText('BIC'), { target: { value: 'COBADEFFXXX' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }))

    expect(await within(form).findByText('Checking')).toBeTruthy()
    expect(sent).toEqual([{ method: 'PUT', body: { asset: 'EUR', holder: 'Ada Ltd', iban: 'DE89370400440532013000', bic: 'COBADEFFXXX' } }])
    const row = await screen.findByTestId('payout-details')
    expect(row.textContent).toContain('DE89370400440532013000')
    expect(within(row).getByText('Checking')).toBeTruthy()
    expect(screen.getByText('Payouts held for you are paid once these are verified.')).toBeTruthy()
  })
})
