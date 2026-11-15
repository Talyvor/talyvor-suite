import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatMinor } from './agentBankApi'
import { Lxc, fiatText, lxcText } from './money'

// B55.38 — one money format on the web: dollars as $450.00 everywhere. B61.14 — an amount Lens keeps in µLXC
// reads in the person's currency alone, never beside LXC.

const M = 1_000_000

function renderLxc(ulxc: number, peg: number | null) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    if (String(input) === '/api/lxc/topup-options' && peg !== null)
      return new Response(JSON.stringify({ allowed_usd_cents: [1000], billing_enabled: true, usd_per_lxc: peg }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    return new Response('null', { status: 404 })
  })
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(createElement(QueryClientProvider, { client: qc }, createElement('p', { 'data-testid': 'amount' }, createElement(Lxc, { ulxc }))))
  return () => screen.getByTestId('amount').textContent
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('one currency formatter', () => {
  it('writes dollars as $450.00, never US$', () => {
    expect(formatMinor(45000, 'USD')).toBe('$450.00')
    expect(formatMinor(-45000, 'USD')).toBe('-$450.00')
  })

  it('agrees with fiatText for dollars, pounds and euros', () => {
    for (const c of ['USD', 'GBP', 'EUR'] as const) expect(formatMinor(45000, c)).toBe(fiatText(450, c))
    expect(formatMinor(2000, 'GBP')).toBe('£20.00')
    expect(formatMinor(2000, 'EUR')).toBe('€20.00')
  })
})

describe('the person\'s currency alone, never LXC (B61.14)', () => {
  it('renders $450.00', async () => {
    const text = renderLxc(4500 * M, 0.1)
    await waitFor(() => expect(text()).toBe('$450.00'))
    expect(text()).not.toMatch(/LXC/)
  })

  it('leads the figure with a minus', async () => {
    const text = renderLxc(-4500 * M, 0.1)
    await waitFor(() => expect(text()).toBe('-$450.00'))
  })

  it('writes a sign before the figure', () => {
    expect(lxcText(4500 * M, '$450.00', '+')).toBe('+$450.00')
    expect(lxcText(-4500 * M, '$450.00', '−')).toBe('-$450.00')
  })

  it('shows an ellipsis, never LXC or a guessed figure, while no rate backs it', async () => {
    const text = renderLxc(4500 * M, null)
    await new Promise((r) => setTimeout(r, 20))
    expect(text()).toBe('…')
    expect(lxcText(4500 * M, null)).toBe('…')
  })
})

// A bare LXC figure is drawn nowhere but a form field's prefill: money.tsx draws the person's currency.
// formatULXC is defined in agentBankApi.ts; a form field's value stays the bare figure a person edits.
const FORM_FIELDS = new Set(['areas/marketplace/Marketplace.tsx'])

describe('formatULXC stays inside money.tsx', () => {
  it('is called nowhere else but form fields', () => {
    const root = resolve(__dirname, '../..')
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]))
    const offenders = walk(root)
      .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
      .map((f) => relative(root, f))
      .filter((f) => f !== 'areas/lens/money.tsx' && f !== 'areas/lens/agentBankApi.ts')
      .flatMap((f) =>
        readFileSync(join(root, f), 'utf8')
          .split('\n')
          .filter((l) => l.includes('formatULXC('))
          .filter((l) => !(FORM_FIELDS.has(f) && /prefill/.test(l)))
          .map((l) => `${f}: ${l.trim()}`),
      )
    expect(offenders).toEqual([])
  })
})
