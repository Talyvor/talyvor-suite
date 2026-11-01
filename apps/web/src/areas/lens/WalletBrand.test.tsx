import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'
import { bodyFor, populatedBff, settleQueries } from '../../populatedBff'

// B29.9 — Agent Wallets, Approvals, Statements, Royalties, Ledger and Spend in the brand, read off the populated
// fixture: one teal action per screen, cards on the raised plane, every amount on the figure face, status pills.

async function at(address: string): Promise<HTMLElement> {
  window.history.pushState({}, '', address)
  render(<App />)
  await screen.findByRole('navigation', { name: /sections/i })
  await settleQueries(queryClient, waitFor)
  return document.querySelector('main') as HTMLElement
}

/** The teal-filled actions: the primary Button, as a button or a link. */
const primaries = (main: HTMLElement) => Array.from(main.querySelectorAll('button.bg-accent, a.bg-accent')).map((b) => b.textContent?.trim())
const pills = (root: HTMLElement) => Array.from(root.querySelectorAll('span.rounded-pill.border')).map((p) => p.textContent)

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  populatedBff((impl) => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(impl as never)
  })
})
afterEach(() => {
  vi.restoreAllMocks()
  document.body.replaceChildren()
  queryClient.clear()
})

describe('the wallet screens in the brand', () => {
  const SCREENS: Array<[string, string[]]> = [
    ['/agents', ['Fund']],
    ['/approvals', ['Approve']],
    ['/statements', ['Download']],
    ['/statements/royalties', []],
    ['/ledger', []],
    ['/spend', []],
  ]

  it.each(SCREENS)('%s: at most one teal action, cards on raised, and every LXC amount on the figure face', async (address, teal) => {
    const main = await at(address)
    expect(primaries(main), 'the teal fill is the one primary action').toEqual(teal)

    const cards = Array.from(main.querySelectorAll('.rounded-card'))
    expect(cards.length, `no card rendered on ${address}`).toBeGreaterThan(0)
    for (const c of cards) expect(c.className, `a card on ${address} is not on the raised plane`).toContain('bg-raised')

    // The figure audit already holds every numeral; this holds the unit beside it, so the amount is one face.
    let amounts = 0
    const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      // React writes the space and the unit as text nodes of their own, so the amount is read off the parent.
      if (/^\s*LXC\b/.test(n.textContent ?? '') && /\d\s+LXC\b/.test(n.parentElement?.textContent ?? '')) {
        amounts++
        expect(n.parentElement?.closest('.font-figure'), `"${n.parentElement?.textContent}" is not on the figure face`).not.toBeNull()
      }
    }
    if (['/agents', '/approvals', '/statements'].includes(address)) expect(amounts, 'no LXC amount was read').toBeGreaterThan(0)
  })

  it('fills only the first Approve teal when two requests wait, and only Approve 2 once both are picked (B17.325)', async () => {
    const [first] = (bodyFor('/api/agents/approvals') as { approvals: Array<Record<string, unknown>> }).approvals
    vi.restoreAllMocks()
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    populatedBff((impl) => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(impl as never)
    }, { '/api/agents/approvals': { approvals: [first, { ...first, id: 'apr_2', memo: 'November invoice' }] } })
    queryClient.clear()
    const main = await at('/approvals')
    expect(within(main).getAllByRole('button', { name: 'Approve' })).toHaveLength(2)
    expect(primaries(main)).toEqual(['Approve'])

    fireEvent.click(within(main).getByRole('checkbox', { name: /Select all 2/ }))
    expect(primaries(main)).toEqual(['Approve 2'])
  })

  it('shows each state as a pill: a waiting approval, settled statement lines, settled and held royalties', async () => {
    const approvals = await at('/approvals')
    const waiting = within(approvals).getByText(/wants to pay Acme Hosting/).closest('.min-h-row') as HTMLElement
    expect(pills(waiting)).toEqual(['Waiting'])
    document.body.replaceChildren()

    await at('/statements')
    expect(pills(screen.getByTestId('agent-statement'))).toEqual(['Settled', 'Settled'])
    document.body.replaceChildren()

    const royalties = await at('/statements/royalties')
    expect(pills(royalties)).toEqual(expect.arrayContaining(['Settled', 'Held']))
  })
})
