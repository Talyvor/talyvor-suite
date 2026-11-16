import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App, CONSOLE_ROUTES, queryClient } from './App'
import { populatedBff, settleQueries } from './populatedBff'
import { areaOfPath, areaSource } from './lib/workspaceAreas'
import { dollarsText, parseDollars } from './areas/lens/agentBankApi'

// B61.14 — LXC is parked (Nick, 15 Nov: "it should only be in the actual account currency only"). On every screen a
// launch workspace can open, for each of the six account combinations, off the populated fixture, no figure, label,
// unit, hint, error or tooltip says LXC, µLXC or ulxc: the page's text and every title, aria-label, placeholder and
// alt are read.

const TYPES = ['business', 'personal'] as const
const KINDS = ['fiat', 'stablecoin', 'hybrid'] as const

// Every console address that is no hidden area's and not the operator's, with the fixture's ids in its params.
const LAUNCH_ROUTES = CONSOLE_ROUTES.map((r) => r.path)
  .filter((p) => areaOfPath(p) === undefined && !p.startsWith('/operator'))
  .map((p) =>
    p
      .replace(':id/rules', 'agt_research/rules')
      .replace('/agents/:id', '/agents/agt_research')
      .replace('instant-transfer/:id', 'instant-transfer/itr_sample')
      .replace(':account/:entry', 'macc_agt/ment_in')
      .replace('/money/plans/:id', '/money/plans/plan_1')
      .replace('/approve/:id', '/approve/preq_1'),
  )

const LXC = /LXC|ulxc/i

function said(root: HTMLElement): string {
  const attrs = [...root.querySelectorAll('[title],[aria-label],[placeholder],[alt],[aria-description]')].flatMap((el) =>
    ['title', 'aria-label', 'placeholder', 'alt', 'aria-description'].map((a) => el.getAttribute(a) ?? ''),
  )
  return [root.textContent ?? '', ...attrs].join(' ')
}

beforeEach(() => {
  areaSource.read = () => Promise.resolve([])
  areaSource.initial = []
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  queryClient.clear()
  document.body.replaceChildren()
})

describe.each(TYPES.flatMap((t) => KINDS.map((k) => [t, k] as const)))('a %s account with %s money', (type, kind) => {
  it('no launch screen says LXC', { timeout: 120_000 }, async () => {
    const found: string[] = []
    for (const route of LAUNCH_ROUTES) {
      vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
      populatedBff((impl) => vi.spyOn(globalThis, 'fetch').mockImplementation(impl as never), {
        '/api/workspace/account': { account_type: type, money_kind: kind },
      })
      window.history.pushState({}, '', route)
      render(<App />)
      await screen.findByRole('navigation', { name: 'Sections' })
      await settleQueries(queryClient, waitFor)
      const text = said(document.body)
      for (const m of text.matchAll(new RegExp(`.{0,40}(${LXC.source}).{0,30}`, 'gi'))) found.push(`${route}: …${m[0]}…`)
      cleanup()
      vi.restoreAllMocks()
      queryClient.clear()
      document.body.replaceChildren()
    }
    expect(found).toEqual([])
  })
})

// (b) — a field Lens keeps in µLXC is typed in dollars at the peg ($0.10 a LXC in the fixture), exact both ways.
describe('an amount typed in dollars', () => {
  it('reads back as it was typed, and every µLXC reads back as itself', () => {
    for (const typed of ['4.5', '0.01', '1000', '12.3456789', '0.0000001']) expect(dollarsText(parseDollars(typed, 0.1) ?? 0, 0.1)).toBe(typed)
    for (const micros of [1, 499_200_705, 5_000_000, 50_000_000]) expect(parseDollars(dollarsText(micros, 0.1), 0.1)).toBe(micros)
    expect(parseDollars('$1,000.25', 0.1)).toBe(10_002_500_000)
    expect(parseDollars('', 0.1)).toBe(0)
    expect(parseDollars('4 LXC', 0.1)).toBeNull()
  })

  async function at(route: string) {
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    const bff = populatedBff((impl) => vi.spyOn(globalThis, 'fetch').mockImplementation(impl as never))
    window.history.pushState({}, '', route)
    render(<App />)
    await screen.findByRole('navigation', { name: 'Sections' })
    await settleQueries(queryClient, waitFor)
    return bff
  }

  it('the Rules page shows a limit Lens holds in dollars, and what is typed is what it reads', async () => {
    await at('/agents/agt_research/rules')
    // Lens holds 5,000,000 µLXC a day: 5 LXC, $0.50 at the peg.
    const daily = (await screen.findByLabelText('At most a day for Researcher, in dollars')) as HTMLInputElement
    expect(daily.value).toBe('0.5')
    fireEvent.change(daily, { target: { value: '4.25' } })
    expect(daily.value).toBe('4.25')
    expect(parseDollars(daily.value, 0.1)).toBe(42_500_000)
  })

  // B61.19 — in the account's own currency, pounds here.
  it('Connect your AI shows the new-agent limits in the account’s currency', async () => {
    await at('/settings/connect')
    expect(((await screen.findByLabelText('One payment, in pounds')) as HTMLInputElement).value).toBe('0.05')
    expect((screen.getByLabelText('A day, in pounds') as HTMLInputElement).value).toBe('0.5')
    expect((screen.getByLabelText('A month, in pounds') as HTMLInputElement).value).toBe('5')
  })
})

// (d) — Home's total is the accounts' total alone: no LXC with the agents, nothing "not yet given to an agent".
it('Home draws no credit figures beside the total', async () => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  populatedBff((impl) => vi.spyOn(globalThis, 'fetch').mockImplementation(impl as never))
  window.history.pushState({}, '', '/')
  render(<App />)
  await screen.findByTestId('home-total')
  expect(screen.queryByTestId('home-agents-total')).toBeNull()
  expect(screen.queryByTestId('home-unallocated')).toBeNull()
  expect(document.body.textContent).not.toMatch(/Not yet given to an agent|Across your agents/)
})
