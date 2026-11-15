import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'
import { RULE_TEMPLATES } from '../lens/ruleTemplates'

// B57.50 — a new workspace's first page, which names it. Through the app at an address: what a person arriving gets.

const ID = 'uabcdefghijklmnopqrstuvwxy'
const SUPPORT_BOT = RULE_TEMPLATES.find((t) => t.id === 'support-bot')!.rules

// firstSignIn: the BFF's needs_pooling_choice, true only on the login that created the workspace.
function mockBff(opts: { name: string; firstSignIn?: boolean }) {
  let name = opts.name
  const puts: unknown[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input).split('?')[0]
    const json = (body: unknown) => Response.json(body)
    if (url === '/auth/me') return json({ mode: 'oidc', authenticated: true, user: { sub: 'sub-new', email: 'ada@acme.co.uk' }, workspace_id: ID, cache_poolable: true, needs_pooling_choice: opts.firstSignIn ?? false })
    if (url === '/api/workspace/name') {
      if (init?.method === 'PUT') {
        const body = JSON.parse(String(init.body)) as { name: string }
        puts.push(body)
        name = body.name
      }
      return json({ id: ID, name })
    }
    // Lens made "My first agent" at sign-up, on the Support bot rules.
    if (url === '/api/agents')
      return json({ workspace_balance_ulxc: 0, allocated_ulxc: 0, unallocated_ulxc: 0, spent_ulxc: 0, agents: [{ id: 'agt_first', name: 'My first agent', balance_ulxc: 0, spent_ulxc: 0, keys: [], created_at: '2026-11-14T09:00:00Z' }] })
    if (url === '/api/agents/agt_first/rules') return json(SUPPORT_BOT)
    if (url === '/api/lxc/topup-options') return json({ allowed_usd_cents: [1000], billing_enabled: true, usd_per_lxc: 0.1 })
    return new Response('null', { status: 404 })
  })
  return puts
}

function at(path: string) {
  window.history.pushState({}, '', path)
  return render(<App />)
}

beforeEach(() => {
  queryClient.clear()
  sessionStorage.clear()
})
afterEach(() => {
  vi.restoreAllMocks()
  window.history.pushState({}, '', '/')
})

describe('/welcome', () => {
  it('an unnamed workspace lands on /welcome, with its first agent’s rules in words as Lens holds them', async () => {
    mockBff({ name: ID, firstSignIn: true })
    at('/')
    await waitFor(() => expect(window.location.pathname).toBe('/welcome'))
    expect(await screen.findByRole('heading', { name: 'Welcome to Talyvor' })).toBeInTheDocument()
    // B61.14 — each amount in dollars alone, at the fixture's peg of $0.10 a LXC: 0.5 LXC is $0.05, never LXC.
    await waitFor(() =>
      expect(screen.getByTestId('welcome-agent-rules').textContent?.replace(/\s+/g, ' ')).toBe(
        '“My first agent”, on the Support bot rules: at most $0.05 a request, $2.00 an hour, $20.00 a day and $400.00 a month. It asks you above $0.50, and pauses if its spending looks unusual.',
      ),
    )
    expect(screen.queryByText(ID)).not.toBeInTheDocument()
  })

  it('Save name names it, says so, and Go to Home does not come back here', async () => {
    const puts = mockBff({ name: ID })
    at('/welcome')
    const step = within(await screen.findByTestId('welcome-name'))
    // Filled in from the email's company domain.
    await waitFor(() => expect(step.getByRole('textbox')).toHaveValue('Acme'))
    fireEvent.click(step.getByRole('button', { name: 'Save name' }))
    expect(await step.findByText('Named')).toBeInTheDocument()
    expect(puts).toEqual([{ name: 'Acme' }])
    expect(screen.getByText('Saved. Your workspace has a name now.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('link', { name: 'Go to Home' }))
    expect(await screen.findByTestId('sidebar-workspace-name')).toHaveTextContent('Acme')
    expect(window.location.pathname).toBe('/')
  })

  // B60.1 — Nick signed in again to a workspace with an agent and no name, and read "A NEW WORKSPACE" as not being let in.
  it('an unnamed workspace signed in again opens Home, which asks for the name, not /welcome', async () => {
    mockBff({ name: ID })
    at('/')
    expect(await screen.findByTestId('name-workspace')).toBeInTheDocument()
    expect(window.location.pathname).toBe('/')
    expect(screen.queryByRole('heading', { name: 'Welcome to Talyvor' })).not.toBeInTheDocument()
  })

  it('a named workspace never lands on /welcome, and is sent Home from it', async () => {
    mockBff({ name: 'Acme' })
    at('/welcome')
    await waitFor(() => expect(window.location.pathname).toBe('/'))
    expect(await screen.findByTestId('sidebar-workspace-name')).toHaveTextContent('Acme')
    expect(window.location.pathname).toBe('/')
  })
})
