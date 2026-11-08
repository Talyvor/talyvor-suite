import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatMinor } from './agentBankApi'
import { Lxc, fiatText, lxcText } from './money'

// B55.38 — one money format on the web: dollars as $450.00 everywhere, and dollars first beside LXC,
// in the order src/moneyOrder.ts names. The mock lets one test flip that switch.

const order = vi.hoisted(() => ({ value: 'usd-first' as 'usd-first' | 'lxc-first' }))
vi.mock('../../moneyOrder', () => ({
  get MONEY_ORDER() {
    return order.value
  },
}))

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
  order.value = 'usd-first'
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

describe('dollars first beside LXC', () => {
  it('renders $450.00 (4,500 LXC)', async () => {
    const text = renderLxc(4500 * M, 0.1)
    await waitFor(() => expect(text()).toBe('$450.00 (4,500 LXC)'))
  })

  it('leads both figures with a minus', async () => {
    const text = renderLxc(-4500 * M, 0.1)
    await waitFor(() => expect(text()).toBe('-$450.00 (-4,500 LXC)'))
  })

  it('shows LXC alone while no rate backs it', async () => {
    const text = renderLxc(4500 * M, null)
    await new Promise((r) => setTimeout(r, 20))
    expect(text()).toBe('4,500 LXC')
    expect(lxcText(4500 * M, null)).toBe('4,500 LXC')
  })

  it('flips every amount with MONEY_ORDER', async () => {
    expect(lxcText(4500 * M, '$450.00')).toBe('$450.00 (4,500 LXC)')
    order.value = 'lxc-first'
    expect(lxcText(4500 * M, '$450.00')).toBe('4,500 LXC ($450.00)')
    const text = renderLxc(4500 * M, 0.1)
    await waitFor(() => expect(text()).toBe('4,500 LXC ($450.00)'))
  })
})

// A bare LXC figure reaches a person only through money.tsx, so the order switch reaches every one.
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
