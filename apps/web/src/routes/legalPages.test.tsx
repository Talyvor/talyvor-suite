import { render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../App'
import { longDate, sectionId } from './legalParts'

// B28.274 — Privacy and Terms are read whole and dated: each says the day its words last changed,
// lists every section before the first, and ends with a line saying it has ended.

/** What the legal pages and the documentation never say while investing is not offered (B56.3). */
const INVESTING = /investing is simulated|simulated portfolio|simulated order|no order reaches a market/i

const SIGNED_OUT = { mode: 'oidc', authenticated: false, user: null }

beforeEach(() => {
  queryClient.clear()
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) =>
    String(input) === '/auth/me'
      ? new Response(JSON.stringify(SIGNED_OUT), { status: 200, headers: { 'Content-Type': 'application/json' } })
      : new Response('null', { status: 404 }),
  )
})
afterEach(() => {
  vi.restoreAllMocks()
  window.history.pushState({}, '', '/')
})

function at(path: string) {
  window.history.pushState({}, '', path)
  return render(<App />)
}

describe('the legal pages', () => {
  it('reads a date as a calendar day and an anchor without its warning sign', () => {
    expect(longDate('2026-10-05')).toBe('5 October 2026')
    expect(sectionId('⚠ Earned LENS is not yours to spend straight away')).toBe(
      'earned-lens-is-not-yours-to-spend-straight-away',
    )
  })

  it.each([
    ['Terms', '2026-11-08', '8 November 2026'], // B56.3: approvals as the rules make them, no investing
    ['Privacy', '2026-11-08', '8 November 2026'], // B56.3: the six wallet records it left out
  ])('%s is dated, lists every section, and says where it ends', async (title, day, long) => {
    const { container } = at(`/${title.toLowerCase()}`)
    await screen.findByRole('heading', { level: 1, name: title })

    const dates = Array.from(container.querySelectorAll('main time')).map((t) => [t.getAttribute('dateTime'), t.textContent])
    expect(dates).toEqual([
      [day, long],
      [day, long],
    ])
    expect(screen.getByText(/Last updated/, { selector: 'header p' })).toHaveTextContent(`Last updated ${long}.`)

    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    const links = within(screen.getByRole('navigation', { name: 'On this page' })).getAllByRole('link')
    expect(links.map((a) => a.textContent)).toEqual(headings)
    for (const a of links) {
      const target = container.querySelector(a.getAttribute('href') ?? '')
      expect(target?.tagName, `${a.getAttribute('href')} points at no section`).toBe('SECTION')
    }

    // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- test-only: the pattern is built from this repo's own source names or the test's own constants, never from a person's input
    const end = screen.getByText(new RegExp(`^End of ${title}\\.`))
    expect(end).toHaveTextContent(`End of ${title}. Last updated ${long}. Back to the contents`)
    expect(screen.getByText(/Draft — needs legal review/)).toBeInTheDocument()
    // B27.38 — each says what Tare training keeps and why, in a paragraph marked as a draft.
    const tare = screen.getByRole('heading', { level: 2, name: /Tare training|Learning from your prose/ }).closest('section')!
    expect(tare).toHaveTextContent(/keep.*prose.*improve how Tare shortens prompts/)
    expect(within(tare).getByText('Draft — for legal review')).toBeInTheDocument()
  })

  // B56.3 — they say only what the code does: investing is not offered, so neither page mentions it.
  it.each(['/terms', '/privacy'])('%s puts no investing on a public page', async (path) => {
    const { container } = at(path)
    await screen.findByRole('heading', { level: 1 })
    expect(container.querySelector('main')).not.toHaveTextContent(INVESTING)
  })

  it('Terms says an over-approval payment waits unless the payee is always allowed or a mandate covers it', async () => {
    at('/terms')
    await screen.findByRole('heading', { level: 1, name: 'Terms' })
    expect(screen.getByText(/one over the approval amount waits/)).toHaveTextContent(
      /waits for a person to approve it, unless you always allow that payee or a mandate covers it\./,
    )
  })

  it('Privacy names every record Agent Wallets keeps', async () => {
    at('/privacy')
    const section = (await screen.findByRole('heading', { level: 2, name: 'What Agent Wallets stores' })).closest('section')!
    const records = within(section)
      .getAllByRole('listitem')
      .map((li) => li.querySelector('strong')?.textContent)
    for (const name of ['Verification.', 'Saved payees.', 'Invoices.', 'Mandates.', 'Payout details.', 'Currency accounts.']) {
      expect(records).toContain(name)
    }
    expect(section).toHaveTextContent(/the account Talyvor pays you to: the holder.s name and the account.s details/i)
  })
})
