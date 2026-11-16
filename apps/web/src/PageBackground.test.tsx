import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { agentHues, businessHues, personalHues } from '@talyvor/ui/pocket'
import { App, queryClient } from './App'
import { populatedBff, settleQueries } from './populatedBff'

// B61.70 — the moving background on every page (design/pocket-live/DESIGN.md section 6): once on every page the sidebar
// opens, behind the top bar and outside the sidebar, hidden from assistive technology, in the account's colours (an
// agent's page in the agent's), the same behind the sign-in and sign-up pages; and a top-bar button still takes its press.

async function at(address: string, account_type: 'business' | 'personal') {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  populatedBff((impl) => vi.spyOn(globalThis, 'fetch').mockImplementation(impl as never), {
    '/api/workspace/account': { account_type, money_kind: 'hybrid' },
  })
  window.history.pushState({}, '', address)
  render(<App />)
  const nav = await screen.findByRole('navigation', { name: 'Sections' })
  await settleQueries(queryClient, waitFor)
  return nav
}

const backgrounds = () => [...document.querySelectorAll<HTMLElement>('[data-background="streams"]')]
const hues = (bg: HTMLElement) => [bg.style.getPropertyValue('--h1'), bg.style.getPropertyValue('--h2')]

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  queryClient.clear()
  document.body.replaceChildren()
})

describe('the background on every page (B61.70)', () => {
  it.each(['business', 'personal'] as const)('every page in a %s account’s sidebar draws it once, aria-hidden, behind the top bar', async (type) => {
    const nav = await at('/', type)
    const addresses = within(nav)
      .getAllByRole('link')
      .map((a) => a.getAttribute('href') ?? '')
      // B61.9's account tile (`?accounts=open`) opens a sheet over the page, not a page of its own.
      .filter((h) => h.startsWith('/') && !h.includes('?') && !['/privacy', '/terms'].includes(h))
    expect(addresses.length).toBeGreaterThanOrEqual(7)
    for (const address of addresses) {
      fireEvent.click(within(screen.getByRole('navigation', { name: 'Sections' })).getAllByRole('link').find((a) => a.getAttribute('href') === address)!)
      await waitFor(() => expect(window.location.pathname).toBe(address))
      await settleQueries(queryClient, waitFor)
      const all = backgrounds()
      expect(all, address).toHaveLength(1)
      const [bg] = all
      expect(bg.getAttribute('aria-hidden'), address).toBe('true')
      expect(bg.closest('aside'), address).toBeNull()
      // In the content's column, before the top bar, so the bar and the page draw over it.
      const header = bg.parentElement!.querySelector(':scope > header')!
      expect(bg.compareDocumentPosition(header) & Node.DOCUMENT_POSITION_FOLLOWING, address).toBeTruthy()
      expect(hues(bg), address).toEqual([...(type === 'personal' ? personalHues : businessHues)])
    }
  })

  it('an agent’s page wears the agent’s own colour', async () => {
    await at('/agents', 'business')
    const agents = (await queryClient.fetchQuery({ queryKey: ['agent-book'] })) as { agents: { id: string; colour?: string }[] }
    const agent = agents.agents[0]
    cleanup()
    queryClient.clear()
    vi.restoreAllMocks()
    await at(`/agents/${agent.id}`, 'business')
    await waitFor(() => expect(hues(backgrounds()[0])).toEqual([...agentHues(agent)]))
    expect(backgrounds()).toHaveLength(1)
  })

  it('a top-bar button still takes its press with the background drawn', async () => {
    await at('/', 'business')
    expect(backgrounds()).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Search agents, payees, bills… or type a command' }))
    expect(await screen.findByRole('listbox', { name: 'Commands' })).toBeTruthy()
  })

  it.each(['/signin', '/signup', '/agents'])('signed out, %s draws it once, behind the card', async (address) => {
    populatedBff((impl) => vi.spyOn(globalThis, 'fetch').mockImplementation(impl as never), {
      '/auth/me': { mode: 'oidc', authenticated: false, user: null },
    })
    window.history.pushState({}, '', address)
    render(<App />)
    // /agents is behind the gate: signed out, the gate's own sign-in page stands in for it.
    await screen.findByRole('main')
    await settleQueries(queryClient, waitFor)
    const all = backgrounds()
    expect(all).toHaveLength(1)
    expect(all[0].getAttribute('aria-hidden')).toBe('true')
    expect(hues(all[0])).toEqual([...personalHues])
    expect(screen.queryByRole('navigation', { name: 'Sections' })).toBeNull()
  })
})
