import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App, CONSOLE_ROUTES, queryClient } from './App'
import { populatedBff, settleQueries } from './populatedBff'
import { areaOfPath, areaSource } from './lib/workspaceAreas'

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
      const m = text.match(new RegExp(`.{0,40}(${LXC.source}).{0,30}`, 'i'))
      if (m) found.push(`${route}: …${m[0]}…`)
      cleanup()
      vi.restoreAllMocks()
      queryClient.clear()
      document.body.replaceChildren()
    }
    expect(found).toEqual([])
  })
})
