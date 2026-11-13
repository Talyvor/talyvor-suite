import { render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'
import { pressEverything } from '../../test/pressEverything'
import { LABEL_LINES } from '../../labels/StatusLabel'

// B57.62 — /your-money, the reference's s-money, read by a stranger. The peg is served, so the test serves one this
// repo never writes down (0.2, not the production 0.10) and asserts the page followed the server.

function stranger(pricing: unknown) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'Content-Type': 'application/json' } })
    if (url.startsWith('/auth/me')) return json({ mode: 'oidc', authenticated: false, user: null })
    if (url.startsWith('/api/pricing') && pricing) return json(pricing)
    return new Response('null', { status: 404 })
  })
}

async function open() {
  window.history.pushState({}, '', '/your-money')
  render(<App />)
  return screen.findByRole('heading', { level: 1, name: 'How your money is held' })
}

beforeEach(() => queryClient.clear())
afterEach(() => {
  vi.restoreAllMocks()
  window.history.pushState({}, '', '/')
})

describe('/your-money', () => {
  it('renders signed out: the eight points in order, and Talyvor is not a bank', async () => {
    stranger({ usd_per_lxc: 0.2, min_usd_cents: 1000, max_usd_cents: 1_000_000, preset_usd_cents: [1000] })
    await open()
    expect(screen.getByText('In plain words: what your balance is, who can move it, and what stops a mistake.')).toBeInTheDocument()
    const points = within(screen.getByTestId('money-points')).getAllByRole('heading', { level: 2 })
    expect(points.map((h) => h.textContent)).toEqual([
      'Your LXC balance is Talyvor credit',
      'Accounts in dollars, pounds and euros',
      'Each agent has its own balance and its own rules',
      'Rules are checked before anything moves',
      'Bigger payments wait for approval',
      'Everything is on a statement',
      'You can ask to cash it out',
      'Labels tell you what is real',
    ])
    // The figures are their own spans, so the point is read whole.
    await vi.waitFor(() => expect(points[0].nextElementSibling?.textContent).toMatch(/^1 LXC is \$0\.20\. LXC is not money/))
    expect(screen.getByText('Talyvor is not a bank.')).toBeInTheDocument()
  })

  it('says a mandate needs the owner’s signed say and keeps the agent’s rules (B55.24)', async () => {
    stranger(null)
    await open()
    const text = screen.getByTestId('money-points').textContent!
    expect(text).toContain('A payee pulling under a mandate is held to the mandate’s limits and to the agent’s rules, and every mandate needs your signed say.')
    expect(text).toContain('A pull under a mandate is checked against the mandate’s limits and the agent’s rules, and a mandate is granted only with your passkey.')
  })

  it('states no rate it was not served', async () => {
    stranger(null)
    await open()
    expect(screen.getByText(/^LXC is not money, not a deposit and not an investment/, { selector: 'p' })).toBeInTheDocument()
    expect(screen.getByTestId('money-points').textContent).not.toMatch(/1 LXC is/)
  })

  it('reads the labels point from the labels’ own words (B56.9)', async () => {
    stranger(null)
    await open()
    const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)
    expect(
      screen.getByText(`Live: ${lower(LABEL_LINES.live)} Sandbox: ${lower(LABEL_LINES.sandbox)} Building: ${lower(LABEL_LINES.building)}`),
    ).toBeInTheDocument()
  })

  it('marks Your money as the page you are on', async () => {
    stranger(null)
    await open()
    expect(within(screen.getAllByRole('banner')[0]).getByRole('link', { name: 'Your money' })).toHaveAttribute('aria-current', 'page')
  })

  it('every control on the page does something', async () => {
    const report = await pressEverything('/your-money')
    expect(report.dead).toEqual([])
    expect(report.pressed).toBeGreaterThan(5)
  })
})
