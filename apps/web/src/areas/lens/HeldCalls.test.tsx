import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'
import { areaSource } from '../../lib/workspaceAreas'
import { physicalCardSource } from './PhysicalCard'
import { populatedBff, settleQueries } from '../../populatedBff'

// B60.6 — Spending, the Talyvor Card, Statements and Overview ask only for routes that exist and are not held. Seen
// 15 Nov: each asked a route that answered 404 on every visit (physical cards while Lens's switch is off, the old
// gateway's model catalog, Track's and Docs' lists) though nothing of it showed.

function open(path: string, areas: string[]) {
  // The app as deployed: no card issuer serves physical cards yet (test-setup.ts serves them for every other test).
  physicalCardSource.served = false
  areaSource.read = () => Promise.resolve(areas)
  areaSource.initial = areas
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  const { asked } = populatedBff((impl) => vi.spyOn(globalThis, 'fetch').mockImplementation(impl))
  window.history.pushState({}, '', path)
  render(<App />)
  return asked
}

const reads = (asked: string[], path: string) => asked.filter((u) => u.split('?')[0] === path || u.startsWith(`${path}/`))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  queryClient.clear()
})

describe('no calls to held or missing routes (B60.6)', () => {
  it('Spending does not ask for physical cards while no issuer serves them', async () => {
    const asked = open('/money/spending', [])
    await screen.findByText('Where your money went')
    await settleQueries(queryClient, waitFor)
    expect(reads(asked, '/api/money/physical-cards')).toEqual([])
    expect(screen.queryByRole('link', { name: 'Your Talyvor Card' })).toBeNull()
  })

  it('/money/card goes to Spending without asking for physical cards', async () => {
    const asked = open('/money/card', [])
    await waitFor(() => expect(window.location.pathname).toBe('/money/spending'))
    await settleQueries(queryClient, waitFor)
    expect(reads(asked, '/api/money/physical-cards')).toEqual([])
  })

  it('Statements does not ask for the old gateway’s model catalog', async () => {
    const asked = open('/statements', [])
    await screen.findByTestId('statement-doc')
    await settleQueries(queryClient, waitFor)
    expect(reads(asked, '/api/models')).toEqual([])
  })

  it('Overview does not probe Track or Docs while the workspace has neither', async () => {
    const asked = open('/overview', ['gateway'])
    await screen.findByText('Products')
    await settleQueries(queryClient, waitFor)
    expect(reads(asked, '/api/track/workspaces')).toEqual([])
    expect(reads(asked, '/api/docs/spaces')).toEqual([])
    expect(screen.queryByText('Issues & workflows')).toBeNull()
    expect(screen.queryByText('Team wiki')).toBeNull()
  })
})
