import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../App'
import { ScreenBoundary } from '../components/ScreenBoundary'
import { ALL_TALY_LINES, TALY_INTRO } from './lines'

// B45.5 — Taly is light about everything except money and safety: none of its lines may render on an approval,
// decline, error or security screen. Each screen is drawn with real content first, so a blank render cannot pass.

const ITEM = { position: 1, payee_id: 'payee_1', payee_name: 'Acme Ltd', currency: 'GBP', amount_minor: 12000, reference: 'INV-7' }

function mockBff(auth: 'disabled' | 'oidc', status = 'pending_approval') {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'Content-Type': 'application/json' } })
    if (url.startsWith('/auth/me')) return json({ mode: auth, authenticated: false, user: null, signup_open: false })
    if (url === '/api/money/payment-requests/preq_1') {
      const decision = status === 'blocked' ? 'blocked' : 'needs_approval'
      return json({ id: 'preq_1', status, summary: '1 payment for Researcher', client: 'chat', totals: { GBP: 12000 },
        items: [{ ...ITEM, decision, reason: decision === 'blocked' ? "the agent's rules block this payee" : 'above the approval amount' }],
        created_at: '2026-10-23T09:00:00Z' })
    }
    if (url === '/api/money/payees') return json({ payees: [] })
    if (url === '/api/money/payments') return json({ payments: [] })
    return new Response('null', { status: 404 })
  })
}

function Throws(): never {
  throw new Error('unreadable')
}

function shown(): string {
  return document.body.textContent ?? ''
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  queryClient.clear()
  window.history.pushState({}, '', '/')
})

describe('Taly’s lines', () => {
  it('are at most 40, and Taly introduces itself as an AI', () => {
    expect(ALL_TALY_LINES.length).toBeLessThanOrEqual(40)
    expect(TALY_INTRO).toMatch(/AI assistant/)
  })

  const screens: [string, () => Promise<void>][] = [
    ['approval', async () => {
      mockBff('disabled')
      window.history.pushState({}, '', '/approve/preq_1')
      render(<App />)
      await screen.findByTestId('approve-total')
    }],
    ['decline', async () => {
      mockBff('disabled', 'blocked')
      window.history.pushState({}, '', '/approve/preq_1')
      render(<App />)
      await screen.findByText(/every payment was blocked/)
    }],
    ['error', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      render(<ScreenBoundary address="/x" onRetry={() => {}}><Throws /></ScreenBoundary>)
      await screen.findByText('This screen couldn’t be read.')
    }],
    ['security (sign in)', async () => {
      mockBff('oidc')
      window.history.pushState({}, '', '/signin')
      render(<App />)
      await screen.findByRole('heading', { name: 'Sign in to Talyvor' })
    }],
  ]

  it.each(screens)('never appear on the %s screen', async (_, draw) => {
    await draw()
    for (const line of ALL_TALY_LINES) expect(shown(), `Taly says "${line}"`).not.toContain(line)
  })
})
