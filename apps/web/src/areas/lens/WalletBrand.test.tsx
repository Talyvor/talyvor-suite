import { render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'
import { populatedBff, settleQueries } from '../../populatedBff'
import { cardOnItsPlane, primaryActions, statusWithoutWords, tangerineOffenders } from '../../pocketRules'

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
// B57.3 — the primary (ink) actions, by Pocket's name and today's.
const primaries = primaryActions
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
    // B17.477 — the agents' list: New agent is its one primary action, as the design's w-agents draws it; the alert
    // channels' Add channel under the list is secondary.
    ['/agents', ['New agent']],
    // B57.20 — the agent's page: Edit rules is its one primary action; Move LXC and Review are secondary, as w-agent-research draws them.
    ['/agents/agt_research', ['Edit rules']],
    // B57.17 — Review is Pocket's secondary button, as w-approvals draws it; Approve is the sheet's.
    ['/approvals', []],
    // B57.24 — Statements' two downloads are Pocket's secondary buttons, as w-stmt-research draws them.
    ['/statements', []],
    ['/statements/royalties', []],
    ['/ledger', []],
    ['/spend', []],
  ]

  it.each(SCREENS)('%s: at most one teal action, cards on raised, and every LXC amount on the figure face', async (address, teal) => {
    const main = await at(address)
    // B56.15 — Statements' accounts are tabs, so its amounts are the open statement's band, read once it arrives.
    if (address === '/statements') await screen.findByTestId('account-statement-band')
    expect(primaries(main), 'the teal fill is the one primary action').toEqual(teal)

    const cards = Array.from(main.querySelectorAll('.rounded-card'))
    expect(cards.length, `no card rendered on ${address}`).toBeGreaterThan(0)
    for (const c of cards) expect(cardOnItsPlane(c), `a card on ${address} is not on its plane: ${c.className}`).toBe(true)
    // B57.3 — Pocket's rules: tangerine only for the brand and "your move", status colours always with words.
    expect(tangerineOffenders(main).map((e) => e.outerHTML)).toEqual([])
    expect(statusWithoutWords(main).map((e) => e.outerHTML)).toEqual([])

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
    // B57.7 — Pocket's <Money> writes the figure and its unit as one text, dollars first: it is held the same way.
    for (const m of Array.from(main.querySelectorAll('[data-money]'))) {
      amounts++
      expect(m.closest('.font-figure'), `"${m.textContent}" is not on the figure face`).not.toBeNull()
    }
    if (['/agents/agt_research', '/approvals', '/statements'].includes(address)) expect(amounts, 'no LXC amount was read').toBeGreaterThan(0)
  })

  // B17.477 — a workspace with no currency account yet sees Statements say so on Pocket's empty card, not a bare line.
  it('Statements with no account yet says so on a card', async () => {
    vi.restoreAllMocks()
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    populatedBff((impl) => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(((input: unknown) =>
        String(input) === '/api/money/accounts'
          ? Promise.resolve(new Response(JSON.stringify({ accounts: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
          : impl(input)) as never)
    })
    const main = await at('/statements')
    const card = (await within(main).findByText('No accounts yet')).closest('.rounded-card-tight')
    expect(card, 'the empty statement is not on a card').not.toBeNull()
    expect(cardOnItsPlane(card as Element)).toBe(true)
  })

  // B61.55 — the agent's credit statement, whose lines said Settled or Held, is parked.
  it('shows each state as a pill: a waiting approval, settled and held royalties', async () => {
    const approvals = await at('/agents/agt_research')
    const waiting = within(approvals).getByText(/wants to pay Acme Hosting/).closest('.min-h-row') as HTMLElement
    expect(pills(waiting)).toEqual(['Waiting'])
    document.body.replaceChildren()

    const royalties = await at('/statements/royalties')
    expect(pills(royalties)).toEqual(expect.arrayContaining(['Settled', 'Held']))
  })
})
